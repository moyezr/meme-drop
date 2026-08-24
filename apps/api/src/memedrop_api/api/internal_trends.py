"""Authenticated operational endpoints for the offline trend collector."""

from __future__ import annotations

import hmac
import logging
from collections.abc import Awaitable, Callable
from typing import Protocol

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from redis.exceptions import RedisError

from memedrop_api.config import Settings
from memedrop_api.services.trend_runtime import (
    TrendRefreshConfigurationError,
    TrendRefreshFailed,
    TrendRefreshReport,
)

LOGGER = logging.getLogger("memedrop.api.internal_trends")


class TrendRefreshLock(Protocol):
    async def acquire(self) -> str | None: ...

    async def release(self, token: str) -> bool: ...


TrendRefreshRunner = Callable[[Settings], Awaitable[TrendRefreshReport]]

router = APIRouter(tags=["internal"])


def is_authorized_cron_request(authorization: str | None, expected_secret: str | None) -> bool:
    """Validate Vercel's bearer token without exposing comparison timing."""

    if not authorization or not expected_secret:
        return False
    scheme, separator, token = authorization.partition(" ")
    return bool(separator) and scheme.casefold() == "bearer" and hmac.compare_digest(
        token, expected_secret
    )


@router.get("/internal/cron/trends/refresh", include_in_schema=False)
async def scheduled_trend_refresh(request: Request) -> JSONResponse:
    """Run the current UTC buckets once; duplicate scheduler deliveries are harmless."""

    settings: Settings = request.app.state.settings
    if not is_authorized_cron_request(
        request.headers.get("authorization"), settings.trend_cron_secret
    ):
        return JSONResponse(status_code=401, content={"error": "Unauthorized"})
    if not settings.trends_enabled:
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "reason": "trends_disabled"},
        )

    lock: TrendRefreshLock | None = request.app.state.trend_refresh_lock
    runner: TrendRefreshRunner = request.app.state.trend_refresh_runner
    if lock is None:
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "reason": "lock_unconfigured"},
        )

    try:
        lease_token = await lock.acquire()
    except RedisError:
        LOGGER.warning("Trend refresh lock is unavailable")
        return JSONResponse(
            status_code=503,
            content={"status": "unavailable", "reason": "lock_unavailable"},
        )
    if lease_token is None:
        return JSONResponse(status_code=200, content={"status": "skipped", "reason": "in_progress"})

    try:
        report = await runner(settings)
    except TrendRefreshConfigurationError:
        LOGGER.warning("Trend refresh configuration rejected")
        return JSONResponse(
            status_code=503,
            content={"status": "failed", "reason": "configuration"},
        )
    except TrendRefreshFailed:
        LOGGER.warning("Trend refresh provider work failed")
        return JSONResponse(
            status_code=503,
            content={"status": "failed", "reason": "provider"},
        )
    except Exception:
        LOGGER.exception("Trend refresh failed unexpectedly")
        return JSONResponse(
            status_code=503,
            content={"status": "failed", "reason": "internal"},
        )
    finally:
        try:
            released = await lock.release(lease_token)
            if not released:
                LOGGER.warning("Trend refresh lease was no longer owned at release")
        except RedisError:
            LOGGER.warning("Trend refresh lease could not be released")

    return JSONResponse(
        status_code=200,
        content={"status": "completed", "report": report.as_json()},
    )
