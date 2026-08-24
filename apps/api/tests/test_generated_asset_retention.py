from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from typing import Any

import pytest
from botocore.exceptions import ClientError  # type: ignore[import-untyped]
from sqlalchemy.dialects import postgresql

from memedrop_api.generated_asset_repository import (
    _claim_expired_assets_statement,
    _cleanup_metrics_statement,
)
from memedrop_api.services.generated_asset_retention import (
    DEFAULT_CLAIM_TIMEOUT,
    ClaimedGeneratedAsset,
    GeneratedAssetCleanupMetrics,
    GeneratedAssetRetentionService,
)


@dataclass
class FakeRetentionRepository:
    claims: list[ClaimedGeneratedAsset]
    metrics: GeneratedAssetCleanupMetrics
    claim_calls: list[dict[str, Any]] = field(default_factory=list)
    deleted: list[tuple[ClaimedGeneratedAsset, datetime]] = field(default_factory=list)
    failed: list[tuple[ClaimedGeneratedAsset, datetime, str]] = field(default_factory=list)

    async def claim_expired_assets(self, **kwargs: Any) -> list[ClaimedGeneratedAsset]:
        self.claim_calls.append(kwargs)
        return self.claims

    async def mark_deleted(self, claim: ClaimedGeneratedAsset, *, deleted_at: datetime) -> bool:
        self.deleted.append((claim, deleted_at))
        return True

    async def mark_failed(
        self,
        claim: ClaimedGeneratedAsset,
        *,
        failed_at: datetime,
        error_code: str,
    ) -> bool:
        self.failed.append((claim, failed_at, error_code))
        return True

    async def cleanup_metrics(self, **_: Any) -> GeneratedAssetCleanupMetrics:
        return self.metrics


class RecordingStorage:
    def __init__(self, errors: dict[str, Exception] | None = None) -> None:
        self.errors = errors or {}
        self.deleted_paths: list[str] = []

    async def delete(self, public_path: str) -> bool:
        self.deleted_paths.append(public_path)
        if error := self.errors.get(public_path):
            raise error
        return True


def _claim(
    *,
    asset_id: str = "asset_one",
    object_key: str = "generated/agents/one.png",
) -> ClaimedGeneratedAsset:
    return ClaimedGeneratedAsset(id=asset_id, object_key=object_key, deletion_attempts=1)


def _now() -> datetime:
    return datetime(2026, 8, 24, 12, 0, tzinfo=UTC)


async def test_cleanup_deletes_only_claimed_exact_keys_and_reports_content_free_lag() -> None:
    first = _claim()
    second = _claim(asset_id="asset_two", object_key="generated/agents/two.webp")
    repository = FakeRetentionRepository(
        claims=[first, second],
        metrics=GeneratedAssetCleanupMetrics(
            retryable_expired_assets=3,
            oldest_retryable_expiry=_now() - timedelta(minutes=2, seconds=4),
        ),
    )
    storage = RecordingStorage()
    service = GeneratedAssetRetentionService(repository, storage, now=_now)

    report = await service.cleanup_expired_assets()

    assert storage.deleted_paths == [
        "/memes/generated/agents/one.png",
        "/memes/generated/agents/two.webp",
    ]
    assert [claim.id for claim, _ in repository.deleted] == ["asset_one", "asset_two"]
    assert repository.failed == []
    assert report.claimed == 2
    assert report.deleted == 2
    assert report.failed == 0
    assert report.remaining_retryable_assets == 3
    assert report.oldest_retryable_lag_seconds == 124
    assert repository.claim_calls == [
        {
            "as_of": _now(),
            "batch_size": 100,
            "max_deletion_attempts": 5,
            "claim_timeout": DEFAULT_CLAIM_TIMEOUT,
        }
    ]


async def test_cleanup_marks_invalid_persisted_key_as_non_retryable_without_storage_call() -> None:
    claim = _claim(object_key="generated/agents/../other.png")
    repository = FakeRetentionRepository(
        claims=[claim],
        metrics=GeneratedAssetCleanupMetrics(0, None),
    )
    storage = RecordingStorage()
    service = GeneratedAssetRetentionService(repository, storage, now=_now)

    report = await service.cleanup_expired_assets()

    assert storage.deleted_paths == []
    assert repository.deleted == []
    assert [(failed_claim.id, code) for failed_claim, _, code in repository.failed] == [
        ("asset_one", "invalid_object_key")
    ]
    assert report.failed == 1


@pytest.mark.parametrize(
    ("error", "expected_code"),
    [
        (OSError("disk unavailable"), "storage_io_error"),
        (
            ClientError({"Error": {"Code": "AccessDenied"}}, "DeleteObject"),
            "storage_access_error",
        ),
        (
            ClientError({"Error": {"Code": "SlowDown"}}, "DeleteObject"),
            "storage_throttled",
        ),
    ],
)
async def test_cleanup_persists_only_bounded_storage_failure_categories(
    error: Exception,
    expected_code: str,
) -> None:
    claim = _claim()
    path = "/memes/generated/agents/one.png"
    repository = FakeRetentionRepository(
        claims=[claim],
        metrics=GeneratedAssetCleanupMetrics(1, _now() - timedelta(seconds=1)),
    )
    service = GeneratedAssetRetentionService(
        repository,
        RecordingStorage({path: error}),
        now=_now,
    )

    report = await service.cleanup_expired_assets()

    assert repository.deleted == []
    assert [(failed_claim.id, code) for failed_claim, _, code in repository.failed] == [
        ("asset_one", expected_code)
    ]
    assert report.failed == 1


def test_cleanup_validates_bounded_batch_and_retry_limits() -> None:
    repository = FakeRetentionRepository([], GeneratedAssetCleanupMetrics(0, None))
    storage = RecordingStorage()

    with pytest.raises(ValueError, match="batch_size"):
        GeneratedAssetRetentionService(repository, storage, batch_size=101)
    with pytest.raises(ValueError, match="max_deletion_attempts"):
        GeneratedAssetRetentionService(repository, storage, max_deletion_attempts=0)
    with pytest.raises(ValueError, match="claim_timeout"):
        GeneratedAssetRetentionService(repository, storage, claim_timeout=timedelta(seconds=59))


async def test_cleanup_rejects_a_naive_clock_before_claiming() -> None:
    repository = FakeRetentionRepository([], GeneratedAssetCleanupMetrics(0, None))
    service = GeneratedAssetRetentionService(
        repository,
        RecordingStorage(),
        now=lambda: datetime(2026, 8, 24, 12, 0),
    )

    with pytest.raises(ValueError, match="timezone-aware"):
        await service.cleanup_expired_assets()
    assert repository.claim_calls == []


def test_claim_query_skips_fresh_pending_and_reclaims_stale_pending_under_attempt_limit() -> None:
    statement = _claim_expired_assets_statement(
        as_of=_now(),
        batch_size=7,
        max_deletion_attempts=5,
        claim_timeout=timedelta(minutes=15),
    )
    sql = str(
        statement.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )

    assert "FOR UPDATE SKIP LOCKED" in sql
    assert "ORDER BY generated_assets.expires_at, generated_assets.id" in sql
    assert "LIMIT 7" in sql
    assert "generated_assets.expires_at <= '2026-08-24 12:00:00+00:00'" in sql
    assert "generated_assets.deletion_state = 'active'" in sql
    assert "generated_assets.deletion_state = 'failed'" in sql
    assert "generated_assets.deletion_state = 'pending'" in sql
    assert "generated_assets.deletion_attempts < 5" in sql
    assert "'invalid_object_key'" in sql
    assert "generated_assets.last_deletion_attempt_at <= '2026-08-24 11:45:00+00:00'" in sql


def test_cleanup_metrics_include_only_stale_retryable_pending_assets() -> None:
    statement = _cleanup_metrics_statement(
        as_of=_now(),
        max_deletion_attempts=5,
        claim_timeout=timedelta(minutes=15),
    )
    sql = str(
        statement.compile(
            dialect=postgresql.dialect(),
            compile_kwargs={"literal_binds": True},
        )
    )

    assert "count(generated_assets.id)" in sql
    assert "min(generated_assets.expires_at)" in sql
    assert "generated_assets.deletion_state = 'pending'" in sql
    assert "generated_assets.deletion_attempts < 5" in sql
    assert "generated_assets.last_deletion_attempt_at <= '2026-08-24 11:45:00+00:00'" in sql


async def test_unexpected_storage_programming_errors_remain_visible() -> None:
    claim = _claim()
    path = "/memes/generated/agents/one.png"
    repository = FakeRetentionRepository(
        claims=[claim],
        metrics=GeneratedAssetCleanupMetrics(0, None),
    )
    service = GeneratedAssetRetentionService(
        repository,
        RecordingStorage({path: RuntimeError("storage adapter bug")}),
        now=_now,
    )

    with pytest.raises(RuntimeError, match="storage adapter bug"):
        await service.cleanup_expired_assets()

    assert repository.deleted == []
    assert repository.failed == []
