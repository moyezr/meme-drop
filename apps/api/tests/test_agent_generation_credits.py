from __future__ import annotations

import hashlib
import os
from collections.abc import AsyncIterator
from datetime import UTC, datetime, timedelta
from typing import cast

import pytest
import pytest_asyncio
from sqlalchemy import CheckConstraint, Table, select, update
from sqlalchemy.exc import IntegrityError

from memedrop_api.agent_generation_credits import (
    AgentGenerationCreditService,
    GenerationAssetInput,
    GenerationStatus,
    IdempotencyConflict,
    _hash_idempotency_key,
)
from memedrop_api.db import (
    ApiKey,
    Base,
    CreditTransaction,
    Database,
    GeneratedAsset,
    Generation,
    User,
)
from memedrop_api.public_ids import PublicIdKind, create_public_id

TEST_DATABASE_URL = os.environ.get("MEMEDROP_TEST_DATABASE_URL")
CREDIT_TABLES: tuple[Table, ...] = (
    cast(Table, User.__table__),
    cast(Table, ApiKey.__table__),
    cast(Table, Generation.__table__),
    cast(Table, CreditTransaction.__table__),
    cast(Table, GeneratedAsset.__table__),
)


class SelectiveGenerationObjectCleaner:
    def __init__(self) -> None:
        self.failed_generation_ids: set[str] = set()
        self.calls: list[tuple[str, str]] = []

    async def cleanup_generation_objects(self, *, user_id: str, generation_id: str) -> None:
        self.calls.append((user_id, generation_id))
        if generation_id in self.failed_generation_ids:
            raise OSError("content-free storage failure")


def test_idempotency_hash_is_stable_namespaced_binary() -> None:
    value = _hash_idempotency_key("agent-run-1", namespace="generation")
    assert isinstance(value, bytes)
    assert len(value) == 32
    assert value == _hash_idempotency_key("agent-run-1", namespace="generation")
    assert value != _hash_idempotency_key("agent-run-1", namespace="grant")
    assert b"agent-run-1" not in value


def test_credit_transaction_schema_declares_identity_and_payment_checks() -> None:
    table = cast(Table, CreditTransaction.__table__)
    check_names = {
        constraint.name
        for constraint in table.constraints
        if isinstance(constraint, CheckConstraint)
    }

    assert "credit_transactions_generation_identity_check" in check_names
    assert "credit_transactions_payment_external_id_check" in check_names


@pytest_asyncio.fixture
async def database() -> AsyncIterator[Database]:
    if not TEST_DATABASE_URL:
        pytest.skip("MEMEDROP_TEST_DATABASE_URL is not configured")
    database = Database(TEST_DATABASE_URL)
    async with database.engine.begin() as connection:
        await connection.run_sync(
            lambda sync_connection: Base.metadata.create_all(
                sync_connection,
                tables=CREDIT_TABLES,
            )
        )
    try:
        yield database
    finally:
        await database.close()


async def _user_with_key(database: Database, credits: int = 0) -> tuple[str, str]:
    user_id = create_public_id(PublicIdKind.USER).value
    key_id = create_public_id(PublicIdKind.API_KEY).value
    async with database.session() as session, session.begin():
        session.add(
            User(
                id=user_id,
                auth_provider="test",
                auth_subject=user_id,
                credits=credits,
            )
        )
        await session.flush()
        session.add(
            ApiKey(
                id=key_id,
                user_id=user_id,
                name="test",
                secret_hash=hashlib.sha256(key_id.encode()).digest(),
            )
        )
    return user_id, key_id


@pytest.mark.integration
async def test_requested_credits_settle_to_actual_durable_assets(database: Database) -> None:
    user_id, key_id = await _user_with_key(database, credits=5)
    service = AgentGenerationCreditService(database)
    started = await service.begin_generation(
        user_id=user_id,
        api_key_id=key_id,
        idempotency_key="three-requested",
        request_fingerprint="a" * 64,
        requested_count=3,
    )
    assert started.balance.credits == 2

    completed = await service.complete_generation_with_assets(
        user_id=user_id,
        generation_id=started.id,
        assets=(
            GenerationAssetInput(
                object_key=f"generated/users/{user_id}/{started.id}/1.webp",
                content_type="image/webp",
                content_hash="b" * 64,
            ),
            GenerationAssetInput(
                object_key=f"generated/users/{user_id}/{started.id}/2.webp",
                content_type="image/webp",
                content_hash="c" * 64,
            ),
        ),
    )
    assert completed.generation.balance.credits == 3
    assert len(completed.assets) == 2
    async with database.session() as session:
        rows = list(
            await session.scalars(
                select(CreditTransaction)
                .where(CreditTransaction.generation_id == started.id)
                .order_by(CreditTransaction.id)
            )
        )
    assert [(row.type, row.amount) for row in rows] == [
        ("generation", -3),
        ("generation_refund", 1),
    ]


@pytest.mark.integration
async def test_failed_generation_refunds_full_reservation_and_replay_is_free(
    database: Database,
) -> None:
    user_id, key_id = await _user_with_key(database, credits=2)
    service = AgentGenerationCreditService(database)
    started = await service.begin_generation(
        user_id=user_id,
        api_key_id=key_id,
        idempotency_key="retry",
        request_fingerprint="d" * 64,
        requested_count=2,
    )
    replay = await service.begin_generation(
        user_id=user_id,
        api_key_id=key_id,
        idempotency_key="retry",
        request_fingerprint="d" * 64,
        requested_count=2,
    )
    assert replay.replayed and replay.id == started.id and replay.balance.credits == 0
    with pytest.raises(IdempotencyConflict):
        await service.begin_generation(
            user_id=user_id,
            api_key_id=key_id,
            idempotency_key="retry",
            request_fingerprint="e" * 64,
            requested_count=2,
        )
    failed = await service.settle_generation(
        user_id=user_id,
        generation_id=started.id,
        outcome=GenerationStatus.FAILED,
        failure_code="provider_error",
    )
    assert failed.balance.credits == 2


@pytest.mark.integration
@pytest.mark.parametrize(
    ("transaction_type", "amount", "use_generation", "external_id", "constraint_name"),
    (
        (
            "generation",
            -1,
            False,
            None,
            "credit_transactions_generation_identity_check",
        ),
        (
            "grant",
            1,
            True,
            "invalid-generation-grant",
            "credit_transactions_generation_identity_check",
        ),
        (
            "purchase",
            1,
            False,
            None,
            "credit_transactions_payment_external_id_check",
        ),
        (
            "payment_refund",
            -1,
            False,
            None,
            "credit_transactions_payment_external_id_check",
        ),
    ),
)
async def test_credit_transaction_database_rejects_invalid_identity_combinations(
    database: Database,
    transaction_type: str,
    amount: int,
    use_generation: bool,
    external_id: str | None,
    constraint_name: str,
) -> None:
    user_id, key_id = await _user_with_key(database, credits=1)
    generation = await AgentGenerationCreditService(database).begin_generation(
        user_id=user_id,
        api_key_id=key_id,
        idempotency_key=f"invalid-{transaction_type}",
        request_fingerprint="f" * 64,
        requested_count=1,
    )

    with pytest.raises(IntegrityError) as captured:
        async with database.session() as session, session.begin():
            session.add(
                CreditTransaction(
                    user_id=user_id,
                    generation_id=generation.id if use_generation else None,
                    amount=amount,
                    type=transaction_type,
                    external_id=external_id,
                )
            )
            await session.flush()

    diagnostic = getattr(getattr(captured.value, "orig", None), "diag", None)
    assert getattr(diagnostic, "constraint_name", None) == constraint_name


@pytest.mark.integration
async def test_non_payment_grant_remains_valid_without_external_id(database: Database) -> None:
    user_id, _ = await _user_with_key(database)
    async with database.session() as session, session.begin():
        user = await session.get(User, user_id)
        assert user is not None
        user.credits += 1
        transaction = CreditTransaction(
            user_id=user_id,
            amount=1,
            type="grant",
            external_id=None,
        )
        session.add(transaction)
        await session.flush()
        transaction_id = transaction.id

    async with database.session() as session:
        stored = await session.get(CreditTransaction, transaction_id)
    assert stored is not None
    assert stored.type == "grant" and stored.generation_id is None


@pytest.mark.integration
async def test_stale_reconciliation_continues_after_one_bounded_cleanup_failure(
    database: Database,
    caplog: pytest.LogCaptureFixture,
) -> None:
    user_id, key_id = await _user_with_key(database, credits=3)
    cleaner = SelectiveGenerationObjectCleaner()
    service = AgentGenerationCreditService(
        database,
        stale_generation_after=timedelta(minutes=10),
        generation_object_cleaner=cleaner,
    )
    generations = [
        await service.begin_generation(
            user_id=user_id,
            api_key_id=key_id,
            idempotency_key=f"stale-{index}",
            request_fingerprint=f"{index + 1:x}" * 64,
            requested_count=1,
        )
        for index in range(3)
    ]
    current = datetime.now(UTC)
    async with database.session() as session, session.begin():
        for index, generation in enumerate(generations):
            await session.execute(
                update(Generation)
                .where(Generation.id == generation.id, Generation.user_id == user_id)
                .values(created_at=current - timedelta(minutes=33 - index))
            )
    cleaner.failed_generation_ids.add(generations[0].id)

    reconciled = await service.reconcile_stale_generations(
        as_of=current,
        limit=2,
        user_id=user_id,
    )

    assert reconciled == 1
    assert cleaner.calls == [
        (user_id, generations[0].id),
        (user_id, generations[1].id),
    ]
    first = await service.generation_result(user_id=user_id, generation_id=generations[0].id)
    second = await service.generation_result(user_id=user_id, generation_id=generations[1].id)
    third = await service.generation_result(user_id=user_id, generation_id=generations[2].id)
    assert first.status is GenerationStatus.PROCESSING
    assert second.status is GenerationStatus.FAILED
    assert third.status is GenerationStatus.PROCESSING
    assert second.balance.credits == 1
    failure_records = [
        record
        for record in caplog.records
        if getattr(record, "event", None) == "stale_generation_cleanup_failed"
    ]
    assert len(failure_records) == 1
    assert getattr(failure_records[0], "user_id", None) == user_id
    assert getattr(failure_records[0], "generation_id", None) == generations[0].id
    assert getattr(failure_records[0], "failure_category", None) == "storage_io"
    assert "content-free storage failure" not in caplog.text
    async with database.session() as session:
        failed_candidate_transactions = list(
            await session.scalars(
                select(CreditTransaction).where(
                    CreditTransaction.generation_id == generations[0].id
                )
            )
        )
    assert [(row.type, row.amount) for row in failed_candidate_transactions] == [
        ("generation", -1)
    ]

    cleaner.failed_generation_ids.clear()
    assert (
        await service.reconcile_stale_generations(
            as_of=current,
            limit=2,
            user_id=user_id,
        )
        == 2
    )
    assert (await service.balance(user_id=user_id)).credits == 3
