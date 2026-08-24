from __future__ import annotations

import sys
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest

import memedrop_api.app as app_module
import memedrop_api.cli as cli_module
from memedrop_api.config import Settings
from memedrop_api.services.hybrid_trend_retrieval import HybridTrendRetriever
from memedrop_api.services.tavily_trends import TavilyUsage, TrendCollectionReport
from memedrop_api.services.trend_embeddings import TrendEmbeddingError
from memedrop_api.services.trend_index import TrendRetrieval
from memedrop_api.services.trend_runtime import (
    TREND_QUERY_PROFILES,
    TrendRefreshConfigurationError,
    TrendRefreshFailed,
    publish_serving_snapshot,
    refresh_trends,
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
    assert defaults.trend_monthly_credit_budget == 900
    assert defaults.openrouter_trend_model == "google/gemini-3.7-flash"
    assert defaults.openrouter_embedding_model == "google/gemini-embedding-2"
    assert defaults.trend_embedding_batch_size == 32
    assert defaults.trend_redis_url is None
    assert configured.trend_redis_url == "redis://127.0.0.1:6379/0"
    assert "tavily-secret" not in repr(configured)
    assert "openrouter-secret" not in repr(configured)


def test_curated_profile_schedule_leaves_retry_headroom_under_the_nine_hundred_credit_ceiling() -> (
    None
):
    assert [profile.name for profile in TREND_QUERY_PROFILES] == [
        "pulse",
        "daily",
        "weekly",
    ]
    assert scheduled_monthly_credit_estimate() == pytest.approx(771.43, abs=0.01)
    assert scheduled_monthly_credit_estimate() < 900


def test_scan_identity_is_deterministic_for_each_utc_cadence_bucket() -> None:
    profile = TREND_QUERY_PROFILES[0]
    first = datetime(2026, 8, 19, 13, 59, tzinfo=UTC)

    assert trend_scan_id(profile, at=first) == "trend-pulse-20260819T120000Z"
    assert trend_scan_id(profile, at=first + timedelta(hours=2)) == ("trend-pulse-20260819T120000Z")
    assert trend_scan_id(profile, at=first + timedelta(hours=3)) == ("trend-pulse-20260819T160000Z")


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


def test_cli_returns_nonzero_when_all_claimed_queries_fail(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    async def fail_refresh(*args: object, **kwargs: object) -> object:
        raise TrendRefreshFailed(
            "trend refresh had no successful provider queries; preserving the last "
            "published snapshot (tavily_auth)"
        )

    monkeypatch.setattr(cli_module, "Settings", lambda: configured_settings())
    monkeypatch.setattr("memedrop_api.services.trend_runtime.refresh_trends", fail_refresh)
    monkeypatch.setattr(sys, "argv", ["memedrop-trend-refresh", "--profile", "pulse"])

    with pytest.raises(SystemExit) as captured:
        cli_module.trend_refresh()

    assert captured.value.code == 2
    assert "tavily_auth" in capsys.readouterr().err


async def test_refresh_keeps_the_last_snapshot_when_every_claimed_query_fails(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []
    failed_collection = TrendCollectionReport(
        requested_queries=3,
        claimed_queries=3,
        skipped_queries=0,
        completed_queries=0,
        failed_queries=3,
        local_credit_reservations=3,
        provider_search_credits=0,
        evidence_discovered=0,
        cards_upserted=0,
        observations_stored=0,
        budget_exhausted=False,
        failure_categories={"tavily_auth": 3},
    )

    class FakeDatabase:
        def __init__(self, database_url: str) -> None:
            calls.append("database")

        async def close(self) -> None:
            calls.append("database-close")

    class FakeCollector:
        def __init__(self, **values: object) -> None:
            calls.append("collector")

        async def preflight(self) -> TavilyUsage:
            calls.append("preflight")
            return TavilyUsage(
                key_usage=0,
                key_limit=None,
                key_search_usage=0,
                account_plan_usage=0,
                account_plan_limit=1_000,
            )

        async def collect(self, **values: object) -> TrendCollectionReport:
            calls.append("collect")
            return failed_collection

        async def close(self) -> None:
            calls.append("collector-close")

    class FakeEnricher:
        def __init__(self, **values: object) -> None:
            calls.append("enricher")

        async def close(self) -> None:
            calls.append("enricher-close")

    class FakeIndex:
        def __init__(self, redis_url: str) -> None:
            calls.append("index")

        async def close(self) -> None:
            calls.append("index-close")

    class UnexpectedRepository:
        def __init__(self, database: object) -> None:
            calls.append("repository")

        async def list_active_cards(self, **values: object) -> object:
            raise AssertionError("failed refresh must not read or publish a replacement snapshot")

    monkeypatch.setattr("memedrop_api.services.trend_runtime.Database", FakeDatabase)
    monkeypatch.setattr(
        "memedrop_api.services.trend_runtime.SqlAlchemyTrendCollectionStore",
        lambda database: object(),
    )
    monkeypatch.setattr(
        "memedrop_api.services.trend_runtime.SqlAlchemyTrendRepository", UnexpectedRepository
    )
    monkeypatch.setattr("memedrop_api.services.trend_runtime.TavilyTrendCollector", FakeCollector)
    monkeypatch.setattr("memedrop_api.services.trend_runtime.OpenRouterTrendEnricher", FakeEnricher)
    monkeypatch.setattr("memedrop_api.services.trend_runtime.RedisTrendIndex", FakeIndex)

    with pytest.raises(TrendRefreshFailed, match="tavily_auth"):
        await refresh_trends(
            configured_settings(),
            profile_names=("pulse",),
            at=datetime(2026, 8, 19, 12, tzinfo=UTC),
        )

    assert calls == [
        "database",
        "repository",
        "enricher",
        "collector",
        "index",
        "preflight",
        "collect",
        "collector-close",
        "enricher-close",
        "index-close",
        "database-close",
    ]


async def test_embedding_failure_preserves_the_published_snapshot(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[str] = []
    successful_collection = TrendCollectionReport(
        requested_queries=1,
        claimed_queries=1,
        skipped_queries=0,
        completed_queries=1,
        failed_queries=0,
        local_credit_reservations=1,
        provider_search_credits=1,
        evidence_discovered=1,
        cards_upserted=1,
        observations_stored=1,
        budget_exhausted=False,
        failure_categories={},
    )
    card = make_card()

    class FakeDatabase:
        def __init__(self, database_url: str) -> None:
            calls.append("database")

        async def close(self) -> None:
            calls.append("database-close")

    class FakeCollector:
        def __init__(self, **values: object) -> None:
            calls.append("collector")

        async def preflight(self) -> TavilyUsage:
            return TavilyUsage(
                key_usage=1,
                key_limit=None,
                key_search_usage=1,
                account_plan_usage=1,
                account_plan_limit=1_000,
            )

        async def collect(self, **values: object) -> TrendCollectionReport:
            return successful_collection

        async def close(self) -> None:
            calls.append("collector-close")

    class FakeEnricher:
        def __init__(self, **values: object) -> None:
            calls.append("enricher")

        async def close(self) -> None:
            calls.append("enricher-close")

    class FakeRepository:
        def __init__(self, database: object) -> None:
            calls.append("repository")

        async def list_active_cards(self, **values: object) -> list[TrendCard]:
            return [card]

        async def list_stale_embedding_ids(
            self, fingerprints: object, *, model: str
        ) -> set[object]:
            return {card.id}

        async def store_card_embeddings(
            self, embeddings: object, *, model: str
        ) -> int:
            raise AssertionError("failed provider response must not persist an embedding")

        async def stage_snapshot(self, cards: object, *, created_at: datetime) -> TrendSnapshot:
            raise AssertionError("embedding failure must not stage a replacement snapshot")

    class FailingEmbedder:
        def __init__(self, **values: object) -> None:
            calls.append("embedder")

        async def embed_cards(self, cards: object) -> list[list[float]]:
            raise TrendEmbeddingError("openrouter_embedding_unavailable")

        async def close(self) -> None:
            calls.append("embedder-close")

    class FakeIndex:
        def __init__(self, redis_url: str) -> None:
            calls.append("index")

        async def close(self) -> None:
            calls.append("index-close")

    monkeypatch.setattr("memedrop_api.services.trend_runtime.Database", FakeDatabase)
    monkeypatch.setattr(
        "memedrop_api.services.trend_runtime.SqlAlchemyTrendCollectionStore",
        lambda database: object(),
    )
    monkeypatch.setattr(
        "memedrop_api.services.trend_runtime.SqlAlchemyTrendRepository", FakeRepository
    )
    monkeypatch.setattr("memedrop_api.services.trend_runtime.TavilyTrendCollector", FakeCollector)
    monkeypatch.setattr("memedrop_api.services.trend_runtime.OpenRouterTrendEnricher", FakeEnricher)
    monkeypatch.setattr(
        "memedrop_api.services.trend_runtime.OpenRouterTrendEmbedder", FailingEmbedder
    )
    monkeypatch.setattr("memedrop_api.services.trend_runtime.RedisTrendIndex", FakeIndex)

    with pytest.raises(TrendRefreshFailed, match="openrouter_embedding_unavailable"):
        await refresh_trends(
            configured_settings(),
            profile_names=("pulse",),
            at=datetime(2026, 8, 19, 12, tzinfo=UTC),
        )

    assert "embedder-close" in calls
    assert "index-close" in calls
    assert "database-close" in calls


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
    index: FakeTrendIndex = created[0]
    assert app.state.trend_index is index
    hybrid = app.state.suggestion_service.trend_retriever
    assert isinstance(hybrid, HybridTrendRetriever)
    assert hybrid.lexical_retriever is index
    async with app.router.lifespan_context(app):
        assert index.closed is False
    assert index.closed is True


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
