from __future__ import annotations

import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta

import pytest
import pytest_asyncio
from sqlalchemy import delete, text

from memedrop_api.db import (
    Base,
    Database,
    TrendCardRecord,
    TrendObservationRecord,
    TrendSnapshotRecord,
)
from memedrop_api.services.trend_embeddings import trend_card_embedding_fingerprint
from memedrop_api.trend_repository import SqlAlchemyTrendRepository
from memedrop_api.trends import (
    TrendCard,
    TrendDuration,
    TrendLifecycle,
    TrendObservation,
    trend_id_for_key,
)

pytestmark = pytest.mark.integration
TEST_DATABASE_URL = os.environ.get("MEMEDROP_TEST_DATABASE_URL")
NOW = datetime(2026, 8, 19, 12, tzinfo=UTC)


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


async def test_trend_repository_is_idempotent_and_snapshots_are_repeatable(
    database: Database,
) -> None:
    repository = SqlAlchemyTrendRepository(database)
    card = _card("integration-trend-memory")
    first_observation = TrendObservation.from_evidence(
        trend_id=card.id,
        provider="tavily",
        source_url="https://example.test/trends/integration?utm_source=test",
        content_hash="a" * 64,
        observed_at=NOW,
        provider_score=0.9,
        query_fingerprint="b" * 64,
    )
    try:
        fingerprint = trend_card_embedding_fingerprint(card)
        stored = await repository.upsert_card(
            card,
            embedding=[1.0] + [0.0] * 1_535,
            embedding_model="google/gemini-embedding-2",
            embedding_fingerprint=fingerprint,
        )
        unchanged = await repository.upsert_card(
            card,
            embedding=[1.0] + [0.0] * 1_535,
            embedding_model="google/gemini-embedding-2",
            embedding_fingerprint=fingerprint,
        )
        assert stored.version == unchanged.version == 1
        assert await repository.list_stale_embedding_ids(
            {card.id: fingerprint}, model="google/gemini-embedding-2"
        ) == set()
        assert await repository.list_stale_embedding_ids(
            {card.id: fingerprint}, model="provider/new-embedding-space"
        ) == {card.id}

        await repository.upsert_card(card.model_copy(update={"momentum": 0.1}))
        assert await repository.list_stale_embedding_ids(
            {card.id: fingerprint}, model="google/gemini-embedding-2"
        ) == set()

        semantic_change = card.model_copy(
            update={"premise": "A changed premise requires a fresh semantic vector."}
        )
        semantic_stored = await repository.upsert_card(semantic_change)
        changed_fingerprint = trend_card_embedding_fingerprint(semantic_change)
        assert await repository.list_stale_embedding_ids(
            {card.id: changed_fingerprint}, model="google/gemini-embedding-2"
        ) == {card.id}
        assert (
            await repository.store_card_embeddings(
                [
                    (
                        card.id,
                        [0.5] + [0.0] * 1_535,
                        changed_fingerprint,
                        semantic_stored.version,
                    )
                ],
                model="google/gemini-embedding-2",
            )
            == 1
        )
        assert (
            await repository.store_card_embeddings(
                [
                    (
                        card.id,
                        [0.5] + [0.0] * 1_535,
                        changed_fingerprint,
                        semantic_stored.version,
                    )
                ],
                model="google/gemini-embedding-2",
            )
            == 0
        )
        assert await repository.list_stale_embedding_ids(
            {card.id: changed_fingerprint}, model="google/gemini-embedding-2"
        ) == set()

        raced_card = semantic_change.model_copy(
            update={"premise": "A concurrent semantic change wins the race."}
        )
        raced_stored = await repository.upsert_card(raced_card)
        assert raced_stored.version > semantic_stored.version
        assert (
            await repository.store_card_embeddings(
                [
                    (
                        card.id,
                        [0.25] + [0.0] * 1_535,
                        changed_fingerprint,
                        semantic_stored.version,
                    )
                ],
                model="google/gemini-embedding-2",
            )
            == 0
        )
        assert await repository.list_stale_embedding_ids(
            {card.id: trend_card_embedding_fingerprint(raced_card)},
            model="google/gemini-embedding-2",
        ) == {card.id}
        assert (
            await repository.store_card_embeddings(
                [
                    (
                        card.id,
                        [1.0] + [0.0] * 1_535,
                        trend_card_embedding_fingerprint(raced_card),
                        raced_stored.version,
                    )
                ],
                model="google/gemini-embedding-2",
            )
            == 1
        )

        first = await repository.record_observation(first_observation)
        replay = await repository.record_observation(first_observation)
        later = await repository.record_observation(
            first_observation.model_copy(update={"observed_at": NOW + timedelta(hours=1)})
        )
        assert (first.changed, first.seen_count) == (True, 1)
        assert (replay.changed, replay.seen_count) == (False, 1)
        assert (later.changed, later.seen_count) == (True, 2)

        matches = await repository.search_active_by_embedding(
            [1.0] + [0.0] * 1_535,
            model="google/gemini-embedding-2",
            eligible_card_versions={card.id: raced_stored.version},
            as_of=NOW,
            limit=5,
        )
        assert card.id in {match.card.id for match in matches}
        assert await repository.search_active_by_embedding(
            [1.0] + [0.0] * 1_535,
            model="google/gemini-embedding-2",
            eligible_card_versions={card.id: semantic_stored.version},
            as_of=NOW,
            limit=5,
        ) == []
        assert await repository.search_active_by_embedding(
            [1.0] + [0.0] * 1_535,
            model="provider/different-embedding-space",
            eligible_card_versions={card.id: raced_stored.version},
            as_of=NOW,
            limit=5,
        ) == []
        assert await repository.search_active_by_embedding(
            [1.0] + [0.0] * 1_535,
            model="google/gemini-embedding-2",
            eligible_card_versions={
                trend_id_for_key("not-in-published-snapshot"): 1
            },
            as_of=NOW,
            limit=5,
        ) == []

        staged_snapshot = await repository.stage_snapshot([stored], created_at=NOW)
        assert staged_snapshot.published_at is None
        assert await repository.get_snapshot(staged_snapshot.version) is None
        assert await repository.get_snapshot() is None

        first_snapshot = await repository.mark_snapshot_published(
            staged_snapshot.version,
            published_at=NOW,
        )
        replayed_snapshot = await repository.publish_snapshot([stored], created_at=NOW)
        assert replayed_snapshot == first_snapshot
        assert await repository.get_snapshot(first_snapshot.version) == first_snapshot
        assert await repository.get_snapshot() == first_snapshot
    finally:
        async with database.session() as session, session.begin():
            await session.execute(delete(TrendSnapshotRecord))
            await session.execute(
                delete(TrendObservationRecord).where(TrendObservationRecord.trend_id == card.id)
            )
            await session.execute(delete(TrendCardRecord).where(TrendCardRecord.id == card.id))


def _card(key: str) -> TrendCard:
    return TrendCard(
        id=trend_id_for_key(key),
        key=key,
        name="Integration trend memory",
        premise="A bounded integration-test trend premise.",
        entities=("integration",),
        topics=("testing",),
        recognition_cues=("repeatable context",),
        comic_tensions=("freshness versus staleness",),
        usage_guidance="Use only for the repository integration test.",
        avoid_guidance=("Do not expose raw evidence.",),
        lifecycle=TrendLifecycle.RISING,
        duration_class=TrendDuration.FAST,
        first_seen_at=NOW - timedelta(days=2),
        last_confirmed_at=NOW,
        expires_at=NOW + timedelta(days=7),
        confidence=0.8,
        momentum=0.8,
        vitality=0.75,
        source_count=3,
        observation_count=4,
    )
