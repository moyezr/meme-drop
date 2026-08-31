from __future__ import annotations

import asyncio
import hashlib
import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from uuid import UUID

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select, text

from memedrop_api.db import (
    Base,
    Database,
    TrendCardRecord,
    TrendCreditPeriodRecord,
    TrendCreditReservationRecord,
    TrendObservationRecord,
    TrendScanQueryRecord,
)
from memedrop_api.services.tavily_trends import TrendEnrichmentBatch
from memedrop_api.trend_collection_store import SqlAlchemyTrendCollectionStore
from memedrop_api.trends import (
    TrendCard,
    TrendDuration,
    TrendEvidenceState,
    TrendLifecycle,
    TrendObservation,
    assess_trend,
    trend_id_for_key,
)

pytestmark = pytest.mark.integration
TEST_DATABASE_URL = os.environ.get("MEMEDROP_TEST_DATABASE_URL")
NOW = datetime(2026, 8, 19, 12, tzinfo=UTC)
QUERY_FINGERPRINT = "a" * 64


@pytest_asyncio.fixture
async def database() -> AsyncIterator[Database]:
    if not TEST_DATABASE_URL:
        pytest.skip("MEMEDROP_TEST_DATABASE_URL is not configured")
    database = Database(TEST_DATABASE_URL)
    async with database.engine.begin() as connection:
        await connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await connection.run_sync(Base.metadata.create_all)
    try:
        yield database
    finally:
        await database.close()


async def test_scan_claims_are_atomic_leased_and_worker_fenced(database: Database) -> None:
    scan_id = "claim-integration-20260819"
    first = SqlAlchemyTrendCollectionStore(
        database, claim_lease=timedelta(minutes=1), worker_id="claim-worker-1"
    )
    second = SqlAlchemyTrendCollectionStore(
        database, claim_lease=timedelta(minutes=1), worker_id="claim-worker-2"
    )
    await _delete_scan(database, scan_id)
    try:
        assert await first.claim_scan_query(
            scan_id=scan_id,
            query_fingerprint=QUERY_FINGERPRINT,
            claimed_at=NOW,
        )
        assert not await second.claim_scan_query(
            scan_id=scan_id,
            query_fingerprint=QUERY_FINGERPRINT,
            claimed_at=NOW + timedelta(seconds=30),
        )
        assert await second.claim_scan_query(
            scan_id=scan_id,
            query_fingerprint=QUERY_FINGERPRINT,
            claimed_at=NOW + timedelta(minutes=1),
        )

        await first.release_scan_query(
            scan_id=scan_id, query_fingerprint=QUERY_FINGERPRINT
        )
        async with database.session() as session:
            row = await session.get(TrendScanQueryRecord, (scan_id, QUERY_FINGERPRINT))
            assert row is not None
            assert (row.status, row.claimed_by, row.attempt_count) == (
                "claimed",
                "claim-worker-2",
                2,
            )

        with pytest.raises(RuntimeError, match="not owned"):
            await first.commit_scan_query(
                scan_id=scan_id,
                query_fingerprint=QUERY_FINGERPRINT,
                enrichment=TrendEnrichmentBatch(),
                completed_at=NOW + timedelta(minutes=2),
            )

        await second.release_scan_query(
            scan_id=scan_id, query_fingerprint=QUERY_FINGERPRINT
        )
        assert await first.claim_scan_query(
            scan_id=scan_id,
            query_fingerprint=QUERY_FINGERPRINT,
            claimed_at=NOW + timedelta(minutes=2),
        )
    finally:
        await _delete_scan(database, scan_id)


async def test_monthly_credit_reservations_are_atomic_bounded_and_idempotent(
    database: Database,
) -> None:
    period = "2026-08"
    stores = (
        SqlAlchemyTrendCollectionStore(database, worker_id="credit-worker-1"),
        SqlAlchemyTrendCollectionStore(database, worker_id="credit-worker-2"),
    )
    await _delete_credit_period(database, period)
    try:
        results = await asyncio.gather(
            stores[0].reserve_monthly_credits(
                period=period,
                credits=1,
                hard_limit=1,
                reservation_id="concurrent-reservation-1",
                reserved_at=NOW,
            ),
            stores[1].reserve_monthly_credits(
                period=period,
                credits=1,
                hard_limit=1,
                reservation_id="concurrent-reservation-2",
                reserved_at=NOW,
            ),
        )
        assert sorted(results) == [False, True]
        winning_id = f"concurrent-reservation-{results.index(True) + 1}"
        assert await stores[0].reserve_monthly_credits(
            period=period,
            credits=1,
            hard_limit=1,
            reservation_id=winning_id,
            reserved_at=NOW + timedelta(minutes=1),
        )
        with pytest.raises(ValueError, match="different inputs"):
            await stores[0].reserve_monthly_credits(
                period=period,
                credits=2,
                hard_limit=2,
                reservation_id=winning_id,
                reserved_at=NOW + timedelta(minutes=1),
            )

        async with database.session() as session:
            period_row = await session.get(TrendCreditPeriodRecord, period)
            reservations = await session.scalar(
                select(func.count(TrendCreditReservationRecord.reservation_id)).where(
                    TrendCreditReservationRecord.period == period
                )
            )
            assert period_row is not None
            assert period_row.reserved_credits == 1
            assert reservations == 1
    finally:
        await _delete_credit_period(database, period)


async def test_commit_is_atomic_replay_safe_and_history_aware(database: Database) -> None:
    trend_key = "collection-store-integration"
    trend_id = trend_id_for_key(trend_key)
    scan_ids = ("commit-integration-1", "commit-integration-2", "commit-integration-3")
    store = SqlAlchemyTrendCollectionStore(database, worker_id="commit-worker")
    await _delete_trend_and_scans(database, trend_id, scan_ids)
    try:
        card = _candidate_card(trend_key, confirmed_at=NOW)
        observations = (
            _observation(
                trend_id=trend_id,
                path="first",
                observed_at=NOW,
                published_at=NOW - timedelta(days=1),
            ),
            _observation(
                trend_id=trend_id,
                path="second",
                observed_at=NOW,
                published_at=NOW - timedelta(hours=12),
            ),
        )
        batch = TrendEnrichmentBatch(cards=(card,), observations=observations)
        assert await store.claim_scan_query(
            scan_id=scan_ids[0], query_fingerprint=QUERY_FINGERPRINT, claimed_at=NOW
        )
        first = await store.commit_scan_query(
            scan_id=scan_ids[0],
            query_fingerprint=QUERY_FINGERPRINT,
            enrichment=batch,
            completed_at=NOW + timedelta(minutes=1),
        )
        assert (first.cards_upserted, first.observations_stored) == (1, 2)

        repeated_commit = await store.commit_scan_query(
            scan_id=scan_ids[0],
            query_fingerprint=QUERY_FINGERPRINT,
            enrichment=batch,
            completed_at=NOW + timedelta(minutes=2),
        )
        assert repeated_commit == first

        stored = await _stored_card(database, trend_id)
        expected_assessment = assess_trend(
            TrendEvidenceState(
                first_seen_at=NOW - timedelta(days=1),
                last_confirmed_at=NOW,
                confidence=card.confidence,
                momentum=card.momentum,
                source_count=1,
                observation_count=2,
            ),
            as_of=NOW + timedelta(minutes=1),
        )
        assert stored.first_seen_at == NOW - timedelta(days=1)
        assert stored.version == 1
        assert (stored.source_count, stored.observation_count) == (1, 2)
        assert stored.lifecycle == expected_assessment.lifecycle.value
        assert stored.duration_class == expected_assessment.duration_class.value
        assert stored.expires_at == expected_assessment.expires_at
        assert stored.vitality == expected_assessment.vitality

        assert await store.claim_scan_query(
            scan_id=scan_ids[1],
            query_fingerprint=QUERY_FINGERPRINT,
            claimed_at=NOW + timedelta(minutes=2),
        )
        replay = await store.commit_scan_query(
            scan_id=scan_ids[1],
            query_fingerprint=QUERY_FINGERPRINT,
            enrichment=batch,
            completed_at=NOW + timedelta(minutes=3),
        )
        assert replay.observations_stored == 0
        replayed_card = await _stored_card(database, trend_id)
        assert (replayed_card.source_count, replayed_card.observation_count) == (1, 2)

        recurrence_time = stored.expires_at + timedelta(hours=1)
        recurring_card = _candidate_card(trend_key, confirmed_at=recurrence_time)
        recurring_observation = _observation(
            trend_id=trend_id,
            path="recurrence",
            observed_at=recurrence_time,
            published_at=recurrence_time - timedelta(hours=1),
        )
        assert await store.claim_scan_query(
            scan_id=scan_ids[2],
            query_fingerprint=QUERY_FINGERPRINT,
            claimed_at=recurrence_time,
        )
        await store.commit_scan_query(
            scan_id=scan_ids[2],
            query_fingerprint=QUERY_FINGERPRINT,
            enrichment=TrendEnrichmentBatch(
                cards=(recurring_card,), observations=(recurring_observation,)
            ),
            completed_at=recurrence_time + timedelta(minutes=1),
        )
        recurring = await _stored_card(database, trend_id)
        assert recurring.first_seen_at == NOW - timedelta(days=1)
        assert recurring.recurrence_count == 1
        assert (recurring.source_count, recurring.observation_count) == (1, 3)
    finally:
        await _delete_trend_and_scans(database, trend_id, scan_ids)


async def test_invalid_enrichment_rolls_back_without_completing_claim(
    database: Database,
) -> None:
    scan_id = "invalid-enrichment-integration"
    trend_id = trend_id_for_key("missing-enrichment-card")
    store = SqlAlchemyTrendCollectionStore(database, worker_id="rollback-worker")
    await _delete_trend_and_scans(database, trend_id, (scan_id,))
    try:
        assert await store.claim_scan_query(
            scan_id=scan_id,
            query_fingerprint=QUERY_FINGERPRINT,
            claimed_at=NOW,
        )
        observation = _observation(
            trend_id=trend_id,
            path="missing",
            observed_at=NOW,
            published_at=NOW - timedelta(hours=1),
        )
        with pytest.raises(ValueError, match="existing or enriched"):
            await store.commit_scan_query(
                scan_id=scan_id,
                query_fingerprint=QUERY_FINGERPRINT,
                enrichment=TrendEnrichmentBatch(observations=(observation,)),
                completed_at=NOW + timedelta(minutes=1),
            )

        async with database.session() as session:
            claim = await session.get(
                TrendScanQueryRecord, (scan_id, QUERY_FINGERPRINT)
            )
            cards = await session.scalar(
                select(func.count(TrendCardRecord.id)).where(
                    TrendCardRecord.id == trend_id
                )
            )
            observations = await session.scalar(
                select(func.count(TrendObservationRecord.id)).where(
                    TrendObservationRecord.trend_id == trend_id
                )
            )
            assert claim is not None
            assert claim.status == "claimed"
            assert cards == observations == 0
    finally:
        await _delete_trend_and_scans(database, trend_id, (scan_id,))


def _candidate_card(key: str, *, confirmed_at: datetime) -> TrendCard:
    return TrendCard(
        id=trend_id_for_key(key),
        key=key,
        name="Collection store integration",
        premise="A normalized trend candidate for persistence testing.",
        entities=("integration",),
        topics=("testing",),
        recognition_cues=("durable evidence",),
        comic_tensions=("provisional claims versus durable state",),
        usage_guidance="Use only in the trend collection persistence test.",
        avoid_guidance=("Do not retain provider excerpts.",),
        lifecycle=TrendLifecycle.ESTABLISHED,
        duration_class=TrendDuration.PERSISTENT,
        first_seen_at=confirmed_at - timedelta(days=30),
        last_confirmed_at=confirmed_at,
        expires_at=confirmed_at + timedelta(days=28),
        confidence=0.8,
        momentum=0.75,
        vitality=0.95,
        source_count=8,
        observation_count=10,
        recurrence_count=7,
    )


def _observation(
    *,
    trend_id: UUID,
    path: str,
    observed_at: datetime,
    published_at: datetime,
) -> TrendObservation:
    return TrendObservation.from_evidence(
        trend_id=trend_id,
        provider="tavily",
        source_url=f"https://example.test/trends/{path}",
        content_hash=hashlib.sha256(path.encode()).hexdigest(),
        observed_at=observed_at,
        published_at=published_at,
        provider_score=0.9,
        query_fingerprint=QUERY_FINGERPRINT,
    )


async def _stored_card(database: Database, trend_id: UUID) -> TrendCardRecord:
    async with database.session() as session:
        row = await session.get(TrendCardRecord, trend_id)
        assert row is not None
        return row


async def _delete_scan(database: Database, scan_id: str) -> None:
    async with database.session() as session, session.begin():
        await session.execute(
            delete(TrendScanQueryRecord).where(TrendScanQueryRecord.scan_id == scan_id)
        )


async def _delete_credit_period(database: Database, period: str) -> None:
    async with database.session() as session, session.begin():
        await session.execute(
            delete(TrendCreditReservationRecord).where(
                TrendCreditReservationRecord.period == period
            )
        )
        await session.execute(
            delete(TrendCreditPeriodRecord).where(TrendCreditPeriodRecord.period == period)
        )


async def _delete_trend_and_scans(
    database: Database, trend_id: UUID, scan_ids: tuple[str, ...]
) -> None:
    async with database.session() as session, session.begin():
        await session.execute(
            delete(TrendScanQueryRecord).where(TrendScanQueryRecord.scan_id.in_(scan_ids))
        )
        await session.execute(
            delete(TrendObservationRecord).where(
                TrendObservationRecord.trend_id == trend_id
            )
        )
        await session.execute(
            delete(TrendCardRecord).where(TrendCardRecord.id == trend_id)
        )
