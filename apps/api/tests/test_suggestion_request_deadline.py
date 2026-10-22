from __future__ import annotations

import asyncio
import time
from collections.abc import AsyncIterator
from unittest.mock import AsyncMock
from uuid import uuid4

import httpx
import pytest

import memedrop_api.app as app_module
import memedrop_api.services.suggestion_engine as suggestion_engine
from memedrop_api.app import create_app
from memedrop_api.config import Settings
from memedrop_api.rate_limit import MemoryRateLimitStore
from memedrop_api.services.openrouter import OpenRouterSuggestionGateway
from tests.conftest import INSTALL_ID
from tests.fakes import FakeStore


class DelayedRateLimiter(MemoryRateLimitStore):
    def __init__(self, delay_seconds: float | None = None) -> None:
        super().__init__()
        self.delay_seconds = delay_seconds
        self.cancelled = False

    async def consume(self, key: str, window_ms: int, maximum: int) -> bool:
        try:
            if self.delay_seconds is None:
                await asyncio.Event().wait()
            else:
                await asyncio.sleep(self.delay_seconds)
            return await super().consume(key, window_ms, maximum)
        except asyncio.CancelledError:
            self.cancelled = True
            raise


def server_durations(response: httpx.Response) -> dict[str, float]:
    return {
        parts[0]: float(parts[1].removeprefix("dur="))
        for metric in response.headers["server-timing"].split(", ")
        if len(parts := metric.split(";")) > 1 and parts[1].startswith("dur=")
    }


async def test_rate_limit_time_consumes_suggestion_budget_and_is_exposed(
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(app_module, "SUGGESTION_TIMEOUT_MS", 200)
    monkeypatch.setattr(suggestion_engine, "SUGGESTION_FALLBACK_RESERVE_MS", 30)
    store = FakeStore()
    store.memes = [{"id": str(uuid4()), "name": "This Is Fine", "filePath": "/memes/test.png"}]
    limiter = DelayedRateLimiter(0.06)
    app = create_app(settings, store=store, rate_limiter=limiter)
    provider_budgets: list[int] = []

    async def blocked_provider(*args: object, **kwargs: object) -> dict[str, object]:
        provider_budgets.append(int(kwargs["timeout_ms"]))  # type: ignore[call-overload]
        await asyncio.Event().wait()
        return {}

    gateway = OpenRouterSuggestionGateway(
        settings.model_copy(update={"openrouter_api_key": "fixture"})
    )
    gateway._chat_json = AsyncMock(side_effect=blocked_provider)  # type: ignore[method-assign]
    app.state.suggestion_service.gateway = gateway
    started = time.perf_counter()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await asyncio.wait_for(
            client.post(
                "/api/v1/suggest",
                headers={"x-memedrop-install-id": str(INSTALL_ID)},
                json={"tweet_text": "Prod is down"},
            ),
            timeout=0.6,
        )

    assert response.status_code == 200
    assert time.perf_counter() - started < 0.6
    assert response.json()["suggestions"][0]["tailored_overlay"]["regions"]
    assert 0 < provider_budgets[0] <= 110
    durations = server_durations(response)
    assert durations["rate-limit"] >= 50
    assert durations["http-app"] >= durations["total"] + 50
    assert 'desc="timeout"' in response.headers["server-timing"]


@pytest.mark.parametrize("origin", ["http://localhost:5173", "https://untrusted.invalid"])
async def test_stalled_rate_limit_fails_closed_with_bounded_diagnostics(
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
    origin: str,
) -> None:
    monkeypatch.setattr(app_module, "SUGGESTION_RATE_LIMIT_TIMEOUT_MS", 20)
    limiter = DelayedRateLimiter()
    store = FakeStore()
    app = create_app(settings, store=store, rate_limiter=limiter)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await asyncio.wait_for(
            client.post(
                "/api/v1/suggest",
                headers={"origin": origin},
                json={"tweet_text": "Private source fixture"},
            ),
            timeout=0.5,
        )

    assert response.status_code == 503
    assert response.json() == {"error": "Service unavailable"}
    assert limiter.cancelled
    assert store.list_global_memes_calls == 0
    assert not app.state.suggestion_service._inflight_suggestions
    assert "x-request-id" in response.headers
    assert server_durations(response)["rate-limit"] >= 15
    assert "Private source fixture" not in response.headers["server-timing"]
    if origin == "http://localhost:5173":
        assert response.headers["access-control-allow-origin"] == origin
        assert "server-timing" in response.headers["access-control-expose-headers"].lower()
    else:
        assert "access-control-allow-origin" not in response.headers


async def test_suggestion_deadline_covers_body_parsing_before_service_entry(
    settings: Settings,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(app_module, "SUGGESTION_TIMEOUT_MS", 30)
    store = FakeStore()
    app = create_app(settings, store=store)
    body_cancelled = asyncio.Event()

    async def blocked_body() -> AsyncIterator[bytes]:
        yield b'{"tweet_text":'
        try:
            await asyncio.Event().wait()
        finally:
            body_cancelled.set()

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        response = await asyncio.wait_for(
            client.post(
                "/api/v1/suggest",
                content=blocked_body(),
                headers={"content-type": "application/json"},
            ),
            timeout=0.5,
        )

    assert response.status_code == 503
    assert body_cancelled.is_set()
    assert store.list_global_memes_calls == 0
    assert server_durations(response)["http-app"] >= 25


async def test_suggestion_rate_denial_retains_429_and_cors_diagnostics(settings: Settings) -> None:
    app = create_app(settings.model_copy(update={"expensive_rate_limit_max": 1}), store=FakeStore())
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        await client.post("/api/v1/suggest", json={"tweet_text": "Fixture"})
        denied = await client.post(
            "/api/v1/suggest",
            json={"tweet_text": "Fixture"},
            headers={"origin": "http://localhost:5173"},
        )

    assert denied.status_code == 429
    assert denied.json() == {"error": "Too many requests"}
    assert denied.headers["access-control-allow-origin"] == "http://localhost:5173"
    assert "rate-limit" in server_durations(denied)
