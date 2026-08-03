from __future__ import annotations

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Request

from memedrop_api.identity import RequiredUserId
from memedrop_api.repositories import BackendStore

LOGGER = logging.getLogger("memedrop.account")
router = APIRouter(prefix="/api/v1", tags=["account"])


@router.get("/account/export")
async def export_account(
    request: Request,
    user_id: RequiredUserId,
) -> dict[str, object]:
    store: BackendStore = request.app.state.store
    library, usage = await store.export_account(user_id)
    return {
        "install_id": str(user_id),
        "exported_at": datetime.now(UTC).isoformat(),
        "library": library,
        "usage_events": usage,
    }


@router.delete("/account")
async def delete_account(
    request: Request,
    user_id: RequiredUserId,
) -> dict[str, object]:
    store: BackendStore = request.app.state.store
    saved_memes, deleted_memes, deleted_usage, deleted_user = await store.delete_account(user_id)
    deleted_files = 0
    for meme in saved_memes:
        try:
            deleted = await request.app.state.delete_stored_image(
                meme["filePath"], request.app.state.settings.meme_storage_path
            )
            deleted_files += int(deleted)
        except OSError:
            LOGGER.warning("Failed to delete stored meme", extra={"meme_id": meme["id"]})
    return {
        "deleted": True,
        "install_id": str(user_id),
        "deleted_library_items": deleted_memes,
        "deleted_usage_events": deleted_usage,
        "deleted_files": deleted_files,
        "deleted_account": deleted_user,
    }
