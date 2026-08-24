"""SQLAlchemy persistence for public agent accounts and API credentials."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import UTC, datetime
from typing import Any, TypeVar, cast

from sqlalchemy import and_, select, update
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError

from memedrop_api.agent_credentials import (
    AgentAccountInactive,
    AgentAccountNotFound,
    AgentAccountRecord,
    AgentAccountStatus,
    AgentApiKeyNotFound,
    ApiKeyRecord,
    PublicIdCollisionExhausted,
    StoredCredential,
)
from memedrop_api.db import AgentAccount, AgentApiKey, Database
from memedrop_api.public_ids import PublicIdKind, create_public_id

_MAX_PUBLIC_ID_INSERT_ATTEMPTS = 3
_Result = TypeVar("_Result")


class SqlAlchemyAgentCredentialRepository:
    """Durable credential repository with explicit tenant predicates."""

    def __init__(self, database: Database) -> None:
        self._database = database

    async def create_account(self, *, name: str) -> AgentAccountRecord:
        async def insert() -> AgentAccountRecord:
            account_id = create_public_id(PublicIdKind.AGENT_ACCOUNT).value
            row = AgentAccount(id=account_id, name=name, status="active")
            async with self._database.session() as session, session.begin():
                session.add(row)
                await session.flush()
                await session.refresh(row)
            return _account_record(row)

        return await self._retry_public_id_insert("agent_accounts", insert)

    async def account_status(self, *, account_id: str) -> AgentAccountStatus:
        """Read safe account and key metadata without credential hashes or user content."""

        async with self._database.session() as session:
            account = await session.get(AgentAccount, account_id)
            if account is None:
                raise AgentAccountNotFound("agent account was not found")
            keys = tuple(
                _key_record(row)
                for row in await session.scalars(
                    select(AgentApiKey)
                    .where(AgentApiKey.agent_account_id == account_id)
                    .order_by(AgentApiKey.created_at, AgentApiKey.id)
                )
            )
        return AgentAccountStatus(account=_account_record(account), api_keys=keys)

    async def issue_api_key(
        self,
        *,
        account_id: str,
        name: str,
        secret_hash: str,
    ) -> ApiKeyRecord:
        async def insert() -> ApiKeyRecord:
            key_id = create_public_id(PublicIdKind.API_KEY).value
            row = AgentApiKey(
                id=key_id,
                agent_account_id=account_id,
                name=name,
                secret_hash=secret_hash,
                status="active",
            )
            async with self._database.session() as session, session.begin():
                account = await session.scalar(
                    select(AgentAccount.id).where(
                        and_(
                            AgentAccount.id == account_id,
                            AgentAccount.status == "active",
                        )
                    )
                )
                if account is None:
                    raise AgentAccountInactive("agent account is not active")
                session.add(row)
                await session.flush()
                await session.refresh(row)
            return _key_record(row)

        return await self._retry_public_id_insert("agent_api_keys", insert)

    async def find_active_credential(self, *, key_id: str) -> StoredCredential | None:
        """Look up one active public key and its active tenant in one query."""

        statement = (
            select(AgentApiKey)
            .join(AgentAccount, AgentApiKey.agent_account_id == AgentAccount.id)
            .where(
                and_(
                    AgentApiKey.id == key_id,
                    AgentApiKey.status == "active",
                    AgentAccount.status == "active",
                )
            )
        )
        async with self._database.session() as session:
            row = await session.scalar(statement)
        if row is None:
            return None
        return StoredCredential(key=_key_record(row), secret_hash=row.secret_hash)

    async def mark_key_used(self, *, account_id: str, key_id: str, used_at: datetime) -> bool:
        """Record use only while both the addressed key and tenant remain active."""

        active_account = select(AgentAccount.id).where(
            and_(AgentAccount.id == account_id, AgentAccount.status == "active")
        )
        statement = (
            update(AgentApiKey)
            .where(
                and_(
                    AgentApiKey.id == key_id,
                    AgentApiKey.agent_account_id == account_id,
                    AgentApiKey.status == "active",
                    AgentApiKey.agent_account_id.in_(active_account),
                )
            )
            .values(last_used_at=used_at, updated_at=used_at)
        )
        async with self._database.session() as session, session.begin():
            result = cast(CursorResult[Any], await session.execute(statement))
        return result.rowcount == 1

    async def revoke_api_key(
        self,
        *,
        account_id: str,
        key_id: str,
        reason: str,
        actor: str,
        revoked_at: datetime,
    ) -> ApiKeyRecord:
        statement = (
            update(AgentApiKey)
            .where(
                and_(
                    AgentApiKey.id == key_id,
                    AgentApiKey.agent_account_id == account_id,
                    AgentApiKey.status == "active",
                )
            )
            .values(
                status="revoked",
                revoked_at=revoked_at,
                revocation_reason=reason,
                revoked_by_actor=actor,
                updated_at=revoked_at,
            )
            .returning(AgentApiKey)
        )
        async with self._database.session() as session, session.begin():
            row = (await session.scalars(statement)).one_or_none()
        if row is None:
            raise AgentApiKeyNotFound("active API key was not found for this account")
        return _key_record(row)

    async def rotate_api_key(
        self,
        *,
        account_id: str,
        key_id: str,
        replacement_name: str,
        replacement_secret_hash: str,
        reason: str,
        actor: str,
        rotated_at: datetime,
    ) -> ApiKeyRecord:
        """Atomically revoke a key and issue its replacement for one tenant."""

        async def rotate() -> ApiKeyRecord:
            replacement_key_id = create_public_id(PublicIdKind.API_KEY).value
            replacement = AgentApiKey(
                id=replacement_key_id,
                agent_account_id=account_id,
                name=replacement_name,
                secret_hash=replacement_secret_hash,
                status="active",
            )
            async with self._database.session() as session, session.begin():
                current = await session.scalar(
                    _active_key_for_rotation_statement(
                        account_id=account_id,
                        key_id=key_id,
                    )
                )
                if current is None:
                    raise AgentApiKeyNotFound("active API key was not found for this account")
                current.status = "revoked"
                current.revoked_at = rotated_at
                current.revocation_reason = reason
                current.revoked_by_actor = actor
                current.updated_at = rotated_at
                session.add(replacement)
                await session.flush()
                await session.refresh(replacement)
            return _key_record(replacement)

        return await self._retry_public_id_insert("agent_api_keys", rotate)

    async def _retry_public_id_insert(
        self, table_name: str, operation: Callable[[], Awaitable[_Result]]
    ) -> _Result:
        for attempt in range(_MAX_PUBLIC_ID_INSERT_ATTEMPTS):
            try:
                return await operation()
            except IntegrityError as error:
                if not _is_primary_key_collision(error, table_name):
                    raise
                if attempt == _MAX_PUBLIC_ID_INSERT_ATTEMPTS - 1:
                    raise PublicIdCollisionExhausted(
                        f"could not insert a unique public ID into {table_name}"
                    ) from error
        raise AssertionError("bounded retry loop must return or raise")


def _active_key_for_rotation_statement(*, account_id: str, key_id: str):
    """Lock one tenant key so competing rotations re-check its active status."""

    return (
        select(AgentApiKey)
        .where(
            and_(
                AgentApiKey.id == key_id,
                AgentApiKey.agent_account_id == account_id,
                AgentApiKey.status == "active",
            )
        )
        .with_for_update()
    )


def _is_primary_key_collision(error: IntegrityError, table_name: str) -> bool:
    """Return true only for the named PostgreSQL primary-key constraint."""

    diagnostic = getattr(getattr(error, "orig", None), "diag", None)
    return getattr(diagnostic, "constraint_name", None) == f"{table_name}_pkey"


def _account_record(row: AgentAccount) -> AgentAccountRecord:
    return AgentAccountRecord(
        id=row.id,
        name=row.name,
        status=row.status,
        created_at=_as_utc(row.created_at),
        updated_at=_as_utc(row.updated_at),
    )


def _key_record(row: AgentApiKey) -> ApiKeyRecord:
    return ApiKeyRecord(
        id=row.id,
        agent_account_id=row.agent_account_id,
        name=row.name,
        status=row.status,
        last_used_at=_as_utc_optional(row.last_used_at),
        revoked_at=_as_utc_optional(row.revoked_at),
        revocation_reason=row.revocation_reason,
        revoked_by_actor=row.revoked_by_actor,
        created_at=_as_utc(row.created_at),
        updated_at=_as_utc(row.updated_at),
    )


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value.astimezone(UTC)


def _as_utc_optional(value: datetime | None) -> datetime | None:
    return _as_utc(value) if value is not None else None
