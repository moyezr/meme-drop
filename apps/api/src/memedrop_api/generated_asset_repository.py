from __future__ import annotations

from datetime import datetime, timedelta

from sqlalchemy import and_, func, or_, select, update

from memedrop_api.db import Database, GeneratedAsset
from memedrop_api.services.generated_asset_retention import (
    PERMANENT_DELETION_ERROR_CODES,
    ClaimedGeneratedAsset,
    GeneratedAssetCleanupMetrics,
)


class SqlAlchemyGeneratedAssetRetentionRepository:
    """PostgreSQL persistence for bounded, replay-safe asset cleanup."""

    def __init__(self, database: Database) -> None:
        self.database = database

    async def claim_expired_assets(
        self,
        *,
        as_of: datetime,
        batch_size: int,
        max_deletion_attempts: int,
        claim_timeout: timedelta,
    ) -> list[ClaimedGeneratedAsset]:
        _validate_claim_inputs(as_of, batch_size, max_deletion_attempts, claim_timeout)
        async with self.database.session() as session, session.begin():
            rows = (
                await session.scalars(
                    _claim_expired_assets_statement(
                        as_of=as_of,
                        batch_size=batch_size,
                        max_deletion_attempts=max_deletion_attempts,
                        claim_timeout=claim_timeout,
                    )
                )
            ).all()
            claims: list[ClaimedGeneratedAsset] = []
            for row in rows:
                row.deletion_state = "pending"
                row.deletion_attempts += 1
                row.last_deletion_attempt_at = as_of
                row.deletion_error_code = None
                row.updated_at = as_of
                claims.append(
                    ClaimedGeneratedAsset(
                        id=row.id,
                        object_key=row.object_key,
                        deletion_attempts=row.deletion_attempts,
                    )
                )
        return claims

    async def mark_deleted(
        self,
        claim: ClaimedGeneratedAsset,
        *,
        deleted_at: datetime,
    ) -> bool:
        _validate_aware_time(deleted_at, field_name="deleted_at")
        statement = (
            update(GeneratedAsset)
            .where(
                GeneratedAsset.id == claim.id,
                GeneratedAsset.deletion_state == "pending",
                GeneratedAsset.deletion_attempts == claim.deletion_attempts,
            )
            .values(
                deletion_state="deleted",
                deleted_at=deleted_at,
                deletion_error_code=None,
                updated_at=deleted_at,
            )
            .returning(GeneratedAsset.id)
        )
        async with self.database.session() as session, session.begin():
            updated_id = await session.scalar(statement)
        return updated_id is not None

    async def mark_failed(
        self,
        claim: ClaimedGeneratedAsset,
        *,
        failed_at: datetime,
        error_code: str,
    ) -> bool:
        _validate_aware_time(failed_at, field_name="failed_at")
        if error_code not in _DELETION_ERROR_CODES:
            raise ValueError("error_code is not an allowed deletion error category")
        statement = (
            update(GeneratedAsset)
            .where(
                GeneratedAsset.id == claim.id,
                GeneratedAsset.deletion_state == "pending",
                GeneratedAsset.deletion_attempts == claim.deletion_attempts,
            )
            .values(
                deletion_state="failed",
                deletion_error_code=error_code,
                updated_at=failed_at,
            )
            .returning(GeneratedAsset.id)
        )
        async with self.database.session() as session, session.begin():
            updated_id = await session.scalar(statement)
        return updated_id is not None

    async def cleanup_metrics(
        self,
        *,
        as_of: datetime,
        max_deletion_attempts: int,
        claim_timeout: timedelta,
    ) -> GeneratedAssetCleanupMetrics:
        _validate_claim_inputs(as_of, 1, max_deletion_attempts, claim_timeout)
        statement = _cleanup_metrics_statement(
            as_of=as_of,
            max_deletion_attempts=max_deletion_attempts,
            claim_timeout=claim_timeout,
        )
        async with self.database.session() as session:
            retryable_count, oldest_retryable, blocked_count, oldest_blocked = (
                await session.execute(statement)
            ).one()
        return GeneratedAssetCleanupMetrics(
            retryable_expired_assets=int(retryable_count or 0),
            oldest_retryable_expiry=oldest_retryable,
            blocked_expired_assets=int(blocked_count or 0),
            oldest_blocked_expiry=oldest_blocked,
        )


_DELETION_ERROR_CODES = frozenset(
    {
        "invalid_object_key",
        "storage_access_error",
        "storage_delete_error",
        "storage_io_error",
        "storage_throttled",
        "storage_transport_error",
    }
)


def _claim_expired_assets_statement(
    *,
    as_of: datetime,
    batch_size: int,
    max_deletion_attempts: int,
    claim_timeout: timedelta,
):
    return (
        select(GeneratedAsset)
        .where(
            GeneratedAsset.expires_at <= as_of,
            _retryable_expired_asset_condition(
                as_of=as_of,
                max_deletion_attempts=max_deletion_attempts,
                claim_timeout=claim_timeout,
            ),
        )
        .order_by(GeneratedAsset.expires_at, GeneratedAsset.id)
        .limit(batch_size)
        .with_for_update(skip_locked=True)
    )


def _cleanup_metrics_statement(
    *,
    as_of: datetime,
    max_deletion_attempts: int,
    claim_timeout: timedelta,
):
    retryable = _retryable_expired_asset_condition(
        as_of=as_of,
        max_deletion_attempts=max_deletion_attempts,
        claim_timeout=claim_timeout,
    )
    blocked = _blocked_expired_asset_condition(
        as_of=as_of,
        max_deletion_attempts=max_deletion_attempts,
        claim_timeout=claim_timeout,
    )
    return select(
        func.count(GeneratedAsset.id).filter(retryable),
        func.min(GeneratedAsset.expires_at).filter(retryable),
        func.count(GeneratedAsset.id).filter(blocked),
        func.min(GeneratedAsset.expires_at).filter(blocked),
    ).where(
        GeneratedAsset.expires_at <= as_of,
        or_(retryable, blocked),
    )


def _retryable_expired_asset_condition(
    *,
    as_of: datetime,
    max_deletion_attempts: int,
    claim_timeout: timedelta,
):
    retry_attempt_available = GeneratedAsset.deletion_attempts < max_deletion_attempts
    return or_(
        and_(GeneratedAsset.deletion_state == "active", retry_attempt_available),
        and_(
            GeneratedAsset.deletion_state == "failed",
            retry_attempt_available,
            or_(
                GeneratedAsset.deletion_error_code.is_(None),
                GeneratedAsset.deletion_error_code.not_in(PERMANENT_DELETION_ERROR_CODES),
            ),
        ),
        and_(
            GeneratedAsset.deletion_state == "pending",
            retry_attempt_available,
            GeneratedAsset.last_deletion_attempt_at.is_not(None),
            GeneratedAsset.last_deletion_attempt_at <= as_of - claim_timeout,
        ),
    )


def _blocked_expired_asset_condition(
    *,
    as_of: datetime,
    max_deletion_attempts: int,
    claim_timeout: timedelta,
):
    """Identify expired assets that cannot be claimed without operator action.

    A max-attempt pending row is still treated as in flight until its claim lease
    becomes stale. Once stale it is blocked, rather than retryable, because claiming
    it again would exceed the configured attempt ceiling.
    """

    attempts_exhausted = GeneratedAsset.deletion_attempts >= max_deletion_attempts
    stale_pending = and_(
        GeneratedAsset.deletion_state == "pending",
        attempts_exhausted,
        GeneratedAsset.last_deletion_attempt_at.is_not(None),
        GeneratedAsset.last_deletion_attempt_at <= as_of - claim_timeout,
    )
    permanent_failure = and_(
        GeneratedAsset.deletion_state == "failed",
        GeneratedAsset.deletion_error_code.in_(PERMANENT_DELETION_ERROR_CODES),
    )
    exhausted_terminal_attempt = and_(
        GeneratedAsset.deletion_state.in_(("active", "failed")),
        attempts_exhausted,
    )
    return or_(permanent_failure, exhausted_terminal_attempt, stale_pending)


def _validate_claim_inputs(
    as_of: datetime,
    batch_size: int,
    max_deletion_attempts: int,
    claim_timeout: timedelta,
) -> None:
    _validate_aware_time(as_of, field_name="as_of")
    if batch_size < 1 or batch_size > 100:
        raise ValueError("batch_size must be between 1 and 100")
    if max_deletion_attempts < 1 or max_deletion_attempts > 20:
        raise ValueError("max_deletion_attempts must be between 1 and 20")
    if not timedelta(minutes=1) <= claim_timeout <= timedelta(hours=24):
        raise ValueError("claim_timeout must be between 1 minute and 24 hours")


def _validate_aware_time(value: datetime, *, field_name: str) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must be timezone-aware")
