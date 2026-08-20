from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import UTC, datetime
from io import BytesIO
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import httpx
import pytest
from PIL import Image

import memedrop_api.api.internal_catalog as internal_catalog
from memedrop_api.app import create_app
from memedrop_api.catalog_workbench import CatalogDraftConflict
from memedrop_api.config import Settings
from memedrop_api.rate_limit import MemoryRateLimitStore
from memedrop_api.services.storage import LocalMemeStorage


class FakeCatalogDraftStore:
    def __init__(self) -> None:
        self.drafts: list[dict[str, Any]] = []
        self.fail_create = False

    async def list_drafts(self, *, status: str | None, search: str | None) -> list[dict[str, Any]]:
        return [
            draft
            for draft in self.drafts
            if (not status or draft["status"] == status)
            and (
                not search
                or search.lower() in draft["name"].lower()
                or search.lower() in draft["template_id"].lower()
            )
        ]

    async def get_draft(self, draft_id: UUID) -> dict[str, Any] | None:
        return next((draft for draft in self.drafts if draft["id"] == str(draft_id)), None)

    async def create_draft(self, **values: Any) -> dict[str, Any]:
        if self.fail_create:
            raise CatalogDraftConflict("duplicate template")
        now = datetime.now(UTC).isoformat()
        draft = {
            "id": str(uuid4()),
            "status": "draft",
            "revision": 1,
            "created_at": now,
            "updated_at": now,
            **values,
        }
        self.drafts.append(draft)
        return draft

    async def update_draft(
        self,
        draft_id: UUID,
        *,
        expected_revision: int,
        status: str,
        annotation: Mapping[str, Any],
    ) -> dict[str, Any] | None:
        draft = await self.get_draft(draft_id)
        if draft is None:
            return None
        if draft["revision"] != expected_revision:
            raise CatalogDraftConflict("reload before saving")
        draft.update(
            name=annotation["name"],
            status=status,
            annotation=dict(annotation),
            revision=expected_revision + 1,
            updated_at=datetime.now(UTC).isoformat(),
        )
        return draft


def png_bytes() -> bytes:
    image = Image.new("RGB", (900, 600), color=(20, 30, 40))
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


async def make_harness(
    settings: Settings, tmp_path: Path
) -> tuple[httpx.AsyncClient, FakeCatalogDraftStore, Path]:
    store = FakeCatalogDraftStore()
    storage_root = tmp_path / "storage"

    async def download(_: str, configured: Settings) -> tuple[Path, str]:
        source = configured.image_download_path / "source.png"
        source.parent.mkdir(parents=True, exist_ok=True)
        source.write_bytes(png_bytes())
        return source, source.name

    app = create_app(
        settings,
        readiness_check=ready,
        catalog_draft_store=store,
        storage=LocalMemeStorage(storage_root),
        download_image_service=download,
    )
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    client = httpx.AsyncClient(transport=transport, base_url="http://test")
    return client, store, storage_root


async def ready() -> bool:
    return True


async def test_workbench_api_is_available_only_in_development(
    settings: Settings, tmp_path: Path
) -> None:
    client, _, _ = await make_harness(settings, tmp_path)
    async with client:
        response = await client.get("/internal/api/catalog/templates")
    assert response.status_code == 200
    assert response.json() == {"drafts": [], "total": 0}

    production = settings.model_copy(
        update={
            "node_env": "production",
            "openrouter_api_key": "a-secure-production-api-key",
            "cors_origins_value": "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
            "storage_backend": "s3",
            "s3_bucket_name": "meme-drop-prod",
            "s3_endpoint": "https://project.storage.supabase.co/storage/v1/s3",
            "s3_region": "ap-south-1",
            "s3_access_key_id": "access-key",
            "s3_secret_access_key": "secret-key",
            "rate_limit_store": "redis",
            "redis_url": "rediss://example.test:6379",
        }
    )
    app = create_app(
        production,
        readiness_check=ready,
        storage=LocalMemeStorage(tmp_path / "unused"),
        rate_limiter=MemoryRateLimitStore(),
    )
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as prod_client:
        response = await prod_client.get("/internal/api/catalog/templates")
    assert response.status_code == 404


async def test_workbench_rejects_non_local_browser_origins(
    settings: Settings, tmp_path: Path
) -> None:
    client, _, _ = await make_harness(settings, tmp_path)
    async with client:
        response = await client.get(
            "/internal/api/catalog/templates", headers={"origin": "https://x.com"}
        )
    assert response.status_code == 403
    assert response.json()["error"] == "Catalog workbench is local-only"


async def test_workbench_accepts_the_local_react_development_origin(
    settings: Settings, tmp_path: Path
) -> None:
    client, _, _ = await make_harness(settings, tmp_path)
    async with client:
        response = await client.get(
            "/internal/api/catalog/templates", headers={"origin": "http://localhost:5174"}
        )
    assert response.status_code == 200


def test_scale_review_plan_path_discovers_the_workspace_root(tmp_path: Path) -> None:
    workspace = tmp_path / "workspace"
    module_path = workspace / "apps" / "api" / "src" / "memedrop_api" / "api" / "module.py"
    workspace.mkdir()
    (workspace / "package.json").write_text("{}", encoding="utf-8")

    assert internal_catalog.resolve_scale_review_plan_path(module_path) == (
        workspace / ".memedrop" / "template-pipeline" / "review-plan.json"
    )


def test_scale_review_plan_path_uses_a_safe_packaged_fallback(tmp_path: Path) -> None:
    module_path = tmp_path / "app" / "src" / "memedrop_api" / "api" / "module.py"
    fallback_root = tmp_path / "app"

    assert internal_catalog.resolve_scale_review_plan_path(
        module_path, fallback_root=fallback_root
    ) == fallback_root / ".memedrop" / "template-pipeline" / "review-plan.json"


async def test_workbench_exposes_the_local_scale_review_plan(
    settings: Settings, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    plan_path = tmp_path / "review-plan.json"
    plan_path.write_text(
        json.dumps(
            {
                "version": 1,
                "generated_at": "2026-08-18T00:00:00Z",
                "summary": {"templates": 1},
                "queue": [
                    {
                        "template_id": "priority-template",
                        "priority": 1200,
                        "lane": "benchmark_family",
                        "mechanical_warnings": [],
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    monkeypatch.setattr(internal_catalog, "SCALE_REVIEW_PLAN_PATH", plan_path)
    client, _, _ = await make_harness(settings, tmp_path)
    async with client:
        response = await client.get("/internal/api/catalog/review-plan")

    assert response.status_code == 200
    assert response.json()["plan"]["queue"][0]["template_id"] == "priority-template"


async def test_workbench_tolerates_a_missing_scale_review_plan(
    settings: Settings, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        internal_catalog,
        "SCALE_REVIEW_PLAN_PATH",
        tmp_path / "missing-review-plan.json",
    )
    client, _, _ = await make_harness(settings, tmp_path)
    async with client:
        response = await client.get("/internal/api/catalog/review-plan")

    assert response.status_code == 200
    assert response.json() == {"plan": None}


async def test_create_draft_copies_media_and_can_clone_existing_annotations(
    settings: Settings, tmp_path: Path
) -> None:
    client, store, storage_root = await make_harness(settings, tmp_path)
    async with client:
        response = await client.post(
            "/internal/api/catalog/templates",
            json={
                "name": "Absolute Cinema Improved",
                "template_id": "absolute-cinema-improved",
                "base_template_id": "absolute-cinema",
                "aliases": ["Cinema improved"],
                "source_image_url": "https://images.example.test/cinema.png",
            },
        )
    assert response.status_code == 201
    draft = response.json()["draft"]
    assert draft["template_id"] == "absolute-cinema-improved"
    assert draft["annotation"]["quality"] == "draft"
    assert draft["annotation"]["regions"]
    assert draft["annotation"]["editorial"] == {
        "description": "",
        "canonical_meaning": "",
        "use_cases": [],
        "anti_use_cases": [],
        "tone_tags": [],
        "trend_notes": [],
        "freshness": "unknown",
    }
    assert draft["annotation"]["safety"] == {
        "sensitive_topics": [],
        "brand_risks": [],
    }
    assert draft["annotation"]["machine_provenance"] is None
    assert len(store.drafts) == 1
    assert (storage_root / draft["asset_path"].removeprefix("/memes/")).is_file()
    assert (storage_root / draft["thumbnail_path"].removeprefix("/memes/")).is_file()


async def test_update_uses_revision_guard_and_keeps_asset_identity(
    settings: Settings, tmp_path: Path
) -> None:
    client, _, _ = await make_harness(settings, tmp_path)
    async with client:
        created = (
            await client.post(
                "/internal/api/catalog/templates",
                json={
                    "name": "Workbench Draft",
                    "source_image_url": "https://images.example.test/draft.png",
                },
            )
        ).json()["draft"]
        annotation = created["annotation"]
        annotation["name"] = "Renamed Workbench Draft"
        saved = await client.put(
            f"/internal/api/catalog/templates/{created['id']}",
            json={"revision": 1, "status": "draft", "annotation": annotation},
        )
        conflict = await client.put(
            f"/internal/api/catalog/templates/{created['id']}",
            json={"revision": 1, "status": "draft", "annotation": annotation},
        )
        annotation["source_image"] = "/memes/catalog/drafts/replaced.png"
        replaced = await client.put(
            f"/internal/api/catalog/templates/{created['id']}",
            json={"revision": 2, "status": "draft", "annotation": annotation},
        )
    assert saved.status_code == 200
    assert saved.json()["draft"]["revision"] == 2
    assert conflict.status_code == 409
    assert replaced.status_code == 400
    assert replaced.json()["error"] == "source_image cannot be changed"


async def test_visual_qa_check_returns_a_server_owned_fingerprint_and_issues(
    settings: Settings, tmp_path: Path
) -> None:
    client, _, _ = await make_harness(settings, tmp_path)
    async with client:
        created = (
            await client.post(
                "/internal/api/catalog/templates",
                json={
                    "name": "Visual QA Draft",
                    "source_image_url": "https://images.example.test/visual-qa.png",
                },
            )
        ).json()["draft"]
        annotation = created["annotation"]
        response = await client.post(
            "/internal/api/catalog/visual-qa/check", json={"annotation": annotation}
        )
    assert response.status_code == 200
    payload = response.json()
    assert len(payload["fingerprint"]) == 64
    assert payload["issues"]
    assert payload["issues"][0]["code"] == "missing_regions"


async def test_api_rejects_approval_without_current_visual_qa(
    settings: Settings, tmp_path: Path
) -> None:
    client, _, _ = await make_harness(settings, tmp_path)
    async with client:
        created = (
            await client.post(
                "/internal/api/catalog/templates",
                json={
                    "name": "Approval Gate Draft",
                    "source_image_url": "https://images.example.test/approval-gate.png",
                },
            )
        ).json()["draft"]
        annotation = created["annotation"]
        annotation.update(
            {
                "regions": [
                    {
                        "id": "top_caption",
                        "role": "Setup",
                        "x": 0.05,
                        "y": 0.05,
                        "width": 0.9,
                        "height": 0.2,
                        "align": "center",
                        "valign": "middle",
                        "max_lines": 2,
                        "max_chars": 24,
                        "font": {
                            "family": "Impact",
                            "min_size": 18,
                            "max_size": 48,
                            "stroke_ratio": 0.1,
                        },
                    }
                ],
                "caption_guidance": {
                    "pattern": "Setup then reaction",
                    "good_examples": [{"top_caption": "Me shipping on Friday"}],
                    "bad_examples": [{"top_caption": "An unfunny explanation"}],
                },
                "retrieval": {
                    "version": 1,
                    "joke_shapes": ["reaction"],
                    "positive_hints": ["deadline"],
                    "anti_hints": ["formal"],
                },
                "editorial": {
                    "description": "A person reacts to a deadline.",
                    "use_cases": ["deadline reaction"],
                    "anti_use_cases": ["formal announcement"],
                },
            }
        )
        response = await client.put(
            f"/internal/api/catalog/templates/{created['id']}",
            json={"revision": 1, "status": "approved", "annotation": annotation},
        )
    assert response.status_code == 400
    assert "current visual QA" in response.text


async def test_failed_database_create_removes_uploaded_assets(
    settings: Settings, tmp_path: Path
) -> None:
    client, store, storage_root = await make_harness(settings, tmp_path)
    store.fail_create = True
    async with client:
        response = await client.post(
            "/internal/api/catalog/templates",
            json={
                "name": "Duplicate",
                "source_image_url": "https://images.example.test/duplicate.png",
            },
        )
    assert response.status_code == 409
    assert list(storage_root.rglob("*.*")) == []
