from __future__ import annotations

from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Any

import httpx

from memedrop_api.app import create_app
from memedrop_api.config import Settings
from memedrop_api.generated_asset_repository import SqlAlchemyGeneratedAssetRetentionRepository
from memedrop_api.services.generated_asset_retention import (
    GeneratedAssetCleanupReport,
    GeneratedAssetMaintenanceService,
    GeneratedAssetRetentionService,
    StaleGenerationReconciliationFailure,
)
from memedrop_api.services.storage import LocalMemeStorage


class FakeLock:
    def __init__(self, token: str | None = "asset-lease-token") -> None:
        self.token = token
        self.released: list[str] = []

    async def acquire(self) -> str | None:
        return self.token

    async def release(self, token: str) -> bool:
        self.released.append(token)
        return True


def cleanup_settings(tmp_path: Path, *, secret: bool = True) -> Settings:
    return Settings(  # type: ignore[call-arg]
        database_url="postgresql://test:test@127.0.0.1:5432/test",
        trend_cron_secret="cron-secret-0123456789" if secret else None,
        rate_limit_store="memory",
        storage_backend="local",
        meme_storage_path=tmp_path / "memes",
        _env_file=None,
    )


def completed_report(
    *, failed: int = 0, blocked: int = 0, stale_generations_reconciled: int = 0
) -> GeneratedAssetCleanupReport:
    return GeneratedAssetCleanupReport(
        claimed=4,
        deleted=4 - failed,
        failed=failed,
        remaining_retryable_assets=2,
        oldest_retryable_lag_seconds=75,
        blocked_expired_assets=blocked,
        oldest_blocked_lag_seconds=180 if blocked else None,
        stale_generations_reconciled=stale_generations_reconciled,
    )


async def request_cleanup(
    tmp_path: Path,
    lock: FakeLock | None,
    runner: Callable[[], Awaitable[GeneratedAssetCleanupReport]],
    *,
    authorization: str | None = "Bearer cron-secret-0123456789",
    inject_lock: bool = True,
) -> httpx.Response:
    arguments: dict[str, Any] = {
        "generated_asset_cleanup_runner": runner,
    }
    if inject_lock:
        arguments["generated_asset_cleanup_lock"] = lock
    app = create_app(cleanup_settings(tmp_path), **arguments)
    headers = {"authorization": authorization} if authorization is not None else {}
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        return await client.get("/internal/cron/assets/cleanup", headers=headers)


async def test_cleanup_cron_rejects_missing_or_invalid_bearer_secret(tmp_path: Path) -> None:
    calls = 0

    async def runner() -> GeneratedAssetCleanupReport:
        nonlocal calls
        calls += 1
        return completed_report()

    missing = await request_cleanup(tmp_path, FakeLock(), runner, authorization=None)
    invalid = await request_cleanup(
        tmp_path,
        FakeLock(),
        runner,
        authorization="Bearer wrong-secret",
    )

    assert missing.status_code == 401
    assert invalid.status_code == 401
    assert calls == 0


async def test_cleanup_cron_skips_concurrent_delivery_safely(tmp_path: Path) -> None:
    calls = 0

    async def runner() -> GeneratedAssetCleanupReport:
        nonlocal calls
        calls += 1
        return completed_report()

    lock = FakeLock(token=None)
    response = await request_cleanup(tmp_path, lock, runner)

    assert response.status_code == 200
    assert response.json() == {"status": "skipped", "reason": "in_progress"}
    assert calls == 0
    assert lock.released == []


async def test_cleanup_cron_returns_bounded_content_free_metrics(tmp_path: Path) -> None:
    async def runner() -> GeneratedAssetCleanupReport:
        return completed_report()

    lock = FakeLock()
    response = await request_cleanup(tmp_path, lock, runner)

    assert response.status_code == 200
    assert response.json() == {
        "status": "completed",
        "report": {
            "claimed": 4,
            "deleted": 4,
            "failed": 0,
            "remaining_retryable_assets": 2,
            "oldest_retryable_lag_seconds": 75,
            "blocked_expired_assets": 0,
            "oldest_blocked_lag_seconds": None,
            "stale_generations_reconciled": 0,
        },
    }
    assert lock.released == ["asset-lease-token"]


async def test_cleanup_cron_makes_asset_deletion_failures_alertable(tmp_path: Path) -> None:
    async def runner() -> GeneratedAssetCleanupReport:
        return completed_report(failed=1)

    response = await request_cleanup(tmp_path, FakeLock(), runner)

    assert response.status_code == 503
    assert response.json() == {
        "status": "failed",
        "reason": "asset_deletion",
        "report": {
            "claimed": 4,
            "deleted": 3,
            "failed": 1,
            "remaining_retryable_assets": 2,
            "oldest_retryable_lag_seconds": 75,
            "blocked_expired_assets": 0,
            "oldest_blocked_lag_seconds": None,
            "stale_generations_reconciled": 0,
        },
    }


async def test_cleanup_cron_continuously_alerts_on_blocked_expired_assets(
    tmp_path: Path,
) -> None:
    async def runner() -> GeneratedAssetCleanupReport:
        return completed_report(blocked=3)

    response = await request_cleanup(tmp_path, FakeLock(), runner)

    assert response.status_code == 503
    assert response.json() == {
        "status": "failed",
        "reason": "retention_blocked",
        "report": {
            "claimed": 4,
            "deleted": 4,
            "failed": 0,
            "remaining_retryable_assets": 2,
            "oldest_retryable_lag_seconds": 75,
            "blocked_expired_assets": 3,
            "oldest_blocked_lag_seconds": 180,
            "stale_generations_reconciled": 0,
        },
    }


async def test_cleanup_cron_failure_is_non_success_and_releases_lease(tmp_path: Path) -> None:
    async def runner() -> GeneratedAssetCleanupReport:
        raise RuntimeError("unexpected cleanup failure")

    lock = FakeLock()
    response = await request_cleanup(tmp_path, lock, runner)

    assert response.status_code == 503
    assert response.json() == {"status": "failed", "reason": "internal"}
    assert lock.released == ["asset-lease-token"]


async def test_cleanup_cron_makes_credit_reconciliation_failure_categorical(tmp_path: Path) -> None:
    async def runner() -> GeneratedAssetCleanupReport:
        raise StaleGenerationReconciliationFailure()

    lock = FakeLock()
    response = await request_cleanup(tmp_path, lock, runner)

    assert response.status_code == 503
    assert response.json() == {"status": "failed", "reason": "generation_reconciliation"}
    assert lock.released == ["asset-lease-token"]


async def test_cleanup_cron_reports_missing_distributed_lock(tmp_path: Path) -> None:
    async def runner() -> GeneratedAssetCleanupReport:
        return completed_report()

    response = await request_cleanup(
        tmp_path,
        None,
        runner,
        inject_lock=False,
    )

    assert response.status_code == 503
    assert response.json() == {"status": "unavailable", "reason": "lock_unconfigured"}


async def test_local_app_stays_healthy_without_cron_secret(tmp_path: Path) -> None:
    async def ready() -> bool:
        return True

    app = create_app(cleanup_settings(tmp_path, secret=False), readiness_check=ready)
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)

    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        live = await client.get("/live")
        cleanup = await client.get("/internal/cron/assets/cleanup")

    assert live.status_code == 200
    assert cleanup.status_code == 401
    assert app.state.generated_asset_cleanup_lock is None


def test_default_cleanup_runner_uses_app_database_and_configured_storage(tmp_path: Path) -> None:
    storage = LocalMemeStorage(tmp_path / "configured-storage")
    app = create_app(cleanup_settings(tmp_path, secret=False), storage=storage)
    runner = app.state.generated_asset_cleanup_runner
    service = runner.__self__

    assert isinstance(service, GeneratedAssetMaintenanceService)
    assert isinstance(service.retention, GeneratedAssetRetentionService)
    assert service.retention.storage is storage
    assert isinstance(service.retention.repository, SqlAlchemyGeneratedAssetRetentionRepository)
    assert service.retention.repository.database is app.state.database
    assert service.generations is app.state.agent_generation_credits


async def test_cleanup_cron_reports_stale_credit_reconciliation(tmp_path: Path) -> None:
    async def runner() -> GeneratedAssetCleanupReport:
        return completed_report(stale_generations_reconciled=2)

    response = await request_cleanup(tmp_path, FakeLock(), runner)

    assert response.status_code == 200
    assert response.json()["report"]["stale_generations_reconciled"] == 2
