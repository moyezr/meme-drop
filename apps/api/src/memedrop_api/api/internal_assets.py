"""Authenticated operational endpoint for generated-image retention cleanup."""

from __future__ import annotations

import logging
from collections.abc import Awaitable, Callable

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from redis.exceptions import RedisError

from memedrop_api.services.generated_asset_retention import (
    GeneratedAssetCleanupReport,
    StaleGenerationReconciliationFailure,
)
from memedrop_api.services.trend_cron import CronLock, is_authorized_cron_request

LOGGER = logging.getLogger("memedrop.api.internal_assets")

GeneratedAssetCleanupRunner = Callable[[], Awaitable[GeneratedAssetCleanupReport]]

router = APIRouter(tags=["internal"])


@router.get("/internal/cron/assets/cleanup", include_in_schema=False)
async def scheduled_generated_asset_cleanup(request: Request) -> JSONResponse:
    """Delete one bounded batch; duplicate scheduler deliveries are harmless."""

    settings = request.app.state.settings
    if not is_authorized_cron_request(
        request.headers.get("authorization"), settings.trend_cron_secret
    ):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})

    lock: CronLock | None = request.app.state.generated_asset_cleanup_lock
    runner: GeneratedAssetCleanupRunner = request.app.state.generated_asset_cleanup_runner
    if lock is None:
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "reason": "lock_unconfigured"},
        )

    try:
        lease_token = await lock.acquire()
    except RedisError:
        LOGGER.warning("Generated asset cleanup lock is unavailable")
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "reason": "lock_unavailable"},
        )
    if lease_token is None:
        return JSONResponse(status_code=200, content={"status": "skipped", "reason": "in_progress"})

    try:
        report = await runner()
    except StaleGenerationReconciliationFailure:
        LOGGER.error("Stale generation reconciliation failed")
        return JSONResponse(
            status_code=503,
            content={"status": "failed", "reason": "generation_reconciliation"},
        )
    except Exception:
        # Exception text may contain provider or object details, so keep logs categorical.
        LOGGER.error("Generated asset cleanup failed unexpectedly")
        return JSONResponse(
            status_code=503,
            content={"status": "failed", "reason": "internal"},
        )
    finally:
        try:
            released = await lock.release(lease_token)
            if not released:
                LOGGER.warning("Generated asset cleanup lease was no longer owned at release")
        except RedisError:
            LOGGER.warning("Generated asset cleanup lease could not be released")

    report_json = {
        "claimed": report.claimed,
        "deleted": report.deleted,
        "failed": report.failed,
        "remaining_retryable_assets": report.remaining_retryable_assets,
        "oldest_retryable_lag_seconds": report.oldest_retryable_lag_seconds,
        "blocked_expired_assets": report.blocked_expired_assets,
        "oldest_blocked_lag_seconds": report.oldest_blocked_lag_seconds,
        "stale_generations_reconciled": report.stale_generations_reconciled,
    }
    if report.failed:
        return JSONResponse(
            status_code=503,
            content={
                "status": "failed",
                "reason": "asset_deletion",
                "report": report_json,
            },
        )
    if report.blocked_expired_assets:
        return JSONResponse(
            status_code=503,
            content={
                "status": "failed",
                "reason": "retention_blocked",
                "report": report_json,
            },
        )
    return JSONResponse(
        status_code=200,
        content={"status": "completed", "report": report_json},
    )
