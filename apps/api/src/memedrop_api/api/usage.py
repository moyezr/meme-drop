from __future__ import annotations

from fastapi import APIRouter, Request

from memedrop_api.identity import InstallHeader, resolve_request_user_id
from memedrop_api.repositories import BackendStore
from memedrop_api.schemas import UsageRequest

router = APIRouter(prefix="/api/v1", tags=["usage"])


@router.post("/usage")
async def record_usage(
    body: UsageRequest,
    request: Request,
    install_id: InstallHeader = None,
) -> dict[str, bool]:
    user_id = await resolve_request_user_id(request, install_id)
    store: BackendStore = request.app.state.store
    await store.record_usage(
        user_id=user_id,
        meme_id=body.meme_id,
        action=body.action,
        tweet_context=body.tweet_context.model_dump(exclude_none=True),
        source=body.source,
    )
    return {"logged": True}
