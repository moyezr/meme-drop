from __future__ import annotations

import json
from pathlib import Path

import httpx

from memedrop_api.config import Settings
from memedrop_api.services.auto_tagger import auto_tag_meme, strip_json_fence


async def test_auto_tagger_returns_fallback_without_api_key(tmp_path: Path) -> None:
    image = tmp_path / "meme.png"
    image.write_bytes(b"image")
    settings = Settings(database_url="postgresql://localhost/test", openrouter_api_key="")

    result = await auto_tag_meme(image, settings)

    assert result.name == "Unnamed Meme"
    assert result.is_evergreen is False


async def test_auto_tagger_parses_structured_model_response(tmp_path: Path) -> None:
    image = tmp_path / "meme.png"
    image.write_bytes(b"image")
    settings = Settings(database_url="postgresql://localhost/test", openrouter_api_key="secret")
    tags = {
        "name": "This Is Fine",
        "emotion": "sarcastic",
        "format_type": "text_overlay",
        "use_cases": ["reaction", "cope"],
        "example_contexts": ["Production outage", "Calm during chaos"],
        "vibes": ["calm cope"],
        "is_evergreen": True,
    }
    requested_model = "vision/model-for-tags"
    settings = settings.model_copy(update={"openrouter_auto_tag_model": requested_model})
    captured: dict[str, object] = {}

    def respond(request: httpx.Request) -> httpx.Response:
        captured.update(json.loads(request.content))
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps(tags)}}]},
            request=request,
        )

    transport = httpx.MockTransport(respond)
    async with httpx.AsyncClient(transport=transport) as client:
        result = await auto_tag_meme(image, settings, client=client)

    assert result.name == "This Is Fine"
    assert result.vibes == ["calm cope"]
    assert captured["model"] == requested_model


async def test_auto_tagger_falls_back_on_invalid_response(tmp_path: Path) -> None:
    image = tmp_path / "meme.png"
    image.write_bytes(b"image")
    settings = Settings(database_url="postgresql://localhost/test", openrouter_api_key="secret")
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200, json={"choices": [{"message": {"content": "not-json"}}]}, request=request
        )
    )
    async with httpx.AsyncClient(transport=transport) as client:
        result = await auto_tag_meme(image, settings, client=client)

    assert result.name == "Unnamed Meme"


def test_strip_json_fence() -> None:
    assert strip_json_fence('```json\n{"name":"meme"}\n```') == '{"name":"meme"}'
