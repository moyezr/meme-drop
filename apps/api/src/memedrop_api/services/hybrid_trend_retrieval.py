"""Bounded suggestion-time retrieval over Redis signals and pgvector semantics."""

from __future__ import annotations

import asyncio
import hashlib
import json
import re
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime
from typing import Protocol
from uuid import UUID

from memedrop_api.services.trend_index import (
    TrendQuerySignal,
    TrendRetrieval,
)
from memedrop_api.trend_repository import TrendVectorMatch
from memedrop_api.trends import TrendCard, TrendSnapshot

MAX_HYBRID_QUERY_SIGNALS = 10
MAX_SEMANTIC_CANDIDATES = 12
MAX_HYBRID_RESULTS = 2
MAX_QUERY_DOCUMENT_CHARS = 1_200
MAX_QUERY_SIGNAL_CHARS = 80
DEFAULT_HYBRID_TIMEOUT_SECONDS = 1.25

_TOKEN = re.compile(r"[a-z0-9][a-z0-9'’-]{1,47}", re.IGNORECASE)
_LIFECYCLE_SCORE = {
    "emerging": 0.8,
    "rising": 1.0,
    "established": 0.85,
    "cooling": 0.25,
    "dormant": 0.0,
}


class LexicalTrendRetriever(Protocol):
    async def retrieve(self, signals: Sequence[TrendQuerySignal]) -> TrendRetrieval: ...


class SemanticTrendRepository(Protocol):
    async def get_snapshot(self, version: int | None = None) -> TrendSnapshot | None: ...

    async def search_active_by_embedding(
        self,
        embedding: Sequence[float],
        *,
        model: str,
        eligible_card_versions: Mapping[UUID, int],
        as_of: datetime,
        limit: int,
    ) -> list[TrendVectorMatch]: ...


class QueryEmbedder(Protocol):
    async def embed_texts(self, documents: Sequence[str]) -> list[list[float]]: ...

    async def close(self) -> None: ...


class HybridTrendRetriever:
    """Merge Redis lexical retrieval with bounded pgvector candidates.

    Semantic retrieval is optional enrichment. Any query-embedding or database
    failure returns the Redis result unchanged so suggestion generation keeps
    its existing deterministic behavior.
    """

    def __init__(
        self,
        *,
        lexical_retriever: LexicalTrendRetriever,
        repository: SemanticTrendRepository,
        query_embedder: QueryEmbedder,
        embedding_model: str,
        timeout_seconds: float = DEFAULT_HYBRID_TIMEOUT_SECONDS,
        max_candidates: int = MAX_SEMANTIC_CANDIDATES,
        max_results: int = MAX_HYBRID_RESULTS,
    ) -> None:
        if not embedding_model.strip():
            raise ValueError("embedding model is required")
        if timeout_seconds <= 0 or timeout_seconds > 1.5:
            raise ValueError("hybrid retrieval timeout must be between 0 and 1.5 seconds")
        if not 1 <= max_candidates <= MAX_SEMANTIC_CANDIDATES:
            raise ValueError("semantic candidates must be between 1 and 12")
        if not 1 <= max_results <= MAX_HYBRID_RESULTS:
            raise ValueError("hybrid results must be between 1 and 2")
        self._lexical_retriever = lexical_retriever
        self._repository = repository
        self._query_embedder = query_embedder
        self._embedding_model = embedding_model.strip()
        self._timeout_seconds = timeout_seconds
        self._max_candidates = max_candidates
        self._max_results = max_results

    @property
    def lexical_retriever(self) -> LexicalTrendRetriever:
        return self._lexical_retriever

    async def retrieve(self, signals: Sequence[TrendQuerySignal]) -> TrendRetrieval:
        lexical = await self._lexical_retriever.retrieve(signals)
        query_document = hybrid_query_document(signals)
        if not query_document:
            return lexical
        try:
            async with asyncio.timeout(self._timeout_seconds):
                snapshot = await self._repository.get_snapshot()
                if snapshot is None or not snapshot.cards:
                    return lexical
                expected_redis_version = f"snapshot-v{snapshot.version}"
                if (
                    lexical.cards
                    and lexical.version is not None
                    and lexical.version != expected_redis_version
                ):
                    return lexical
                published_card_versions = {
                    card.id: card.version for card in snapshot.cards[:500]
                }
                vectors = await self._query_embedder.embed_texts([query_document])
                if len(vectors) != 1:
                    return lexical
                now = datetime.now(UTC)
                semantic = await self._repository.search_active_by_embedding(
                    vectors[0],
                    model=self._embedding_model,
                    eligible_card_versions=published_card_versions,
                    as_of=now,
                    limit=self._max_candidates,
                )
        except Exception:
            # Query embeddings and pgvector are optional. No request data or
            # provider details are logged, persisted, or placed in cache keys.
            return lexical
        if not semantic:
            return lexical
        return self._merge(
            signals,
            lexical=lexical,
            semantic=semantic,
            snapshot_version=snapshot.version,
        )

    async def close(self) -> None:
        await self._query_embedder.close()

    def _merge(
        self,
        signals: Sequence[TrendQuerySignal],
        *,
        lexical: TrendRetrieval,
        semantic: Sequence[TrendVectorMatch],
        snapshot_version: int,
    ) -> TrendRetrieval:
        lexical_ids = {card.id for card in lexical.cards}
        semantic_scores = {
            match.card.id: min(1.0, max(0.0, 1.0 - match.cosine_distance))
            for match in semantic[: self._max_candidates]
        }
        cards = {card.id: card for card in lexical.cards}
        cards.update(
            (match.card.id, match.card) for match in semantic[: self._max_candidates]
        )
        ranked = sorted(
            (
                (
                    _hybrid_score(
                        card,
                        signals=signals,
                        semantic_score=semantic_scores.get(card.id, 0.0),
                        redis_match=card.id in lexical_ids,
                    ),
                    str(card.id),
                    card,
                )
                for card in cards.values()
            ),
            key=lambda item: (-item[0], item[1]),
        )
        model_version = hashlib.sha256(self._embedding_model.encode("utf-8")).hexdigest()[:12]
        lexical_version = lexical.version or "none"
        return TrendRetrieval(
            version=f"hybrid-snapshot-v{snapshot_version}-{lexical_version}-{model_version}",
            cards=tuple(item[2] for item in ranked[: self._max_results]),
        )


def hybrid_query_document(signals: Sequence[TrendQuerySignal]) -> str:
    """Serialize only bounded categorical signals, never the source-post text."""

    grouped: dict[str, list[dict[str, str | float]]] = {
        "topics": [],
        "entities": [],
        "humor_mechanics": [],
        "terms": [],
    }
    group_for_kind = {
        "category": "topics",
        "entity": "entities",
        "humor_mechanic": "humor_mechanics",
        "term": "terms",
    }
    seen: set[tuple[str, str]] = set()
    for signal in signals[:MAX_HYBRID_QUERY_SIGNALS]:
        normalized = " ".join(signal.value.split()).casefold()[:MAX_QUERY_SIGNAL_CHARS]
        identity = (signal.kind, normalized)
        if not normalized or identity in seen:
            continue
        seen.add(identity)
        grouped[group_for_kind[signal.kind]].append(
            {
                "value": normalized,
                "weight": round(min(2.0, max(0.0, signal.weight)), 3),
            }
        )
    context = {key: values for key, values in grouped.items() if values}
    if not context:
        return ""
    while context:
        document = json.dumps(
            {"task": "match_current_cultural_context", "context": context},
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        if len(document) <= MAX_QUERY_DOCUMENT_CHARS:
            return document
        longest_group = max(context, key=lambda key: len(context[key]))
        context[longest_group].pop()
        if not context[longest_group]:
            del context[longest_group]
    return ""


def _hybrid_score(
    card: TrendCard,
    *,
    signals: Sequence[TrendQuerySignal],
    semantic_score: float,
    redis_match: bool,
) -> float:
    lifecycle = _LIFECYCLE_SCORE.get(card.lifecycle.value, 0.0)
    lexical = _lexical_score(card, signals)
    return (
        0.52 * semantic_score
        + 0.2 * lexical
        + 0.13 * min(1.0, max(0.0, card.vitality))
        + 0.1 * lifecycle
        + 0.05 * float(redis_match)
    )


def _lexical_score(card: TrendCard, signals: Sequence[TrendQuerySignal]) -> float:
    semantic_text = " ".join(
        (
            card.name,
            card.premise,
            *card.aliases,
            *card.entities,
            *card.topics,
            *card.communities,
            *card.recognition_cues,
            *card.comic_tensions,
            card.usage_guidance,
        )
    ).casefold()
    card_tokens = set(_TOKEN.findall(semantic_text))
    matched_weight = 0.0
    total_weight = 0.0
    for signal in signals[:MAX_HYBRID_QUERY_SIGNALS]:
        weight = min(2.0, max(0.0, signal.weight))
        if weight <= 0:
            continue
        total_weight += weight
        normalized = " ".join(signal.value.split()).casefold()
        signal_tokens = set(_TOKEN.findall(normalized))
        if normalized in semantic_text or (signal_tokens and signal_tokens <= card_tokens):
            matched_weight += weight
    return matched_weight / total_weight if total_weight else 0.0
