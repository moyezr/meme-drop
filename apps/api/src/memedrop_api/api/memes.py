from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Query, Request

from memedrop_api.repositories import BackendStore

router = APIRouter(prefix="/api/v1", tags=["memes"])


@router.get("/memes/browse")
async def browse_memes(
    request: Request,
    format_type: Annotated[str | None, Query(alias="format", min_length=1, max_length=40)] = None,
    emotion: Annotated[str | None, Query(min_length=1, max_length=40)] = None,
    search: Annotated[str | None, Query(min_length=1, max_length=120)] = None,
) -> dict[str, object]:
    store: BackendStore = request.app.state.store
    memes = await store.browse_memes(
        format_type=format_type,
        emotion=emotion,
        search=search,
    )
    return {"memes": memes}
