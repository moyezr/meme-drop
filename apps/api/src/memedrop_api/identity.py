from __future__ import annotations

from typing import Annotated
from uuid import UUID

from fastapi import Depends, Header, HTTPException, Request

from memedrop_api.repositories import BackendStore

DEV_USER_ID = UUID("00000000-0000-0000-0000-000000000001")
INSTALL_ID_HEADER = "x-memedrop-install-id"

InstallHeader = Annotated[str | None, Header(alias=INSTALL_ID_HEADER)]


def resolve_install_identity(*, install_id: str | None, require_install_id: bool) -> UUID:
    """Resolve an install ID without reading or changing persistent state."""
    if install_id is None:
        if require_install_id:
            raise HTTPException(status_code=401, detail=f"{INSTALL_ID_HEADER} is required")
        return DEV_USER_ID
    return parse_install_id(install_id)


async def resolve_request_user_id(request: Request, install_id: InstallHeader = None) -> UUID:
    """Resolve an install identity and ensure its user record for write-capable routes."""
    user_id = resolve_install_identity(
        install_id=install_id,
        require_install_id=request.app.state.settings.require_install_id,
    )
    store: BackendStore = request.app.state.store
    await store.ensure_install_user(user_id)
    return user_id


async def require_install_user_id(install_id: InstallHeader = None) -> UUID:
    if install_id is None:
        raise HTTPException(status_code=401, detail=f"{INSTALL_ID_HEADER} is required")
    return parse_install_id(install_id)


def parse_install_id(value: str) -> UUID:
    try:
        return UUID(value)
    except ValueError as error:
        raise HTTPException(
            status_code=400, detail=f"{INSTALL_ID_HEADER} must be a UUID"
        ) from error


ResolvedUserId = Annotated[UUID, Depends(resolve_request_user_id)]
RequiredUserId = Annotated[UUID, Depends(require_install_user_id)]
