from __future__ import annotations

from collections.abc import Awaitable, Callable

from fastapi import APIRouter, Request, Response, status

ReadinessCheck = Callable[[], Awaitable[bool]]

router = APIRouter(tags=["health"])


@router.get("/live")
async def liveness() -> dict[str, str]:
    return {"status": "ok"}


@router.get("/health")
async def readiness(request: Request, response: Response) -> dict[str, str | bool]:
    check: ReadinessCheck = request.app.state.readiness_check
    if not await check():
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        return {"status": "degraded", "db": False}
    return {"status": "ok", "db": True}
