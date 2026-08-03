from __future__ import annotations

import httpx

from memedrop_api.app import create_app
from memedrop_api.config import Settings


async def test_live_does_not_call_readiness(settings: Settings) -> None:
    async def should_not_run() -> bool:
        raise AssertionError("readiness must not run for liveness")

    app = create_app(settings, readiness_check=should_not_run)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/live")

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_health_reports_ready(settings: Settings) -> None:
    async def ready() -> bool:
        return True

    app = create_app(settings, readiness_check=ready)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "db": True}


async def test_health_reports_degraded(settings: Settings) -> None:
    async def unavailable() -> bool:
        return False

    app = create_app(settings, readiness_check=unavailable)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")

    assert response.status_code == 503
    assert response.json() == {"status": "degraded", "db": False}
