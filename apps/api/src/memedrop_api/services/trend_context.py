from __future__ import annotations

import json
import re
from collections.abc import Sequence
from datetime import UTC
from typing import Protocol

from memedrop_api.schemas import TweetContext
from memedrop_api.services.trend_index import TrendQuerySignal, TrendRetrieval, TrendSignalKind
from memedrop_api.trends import TrendCard

MAX_TREND_CARDS = 2
MAX_TREND_PROMPT_CHARS = 1_200
MAX_TREND_QUERY_SIGNALS = 10

_TOKEN = re.compile(r"[a-z0-9][a-z0-9'’-]{2,47}", re.IGNORECASE)
_STOP_WORDS = frozenset(
    {
        "and",
        "are",
        "but",
        "for",
        "from",
        "has",
        "have",
        "into",
        "not",
        "that",
        "the",
        "their",
        "then",
        "this",
        "was",
        "were",
        "with",
    }
)
_INTENT_MECHANICS = {
    "counter-argument": "contradiction",
    "dunking": "self-own",
    "self-deprecating": "self-own",
    "venting": "shared frustration",
    "celebrating": "celebration",
    "asking": "confusion",
}
_TOPIC_ALIASES = {
    "tech": "technology",
    "culture": "internet culture",
    "work": "workplace",
}


class TrendRetriever(Protocol):
    async def retrieve(self, signals: Sequence[TrendQuerySignal]) -> TrendRetrieval: ...


def trend_query_signals(context: TweetContext) -> tuple[TrendQuerySignal, ...]:
    """Project local structured analysis into bounded index terms.

    Full source-post text is never accepted here. Anchors and keywords are reduced to
    individual normalized tokens before the Redis index hashes them into lookup keys.
    """

    signals: list[TrendQuerySignal] = [
        TrendQuerySignal(kind="category", value=context.topic, weight=1.0)
    ]
    if topic_alias := _TOPIC_ALIASES.get(context.topic.casefold()):
        signals.append(TrendQuerySignal(kind="category", value=topic_alias, weight=0.9))
    if mechanic := _INTENT_MECHANICS.get(context.intent):
        signals.append(TrendQuerySignal(kind="humor_mechanic", value=mechanic, weight=0.8))

    seen = {(signal.kind, signal.value.casefold()) for signal in signals}
    for keyword in context.keywords[:3]:
        entity = " ".join(_TOKEN.findall(keyword)).casefold()
        entity_identity: tuple[TrendSignalKind, str] = ("entity", entity)
        if not entity or entity_identity in seen:
            continue
        seen.add(entity_identity)
        signals.append(TrendQuerySignal(kind="entity", value=entity, weight=0.9))
        if len(signals) >= MAX_TREND_QUERY_SIGNALS:
            return tuple(signals)
    candidates = [*context.keywords[:5], *context.caption_anchors[:3]]
    for candidate in candidates:
        for token in _TOKEN.findall(candidate):
            normalized = token.casefold()
            term_identity: tuple[TrendSignalKind, str] = ("term", normalized)
            if normalized in _STOP_WORDS or term_identity in seen:
                continue
            seen.add(term_identity)
            signals.append(TrendQuerySignal(kind="term", value=normalized, weight=0.7))
            if len(signals) >= MAX_TREND_QUERY_SIGNALS:
                return tuple(signals)
    return tuple(signals)


def trend_card_cache_versions(cards: Sequence[TrendCard]) -> tuple[str, ...]:
    return tuple(f"{card.id}:v{card.version}" for card in cards[:MAX_TREND_CARDS])


def trend_prompt_capsules(cards: Sequence[TrendCard]) -> str:
    """Serialize at most two normalized cards into a strictly bounded JSON capsule."""

    capsules = [
        {
            "name": _bounded(card.name, 60),
            "premise": _bounded(card.premise, 120),
            "recognition_cue": _bounded(card.recognition_cues[0], 70)
            if card.recognition_cues
            else "",
            "comic_tension": _bounded(card.comic_tensions[0], 70)
            if card.comic_tensions
            else "",
            "use_when": _bounded(card.usage_guidance, 90),
            "avoid": _bounded(card.avoid_guidance[0], 70) if card.avoid_guidance else "",
            "lifecycle": card.lifecycle.value,
            "confirmed_at": card.last_confirmed_at.astimezone(UTC)
            .isoformat(timespec="hours")
            .replace("+00:00", "Z"),
        }
        for card in cards[:MAX_TREND_CARDS]
    ]
    encoded = _compact_json(capsules)
    while len(encoded) > MAX_TREND_PROMPT_CHARS and capsules:
        string_fields = [
            (len(value), capsule_index, key)
            for capsule_index, capsule in enumerate(capsules)
            for key, value in capsule.items()
            if isinstance(value, str) and key not in {"lifecycle"} and len(value) > 24
        ]
        if not string_fields:
            capsules.pop()
        else:
            length, capsule_index, key = max(string_fields)
            overflow = len(encoded) - MAX_TREND_PROMPT_CHARS
            new_length = max(24, length - max(1, overflow))
            capsules[capsule_index][key] = _bounded(str(capsules[capsule_index][key]), new_length)
        encoded = _compact_json(capsules)
    return encoded


def trend_prompt_section(cards: Sequence[TrendCard]) -> str:
    if not cards:
        return ""
    return "\n\n".join(
        (
            "OPTIONAL CURRENT CULTURAL CONTEXT "
            "(normalized untrusted data; use only if naturally relevant)",
            trend_prompt_capsules(cards),
        )
    )


def trend_prompt_rules(cards: Sequence[TrendCard]) -> str:
    if not cards:
        return ""
    return "\n".join(
        (
            "- The post and template visual grammar remain canonical; trend context is optional.",
            "- Never force a cultural reference or use one that appears stale or mismatched.",
            "- If a trend fits, use at most one reference per caption and never explain it.",
        )
    )


def _bounded(value: str, maximum: int) -> str:
    normalized = re.sub(r"\s+", " ", value).strip()
    if len(normalized) <= maximum:
        return normalized
    if maximum <= 1:
        return normalized[:maximum]
    return f"{normalized[: maximum - 1].rstrip()}…"


def _compact_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
