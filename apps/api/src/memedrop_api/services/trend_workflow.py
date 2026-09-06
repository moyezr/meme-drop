"""Durable QStash workflow for the complete trend refresh cycle."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable
from dataclasses import asdict
from datetime import UTC, datetime
from typing import Any, Protocol

from fastapi import FastAPI
from fastapi.routing import APIRoute
from upstash_workflow import AsyncWorkflowContext  # type: ignore[import-untyped]
from upstash_workflow.fastapi import Serve  # type: ignore[import-untyped]

from memedrop_api.config import Settings
from memedrop_api.services.tavily_trends import TavilyUsage
from memedrop_api.services.trend_cron import RedisTrendRefreshLock
from memedrop_api.services.trend_runtime import (
    TREND_QUERY_PROFILES,
    ProfileRefreshReport,
    collect_trend_query,
    embed_trend_card_batch,
    list_stale_trend_embedding_ids,
    preflight_trend_refresh,
    publish_trend_refresh,
)

LOGGER = logging.getLogger("memedrop.api.trend_workflow")
TREND_WORKFLOW_PATH = "/internal/workflows/trends/refresh"


class WorkflowContext(Protocol):
    workflow_run_id: str

    async def run(
        self,
        step_name: str,
        step_function: Callable[[], Any] | Callable[[], Awaitable[Any]],
    ) -> Any: ...


async def run_trend_refresh_workflow(context: WorkflowContext, settings: Settings) -> None:
    """Collect each query in its own invocation, then atomically publish once."""

    owner = context.workflow_run_id

    async def prepare() -> dict[str, Any]:
        acquired = await _acquire_workflow_lock(settings, owner)
        if not acquired:
            return {"acquired": False}
        usage = await preflight_trend_refresh(settings)
        return {
            "acquired": True,
            "observed_at": datetime.now(UTC).isoformat(),
            "tavily_usage": asdict(usage),
        }

    prepared = await context.run("prepare-refresh", prepare)
    if not prepared["acquired"]:
        LOGGER.info("Trend refresh workflow skipped because another refresh owns the lease")
        return

    observed_at = datetime.fromisoformat(prepared["observed_at"]).astimezone(UTC)
    reports: list[ProfileRefreshReport] = []
    for profile in TREND_QUERY_PROFILES:
        for query in profile.queries:

            async def collect(
                profile_name: str = profile.name,
                query_key: str = query.key,
            ) -> dict[str, Any]:
                await _require_workflow_lock(settings, owner)
                report = await collect_trend_query(
                    settings,
                    profile_name=profile_name,
                    query_key=query_key,
                    observed_at=observed_at,
                )
                return report.as_json()

            result = await context.run(f"collect-{query.key}", collect)
            reports.append(ProfileRefreshReport.from_json(result))

    async def plan_embeddings() -> tuple[str, ...]:
        await _require_workflow_lock(settings, owner)
        return await list_stale_trend_embedding_ids(settings, observed_at=observed_at)

    stale_embedding_ids = await context.run("plan-embeddings", plan_embeddings)
    batch_size = settings.trend_embedding_batch_size
    for offset in range(0, len(stale_embedding_ids), batch_size):
        batch = stale_embedding_ids[offset : offset + batch_size]

        async def embed(card_ids: tuple[str, ...] = tuple(batch)) -> int:
            await _require_workflow_lock(settings, owner)
            return await embed_trend_card_batch(
                settings,
                card_ids=card_ids,
                observed_at=observed_at,
            )

        await context.run(f"embed-{offset // batch_size:03d}", embed)

    async def publish() -> dict[str, Any]:
        await _require_workflow_lock(settings, owner)
        report = await publish_trend_refresh(
            settings,
            reports=reports,
            observed_at=observed_at,
            tavily_usage=TavilyUsage(**prepared["tavily_usage"]),
        )
        return report.as_json()

    published = await context.run("embed-and-publish", publish)
    await context.run("release-refresh-lock", lambda: _release_workflow_lock(settings, owner))
    LOGGER.info(
        "Trend refresh workflow completed",
        extra={
            "workflow_run_id": owner,
            "snapshot_version": published["snapshot_version"],
            "active_cards": published["active_cards"],
        },
    )


def register_trend_refresh_workflow(app: FastAPI, settings: Settings) -> None:
    """Register the signed workflow endpoint only when QStash is configured."""

    if not settings.qstash_configured:
        return
    environment = {
        "QSTASH_URL": settings.qstash_url,
        "QSTASH_TOKEN": settings.qstash_token,
        "QSTASH_CURRENT_SIGNING_KEY": settings.qstash_current_signing_key,
        "QSTASH_NEXT_SIGNING_KEY": settings.qstash_next_signing_key,
    }
    endpoint_url = f"{settings.normalized_api_public_origin}{TREND_WORKFLOW_PATH}"
    serve = Serve(app)

    async def workflow(context: AsyncWorkflowContext[dict[str, object]]) -> None:
        await run_trend_refresh_workflow(context, settings)

    async def release_failed_workflow(
        context: AsyncWorkflowContext[Any],
        status: int,
        _body: str | None,
        _headers: dict[str, str],
    ) -> None:
        await _release_workflow_lock(settings, context.workflow_run_id)
        LOGGER.error(
            "Trend refresh workflow exhausted retries",
            extra={"workflow_run_id": context.workflow_run_id, "status": status},
        )

    serve.post(
        TREND_WORKFLOW_PATH,
        env=environment,
        retries=3,
        url=endpoint_url,
        failure_function=release_failed_workflow,
    )(workflow)
    for route in app.routes:
        if isinstance(route, APIRoute) and route.path == TREND_WORKFLOW_PATH:
            route.include_in_schema = False


async def _acquire_workflow_lock(settings: Settings, owner: str) -> bool:
    lock = RedisTrendRefreshLock(
        settings.redis_url or "",
        ttl_seconds=settings.trend_refresh_lock_ttl_seconds,
    )
    try:
        return await lock.acquire(owner) is not None
    finally:
        await lock.close()


async def _release_workflow_lock(settings: Settings, owner: str) -> bool:
    lock = RedisTrendRefreshLock(
        settings.redis_url or "",
        ttl_seconds=settings.trend_refresh_lock_ttl_seconds,
    )
    try:
        return await lock.release(owner)
    finally:
        await lock.close()


async def _require_workflow_lock(settings: Settings, owner: str) -> None:
    if not await _acquire_workflow_lock(settings, owner):
        raise RuntimeError("trend refresh workflow lost its lease")
