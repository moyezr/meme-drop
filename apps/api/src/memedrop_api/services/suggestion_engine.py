from __future__ import annotations

import hashlib
import logging
import re
import time
from collections import OrderedDict
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from memedrop_api.config import Settings
from memedrop_api.repositories import BackendStore
from memedrop_api.services.catalog import MemeCatalog, MemeTemplate
from memedrop_api.services.context_analyzer import heuristic_tweet_context
from memedrop_api.services.meme_text import (
    build_fallback_caption_set,
    build_overlay,
    clean_generated_regions,
)
from memedrop_api.services.openrouter import SuggestionModelGateway, TemplateSelection

LOGGER = logging.getLogger("memedrop.suggestions")
SUGGESTION_CACHE_TTL_SECONDS = 5 * 60
SUGGESTION_CACHE_MAX = 200


@dataclass(frozen=True)
class Candidate:
    meme_id: str
    name: str
    image_url: str
    system_tags: dict[str, Any]
    is_evergreen: bool
    template: MemeTemplate
    feedback_boost: float = 0.0


class SuggestionService:
    def __init__(
        self,
        store: BackendStore,
        catalog: MemeCatalog,
        gateway: SuggestionModelGateway,
        settings: Settings,
    ) -> None:
        self.store = store
        self.catalog = catalog
        self.gateway = gateway
        self.settings = settings
        self.cache: OrderedDict[str, tuple[float, list[dict[str, Any]]]] = OrderedDict()

    async def get_suggestions(
        self,
        tweet_text: str,
        *,
        user_id: UUID,
        limit: int | None = None,
        refresh: bool = False,
        cache_key: str | None = None,
    ) -> list[dict[str, Any]]:
        normalized_limit = max(1, min(5, int(limit or 5)))
        normalized_key = cache_key or normalize_text(tweet_text)
        key = f"user:{user_id}|{normalized_key}|limit:{normalized_limit}|fastapi:v1"
        if not refresh and (cached := self._read_cache(key)) is not None:
            return cached
        started = time.perf_counter()
        context = heuristic_tweet_context(tweet_text)
        candidates = await self._load_candidates(user_id)
        if not candidates:
            return []
        fallback = fallback_template_selections(tweet_text, candidates, normalized_limit)
        try:
            model = await self.gateway.select_templates(
                tweet_text, [candidate.template for candidate in candidates], normalized_limit
            )
        except Exception:
            LOGGER.exception("Template selection failed; using local ranking")
            model = []
        selections = fill_selections(model, fallback, normalized_limit)
        by_template = {candidate.template.template_id: candidate for candidate in candidates}
        selected = [
            (by_template[selection.template_id], selection)
            for selection in selections
            if selection.template_id in by_template
        ]
        try:
            generated = await self.gateway.generate_captions(
                tweet_text, [candidate.template for candidate, _ in selected]
            )
        except Exception:
            LOGGER.exception("Caption generation failed; using contextual fallbacks")
            generated = {}
        result = []
        for index, (candidate, selection) in enumerate(selected):
            regions = clean_generated_regions(
                generated.get(candidate.template.template_id, {}), candidate.template
            )
            if not regions and self.settings.contextual_caption_fallback:
                regions = build_fallback_caption_set(tweet_text, context, candidate.template) or {}
            result.append(
                {
                    "meme_id": candidate.meme_id,
                    "name": candidate.name,
                    "image_url": candidate.image_url,
                    "tailored_overlay": build_overlay(candidate.template, candidate.name, regions),
                    "use_case_label": "meme reply",
                    "match_explanation": selection.reason
                    or candidate.template.caption_guidance.pattern,
                    "score": round(selection.score or 1 - index * 0.08, 3),
                    "source": "global",
                    "tweet_context": context.model_dump(),
                }
            )
        self._write_cache(key, result)
        LOGGER.info(
            "suggestions generated",
            extra={
                "cache_key": safe_log_cache_key(key),
                "templates": len(candidates),
                "returned": len(result),
                "duration_ms": round((time.perf_counter() - started) * 1000),
            },
        )
        return result

    async def get_tailored_overlay(self, tweet_text: str, meme_id: UUID) -> dict[str, Any] | None:
        row = await self.store.get_global_meme(meme_id)
        if row is None:
            return None
        template = self.catalog.find_template(
            str(row["name"]),
            meme_id=str(row["id"]),
            include_drafts=self.settings.use_draft_templates,
        )
        if template is None:
            return None
        context = heuristic_tweet_context(tweet_text)
        try:
            generated = await self.gateway.generate_captions(tweet_text, [template])
        except Exception:
            generated = {}
        regions = clean_generated_regions(generated.get(template.template_id, {}), template)
        if not regions and self.settings.contextual_caption_fallback:
            regions = build_fallback_caption_set(tweet_text, context, template) or {}
        return build_overlay(template, str(row["name"]), regions)

    async def _load_candidates(self, user_id: UUID) -> list[Candidate]:
        result = []
        seen: set[str] = set()
        feedback = await self.store.global_meme_feedback_scores(user_id)
        for row in await self.store.list_global_memes():
            template = self.catalog.find_template(
                str(row["name"]),
                meme_id=str(row["id"]),
                include_drafts=self.settings.use_draft_templates,
            )
            if template is None or template.template_id in seen:
                continue
            seen.add(template.template_id)
            result.append(
                Candidate(
                    meme_id=str(row["id"]),
                    name=str(row["name"]),
                    image_url=str(row["filePath"]),
                    system_tags=dict(row.get("systemTags") or {}),
                    is_evergreen=bool(row.get("isEvergreen", True)),
                    template=template,
                    feedback_boost=feedback.get(str(row["id"]), 0.0),
                )
            )
        return sorted(result, key=lambda candidate: candidate.template.name)

    def _read_cache(self, key: str) -> list[dict[str, Any]] | None:
        entry = self.cache.get(key)
        if entry is None:
            return None
        expires_at, value = entry
        if expires_at <= time.monotonic():
            self.cache.pop(key, None)
            return None
        self.cache.move_to_end(key)
        return value

    def _write_cache(self, key: str, value: list[dict[str, Any]]) -> None:
        self.cache[key] = (time.monotonic() + SUGGESTION_CACHE_TTL_SECONDS, value)
        self.cache.move_to_end(key)
        while len(self.cache) > SUGGESTION_CACHE_MAX:
            self.cache.popitem(last=False)


def fallback_template_selections(
    tweet_text: str, candidates: list[Candidate], limit: int
) -> list[TemplateSelection]:
    tweet_tokens = tokenize(tweet_text)
    signals = semantic_template_signals(tweet_text)
    scored = []
    for index, candidate in enumerate(candidates):
        searchable = " ".join(
            [
                candidate.template.name,
                *candidate.template.aliases,
                candidate.template.caption_guidance.pattern,
                *(
                    value
                    for example in candidate.template.caption_guidance.good_examples
                    for value in example.values()
                ),
                str(candidate.system_tags.get("emotion", "")),
                *candidate.system_tags.get("use_cases", []),
                *candidate.system_tags.get("vibes", []),
                *candidate.system_tags.get("example_contexts", []),
            ]
        )
        hits = len(tweet_tokens & tokenize(searchable))
        signal_boost = signals.get(candidate.template.template_id, 0)
        score = min(
            1.0,
            0.45
            + hits * 0.06
            + signal_boost
            + candidate.feedback_boost
            + (0.04 if candidate.is_evergreen else 0)
            + max(0, 0.05 - index * 0.001),
        )
        scored.append((score, candidate))
    scored.sort(key=lambda item: (-item[0], item[1].template.name))
    return [
        TemplateSelection(
            template_id=candidate.template.template_id,
            reason=candidate.template.caption_guidance.pattern,
            score=score,
        )
        for score, candidate in scored[:limit]
    ]


def semantic_template_signals(tweet_text: str) -> dict[str, float]:
    text = tweet_text.lower()
    signals: dict[str, float] = {}

    def boost(value: float, *template_ids: str) -> None:
        for template_id in template_ids:
            signals[template_id] = signals.get(template_id, 0) + value

    if re.search(r"down|fire|broken|outage|dashboard.*red|chaos", text):
        boost(0.35, "this-is-fine", "panik-kalm-panik", "disaster-girl")
    if re.search(r"skipp?ed tests|who could have predicted|somehow.*explod", text):
        boost(0.4, "surprised-pikachu", "roll-safe-think-about-it")
    if re.search(r"can'?t .* if|bad logic|apparently innovation", text):
        boost(0.42, "roll-safe-think-about-it", "expanding-brain")
    if re.search(r"rather .* than|choose|choice|agree on", text):
        boost(0.36, "two-buttons", "uno-draw-25-cards", "two-paths")
    if re.search(r"same|just .* with|renamed .* to", text):
        boost(0.4, "they-re-the-same-picture", "is-this-a-pigeon")
    if re.search(r"you get .* you get|every.*button|three .*buttons", text):
        boost(0.45, "oprah-you-get-a", "yo-dawg-heard-you")
    if re.search(r"every time|immediately says|predictable take", text):
        boost(0.4, "say-the-line-bart", "change-my-mind")
    if re.search(r"waiting|still waiting|how long", text):
        boost(0.45, "waiting-skeleton")
    if re.search(r"arguing|both sides|pointing", text):
        boost(0.4, "spider-man-triple", "woman-yelling-at-cat")
    if re.search(r"says|claim|fully autonomous|suspicious", text):
        boost(0.32, "futurama-fry", "is-this-a-pigeon")
    return signals


def fill_selections(
    primary: list[TemplateSelection], fallback: list[TemplateSelection], limit: int
) -> list[TemplateSelection]:
    result = []
    seen = set()
    for item in [*primary, *fallback]:
        if item.template_id in seen:
            continue
        seen.add(item.template_id)
        result.append(item)
        if len(result) >= limit:
            break
    return result


def tokenize(value: str) -> set[str]:
    return {
        token for token in re.findall(r"[a-z0-9][a-z0-9_'’-]*", value.lower()) if len(token) > 2
    }


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def safe_log_cache_key(value: str) -> str:
    return f"sha256:{hashlib.sha256(value.encode()).hexdigest()[:16]}"


def safe_log_tweet_text(value: str, mode: str) -> str:
    if mode == "full":
        return re.sub(r"\s+", " ", value.strip())
    if mode == "preview":
        normalized = re.sub(r"\s+", " ", value.strip())
        return normalized if len(normalized) <= 180 else f"{normalized[:177]}..."
    return f"[redacted:{hashlib.sha256(value.encode()).hexdigest()[:12]}]"
