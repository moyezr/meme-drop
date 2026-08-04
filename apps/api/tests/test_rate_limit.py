from __future__ import annotations

import asyncio
import os
from uuid import uuid4

import httpx
import pytest

from memedrop_api.app import create_app
from memedrop_api.config import Settings
from memedrop_api.rate_limit import (
    REDIS_RATE_LIMIT_SCRIPT,
    MemoryRateLimitStore,
    RedisRateLimitStore,
    rate_limit_client_key,
)
from tests.fakes import FakeStore


async def test_memory_rate_limit_enforces_and_resets() -> None:
    store = MemoryRateLimitStore()

    assert await store.consume("key", 10, 2) is True
    assert await store.consume("key", 10, 2) is True
    assert await store.consume("key", 10, 2) is False

    await asyncio.sleep(0.015)
    assert await store.consume("key", 10, 2) is True


class FakeRedis:
    def __init__(self) -> None:
        self.counts: dict[str, int] = {}
        self.pinged = False
        self.closed = False

    async def ping(self) -> bool:
        self.pinged = True
        return True

    async def eval(
        self, script: str, number_of_keys: int, key: str, window_ms: int
    ) -> int:
        assert script == REDIS_RATE_LIMIT_SCRIPT
        assert number_of_keys == 1
        assert window_ms > 0
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]

    async def aclose(self) -> None:
        self.closed = True


async def test_redis_rate_limit_uses_atomic_namespaced_counter() -> None:
    client = FakeRedis()
    store = RedisRateLimitStore(
        "redis://unused",
        client=client,
        key_prefix="test:",
    )

    await store.setup()
    assert await store.consume("client:route", 1_000, 2) is True
    assert await store.consume("client:route", 1_000, 2) is True
    assert await store.consume("client:route", 1_000, 2) is False
    await store.close()

    assert client.pinged is True
    assert client.closed is True
    assert client.counts == {"test:client:route": 3}


@pytest.mark.integration
async def test_redis_rate_limit_enforces_and_expires_shared_window() -> None:
    redis_url = os.environ.get("MEMEDROP_TEST_REDIS_URL")
    if not redis_url:
        pytest.skip("MEMEDROP_TEST_REDIS_URL is not configured")
    store = RedisRateLimitStore(redis_url, key_prefix=f"memedrop:test:{uuid4()}:")

    try:
        await store.setup()
        assert await store.consume("client:route", 25, 2) is True
        assert await store.consume("client:route", 25, 2) is True
        assert await store.consume("client:route", 25, 2) is False
        await asyncio.sleep(0.05)
        assert await store.consume("client:route", 25, 2) is True
    finally:
        await store.close()


def test_rate_limit_key_prefers_install_id_then_forwarded_ip() -> None:
    assert (
        rate_limit_client_key(
            {"x-memedrop-install-id": "11111111-1111-4111-8111-111111111111"},
            "203.0.113.9",
        )
        == "install:11111111-1111-4111-8111-111111111111"
    )
    assert (
        rate_limit_client_key(
            {"x-memedrop-install-id": "bad", "x-forwarded-for": "198.51.100.10, 10.0.0.1"},
            "203.0.113.9",
        )
        == "ip:198.51.100.10"
    )


async def test_app_returns_429_with_request_id(tmp_path) -> None:  # type: ignore[no-untyped-def]
    settings = Settings(
        database_url="postgresql://localhost/test",
        meme_storage_path=tmp_path,
        api_rate_limit_max=1,
    )

    async def ready() -> bool:
        return True

    app = create_app(settings, readiness_check=ready, store=FakeStore())
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        first = await client.get("/api/v1/memes/browse")
        limited = await client.get("/api/v1/memes/browse")

    assert first.status_code == 200
    assert limited.status_code == 429
    assert limited.json() == {"error": "Too many requests"}
    assert "x-request-id" in limited.headers
