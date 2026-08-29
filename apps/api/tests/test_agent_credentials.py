from __future__ import annotations

from datetime import UTC, datetime

import pytest

from memedrop_api.agent_credentials import (
    AgentCredentialService,
    ApiKeyRecord,
    InvalidAuthorization,
    StoredCredential,
    UserCredentialStatus,
    UserRecord,
    _hash_secret,
    bearer_api_key_id,
)
from memedrop_api.public_ids import PublicIdKind, create_public_id


class FakeCredentialRepository:
    def __init__(self) -> None:
        self.users: dict[str, UserRecord] = {}
        self.keys: dict[str, tuple[ApiKeyRecord, bytes]] = {}

    async def create_user(
        self, *, auth_provider: str, auth_subject: str, email: str | None
    ) -> UserRecord:
        now = datetime.now(UTC)
        user = UserRecord(
            create_public_id(PublicIdKind.USER).value,
            auth_provider,
            auth_subject,
            email,
            0,
            now,
        )
        self.users[user.id] = user
        return user

    async def user_status(self, *, user_id: str) -> UserCredentialStatus:
        return UserCredentialStatus(
            self.users[user_id],
            tuple(record for record, _ in self.keys.values() if record.user_id == user_id),
        )

    async def issue_api_key(self, *, user_id: str, name: str, secret_hash: bytes) -> ApiKeyRecord:
        key = ApiKeyRecord(
            create_public_id(PublicIdKind.API_KEY).value,
            user_id,
            name,
            None,
            None,
            datetime.now(UTC),
        )
        self.keys[key.id] = (key, secret_hash)
        return key

    async def find_active_credential(self, *, key_id: str) -> StoredCredential | None:
        value = self.keys.get(key_id)
        if value is None or value[0].revoked_at is not None:
            return None
        return StoredCredential(*value)

    async def mark_key_used(self, *, user_id: str, key_id: str, used_at: datetime) -> bool:
        record, secret_hash = self.keys[key_id]
        if record.user_id != user_id or record.revoked_at is not None:
            return False
        used = ApiKeyRecord(
            record.id, record.user_id, record.name, used_at, None, record.created_at
        )
        self.keys[key_id] = (used, secret_hash)
        return True

    async def revoke_api_key(
        self, *, user_id: str, key_id: str, revoked_at: datetime
    ) -> ApiKeyRecord:
        record, secret_hash = self.keys[key_id]
        revoked = ApiKeyRecord(
            record.id,
            user_id,
            record.name,
            record.last_used_at,
            revoked_at,
            record.created_at,
        )
        self.keys[key_id] = (revoked, secret_hash)
        return revoked

    async def rotate_api_key(
        self,
        *,
        user_id: str,
        key_id: str,
        replacement_name: str,
        replacement_secret_hash: bytes,
        rotated_at: datetime,
    ) -> ApiKeyRecord:
        await self.revoke_api_key(user_id=user_id, key_id=key_id, revoked_at=rotated_at)
        return await self.issue_api_key(
            user_id=user_id,
            name=replacement_name,
            secret_hash=replacement_secret_hash,
        )


async def test_user_issues_authenticates_and_revokes_one_time_key() -> None:
    repository = FakeCredentialRepository()
    service = AgentCredentialService(repository)
    user = await service.create_user(
        auth_provider="github", auth_subject="github-user-1", email="dev@example.com"
    )
    issued = await service.issue_api_key(user_id=user.id, name="Production")
    assert repr(issued).find(issued.secret) == -1
    assert len(repository.keys[issued.key.id][1]) == 32

    principal = await service.authenticate_bearer(f"Bearer {issued.credential}")
    assert (principal.user_id, principal.api_key_id) == (user.id, issued.key.id)
    await service.revoke_api_key(user_id=user.id, key_id=issued.key.id)
    with pytest.raises(InvalidAuthorization):
        await service.authenticate_bearer(f"Bearer {issued.credential}")


def test_api_key_hash_is_binary_and_bearer_lookup_exposes_only_public_id() -> None:
    key_id = create_public_id(PublicIdKind.API_KEY).value
    credential = f"{key_id}.{'a' * 43}"
    assert len(_hash_secret("secret")) == 32
    assert bearer_api_key_id(f"Bearer {credential}") == key_id
    assert bearer_api_key_id("Bearer malformed") is None
