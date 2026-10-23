from __future__ import annotations

import asyncio
import importlib
import json
import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest
import pytest_asyncio
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Connection, delete, inspect, select, text

from memedrop_api.db import Base, Database, Meme, SuggestionPerformanceSample, UsageEvent
from memedrop_api.performance_baseline import load_performance_baseline
from memedrop_api.performance_metrics import PerformanceBatch, SqlAlchemyPerformanceStore
from memedrop_api.repositories import SqlAlchemyStore, UsageEventData

pytestmark = pytest.mark.integration
TEST_DATABASE_URL = os.environ.get("MEMEDROP_TEST_DATABASE_URL")


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


async def test_retry_deduplication_quantiles_coverage_and_matched_feedback(
    database: Database,
) -> None:
    store = SqlAlchemyPerformanceStore(database)
    ids = [uuid4() for _ in range(22)]
    rows = [
        {
            "event_id": str(event_id),
            "kind": "request",
            "platform": "x",
            "extension_version": "991.0.1",
            "outcome": "usable",
            "elapsed_ms": 1000.0 + index * 10,
            "first_usable_preview_ms": 900.0 + index * 10,
            "api_response_ms": 600.0 + index * 10,
            "suggestion_count": 2,
        }
        for index, event_id in enumerate(ids[:20])
    ]
    rows.extend(
        [
            {
                "event_id": str(ids[20]),
                "kind": "attachment",
                "platform": "linkedin",
                "extension_version": "991.0.1",
                "outcome": "inserted",
                "elapsed_ms": 400.0,
                "selected_preparation_ms": 100.0,
                "native_attachment_confirmation_ms": 300.0,
            },
            {
                "event_id": str(ids[21]),
                "kind": "attachment",
                "platform": "linkedin",
                "extension_version": "991.0.1",
                "outcome": "copied",
                "elapsed_ms": 4400.0,
                "selected_preparation_ms": 100.0,
            },
        ]
    )
    user_id, meme_id, impression = uuid4(), uuid4(), uuid4()
    usage = SqlAlchemyStore(database)
    cutoff = datetime.now(UTC) - timedelta(seconds=1)
    try:
        batch = PerformanceBatch.model_validate({"samples": rows[:20]})
        # Concurrent delivery of the identical batch records every random ID once.
        assert (
            sum(await asyncio.gather(store.record(batch.samples), store.record(batch.samples)))
            == 20
        )
        assert (
            await store.record(PerformanceBatch.model_validate({"samples": rows[20:]}).samples) == 2
        )
        assert await store.record(batch.samples) == 0
        await usage.ensure_install_user(user_id)
        async with database.session() as session, session.begin():
            session.add(
                Meme(
                    id=meme_id,
                    name="Synthetic private title",
                    file_path="/memes/fixture.png",
                    format_type="text_overlay",
                    is_evergreen=True,
                )
            )
        await usage.record_usage_batch(
            user_id=user_id,
            events=[
                UsageEventData(
                    meme_id=meme_id,
                    action=action,
                    tweet_context={},
                    source="global",
                    event_id=uuid4(),
                    telemetry_version=2,
                    impression_id=impression,
                    position=1,
                )
                for action in ["shown", "clicked", "inserted", "inserted", "copied"]
            ],
        )
        report = await load_performance_baseline(database, days=1, since=cutoff)
        request = next(
            row
            for row in report["slices"]
            if row["extension_version"] == "991.0.1" and row["kind"] == "request"
        )
        metric = request["metrics"]["first_usable_preview_ms"]
        assert metric == {
            "samples": 20,
            "coverage": 1.0,
            "p50": 995.0,
            "p95": 1080.5,
            "status": "observed",
        }
        attachment = next(
            row
            for row in report["slices"]
            if row["extension_version"] == "991.0.1" and row["kind"] == "attachment"
        )
        assert attachment["outcomes"] == {"inserted": 1, "copied": 1}
        assert attachment["metrics"]["native_attachment_confirmation_ms"]["coverage"] == 0.5
        assert attachment["metrics"]["native_attachment_confirmation_ms"]["p95"] is None
        assert report["feedback_v2"]["matched_inserted"] >= 1
        assert report["feedback_v2"]["events"]["inserted"] >= 2
        serialized = json.dumps(report)
        assert "Synthetic private title" not in serialized
        assert all(str(value) not in serialized for value in [user_id, meme_id, impression, *ids])
        async with database.session() as session:
            saved = (
                await session.execute(
                    select(SuggestionPerformanceSample).where(
                        SuggestionPerformanceSample.id == ids[0]
                    )
                )
            ).scalar_one()
            assert saved.created_at > cutoff
            assert saved.first_usable_preview_ms == 900.0
    finally:
        async with database.session() as session, session.begin():
            await session.execute(
                delete(SuggestionPerformanceSample).where(SuggestionPerformanceSample.id.in_(ids))
            )
            await session.execute(delete(UsageEvent).where(UsageEvent.user_id == user_id))
            await session.execute(delete(Meme).where(Meme.id == meme_id))
        await usage.delete_account(user_id)


async def test_retention_prunes_expired_samples_and_since_excludes_operator_qa(
    database: Database,
) -> None:
    store = SqlAlchemyPerformanceStore(database)
    old_id, kept_id = uuid4(), uuid4()
    try:
        async with database.session() as session, session.begin():
            for event_id, days in [(old_id, 31), (kept_id, 5)]:
                session.add(
                    SuggestionPerformanceSample(
                        id=event_id,
                        kind="request",
                        platform="x",
                        extension_version="992.0.1",
                        outcome="empty",
                        elapsed_ms=100.0,
                        suggestion_count=0,
                        cache_status="unknown",
                        generation_mode="unknown",
                        created_at=datetime.now(UTC) - timedelta(days=days),
                    )
                )
        result = await store.cleanup_expired()
        assert result.deleted >= 1
        async with database.session() as session:
            assert await session.get(SuggestionPerformanceSample, old_id) is None
            assert await session.get(SuggestionPerformanceSample, kept_id) is not None
        report = await load_performance_baseline(
            database, since=datetime.now(UTC) - timedelta(hours=1)
        )
        assert not any(row["extension_version"] == "992.0.1" for row in report["slices"])
        with pytest.raises(ValueError, match="future"):
            await load_performance_baseline(database, since=datetime.now(UTC) + timedelta(days=1))
    finally:
        async with database.session() as session, session.begin():
            await session.execute(
                delete(SuggestionPerformanceSample).where(
                    SuggestionPerformanceSample.id.in_([old_id, kept_id])
                )
            )


def _exercise_additive_migration(connection: Connection, schema: str) -> None:
    quoted_schema = connection.dialect.identifier_preparer.quote(schema)
    connection.exec_driver_sql(f"CREATE SCHEMA {quoted_schema}")
    connection.exec_driver_sql(f"SET LOCAL search_path TO {quoted_schema}")
    connection.exec_driver_sql("CREATE TABLE existing_data (value INTEGER PRIMARY KEY)")
    connection.exec_driver_sql("INSERT INTO existing_data VALUES (42)")
    migration = importlib.import_module("migrations.versions.20261023_0012_suggestion_performance")
    with Operations.context(MigrationContext.configure(connection)):
        migration.upgrade()
        # Fresh compatibility metadata may already contain the table.
        migration.upgrade()
        assert inspect(connection).has_table("suggestion_performance_samples")
        event_id = uuid4()
        connection.execute(
            text(
                "INSERT INTO suggestion_performance_samples "
                "(id, kind, platform, extension_version, outcome, elapsed_ms) "
                "VALUES (:id, 'request', 'x', '1.0.0', 'empty', 10)"
            ),
            {"id": event_id},
        )
        with pytest.raises(RuntimeError, match="samples exist"):
            migration.downgrade()
        assert (
            connection.exec_driver_sql(
                "SELECT count(*) FROM suggestion_performance_samples"
            ).scalar_one()
            == 1
        )
        connection.execute(
            text("DELETE FROM suggestion_performance_samples WHERE id = :id"), {"id": event_id}
        )
        migration.downgrade()
        assert not inspect(connection).has_table("suggestion_performance_samples")
        migration.upgrade()
        assert inspect(connection).has_table("suggestion_performance_samples")
    assert connection.exec_driver_sql("SELECT value FROM existing_data").scalar_one() == 42


async def test_additive_migration_preserves_existing_data_and_rejects_data_loss(
    database: Database,
) -> None:
    schema = f"test_performance_migration_{uuid4().hex}"
    quoted_schema = database.engine.dialect.identifier_preparer.quote(schema)
    try:
        async with database.engine.begin() as connection:
            await connection.run_sync(_exercise_additive_migration, schema)
    finally:
        async with database.engine.begin() as connection:
            await connection.exec_driver_sql(f"DROP SCHEMA IF EXISTS {quoted_schema} CASCADE")
