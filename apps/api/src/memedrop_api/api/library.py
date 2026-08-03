from __future__ import annotations

from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, Request

from memedrop_api.config import Settings
from memedrop_api.identity import InstallHeader, resolve_request_user_id
from memedrop_api.repositories import BackendStore
from memedrop_api.schemas import AutoTagResult, SaveMemeRequest, UpdateMemeRequest

DownloadService = Callable[[str, Settings], Awaitable[tuple[Path, str]]]
AutoTagService = Callable[[Path, Settings], Awaitable[AutoTagResult]]
LiteralSort = Literal["recent", "most_used", "alphabetical"]

router = APIRouter(prefix="/api/v1", tags=["library"])


@router.post("/library/save")
async def save_meme(
    body: SaveMemeRequest,
    request: Request,
    install_id: InstallHeader = None,
) -> dict[str, object]:
    user_id = await resolve_request_user_id(request, install_id)
    settings: Settings = request.app.state.settings
    download: DownloadService = request.app.state.download_image
    tag_image: AutoTagService = request.app.state.auto_tag_meme
    store: BackendStore = request.app.state.store
    try:
        file_path, file_name = await download(str(body.image_url), settings)
        tags = await tag_image(file_path, settings)
        meme = await store.create_user_meme(
            user_id=user_id,
            file_path=f"/memes/{file_name}",
            user_name=tags.name,
            system_tags={
                "emotion": tags.emotion,
                "use_cases": tags.use_cases,
                "example_contexts": tags.example_contexts,
                "vibes": tags.vibes,
            },
        )
        return {"meme": meme}
    except Exception as error:
        raise HTTPException(status_code=400, detail="Failed to save meme") from error


@router.get("/library")
async def list_library(
    request: Request,
    search: Annotated[str | None, Query(min_length=1, max_length=120)] = None,
    tag: Annotated[str | None, Query(min_length=1, max_length=80)] = None,
    emotion: Annotated[str | None, Query(min_length=1, max_length=40)] = None,
    sort: LiteralSort = "recent",
    install_id: InstallHeader = None,
) -> dict[str, object]:
    user_id = await resolve_request_user_id(request, install_id)
    store: BackendStore = request.app.state.store
    memes = await store.list_user_memes(
        user_id,
        search=search,
        tag=tag,
        emotion=emotion,
        sort=sort,
    )
    return {"memes": memes, "total": len(memes), "page": 1}


@router.put("/library/{meme_id}")
async def update_library_meme(
    meme_id: UUID,
    body: UpdateMemeRequest,
    request: Request,
    install_id: InstallHeader = None,
) -> dict[str, object]:
    user_id = await resolve_request_user_id(request, install_id)
    store: BackendStore = request.app.state.store
    meme = await store.update_user_meme(
        user_id,
        meme_id,
        user_name=body.user_name,
        user_tags=body.user_tags,
    )
    if meme is None:
        raise HTTPException(status_code=404, detail="Meme not found")
    return {"meme": meme}


@router.delete("/library/{meme_id}")
async def delete_library_meme(
    meme_id: UUID,
    request: Request,
    install_id: InstallHeader = None,
) -> dict[str, bool]:
    user_id = await resolve_request_user_id(request, install_id)
    store: BackendStore = request.app.state.store
    meme = await store.delete_user_meme(user_id, meme_id)
    if meme is None:
        raise HTTPException(status_code=404, detail="Meme not found")
    await request.app.state.delete_stored_image(
        meme["filePath"], request.app.state.settings.meme_storage_path
    )
    return {"deleted": True}
