from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import APIRouter, Request, Response, status

from memedrop_api.services.trend_monitoring import TrendSnapshotStatus

ReadinessCheck = Callable[[], Awaitable[bool]]
TrendSnapshotCheck = Callable[[], Awaitable[TrendSnapshotStatus]]

router = APIRouter(tags=["health"])


@router.get("/live")
async def liveness() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health")
async def readiness(request: Request, response: Response) -> dict[str, object]:
    check: ReadinessCheck = request.app.state.readiness_check
    database_ready = await check()
    rate_limiter_ready = bool(request.app.state.rate_limiter_ready)
    if not database_ready or not rate_limiter_ready:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        result: dict[str, object] = {"status": "degraded", "db": database_ready}
        if not rate_limiter_ready:
            result["rate_limiter"] = False
        return result

    trend_snapshot_check: TrendSnapshotCheck | None = request.app.state.trend_snapshot_check
    if trend_snapshot_check is None:
        return {"status": "ok", "db": True}
    trend_snapshot = await trend_snapshot_check()
    if not trend_snapshot.is_fresh:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "degraded", "db": True, "trends": trend_snapshot.as_json()}
    return {"status": "ok", "db": True, "trends": trend_snapshot.as_json()}
