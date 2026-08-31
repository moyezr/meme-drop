from __future__ import annotations

import re
from datetime import UTC, datetime, timedelta
from uuid import uuid4

from sqlalchemy import and_, or_, select, text, update
from sqlalchemy.dialects.postgresql import insert

from memedrop_api.db import (
    Database,
    TrendCreditPeriodRecord,
    TrendCreditReservationRecord,
    TrendScanQueryRecord,
)
from memedrop_api.services.tavily_trends import (
    TrendCommitResult,
    TrendEnrichmentBatch,
)
from memedrop_api.trend_repository import SqlAlchemyTrendRepository

_SCAN_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_FINGERPRINT_PATTERN = re.compile(r"^[a-f0-9]{64}$")
_PERIOD_PATTERN = re.compile(r"^[0-9]{4}-(?:0[1-9]|1[0-2])$")
_RESERVATION_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")
_WORKER_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$")
_MINIMUM_LEASE = timedelta(minutes=1)
_MAXIMUM_LEASE = timedelta(hours=24)


class SqlAlchemyTrendCollectionStore:
    """PostgreSQL-backed collector state with leased, worker-fenced claims."""

    def __init__(
        self,
        database: Database,
        *,
        claim_lease: timedelta = timedelta(minutes=15),
        worker_id: str | None = None,
    ) -> None:
        if not _MINIMUM_LEASE <= claim_lease <= _MAXIMUM_LEASE:
            raise ValueError("claim lease must be between 1 minute and 24 hours")
        resolved_worker_id = worker_id or uuid4().hex
        if not _WORKER_ID_PATTERN.fullmatch(resolved_worker_id):
            raise ValueError("worker id must be an opaque identifier")
        self.database = database
        self.claim_lease = claim_lease
        self.worker_id = resolved_worker_id
        self.repository = SqlAlchemyTrendRepository(database)

    async def claim_scan_query(
        self,
        *,
        scan_id: str,
        query_fingerprint: str,
        claimed_at: datetime,
    ) -> bool:
        _validate_scan_identity(scan_id, query_fingerprint)
        _validate_aware_time(claimed_at, field_name="claimed_at")
        lease_expires_at = claimed_at + self.claim_lease
        insert_statement = insert(TrendScanQueryRecord).values(
            scan_id=scan_id,
            query_fingerprint=query_fingerprint,
            status="claimed",
            claimed_by=self.worker_id,
            claimed_at=claimed_at,
            lease_expires_at=lease_expires_at,
            completed_at=None,
            attempt_count=1,
            cards_upserted=0,
            observations_stored=0,
        )
        claim_statement = insert_statement.on_conflict_do_update(
            index_elements=[
                TrendScanQueryRecord.scan_id,
                TrendScanQueryRecord.query_fingerprint,
            ],
            set_={
                "status": "claimed",
                "claimed_by": self.worker_id,
                "claimed_at": claimed_at,
                "lease_expires_at": lease_expires_at,
                "completed_at": None,
                "attempt_count": TrendScanQueryRecord.attempt_count + 1,
                "cards_upserted": 0,
                "observations_stored": 0,
            },
            where=or_(
                TrendScanQueryRecord.status == "released",
                and_(
                    TrendScanQueryRecord.status == "claimed",
                    TrendScanQueryRecord.lease_expires_at <= claimed_at,
                ),
            ),
        ).returning(TrendScanQueryRecord.scan_id)
        async with self.database.session() as session, session.begin():
            claimed = await session.scalar(claim_statement)
        return claimed is not None

    async def reserve_monthly_credits(
        self,
        *,
        period: str,
        credits: int,
        hard_limit: int,
        reservation_id: str,
        reserved_at: datetime,
    ) -> bool:
        _validate_credit_reservation(
            period=period,
            credits=credits,
            hard_limit=hard_limit,
            reservation_id=reservation_id,
            reserved_at=reserved_at,
        )
        async with self.database.session() as session, session.begin():
            # A reservation-scoped lock makes the idempotency key safe even if a buggy caller
            # reuses it across periods. The period lock then serializes the hard-limit check.
            await session.execute(
                text("SELECT pg_advisory_xact_lock(hashtextextended(:value, 0))"),
                {"value": reservation_id},
            )
            existing = await session.get(TrendCreditReservationRecord, reservation_id)
            if existing is not None:
                if existing.period != period or existing.credits != credits:
                    raise ValueError("reservation id was already used with different inputs")
                return True

            await session.execute(
                text("SELECT pg_advisory_xact_lock(hashtextextended(:value, 1))"),
                {"value": period},
            )
            period_row = await session.get(TrendCreditPeriodRecord, period)
            current_credits = period_row.reserved_credits if period_row is not None else 0
            if current_credits + credits > hard_limit:
                return False
            if period_row is None:
                period_row = TrendCreditPeriodRecord(
                    period=period,
                    reserved_credits=credits,
                    updated_at=reserved_at,
                )
                session.add(period_row)
            else:
                period_row.reserved_credits += credits
                period_row.updated_at = reserved_at
            session.add(
                TrendCreditReservationRecord(
                    reservation_id=reservation_id,
                    period=period,
                    credits=credits,
                    reserved_at=reserved_at,
                )
            )
        return True

    async def commit_scan_query(
        self,
        *,
        scan_id: str,
        query_fingerprint: str,
        enrichment: TrendEnrichmentBatch,
        completed_at: datetime,
    ) -> TrendCommitResult:
        _validate_scan_identity(scan_id, query_fingerprint)
        _validate_aware_time(completed_at, field_name="completed_at")
        async with self.database.session() as session, session.begin():
            claim = await session.scalar(
                select(TrendScanQueryRecord)
                .where(
                    TrendScanQueryRecord.scan_id == scan_id,
                    TrendScanQueryRecord.query_fingerprint == query_fingerprint,
                )
                .with_for_update()
            )
            if claim is None:
                raise RuntimeError("scan query was not claimed")
            if claim.status == "completed":
                return TrendCommitResult(
                    cards_upserted=claim.cards_upserted,
                    observations_stored=claim.observations_stored,
                )
            if claim.status != "claimed" or claim.claimed_by != self.worker_id:
                raise RuntimeError("scan query claim is not owned by this worker")
            if completed_at < claim.claimed_at:
                raise ValueError("completed_at must not precede claimed_at")

            write = await self.repository.persist_canonical_enrichment(
                session,
                cards=enrichment.cards,
                observations=enrichment.observations,
                assessed_at=completed_at,
            )
            result = TrendCommitResult(
                cards_upserted=len(write.cards),
                observations_stored=write.observations_created,
            )
            claim.status = "completed"
            claim.claimed_by = None
            claim.lease_expires_at = None
            claim.completed_at = completed_at
            claim.cards_upserted = result.cards_upserted
            claim.observations_stored = result.observations_stored
            return result

    async def release_scan_query(
        self,
        *,
        scan_id: str,
        query_fingerprint: str,
    ) -> None:
        _validate_scan_identity(scan_id, query_fingerprint)
        statement = (
            update(TrendScanQueryRecord)
            .where(
                TrendScanQueryRecord.scan_id == scan_id,
                TrendScanQueryRecord.query_fingerprint == query_fingerprint,
                TrendScanQueryRecord.status == "claimed",
                TrendScanQueryRecord.claimed_by == self.worker_id,
            )
            .values(
                status="released",
                claimed_by=None,
                lease_expires_at=None,
            )
        )
        async with self.database.session() as session, session.begin():
            await session.execute(statement)


def _validate_scan_identity(scan_id: str, query_fingerprint: str) -> None:
    if not _SCAN_ID_PATTERN.fullmatch(scan_id):
        raise ValueError("scan id must be an opaque identifier")
    if not _FINGERPRINT_PATTERN.fullmatch(query_fingerprint):
        raise ValueError("query fingerprint must be a SHA-256 digest")


def _validate_credit_reservation(
    *,
    period: str,
    credits: int,
    hard_limit: int,
    reservation_id: str,
    reserved_at: datetime,
) -> None:
    if not _PERIOD_PATTERN.fullmatch(period):
        raise ValueError("period must use YYYY-MM format")
    if not 1 <= credits <= 1_000:
        raise ValueError("credits must be between 1 and 1000")
    if not 1 <= hard_limit <= 1_000:
        raise ValueError("hard limit must be between 1 and 1000")
    if not _RESERVATION_ID_PATTERN.fullmatch(reservation_id):
        raise ValueError("reservation id must be an opaque identifier")
    _validate_aware_time(reserved_at, field_name="reserved_at")
    if reserved_at.astimezone(UTC).strftime("%Y-%m") != period:
        raise ValueError("period must match reserved_at")


def _validate_aware_time(value: datetime, *, field_name: str) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must be timezone-aware")
