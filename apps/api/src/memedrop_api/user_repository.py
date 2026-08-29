"""SQLAlchemy persistence for users and their public API credentials."""

from __future__ import annotations

from collections.abc import Awaitable, Callable
from datetime import datetime
from typing import Any, TypeVar, cast

from sqlalchemy import func, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.engine import CursorResult
from sqlalchemy.exc import IntegrityError

from memedrop_api.agent_credentials import (
    AgentApiKeyNotFound,
    ApiKeyLimitExceeded,
    ApiKeyRecord,
    PublicIdCollisionExhausted,
    StoredApiKeyIssuance,
    StoredCredential,
    UserCredentialStatus,
    UserNotFound,
    UserRecord,
)
from memedrop_api.db import ApiKey, Database, User
from memedrop_api.public_ids import PublicIdKind, create_public_id

_MAX_PUBLIC_ID_INSERT_ATTEMPTS = 3
_MAX_ACTIVE_API_KEYS = 5
_Result = TypeVar("_Result")


class SqlAlchemyUserRepository:
    def __init__(self, database: Database) -> None:
        self._database = database

    async def create_user(
        self, *, auth_provider: str, auth_subject: str, email: str | None
    ) -> UserRecord:
        """Atomically bootstrap or refresh one provider-owned customer identity.

        A retry or concurrent sign-in returns the existing user. A newly verified
        email refreshes the stored value, while an absent provider email does not
        erase a value learned during an earlier sign-in.
        """

        async def upsert() -> UserRecord:
            insert_statement = insert(User).values(
                id=create_public_id(PublicIdKind.USER).value,
                auth_provider=auth_provider,
                auth_subject=auth_subject,
                email=email,
            )
            statement = insert_statement.on_conflict_do_update(
                constraint="uq_users_auth_identity",
                set_={"email": func.coalesce(insert_statement.excluded.email, User.email)},
            ).returning(User)
            async with self._database.session() as session, session.begin():
                row = (await session.scalars(statement)).one()
            return _user_record(row)

        return await self._retry_public_id_insert("users", upsert)

    async def user_status(self, *, user_id: str) -> UserCredentialStatus:
        async with self._database.session() as session:
            user = await session.get(User, user_id)
            if user is None:
                raise UserNotFound("user was not found")
            keys = tuple(
                _key_record(row)
                for row in await session.scalars(
                    select(ApiKey)
                    .where(ApiKey.user_id == user_id)
                    .order_by(ApiKey.created_at, ApiKey.id)
                )
            )
        return UserCredentialStatus(user=_user_record(user), api_keys=keys)

    async def issue_api_key(self, *, user_id: str, name: str, secret_hash: bytes) -> ApiKeyRecord:
        issued = await self._issue_api_key(
            user_id=user_id,
            name=name,
            secret_hash=secret_hash,
            issuance_idempotency_hash=None,
        )
        return issued.key

    async def issue_idempotent_api_key(
        self,
        *,
        user_id: str,
        name: str,
        secret_hash: bytes,
        issuance_idempotency_hash: bytes,
    ) -> StoredApiKeyIssuance:
        return await self._issue_api_key(
            user_id=user_id,
            name=name,
            secret_hash=secret_hash,
            issuance_idempotency_hash=issuance_idempotency_hash,
        )

    async def _issue_api_key(
        self,
        *,
        user_id: str,
        name: str,
        secret_hash: bytes,
        issuance_idempotency_hash: bytes | None,
    ) -> StoredApiKeyIssuance:
        async def insert() -> StoredApiKeyIssuance:
            async with self._database.session() as session, session.begin():
                user = await session.scalar(
                    select(User).where(User.id == user_id).with_for_update()
                )
                if user is None:
                    raise UserNotFound("user was not found")
                if issuance_idempotency_hash is not None:
                    existing = await session.scalar(
                        select(ApiKey).where(
                            ApiKey.user_id == user_id,
                            ApiKey.issuance_idempotency_hash == issuance_idempotency_hash,
                        )
                    )
                    if existing is not None:
                        return StoredApiKeyIssuance(_key_record(existing), existing.secret_hash)
                active_count = await session.scalar(
                    select(func.count())
                    .select_from(ApiKey)
                    .where(ApiKey.user_id == user_id, ApiKey.revoked_at.is_(None))
                )
                if active_count is None or active_count >= _MAX_ACTIVE_API_KEYS:
                    raise ApiKeyLimitExceeded("active API key limit reached")
                row = ApiKey(
                    id=create_public_id(PublicIdKind.API_KEY).value,
                    user_id=user_id,
                    name=name,
                    secret_hash=secret_hash,
                    issuance_idempotency_hash=issuance_idempotency_hash,
                )
                session.add(row)
                await session.flush()
                await session.refresh(row)
            return StoredApiKeyIssuance(_key_record(row), row.secret_hash)

        return await self._retry_public_id_insert("api_keys", insert)

    async def find_active_credential(self, *, key_id: str) -> StoredCredential | None:
        async with self._database.session() as session:
            row = await session.scalar(
                select(ApiKey).where(ApiKey.id == key_id, ApiKey.revoked_at.is_(None))
            )
        return None if row is None else StoredCredential(_key_record(row), row.secret_hash)

    async def mark_key_used(self, *, user_id: str, key_id: str, used_at: datetime) -> bool:
        statement = (
            update(ApiKey)
            .where(
                ApiKey.id == key_id,
                ApiKey.user_id == user_id,
                ApiKey.revoked_at.is_(None),
            )
            .values(last_used_at=used_at)
        )
        async with self._database.session() as session, session.begin():
            result = cast(CursorResult[Any], await session.execute(statement))
        return result.rowcount == 1

    async def revoke_api_key(
        self, *, user_id: str, key_id: str, revoked_at: datetime
    ) -> ApiKeyRecord:
        statement = (
            update(ApiKey)
            .where(
                ApiKey.id == key_id,
                ApiKey.user_id == user_id,
                ApiKey.revoked_at.is_(None),
            )
            .values(revoked_at=revoked_at)
            .returning(ApiKey)
        )
        async with self._database.session() as session, session.begin():
            row = (await session.scalars(statement)).one_or_none()
        if row is None:
            raise AgentApiKeyNotFound("active API key was not found for this user")
        return _key_record(row)

    async def rotate_api_key(
        self,
        *,
        user_id: str,
        key_id: str,
        replacement_name: str,
        replacement_secret_hash: bytes,
        rotated_at: datetime,
    ) -> ApiKeyRecord:
        async def rotate() -> ApiKeyRecord:
            replacement = ApiKey(
                id=create_public_id(PublicIdKind.API_KEY).value,
                user_id=user_id,
                name=replacement_name,
                secret_hash=replacement_secret_hash,
            )
            async with self._database.session() as session, session.begin():
                current = await session.scalar(
                    select(ApiKey)
                    .where(
                        ApiKey.id == key_id,
                        ApiKey.user_id == user_id,
                        ApiKey.revoked_at.is_(None),
                    )
                    .with_for_update()
                )
                if current is None:
                    raise AgentApiKeyNotFound("active API key was not found for this user")
                current.revoked_at = rotated_at
                session.add(replacement)
                await session.flush()
                await session.refresh(replacement)
            return _key_record(replacement)

        return await self._retry_public_id_insert("api_keys", rotate)

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


def _is_primary_key_collision(error: IntegrityError, table_name: str) -> bool:
    diagnostic = getattr(getattr(error, "orig", None), "diag", None)
    return getattr(diagnostic, "constraint_name", None) == f"{table_name}_pkey"


def _user_record(row: User) -> UserRecord:
    return UserRecord(
        id=row.id,
        auth_provider=row.auth_provider,
        auth_subject=row.auth_subject,
        email=row.email,
        credits=row.credits,
        created_at=_as_utc(row.created_at),
    )


def _key_record(row: ApiKey) -> ApiKeyRecord:
    return ApiKeyRecord(
        id=row.id,
        user_id=row.user_id,
        name=row.name,
        last_used_at=_as_utc_optional(row.last_used_at),
        revoked_at=_as_utc_optional(row.revoked_at),
        created_at=_as_utc(row.created_at),
    )


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("database timestamp must be timezone-aware")
    return value


def _as_utc_optional(value: datetime | None) -> datetime | None:
    return None if value is None else _as_utc(value)
