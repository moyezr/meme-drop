"""Credential issuance and authentication for user-owned public API keys."""

from __future__ import annotations

import hashlib
import secrets
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import Protocol

from memedrop_api.public_ids import PublicIdError, PublicIdKind, parse_public_id

_API_SECRET_BYTES = 32
_MAX_NAME_LENGTH = 120


class AgentCredentialError(ValueError):
    """Base error for an invalid user or API credential operation."""


class InvalidAuthorization(AgentCredentialError):
    """The Authorization header or API credential is malformed or invalid."""


class UserNotFound(AgentCredentialError):
    """The addressed customer does not exist."""


class AgentApiKeyNotFound(AgentCredentialError):
    """The addressed API key does not exist or is revoked."""


class PublicIdCollisionExhausted(RuntimeError):
    """A bounded retry budget was exhausted while inserting a compact ID."""


@dataclass(frozen=True, slots=True)
class UserRecord:
    id: str
    auth_provider: str
    auth_subject: str
    email: str | None
    credits: int
    created_at: datetime


@dataclass(frozen=True, slots=True)
class ApiKeyRecord:
    """Safe API-key metadata. It deliberately contains no secret or hash."""

    id: str
    user_id: str
    name: str
    last_used_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime


@dataclass(frozen=True, slots=True)
class UserCredentialStatus:
    user: UserRecord
    api_keys: tuple[ApiKeyRecord, ...]


@dataclass(frozen=True, slots=True)
class IssuedApiKey:
    key: ApiKeyRecord
    secret: str = field(repr=False)

    @property
    def credential(self) -> str:
        return f"{self.key.id}.{self.secret}"


@dataclass(frozen=True, slots=True)
class AuthenticatedAgent:
    user_id: str
    api_key_id: str


@dataclass(frozen=True, slots=True)
class StoredCredential:
    key: ApiKeyRecord
    secret_hash: bytes = field(repr=False)


class AgentCredentialRepository(Protocol):
    async def create_user(
        self, *, auth_provider: str, auth_subject: str, email: str | None
    ) -> UserRecord: ...

    async def user_status(self, *, user_id: str) -> UserCredentialStatus: ...

    async def issue_api_key(
        self, *, user_id: str, name: str, secret_hash: bytes
    ) -> ApiKeyRecord: ...

    async def find_active_credential(self, *, key_id: str) -> StoredCredential | None: ...

    async def mark_key_used(self, *, user_id: str, key_id: str, used_at: datetime) -> bool: ...

    async def revoke_api_key(
        self, *, user_id: str, key_id: str, revoked_at: datetime
    ) -> ApiKeyRecord: ...

    async def rotate_api_key(
        self,
        *,
        user_id: str,
        key_id: str,
        replacement_name: str,
        replacement_secret_hash: bytes,
        rotated_at: datetime,
    ) -> ApiKeyRecord: ...


class AgentCredentialService:
    """Issues and validates opaque, high-entropy API credentials."""

    def __init__(self, repository: AgentCredentialRepository) -> None:
        self._repository = repository

    async def create_user(
        self, *, auth_provider: str, auth_subject: str, email: str | None = None
    ) -> UserRecord:
        return await self._repository.create_user(
            auth_provider=_validate_identity(auth_provider, "auth provider", 30),
            auth_subject=_validate_identity(auth_subject, "auth subject", 255),
            email=email,
        )

    async def user_status(self, *, user_id: str) -> UserCredentialStatus:
        _validate_user_id(user_id)
        return await self._repository.user_status(user_id=user_id)

    async def issue_api_key(self, *, user_id: str, name: str) -> IssuedApiKey:
        _validate_user_id(user_id)
        secret = _new_api_secret()
        key = await self._repository.issue_api_key(
            user_id=user_id, name=_validate_name(name), secret_hash=_hash_secret(secret)
        )
        return IssuedApiKey(key=key, secret=secret)

    async def authenticate_bearer(self, authorization: str | None) -> AuthenticatedAgent:
        key_id, secret = _parse_credential(parse_bearer_authorization(authorization))
        stored = await self._repository.find_active_credential(key_id=key_id)
        if stored is None or not secrets.compare_digest(stored.secret_hash, _hash_secret(secret)):
            raise InvalidAuthorization("invalid bearer credential")
        if not await self._repository.mark_key_used(
            user_id=stored.key.user_id, key_id=stored.key.id, used_at=datetime.now(UTC)
        ):
            raise InvalidAuthorization("invalid bearer credential")
        return AuthenticatedAgent(user_id=stored.key.user_id, api_key_id=stored.key.id)

    async def revoke_api_key(self, *, user_id: str, key_id: str) -> ApiKeyRecord:
        _validate_user_id(user_id)
        _validate_key_id(key_id)
        return await self._repository.revoke_api_key(
            user_id=user_id, key_id=key_id, revoked_at=datetime.now(UTC)
        )

    async def rotate_api_key(self, *, user_id: str, key_id: str, name: str) -> IssuedApiKey:
        _validate_user_id(user_id)
        _validate_key_id(key_id)
        secret = _new_api_secret()
        replacement = await self._repository.rotate_api_key(
            user_id=user_id,
            key_id=key_id,
            replacement_name=_validate_name(name),
            replacement_secret_hash=_hash_secret(secret),
            rotated_at=datetime.now(UTC),
        )
        return IssuedApiKey(key=replacement, secret=secret)


def parse_bearer_authorization(authorization: str | None) -> str:
    if not isinstance(authorization, str):
        raise InvalidAuthorization("authorization must use the Bearer scheme")
    scheme, separator, credential = authorization.partition(" ")
    if (
        scheme != "Bearer"
        or separator != " "
        or not credential
        or any(character.isspace() for character in credential)
    ):
        raise InvalidAuthorization("authorization must use the Bearer scheme")
    return credential


def bearer_api_key_id(authorization: str | None) -> str | None:
    try:
        key_id, _ = _parse_credential(parse_bearer_authorization(authorization))
    except InvalidAuthorization:
        return None
    return key_id


def _new_api_secret() -> str:
    return secrets.token_urlsafe(_API_SECRET_BYTES)


def _hash_secret(secret: str) -> bytes:
    return hashlib.sha256(secret.encode("utf-8")).digest()


def _parse_credential(credential: str) -> tuple[str, str]:
    key_id, separator, secret = credential.partition(".")
    if not separator or not key_id or not secret or "." in secret:
        raise InvalidAuthorization("invalid bearer credential")
    _validate_key_id(key_id)
    allowed = "-_0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    if len(secret) != 43 or any(character not in allowed for character in secret):
        raise InvalidAuthorization("invalid bearer credential")
    return key_id, secret


def _validate_user_id(user_id: str) -> None:
    try:
        parse_public_id(user_id, expected_kind=PublicIdKind.USER)
    except PublicIdError as error:
        raise AgentCredentialError("invalid user ID") from error


def _validate_key_id(key_id: str) -> None:
    try:
        parse_public_id(key_id, expected_kind=PublicIdKind.API_KEY)
    except PublicIdError as error:
        raise InvalidAuthorization("invalid bearer credential") from error


def _validate_name(value: str) -> str:
    return _validate_identity(value, "API key name", _MAX_NAME_LENGTH)


def _validate_identity(value: str, field_name: str, max_length: int) -> str:
    if not isinstance(value, str) or value != value.strip() or not value or len(value) > max_length:
        raise AgentCredentialError(f"{field_name} must be 1 to {max_length} trimmed characters")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise AgentCredentialError(f"{field_name} contains control characters")
    return value
