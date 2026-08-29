from __future__ import annotations

import hashlib
from datetime import UTC, datetime

import httpx
import jwt
import pytest
from fastapi import HTTPException

from memedrop_api.agent_credentials import (
    AgentApiKeyNotFound,
    AgentCredentialService,
    ApiKeyRecord,
    StoredApiKeyIssuance,
    StoredCredential,
    UserCredentialStatus,
    UserRecord,
)
from memedrop_api.app import create_app
from memedrop_api.config import Settings
from memedrop_api.dashboard_auth import (
    DASHBOARD_ASSERTION_AUDIENCE,
    DASHBOARD_ASSERTION_ISSUER,
    verify_dashboard_assertion,
)
from memedrop_api.public_ids import PublicIdKind, create_public_id

SECRET = "dashboard-secret-0123456789-abcdefghijklmnopqrstuvwxyz"


class DashboardCredentialRepository:
    def __init__(self) -> None:
        self.users: dict[tuple[str, str], UserRecord] = {}
        self.keys: dict[str, tuple[ApiKeyRecord, bytes]] = {}
        self.issuances: dict[tuple[str, bytes], str] = {}

    async def create_user(
        self, *, auth_provider: str, auth_subject: str, email: str | None
    ) -> UserRecord:
        identity = (auth_provider, auth_subject)
        existing = self.users.get(identity)
        if existing is not None:
            refreshed = UserRecord(
                existing.id,
                existing.auth_provider,
                existing.auth_subject,
                email or existing.email,
                existing.credits,
                existing.created_at,
            )
            self.users[identity] = refreshed
            return refreshed
        user = UserRecord(
            create_public_id(PublicIdKind.USER).value,
            auth_provider,
            auth_subject,
            email,
            17,
            datetime.now(UTC),
        )
        self.users[identity] = user
        return user

    async def user_status(self, *, user_id: str) -> UserCredentialStatus:
        user = next(user for user in self.users.values() if user.id == user_id)
        return UserCredentialStatus(
            user,
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

    async def issue_idempotent_api_key(
        self,
        *,
        user_id: str,
        name: str,
        secret_hash: bytes,
        issuance_idempotency_hash: bytes,
    ) -> StoredApiKeyIssuance:
        identity = (user_id, issuance_idempotency_hash)
        existing_id = self.issuances.get(identity)
        if existing_id is not None:
            return StoredApiKeyIssuance(*self.keys[existing_id])
        key = await self.issue_api_key(user_id=user_id, name=name, secret_hash=secret_hash)
        self.issuances[identity] = key.id
        return StoredApiKeyIssuance(key, secret_hash)

    async def find_active_credential(self, *, key_id: str) -> StoredCredential | None:
        stored = self.keys.get(key_id)
        return None if stored is None else StoredCredential(*stored)

    async def mark_key_used(self, *, user_id: str, key_id: str, used_at: datetime) -> bool:
        return False

    async def revoke_api_key(
        self, *, user_id: str, key_id: str, revoked_at: datetime
    ) -> ApiKeyRecord:
        stored = self.keys.get(key_id)
        if stored is None or stored[0].user_id != user_id or stored[0].revoked_at is not None:
            raise AgentApiKeyNotFound("not found")
        current, secret_hash = stored
        revoked = ApiKeyRecord(
            current.id,
            current.user_id,
            current.name,
            current.last_used_at,
            revoked_at,
            current.created_at,
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
        raise NotImplementedError


def _claims(**overrides: object) -> dict[str, object]:
    now = int(datetime.now(UTC).timestamp())
    claims: dict[str, object] = {
        "iss": DASHBOARD_ASSERTION_ISSUER,
        "aud": DASHBOARD_ASSERTION_AUDIENCE,
        "iat": now,
        "exp": now + 30,
        "sub": "github:account-123",
        "provider": "github",
        "provider_account_id": "account-123",
        "email": "developer@example.com",
    }
    claims.update(overrides)
    return claims


def _token(**overrides: object) -> str:
    return jwt.encode(_claims(**overrides), SECRET, algorithm="HS256")


def _settings(settings: Settings, *, enabled: bool = True) -> Settings:
    return settings.model_copy(update={"dashboard_token_secret": SECRET if enabled else None})


def _client(
    settings: Settings, repository: DashboardCredentialRepository, *, enabled: bool = True
) -> httpx.AsyncClient:
    app = create_app(
        _settings(settings, enabled=enabled),
        agent_credentials=AgentCredentialService(repository),
    )
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    )


async def test_dashboard_routes_are_absent_without_bridge_secret(settings: Settings) -> None:
    async with _client(settings, DashboardCredentialRepository(), enabled=False) as client:
        response = await client.get("/api/v1/dashboard/overview")

    assert response.status_code == 404
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["pragma"] == "no-cache"


async def test_valid_assertion_bootstraps_and_returns_user_overview(settings: Settings) -> None:
    repository = DashboardCredentialRepository()
    async with _client(settings, repository) as client:
        response = await client.get(
            "/api/v1/dashboard/overview",
            headers={"Authorization": f"Bearer {_token()}"},
        )

    assert response.status_code == 200
    assert response.headers["cache-control"] == "private, no-store"
    assert response.headers["pragma"] == "no-cache"
    assert response.json() == {
        "user": {
            "id": next(iter(repository.users.values())).id,
            "email": "developer@example.com",
            "credits": 17,
            "created_at": next(iter(repository.users.values()))
            .created_at.isoformat()
            .replace("+00:00", "Z"),
        },
        "api_keys": [],
    }
    assert list(repository.users) == [("github", "account-123")]


@pytest.mark.parametrize(
    "claim_overrides",
    [
        {"iss": "other-web"},
        {"aud": "other-api"},
        {"sub": "github:someone-else"},
        {"provider": "credentials"},
        {"aud": [DASHBOARD_ASSERTION_AUDIENCE]},
        {"iat": 2_000_000_000, "exp": 2_000_000_030},
    ],
)
def test_dashboard_assertion_rejects_invalid_identity_and_lifetime(
    claim_overrides: dict[str, object],
) -> None:
    token = jwt.encode(_claims(**claim_overrides), SECRET, algorithm="HS256")

    with pytest.raises(HTTPException) as captured:
        verify_dashboard_assertion(token, SECRET)

    assert getattr(captured.value, "status_code", None) == 401
    assert token not in str(captured.value)


def test_dashboard_assertion_rejects_expired_or_overlong_lifetimes() -> None:
    now = int(datetime.now(UTC).timestamp())
    tokens = (
        jwt.encode(_claims(iat=now - 60, exp=now - 30), SECRET, algorithm="HS256"),
        jwt.encode(_claims(iat=now, exp=now + 46), SECRET, algorithm="HS256"),
    )

    for token in tokens:
        with pytest.raises(HTTPException) as captured:
            verify_dashboard_assertion(token, SECRET)
        assert getattr(captured.value, "status_code", None) == 401


def test_dashboard_assertion_requires_every_claim_and_hs256() -> None:
    claims = _claims()
    del claims["provider_account_id"]
    missing = jwt.encode(claims, SECRET, algorithm="HS256")
    wrong_algorithm = jwt.encode(_claims(), SECRET, algorithm="HS384")

    for token in (missing, wrong_algorithm):
        with pytest.raises(HTTPException) as captured:
            verify_dashboard_assertion(token, SECRET)
        assert getattr(captured.value, "status_code", None) == 401


async def test_dashboard_key_lifecycle_is_one_time_and_tenant_isolated(
    settings: Settings,
) -> None:
    repository = DashboardCredentialRepository()
    own_headers = {
        "Authorization": f"Bearer {_token()}",
        "Idempotency-Key": "create-production-key-1",
    }
    other_token = _token(
        sub="google:other-456",
        provider="google",
        provider_account_id="other-456",
        email=None,
    )
    other_headers = {"Authorization": f"Bearer {other_token}"}
    async with _client(settings, repository) as client:
        created = await client.post(
            "/api/v1/dashboard/api-keys",
            headers=own_headers,
            json={"name": " Production "},
        )
        replayed = await client.post(
            "/api/v1/dashboard/api-keys",
            headers=own_headers,
            json={"name": " Production "},
        )
        conflicting = await client.post(
            "/api/v1/dashboard/api-keys",
            headers=own_headers,
            json={"name": "Staging"},
        )
        key_id = created.json()["api_key"]["id"]
        credential = created.json()["credential"]
        other_revoke = await client.post(
            f"/api/v1/dashboard/api-keys/{key_id}/revoke", headers=other_headers
        )
        revoked = await client.post(
            f"/api/v1/dashboard/api-keys/{key_id}/revoke", headers=own_headers
        )
        overview = await client.get("/api/v1/dashboard/overview", headers=own_headers)

    assert created.status_code == 201
    assert replayed.status_code == 201
    assert replayed.json() == created.json()
    assert conflicting.status_code == 409
    assert len(repository.keys) == 1
    assert created.headers["cache-control"] == "private, no-store"
    assert created.headers["pragma"] == "no-cache"
    assert created.json()["api_key"]["name"] == "Production"
    assert credential.startswith(f"{key_id}.")
    assert (
        repository.keys[key_id][1] == hashlib.sha256(credential.partition(".")[2].encode()).digest()
    )
    assert credential not in repr(repository.keys)
    assert credential.partition(".")[2] not in repr(repository.keys)
    assert other_revoke.status_code == 404
    assert revoked.status_code == 200
    assert revoked.json()["api_key"]["revoked_at"] is not None
    assert "credential" not in overview.text
    assert "secret" not in overview.text


async def test_dashboard_rejects_missing_assertion_and_invalid_key_name(settings: Settings) -> None:
    repository = DashboardCredentialRepository()
    async with _client(settings, repository) as client:
        missing = await client.get("/api/v1/dashboard/overview")
        missing_idempotency = await client.post(
            "/api/v1/dashboard/api-keys",
            headers={"Authorization": f"Bearer {_token()}"},
            json={"name": "Production"},
        )
        invalid_name = await client.post(
            "/api/v1/dashboard/api-keys",
            headers={
                "Authorization": f"Bearer {_token()}",
                "Idempotency-Key": "invalid-name-test",
            },
            json={"name": "bad\u0000name"},
        )

    assert missing.status_code == 401
    assert missing.headers["cache-control"] == "private, no-store"
    assert missing.headers["pragma"] == "no-cache"
    assert missing_idempotency.status_code == 400
    assert invalid_name.status_code == 400
    assert invalid_name.headers["cache-control"] == "private, no-store"
    assert invalid_name.headers["pragma"] == "no-cache"


async def test_dashboard_and_agent_credentials_are_not_interchangeable(settings: Settings) -> None:
    repository = DashboardCredentialRepository()
    key_id = create_public_id(PublicIdKind.API_KEY).value
    agent_credential = f"{key_id}.{'a' * 43}"
    bridge_token = _token()
    async with _client(settings, repository) as client:
        agent_on_dashboard = await client.get(
            "/api/v1/dashboard/overview",
            headers={"Authorization": f"Bearer {agent_credential}"},
        )
        bridge_on_generation = await client.post(
            "/api/v1/memes/generate",
            headers={
                "Authorization": f"Bearer {bridge_token}",
                "Idempotency-Key": "bridge-token-separation-test",
            },
            json={"input": "This must fail authentication before generation."},
        )

    assert agent_on_dashboard.status_code == 401
    assert bridge_on_generation.status_code == 401
    assert bridge_on_generation.json() == {"error": {"code": "authentication_failed"}}
