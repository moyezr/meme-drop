from __future__ import annotations

import hashlib
from dataclasses import replace
from datetime import UTC, datetime

import pytest

from memedrop_api.agent_credentials import (
    AgentAccountInactive,
    AgentAccountNotFound,
    AgentAccountRecord,
    AgentAccountStatus,
    AgentApiKeyNotFound,
    AgentCredentialService,
    ApiKeyRecord,
    InvalidAuthorization,
    StoredCredential,
    bearer_api_key_id,
    parse_bearer_authorization,
)
from memedrop_api.public_ids import PublicIdKind, create_public_id

NOW = datetime(2026, 8, 24, tzinfo=UTC)


class FakeCredentialRepository:
    def __init__(self) -> None:
        self.accounts: dict[str, AgentAccountRecord] = {}
        self.keys: dict[str, tuple[ApiKeyRecord, str]] = {}

    async def create_account(self, *, name: str) -> AgentAccountRecord:
        account_id = create_public_id(PublicIdKind.AGENT_ACCOUNT).value
        account = AgentAccountRecord(
            id=account_id, name=name, status="active", created_at=NOW, updated_at=NOW
        )
        self.accounts[account_id] = account
        return account

    async def account_status(self, *, account_id: str) -> AgentAccountStatus:
        account = self.accounts.get(account_id)
        if account is None:
            raise AgentAccountNotFound("agent account was not found")
        keys = tuple(key for key, _ in self.keys.values() if key.agent_account_id == account_id)
        return AgentAccountStatus(account=account, api_keys=keys)

    async def issue_api_key(self, *, account_id: str, name: str, secret_hash: str) -> ApiKeyRecord:
        account = self.accounts.get(account_id)
        if account is None or account.status != "active":
            raise AgentAccountInactive("agent account is not active")
        key = ApiKeyRecord(
            id=create_public_id(PublicIdKind.API_KEY).value,
            agent_account_id=account_id,
            name=name,
            status="active",
            last_used_at=None,
            revoked_at=None,
            revocation_reason=None,
            revoked_by_actor=None,
            created_at=NOW,
            updated_at=NOW,
        )
        self.keys[key.id] = (key, secret_hash)
        return key

    async def find_active_credential(self, *, key_id: str) -> StoredCredential | None:
        stored = self.keys.get(key_id)
        if stored is None:
            return None
        key, secret_hash = stored
        account = self.accounts.get(key.agent_account_id)
        if key.status != "active" or account is None or account.status != "active":
            return None
        return StoredCredential(key=key, secret_hash=secret_hash)

    async def mark_key_used(self, *, account_id: str, key_id: str, used_at: datetime) -> bool:
        stored = self.keys.get(key_id)
        account = self.accounts.get(account_id)
        if (
            stored is None
            or stored[0].agent_account_id != account_id
            or stored[0].status != "active"
            or account is None
            or account.status != "active"
        ):
            return False
        used_key = replace(stored[0], last_used_at=used_at, updated_at=used_at)
        self.keys[key_id] = (used_key, stored[1])
        return True

    async def revoke_api_key(
        self,
        *,
        account_id: str,
        key_id: str,
        reason: str,
        actor: str,
        revoked_at: datetime,
    ) -> ApiKeyRecord:
        stored = self.keys.get(key_id)
        if (
            stored is None
            or stored[0].agent_account_id != account_id
            or stored[0].status != "active"
        ):
            raise AgentApiKeyNotFound("active API key was not found for this account")
        revoked = replace(
            stored[0],
            status="revoked",
            revoked_at=revoked_at,
            revocation_reason=reason,
            revoked_by_actor=actor,
            updated_at=revoked_at,
        )
        self.keys[key_id] = (revoked, stored[1])
        return revoked

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
        await self.revoke_api_key(
            account_id=account_id,
            key_id=key_id,
            reason=reason,
            actor=actor,
            revoked_at=rotated_at,
        )
        replacement = ApiKeyRecord(
            id=create_public_id(PublicIdKind.API_KEY).value,
            agent_account_id=account_id,
            name=replacement_name,
            status="active",
            last_used_at=None,
            revoked_at=None,
            revocation_reason=None,
            revoked_by_actor=None,
            created_at=rotated_at,
            updated_at=rotated_at,
        )
        self.keys[replacement.id] = (replacement, replacement_secret_hash)
        return replacement


@pytest.fixture
def repository() -> FakeCredentialRepository:
    return FakeCredentialRepository()


@pytest.fixture
def service(repository: FakeCredentialRepository) -> AgentCredentialService:
    return AgentCredentialService(repository)


async def test_issued_api_key_has_a_public_lookup_id_and_256_bit_secret(
    service: AgentCredentialService, repository: FakeCredentialRepository
) -> None:
    account = await service.create_account(name="Meme agent")
    issued = await service.issue_api_key(account_id=account.id, name="production")

    assert issued.key.id.startswith("key_")
    assert len(issued.secret) == 43
    assert issued.credential == f"{issued.key.id}.{issued.secret}"
    assert issued.secret not in repr(issued)
    stored_key, stored_hash = repository.keys[issued.key.id]
    assert stored_key.id == issued.key.id
    assert stored_hash == hashlib.sha256(issued.secret.encode()).hexdigest()
    assert "secret" not in ApiKeyRecord.__dataclass_fields__
    assert "secret_hash" not in ApiKeyRecord.__dataclass_fields__


async def test_bearer_key_id_parser_never_returns_or_hashes_the_secret() -> None:
    repository = FakeCredentialRepository()
    service = AgentCredentialService(repository)
    account = await service.create_account(name="Parser test")
    issued = await service.issue_api_key(account_id=account.id, name="parser")

    assert bearer_api_key_id(f"Bearer {issued.credential}") == issued.key.id
    assert bearer_api_key_id(f"Bearer {issued.key.id}.not-a-valid-secret") is None
    assert bearer_api_key_id("Basic not-a-bearer") is None


async def test_account_status_returns_safe_key_metadata_without_secrets(
    service: AgentCredentialService,
) -> None:
    account = await service.create_account(name="Meme agent")
    issued = await service.issue_api_key(account_id=account.id, name="production")

    status = await service.account_status(account_id=account.id)

    assert status.account == account
    assert [key.id for key in status.api_keys] == [issued.key.id]
    assert issued.secret not in repr(status)
    with pytest.raises(AgentAccountNotFound):
        await service.account_status(account_id=create_public_id(PublicIdKind.AGENT_ACCOUNT).value)


@pytest.mark.parametrize(
    "authorization",
    [
        None,
        "",
        "bearer value",
        "Bearer",
        "Bearer  value",
        "Bearer value trailing",
        " Bearer value",
        "Bearer value\n",
    ],
)
def test_bearer_parsing_is_strict(authorization: str | None) -> None:
    with pytest.raises(InvalidAuthorization):
        parse_bearer_authorization(authorization)


async def test_authentication_updates_key_usage_and_is_tenant_scoped(
    service: AgentCredentialService, repository: FakeCredentialRepository
) -> None:
    account = await service.create_account(name="Meme agent")
    issued = await service.issue_api_key(account_id=account.id, name="production")

    principal = await service.authenticate_bearer(f"Bearer {issued.credential}")

    assert principal.agent_account_id == account.id
    assert principal.api_key_id == issued.key.id
    assert repository.keys[issued.key.id][0].last_used_at is not None


async def test_bad_secret_revoked_key_and_inactive_account_are_rejected(
    service: AgentCredentialService, repository: FakeCredentialRepository
) -> None:
    account = await service.create_account(name="Meme agent")
    issued = await service.issue_api_key(account_id=account.id, name="production")
    bad_secret = issued.secret[:-1] + ("A" if issued.secret[-1] != "A" else "B")

    with pytest.raises(InvalidAuthorization):
        await service.authenticate_bearer(f"Bearer {issued.key.id}.{bad_secret}")

    revoked = await service.revoke_api_key(
        account_id=account.id,
        key_id=issued.key.id,
        reason="operator_request",
        actor="operator:alice",
    )
    assert revoked.status == "revoked"
    assert revoked.revocation_reason == "operator_request"
    assert revoked.revoked_by_actor == "operator:alice"
    with pytest.raises(InvalidAuthorization):
        await service.authenticate_bearer(f"Bearer {issued.credential}")

    replacement = await service.issue_api_key(account_id=account.id, name="new production")
    repository.accounts[account.id] = replace(repository.accounts[account.id], status="suspended")
    with pytest.raises(InvalidAuthorization):
        await service.authenticate_bearer(f"Bearer {replacement.credential}")
    with pytest.raises(AgentAccountInactive):
        await service.issue_api_key(account_id=account.id, name="blocked")


async def test_rotation_revokes_the_old_key_and_delivers_a_new_secret_once(
    service: AgentCredentialService, repository: FakeCredentialRepository
) -> None:
    account = await service.create_account(name="Meme agent")
    issued = await service.issue_api_key(account_id=account.id, name="old production")

    rotated = await service.rotate_api_key(
        account_id=account.id,
        key_id=issued.key.id,
        name="new production",
        reason="scheduled_rotation",
        actor="operator:alice",
    )

    assert rotated.key.id != issued.key.id
    assert repository.keys[issued.key.id][0].status == "revoked"
    assert repository.keys[issued.key.id][0].revocation_reason == "scheduled_rotation"
    with pytest.raises(InvalidAuthorization):
        await service.authenticate_bearer(f"Bearer {issued.credential}")
    principal = await service.authenticate_bearer(f"Bearer {rotated.credential}")
    assert principal.api_key_id == rotated.key.id


async def test_key_operations_do_not_cross_tenant_boundaries(
    service: AgentCredentialService,
) -> None:
    first = await service.create_account(name="First tenant")
    second = await service.create_account(name="Second tenant")
    issued = await service.issue_api_key(account_id=first.id, name="production")

    with pytest.raises(AgentApiKeyNotFound):
        await service.revoke_api_key(
            account_id=second.id,
            key_id=issued.key.id,
            reason="operator_request",
            actor="operator:alice",
        )
