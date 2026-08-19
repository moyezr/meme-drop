from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from pydantic import ValidationError

from memedrop_api.trends import (
    TrendCard,
    TrendDuration,
    TrendEvidenceState,
    TrendLifecycle,
    TrendObservation,
    TrendSnapshot,
    adaptive_half_life,
    assess_trend,
    canonicalize_evidence_url,
    infer_trend_duration,
    trend_id_for_key,
)

NOW = datetime(2026, 8, 19, 12, tzinfo=UTC)
HASH = "a" * 64


def test_fresh_single_source_trend_is_emerging_then_decays_deterministically() -> None:
    state = TrendEvidenceState(
        first_seen_at=NOW,
        last_confirmed_at=NOW,
        confidence=0.8,
        momentum=0.9,
        source_count=1,
        observation_count=1,
    )

    fresh = assess_trend(state, as_of=NOW)
    cooling = assess_trend(state, as_of=NOW + timedelta(hours=13))
    expired = assess_trend(state, as_of=NOW + timedelta(hours=36))

    assert fresh.duration_class is TrendDuration.FLASH
    assert fresh.lifecycle is TrendLifecycle.EMERGING
    assert fresh.half_life == timedelta(hours=12)
    assert fresh.expires_at == NOW + timedelta(hours=36)
    assert cooling.lifecycle is TrendLifecycle.COOLING
    assert cooling.vitality < fresh.vitality
    assert expired.lifecycle is TrendLifecycle.DORMANT


@pytest.mark.parametrize(
    ("span", "sources", "observations", "recurrences", "expected"),
    [
        (timedelta(hours=17), 1, 1, 0, TrendDuration.FLASH),
        (timedelta(hours=18), 2, 2, 0, TrendDuration.FAST),
        (timedelta(days=7), 3, 6, 0, TrendDuration.PERSISTENT),
        (timedelta(days=28), 4, 8, 2, TrendDuration.RECURRING),
    ],
)
def test_duration_is_earned_from_observed_recurrence(
    span: timedelta,
    sources: int,
    observations: int,
    recurrences: int,
    expected: TrendDuration,
) -> None:
    state = TrendEvidenceState(
        first_seen_at=NOW - span,
        last_confirmed_at=NOW,
        confidence=0.8,
        momentum=0.7,
        source_count=sources,
        observation_count=observations,
        recurrence_count=recurrences,
    )
    assert infer_trend_duration(state) is expected


def test_independent_evidence_earns_a_longer_half_life_and_rising_state() -> None:
    sparse = TrendEvidenceState(
        first_seen_at=NOW - timedelta(days=2),
        last_confirmed_at=NOW,
        confidence=0.8,
        momentum=0.8,
        source_count=1,
        observation_count=2,
    )
    corroborated = sparse.model_copy(update={"source_count": 3, "observation_count": 4})

    assert adaptive_half_life(
        corroborated, TrendDuration.FAST
    ) > adaptive_half_life(sparse, TrendDuration.FAST)
    assert assess_trend(corroborated, as_of=NOW).lifecycle is TrendLifecycle.RISING


def test_assessment_requires_an_injected_aware_clock() -> None:
    state = TrendEvidenceState(
        first_seen_at=NOW,
        last_confirmed_at=NOW,
        confidence=0.5,
        momentum=0.5,
        source_count=1,
        observation_count=1,
    )
    with pytest.raises(ValueError, match="timezone-aware"):
        assess_trend(state, as_of=datetime(2026, 8, 19, 12))
    with pytest.raises(ValueError, match="must not precede"):
        assess_trend(state, as_of=NOW - timedelta(seconds=1))


def test_observation_identity_is_idempotent_and_removes_tracking_parameters() -> None:
    trend_id = trend_id_for_key("airport-tray-aesthetic")
    first = TrendObservation.from_evidence(
        trend_id=trend_id,
        provider="TAVILY",
        source_url="https://Example.com:443/story?utm_source=feed&b=2&a=1#comments",
        content_hash=HASH,
        observed_at=NOW,
        published_at=NOW - timedelta(hours=1),
        provider_score=0.91,
        query_fingerprint="b" * 64,
    )
    replay = TrendObservation.from_evidence(
        trend_id=trend_id,
        provider="tavily",
        source_url="https://example.com/story?a=1&b=2",
        content_hash=HASH,
        observed_at=NOW,
    )

    assert first.source_url == "https://example.com/story?a=1&b=2"
    assert first.source_domain == "example.com"
    assert first.id == replay.id
    assert first.observation_key == replay.observation_key


def test_observation_schema_cannot_accept_raw_provider_content() -> None:
    observation = TrendObservation.from_evidence(
        trend_id=trend_id_for_key("example-trend"),
        provider="tavily",
        source_url="https://example.com/trend",
        content_hash=HASH,
        observed_at=NOW,
    )
    with pytest.raises(ValidationError, match="Extra inputs are not permitted"):
        TrendObservation.model_validate(
            {**observation.model_dump(), "raw_content": "untrusted scraped body"}
        )


def test_canonical_url_rejects_non_http_sources() -> None:
    with pytest.raises(ValueError, match=r"HTTP\(S\)"):
        canonicalize_evidence_url("file:///tmp/result.txt")


def test_snapshot_fingerprint_is_order_independent_and_detects_tampering() -> None:
    first = _card("first-trend", name="First trend")
    second = _card("second-trend", name="Second trend")
    snapshot = TrendSnapshot.create(
        version=1,
        cards=(first, second),
        created_at=NOW,
        published_at=NOW,
    )
    reordered = TrendSnapshot.create(
        version=1,
        cards=(second, first),
        created_at=NOW,
        published_at=NOW,
    )
    assert snapshot.fingerprint == reordered.fingerprint

    with pytest.raises(ValidationError, match="fingerprint does not match"):
        TrendSnapshot.model_validate(
            {**snapshot.model_dump(), "fingerprint": "0" * 64}
        )


def test_card_identity_and_bounded_terms_are_validated() -> None:
    card = _card("quiet-quitting", name="Quiet quitting")
    with pytest.raises(ValidationError, match="deterministic UUID"):
        TrendCard.model_validate({**card.model_dump(), "id": trend_id_for_key("other")})
    with pytest.raises(ValidationError, match="must not contain duplicates"):
        TrendCard.model_validate({**card.model_dump(), "topics": ["work", "WORK"]})


def _card(key: str, *, name: str) -> TrendCard:
    return TrendCard(
        id=trend_id_for_key(key),
        key=key,
        name=name,
        premise="A recognizable online behavior with a clear social meaning.",
        aliases=(),
        entities=(name,),
        topics=("internet culture",),
        communities=("social media",),
        recognition_cues=("A recognizable cue",),
        comic_tensions=("expectation versus reality",),
        usage_guidance="Use only when the post naturally shares the same tension.",
        avoid_guidance=("Do not force the reference.",),
        lifecycle=TrendLifecycle.RISING,
        duration_class=TrendDuration.FAST,
        first_seen_at=NOW - timedelta(days=2),
        last_confirmed_at=NOW,
        expires_at=NOW + timedelta(days=7),
        confidence=0.8,
        momentum=0.75,
        vitality=0.72,
        source_count=3,
        observation_count=4,
    )
