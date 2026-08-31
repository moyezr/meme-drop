from __future__ import annotations

import asyncio
from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

from memedrop_api.services.trend_index import (
    RedisTrendIndex,
    TrendIndexDocument,
    TrendQuerySignal,
)
from memedrop_api.trends import (
    TrendCard,
    TrendDuration,
    TrendEvidenceState,
    TrendLifecycle,
    adaptive_half_life,
    assess_trend,
    trend_id_for_key,
)


class MemoryPipeline:
    def __init__(self, client: MemoryRedis, *, transaction: bool) -> None:
        self.client = client
        self.transaction = transaction
        self.commands: list[tuple[str, tuple[Any, ...], dict[str, Any]]] = []

    def set(self, *args: Any, **kwargs: Any) -> MemoryPipeline:
        self.commands.append(("set", args, kwargs))
        return self

    def zadd(self, *args: Any, **kwargs: Any) -> MemoryPipeline:
        self.commands.append(("zadd", args, kwargs))
        return self

    def expire(self, *args: Any, **kwargs: Any) -> MemoryPipeline:
        self.commands.append(("expire", args, kwargs))
        return self

    def zrevrange(self, *args: Any, **kwargs: Any) -> MemoryPipeline:
        self.commands.append(("zrevrange", args, kwargs))
        return self

    async def execute(self) -> list[Any]:
        results: list[Any] = []
        fail_after = self.client.fail_next_transaction_after if self.transaction else None
        self.client.fail_next_transaction_after = None
        for index, (name, args, kwargs) in enumerate(self.commands):
            if fail_after is not None and index >= fail_after:
                raise RuntimeError("simulated interrupted namespace build")
            results.append(self.client.apply(name, *args, **kwargs))
        return results


class MemoryRedis:
    def __init__(self) -> None:
        self.strings: dict[str, str] = {}
        self.sorted_sets: dict[str, dict[str, float]] = {}
        self.expirations: dict[str, int] = {}
        self.operations: list[tuple[str, str]] = []
        self.fail_next_transaction_after: int | None = None
        self.last_mget_size = 0
        self.zrevrange_calls = 0

    async def get(self, key: str) -> str | None:
        self.operations.append(("get", key))
        return self.strings.get(key)

    async def set(self, key: str, value: str, **_: Any) -> bool:
        self.apply("set", key, value)
        return True

    async def mget(self, keys: list[str]) -> list[str | None]:
        self.last_mget_size = len(keys)
        self.operations.append(("mget", str(len(keys))))
        return [self.strings.get(key) for key in keys]

    def pipeline(self, *, transaction: bool) -> MemoryPipeline:
        return MemoryPipeline(self, transaction=transaction)

    def apply(self, name: str, *args: Any, **kwargs: Any) -> Any:
        key = str(args[0])
        self.operations.append((name, key))
        if name == "set":
            self.strings[key] = str(args[1])
            if expiration := kwargs.get("ex"):
                self.expirations[key] = int(expiration)
            return True
        if name == "zadd":
            members = self.sorted_sets.setdefault(key, {})
            members.update({str(member): float(score) for member, score in args[1].items()})
            return len(args[1])
        if name == "expire":
            self.expirations[key] = int(args[1])
            return True
        if name == "zrevrange":
            self.zrevrange_calls += 1
            start, end = int(args[1]), int(args[2])
            ranked = sorted(
                self.sorted_sets.get(key, {}).items(),
                key=lambda item: (-item[1], item[0]),
            )
            selected = ranked[start : end + 1]
            return selected if kwargs.get("withscores") else [member for member, _ in selected]
        raise AssertionError(f"unsupported fake Redis operation: {name}")


class SlowRedis(MemoryRedis):
    async def get(self, key: str) -> str | None:
        await asyncio.sleep(1)
        return await super().get(key)


NOW = datetime(2026, 8, 19, 12, tzinfo=UTC)


def make_card(
    key: str,
    *,
    lifecycle: TrendLifecycle = TrendLifecycle.RISING,
    duration_class: TrendDuration = TrendDuration.FAST,
    last_confirmed_at: datetime = NOW,
    expires_at: datetime | None = None,
    confidence: float = 0.8,
    momentum: float = 0.8,
) -> TrendCard:
    return TrendCard(
        id=trend_id_for_key(key),
        key=key,
        name=key.replace("-", " ").title(),
        premise=f"Cultural premise for {key}.",
        aliases=(key.replace("-", " "),),
        entities=("Acme",),
        topics=("technology",),
        communities=("developers",),
        recognition_cues=("recognizable cue",),
        comic_tensions=("expectation versus reality",),
        usage_guidance="Use only when the post naturally matches.",
        avoid_guidance=("Do not force the reference.",),
        lifecycle=lifecycle,
        duration_class=duration_class,
        first_seen_at=min(NOW - timedelta(days=7), last_confirmed_at),
        last_confirmed_at=last_confirmed_at,
        expires_at=expires_at or NOW + timedelta(days=3),
        confidence=confidence,
        momentum=momentum,
        vitality=0.8,
        source_count=3,
        observation_count=4,
        recurrence_count=0,
        version=1,
    )


def make_index(client: MemoryRedis, **overrides: Any) -> RedisTrendIndex:
    options: dict[str, Any] = {
        "client": client,
        "clock": lambda: NOW,
        "active_ttl_seconds": 10_000,
        "old_version_grace_seconds": 300,
    }
    options.update(overrides)
    return RedisTrendIndex("redis://unused", **options)


async def test_publish_hides_interrupted_namespace_and_hashes_signal_keys() -> None:
    client = MemoryRedis()
    index = make_index(client)
    old_card = make_card("old-trend")
    old_document = TrendIndexDocument(
        card=old_card,
        terms=("Taylor Swift surprise",),
        entities=("Taylor Swift",),
    )
    await index.publish("v1", [old_document])

    assert client.strings["memedrop:trend-index:{serving}:current-version"] == "v1"
    assert all("taylor" not in key.casefold() for key in client.sorted_sets)

    client.fail_next_transaction_after = 1
    with pytest.raises(RuntimeError, match="interrupted namespace build"):
        await index.publish(
            "v2",
            [TrendIndexDocument(card=make_card("new-trend"), entities=("Acme",))],
        )

    assert client.strings["memedrop:trend-index:{serving}:current-version"] == "v1"
    result = await index.retrieve([TrendQuerySignal(kind="entity", value="Taylor Swift")])
    assert result.version == "v1"
    assert result.cards == (old_card,)


async def test_publish_switches_versions_and_gives_old_namespace_a_grace_ttl() -> None:
    client = MemoryRedis()
    index = make_index(client, max_postings_per_signal=2)
    old_card = make_card("old-trend")
    await index.publish(
        "v1",
        [TrendIndexDocument(card=old_card, categories=("culture",))],
    )
    old_namespace_keys = {key for key in (*client.strings, *client.sorted_sets) if ":v:v1:" in key}

    documents = [
        TrendIndexDocument(
            card=make_card(f"new-trend-{index_number}"),
            categories=("culture",),
        )
        for index_number in range(3)
    ]
    await index.publish("v2", documents)

    assert client.strings["memedrop:trend-index:{serving}:current-version"] == "v2"
    assert old_namespace_keys
    assert all(client.expirations[key] == 300 for key in old_namespace_keys)
    assert client.operations[-1] == (
        "set",
        "memedrop:trend-index:{serving}:current-version",
    )
    v2_postings = [members for key, members in client.sorted_sets.items() if ":v:v2:" in key]
    assert len(v2_postings) == 1
    assert len(v2_postings[0]) == 2


async def test_retrieve_bounds_work_and_reranks_fresh_active_cards() -> None:
    client = MemoryRedis()
    index = make_index(client, minimum_score=0)
    documents = [
        TrendIndexDocument(
            card=make_card(
                f"trend-{number:02d}",
                confidence=0.65 + number / 100,
                momentum=0.65 + number / 100,
            ),
            entities=("Acme",),
            terms=(f"term-{number}",),
        )
        for number in range(25)
    ]
    fresh = make_card("fresh-best", confidence=1, momentum=1)
    cooling = make_card(
        "cooling-old",
        lifecycle=TrendLifecycle.COOLING,
        last_confirmed_at=NOW - timedelta(days=4),
        confidence=1,
        momentum=1,
    )
    dormant = make_card(
        "dormant",
        lifecycle=TrendLifecycle.DORMANT,
        confidence=1,
        momentum=1,
    )
    expired = make_card(
        "expired",
        last_confirmed_at=NOW - timedelta(days=1),
        expires_at=NOW - timedelta(seconds=1),
    )
    documents.extend(
        TrendIndexDocument(card=card, entities=("Acme",))
        for card in (fresh, cooling, dormant, expired)
    )
    await index.publish("v1", documents)

    signals = [TrendQuerySignal(kind="entity", value="Acme")]
    signals.extend(
        TrendQuerySignal(kind="term", value=f"unmatched-{number}") for number in range(20)
    )
    result = await index.retrieve(signals)

    assert len(result.cards) == 2
    assert result.cards[0].id == fresh.id
    assert all(
        card.lifecycle != TrendLifecycle.DORMANT and card.expires_at > NOW for card in result.cards
    )
    assert client.zrevrange_calls == 12
    assert client.last_mget_size <= 20


async def test_retrieve_fails_open_within_its_timeout() -> None:
    index = make_index(SlowRedis(), timeout_seconds=0.001)

    result = await index.retrieve([TrendQuerySignal(kind="entity", value="private post text")])

    assert result.version is None
    assert result.cards == ()


async def test_retrieve_discards_oversized_query_signals_before_redis_lookup() -> None:
    client = MemoryRedis()
    index = make_index(client)
    await index.publish(
        "v1",
        [TrendIndexDocument(card=make_card("bounded"), terms=("bounded",))],
    )

    result = await index.retrieve(
        [TrendQuerySignal(kind="term", value="x" * 241)]
    )

    assert result.version == "v1"
    assert result.cards == ()
    assert client.zrevrange_calls == 0


async def test_retrieve_requires_a_minimum_relevance_score() -> None:
    client = MemoryRedis()
    index = make_index(client)
    await index.publish(
        "v1",
        [TrendIndexDocument(card=make_card("bounded"), terms=("match",))],
    )

    weak = await index.retrieve(
        [TrendQuerySignal(kind="term", value="match")]
        + [TrendQuerySignal(kind="term", value=f"miss-{number}") for number in range(9)]
    )
    strong = await index.retrieve([TrendQuerySignal(kind="term", value="match")])

    assert weak.cards == ()
    assert [card.key for card in strong.cards] == ["bounded"]


def test_rerank_uses_canonical_adaptive_decay_and_current_lifecycle() -> None:
    index = make_index(MemoryRedis())
    card = make_card(
        "aged-fast-trend",
        lifecycle=TrendLifecycle.RISING,
        duration_class=TrendDuration.FAST,
        last_confirmed_at=NOW - timedelta(days=3),
        confidence=1,
        momentum=1,
    )
    state = TrendEvidenceState(
        first_seen_at=card.first_seen_at,
        last_confirmed_at=card.last_confirmed_at,
        confidence=card.confidence,
        momentum=card.momentum,
        source_count=card.source_count,
        observation_count=card.observation_count,
        recurrence_count=card.recurrence_count,
    )

    assessment = assess_trend(state, as_of=NOW)
    assert assessment.lifecycle == TrendLifecycle.COOLING
    age = (NOW - card.last_confirmed_at).total_seconds()
    half_life = adaptive_half_life(state, card.duration_class).total_seconds()
    canonical_freshness = 2 ** (-age / half_life)

    score = index._rerank_score(card, retrieval_score=1, now=NOW)

    assert score == pytest.approx(0.55 + 0.15 * canonical_freshness + 0.13 + 0.1 + 0.07 * 0.3)


@pytest.mark.parametrize("version", ["", "../v2", "v2:unsafe", "x" * 65])
async def test_publish_rejects_unsafe_versions(version: str) -> None:
    index = make_index(MemoryRedis())
    document = TrendIndexDocument(card=make_card("safe"), entities=("Acme",))

    with pytest.raises(ValueError, match="unsupported"):
        await index.publish(version, [document])


def test_constructor_enforces_request_time_bounds() -> None:
    builders: tuple[Callable[[], RedisTrendIndex], ...] = (
        lambda: make_index(MemoryRedis(), max_query_signals=13),
        lambda: make_index(MemoryRedis(), max_candidates=21),
        lambda: make_index(MemoryRedis(), max_results=3),
    )

    for build in builders:
        with pytest.raises(ValueError):
            build()


async def test_publish_enforces_card_and_distinct_signal_bounds() -> None:
    card_limited = make_index(MemoryRedis(), max_cards=1)
    with pytest.raises(ValueError, match="limited to 1 cards"):
        await card_limited.publish(
            "v1",
            [
                TrendIndexDocument(card=make_card("one"), entities=("one",)),
                TrendIndexDocument(card=make_card("two"), entities=("two",)),
            ],
        )

    signal_limited = make_index(MemoryRedis(), max_index_keys=1)
    with pytest.raises(ValueError, match="limited to 1 signal keys"):
        await signal_limited.publish(
            "v1",
            [
                TrendIndexDocument(
                    card=make_card("one"),
                    entities=("one", "two"),
                )
            ],
        )
