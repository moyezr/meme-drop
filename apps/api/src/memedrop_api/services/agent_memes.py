from __future__ import annotations

import asyncio
import hashlib
import json
import re
from collections.abc import Callable, Mapping, Sequence
from typing import Any
from uuid import UUID

from botocore.exceptions import BotoCoreError, ClientError  # type: ignore[import-untyped]

from memedrop_api.agent_meme_models import GeneratedMeme
from memedrop_api.services.meme_renderer import MemeRenderError, RenderedMeme
from memedrop_api.services.storage import MemeStorage, StorageReadError
from memedrop_api.services.suggestion_engine import SuggestionService

MemeRenderer = Callable[[bytes, Mapping[str, Any]], RenderedMeme]


class AgentMemeService:
    """Turn one agent input into bounded, ready-to-use meme images."""

    def __init__(
        self,
        suggestions: SuggestionService,
        storage: MemeStorage,
        renderer: MemeRenderer,
    ) -> None:
        self.suggestions = suggestions
        self.storage = storage
        self.renderer = renderer

    async def generate(
        self,
        content: str,
        *,
        user_id: UUID,
        direction: str | None,
        count: int,
    ) -> list[GeneratedMeme]:
        requested_count = max(1, min(5, count))
        run = await self.suggestions.get_suggestion_run(
            content,
            user_id=user_id,
            limit=requested_count,
            steering_instruction=direction,
        )

        bounded_suggestions = run.suggestions[:requested_count]
        rendered_suggestions = await asyncio.gather(
            *(self._render_suggestion(suggestion) for suggestion in bounded_suggestions)
        )
        memes: list[GeneratedMeme] = []
        seen: set[str] = set()
        for rendered in rendered_suggestions:
            if rendered is None or rendered.id in seen:
                continue
            memes.append(rendered)
            seen.add(rendered.id)
        return memes

    async def _render_suggestion(self, suggestion: object) -> GeneratedMeme | None:
        if not isinstance(suggestion, Mapping):
            return None
        source_path = suggestion.get("image_url")
        overlay = suggestion.get("tailored_overlay")
        if not isinstance(source_path, str) or not source_path.startswith("/memes/"):
            return None
        if not isinstance(overlay, Mapping):
            return None

        caption = _flatten_caption(overlay)
        if not caption:
            return None
        try:
            identity = _render_identity(source_path, overlay)
            source = await self.storage.read_bytes(source_path)
        except (StorageReadError, OSError, BotoCoreError, ClientError):
            return None

        try:
            rendered = await asyncio.to_thread(self.renderer, source.content, overlay)
        except MemeRenderError:
            return None

        try:
            extension = _image_extension(rendered.content_type)
            image_url = await self.storage.put_bytes(
                f"generated/agents/{identity}.{extension}",
                rendered.content,
                content_type=rendered.content_type,
            )
        except (OSError, BotoCoreError, ClientError):
            return None

        alt_text = overlay.get("alt_text")
        if not isinstance(alt_text, str) or not alt_text.strip():
            name = suggestion.get("name")
            alt_text = (
                f"{name} meme" if isinstance(name, str) and name.strip() else "Generated meme"
            )
        return GeneratedMeme(
            id=f"meme_{identity[:24]}",
            image_url=image_url,
            alt_text=re.sub(r"\s+", " ", alt_text).strip()[:500],
            caption=caption,
        )


def _render_identity(source_path: str, overlay: Mapping[str, Any]) -> str:
    canonical_overlay = json.dumps(
        overlay,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    digest = hashlib.sha256()
    digest.update(source_path.encode("utf-8"))
    digest.update(b"\0")
    digest.update(canonical_overlay.encode("utf-8"))
    return digest.hexdigest()


def _flatten_caption(overlay: Mapping[str, Any]) -> str:
    regions = overlay.get("regions")
    if not isinstance(regions, Sequence) or isinstance(regions, (str, bytes, bytearray)):
        return ""
    values: list[str] = []
    for region in regions:
        if not isinstance(region, Mapping):
            continue
        text = region.get("text")
        if isinstance(text, str) and (cleaned := re.sub(r"\s+", " ", text).strip()):
            values.append(cleaned)
    return " / ".join(values)


def _image_extension(content_type: str) -> str:
    if content_type == "image/png":
        return "png"
    return "webp"
