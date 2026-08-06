from __future__ import annotations

import time

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from memedrop_api.identity import InstallHeader, resolve_install_identity
from memedrop_api.schemas import CaptionRequest, SuggestRequest
from memedrop_api.services.suggestion_engine import SuggestionService

router = APIRouter(prefix="/api/v1", tags=["suggestions"])


@router.post("/suggest", response_model=None)
async def suggest(
    body: SuggestRequest,
    request: Request,
    install_id: InstallHeader = None,
) -> dict[str, object] | JSONResponse:
    # Suggestions are read-only. Avoid a database write/existence check on this hot path.
    user_id = resolve_install_identity(
        install_id=install_id,
        require_install_id=request.app.state.settings.require_install_id,
    )
    service: SuggestionService = request.app.state.suggestion_service
    started = time.perf_counter()
    try:
        run = await service.get_suggestion_run(
            body.tweet_text,
            user_id=user_id,
            limit=body.limit,
            refresh=body.refresh,
            cache_key=body.cache_key,
        )
        return JSONResponse(
            content={"suggestions": run.suggestions},
            headers={"Server-Timing": run.timing.server_timing_header(elapsed_ms(started))},
        )
    except Exception:
        return JSONResponse(
            status_code=500,
            content={"error": "Failed to generate suggestions", "suggestions": []},
        )


def elapsed_ms(started: float) -> float:
    return (time.perf_counter() - started) * 1000


@router.post("/suggest/caption", response_model=None)
async def caption(body: CaptionRequest, request: Request) -> dict[str, object] | JSONResponse:
    service: SuggestionService = request.app.state.suggestion_service
    try:
        overlay = await service.get_tailored_overlay(body.tweet_text, body.meme_id)
        return {"tailored_overlay": overlay}
    except Exception:
        return JSONResponse(
            status_code=500,
            content={"error": "Failed to generate caption", "tailored_overlay": None},
        )
