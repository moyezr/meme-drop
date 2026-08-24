from __future__ import annotations

import asyncio
import hashlib
import os
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from sqlalchemy import func, select, text

from memedrop_api.agent_generation_credits import (
    AgentGenerationCreditError,
    AgentGenerationCreditService,
    CreditBalance,
    GenerationResult,
    GenerationStatus,
    IdempotencyConflict,
    InsufficientCredits,
    InvalidGenerationTransition,
    _derived_ledger_identity,
    _hash_idempotency_key,
    _validate_settlement,
)
from memedrop_api.db import (
    AgentAccount,
    AgentApiKey,
    AgentGeneration,
    Base,
    CreditLedgerEntry,
    Database,
)
from memedrop_api.public_ids import PublicIdKind, create_public_id

TEST_DATABASE_URL = os.environ.get("MEMEDROP_TEST_DATABASE_URL")
FINGERPRINT_A = "a" * 64
FINGERPRINT_B = "b" * 64


def test_idempotency_and_ledger_identities_are_opaque_stable_and_distinct() -> None:
    key = "client-retry-123"
    first = _hash_idempotency_key(key, namespace="generation")

    assert first == _hash_idempotency_key(key, namespace="generation")
    assert first != _hash_idempotency_key(key, namespace="grant")
    assert first != key
    assert len(first) == 64
    assert _derived_ledger_identity("gen_23456789ABCDEFGHJKLMNP", "reservation") != (
        _derived_ledger_identity("gen_23456789ABCDEFGHJKLMNP", "commit")
    )


@pytest.mark.parametrize(
    ("outcome", "asset_count", "failure_code", "message"),
    (
        (GenerationStatus.SUCCEEDED, 0, None, "must return an asset"),
        (GenerationStatus.SUCCEEDED, 1, "provider_error", "cannot include"),
        (GenerationStatus.NO_FIT, 1, None, "cannot return assets"),
        (GenerationStatus.NO_FIT, 0, "provider_error", "cannot include"),
        (GenerationStatus.FAILED, 0, None, "require a safe failure code"),
        (GenerationStatus.CANCELLED, 0, "unsafe message", "require a safe failure code"),
        (GenerationStatus.PROCESSING, 0, None, "not a terminal"),
    ),
)
def test_settlement_validation_rejects_non_chargeable_or_contentful_states(
    outcome: GenerationStatus, asset_count: int, failure_code: str | None, message: str
) -> None:
    with pytest.raises(AgentGenerationCreditError, match=message):
        _validate_settlement(outcome, asset_count, failure_code)


def test_settlement_validation_accepts_exact_product_semantics() -> None:
    _validate_settlement(GenerationStatus.SUCCEEDED, 1, None)
    _validate_settlement(GenerationStatus.NO_FIT, 0, None)
    _validate_settlement(GenerationStatus.FAILED, 0, "provider_error")
    _validate_settlement(GenerationStatus.CANCELLED, 0, "request_cancelled")


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


async def _account_with_key(database: Database) -> tuple[str, str]:
    account_id = create_public_id(PublicIdKind.AGENT_ACCOUNT).value
    api_key_id = create_public_id(PublicIdKind.API_KEY).value
    async with database.session() as session, session.begin():
        session.add(AgentAccount(id=account_id, name="Credit test account"))
        session.add(
            AgentApiKey(
                id=api_key_id,
                agent_account_id=account_id,
                name="Credit test key",
                secret_hash=hashlib.sha256(api_key_id.encode()).hexdigest(),
            )
        )
    return account_id, api_key_id


async def _ledger_rows(database: Database, account_id: str) -> list[CreditLedgerEntry]:
    async with database.session() as session:
        result = await session.scalars(
            select(CreditLedgerEntry)
            .where(CreditLedgerEntry.agent_account_id == account_id)
            .order_by(CreditLedgerEntry.recorded_at, CreditLedgerEntry.id)
        )
        return list(result)


@pytest.mark.integration
async def test_generation_reservation_replay_release_and_terminal_guards(
    database: Database,
) -> None:
    account_id, api_key_id = await _account_with_key(database)
    service = AgentGenerationCreditService(database)
    assert await service.grant_credits(
        account_id=account_id, credits=1, grant_idempotency_key="initial-grant"
    ) == CreditBalance(account_id, 1)

    started = await service.begin_generation(
        account_id=account_id,
        api_key_id=api_key_id,
        idempotency_key="generation-retry",
        request_fingerprint=FINGERPRINT_A,
    )
    assert (started.status, started.balance.credits, started.replayed) == (
        GenerationStatus.PROCESSING,
        0,
        False,
    )

    replay = await service.begin_generation(
        account_id=account_id,
        api_key_id=api_key_id,
        idempotency_key="generation-retry",
        request_fingerprint=FINGERPRINT_A,
    )
    assert (replay.id, replay.balance.credits, replay.replayed) == (started.id, 0, True)
    with pytest.raises(IdempotencyConflict, match="different request fingerprint"):
        await service.begin_generation(
            account_id=account_id,
            api_key_id=api_key_id,
            idempotency_key="generation-retry",
            request_fingerprint=FINGERPRINT_B,
        )

    released = await service.settle_generation(
        account_id=account_id,
        generation_id=started.id,
        outcome=GenerationStatus.NO_FIT,
    )
    assert (released.status, released.balance.credits) == (GenerationStatus.NO_FIT, 1)
    with pytest.raises(InvalidGenerationTransition, match="cannot transition"):
        await service.settle_generation(
            account_id=account_id,
            generation_id=started.id,
            outcome=GenerationStatus.NO_FIT,
        )

    ledger = await _ledger_rows(database, account_id)
    assert [(entry.reason, entry.credit_delta) for entry in ledger] == [
        ("grant", 1),
        ("generation_reservation", -1),
        ("generation_release", 1),
    ]
    assert len({entry.idempotency_key_hash for entry in ledger}) == 3
    assert all("generation-retry" not in entry.idempotency_key_hash for entry in ledger)


@pytest.mark.integration
async def test_successful_fallback_commits_once_and_concurrent_starts_cannot_overspend(
    database: Database,
) -> None:
    account_id, api_key_id = await _account_with_key(database)
    service = AgentGenerationCreditService(database)
    await service.grant_credits(
        account_id=account_id, credits=2, grant_idempotency_key="two-credits"
    )
    first = await service.begin_generation(
        account_id=account_id,
        api_key_id=api_key_id,
        idempotency_key="fallback",
        request_fingerprint=FINGERPRINT_A,
    )
    settled = await service.settle_generation(
        account_id=account_id,
        generation_id=first.id,
        outcome=GenerationStatus.SUCCEEDED,
        returned_asset_count=1,
    )
    assert (settled.status, settled.balance.credits) == (GenerationStatus.SUCCEEDED, 1)

    outcomes = await asyncio.gather(
        service.begin_generation(
            account_id=account_id,
            api_key_id=api_key_id,
            idempotency_key="concurrent-one",
            request_fingerprint=FINGERPRINT_A,
        ),
        service.begin_generation(
            account_id=account_id,
            api_key_id=api_key_id,
            idempotency_key="concurrent-two",
            request_fingerprint=FINGERPRINT_B,
        ),
        return_exceptions=True,
    )
    assert sum(isinstance(outcome, GenerationResult) for outcome in outcomes) == 1
    assert sum(isinstance(outcome, InsufficientCredits) for outcome in outcomes) == 1

    ledger = await _ledger_rows(database, account_id)
    assert [(entry.reason, entry.credit_delta) for entry in ledger] == [
        ("grant", 2),
        ("generation_reservation", -1),
        ("generation_commit", 0),
        ("generation_reservation", -1),
    ]
    assert await service.balance(account_id=account_id) == CreditBalance(account_id, 0)

    async with database.session() as session:
        generation_count = await session.scalar(
            select(func.count(AgentGeneration.id)).where(
                AgentGeneration.agent_account_id == account_id
            )
        )
        assert generation_count == 2


@pytest.mark.integration
async def test_generation_primary_key_collision_retries_with_a_new_compact_id(
    database: Database,
) -> None:
    account_id, api_key_id = await _account_with_key(database)
    colliding_generation_id = create_public_id(PublicIdKind.GENERATION).value
    async with database.session() as session, session.begin():
        session.add(
            AgentGeneration(
                id=colliding_generation_id,
                agent_account_id=account_id,
                api_key_id=api_key_id,
                idempotency_key_hash="c" * 64,
                request_fingerprint="d" * 64,
                status=GenerationStatus.PROCESSING.value,
            )
        )

    issued_collision = False

    def id_factory(kind: PublicIdKind) -> str:
        nonlocal issued_collision
        if kind is PublicIdKind.GENERATION and not issued_collision:
            issued_collision = True
            return colliding_generation_id
        return create_public_id(kind).value

    service = AgentGenerationCreditService(database, id_factory=id_factory)
    await service.grant_credits(
        account_id=account_id, credits=1, grant_idempotency_key="collision-grant"
    )
    result = await service.begin_generation(
        account_id=account_id,
        api_key_id=api_key_id,
        idempotency_key="collision-generation",
        request_fingerprint=FINGERPRINT_A,
    )

    assert issued_collision
    assert result.id != colliding_generation_id
