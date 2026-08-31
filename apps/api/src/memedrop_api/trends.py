from __future__ import annotations

import hashlib
import json
import math
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Annotated, Self
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from uuid import UUID, uuid5

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, StringConstraints, model_validator

_TREND_NAMESPACE = UUID("3b0f42e1-b1f5-4df4-bc72-72ef47d2fcf9")
_OBSERVATION_NAMESPACE = UUID("f3f03a29-cc0d-4da6-91d4-9d225a112c63")
_TRACKING_QUERY_KEYS = {
    "dclid",
    "fbclid",
    "gclid",
    "igshid",
    "mc_cid",
    "mc_eid",
    "msclkid",
}

TrendKey = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=160,
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
    ),
]
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=160)]
CueText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=240)]
HashText = Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]


class TrendModel(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


class TrendLifecycle(StrEnum):
    EMERGING = "emerging"
    RISING = "rising"
    ESTABLISHED = "established"
    COOLING = "cooling"
    DORMANT = "dormant"


class TrendDuration(StrEnum):
    FLASH = "flash"
    FAST = "fast"
    PERSISTENT = "persistent"
    RECURRING = "recurring"


class TrendEvidenceState(TrendModel):
    first_seen_at: AwareDatetime
    last_confirmed_at: AwareDatetime
    confidence: float = Field(ge=0, le=1)
    momentum: float = Field(ge=0, le=1)
    source_count: int = Field(ge=1)
    observation_count: int = Field(ge=1)
    recurrence_count: int = Field(default=0, ge=0)

    @model_validator(mode="after")
    def timestamps_and_counts_are_consistent(self) -> Self:
        if self.last_confirmed_at < self.first_seen_at:
            raise ValueError("last_confirmed_at must not precede first_seen_at")
        if self.source_count > self.observation_count:
            raise ValueError("source_count must not exceed observation_count")
        return self


class TrendAssessment(TrendModel):
    lifecycle: TrendLifecycle
    duration_class: TrendDuration
    vitality: float = Field(ge=0, le=1)
    half_life: timedelta
    expires_at: AwareDatetime


class TrendCard(TrendModel):
    """Normalized cultural context; raw search results never belong in this model."""

    id: UUID
    key: TrendKey
    name: ShortText
    premise: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=600)]
    aliases: tuple[ShortText, ...] = Field(default_factory=tuple, max_length=20)
    entities: tuple[ShortText, ...] = Field(default_factory=tuple, max_length=20)
    topics: tuple[ShortText, ...] = Field(default_factory=tuple, max_length=16)
    communities: tuple[ShortText, ...] = Field(default_factory=tuple, max_length=12)
    recognition_cues: tuple[CueText, ...] = Field(default_factory=tuple, max_length=8)
    comic_tensions: tuple[CueText, ...] = Field(default_factory=tuple, max_length=8)
    usage_guidance: Annotated[
        str, StringConstraints(strip_whitespace=True, min_length=1, max_length=500)
    ]
    avoid_guidance: tuple[CueText, ...] = Field(default_factory=tuple, max_length=8)
    lifecycle: TrendLifecycle
    duration_class: TrendDuration
    first_seen_at: AwareDatetime
    last_confirmed_at: AwareDatetime
    expires_at: AwareDatetime
    confidence: float = Field(ge=0, le=1)
    momentum: float = Field(ge=0, le=1)
    vitality: float = Field(ge=0, le=1)
    source_count: int = Field(ge=1)
    observation_count: int = Field(ge=1)
    recurrence_count: int = Field(default=0, ge=0)
    version: int = Field(default=1, ge=1)

    @model_validator(mode="after")
    def identity_timestamps_and_terms_are_consistent(self) -> Self:
        if self.id != trend_id_for_key(self.key):
            raise ValueError("id must be the deterministic UUID for key")
        if self.last_confirmed_at < self.first_seen_at:
            raise ValueError("last_confirmed_at must not precede first_seen_at")
        if self.expires_at <= self.last_confirmed_at:
            raise ValueError("expires_at must follow last_confirmed_at")
        if self.source_count > self.observation_count:
            raise ValueError("source_count must not exceed observation_count")
        for field_name in (
            "aliases",
            "entities",
            "topics",
            "communities",
            "recognition_cues",
            "comic_tensions",
            "avoid_guidance",
        ):
            values = getattr(self, field_name)
            normalized = [value.casefold() for value in values]
            if len(normalized) != len(set(normalized)):
                raise ValueError(f"{field_name} must not contain duplicates")
        return self


class TrendObservation(TrendModel):
    """Durable evidence metadata without Tavily bodies, snippets, or social-post text."""

    id: UUID
    trend_id: UUID
    observation_key: HashText
    provider: Annotated[
        str,
        StringConstraints(
            strip_whitespace=True,
            to_lower=True,
            min_length=1,
            max_length=40,
            pattern=r"^[a-z0-9_-]+$",
        ),
    ]
    source_url: Annotated[str, StringConstraints(min_length=8, max_length=2048)]
    source_url_hash: HashText
    source_domain: Annotated[
        str, StringConstraints(strip_whitespace=True, to_lower=True, min_length=1, max_length=255)
    ]
    content_hash: HashText
    observed_at: AwareDatetime
    published_at: AwareDatetime | None = None
    provider_score: float | None = Field(default=None, ge=0, le=1)
    provider_result_id: Annotated[
        str | None, StringConstraints(strip_whitespace=True, min_length=1, max_length=255)
    ] = None
    query_fingerprint: HashText | None = None

    @classmethod
    def from_evidence(
        cls,
        *,
        trend_id: UUID,
        provider: str,
        source_url: str,
        content_hash: str,
        observed_at: datetime,
        published_at: datetime | None = None,
        provider_score: float | None = None,
        provider_result_id: str | None = None,
        query_fingerprint: str | None = None,
    ) -> TrendObservation:
        canonical_url = canonicalize_evidence_url(source_url)
        normalized_provider = provider.strip().lower()
        observation_key = observation_identity(normalized_provider, canonical_url)
        return cls(
            id=uuid5(_OBSERVATION_NAMESPACE, f"{trend_id}:{observation_key}"),
            trend_id=trend_id,
            observation_key=observation_key,
            provider=normalized_provider,
            source_url=canonical_url,
            source_url_hash=_sha256(canonical_url),
            source_domain=urlsplit(canonical_url).hostname or "",
            content_hash=content_hash,
            observed_at=observed_at,
            published_at=published_at,
            provider_score=provider_score,
            provider_result_id=provider_result_id,
            query_fingerprint=query_fingerprint,
        )

    @model_validator(mode="after")
    def derived_identity_is_consistent(self) -> Self:
        canonical_url = canonicalize_evidence_url(self.source_url)
        if self.source_url != canonical_url:
            raise ValueError("source_url must be canonicalized")
        expected_key = observation_identity(self.provider, canonical_url)
        if self.observation_key != expected_key:
            raise ValueError("observation_key does not match provider and source_url")
        if self.id != uuid5(_OBSERVATION_NAMESPACE, f"{self.trend_id}:{expected_key}"):
            raise ValueError("id does not match trend_id and observation_key")
        if self.source_url_hash != _sha256(canonical_url):
            raise ValueError("source_url_hash does not match source_url")
        if self.source_domain != (urlsplit(canonical_url).hostname or ""):
            raise ValueError("source_domain does not match source_url")
        if self.published_at is not None and self.published_at > self.observed_at:
            raise ValueError("published_at must not follow observed_at")
        return self


class TrendSnapshot(TrendModel):
    version: int = Field(ge=1)
    schema_version: int = Field(default=1, ge=1)
    fingerprint: HashText
    cards: tuple[TrendCard, ...] = Field(max_length=1_000)
    created_at: AwareDatetime
    published_at: AwareDatetime | None = None

    @classmethod
    def create(
        cls,
        *,
        version: int,
        cards: tuple[TrendCard, ...],
        created_at: datetime,
        published_at: datetime | None = None,
        schema_version: int = 1,
    ) -> TrendSnapshot:
        return cls(
            version=version,
            schema_version=schema_version,
            fingerprint=trend_snapshot_fingerprint(cards, schema_version=schema_version),
            cards=cards,
            created_at=created_at,
            published_at=published_at,
        )

    @model_validator(mode="after")
    def snapshot_is_immutable_and_consistent(self) -> Self:
        if self.fingerprint != trend_snapshot_fingerprint(
            self.cards, schema_version=self.schema_version
        ):
            raise ValueError("fingerprint does not match snapshot cards")
        card_ids = [card.id for card in self.cards]
        if len(card_ids) != len(set(card_ids)):
            raise ValueError("snapshot cards must be unique")
        if self.published_at is not None and self.published_at < self.created_at:
            raise ValueError("published_at must not precede created_at")
        return self


_BASE_HALF_LIVES = {
    TrendDuration.FLASH: timedelta(hours=12),
    TrendDuration.FAST: timedelta(hours=36),
    TrendDuration.PERSISTENT: timedelta(days=7),
    TrendDuration.RECURRING: timedelta(days=14),
}
_ACTIVE_WINDOWS = {
    TrendDuration.FLASH: timedelta(hours=36),
    TrendDuration.FAST: timedelta(days=7),
    TrendDuration.PERSISTENT: timedelta(days=28),
    TrendDuration.RECURRING: timedelta(days=42),
}


def trend_id_for_key(key: str) -> UUID:
    normalized = key.strip().lower()
    return uuid5(_TREND_NAMESPACE, normalized)


def infer_trend_duration(state: TrendEvidenceState) -> TrendDuration:
    observed_span = state.last_confirmed_at - state.first_seen_at
    if state.recurrence_count >= 2 and observed_span >= timedelta(days=28):
        return TrendDuration.RECURRING
    if (
        observed_span >= timedelta(days=7)
        and state.observation_count >= 6
        and state.source_count >= 3
    ):
        return TrendDuration.PERSISTENT
    if observed_span >= timedelta(hours=18) and state.observation_count >= 2:
        return TrendDuration.FAST
    return TrendDuration.FLASH


def adaptive_half_life(state: TrendEvidenceState, duration: TrendDuration) -> timedelta:
    """Extend decay modestly only when repeated, independent evidence earns it."""

    source_bonus = min(0.24, 0.06 * max(0, state.source_count - 1))
    observation_bonus = min(0.16, 0.02 * max(0, state.observation_count - 1))
    recurrence_bonus = min(0.1, 0.05 * state.recurrence_count)
    factor = 1 + min(0.5, source_bonus + observation_bonus + recurrence_bonus)
    return _BASE_HALF_LIVES[duration] * factor


def assess_trend(state: TrendEvidenceState, *, as_of: datetime) -> TrendAssessment:
    if as_of.tzinfo is None or as_of.utcoffset() is None:
        raise ValueError("as_of must be timezone-aware")
    if as_of < state.first_seen_at:
        raise ValueError("as_of must not precede first_seen_at")

    duration = infer_trend_duration(state)
    half_life = adaptive_half_life(state, duration)
    expires_at = state.last_confirmed_at + _ACTIVE_WINDOWS[duration]
    age = max(timedelta(0), as_of - state.last_confirmed_at)
    decay = math.pow(0.5, age.total_seconds() / half_life.total_seconds())
    evidence_reliability = 0.6 + 0.4 * min(1, state.source_count / 4)
    signal = 0.55 * state.momentum + 0.45 * state.confidence
    vitality = max(0, min(1, signal * evidence_reliability * decay))

    if as_of >= expires_at or vitality < 0.08:
        lifecycle = TrendLifecycle.DORMANT
    elif age >= half_life or vitality < 0.3:
        lifecycle = TrendLifecycle.COOLING
    elif state.observation_count < 3 or state.source_count < 2:
        lifecycle = TrendLifecycle.EMERGING
    elif state.momentum >= 0.6 and age <= half_life / 2:
        lifecycle = TrendLifecycle.RISING
    else:
        lifecycle = TrendLifecycle.ESTABLISHED

    return TrendAssessment(
        lifecycle=lifecycle,
        duration_class=duration,
        vitality=round(vitality, 6),
        half_life=half_life,
        expires_at=expires_at,
    )


def canonicalize_evidence_url(value: str) -> str:
    parsed = urlsplit(value.strip())
    if parsed.scheme.lower() not in {"http", "https"} or not parsed.hostname:
        raise ValueError("source_url must be an absolute HTTP(S) URL")
    scheme = parsed.scheme.lower()
    hostname = parsed.hostname.lower()
    port = parsed.port
    netloc = hostname
    if port is not None and not (
        (scheme == "http" and port == 80) or (scheme == "https" and port == 443)
    ):
        netloc = f"{hostname}:{port}"
    query = urlencode(
        sorted(
            (key, item)
            for key, item in parse_qsl(parsed.query, keep_blank_values=True)
            if not key.lower().startswith("utm_") and key.lower() not in _TRACKING_QUERY_KEYS
        ),
        doseq=True,
    )
    path = parsed.path or "/"
    return urlunsplit((scheme, netloc, path, query, ""))


def observation_identity(provider: str, canonical_url: str) -> str:
    return _sha256(f"{provider.strip().lower()}\n{canonicalize_evidence_url(canonical_url)}")


def trend_snapshot_fingerprint(
    cards: tuple[TrendCard, ...], *, schema_version: int = 1
) -> str:
    payload = {
        "schema_version": schema_version,
        "cards": [
            card.model_dump(mode="json")
            for card in sorted(cards, key=lambda candidate: str(candidate.id))
        ],
    }
    encoded = json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return _sha256(encoded)


def utc_now() -> datetime:
    return datetime.now(UTC)


def _sha256(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()
