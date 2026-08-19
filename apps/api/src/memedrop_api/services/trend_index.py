from __future__ import annotations

import asyncio
import hashlib
import json
import math
import re
from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Literal

from redis.asyncio import Redis

from memedrop_api.trends import TrendCard, TrendEvidenceState, adaptive_half_life, assess_trend

TrendSignalKind = Literal["term", "entity", "category", "humor_mechanic"]

_SAFE_VERSION = re.compile(r"\A[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}\Z")
_MAX_SIGNAL_CHARS = 240
_SIGNAL_KIND_WEIGHT: dict[TrendSignalKind, float] = {
    "entity": 1.0,
    "term": 0.8,
    "category": 0.65,
    "humor_mechanic": 0.55,
}
_LIFECYCLE_WEIGHT = {
    "emerging": 0.75,
    "rising": 1.0,
    "established": 0.85,
    "cooling": 0.3,
    "dormant": 0.0,
}


@dataclass(frozen=True, slots=True)
class TrendQuerySignal:
    kind: TrendSignalKind
    value: str
    weight: float = 1.0


@dataclass(frozen=True, slots=True)
class TrendIndexDocument:
    card: TrendCard
    terms: tuple[str, ...] = ()
    entities: tuple[str, ...] = ()
    categories: tuple[str, ...] = ()
    humor_mechanics: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class TrendRetrieval:
    version: str | None
    cards: tuple[TrendCard, ...]

    @classmethod
    def empty(cls) -> TrendRetrieval:
        return cls(version=None, cards=())


class RedisTrendIndex:
    """Versioned, rebuildable Redis serving index for active trend cards.

    Namespace data is written before the current-version pointer is changed, so a
    failed or partial build is never visible to readers. Signal values are hashed
    before becoming Redis keys; source-post text must never be passed as a version
    or card identifier.
    """

    def __init__(
        self,
        redis_url: str,
        *,
        client: Any | None = None,
        key_prefix: str = "memedrop:trend-index:{serving}:",
        timeout_seconds: float = 0.05,
        active_ttl_seconds: int = 7 * 24 * 60 * 60,
        old_version_grace_seconds: int = 60 * 60,
        max_cards: int = 500,
        max_index_keys: int = 2_048,
        max_signals_per_card: int = 24,
        max_postings_per_signal: int = 100,
        max_query_signals: int = 12,
        max_candidates: int = 20,
        max_results: int = 2,
        minimum_score: float = 0.5,
        clock: Callable[[], datetime] | None = None,
    ) -> None:
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        if active_ttl_seconds <= 0 or old_version_grace_seconds <= 0:
            raise ValueError("trend index TTLs must be positive")
        if not 1 <= max_query_signals <= 12:
            raise ValueError("max_query_signals must be between 1 and 12")
        if not 1 <= max_candidates <= 20:
            raise ValueError("max_candidates must be between 1 and 20")
        if not 1 <= max_results <= 2:
            raise ValueError("max_results must be between 1 and 2")
        if not 0 <= minimum_score <= 1:
            raise ValueError("minimum_score must be between 0 and 1")
        for name, value in (
            ("max_cards", max_cards),
            ("max_index_keys", max_index_keys),
            ("max_signals_per_card", max_signals_per_card),
            ("max_postings_per_signal", max_postings_per_signal),
        ):
            if value <= 0:
                raise ValueError(f"{name} must be positive")

        self._owns_client = client is None
        self.client = client or Redis.from_url(
            redis_url,
            decode_responses=True,
            socket_connect_timeout=timeout_seconds,
            socket_timeout=timeout_seconds,
        )
        self.key_prefix = key_prefix
        self.timeout_seconds = timeout_seconds
        self.active_ttl_seconds = active_ttl_seconds
        self.old_version_grace_seconds = old_version_grace_seconds
        self.max_cards = max_cards
        self.max_index_keys = max_index_keys
        self.max_signals_per_card = max_signals_per_card
        self.max_postings_per_signal = max_postings_per_signal
        self.max_query_signals = max_query_signals
        self.max_candidates = max_candidates
        self.max_results = max_results
        self.minimum_score = minimum_score
        self.clock = clock or (lambda: datetime.now(UTC))

    async def close(self) -> None:
        if self._owns_client:
            await self.client.aclose()

    async def publish(self, version: str, documents: Sequence[TrendIndexDocument]) -> None:
        """Publish a complete version, leaving the previous version readable on failure."""

        self._validate_version(version)
        if len(documents) > self.max_cards:
            raise ValueError(f"trend index is limited to {self.max_cards} cards")

        card_payloads: dict[str, str] = {}
        postings: dict[str, dict[str, float]] = defaultdict(dict)
        for document in documents:
            card_id = str(document.card.id)
            if card_id in card_payloads:
                raise ValueError(f"duplicate trend card id: {card_id}")
            card_payloads[card_id] = document.card.model_dump_json()
            quality = self._publication_quality(document.card)
            for signal in self._document_signals(document):
                posting_key = self._posting_key(version, signal.kind, signal.value)
                postings[posting_key][card_id] = max(
                    postings[posting_key].get(card_id, 0.0),
                    quality * signal.weight,
                )

        if len(postings) > self.max_index_keys:
            raise ValueError(f"trend index is limited to {self.max_index_keys} signal keys")

        old_version = self._as_text(await self.client.get(self._current_version_key()))
        namespace_keys: list[str] = []
        pipeline = self.client.pipeline(transaction=True)
        for card_id, payload in card_payloads.items():
            key = self._card_key(version, card_id)
            namespace_keys.append(key)
            pipeline.set(key, payload, ex=self.active_ttl_seconds)
        for key, members in postings.items():
            ranked_members = sorted(members.items(), key=lambda item: (-item[1], item[0]))[
                : self.max_postings_per_signal
            ]
            namespace_keys.append(key)
            pipeline.zadd(key, dict(ranked_members))
            pipeline.expire(key, self.active_ttl_seconds)

        manifest_key = self._manifest_key(version)
        manifest_payload = json.dumps(namespace_keys, separators=(",", ":"))
        pipeline.set(manifest_key, manifest_payload, ex=self.active_ttl_seconds)
        await pipeline.execute()

        # Cleanup metadata and the pointer switch share one final transaction. The
        # pointer command remains last, and a namespace build that raises above is
        # unreachable by readers.
        publish_pipeline = self.client.pipeline(transaction=True)
        if old_version and old_version != version and _SAFE_VERSION.fullmatch(old_version):
            for key in await self._old_namespace_keys(old_version):
                publish_pipeline.expire(key, self.old_version_grace_seconds)
        publish_pipeline.set(self._current_version_key(), version)
        await publish_pipeline.execute()

    async def retrieve(self, signals: Sequence[TrendQuerySignal]) -> TrendRetrieval:
        """Return a bounded ranked result, or an empty result on timeout/store failure."""

        try:
            async with asyncio.timeout(self.timeout_seconds):
                return await self._retrieve(signals)
        except Exception:  # Redis is optional enrichment; suggestion generation must continue.
            return TrendRetrieval.empty()

    async def _retrieve(self, signals: Sequence[TrendQuerySignal]) -> TrendRetrieval:
        version = self._as_text(await self.client.get(self._current_version_key()))
        if not version or not _SAFE_VERSION.fullmatch(version):
            return TrendRetrieval.empty()

        query_signals = self._bounded_query_signals(signals)
        if not query_signals:
            return TrendRetrieval(version=version, cards=())

        pipeline = self.client.pipeline(transaction=False)
        for signal in query_signals:
            pipeline.zrevrange(
                self._posting_key(version, signal.kind, signal.value),
                0,
                self.max_candidates - 1,
                withscores=True,
            )
        posting_results = await pipeline.execute()

        candidate_scores: dict[str, float] = defaultdict(float)
        maximum_retrieval_score = 0.0
        for signal, result in zip(query_signals, posting_results, strict=True):
            signal_weight = _SIGNAL_KIND_WEIGHT[signal.kind] * signal.weight
            maximum_retrieval_score += signal_weight
            for raw_card_id, posting_score in result:
                card_id = self._as_text(raw_card_id)
                if card_id:
                    candidate_scores[card_id] += signal_weight * float(posting_score)

        candidate_ids = sorted(
            candidate_scores,
            key=lambda card_id: (-candidate_scores[card_id], card_id),
        )[: self.max_candidates]
        if not candidate_ids:
            return TrendRetrieval(version=version, cards=())

        payloads = await self.client.mget(
            [self._card_key(version, card_id) for card_id in candidate_ids]
        )
        now = self._utc(self.clock())
        ranked: list[tuple[float, str, TrendCard]] = []
        normalizer = maximum_retrieval_score or 1.0
        for card_id, raw_payload in zip(candidate_ids, payloads, strict=True):
            payload = self._as_text(raw_payload)
            if not payload:
                continue
            try:
                card = TrendCard.model_validate_json(payload)
            except (ValueError, TypeError):
                continue
            score = self._rerank_score(
                card,
                retrieval_score=candidate_scores[card_id] / normalizer,
                now=now,
            )
            if score is not None and score >= self.minimum_score:
                ranked.append((score, card_id, card))

        ranked.sort(key=lambda item: (-item[0], item[1]))
        return TrendRetrieval(
            version=version,
            cards=tuple(item[2] for item in ranked[: self.max_results]),
        )

    async def _old_namespace_keys(self, version: str) -> tuple[str, ...]:
        manifest_key = self._manifest_key(version)
        raw_manifest = self._as_text(await self.client.get(manifest_key))
        keys: list[str] = []
        if raw_manifest:
            try:
                decoded = json.loads(raw_manifest)
                if isinstance(decoded, list):
                    keys = [key for key in decoded if isinstance(key, str)][
                        : self.max_cards + self.max_index_keys
                    ]
            except json.JSONDecodeError:
                pass
        return (*keys, manifest_key)

    def _document_signals(self, document: TrendIndexDocument) -> tuple[TrendQuerySignal, ...]:
        grouped: tuple[tuple[TrendSignalKind, tuple[str, ...]], ...] = (
            ("term", document.terms),
            ("entity", document.entities),
            ("category", document.categories),
            ("humor_mechanic", document.humor_mechanics),
        )
        signals: list[TrendQuerySignal] = []
        seen: set[tuple[TrendSignalKind, str]] = set()
        for kind, values in grouped:
            for value in values:
                normalized = self._normalize_signal(value)
                identity = (kind, normalized)
                if not normalized or identity in seen:
                    continue
                seen.add(identity)
                signals.append(TrendQuerySignal(kind=kind, value=normalized))
                if len(signals) >= self.max_signals_per_card:
                    return tuple(signals)
        return tuple(signals)

    def _bounded_query_signals(
        self, signals: Sequence[TrendQuerySignal]
    ) -> tuple[TrendQuerySignal, ...]:
        bounded: list[TrendQuerySignal] = []
        seen: set[tuple[TrendSignalKind, str]] = set()
        for signal in signals[: self.max_query_signals]:
            normalized = self._normalize_signal(signal.value)
            identity = (signal.kind, normalized)
            if not normalized or identity in seen or not math.isfinite(signal.weight):
                continue
            seen.add(identity)
            bounded.append(
                TrendQuerySignal(
                    kind=signal.kind,
                    value=normalized,
                    weight=min(2.0, max(0.0, signal.weight)),
                )
            )
        return tuple(signal for signal in bounded if signal.weight > 0)

    def _rerank_score(
        self,
        card: TrendCard,
        *,
        retrieval_score: float,
        now: datetime,
    ) -> float | None:
        first_seen_at = self._utc(card.first_seen_at)
        if now < first_seen_at:
            return None

        state = TrendEvidenceState(
            first_seen_at=first_seen_at,
            last_confirmed_at=self._utc(card.last_confirmed_at),
            confidence=card.confidence,
            momentum=card.momentum,
            source_count=card.source_count,
            observation_count=card.observation_count,
            recurrence_count=card.recurrence_count,
        )
        current_assessment = assess_trend(state, as_of=now)
        stored_lifecycle_score = _LIFECYCLE_WEIGHT.get(self._enum_value(card.lifecycle), 0.0)
        current_lifecycle_score = _LIFECYCLE_WEIGHT.get(
            self._enum_value(current_assessment.lifecycle), 0.0
        )
        lifecycle_score = min(stored_lifecycle_score, current_lifecycle_score)
        expires_at = min(self._utc(card.expires_at), self._utc(current_assessment.expires_at))
        if lifecycle_score <= 0 or expires_at <= now:
            return None

        age = max(0.0, (now - state.last_confirmed_at).total_seconds())
        half_life = adaptive_half_life(state, card.duration_class).total_seconds()
        freshness = 2 ** (-age / half_life)
        return (
            0.55 * min(1.0, max(0.0, retrieval_score))
            + 0.15 * freshness
            + 0.13 * min(1.0, max(0.0, card.confidence))
            + 0.1 * min(1.0, max(0.0, card.momentum))
            + 0.07 * lifecycle_score
        )

    def _publication_quality(self, card: TrendCard) -> float:
        lifecycle = _LIFECYCLE_WEIGHT.get(self._enum_value(card.lifecycle), 0.0)
        return (
            0.45 * min(1.0, max(0.0, card.confidence))
            + 0.35 * min(1.0, max(0.0, card.momentum))
            + 0.2 * lifecycle
        )

    def _posting_key(self, version: str, kind: TrendSignalKind, value: str) -> str:
        normalized = self._normalize_signal(value)
        digest = hashlib.sha256(normalized.encode("utf-8")).hexdigest()
        return f"{self.key_prefix}v:{version}:signal:{kind}:{digest}"

    def _card_key(self, version: str, card_id: str) -> str:
        return f"{self.key_prefix}v:{version}:card:{card_id}"

    def _manifest_key(self, version: str) -> str:
        return f"{self.key_prefix}v:{version}:manifest"

    def _current_version_key(self) -> str:
        return f"{self.key_prefix}current-version"

    @staticmethod
    def _normalize_signal(value: str) -> str:
        normalized = " ".join(value.casefold().strip().split())
        return normalized if len(normalized) <= _MAX_SIGNAL_CHARS else ""

    @staticmethod
    def _enum_value(value: object) -> str:
        raw_value = getattr(value, "value", value)
        return str(raw_value).casefold()

    @staticmethod
    def _utc(value: datetime) -> datetime:
        if value.tzinfo is None:
            return value.replace(tzinfo=UTC)
        return value.astimezone(UTC)

    @staticmethod
    def _as_text(value: object) -> str | None:
        if isinstance(value, bytes):
            return value.decode("utf-8")
        return value if isinstance(value, str) else None

    @staticmethod
    def _validate_version(version: str) -> None:
        if not _SAFE_VERSION.fullmatch(version):
            raise ValueError("trend index version contains unsupported characters")
