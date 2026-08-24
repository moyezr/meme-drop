from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest

from memedrop_api.services.hybrid_trend_retrieval import (
    HybridTrendRetriever,
    hybrid_query_document,
)
from memedrop_api.services.trend_index import (
    TrendQuerySignal,
    TrendRetrieval,
)
from memedrop_api.trend_repository import TrendVectorMatch
from memedrop_api.trends import (
    TrendCard,
    TrendDuration,
    TrendLifecycle,
    TrendSnapshot,
    trend_id_for_key,
)

NOW = datetime(2026, 8, 24, 12, tzinfo=UTC)


def make_card(
    key: str,
    *,
    topic: str,
    lifecycle: TrendLifecycle = TrendLifecycle.RISING,
    vitality: float = 0.8,
) -> TrendCard:
    return TrendCard(
        id=trend_id_for_key(key),
        key=key,
        name=key.replace("-", " ").title(),
        premise=f"A current {topic} expectation flips into an immediate self-own.",
        topics=(topic,),
        recognition_cues=(f"the recognizable {topic} moment",),
        comic_tensions=("confidence versus immediate failure",),
        usage_guidance=f"Use for a current {topic} reversal.",
        lifecycle=lifecycle,
        duration_class=TrendDuration.FAST,
        first_seen_at=NOW - timedelta(days=2),
        last_confirmed_at=NOW,
        expires_at=NOW + timedelta(days=5),
        confidence=0.8,
        momentum=0.75,
        vitality=vitality,
        source_count=3,
        observation_count=4,
    )


class FakeLexicalRetriever:
    def __init__(self, result: TrendRetrieval) -> None:
        self.result = result

    async def retrieve(self, signals: Sequence[TrendQuerySignal]) -> TrendRetrieval:
        return self.result


class FakeEmbedder:
    def __init__(self, *, error: Exception | None = None) -> None:
        self.error = error
        self.documents: list[str] = []
        self.closed = False

    async def embed_texts(self, documents: Sequence[str]) -> list[list[float]]:
        self.documents.extend(documents)
        if self.error is not None:
            raise self.error
        return [[1.0] + [0.0] * 1_535]

    async def close(self) -> None:
        self.closed = True


class FakeRepository:
    def __init__(
        self,
        *,
        snapshot: TrendSnapshot,
        matches: list[TrendVectorMatch],
        delay: float = 0,
    ) -> None:
        self.snapshot = snapshot
        self.matches = matches
        self.delay = delay
        self.requested_model: str | None = None
        self.eligible_card_versions: dict[UUID, int] = {}
        self.requested_limit: int | None = None

    async def get_snapshot(self, version: int | None = None) -> TrendSnapshot:
        return self.snapshot

    async def search_active_by_embedding(
        self,
        embedding: Sequence[float],
        *,
        model: str,
        eligible_card_versions: Mapping[UUID, int],
        as_of: datetime,
        limit: int,
    ) -> list[TrendVectorMatch]:
        if self.delay:
            await asyncio.sleep(self.delay)
        self.requested_model = model
        self.eligible_card_versions = dict(eligible_card_versions)
        self.requested_limit = limit
        return self.matches


async def test_hybrid_retrieval_uses_only_published_candidates_and_caps_results() -> None:
    lexical_card = make_card("redis-card", topic="workplace", vitality=0.6)
    semantic_card = make_card("semantic-card", topic="technology", vitality=0.95)
    third_card = make_card(
        "third-card",
        topic="technology",
        lifecycle=TrendLifecycle.COOLING,
        vitality=0.2,
    )
    snapshot = TrendSnapshot.create(
        version=9,
        cards=(lexical_card, semantic_card, third_card),
        created_at=NOW,
    ).model_copy(update={"published_at": NOW})
    repository = FakeRepository(
        snapshot=snapshot,
        matches=[
            TrendVectorMatch(card=semantic_card, cosine_distance=0.08),
            TrendVectorMatch(card=third_card, cosine_distance=0.1),
        ],
    )
    embedder = FakeEmbedder()
    retriever = HybridTrendRetriever(
        lexical_retriever=FakeLexicalRetriever(
            TrendRetrieval(version="snapshot-v9", cards=(lexical_card,))
        ),
        repository=repository,  # type: ignore[arg-type]
        query_embedder=embedder,
        embedding_model="google/gemini-embedding-2",
    )
    signals = (
        TrendQuerySignal(kind="category", value="technology"),
        TrendQuerySignal(kind="humor_mechanic", value="self-own"),
    )

    result = await retriever.retrieve(signals)

    assert len(result.cards) == 2
    assert result.cards[0] == semantic_card
    assert result.version is not None and "snapshot-v9" in result.version
    assert repository.requested_model == "google/gemini-embedding-2"
    assert repository.requested_limit == 12
    assert repository.eligible_card_versions == {
        card.id: card.version for card in snapshot.cards
    }
    assert len(embedder.documents) == 1
    document = json.loads(embedder.documents[0])
    assert document["task"] == "match_current_cultural_context"
    assert document["context"]["topics"][0]["value"] == "technology"
    assert document["context"]["humor_mechanics"][0]["value"] == "self-own"


async def test_mismatched_nonempty_redis_generation_is_not_merged() -> None:
    redis_card = make_card("redis-generation", topic="workplace")
    sql_card = make_card("sql-generation", topic="technology")
    lexical = TrendRetrieval(version="snapshot-v8", cards=(redis_card,))
    snapshot = TrendSnapshot.create(
        version=9,
        cards=(sql_card,),
        created_at=NOW,
    ).model_copy(update={"published_at": NOW})
    repository = FakeRepository(
        snapshot=snapshot,
        matches=[TrendVectorMatch(card=sql_card, cosine_distance=0.05)],
    )
    embedder = FakeEmbedder()
    retriever = HybridTrendRetriever(
        lexical_retriever=FakeLexicalRetriever(lexical),
        repository=repository,  # type: ignore[arg-type]
        query_embedder=embedder,
        embedding_model="google/gemini-embedding-2",
    )

    result = await retriever.retrieve(
        [TrendQuerySignal(kind="category", value="technology")]
    )

    assert result is lexical
    assert embedder.documents == []
    assert repository.requested_model is None


async def test_empty_redis_generation_can_fall_back_to_latest_sql_snapshot() -> None:
    sql_card = make_card("sql-fallback", topic="technology")
    lexical = TrendRetrieval(version="snapshot-v8", cards=())
    snapshot = TrendSnapshot.create(
        version=9,
        cards=(sql_card,),
        created_at=NOW,
    ).model_copy(update={"published_at": NOW})
    repository = FakeRepository(
        snapshot=snapshot,
        matches=[TrendVectorMatch(card=sql_card, cosine_distance=0.05)],
    )
    embedder = FakeEmbedder()
    retriever = HybridTrendRetriever(
        lexical_retriever=FakeLexicalRetriever(lexical),
        repository=repository,  # type: ignore[arg-type]
        query_embedder=embedder,
        embedding_model="google/gemini-embedding-2",
    )

    result = await retriever.retrieve(
        [TrendQuerySignal(kind="category", value="technology")]
    )

    assert result.cards == (sql_card,)
    assert result.version is not None and "hybrid-snapshot-v9" in result.version
    assert len(embedder.documents) == 1
    assert repository.requested_model == "google/gemini-embedding-2"


@pytest.mark.parametrize("failure_source", ["provider", "database"])
async def test_semantic_failure_returns_the_redis_result_unchanged(
    failure_source: str,
) -> None:
    card = make_card("redis-fallback", topic="workplace")
    lexical = TrendRetrieval(version="snapshot-v4", cards=(card,))
    snapshot = TrendSnapshot.create(version=4, cards=(card,), created_at=NOW).model_copy(
        update={"published_at": NOW}
    )
    embedder = FakeEmbedder(
        error=ConnectionError("provider detail") if failure_source == "provider" else None
    )

    class FailingRepository(FakeRepository):
        async def search_active_by_embedding(self, *args: object, **kwargs: object):
            raise RuntimeError("database detail")

    repository_class = FailingRepository if failure_source == "database" else FakeRepository
    repository = repository_class(snapshot=snapshot, matches=[])
    retriever = HybridTrendRetriever(
        lexical_retriever=FakeLexicalRetriever(lexical),
        repository=repository,  # type: ignore[arg-type]
        query_embedder=embedder,
        embedding_model="google/gemini-embedding-2",
    )

    result = await retriever.retrieve(
        [TrendQuerySignal(kind="category", value="workplace")]
    )

    assert result is lexical


async def test_database_timeout_returns_redis_without_delaying_generation() -> None:
    card = make_card("timeout-fallback", topic="workplace")
    lexical = TrendRetrieval(version="snapshot-v2", cards=(card,))
    snapshot = TrendSnapshot.create(version=2, cards=(card,), created_at=NOW).model_copy(
        update={"published_at": NOW}
    )
    retriever = HybridTrendRetriever(
        lexical_retriever=FakeLexicalRetriever(lexical),
        repository=FakeRepository(snapshot=snapshot, matches=[], delay=0.1),  # type: ignore[arg-type]
        query_embedder=FakeEmbedder(),
        embedding_model="google/gemini-embedding-2",
        timeout_seconds=0.01,
    )

    result = await retriever.retrieve(
        [TrendQuerySignal(kind="category", value="workplace")]
    )

    assert result is lexical


def test_query_document_is_structured_deterministic_and_hard_bounded() -> None:
    signals = [
        TrendQuerySignal(kind="entity", value=f"Entity {index} " + "x" * 200)
        for index in range(20)
    ]

    first = hybrid_query_document(signals)

    assert first == hybrid_query_document(signals)
    assert len(first) <= 1_200
    decoded = json.loads(first)
    assert 1 <= len(decoded["context"]["entities"]) <= 10
    assert all(
        len(item["value"]) <= 80 for item in decoded["context"]["entities"]
    )
