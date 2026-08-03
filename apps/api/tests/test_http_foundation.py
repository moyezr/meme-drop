from __future__ import annotations

import re
from pathlib import Path

import httpx
from fastapi import Request

from memedrop_api.app import create_app
from memedrop_api.config import Settings


async def test_safe_request_id_is_preserved(client: httpx.AsyncClient) -> None:
    response = await client.get("/live", headers={"x-request-id": "release-check-123"})

    assert response.status_code == 200
    assert response.headers["x-request-id"] == "release-check-123"


async def test_unsafe_request_id_is_replaced(client: httpx.AsyncClient) -> None:
    response = await client.get("/live", headers={"x-request-id": "short"})

    assert response.status_code == 200
    assert re.fullmatch(r"[0-9a-f-]{36}", response.headers["x-request-id"])
    assert response.headers["x-request-id"] != "short"


async def test_not_found_includes_request_id(client: httpx.AsyncClient) -> None:
    response = await client.get("/missing", headers={"x-request-id": "missing-check-123"})

    assert response.status_code == 404
    assert response.json() == {"error": "Not Found", "request_id": "missing-check-123"}


async def test_unhandled_errors_are_redacted(settings: Settings) -> None:
    async def ready() -> bool:
        return True

    app = create_app(settings, readiness_check=ready)

    @app.get("/test/boom")
    async def boom(_: Request) -> None:
        raise RuntimeError("database password leaked in stack")

    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/test/boom", headers={"x-request-id": "boom-check-123"})

    assert response.status_code == 500
    assert response.headers["x-request-id"] == "boom-check-123"
    assert response.json() == {
        "error": "Internal Server Error",
        "request_id": "boom-check-123",
    }
    assert "database password" not in response.text


async def test_cors_preflight_allows_extension_headers(client: httpx.AsyncClient) -> None:
    response = await client.options(
        "/api/v1/usage",
        headers={
            "origin": "http://localhost:5173",
            "access-control-request-method": "POST",
            "access-control-request-headers": "content-type,x-request-id,x-memedrop-install-id",
        },
    )

    assert response.status_code == 200
    assert response.headers["access-control-allow-origin"] == "http://localhost:5173"
    allowed = response.headers["access-control-allow-headers"].lower()
    assert "x-request-id" in allowed
    assert "x-memedrop-install-id" in allowed


async def test_static_meme_serving(settings: Settings, tmp_path: Path) -> None:
    storage = tmp_path / "static-memes"
    (storage / "catalog").mkdir(parents=True)
    (storage / "catalog" / "test.txt").write_text("meme-bytes", encoding="utf-8")
    configured = settings.model_copy(update={"meme_storage_path": storage})

    async def ready() -> bool:
        return True

    app = create_app(configured, readiness_check=ready)
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get("/memes/catalog/test.txt")

    assert response.status_code == 200
    assert response.text == "meme-bytes"
