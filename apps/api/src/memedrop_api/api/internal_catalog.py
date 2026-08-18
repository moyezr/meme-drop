from __future__ import annotations

import asyncio
import logging
from pathlib import Path
from urllib.parse import urlparse
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, Request

from memedrop_api.catalog_schemas import (
    CatalogDraftCreate,
    CatalogDraftUpdate,
    CatalogStatus,
    CatalogVisualQACheck,
    slugify_template_id,
)
from memedrop_api.catalog_visual_qa import render_fingerprint, render_validation_issues
from memedrop_api.catalog_workbench import CatalogDraftConflict, CatalogDraftStore
from memedrop_api.config import Settings
from memedrop_api.services.catalog import MemeCatalog
from memedrop_api.services.storage import MemeStorage
from memedrop_api.services.thumbnails import THUMBNAIL_CONTENT_TYPE, make_thumbnail

LOGGER = logging.getLogger("memedrop.internal_catalog")
LOCAL_HOSTS = {"localhost", "127.0.0.1", "::1", "test"}
CATALOG_DEV_PORT = 5174


def require_local_catalog_request(request: Request) -> None:
    """Reject browser requests originating outside the local workbench."""

    client_host = request.client.host if request.client else None
    if client_host not in LOCAL_HOSTS:
        raise HTTPException(status_code=403, detail="Catalog workbench is local-only")
    origin = request.headers.get("origin")
    if not origin:
        return
    parsed = urlparse(origin)
    settings: Settings = request.app.state.settings
    if (
        parsed.scheme != "http"
        or parsed.hostname not in LOCAL_HOSTS
        or (parsed.port or 80) not in {settings.port, CATALOG_DEV_PORT}
    ):
        raise HTTPException(status_code=403, detail="Catalog workbench is local-only")


router = APIRouter(tags=["internal-catalog"], dependencies=[Depends(require_local_catalog_request)])


@router.post("/internal/api/catalog/visual-qa/check")
async def check_catalog_visual_qa(
    body: CatalogVisualQACheck,
) -> dict[str, object]:
    """Return the server-owned review fingerprint and deterministic render checks."""

    render_inputs = body.annotation.model_dump(mode="json")
    return {
        "fingerprint": render_fingerprint(render_inputs),
        "issues": render_validation_issues(render_inputs),
    }


@router.get("/internal/api/catalog/templates")
async def list_catalog_drafts(
    request: Request,
    status: CatalogStatus | None = None,
    search: str | None = Query(default=None, min_length=1, max_length=120),
) -> dict[str, object]:
    store: CatalogDraftStore = request.app.state.catalog_draft_store
    drafts = await store.list_drafts(status=status, search=search)
    return {"drafts": drafts, "total": len(drafts)}


@router.get("/internal/api/catalog/templates/{draft_id}")
async def get_catalog_draft(draft_id: UUID, request: Request) -> dict[str, object]:
    store: CatalogDraftStore = request.app.state.catalog_draft_store
    draft = await store.get_draft(draft_id)
    if draft is None:
        raise HTTPException(status_code=404, detail="Catalog draft not found")
    return {"draft": draft}


@router.post("/internal/api/catalog/templates", status_code=201)
async def create_catalog_draft(body: CatalogDraftCreate, request: Request) -> dict[str, object]:
    settings: Settings = request.app.state.settings
    catalog: MemeCatalog = request.app.state.meme_catalog
    store: CatalogDraftStore = request.app.state.catalog_draft_store
    storage: MemeStorage = request.app.state.meme_storage
    download = request.app.state.download_image
    template_id = body.template_id or body.base_template_id or slugify_template_id(body.name)
    base = next(
        (item for item in catalog.manifest.templates if item.template_id == body.base_template_id),
        None,
    )
    if body.base_template_id and base is None:
        raise HTTPException(status_code=400, detail="Base template was not found")

    downloaded_path: Path | None = None
    uploaded_paths: list[str] = []
    try:
        downloaded_path, filename = await download(str(body.source_image_url), settings)
        image_bytes = await asyncio.to_thread(downloaded_path.read_bytes)
        thumbnail = await asyncio.to_thread(make_thumbnail, image_bytes)
        suffix = Path(filename).suffix.lower() or ".jpg"
        object_prefix = f"catalog/drafts/{template_id}/{uuid4()}"
        asset_path = await storage.put_file(downloaded_path, f"{object_prefix}{suffix}")
        downloaded_path = None
        uploaded_paths.append(asset_path)
        thumbnail_path = await storage.put_bytes(
            f"{object_prefix}-thumbnail.webp",
            thumbnail,
            content_type=THUMBNAIL_CONTENT_TYPE,
        )
        uploaded_paths.append(thumbnail_path)
        annotation = initial_annotation(
            template_id=template_id,
            name=body.name,
            aliases=body.aliases,
            asset_path=asset_path,
            base=base.model_dump() if base else None,
        )
        draft = await store.create_draft(
            template_id=template_id,
            name=body.name,
            asset_path=asset_path,
            thumbnail_path=thumbnail_path,
            source_url=str(body.source_image_url),
            annotation=annotation,
        )
        return {"draft": draft}
    except CatalogDraftConflict as error:
        await rollback_uploads(storage, uploaded_paths)
        raise HTTPException(status_code=409, detail=str(error)) from error
    except HTTPException:
        await rollback_uploads(storage, uploaded_paths)
        raise
    except Exception as error:
        await rollback_uploads(storage, uploaded_paths)
        LOGGER.info("Catalog draft ingestion failed", exc_info=True)
        raise HTTPException(status_code=400, detail="Failed to ingest the source image") from error
    finally:
        if downloaded_path is not None:
            try:
                downloaded_path.unlink(missing_ok=True)
            except OSError:
                LOGGER.warning("Failed to remove catalog download", exc_info=True)


@router.put("/internal/api/catalog/templates/{draft_id}")
async def update_catalog_draft(
    draft_id: UUID, body: CatalogDraftUpdate, request: Request
) -> dict[str, object]:
    store: CatalogDraftStore = request.app.state.catalog_draft_store
    existing = await store.get_draft(draft_id)
    if existing is None:
        raise HTTPException(status_code=404, detail="Catalog draft not found")
    if body.annotation.template_id != existing["template_id"]:
        raise HTTPException(status_code=400, detail="template_id cannot be changed")
    if body.annotation.source_image != existing["asset_path"]:
        raise HTTPException(status_code=400, detail="source_image cannot be changed")
    try:
        draft = await store.update_draft(
            draft_id,
            expected_revision=body.revision,
            status=body.status,
            annotation=body.annotation.model_dump(mode="json"),
        )
    except CatalogDraftConflict as error:
        raise HTTPException(status_code=409, detail=str(error)) from error
    if draft is None:
        raise HTTPException(status_code=404, detail="Catalog draft not found")
    return {"draft": draft}


def initial_annotation(
    *,
    template_id: str,
    name: str,
    aliases: list[str],
    asset_path: str,
    base: dict[str, object] | None,
) -> dict[str, object]:
    annotation = dict(base or {})
    annotation.pop("meme_id", None)
    base_aliases = annotation.get("aliases")
    base_regions = annotation.get("regions")
    base_guidance = annotation.get("caption_guidance")
    base_retrieval = annotation.get("retrieval")
    annotation.update(
        {
            "template_id": template_id,
            "name": name,
            "aliases": aliases or (list(base_aliases) if isinstance(base_aliases, list) else []),
            "source_image": asset_path,
            "supports_overlay": bool(annotation.get("supports_overlay", True)),
            "quality": "draft",
            "regions": list(base_regions) if isinstance(base_regions, list) else [],
            "caption_guidance": (
                dict(base_guidance)
                if isinstance(base_guidance, dict)
                else {"pattern": "", "good_examples": [], "bad_examples": []}
            ),
            "retrieval": (
                dict(base_retrieval)
                if isinstance(base_retrieval, dict)
                else {
                    "version": 1,
                    "joke_shapes": [],
                    "positive_hints": [],
                    "anti_hints": [],
                }
            ),
            "editorial": {
                "description": "",
                "canonical_meaning": "",
                "use_cases": [],
                "anti_use_cases": [],
                "tone_tags": [],
                "trend_notes": [],
                "freshness": "unknown",
            },
            "safety": {"sensitive_topics": [], "brand_risks": []},
            "machine_provenance": None,
            "visual_qa": None,
        }
    )
    return annotation


async def rollback_uploads(storage: MemeStorage, paths: list[str]) -> None:
    for path in reversed(paths):
        try:
            await storage.delete(path)
        except Exception:
            LOGGER.warning("Failed to roll back catalog upload", extra={"path": path})
