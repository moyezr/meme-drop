from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

import memedrop_api.app as app_module
import memedrop_api.cli as cli_module
from memedrop_api.config import Settings
from memedrop_api.services.trend_index import TrendRetrieval
from memedrop_api.services.trend_runtime import (
    TREND_QUERY_PROFILES,
    TrendRefreshConfigurationError,
    publish_serving_snapshot,
    scheduled_monthly_credit_estimate,
    serving_trend_cards,
    trend_index_document,
    trend_scan_id,
    validate_trend_refresh_settings,
)
from memedrop_api.trends import (
    TrendCard,
    TrendDuration,
    TrendLifecycle,
    TrendSnapshot,
    trend_id_for_key,
)


def make_card() -> TrendCard:
    now = datetime(2026, 8, 19, 12, tzinfo=UTC)
    return TrendCard(
        id=trend_id_for_key("eras-tour-surprise"),
        key="eras-tour-surprise",
        name="Eras Tour Surprise",
        premise="A surprise announcement reverses the audience's expectation.",
        aliases=("surprise song moment",),
        entities=("Taylor Swift",),
        topics=("music",),
        communities=("pop culture",),
        recognition_cues=("The Eras Tour surprise song reveal",),
        comic_tensions=("careful planning versus sudden surprise",),
        usage_guidance="Use when a late reveal changes the expected outcome.",
        avoid_guidance=("Avoid unrelated celebrity references.",),
        lifecycle=TrendLifecycle.RISING,
        duration_class=TrendDuration.FAST,
        first_seen_at=now - timedelta(days=2),
        last_confirmed_at=now,
        expires_at=now + timedelta(days=4),
        confidence=0.85,
        momentum=0.8,
        vitality=0.8,
        source_count=3,
        observation_count=4,
        recurrence_count=0,
        version=1,
    )


def configured_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "database_url": "postgresql://test:test@127.0.0.1:5432/test",
        "trends_enabled": True,
        "redis_url": "redis://127.0.0.1:6379/0",
        "tavily_api_key": "tavily-secret",
        "openrouter_api_key": "openrouter-secret",
        "_env_file": None,
    }
    values.update(overrides)
    return Settings(**values)


def test_trend_settings_are_optional_bounded_and_secret_repr_safe() -> None:
    defaults = Settings(  # type: ignore[call-arg]
        database_url="postgresql://localhost/memedrop", _env_file=None
    )
    configured = configured_settings()

    assert defaults.trends_enabled is False
    assert defaults.trend_monthly_credit_budget == 750
    assert defaults.openrouter_trend_model == "google/gemini-3.7-flash"
    assert defaults.trend_redis_url is None
    assert configured.trend_redis_url == "redis://127.0.0.1:6379/0"
    assert "tavily-secret" not in repr(configured)
    assert "openrouter-secret" not in repr(configured)


def test_curated_profile_schedule_stays_below_six_hundred_basic_credits() -> None:
    assert [profile.name for profile in TREND_QUERY_PROFILES] == [
        "pulse",
        "daily",
        "weekly",
    ]
    assert scheduled_monthly_credit_estimate() == pytest.approx(591.43, abs=0.01)
    assert scheduled_monthly_credit_estimate() < 600


def test_scan_identity_is_deterministic_for_each_utc_cadence_bucket() -> None:
    profile = TREND_QUERY_PROFILES[0]
    first = datetime(2026, 8, 19, 13, 59, tzinfo=UTC)

    assert trend_scan_id(profile, at=first) == "trend-pulse-20260819T120000Z"
    assert trend_scan_id(profile, at=first + timedelta(hours=3)) == ("trend-pulse-20260819T120000Z")
    assert trend_scan_id(profile, at=first + timedelta(hours=5)) == ("trend-pulse-20260819T180000Z")


def test_index_document_includes_exact_fields_and_tokens_from_multiword_cues() -> None:
    document = trend_index_document(make_card())

    assert document.entities == ("Taylor Swift",)
    assert document.categories == ("music", "pop culture")
    assert {"taylor", "swift", "eras", "tour", "surprise", "song", "reveal"} <= set(document.terms)
    assert len(document.terms) <= 8


def test_serving_snapshot_excludes_single_source_and_low_confidence_cards() -> None:
    strong = make_card()
    single_source = strong.model_copy(update={"source_count": 1, "observation_count": 1})
    low_confidence = strong.model_copy(update={"confidence": 0.54})

    assert serving_trend_cards((single_source, low_confidence, strong)) == (strong,)


async def test_sql_snapshot_is_not_marked_published_when_redis_pointer_fails() -> None:
    calls: list[str] = []
    staged = TrendSnapshot.create(
        version=7,
        cards=(make_card(),),
        created_at=datetime(2026, 8, 19, 12, tzinfo=UTC),
    )

    class Repository:
        async def stage_snapshot(self, cards: object, *, created_at: datetime) -> TrendSnapshot:
            calls.append("stage")
            return staged

        async def mark_snapshot_published(
            self, version: int, *, published_at: datetime
        ) -> TrendSnapshot:
            calls.append("mark")
            return staged.model_copy(update={"published_at": published_at})

    class FailingIndex:
        async def publish(self, version: str, documents: object) -> None:
            calls.append("redis")
            raise ConnectionError("Redis unavailable")

    with pytest.raises(ConnectionError, match="Redis unavailable"):
        await publish_serving_snapshot(
            Repository(),  # type: ignore[arg-type]
            FailingIndex(),  # type: ignore[arg-type]
            staged.cards,
            published_at=staged.created_at,
        )

    assert calls == ["stage", "redis"]


def test_refresh_configuration_fails_before_provider_work_with_named_settings() -> None:
    settings = Settings(  # type: ignore[call-arg]
        database_url="postgresql://localhost/memedrop", _env_file=None
    )

    with pytest.raises(TrendRefreshConfigurationError) as captured:
        validate_trend_refresh_settings(settings)

    message = str(captured.value)
    assert "MEMEDROP_TRENDS_ENABLED=true" in message
    assert "TAVILY_API_KEY" in message
    assert "OPENROUTER_API_KEY" in message
    assert "REDIS_URL" in message


def test_cli_reports_configuration_errors_clearly(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    settings = Settings(  # type: ignore[call-arg]
        database_url="postgresql://localhost/memedrop", _env_file=None
    )
    monkeypatch.setattr(cli_module, "Settings", lambda: settings)
    monkeypatch.setattr(sys, "argv", ["memedrop-trend-refresh"])

    with pytest.raises(SystemExit) as captured:
        cli_module.trend_refresh()

    assert captured.value.code == 2
    assert "TAVILY_API_KEY" in capsys.readouterr().err


async def test_app_injects_and_closes_only_the_configured_redis_trend_retriever(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    created: list[Any] = []

    class FakeTrendIndex:
        def __init__(self, redis_url: str) -> None:
            self.redis_url = redis_url
            self.closed = False
            created.append(self)

        async def retrieve(self, signals: object) -> TrendRetrieval:
            return TrendRetrieval.empty()

        async def close(self) -> None:
            self.closed = True

    monkeypatch.setattr(app_module, "RedisTrendIndex", FakeTrendIndex)
    app = app_module.create_app(configured_settings())

    assert len(created) == 1
    assert app.state.trend_index is created[0]
    assert app.state.suggestion_service.trend_retriever is created[0]
    async with app.router.lifespan_context(app):
        assert created[0].closed is False
    assert created[0].closed is True


def test_app_does_not_construct_a_trend_retriever_when_feature_is_disabled(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class UnexpectedTrendIndex:
        def __init__(self, redis_url: str) -> None:
            raise AssertionError(f"unexpected trend index for {redis_url}")

    monkeypatch.setattr(app_module, "RedisTrendIndex", UnexpectedTrendIndex)
    settings = configured_settings(trends_enabled=False)
    app = app_module.create_app(settings)

    assert app.state.trend_index is None
    assert app.state.suggestion_service.trend_retriever is None
