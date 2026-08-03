from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

from memedrop_api.identity import InstallHeader, resolve_request_user_id
from memedrop_api.schemas import CaptionRequest, SuggestRequest
from memedrop_api.services.suggestion_engine import SuggestionService

router = APIRouter(prefix="/api/v1", tags=["suggestions"])


@router.post("/suggest", response_model=None)
async def suggest(
    body: SuggestRequest,
    request: Request,
    install_id: InstallHeader = None,
) -> dict[str, object] | JSONResponse:
    user_id = await resolve_request_user_id(request, install_id)
    service: SuggestionService = request.app.state.suggestion_service
    try:
        suggestions = await service.get_suggestions(
            body.tweet_text,
            user_id=user_id,
            limit=body.limit,
            refresh=body.refresh,
            cache_key=body.cache_key,
        )
        return {"suggestions": suggestions}
    except Exception:
        return JSONResponse(
            status_code=500,
            content={"error": "Failed to generate suggestions", "suggestions": []},
        )


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
