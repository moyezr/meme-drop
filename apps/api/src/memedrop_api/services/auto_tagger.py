from __future__ import annotations

import asyncio
import base64
import json
import mimetypes
from pathlib import Path

import httpx

from memedrop_api.config import Settings
from memedrop_api.schemas import AutoTagResult

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
VISION_MODEL = "qwen/qwen3.6-plus"
FALLBACK_TAGS = AutoTagResult(
    name="Unnamed Meme",
    emotion="confused",
    format_type="reaction_image",
    use_cases=["reaction", "relatability"],
    example_contexts=["Generic meme reaction", "Unclear situation"],
    vibes=["unknown vibe"],
    is_evergreen=False,
)


async def auto_tag_meme(
    image_path: Path,
    settings: Settings,
    *,
    client: httpx.AsyncClient | None = None,
) -> AutoTagResult:
    if not settings.openrouter_api_key:
        return FALLBACK_TAGS.model_copy(deep=True)
    image_bytes = await asyncio.to_thread(image_path.read_bytes)
    mime_type = mimetypes.guess_type(image_path.name)[0] or "image/jpeg"
    encoded = base64.b64encode(image_bytes).decode("ascii")
    payload = {
        "model": VISION_MODEL,
        "temperature": 0.3,
        "max_tokens": 900,
        "response_format": {"type": "json_object"},
        "messages": [
            {
                "role": "system",
                "content": "Tag meme images for a recommendation engine. Return JSON only.",
            },
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": f"data:{mime_type};base64,{encoded}"},
                    },
                    {"type": "text", "text": "Tag this meme image for use as a reply on X."},
                ],
            },
        ],
    }
    owns_client = client is None
    request_client = client or httpx.AsyncClient(timeout=20)
    try:
        response = await request_client.post(
            f"{OPENROUTER_BASE_URL}/chat/completions",
            headers={
                "Authorization": f"Bearer {settings.openrouter_api_key}",
                "HTTP-Referer": settings.openrouter_site_url,
                "X-Title": settings.openrouter_app_name,
            },
            json=payload,
        )
        response.raise_for_status()
        content = response.json()["choices"][0]["message"]["content"]
        return AutoTagResult.model_validate(json.loads(strip_json_fence(content)))
    except (httpx.HTTPError, KeyError, IndexError, ValueError, json.JSONDecodeError):
        return FALLBACK_TAGS.model_copy(deep=True)
    finally:
        if owns_client:
            await request_client.aclose()


def strip_json_fence(content: str) -> str:
    stripped = content.strip()
    if stripped.startswith("```"):
        stripped = stripped.split("\n", 1)[1] if "\n" in stripped else stripped[3:]
    if stripped.endswith("```"):
        stripped = stripped[:-3]
    return stripped.strip()
