from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta
from uuid import UUID

from memedrop_api.schemas import TweetContext
from memedrop_api.services.catalog import MemeCatalog
from memedrop_api.services.meme_text import build_caption_prompt
from memedrop_api.services.openrouter import build_joint_suggestion_prompt
from memedrop_api.services.suggestion_engine import SuggestionTiming, suggestion_request_key
from memedrop_api.services.trend_context import (
    MAX_TREND_CARDS,
    MAX_TREND_PROMPT_CHARS,
    trend_prompt_capsules,
    trend_query_signals,
)
from memedrop_api.services.trend_index import RedisTrendIndex, TrendQuerySignal
from memedrop_api.trends import (
    TrendCard,
    TrendDuration,
    TrendLifecycle,
    trend_id_for_key,
)

NOW = datetime(2026, 8, 19, 12, tzinfo=UTC)
USER_ID = UUID("11111111-1111-4111-8111-111111111111")


def context() -> TweetContext:
    return TweetContext.model_validate(
        {
            "sentiment": "negative",
            "tone": "sarcastic",
            "topic": "tech",
            "intent": "dunking",
            "intensity": 0.8,
            "reply_style": "sharp dunk",
            "ideal_meme_vibe": "mocking disbelief",
            "joke_target": "launch",
            "social_dynamic": "mocking a predictable self-own",
            "humor_angle": "the predictable consequence is the joke",
            "core_claim": "The launch failed.",
            "implied_context": "This was predictable.",
            "comedic_tension": "confidence versus failure",
            "caption_anchors": [
                "Project Zephyr launch collapsed",
                "executive victory lap",
            ],
            "keywords": ["Zephyr", "launch", "rollback"],
        }
    )


def card(key: str, *, version: int = 1) -> TrendCard:
    return TrendCard(
        id=trend_id_for_key(key),
        key=key,
        name=f"{key.replace('-', ' ').title()} cultural reference",
        premise="A current cultural premise whose relevance depends on a natural match. " * 5,
        aliases=(),
        entities=("Project Zephyr",),
        topics=("technology",),
        communities=("developers",),
        recognition_cues=("A recognizable visual phrase circulating in current discussions. " * 3,),
        comic_tensions=("Public confidence collides with an immediately obvious failure. " * 3,),
        usage_guidance="Use only when the source post clearly shares this exact tension. " * 4,
        avoid_guidance=("Do not force the reference or use it after the moment has passed. " * 3,),
        lifecycle=TrendLifecycle.RISING,
        duration_class=TrendDuration.FAST,
        first_seen_at=NOW - timedelta(days=2),
        last_confirmed_at=NOW,
        expires_at=NOW + timedelta(days=4),
        confidence=0.84,
        momentum=0.8,
        vitality=0.78,
        source_count=3,
        observation_count=4,
        version=version,
    )


def test_structured_context_becomes_bounded_token_signals_without_raw_post_text() -> None:
    signals = trend_query_signals(context())

    assert len(signals) <= 10
    assert TrendQuerySignal(kind="category", value="tech", weight=1.0) in signals
    assert TrendQuerySignal(kind="category", value="technology", weight=0.9) in signals
    assert TrendQuerySignal(kind="humor_mechanic", value="self-own", weight=0.8) in signals
    assert TrendQuerySignal(kind="entity", value="zephyr", weight=0.9) in signals
    assert any(signal.value == "zephyr" for signal in signals)
    assert all("project zephyr launch collapsed" not in signal.value for signal in signals)


def test_trend_prompt_capsules_and_prompt_instructions_are_strictly_bounded() -> None:
    cards = (card("first-reference"), card("second-reference"), card("ignored-reference"))
    capsules = trend_prompt_capsules(cards)

    assert len(capsules) <= MAX_TREND_PROMPT_CHARS
    assert len(json.loads(capsules)) == MAX_TREND_CARDS
    template = MemeCatalog.load().verified_templates[0]
    caption_prompt = build_caption_prompt("The launch failed", [template], context(), cards)
    joint_prompt = build_joint_suggestion_prompt(
        "The launch failed", [template], 1, context=context(), trend_cards=cards
    )
    for prompt in (caption_prompt, joint_prompt):
        assert "OPTIONAL CURRENT CULTURAL CONTEXT" in prompt
        assert "normalized untrusted data" in prompt
        assert "post and template visual grammar remain canonical" in prompt
        assert "Never force a cultural reference" in prompt
        assert "ignored-reference" not in prompt


def test_no_trend_cards_leave_existing_prompt_shape_unchanged() -> None:
    template = MemeCatalog.load().verified_templates[0]
    implicit = build_caption_prompt("The launch failed", [template], context())
    explicit = build_caption_prompt("The launch failed", [template], context(), ())

    assert implicit == explicit
    assert "CULTURAL CONTEXT" not in implicit


def test_suggestion_cache_identity_is_private_complete_and_trend_versioned() -> None:
    values = {
        "tweet_text": "Secret Project Zephyr launch",
        "user_id": USER_ID,
        "limit": 2,
        "cache_key": "client-secret-key",
        "steering_instruction": "Use dry humor",
        "trend_version": "index-v1",
        "trend_card_versions": ("card-a:v1",),
    }
    baseline = suggestion_request_key(**values)

    assert baseline.startswith("suggestion:sha256:")
    assert len(baseline) == len("suggestion:sha256:") + 64
    for private_value in (
        values["tweet_text"],
        values["cache_key"],
        values["steering_instruction"],
        str(USER_ID),
    ):
        assert str(private_value) not in baseline
    for field, replacement in (
        ("tweet_text", "Different post"),
        ("user_id", UUID("22222222-2222-4222-8222-222222222222")),
        ("limit", 3),
        ("cache_key", "different-client-key"),
        ("steering_instruction", "Use absurd humor"),
        ("trend_version", "index-v2"),
        ("trend_card_versions", ("card-a:v2",)),
    ):
        changed = {**values, field: replacement}
        assert suggestion_request_key(**changed) != baseline


async def test_redis_failure_remains_fail_open_for_projected_signals() -> None:
    class FailingRedis:
        async def get(self, key: str) -> str | None:
            raise ConnectionError("redis unavailable")

    index = RedisTrendIndex("redis://unused", client=FailingRedis(), timeout_seconds=0.01)
    retrieval = await index.retrieve(trend_query_signals(context()))

    assert retrieval.version is None
    assert retrieval.cards == ()


def test_server_timing_exposes_trend_lookup_without_context_values() -> None:
    header = SuggestionTiming(trend_lookup_ms=12.34).server_timing_header(20)

    assert "trend-lookup;dur=12.3" in header
    assert "Zephyr" not in header
