from __future__ import annotations

from collections.abc import Callable
from inspect import isawaitable
from typing import Any

import pytest
from fastapi import FastAPI
from fastapi.routing import APIRoute

import memedrop_api.services.trend_workflow as workflow_module
from memedrop_api.config import Settings
from memedrop_api.services.tavily_trends import TavilyUsage, TrendCollectionReport
from memedrop_api.services.trend_runtime import (
    TREND_QUERY_PROFILES,
    ProfileRefreshReport,
    TrendRefreshReport,
)
from memedrop_api.services.trend_workflow import (
    TREND_WORKFLOW_PATH,
    register_trend_refresh_workflow,
    run_trend_refresh_workflow,
)


def workflow_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "database_url": "postgresql://test:test@127.0.0.1:5432/test",
        "api_public_origin": "https://api.example.com",
        "trends_enabled": True,
        "redis_url": "redis://127.0.0.1:6379/0",
        "tavily_api_key": "tavily-secret",
        "openrouter_api_key": "openrouter-secret",
        "qstash_url": "https://qstash.upstash.io",
        "qstash_token": "qstash-token",
        "qstash_current_signing_key": "current-signing-key",
        "qstash_next_signing_key": "next-signing-key",
        "trend_embedding_batch_size": 2,
        "_env_file": None,
    }
    values.update(overrides)
    return Settings(**values)


def successful_collection() -> TrendCollectionReport:
    return TrendCollectionReport(
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


class ImmediateWorkflowContext:
    workflow_run_id = "wfr_test"

    def __init__(self) -> None:
        self.steps: list[str] = []

    async def run(self, step_name: str, step_function: Callable[[], Any]) -> Any:
        self.steps.append(step_name)
        result = step_function()
        return await result if isawaitable(result) else result


async def test_workflow_runs_each_query_and_embedding_batch_as_a_separate_step(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = workflow_settings()
    context = ImmediateWorkflowContext()
    usage = TavilyUsage(
        key_usage=1,
        key_limit=None,
        key_search_usage=1,
        account_plan_usage=1,
        account_plan_limit=900,
    )
    lock_acquisitions: list[str] = []
    releases: list[str] = []
    collected: list[tuple[str, str]] = []
    embedded: list[tuple[str, ...]] = []
    published_reports: list[ProfileRefreshReport] = []

    async def acquire(_: Settings, owner: str) -> bool:
        lock_acquisitions.append(owner)
        return True

    async def release(_: Settings, owner: str) -> bool:
        releases.append(owner)
        return True

    async def preflight(_: Settings) -> TavilyUsage:
        return usage

    async def collect(
        _: Settings,
        *,
        profile_name: str,
        query_key: str,
        observed_at: object,
    ) -> ProfileRefreshReport:
        collected.append((profile_name, query_key))
        return ProfileRefreshReport(
            profile=profile_name,
            scan_id=f"{profile_name}-scan",
            collection=successful_collection(),
        )

    async def plan(_: Settings, *, observed_at: object) -> tuple[str, ...]:
        return (
            "00000000-0000-0000-0000-000000000001",
            "00000000-0000-0000-0000-000000000002",
            "00000000-0000-0000-0000-000000000003",
        )

    async def embed(
        _: Settings,
        *,
        card_ids: tuple[str, ...],
        observed_at: object,
    ) -> int:
        embedded.append(card_ids)
        return len(card_ids)

    async def publish(
        _: Settings,
        *,
        reports: list[ProfileRefreshReport],
        observed_at: object,
        tavily_usage: TavilyUsage,
    ) -> TrendRefreshReport:
        published_reports.extend(reports)
        assert tavily_usage == usage
        return TrendRefreshReport(
            profiles=(),
            active_cards=3,
            snapshot_version=7,
            index_version="snapshot-v7",
            tavily_usage=usage,
        )

    monkeypatch.setattr(workflow_module, "_acquire_workflow_lock", acquire)
    monkeypatch.setattr(workflow_module, "_release_workflow_lock", release)
    monkeypatch.setattr(workflow_module, "preflight_trend_refresh", preflight)
    monkeypatch.setattr(workflow_module, "collect_trend_query", collect)
    monkeypatch.setattr(workflow_module, "list_stale_trend_embedding_ids", plan)
    monkeypatch.setattr(workflow_module, "embed_trend_card_batch", embed)
    monkeypatch.setattr(workflow_module, "publish_trend_refresh", publish)

    await run_trend_refresh_workflow(context, settings)

    expected_queries = [
        (profile.name, query.key) for profile in TREND_QUERY_PROFILES for query in profile.queries
    ]
    assert collected == expected_queries
    assert embedded == [
        (
            "00000000-0000-0000-0000-000000000001",
            "00000000-0000-0000-0000-000000000002",
        ),
        ("00000000-0000-0000-0000-000000000003",),
    ]
    assert len(published_reports) == len(expected_queries)
    assert context.steps == [
        "prepare-refresh",
        *(f"collect-{query_key}" for _, query_key in expected_queries),
        "plan-embeddings",
        "embed-000",
        "embed-001",
        "embed-and-publish",
        "release-refresh-lock",
    ]
    assert lock_acquisitions == ["wfr_test"] * (len(expected_queries) + 5)
    assert releases == ["wfr_test"]


async def test_workflow_skips_before_provider_work_when_another_run_owns_the_lease(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    context = ImmediateWorkflowContext()

    async def unavailable(_: Settings, owner: str) -> bool:
        return False

    async def unexpected_preflight(_: Settings) -> TavilyUsage:
        raise AssertionError("provider work must not run")

    monkeypatch.setattr(workflow_module, "_acquire_workflow_lock", unavailable)
    monkeypatch.setattr(workflow_module, "preflight_trend_refresh", unexpected_preflight)

    await run_trend_refresh_workflow(context, workflow_settings())

    assert context.steps == ["prepare-refresh"]


def test_qstash_workflow_route_is_signed_and_hidden_from_public_openapi() -> None:
    app = FastAPI()

    register_trend_refresh_workflow(app, workflow_settings())

    route = next(
        route
        for route in app.routes
        if isinstance(route, APIRoute) and route.path == TREND_WORKFLOW_PATH
    )
    assert route.methods == {"POST"}
    assert route.include_in_schema is False
