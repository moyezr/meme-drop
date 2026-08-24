from __future__ import annotations

import asyncio
import hashlib
import os
from collections.abc import AsyncIterator

import pytest
import pytest_asyncio
from sqlalchemy import delete, func, select, text

from memedrop_api.agent_account_repository import SqlAlchemyAgentCredentialRepository
from memedrop_api.agent_credentials import (
    AgentApiKeyNotFound,
    AgentCredentialService,
    InvalidAuthorization,
    IssuedApiKey,
)
from memedrop_api.db import AgentAccount, AgentApiKey, Base, Database

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
        async with database.session() as session, session.begin():
            await session.execute(delete(AgentApiKey))
            await session.execute(delete(AgentAccount))
        await database.close()


async def test_credentials_are_hashed_and_rotation_is_tenant_scoped(database: Database) -> None:
    repository = SqlAlchemyAgentCredentialRepository(database)
    service = AgentCredentialService(repository)
    account = await service.create_account(name="Integration tenant")
    issued = await service.issue_api_key(account_id=account.id, name="first key")

    async with database.session() as session:
        stored = await session.scalar(select(AgentApiKey).where(AgentApiKey.id == issued.key.id))
    assert stored is not None
    assert stored.secret_hash == hashlib.sha256(issued.secret.encode()).hexdigest()
    assert issued.secret not in stored.secret_hash

    principal = await service.authenticate_bearer(f"Bearer {issued.credential}")
    assert principal.agent_account_id == account.id
    async with database.session() as session:
        used = await session.scalar(select(AgentApiKey).where(AgentApiKey.id == issued.key.id))
    assert used is not None and used.last_used_at is not None

    rotated = await service.rotate_api_key(
        account_id=account.id,
        key_id=issued.key.id,
        name="second key",
        reason="scheduled_rotation",
        actor="operator:integration",
    )
    async with database.session() as session:
        old = await session.scalar(select(AgentApiKey).where(AgentApiKey.id == issued.key.id))
        replacement = await session.scalar(
            select(AgentApiKey).where(AgentApiKey.id == rotated.key.id)
        )
    assert old is not None and old.status == "revoked"
    assert old.revocation_reason == "scheduled_rotation"
    assert replacement is not None and replacement.status == "active"

    with pytest.raises(InvalidAuthorization):
        await service.authenticate_bearer(f"Bearer {issued.credential}")
    assert (
        await service.authenticate_bearer(f"Bearer {rotated.credential}")
    ).api_key_id == rotated.key.id


async def test_concurrent_rotations_issue_exactly_one_replacement(database: Database) -> None:
    repository = SqlAlchemyAgentCredentialRepository(database)
    service = AgentCredentialService(repository)
    account = await service.create_account(name="Concurrent rotation tenant")
    issued = await service.issue_api_key(account_id=account.id, name="original key")

    first, second = await asyncio.gather(
        service.rotate_api_key(
            account_id=account.id,
            key_id=issued.key.id,
            name="first replacement",
            reason="scheduled_rotation",
            actor="operator:first",
        ),
        service.rotate_api_key(
            account_id=account.id,
            key_id=issued.key.id,
            name="second replacement",
            reason="scheduled_rotation",
            actor="operator:second",
        ),
        return_exceptions=True,
    )

    results = (first, second)
    succeeded = [result for result in results if isinstance(result, IssuedApiKey)]
    rejected = [result for result in results if isinstance(result, AgentApiKeyNotFound)]
    assert len(succeeded) == 1
    assert len(rejected) == 1

    async with database.session() as session:
        original = await session.scalar(
            select(AgentApiKey).where(
                AgentApiKey.id == issued.key.id,
                AgentApiKey.agent_account_id == account.id,
            )
        )
        active_count = await session.scalar(
            select(func.count())
            .select_from(AgentApiKey)
            .where(
                AgentApiKey.agent_account_id == account.id,
                AgentApiKey.status == "active",
            )
        )
        replacement_ids = (
            await session.scalars(
                select(AgentApiKey.id).where(
                    AgentApiKey.agent_account_id == account.id,
                    AgentApiKey.status == "active",
                )
            )
        ).all()

    assert original is not None and original.status == "revoked"
    assert active_count == 1
    assert replacement_ids == [succeeded[0].key.id]
