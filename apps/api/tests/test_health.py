from __future__ import annotations

from typing import NoReturn

import httpx

from memedrop_api.app import create_app
from memedrop_api.config import Settings
from memedrop_api.services.trend_monitoring import TrendSnapshotStatus


class UnavailableRateLimiter:
    async def setup(self) -> NoReturn:
        raise ConnectionError("rate limiter unavailable")

    async def consume(self, key: str, window_ms: int, maximum: int) -> bool:
        raise AssertionError("unavailable rate limiter must fail closed before consume")

    async def close(self) -> None:
        return None


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


async def test_rate_limiter_startup_failure_preserves_liveness_and_fails_closed(
    settings: Settings,
) -> None:
    async def ready() -> bool:
        return True

    app = create_app(
        settings,
        readiness_check=ready,
        rate_limiter=UnavailableRateLimiter(),
    )
    transport = httpx.ASGITransport(app=app)
    async with app.router.lifespan_context(app):
        async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
            live = await client.get("/live")
            health = await client.get("/health")
            protected = await client.get("/api/v1/memes/browse")

    assert live.status_code == 200
    assert live.json() == {"status": "ok"}
    assert health.status_code == 503
    assert health.json() == {"status": "degraded", "db": True, "rate_limiter": False}
    assert protected.status_code == 503
    assert protected.json() == {"error": "Service unavailable"}


async def test_health_returns_alertable_status_for_a_stale_trend_snapshot(
    settings: Settings,
) -> None:
    async def ready() -> bool:
        return True

    async def stale_trends() -> TrendSnapshotStatus:
        return TrendSnapshotStatus(
            state="stale",
            max_age_seconds=28_800,
            age_seconds=28_801,
            snapshot_version=4,
            card_count=2,
        )

    app = create_app(settings, readiness_check=ready, trend_snapshot_check=stale_trends)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")

    assert response.status_code == 503
    assert response.json() == {
        "status": "degraded",
        "db": True,
        "trends": {
            "state": "stale",
            "max_age_seconds": 28_800,
            "age_seconds": 28_801,
            "snapshot_version": 4,
            "card_count": 2,
        },
    }


async def test_health_returns_alertable_status_for_an_empty_trend_snapshot(
    settings: Settings,
) -> None:
    async def ready() -> bool:
        return True

    async def empty_trends() -> TrendSnapshotStatus:
        return TrendSnapshotStatus(
            state="empty",
            max_age_seconds=28_800,
            age_seconds=12,
            snapshot_version=5,
            card_count=0,
        )

    app = create_app(settings, readiness_check=ready, trend_snapshot_check=empty_trends)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/health")

    assert response.status_code == 503
    assert response.json()["trends"]["state"] == "empty"
