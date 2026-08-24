"""Credential issuance and authentication for public agent accounts.

This module intentionally has no HTTP concerns.  Routes can translate its
small, stable error set into their public API contract without ever handling
or logging plaintext API-key secrets themselves.
"""

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
    """Base error for an invalid account or API credential operation."""


class InvalidAuthorization(AgentCredentialError):
    """The Authorization header or API credential is malformed or invalid."""


class AgentAccountInactive(AgentCredentialError):
    """The addressed account does not exist or is not active."""


class AgentApiKeyNotFound(AgentCredentialError):
    """The addressed API key does not exist or is no longer active."""


class PublicIdCollisionExhausted(RuntimeError):
    """A bounded retry budget was exhausted while inserting a compact ID."""


@dataclass(frozen=True, slots=True)
class AgentAccountRecord:
    """Safe account data that may be returned to an operator or API caller."""

    id: str
    name: str
    status: str
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class ApiKeyRecord:
    """Safe API-key metadata.  It deliberately contains no secret or hash."""

    id: str
    agent_account_id: str
    name: str
    status: str
    last_used_at: datetime | None
    revoked_at: datetime | None
    revocation_reason: str | None
    revoked_by_actor: str | None
    created_at: datetime
    updated_at: datetime


@dataclass(frozen=True, slots=True)
class IssuedApiKey:
    """The one-time API-key delivery value.

    ``secret`` is omitted from ``repr`` so accidental debug logging does not
    reveal it.  Callers must deliver it to the account owner exactly once and
    retain only ``key`` thereafter.
    """

    key: ApiKeyRecord
    secret: str = field(repr=False)

    @property
    def credential(self) -> str:
        """Return the complete Bearer token: public lookup ID plus secret."""

        return f"{self.key.id}.{self.secret}"


@dataclass(frozen=True, slots=True)
class AuthenticatedAgent:
    """Tenant-scoped principal returned after a valid API-key authentication."""

    agent_account_id: str
    api_key_id: str


@dataclass(frozen=True, slots=True)
class StoredCredential:
    """Private repository result used only for constant-time verification."""

    key: ApiKeyRecord
    secret_hash: str = field(repr=False)


class AgentCredentialRepository(Protocol):
    """Persistence boundary for credential operations.

    Account IDs are explicit on all tenant-bound operations.  The single
    public-ID lookup is the authentication boundary before a tenant is known.
    """

    async def create_account(self, *, name: str) -> AgentAccountRecord: ...

    async def issue_api_key(
        self,
        *,
        account_id: str,
        name: str,
        secret_hash: str,
    ) -> ApiKeyRecord: ...

    async def find_active_credential(self, *, key_id: str) -> StoredCredential | None: ...

    async def mark_key_used(self, *, account_id: str, key_id: str, used_at: datetime) -> bool: ...

    async def revoke_api_key(
        self,
        *,
        account_id: str,
        key_id: str,
        reason: str,
        actor: str,
        revoked_at: datetime,
    ) -> ApiKeyRecord: ...

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
    ) -> ApiKeyRecord: ...


class AgentCredentialService:
    """Issues and validates opaque, high-entropy API credentials."""

    def __init__(self, repository: AgentCredentialRepository) -> None:
        self._repository = repository

    async def create_account(self, *, name: str) -> AgentAccountRecord:
        return await self._repository.create_account(
            name=_validate_name(name, field_name="account name"),
        )

    async def issue_api_key(self, *, account_id: str, name: str) -> IssuedApiKey:
        _validate_account_id(account_id)
        secret = _new_api_secret()
        key = await self._repository.issue_api_key(
            account_id=account_id,
            name=_validate_name(name, field_name="API key name"),
            secret_hash=_hash_secret(secret),
        )
        return IssuedApiKey(key=key, secret=secret)

    async def authenticate_bearer(self, authorization: str | None) -> AuthenticatedAgent:
        credential = parse_bearer_authorization(authorization)
        key_id, secret = _parse_credential(credential)
        stored = await self._repository.find_active_credential(key_id=key_id)
        if stored is None or not secrets.compare_digest(stored.secret_hash, _hash_secret(secret)):
            raise InvalidAuthorization("invalid bearer credential")

        used_at = datetime.now(UTC)
        if not await self._repository.mark_key_used(
            account_id=stored.key.agent_account_id,
            key_id=stored.key.id,
            used_at=used_at,
        ):
            # The key or account was disabled between lookup and this update.
            raise InvalidAuthorization("invalid bearer credential")
        return AuthenticatedAgent(
            agent_account_id=stored.key.agent_account_id,
            api_key_id=stored.key.id,
        )

    async def revoke_api_key(
        self,
        *,
        account_id: str,
        key_id: str,
        reason: str,
        actor: str,
    ) -> ApiKeyRecord:
        _validate_account_id(account_id)
        _validate_key_id(key_id)
        return await self._repository.revoke_api_key(
            account_id=account_id,
            key_id=key_id,
            reason=_validate_audit_value(reason, field_name="revocation reason", max_length=40),
            actor=_validate_audit_value(actor, field_name="revocation actor", max_length=120),
            revoked_at=datetime.now(UTC),
        )

    async def rotate_api_key(
        self,
        *,
        account_id: str,
        key_id: str,
        name: str,
        reason: str,
        actor: str,
    ) -> IssuedApiKey:
        _validate_account_id(account_id)
        _validate_key_id(key_id)
        secret = _new_api_secret()
        replacement = await self._repository.rotate_api_key(
            account_id=account_id,
            key_id=key_id,
            replacement_name=_validate_name(name, field_name="API key name"),
            replacement_secret_hash=_hash_secret(secret),
            reason=_validate_audit_value(reason, field_name="revocation reason", max_length=40),
            actor=_validate_audit_value(actor, field_name="revocation actor", max_length=120),
            rotated_at=datetime.now(UTC),
        )
        return IssuedApiKey(key=replacement, secret=secret)


def parse_bearer_authorization(authorization: str | None) -> str:
    """Strictly parse one HTTP Bearer credential without normalizing input."""

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


def _new_api_secret() -> str:
    """Generate 256 random bits encoded in a URL-safe form."""

    return secrets.token_urlsafe(_API_SECRET_BYTES)


def _hash_secret(secret: str) -> str:
    return hashlib.sha256(secret.encode("utf-8")).hexdigest()


def _parse_credential(credential: str) -> tuple[str, str]:
    key_id, separator, secret = credential.partition(".")
    if not separator or not key_id or not secret or "." in secret:
        raise InvalidAuthorization("invalid bearer credential")
    _validate_key_id(key_id)
    # token_urlsafe(32) currently yields 43 URL-safe characters.  Parsing the
    # exact generated form prevents weak, ambiguous, or normalized secrets.
    allowed_secret_characters = "-_0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    if len(secret) != 43 or any(character not in allowed_secret_characters for character in secret):
        raise InvalidAuthorization("invalid bearer credential")
    return key_id, secret


def _validate_account_id(account_id: str) -> None:
    try:
        parse_public_id(account_id, expected_kind=PublicIdKind.AGENT_ACCOUNT)
    except PublicIdError as error:
        raise AgentCredentialError("invalid agent account ID") from error


def _validate_key_id(key_id: str) -> None:
    try:
        parse_public_id(key_id, expected_kind=PublicIdKind.API_KEY)
    except PublicIdError as error:
        raise InvalidAuthorization("invalid bearer credential") from error


def _validate_name(value: str, *, field_name: str) -> str:
    return _validate_audit_value(value, field_name=field_name, max_length=_MAX_NAME_LENGTH)


def _validate_audit_value(value: str, *, field_name: str, max_length: int) -> str:
    if not isinstance(value, str):
        raise AgentCredentialError(f"{field_name} must be a string")
    if value != value.strip() or not value or len(value) > max_length:
        raise AgentCredentialError(f"{field_name} must be 1 to {max_length} trimmed characters")
    if any(character.isspace() and character not in {" ", "\t"} for character in value):
        raise AgentCredentialError(f"{field_name} contains unsupported whitespace")
    if any(ord(character) < 32 or ord(character) == 127 for character in value):
        raise AgentCredentialError(f"{field_name} contains control characters")
    return value
