from __future__ import annotations

from collections.abc import AsyncIterator
from dataclasses import dataclass
from pathlib import Path
from uuid import UUID

import httpx
import pytest
from memedrop_api.app import create_app
from memedrop_api.config import Settings
from memedrop_api.schemas import AutoTagResult

from tests.fakes import FakeStore

INSTALL_ID = UUID("11111111-1111-4111-8111-111111111111")


@dataclass
class ApiHarness:
    client: httpx.AsyncClient
    store: FakeStore
    deleted_paths: list[str]


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(
        database_url="postgresql://test:test@127.0.0.1:5432/test",
        meme_storage_path=tmp_path / "memes",
        cors_origins_value="http://localhost:5173",
    )


@pytest.fixture
async def client(settings: Settings) -> AsyncIterator[httpx.AsyncClient]:
    app = create_app(settings, readiness_check=_ready)
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as test_client:
        yield test_client


@pytest.fixture
async def api_harness(settings: Settings, tmp_path: Path) -> AsyncIterator[ApiHarness]:
    store = FakeStore()
    deleted_paths: list[str] = []

    async def fake_download(image_url: str, configured: Settings) -> tuple[Path, str]:
        assert image_url.startswith("https://")
        path = configured.meme_storage_path / "downloaded.png"
        path.write_bytes(b"image")
        return path, path.name

    async def fake_tag(_: Path, __: Settings) -> AutoTagResult:
        return AutoTagResult(
            name="Saved Reaction",
            emotion="sarcastic",
            format_type="reaction_image",
            use_cases=["reaction", "dunking"],
            example_contexts=["A bad take", "An obvious self-own"],
            vibes=["smug dunk"],
            is_evergreen=True,
        )

    app = create_app(
        settings.model_copy(update={"require_install_id": True}),
        readiness_check=_ready,
        store=store,
        download_image_service=fake_download,
        auto_tag_service=fake_tag,
    )

    async def fake_delete(public_path: str, _: Path) -> bool:
        deleted_paths.append(public_path)
        return True

    app.state.delete_stored_image = fake_delete
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as test_client:
        yield ApiHarness(test_client, store, deleted_paths)


async def _ready() -> bool:
    return True
