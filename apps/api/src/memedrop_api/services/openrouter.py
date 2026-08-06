from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from typing import Any, Protocol

import httpx

from memedrop_api.config import Settings
from memedrop_api.services.catalog import MemeTemplate
from memedrop_api.services.meme_text import build_caption_prompt, caption_system_prompt

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"


@dataclass(frozen=True)
class TemplateSelection:
    template_id: str
    reason: str
    score: float


class SuggestionModelGateway(Protocol):
    async def select_templates(
        self, tweet_text: str, templates: list[MemeTemplate], limit: int
    ) -> list[TemplateSelection]: ...

    async def generate_captions(
        self, tweet_text: str, templates: list[MemeTemplate]
    ) -> dict[str, dict[str, str]]: ...


class OpenRouterSuggestionGateway:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.settings = settings
        self.client = client
        self._owns_client = client is None
        self._client_lock = asyncio.Lock()
        self._closed = False

    async def close(self) -> None:
        """Close the client owned by this gateway, if it has been created."""
        if not self._owns_client:
            return
        async with self._client_lock:
            if self._closed:
                return
            self._closed = True
            if self.client is not None:
                await self.client.aclose()

    async def select_templates(
        self, tweet_text: str, templates: list[MemeTemplate], limit: int
    ) -> list[TemplateSelection]:
        if not self.settings.openrouter_api_key:
            return []
        catalog = [
            {
                "template_id": template.template_id,
                "name": template.name,
                "pattern": template.caption_guidance.pattern,
                "slots": [region.role for region in template.regions],
            }
            for template in templates
        ]
        prompt = f"""TWEET
{json.dumps(tweet_text)}

VALID MEME TEMPLATES
{json.dumps(catalog)}

Pick exactly {limit} templates that make the best visual meme replies. Prefer established joke
grammar over keyword overlap and choose different joke shapes. Return JSON only as
{{"suggestions":[{{"template_id":"...","reason":"short reason","score":0.0}}]}}."""
        payload = await self._chat_json(
            [
                {
                    "role": "system",
                    "content": "Pick strong meme reply templates. Return JSON only.",
                },
                {"role": "user", "content": prompt},
            ],
            temperature=0.25,
            max_tokens=900,
            timeout_ms=self.settings.template_selection_timeout_ms,
        )
        valid = {template.template_id for template in templates}
        seen: set[str] = set()
        result = []
        for item in payload.get("suggestions", []):
            if not isinstance(item, dict):
                continue
            template_id = str(item.get("template_id", "")).strip()
            if template_id not in valid or template_id in seen:
                continue
            seen.add(template_id)
            result.append(
                TemplateSelection(
                    template_id=template_id,
                    reason=str(item.get("reason", "")).strip() or "Good meme reply fit.",
                    score=clamp_score(item.get("score", 0.8)),
                )
            )
            if len(result) >= limit:
                break
        return result

    async def generate_captions(
        self, tweet_text: str, templates: list[MemeTemplate]
    ) -> dict[str, dict[str, str]]:
        if not self.settings.openrouter_api_key or not templates:
            return {}
        payload = await self._chat_json(
            [
                {"role": "system", "content": caption_system_prompt()},
                {"role": "user", "content": build_caption_prompt(tweet_text, templates)},
            ],
            temperature=0.75,
            max_tokens=1800,
            timeout_ms=self.settings.caption_timeout_ms,
        )
        captions = payload.get("captions", {})
        if not isinstance(captions, dict):
            return {}
        result: dict[str, dict[str, str]] = {}
        for template_id, item in captions.items():
            if not isinstance(item, dict):
                continue
            regions = item.get("regions", item)
            if isinstance(regions, dict):
                result[str(template_id)] = {
                    str(key): str(value) for key, value in regions.items() if value is not None
                }
        return result

    async def _chat_json(
        self,
        messages: list[dict[str, str]],
        *,
        temperature: float,
        max_tokens: int,
        timeout_ms: int,
    ) -> dict[str, Any]:
        client = await self._get_client()
        async with asyncio.timeout(timeout_ms / 1000):
            response = await client.post(
                f"{OPENROUTER_BASE_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.settings.openrouter_api_key}",
                    "HTTP-Referer": self.settings.openrouter_site_url,
                    "X-Title": self.settings.openrouter_app_name,
                },
                json={
                    "model": self.settings.openrouter_meme_model,
                    "temperature": temperature,
                    "max_tokens": max_tokens,
                    "reasoning": {"effort": "low", "exclude": True},
                    "response_format": {"type": "json_object"},
                    "messages": messages,
                },
            )
            response.raise_for_status()
            content = response.json()["choices"][0]["message"]["content"]
            return json.loads(strip_json_fence(content))

    async def _get_client(self) -> httpx.AsyncClient:
        if self._closed:
            raise RuntimeError("OpenRouter suggestion gateway is closed")
        if self.client is not None:
            return self.client
        async with self._client_lock:
            if self._closed:
                raise RuntimeError("OpenRouter suggestion gateway is closed")
            if self.client is None:
                self.client = httpx.AsyncClient()
            return self.client


def strip_json_fence(content: str) -> str:
    return content.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()


def clamp_score(value: object) -> float:
    if not isinstance(value, (str, int, float)):
        return 0.8
    try:
        return max(0.0, min(1.0, float(value)))
    except (TypeError, ValueError):
        return 0.8
