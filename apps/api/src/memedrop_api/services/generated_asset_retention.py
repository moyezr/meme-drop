from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from typing import Protocol

from botocore.exceptions import BotoCoreError, ClientError  # type: ignore[import-untyped]

from memedrop_api.services.storage import public_path_for_key

DEFAULT_CLEANUP_BATCH_SIZE = 100
DEFAULT_CLAIM_TIMEOUT = timedelta(minutes=15)
MAX_DELETION_ATTEMPTS = 5
PERMANENT_DELETION_ERROR_CODES = frozenset({"invalid_object_key"})
_MINIMUM_CLAIM_TIMEOUT = timedelta(minutes=1)
_MAXIMUM_CLAIM_TIMEOUT = timedelta(hours=24)


@dataclass(frozen=True, slots=True)
class ClaimedGeneratedAsset:
    """One durable asset claimed for one exact-key deletion attempt."""

    id: str
    object_key: str
    deletion_attempts: int


@dataclass(frozen=True, slots=True)
class GeneratedAssetCleanupMetrics:
    """Content-free backlog measurements after a cleanup pass."""

    retryable_expired_assets: int
    oldest_retryable_expiry: datetime | None
    blocked_expired_assets: int = 0
    oldest_blocked_expiry: datetime | None = None


@dataclass(frozen=True, slots=True)
class GeneratedAssetCleanupReport:
    """Bounded, content-free outcome of one generated-asset cleanup pass."""

    claimed: int
    deleted: int
    failed: int
    remaining_retryable_assets: int
    oldest_retryable_lag_seconds: int | None
    blocked_expired_assets: int = 0
    oldest_blocked_lag_seconds: int | None = None
    stale_generations_reconciled: int = 0


class GeneratedAssetRetentionRepository(Protocol):
    async def claim_expired_assets(
        self,
        *,
        as_of: datetime,
        batch_size: int,
        max_deletion_attempts: int,
        claim_timeout: timedelta,
    ) -> list[ClaimedGeneratedAsset]: ...

    async def mark_deleted(
        self,
        claim: ClaimedGeneratedAsset,
        *,
        deleted_at: datetime,
    ) -> bool: ...

    async def mark_failed(
        self,
        claim: ClaimedGeneratedAsset,
        *,
        failed_at: datetime,
        error_code: str,
    ) -> bool: ...

    async def cleanup_metrics(
        self,
        *,
        as_of: datetime,
        max_deletion_attempts: int,
        claim_timeout: timedelta,
    ) -> GeneratedAssetCleanupMetrics: ...


class MemeObjectDeleter(Protocol):
    async def delete(self, public_path: str) -> bool: ...


class StaleGenerationReconciler(Protocol):
    """Content-free accounting repair invoked by the maintenance cron."""

    async def reconcile_stale_generations(self) -> int: ...


class StaleGenerationReconciliationFailure(RuntimeError):
    """The bounded accounting repair did not complete in this cron delivery."""


class GeneratedAssetRetentionService:
    """Delete expired generated images while keeping a durable retry trail.

    Claims are persisted before storage deletion. That makes concurrent workers and
    replayed jobs safe: pending and deleted records are never selected again.
    """

    def __init__(
        self,
        repository: GeneratedAssetRetentionRepository,
        storage: MemeObjectDeleter,
        *,
        batch_size: int = DEFAULT_CLEANUP_BATCH_SIZE,
        max_deletion_attempts: int = MAX_DELETION_ATTEMPTS,
        claim_timeout: timedelta = DEFAULT_CLAIM_TIMEOUT,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        if batch_size < 1 or batch_size > DEFAULT_CLEANUP_BATCH_SIZE:
            raise ValueError(f"batch_size must be between 1 and {DEFAULT_CLEANUP_BATCH_SIZE}")
        if max_deletion_attempts < 1 or max_deletion_attempts > 20:
            raise ValueError("max_deletion_attempts must be between 1 and 20")
        if not _MINIMUM_CLAIM_TIMEOUT <= claim_timeout <= _MAXIMUM_CLAIM_TIMEOUT:
            raise ValueError("claim_timeout must be between 1 minute and 24 hours")
        self.repository = repository
        self.storage = storage
        self.batch_size = batch_size
        self.max_deletion_attempts = max_deletion_attempts
        self.claim_timeout = claim_timeout
        self.now = now or (lambda: datetime.now(UTC))

    async def cleanup_expired_assets(self) -> GeneratedAssetCleanupReport:
        as_of = _require_aware_time(self.now(), field_name="now")
        claims = await self.repository.claim_expired_assets(
            as_of=as_of,
            batch_size=self.batch_size,
            max_deletion_attempts=self.max_deletion_attempts,
            claim_timeout=self.claim_timeout,
        )

        deleted = 0
        failed = 0
        for claim in claims:
            error_code = await self._delete_claimed_asset(claim)
            completed_at = _require_aware_time(self.now(), field_name="now")
            if error_code is None:
                if await self.repository.mark_deleted(claim, deleted_at=completed_at):
                    deleted += 1
            elif await self.repository.mark_failed(
                claim,
                failed_at=completed_at,
                error_code=error_code,
            ):
                failed += 1

        metrics_as_of = _require_aware_time(self.now(), field_name="now")
        metrics = await self.repository.cleanup_metrics(
            as_of=metrics_as_of,
            max_deletion_attempts=self.max_deletion_attempts,
            claim_timeout=self.claim_timeout,
        )
        return GeneratedAssetCleanupReport(
            claimed=len(claims),
            deleted=deleted,
            failed=failed,
            remaining_retryable_assets=metrics.retryable_expired_assets,
            oldest_retryable_lag_seconds=_lag_seconds(
                metrics_as_of,
                metrics.oldest_retryable_expiry,
            ),
            blocked_expired_assets=metrics.blocked_expired_assets,
            oldest_blocked_lag_seconds=_lag_seconds(
                metrics_as_of,
                metrics.oldest_blocked_expiry,
            ),
        )

    async def _delete_claimed_asset(self, claim: ClaimedGeneratedAsset) -> str | None:
        try:
            # The key comes exclusively from the durable GeneratedAsset record. Turning it into
            # a public path preserves the storage boundary while deleting this one exact key.
            await self.storage.delete(public_path_for_key(claim.object_key))
        except ValueError:
            return "invalid_object_key"
        except ClientError as error:
            return _client_error_code(error)
        except BotoCoreError:
            return "storage_transport_error"
        except OSError:
            return "storage_io_error"
        return None


class GeneratedAssetMaintenanceService:
    """Run retention and stale-reservation reconciliation under one cron lease.

    The route owns authentication and distributed locking.  This composition
    keeps the two bounded maintenance actions in one protected delivery while
    preserving a small, content-free report for operators.
    """

    def __init__(
        self,
        retention: GeneratedAssetRetentionService,
        generations: StaleGenerationReconciler,
    ) -> None:
        self.retention = retention
        self.generations = generations

    async def cleanup_expired_assets(self) -> GeneratedAssetCleanupReport:
        report = await self.retention.cleanup_expired_assets()
        try:
            reconciled = await self.generations.reconcile_stale_generations()
        except Exception as error:
            raise StaleGenerationReconciliationFailure from error
        return replace(report, stale_generations_reconciled=reconciled)


def _client_error_code(error: ClientError) -> str:
    code = str(error.response.get("Error", {}).get("Code", "")).casefold()
    if code in {"accessdenied", "invalidaccesskeyid", "signaturedoesnotmatch"}:
        return "storage_access_error"
    if code in {"slowdown", "requesttimeout", "serviceunavailable"}:
        return "storage_throttled"
    return "storage_delete_error"


def _require_aware_time(value: datetime, *, field_name: str) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must be timezone-aware")
    return value


def _lag_seconds(as_of: datetime, oldest_expiry: datetime | None) -> int | None:
    if oldest_expiry is None:
        return None
    expiry = _require_aware_time(oldest_expiry, field_name="expiry")
    return max(0, int((as_of - expiry).total_seconds()))
