from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import uuid4

import httpx
import pytest

from memedrop_api.agent_credentials import AuthenticatedAgent, InvalidAuthorization
from memedrop_api.agent_generated_assets import (
    AgentGeneratedAsset,
    GeneratedAssetExpired,
    GeneratedAssetNotFound,
)
from memedrop_api.agent_generation_credits import (
    CreditBalance,
    DurableGenerationAsset,
    GenerationAssetInput,
    GenerationCompletion,
    GenerationResult,
    GenerationStatus,
    IdempotencyConflict,
    InsufficientCredits,
)
from memedrop_api.app import create_app
from memedrop_api.config import Settings
from memedrop_api.public_ids import PublicIdKind, create_public_id
from memedrop_api.rate_limit import MemoryRateLimitStore
from memedrop_api.services.agent_memes import (
    AgentMemeGenerationFailure,
    AgentMemeService,
    RenderedAgentAsset,
)
from memedrop_api.services.meme_renderer import RenderedMeme
from memedrop_api.services.storage import LocalMemeStorage, StoredObject, public_path_for_key
from memedrop_api.services.suggestion_engine import SuggestionRun, SuggestionTiming


class FakeCredentials:
    def __init__(self, account_id: str, api_key_id: str) -> None:
        self.principal = AuthenticatedAgent(account_id, api_key_id)

    async def authenticate_bearer(self, authorization: str | None) -> AuthenticatedAgent:
        structured_credential = f"Bearer {self.principal.api_key_id}.{'a' * 43}"
        if authorization not in {"Bearer test-token", structured_credential}:
            raise InvalidAuthorization("invalid bearer credential")
        return self.principal


class FakeAssets:
    def __init__(self) -> None:
        self.assets: list[AgentGeneratedAsset] = []
        self.expired = False

    async def list_for_generation(self, *, account_id: str, generation_id: str, **_: object):
        if self.expired:
            return []
        return [
            asset
            for asset in self.assets
            if asset.agent_account_id == account_id and asset.generation_id == generation_id
        ]

    async def get_for_serving(self, *, account_id: str, asset_id: str, **_: object):
        if self.expired:
            raise GeneratedAssetExpired("expired")
        for asset in self.assets:
            if asset.agent_account_id == account_id and asset.id == asset_id:
                return asset
        raise GeneratedAssetNotFound("not found")

    async def has_any_for_generation(self, *, account_id: str, generation_id: str) -> bool:
        return any(
            asset.agent_account_id == account_id and asset.generation_id == generation_id
            for asset in self.assets
        )


class FakeCredits:
    def __init__(self, assets: FakeAssets, *, credits: int = 1) -> None:
        self.assets = assets
        self.credits = credits
        self.generations: dict[str, GenerationResult] = {}
        self.fingerprints: dict[str, str] = {}
        self.completions = 0
        self.settlements: list[GenerationStatus] = []

    async def begin_generation(
        self, *, account_id: str, idempotency_key: str, request_fingerprint: str, **_: object
    ) -> GenerationResult:
        if idempotency_key in self.generations:
            if self.fingerprints[idempotency_key] != request_fingerprint:
                raise IdempotencyConflict("conflict")
            prior = self.generations[idempotency_key]
            return GenerationResult(
                prior.id, prior.status, prior.failure_code, prior.balance, replayed=True
            )
        if self.credits < 1:
            raise InsufficientCredits("insufficient")
        self.credits -= 1
        generation = GenerationResult(
            create_public_id(PublicIdKind.GENERATION).value,
            GenerationStatus.PROCESSING,
            None,
            CreditBalance(account_id, self.credits),
        )
        self.generations[idempotency_key] = generation
        self.fingerprints[idempotency_key] = request_fingerprint
        return generation

    async def complete_generation_with_assets(
        self, *, account_id: str, generation_id: str, assets: tuple[GenerationAssetInput, ...]
    ) -> GenerationCompletion:
        self.completions += 1
        records = tuple(
            DurableGenerationAsset(
                id=create_public_id(PublicIdKind.ASSET).value,
                agent_account_id=account_id,
                generation_id=generation_id,
                object_key=asset.object_key,
                content_type=asset.content_type,
                content_hash=asset.content_hash,
                expires_at=datetime.now(UTC) + timedelta(days=30),
            )
            for asset in assets
        )
        self.assets.assets.extend(
            AgentGeneratedAsset(
                id=record.id,
                agent_account_id=record.agent_account_id,
                generation_id=record.generation_id,
                object_key=record.object_key,
                content_type=record.content_type,
                content_hash=record.content_hash,
                expires_at=record.expires_at,
            )
            for record in records
        )
        completed = GenerationResult(
            generation_id,
            GenerationStatus.SUCCEEDED,
            None,
            CreditBalance(account_id, self.credits),
        )
        for key, value in self.generations.items():
            if value.id == generation_id:
                self.generations[key] = completed
        return GenerationCompletion(completed, records)

    async def settle_generation(
        self,
        *,
        account_id: str,
        generation_id: str,
        outcome: GenerationStatus,
        failure_code: str | None = None,
        **_: object,
    ) -> GenerationResult:
        self.settlements.append(outcome)
        if outcome is not GenerationStatus.SUCCEEDED:
            self.credits += 1
        settled = GenerationResult(
            generation_id, outcome, failure_code, CreditBalance(account_id, self.credits)
        )
        for key, value in self.generations.items():
            if value.id == generation_id:
                self.generations[key] = settled
        return settled


class FakeGenerator:
    def __init__(self, result: list[RenderedAgentAsset] | Exception) -> None:
        self.result = result
        self.calls = 0

    async def generate(self, *_: object, **__: object) -> list[RenderedAgentAsset]:
        self.calls += 1
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


class RecordingRateLimiter:
    def __init__(self) -> None:
        self.keys: list[str] = []
        self.agent_calls = 0

    async def setup(self) -> None:
        return None

    async def close(self) -> None:
        return None

    async def consume(self, key: str, _: int, __: int) -> bool:
        self.keys.append(key)
        if key.startswith("agent:"):
            self.agent_calls += 1
            return self.agent_calls == 1
        return True


class KeyAttemptRateLimiter:
    def __init__(self) -> None:
        self.keys: list[str] = []
        self.key_attempts = 0

    async def setup(self) -> None:
        return None

    async def close(self) -> None:
        return None

    async def consume(self, key: str, _: int, __: int) -> bool:
        self.keys.append(key)
        if key.startswith("agent-auth:"):
            self.key_attempts += 1
            return self.key_attempts == 1
        return True


def rendered_asset(generation_id: str | None = None) -> RenderedAgentAsset:
    generation = generation_id or "gen_placeholder"
    return RenderedAgentAsset(
        object_key=f"generated/agents/{generation}/1-finished.webp",
        content_type="image/webp",
        content_hash="a" * 64,
    )


def app_harness(
    settings: Settings,
    tmp_path: Path,
    generator: FakeGenerator,
    *,
    credits: int = 1,
    rate_limiter: MemoryRateLimitStore | RecordingRateLimiter | None = None,
):
    account_id = create_public_id(PublicIdKind.AGENT_ACCOUNT).value
    api_key_id = create_public_id(PublicIdKind.API_KEY).value
    assets = FakeAssets()
    credit_service = FakeCredits(assets, credits=credits)
    storage = LocalMemeStorage(tmp_path / "agent-media")
    app = create_app(
        settings,
        storage=storage,
        rate_limiter=rate_limiter or MemoryRateLimitStore(),  # type: ignore[arg-type]
        agent_credentials=FakeCredentials(account_id, api_key_id),  # type: ignore[arg-type]
        agent_generation_credits=credit_service,  # type: ignore[arg-type]
        agent_generated_asset_store=assets,
        agent_meme_service=generator,  # type: ignore[arg-type]
    )
    return app, assets, credit_service, storage


async def test_generate_requires_bearer_and_idempotency_key(
    settings: Settings, tmp_path: Path
) -> None:
    app, _, _, _ = app_harness(settings, tmp_path, FakeGenerator([]))
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        missing_auth = await client.post("/api/v1/memes/generate", json={"input": "hello"})
        missing_key = await client.post(
            "/api/v1/memes/generate",
            json={"input": "hello"},
            headers={"Authorization": "Bearer test-token"},
        )
        legacy_install = await client.post(
            "/api/v1/memes/generate",
            json={"input": "hello"},
            headers={"x-memedrop-install-id": "ignored"},
        )

    assert missing_auth.json() == {"error": {"code": "authentication_failed"}}
    assert missing_key.json() == {"error": {"code": "invalid_input"}}
    assert legacy_install.json() == {"error": {"code": "install_auth_not_supported"}}


async def test_success_is_durable_absolute_and_replay_does_no_work(
    settings: Settings, tmp_path: Path
) -> None:
    generator = FakeGenerator([rendered_asset()])
    app, assets, credits, _ = app_harness(settings, tmp_path, generator)
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    headers = {"Authorization": "Bearer test-token", "Idempotency-Key": "same-request"}
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        first = await client.post(
            "/api/v1/memes/generate", json={"input": "hello"}, headers=headers
        )
        second = await client.post(
            "/api/v1/memes/generate", json={"input": "hello"}, headers=headers
        )

    assert first.status_code == second.status_code == 200
    assert first.json() == second.json()
    meme = first.json()["memes"][0]
    assert meme["id"].startswith("asset_")
    assert meme["image_url"].startswith("http://localhost:3001/api/v1/memes/assets/")
    assert "caption" not in meme and "alt_text" not in meme
    assert generator.calls == 1
    assert credits.completions == 1
    assert len(assets.assets) == 1


async def test_no_fit_releases_credit_and_idempotency_conflict_is_stable(
    settings: Settings, tmp_path: Path
) -> None:
    generator = FakeGenerator([])
    app, _, credits, _ = app_harness(settings, tmp_path, generator)
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    headers = {"Authorization": "Bearer test-token", "Idempotency-Key": "same-request"}
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        no_fit = await client.post(
            "/api/v1/memes/generate", json={"input": "hello"}, headers=headers
        )
        conflict = await client.post(
            "/api/v1/memes/generate", json={"input": "different"}, headers=headers
        )

    assert no_fit.json() == {"status": "no_fit", "memes": []}
    assert credits.settlements == [GenerationStatus.NO_FIT]
    assert conflict.status_code == 409
    assert conflict.json() == {"error": {"code": "idempotency_conflict"}}


async def test_private_media_rejects_generic_path_and_other_tenant(
    settings: Settings, tmp_path: Path
) -> None:
    generator = FakeGenerator([rendered_asset()])
    app, assets, _, storage = app_harness(settings, tmp_path, generator)
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    headers = {"Authorization": "Bearer test-token", "Idempotency-Key": "media-request"}
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        generated = await client.post(
            "/api/v1/memes/generate", json={"input": "hello"}, headers=headers
        )
        asset = assets.assets[0]
        await storage.put_bytes(asset.object_key, b"image", content_type=asset.content_type)
        private = await client.get(generated.json()["memes"][0]["image_url"], headers=headers)
        generic = await client.get(public_path_for_key(asset.object_key))

    assert private.status_code == 200
    assert private.headers["cache-control"] == "private, no-store"
    assert private.headers["vary"] == "Authorization"
    assert generic.status_code == 404


async def test_known_generation_failure_releases_credit(settings: Settings, tmp_path: Path) -> None:
    app, _, credits, _ = app_harness(
        settings, tmp_path, FakeGenerator(AgentMemeGenerationFailure("storage_failure"))
    )
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/memes/generate",
            json={"input": "hello"},
            headers={"Authorization": "Bearer test-token", "Idempotency-Key": "fail-request"},
        )
        replay = await client.post(
            "/api/v1/memes/generate",
            json={"input": "hello"},
            headers={"Authorization": "Bearer test-token", "Idempotency-Key": "fail-request"},
        )

    assert response.status_code == replay.status_code == 500
    assert response.json() == replay.json() == {"error": {"code": "storage_failure"}}
    assert credits.settlements == [GenerationStatus.FAILED]


async def test_ip_limiter_runs_before_auth_and_tenant_limiter_runs_after_auth(
    settings: Settings, tmp_path: Path
) -> None:
    limiter = RecordingRateLimiter()
    generator = FakeGenerator([rendered_asset()])
    app, _, _, _ = app_harness(
        settings,
        tmp_path,
        generator,
        credits=2,
        rate_limiter=limiter,
    )
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        unauthenticated = await client.post("/api/v1/memes/generate", json={"input": "hello"})
        first = await client.post(
            "/api/v1/memes/generate",
            json={"input": "hello"},
            headers={"Authorization": "Bearer test-token", "Idempotency-Key": "one"},
        )
        second = await client.post(
            "/api/v1/memes/generate",
            json={"input": "hello"},
            headers={"Authorization": "Bearer test-token", "Idempotency-Key": "two"},
        )

    assert unauthenticated.status_code == 401
    assert first.status_code == 200
    assert second.json() == {"error": {"code": "rate_limited"}}
    assert any(key.startswith("ip:") for key in limiter.keys)
    assert sum(key.startswith("agent:") for key in limiter.keys) == 2


async def test_valid_public_key_prefix_is_limited_before_secret_authentication(
    settings: Settings, tmp_path: Path
) -> None:
    limiter = KeyAttemptRateLimiter()
    app, _, _, _ = app_harness(
        settings,
        tmp_path,
        FakeGenerator([rendered_asset()]),
        credits=2,
        rate_limiter=limiter,  # type: ignore[arg-type]
    )
    api_key_id = app.state.agent_credentials.principal.api_key_id
    headers = {
        "Authorization": f"Bearer {api_key_id}.{'a' * 43}",
        "Idempotency-Key": "key-prefix-limit",
    }
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        first = await client.post(
            "/api/v1/memes/generate", json={"input": "hello"}, headers=headers
        )
        second = await client.post(
            "/api/v1/memes/generate", json={"input": "hello"}, headers=headers
        )

    assert first.status_code == 200
    assert second.json() == {"error": {"code": "rate_limited"}}
    assert any(key.startswith(f"agent-auth:{api_key_id}:") for key in limiter.keys)


async def test_expired_successful_replay_is_gone(settings: Settings, tmp_path: Path) -> None:
    generator = FakeGenerator([rendered_asset()])
    app, assets, _, _ = app_harness(settings, tmp_path, generator)
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    headers = {"Authorization": "Bearer test-token", "Idempotency-Key": "expires"}
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        initial = await client.post(
            "/api/v1/memes/generate", json={"input": "hello"}, headers=headers
        )
        assets.expired = True
        replay = await client.post(
            "/api/v1/memes/generate", json={"input": "hello"}, headers=headers
        )
        media = await client.get(initial.json()["memes"][0]["image_url"], headers=headers)

    assert initial.status_code == 200
    assert replay.status_code == media.status_code == 410
    assert replay.json() == media.json() == {"error": {"code": "asset_expired"}}


async def test_unexpected_parallel_render_failure_deletes_every_attempted_object() -> None:
    class Suggestions:
        async def get_suggestion_run(self, *_: object, **__: object) -> SuggestionRun:
            overlay = {"regions": [{"text": "caption"}]}
            suggestions: list[dict[str, Any]] = [
                {"image_url": "/memes/catalog/one.png", "tailored_overlay": overlay},
                {"image_url": "/memes/catalog/two.png", "tailored_overlay": overlay},
            ]
            return SuggestionRun(suggestions, SuggestionTiming())

    class Storage:
        def __init__(self) -> None:
            self.first_stored = asyncio.Event()
            self.deleted: list[str] = []

        async def read_bytes(self, _: str) -> StoredObject:
            return StoredObject(b"source", "image/png")

        async def put_bytes(self, object_key: str, *_: object, **__: object) -> str:
            if "/1-" in object_key:
                self.first_stored.set()
                return public_path_for_key(object_key)
            await self.first_stored.wait()
            raise RuntimeError("unexpected storage bug")

        async def delete(self, public_path: str) -> bool:
            self.deleted.append(public_path)
            return True

    storage = Storage()

    def renderer(_: bytes, __: object) -> RenderedMeme:
        return RenderedMeme(b"finished", "image/webp", 1, 1)

    service = AgentMemeService(Suggestions(), storage, renderer)  # type: ignore[arg-type]
    generation_id = create_public_id(PublicIdKind.GENERATION).value
    account_id = create_public_id(PublicIdKind.AGENT_ACCOUNT).value
    with pytest.raises(RuntimeError, match="unexpected storage bug"):
        await service.generate(
            "private source text",
            generation_id=generation_id,
            agent_account_id=account_id,
            user_id=uuid4(),
            direction=None,
            count=2,
        )

    assert len(storage.deleted) == 2
    assert all(
        path.startswith(f"/memes/generated/agents/{account_id}/{generation_id}/")
        for path in storage.deleted
    )
