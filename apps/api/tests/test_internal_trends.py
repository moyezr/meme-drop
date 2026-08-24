from __future__ import annotations

from collections.abc import Awaitable, Callable

import httpx
import pytest

from memedrop_api.app import create_app
from memedrop_api.config import Settings
from memedrop_api.services.tavily_trends import TavilyUsage
from memedrop_api.services.trend_cron import RedisTrendRefreshLock
from memedrop_api.services.trend_runtime import (
    TrendRefreshFailed,
    TrendRefreshReport,
)


class FakeLock:
    def __init__(self, token: str | None = "lease-token") -> None:
        self.token = token
        self.released: list[str] = []

    async def acquire(self) -> str | None:
        return self.token

    async def release(self, token: str) -> bool:
        self.released.append(token)
        return True


def trend_settings() -> Settings:
    return Settings(
        database_url="postgresql://test:test@127.0.0.1:5432/test",
        trends_enabled=True,
        redis_url="redis://127.0.0.1:6379/0",
        tavily_api_key="tavily-secret",
        openrouter_api_key="openrouter-secret",
        trend_cron_secret="cron-secret-0123456789",
        rate_limit_store="memory",
        storage_backend="local",
        _env_file=None,
    )


def completed_report() -> TrendRefreshReport:
    return TrendRefreshReport(
        profiles=(),
        active_cards=0,
        snapshot_version=1,
        index_version="snapshot-v1",
        tavily_usage=TavilyUsage(key_usage=1, key_limit=1_000, key_search_usage=1),
    )


async def request_cron(
    lock: FakeLock,
    runner: Callable[[Settings], Awaitable[TrendRefreshReport]],
    *,
    authorization: str | None = "Bearer cron-secret-0123456789",
) -> httpx.Response:
    app = create_app(
        trend_settings(),
        trend_refresh_lock=lock,
        trend_refresh_runner=runner,
    )
    headers = {"authorization": authorization} if authorization is not None else {}
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get("/internal/cron/trends/refresh", headers=headers)


async def test_cron_rejects_missing_or_invalid_bearer_secret() -> None:
    calls = 0

    async def runner(_: Settings) -> TrendRefreshReport:
        nonlocal calls
        calls += 1
        return completed_report()

    missing = await request_cron(FakeLock(), runner, authorization=None)
    invalid = await request_cron(FakeLock(), runner, authorization="Bearer wrong-secret")

    assert missing.status_code == 401
    assert invalid.status_code == 401
    assert calls == 0


async def test_cron_skips_a_duplicate_delivery_while_a_lease_is_held() -> None:
    calls = 0

    async def runner(_: Settings) -> TrendRefreshReport:
        nonlocal calls
        calls += 1
        return completed_report()

    lock = FakeLock(token=None)
    response = await request_cron(lock, runner)

    assert response.status_code == 200
    assert response.json() == {"status": "skipped", "reason": "in_progress"}
    assert calls == 0
    assert lock.released == []


async def test_cron_propagates_refresh_failure_as_an_alertable_response() -> None:
    async def runner(_: Settings) -> TrendRefreshReport:
        raise TrendRefreshFailed("provider work failed")

    lock = FakeLock()
    response = await request_cron(lock, runner)

    assert response.status_code == 503
    assert response.json() == {"status": "failed", "reason": "provider"}
    assert lock.released == ["lease-token"]


async def test_cron_returns_a_bounded_operator_report_after_completion() -> None:
    async def runner(_: Settings) -> TrendRefreshReport:
        return completed_report()

    lock = FakeLock()
    response = await request_cron(lock, runner)

    assert response.status_code == 200
    assert response.json()["status"] == "completed"
    assert response.json()["report"]["snapshot_version"] == 1
    assert lock.released == ["lease-token"]


async def test_redis_lock_only_releases_its_own_lease(monkeypatch: pytest.MonkeyPatch) -> None:
    class FakeRedis:
        def __init__(self) -> None:
            self.values: dict[str, str] = {}

        async def set(self, key: str, value: str, *, nx: bool, ex: int) -> bool:
            assert nx is True
            assert ex == 60
            if key in self.values:
                return False
            self.values[key] = value
            return True

        async def eval(self, script: str, key_count: int, key: str, token: str) -> int:
            assert "redis.call('get'" in script
            assert key_count == 1
            if self.values.get(key) != token:
                return 0
            del self.values[key]
            return 1

        async def aclose(self) -> None:
            return None

    redis = FakeRedis()

    class FakeRedisFactory:
        @staticmethod
        def from_url(_: str, *, decode_responses: bool) -> FakeRedis:
            assert decode_responses is True
            return redis

    monkeypatch.setattr("memedrop_api.services.trend_cron.Redis", FakeRedisFactory)
    lock = RedisTrendRefreshLock("redis://example", ttl_seconds=60)
    token = await lock.acquire()

    assert token is not None
    assert await lock.release("other-worker-token") is False
    assert redis.values
    assert await lock.release(token) is True
    assert redis.values == {}
