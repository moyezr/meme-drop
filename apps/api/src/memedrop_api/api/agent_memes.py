"""Authenticated, idempotent public-agent meme generation and media delivery."""

from __future__ import annotations

import asyncio
import hashlib
import json
from collections.abc import Sequence
from typing import Annotated, cast
from uuid import NAMESPACE_URL, UUID, uuid5

from botocore.exceptions import BotoCoreError, ClientError  # type: ignore[import-untyped]
from fastapi import APIRouter, Header, Request
from fastapi.responses import JSONResponse
from starlette.responses import Response

from memedrop_api.agent_credentials import (
    AgentCredentialService,
    InvalidAuthorization,
    bearer_api_key_id,
)
from memedrop_api.agent_generated_assets import (
    AgentGeneratedAsset,
    AgentGeneratedAssetStore,
    GeneratedAssetExpired,
    GeneratedAssetNotFound,
)
from memedrop_api.agent_generation_credits import (
    AgentGenerationCreditError,
    AgentGenerationCreditService,
    DurableGenerationAsset,
    GenerationAssetInput,
    GenerationResult,
    GenerationStatus,
    IdempotencyConflict,
    InsufficientCredits,
)
from memedrop_api.agent_meme_models import GeneratedMeme, GenerateMemeRequest, GenerateMemeResponse
from memedrop_api.rate_limit import RateLimitStore
from memedrop_api.services.agent_memes import (
    AgentMemeGenerationFailure,
    AgentMemeService,
    RenderedAgentAsset,
)
from memedrop_api.services.storage import MemeStorage, StorageReadError, public_path_for_key

router = APIRouter(prefix="/api/v1/memes", tags=["agent-memes"])
_AGENT_GENERATION_ROUTE = "POST /api/v1/memes/generate"


@router.post("/generate", response_model=GenerateMemeResponse)
async def generate_meme(
    body: GenerateMemeRequest,
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> GenerateMemeResponse | JSONResponse:
    """Reserve one credit, generate bounded images, and settle only durable output."""

    if request.headers.get("x-memedrop-install-id"):
        return _error(401, "install_auth_not_supported")
    limiter: RateLimitStore = request.app.state.rate_limiter
    settings = request.app.state.settings
    if (api_key_id := bearer_api_key_id(authorization)) is not None:
        allowed = await limiter.consume(
            f"agent-auth:{api_key_id}:{_AGENT_GENERATION_ROUTE}",
            settings.expensive_rate_limit_window_ms,
            settings.expensive_rate_limit_max,
        )
        if not allowed:
            return _error(429, "rate_limited")
    principal = await _authenticate_agent(request, authorization)
    if isinstance(principal, JSONResponse):
        return principal
    if not idempotency_key:
        return _error(400, "invalid_input")
    allowed = await limiter.consume(
        f"agent:{principal.agent_account_id}:{_AGENT_GENERATION_ROUTE}",
        settings.expensive_rate_limit_window_ms,
        settings.expensive_rate_limit_max,
    )
    if not allowed:
        return _error(429, "rate_limited")

    credits = cast(AgentGenerationCreditService, request.app.state.agent_generation_credits)
    try:
        generation = await credits.begin_generation(
            account_id=principal.agent_account_id,
            api_key_id=principal.api_key_id,
            idempotency_key=idempotency_key,
            request_fingerprint=_request_fingerprint(body),
        )
    except IdempotencyConflict:
        return _error(409, "idempotency_conflict")
    except InsufficientCredits:
        return _error(402, "insufficient_credits")
    except AgentGenerationCreditError:
        return _error(400, "invalid_input")

    assets = cast(AgentGeneratedAssetStore, request.app.state.agent_generated_asset_store)
    if generation.replayed:
        return await _replay_response(request, generation, assets)

    generator: AgentMemeService = request.app.state.agent_meme_service
    try:
        rendered_assets = await generator.generate(
            body.input,
            generation_id=generation.id,
            agent_account_id=principal.agent_account_id,
            user_id=_agent_suggestion_user_id(principal.agent_account_id),
            direction=body.options.direction,
            count=body.options.count,
        )
    except asyncio.CancelledError:
        await _release_after_abort(
            credits,
            account_id=principal.agent_account_id,
            generation_id=generation.id,
            outcome=GenerationStatus.CANCELLED,
            failure_code="request_cancelled",
        )
        raise
    except AgentMemeGenerationFailure as error:
        await _release_after_abort(
            credits,
            account_id=principal.agent_account_id,
            generation_id=generation.id,
            outcome=GenerationStatus.FAILED,
            failure_code=error.code,
        )
        return _error(500, _failed_generation_code(error.code))
    except TimeoutError:
        await _release_after_abort(
            credits,
            account_id=principal.agent_account_id,
            generation_id=generation.id,
            outcome=GenerationStatus.FAILED,
            failure_code="provider_timeout",
        )
        return _error(504, "provider_timeout")
    except Exception:
        await _release_after_abort(
            credits,
            account_id=principal.agent_account_id,
            generation_id=generation.id,
            outcome=GenerationStatus.FAILED,
            failure_code="internal_failure",
        )
        raise

    if not rendered_assets:
        await credits.settle_generation(
            account_id=principal.agent_account_id,
            generation_id=generation.id,
            outcome=GenerationStatus.NO_FIT,
        )
        return GenerateMemeResponse(status="no_fit", memes=[])

    try:
        completion = await credits.complete_generation_with_assets(
            account_id=principal.agent_account_id,
            generation_id=generation.id,
            assets=tuple(
                GenerationAssetInput(
                    object_key=rendered.object_key,
                    content_type=rendered.content_type,
                    content_hash=rendered.content_hash,
                )
                for rendered in rendered_assets
            ),
        )
    except asyncio.CancelledError:
        await _delete_rendered_objects(request, rendered_assets)
        await _release_after_abort(
            credits,
            account_id=principal.agent_account_id,
            generation_id=generation.id,
            outcome=GenerationStatus.CANCELLED,
            failure_code="request_cancelled",
        )
        raise
    except Exception:
        await _delete_rendered_objects(request, rendered_assets)
        await _release_after_abort(
            credits,
            account_id=principal.agent_account_id,
            generation_id=generation.id,
            outcome=GenerationStatus.FAILED,
            failure_code="asset_persistence_failure",
        )
        raise
    return GenerateMemeResponse(
        status="ok",
        memes=[_public_asset(request, asset) for asset in completion.assets],
    )


@router.get("/assets/{asset_id}", include_in_schema=False, response_model=None)
async def serve_generated_asset(
    asset_id: str,
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> Response | JSONResponse:
    """Serve an unexpired generated image only to its authenticated tenant."""

    if request.headers.get("x-memedrop-install-id"):
        return _error(401, "install_auth_not_supported")
    principal = await _authenticate_agent(request, authorization)
    if isinstance(principal, JSONResponse):
        return principal
    assets = cast(AgentGeneratedAssetStore, request.app.state.agent_generated_asset_store)
    try:
        asset = await assets.get_for_serving(
            account_id=principal.agent_account_id,
            asset_id=asset_id,
        )
    except GeneratedAssetExpired:
        return _error(410, "asset_expired")
    except (GeneratedAssetNotFound, ValueError):
        return _error(404, "asset_not_found")
    storage: MemeStorage = request.app.state.meme_storage
    response = await storage.serve(public_path_for_key(asset.object_key))
    response.headers["Cache-Control"] = "private, no-store"
    response.headers["Vary"] = "Authorization"
    return response


async def _authenticate_agent(request: Request, authorization: str | None):
    credentials = cast(AgentCredentialService, request.app.state.agent_credentials)
    try:
        return await credentials.authenticate_bearer(authorization)
    except InvalidAuthorization:
        return _error(401, "authentication_failed")


async def _replay_response(
    request: Request,
    generation: GenerationResult,
    assets: AgentGeneratedAssetStore,
) -> GenerateMemeResponse | JSONResponse:
    if generation.status is GenerationStatus.PROCESSING:
        return _error(409, "idempotency_in_progress")
    if generation.status is GenerationStatus.NO_FIT:
        return GenerateMemeResponse(status="no_fit", memes=[])
    if generation.status is not GenerationStatus.SUCCEEDED:
        code = _failed_generation_code(generation.failure_code)
        return _error(504 if code == "provider_timeout" else 500, code)
    durable_assets = await assets.list_for_generation(
        account_id=generation.balance.agent_account_id,
        generation_id=generation.id,
    )
    if not durable_assets:
        if await assets.has_any_for_generation(
            account_id=generation.balance.agent_account_id,
            generation_id=generation.id,
        ):
            return _error(410, "asset_expired")
        return _error(500, "internal_failure")
    return GenerateMemeResponse(
        status="ok",
        memes=[_public_asset(request, asset) for asset in durable_assets],
    )


def _request_fingerprint(body: GenerateMemeRequest) -> str:
    """Hash canonical validated input so free text never enters persistence or keys."""

    canonical = json.dumps(
        body.model_dump(mode="json"),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )
    return hashlib.sha256(canonical.encode()).hexdigest()


def _agent_suggestion_user_id(agent_account_id: str) -> UUID:
    """Use a stable internal UUID for legacy suggestion feedback boundaries."""

    return uuid5(NAMESPACE_URL, f"memedrop-agent:{agent_account_id}")


def _public_asset(
    request: Request, asset: AgentGeneratedAsset | DurableGenerationAsset
) -> GeneratedMeme:
    origin = request.app.state.settings.normalized_api_public_origin
    return GeneratedMeme(
        id=asset.id,
        image_url=f"{origin}/api/v1/memes/assets/{asset.id}",
        expires_at=asset.expires_at,
    )


async def _delete_rendered_objects(
    request: Request, rendered_assets: Sequence[RenderedAgentAsset]
) -> None:
    storage: MemeStorage = request.app.state.meme_storage
    for rendered in rendered_assets:
        try:
            await storage.delete(public_path_for_key(rendered.object_key))
        except (ValueError, StorageReadError, OSError, BotoCoreError, ClientError):
            # The durable cleanup worker cannot see a row that failed to persist.
            # Do not replace the original failure with a best-effort cleanup error.
            continue


async def _release_after_abort(
    credits: AgentGenerationCreditService,
    *,
    account_id: str,
    generation_id: str,
    outcome: GenerationStatus,
    failure_code: str,
) -> None:
    """Release a reservation without masking the request's primary failure."""

    try:
        await credits.settle_generation(
            account_id=account_id,
            generation_id=generation_id,
            outcome=outcome,
            failure_code=failure_code,
        )
    except Exception:
        return


def _failed_generation_code(failure_code: str | None) -> str:
    safe_codes = {
        "render_failure",
        "storage_failure",
        "asset_persistence_failure",
        "provider_timeout",
    }
    return failure_code if failure_code in safe_codes else "internal_failure"


def _error(status_code: int, code: str) -> JSONResponse:
    return JSONResponse(status_code=status_code, content={"error": {"code": code}})
