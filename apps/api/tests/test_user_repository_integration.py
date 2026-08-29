from __future__ import annotations

import asyncio
import os
from typing import cast

import pytest
from sqlalchemy import Connection, Table, func, select

from memedrop_api.agent_credentials import AgentCredentialService, InvalidAuthorization
from memedrop_api.db import ApiKey, Base, Database, User
from memedrop_api.public_ids import PublicId, PublicIdKind, create_public_id
from memedrop_api.user_repository import SqlAlchemyUserRepository

CREDENTIAL_TABLES: tuple[Table, ...] = (
    cast(Table, User.__table__),
    cast(Table, ApiKey.__table__),
)


def _create_credential_tables(connection: Connection) -> None:
    Base.metadata.create_all(connection, tables=CREDENTIAL_TABLES)


def _database_url() -> str:
    database_url = os.environ.get("MEMEDROP_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("MEMEDROP_TEST_DATABASE_URL is not configured")
    return database_url


@pytest.mark.integration
async def test_repository_issues_rotates_and_authenticates_user_key() -> None:
    database = Database(_database_url())
    try:
        async with database.engine.begin() as connection:
            await connection.run_sync(_create_credential_tables)
        service = AgentCredentialService(SqlAlchemyUserRepository(database))
        user = await service.create_user(
            auth_provider="test",
            auth_subject=create_public_id(PublicIdKind.USER).value,
        )
        issued = await service.issue_api_key(user_id=user.id, name="first")
        principal = await service.authenticate_bearer(f"Bearer {issued.credential}")
        assert principal.user_id == user.id
        replacement = await service.rotate_api_key(
            user_id=user.id, key_id=issued.key.id, name="replacement"
        )
        with pytest.raises(InvalidAuthorization):
            await service.authenticate_bearer(f"Bearer {issued.credential}")
        assert (
            await service.authenticate_bearer(f"Bearer {replacement.credential}")
        ).user_id == user.id
    finally:
        await database.close()


@pytest.mark.integration
async def test_user_bootstrap_is_idempotent_and_refreshes_only_present_email() -> None:
    database = Database(_database_url())
    identity = create_public_id(PublicIdKind.USER).value
    try:
        async with database.engine.begin() as connection:
            await connection.run_sync(_create_credential_tables)
        repository = SqlAlchemyUserRepository(database)

        created = await repository.create_user(
            auth_provider="github", auth_subject=identity, email="old@example.com"
        )
        without_email = await repository.create_user(
            auth_provider="github", auth_subject=identity, email=None
        )
        refreshed = await repository.create_user(
            auth_provider="github", auth_subject=identity, email="new@example.com"
        )

        assert without_email.id == refreshed.id == created.id
        assert without_email.email == "old@example.com"
        assert refreshed.email == "new@example.com"
        assert refreshed.created_at == created.created_at
    finally:
        await database.close()


@pytest.mark.integration
async def test_concurrent_user_bootstrap_creates_one_identity() -> None:
    database = Database(_database_url())
    identity = create_public_id(PublicIdKind.USER).value
    try:
        async with database.engine.begin() as connection:
            await connection.run_sync(_create_credential_tables)
        repository = SqlAlchemyUserRepository(database)

        users = await asyncio.gather(
            *(
                repository.create_user(
                    auth_provider="google",
                    auth_subject=identity,
                    email=f"verified-{attempt}@example.com",
                )
                for attempt in range(8)
            )
        )

        assert len({user.id for user in users}) == 1
        async with database.session() as session:
            count = await session.scalar(
                select(func.count())
                .select_from(User)
                .where(User.auth_provider == "google", User.auth_subject == identity)
            )
            stored = await session.scalar(
                select(User).where(
                    User.auth_provider == "google", User.auth_subject == identity
                )
            )
        assert count == 1
        assert stored is not None
        assert stored.email in {f"verified-{attempt}@example.com" for attempt in range(8)}
    finally:
        await database.close()


@pytest.mark.integration
async def test_user_bootstrap_retries_a_short_id_collision(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    database = Database(_database_url())
    first_identity = create_public_id(PublicIdKind.USER).value
    second_identity = create_public_id(PublicIdKind.USER).value
    try:
        async with database.engine.begin() as connection:
            await connection.run_sync(_create_credential_tables)
        repository = SqlAlchemyUserRepository(database)
        first = await repository.create_user(
            auth_provider="test", auth_subject=first_identity, email=None
        )
        replacement_id = create_public_id(PublicIdKind.USER).value
        candidates = iter((first.id, replacement_id))

        monkeypatch.setattr(
            "memedrop_api.user_repository.create_public_id",
            lambda kind: PublicId(kind=kind, value=next(candidates)),
        )
        second = await repository.create_user(
            auth_provider="test", auth_subject=second_identity, email=None
        )

        assert second.id == replacement_id
    finally:
        await database.close()
