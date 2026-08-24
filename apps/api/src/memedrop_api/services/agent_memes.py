"""Bounded rendering for one already-reserved public-agent generation."""

from __future__ import annotations

import asyncio
import hashlib
import json
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from botocore.exceptions import BotoCoreError, ClientError  # type: ignore[import-untyped]

from memedrop_api.services.meme_renderer import MemeRenderError, RenderedMeme
from memedrop_api.services.storage import MemeStorage, StorageReadError
from memedrop_api.services.suggestion_engine import SuggestionService

MemeRenderer = Callable[[bytes, Mapping[str, Any]], RenderedMeme]


class AgentMemeGenerationFailure(RuntimeError):
    """An expected render or storage failure after a credit reservation."""

    def __init__(self, code: str) -> None:
        super().__init__(code)
        self.code = code


@dataclass(frozen=True, slots=True)
class RenderedAgentAsset:
    """Private render output; no source text or captions escape this boundary."""

    object_key: str
    content_type: str
    content_hash: str


@dataclass(frozen=True, slots=True)
class _RenderAttempt:
    asset: RenderedAgentAsset | None
    failure_code: str | None = None


class AgentMemeService:
    """Turn one agent input into generation-scoped image objects.

    Durable asset rows are created by the route's persistence layer after these
    bytes are stored. The object key includes the generation ID, so two
    independently billable requests can never overwrite one another.
    """

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
        generation_id: str,
        agent_account_id: str,
        user_id: UUID,
        direction: str | None,
        count: int,
    ) -> list[RenderedAgentAsset]:
        requested_count = max(1, min(5, count))
        run = await self.suggestions.get_suggestion_run(
            content,
            user_id=user_id,
            limit=requested_count,
            steering_instruction=direction,
        )
        bounded_suggestions = run.suggestions[:requested_count]
        stored_object_keys: list[str] = []
        tasks = [
            asyncio.create_task(
                self._render_suggestion(
                    suggestion,
                    generation_id=generation_id,
                    agent_account_id=agent_account_id,
                    ordinal=ordinal,
                    stored_object_keys=stored_object_keys,
                )
            )
            for ordinal, suggestion in enumerate(bounded_suggestions, start=1)
        ]
        try:
            attempts = await asyncio.gather(*tasks)
        except BaseException:
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await self._cleanup_object_keys(stored_object_keys)
            raise
        assets: list[RenderedAgentAsset] = []
        seen_keys: set[str] = set()
        failure_codes: set[str] = set()
        for attempt in attempts:
            if attempt.asset is not None and attempt.asset.object_key not in seen_keys:
                assets.append(attempt.asset)
                seen_keys.add(attempt.asset.object_key)
            if attempt.failure_code is not None:
                failure_codes.add(attempt.failure_code)
        if assets or not bounded_suggestions:
            return assets
        if failure_codes:
            raise AgentMemeGenerationFailure(sorted(failure_codes)[0])
        return []

    async def _render_suggestion(
        self,
        suggestion: object,
        *,
        generation_id: str,
        agent_account_id: str,
        ordinal: int,
        stored_object_keys: list[str],
    ) -> _RenderAttempt:
        if not isinstance(suggestion, Mapping):
            return _RenderAttempt(None)
        source_path = suggestion.get("image_url")
        overlay = suggestion.get("tailored_overlay")
        if not isinstance(source_path, str) or not source_path.startswith("/memes/"):
            return _RenderAttempt(None)
        if not isinstance(overlay, Mapping) or not _has_caption_regions(overlay):
            return _RenderAttempt(None)
        try:
            source = await self.storage.read_bytes(source_path)
        except (StorageReadError, OSError, BotoCoreError, ClientError):
            return _RenderAttempt(None, "storage_failure")
        try:
            rendered = await asyncio.to_thread(self.renderer, source.content, overlay)
        except MemeRenderError:
            return _RenderAttempt(None, "render_failure")
        identity = _render_identity(source_path, overlay)
        extension = _image_extension(rendered.content_type)
        object_key = (
            f"generated/agents/{agent_account_id}/{generation_id}/{ordinal}-{identity}.{extension}"
        )
        # Register the exact prospective key before awaiting storage. If a task
        # is cancelled after the provider accepted the write but before it
        # returns, the enclosing cleanup still removes this one object.
        stored_object_keys.append(object_key)
        try:
            await self.storage.put_bytes(
                object_key,
                rendered.content,
                content_type=rendered.content_type,
            )
        except (OSError, BotoCoreError, ClientError):
            await self._cleanup_object_keys((object_key,))
            return _RenderAttempt(None, "storage_failure")
        return _RenderAttempt(
            RenderedAgentAsset(
                object_key=object_key,
                content_type=rendered.content_type,
                content_hash=hashlib.sha256(rendered.content).hexdigest(),
            )
        )

    async def _cleanup_object_keys(self, object_keys: Sequence[str]) -> None:
        for object_key in dict.fromkeys(object_keys):
            try:
                await self.storage.delete(f"/memes/{object_key}")
            except (ValueError, StorageReadError, OSError, BotoCoreError, ClientError):
                continue


def _render_identity(source_path: str, overlay: Mapping[str, Any]) -> str:
    canonical_overlay = json.dumps(
        overlay,
        sort_keys=True,
        separators=(",", ":"),
        ensure_ascii=False,
    )
    digest = hashlib.sha256()
    digest.update(source_path.encode())
    digest.update(b"\0")
    digest.update(canonical_overlay.encode())
    return digest.hexdigest()


def _has_caption_regions(overlay: Mapping[str, Any]) -> bool:
    regions = overlay.get("regions")
    if not isinstance(regions, Sequence) or isinstance(regions, (str, bytes, bytearray)):
        return False
    return any(
        isinstance(region, Mapping)
        and isinstance(region.get("text"), str)
        and bool(region["text"].strip())
        for region in regions
    )


def _image_extension(content_type: str) -> str:
    if content_type == "image/png":
        return "png"
    return "webp"
