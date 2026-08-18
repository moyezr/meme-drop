from __future__ import annotations

import time
from io import BytesIO
from pathlib import Path
from typing import Any

import httpx
from PIL import Image

from memedrop_api.app import create_app
from memedrop_api.config import Settings
from memedrop_api.rate_limit import EXPENSIVE_ROUTES, MemoryRateLimitStore
from memedrop_api.services.meme_renderer import MemeRenderError, RenderedMeme
from memedrop_api.services.storage import LocalMemeStorage
from memedrop_api.services.suggestion_engine import SuggestionRun, SuggestionTiming


class FakeSuggestionService:
    def __init__(self, suggestions: list[dict[str, Any]]) -> None:
        self.suggestions = suggestions
        self.calls: list[dict[str, object]] = []

    async def get_suggestion_run(self, content: str, **kwargs: object) -> SuggestionRun:
        self.calls.append({"content": content, **kwargs})
        return SuggestionRun(self.suggestions, SuggestionTiming())


def suggestion(
    *,
    source_path: str = "/memes/catalog/template.png",
    first: str = "THE PLAN",
    second: str = "ANOTHER TIMEZONE BUG",
) -> dict[str, Any]:
    return {
        "meme_id": "template-id",
        "name": "Drake Hotline Bling",
        "image_url": source_path,
        "tailored_overlay": {
            "alt_text": "Personalized Drake Hotline Bling meme",
            "template_id": "drake-hotline-bling",
            "regions": [
                {"id": "top", "text": first},
                {"id": "bottom", "text": second},
            ],
        },
    }


async def test_generate_meme_has_a_one_field_default_contract(
    settings: Settings, tmp_path: Path
) -> None:
    service = FakeSuggestionService([suggestion()])
    storage = LocalMemeStorage(tmp_path / "agent-memes")
    await storage.put_bytes("catalog/template.png", b"source-image", content_type="image/png")
    render_calls: list[tuple[bytes, object]] = []

    def render(source: bytes, overlay: object) -> RenderedMeme:
        render_calls.append((source, overlay))
        return RenderedMeme(b"finished-image", "image/webp", 640, 480)

    app = create_app(
        settings,
        suggestion_service=service,  # type: ignore[arg-type]
        storage=storage,
        meme_renderer=render,  # type: ignore[arg-type]
        rate_limiter=MemoryRateLimitStore(),
    )
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        first = await client.post(
            "/api/v1/memes/generate",
            json={"input": "  We postponed the launch again.  "},
        )
        second = await client.post(
            "/api/v1/memes/generate",
            json={"input": "We postponed the launch again."},
        )

    assert first.status_code == 200
    assert first.json()["status"] == "ok"
    assert first.json()["memes"] == second.json()["memes"]
    generated = first.json()["memes"][0]
    assert generated["id"].startswith("meme_")
    assert generated["image_url"].startswith("/memes/generated/agents/")
    assert generated["image_url"].endswith(".webp")
    assert generated["caption"] == "THE PLAN / ANOTHER TIMEZONE BUG"
    assert generated["alt_text"] == "Personalized Drake Hotline Bling meme"
    assert service.calls[0]["content"] == "We postponed the launch again."
    assert service.calls[0]["limit"] == 1
    assert service.calls[0]["steering_instruction"] is None
    assert render_calls[0][0] == b"source-image"
    assert await storage.read_bytes(generated["image_url"])


async def test_generate_meme_passes_options_and_skips_failed_assets(
    settings: Settings, tmp_path: Path
) -> None:
    service = FakeSuggestionService(
        [
            suggestion(source_path="/memes/catalog/missing.png"),
            suggestion(source_path="/memes/catalog/working.png", first="SHIP", second="IT"),
            suggestion(source_path="/memes/catalog/not-requested.png"),
        ]
    )
    storage = LocalMemeStorage(tmp_path / "agent-memes")
    await storage.put_bytes("catalog/working.png", b"source-image")

    def render(source: bytes, overlay: object) -> RenderedMeme:
        return RenderedMeme(b"finished-image", "image/png", 320, 240)

    app = create_app(
        settings,
        suggestion_service=service,  # type: ignore[arg-type]
        storage=storage,
        meme_renderer=render,  # type: ignore[arg-type]
        rate_limiter=MemoryRateLimitStore(),
    )
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/memes/generate",
            json={
                "input": "Release day",
                "options": {"direction": "  dry and self-aware  ", "count": 2},
            },
        )

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    assert len(response.json()["memes"]) == 1
    assert response.json()["memes"][0]["caption"] == "SHIP / IT"
    assert response.json()["memes"][0]["image_url"].endswith(".png")
    assert service.calls == [
        {
            "content": "Release day",
            "user_id": service.calls[0]["user_id"],
            "limit": 2,
            "steering_instruction": "dry and self-aware",
        }
    ]


async def test_generate_meme_returns_no_fit_and_rejects_extra_fields(
    settings: Settings, tmp_path: Path
) -> None:
    service = FakeSuggestionService([])
    app = create_app(
        settings,
        suggestion_service=service,  # type: ignore[arg-type]
        storage=LocalMemeStorage(tmp_path / "agent-memes"),
        rate_limiter=MemoryRateLimitStore(),
    )
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        no_fit = await client.post("/api/v1/memes/generate", json={"input": "No match"})
        invalid = await client.post(
            "/api/v1/memes/generate",
            json={"input": "A post", "audience": "engineers"},
        )
        invalid_options = await client.post(
            "/api/v1/memes/generate",
            json={"input": "A post", "options": {"count": 6}},
        )

    assert no_fit.status_code == 200
    assert no_fit.json() == {"status": "no_fit", "memes": []}
    assert invalid.status_code == 400
    assert invalid.json()["details"][0]["path"] == "audience"
    assert invalid_options.status_code == 400
    assert invalid_options.json()["details"][0]["path"] == "options.count"
    assert "POST /api/v1/memes/generate" in EXPENSIVE_ROUTES


async def test_generate_meme_skips_known_render_errors_but_exposes_bugs(
    settings: Settings, tmp_path: Path
) -> None:
    service = FakeSuggestionService([suggestion()])
    storage = LocalMemeStorage(tmp_path / "agent-memes")
    await storage.put_bytes("catalog/template.png", b"source-image")

    def expected_failure(source: bytes, overlay: object) -> RenderedMeme:
        raise MemeRenderError("malformed image")

    known_failure_app = create_app(
        settings,
        suggestion_service=service,  # type: ignore[arg-type]
        storage=storage,
        meme_renderer=expected_failure,  # type: ignore[arg-type]
        rate_limiter=MemoryRateLimitStore(),
    )
    transport = httpx.ASGITransport(app=known_failure_app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        known_failure = await client.post(
            "/api/v1/memes/generate", json={"input": "Known bad media"}
        )

    def programming_error(source: bytes, overlay: object) -> RenderedMeme:
        raise RuntimeError("renderer bug")

    bug_app = create_app(
        settings,
        suggestion_service=service,  # type: ignore[arg-type]
        storage=storage,
        meme_renderer=programming_error,  # type: ignore[arg-type]
        rate_limiter=MemoryRateLimitStore(),
    )
    transport = httpx.ASGITransport(app=bug_app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        unexpected_failure = await client.post(
            "/api/v1/memes/generate", json={"input": "Unexpected renderer failure"}
        )

    assert known_failure.status_code == 200
    assert known_failure.json() == {"status": "no_fit", "memes": []}
    assert unexpected_failure.status_code == 500
    assert unexpected_failure.json()["error"] == "Internal Server Error"


async def test_generate_meme_renders_and_stores_a_finished_image(
    settings: Settings, tmp_path: Path
) -> None:
    overlay = {
        "alt_text": "A finished test meme",
        "template_id": "test-template",
        "regions": [
            {
                "id": "caption",
                "text": "A REAL RENDER",
                "text_transform": "uppercase",
                "x": 0.05,
                "y": 0.05,
                "width": 0.9,
                "height": 0.9,
                "align": "center",
                "valign": "middle",
                "max_lines": 2,
                "max_chars": 40,
                "padding_ratio": 0.05,
                "font": {
                    "min_size": 10,
                    "max_size": 32,
                    "fill_color": "#FFFFFF",
                    "stroke_color": "#000000",
                },
            }
        ],
    }
    service = FakeSuggestionService(
        [
            {
                "meme_id": "test-template",
                "name": "Test Template",
                "image_url": "/memes/catalog/source.png",
                "tailored_overlay": overlay,
            }
        ]
    )
    storage = LocalMemeStorage(tmp_path / "agent-memes")
    source_buffer = BytesIO()
    Image.new("RGB", (160, 120), "#305080").save(source_buffer, format="PNG")
    source_content = source_buffer.getvalue()
    await storage.put_bytes("catalog/source.png", source_content, content_type="image/png")

    app = create_app(
        settings,
        suggestion_service=service,  # type: ignore[arg-type]
        storage=storage,
        rate_limiter=MemoryRateLimitStore(),
    )
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/memes/generate", json={"input": "Render this for real"}
        )
        finished_response = await client.get(response.json()["memes"][0]["image_url"])

    assert response.status_code == 200
    assert response.json()["status"] == "ok"
    generated = response.json()["memes"][0]
    finished = await storage.read_bytes(generated["image_url"])
    assert finished.content_type == "image/webp"
    assert finished.content != source_content
    assert finished_response.status_code == 200
    assert finished_response.headers["content-type"] == "image/webp"
    with Image.open(BytesIO(finished_response.content)) as image:
        assert image.format == "WEBP"
        assert image.size == (160, 120)


async def test_generate_meme_preserves_rank_order_when_renders_finish_out_of_order(
    settings: Settings, tmp_path: Path
) -> None:
    service = FakeSuggestionService(
        [
            suggestion(source_path="/memes/catalog/slow.png", first="FIRST", second="SLOW"),
            suggestion(source_path="/memes/catalog/fast.png", first="SECOND", second="FAST"),
        ]
    )
    storage = LocalMemeStorage(tmp_path / "agent-memes")
    await storage.put_bytes("catalog/slow.png", b"slow")
    await storage.put_bytes("catalog/fast.png", b"fast")
    completion_order: list[str] = []

    def render(source: bytes, overlay: object) -> RenderedMeme:
        label = source.decode("ascii")
        if label == "slow":
            time.sleep(0.05)
        completion_order.append(label)
        return RenderedMeme(f"finished-{label}".encode(), "image/webp", 320, 240)

    app = create_app(
        settings,
        suggestion_service=service,  # type: ignore[arg-type]
        storage=storage,
        meme_renderer=render,  # type: ignore[arg-type]
        rate_limiter=MemoryRateLimitStore(),
    )
    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.post(
            "/api/v1/memes/generate",
            json={"input": "Render concurrently", "options": {"count": 2}},
        )

    assert response.status_code == 200
    assert completion_order == ["fast", "slow"]
    assert [meme["caption"] for meme in response.json()["memes"]] == [
        "FIRST / SLOW",
        "SECOND / FAST",
    ]
