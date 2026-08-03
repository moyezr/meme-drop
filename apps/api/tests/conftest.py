from __future__ import annotations

from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import pytest
from memedrop_api.app import create_app
from memedrop_api.config import Settings


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


async def _ready() -> bool:
    return True
