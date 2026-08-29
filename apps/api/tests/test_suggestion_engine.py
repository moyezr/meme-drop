from __future__ import annotations

import asyncio
import json
import logging
from pathlib import Path
from types import SimpleNamespace
from typing import Any
from uuid import UUID, uuid4

import memedrop_api.services.suggestion_engine as suggestion_engine
from memedrop_api.config import Settings
from memedrop_api.schemas import MAX_SOURCE_POST_LENGTH, TweetContext, UsageBatchRequest
from memedrop_api.services.catalog import MemeCatalog, normalize_template_name
from memedrop_api.services.openrouter import JointSuggestionResult, TemplateSelection
from memedrop_api.services.suggestion_engine import (
    Candidate,
    LexicalCandidateIndex,
    SuggestionService,
    candidate_joke_shape_boost,
    diversify_shortlist,
    fallback_template_selections,
    infer_humor_mechanics,
    inferred_joke_shape_boosts,
    safe_log_cache_key,
    semantic_template_signals,
    suggestion_request_key,
    tokenize_sequence,
)
from memedrop_api.services.trend_index import TrendQuerySignal, TrendRetrieval
from tests.conftest import INSTALL_ID, ApiHarness
from tests.fakes import FakeStore


class FakeGateway:
    def __init__(self) -> None:
        self.selections: list[TemplateSelection] = []
        self.captions: dict[str, dict[str, str]] = {}
        self.joint_calls = 0
        self.caption_calls = 0
        self.fail_joint = False
        self.joint_error: Exception | None = None
        self.seen_template_counts: list[int] = []
        self.seen_template_ids: list[list[str]] = []
        self.seen_contexts: list[TweetContext | None] = []
        self.seen_steering_instructions: list[str | None] = []
        self.seen_trend_cards: list[tuple[object, ...]] = []
        self.seen_caption_trend_cards: list[tuple[object, ...]] = []

    async def select_and_caption(  # type: ignore[no-untyped-def]
        self,
        tweet_text,
        templates,
        limit,
        *,
        context=None,
        steering_instruction=None,
        trend_cards=(),
    ):
        self.joint_calls += 1
        self.seen_template_counts.append(len(templates))
        self.seen_template_ids.append([template.template_id for template in templates])
        self.seen_contexts.append(context)
        self.seen_steering_instructions.append(steering_instruction)
        self.seen_trend_cards.append(tuple(trend_cards))
        if self.joint_error is not None:
            raise self.joint_error
        if self.fail_joint:
            raise RuntimeError("model unavailable")
        return JointSuggestionResult(self.selections[:limit], self.captions)

    async def generate_captions(  # type: ignore[no-untyped-def]
        self, tweet_text, templates, *, context=None, trend_cards=()
    ):
        self.caption_calls += 1
        self.seen_caption_trend_cards.append(tuple(trend_cards))
        return self.captions


class RotatingTrendRetriever:
    def __init__(self, retrievals: list[TrendRetrieval]) -> None:
        self.retrievals = retrievals
        self.calls: list[tuple[TrendQuerySignal, ...]] = []

    async def retrieve(self, signals):  # type: ignore[no-untyped-def]
        self.calls.append(tuple(signals))
        index = min(len(self.calls) - 1, len(self.retrievals) - 1)
        return self.retrievals[index]


def global_meme(name: str) -> dict[str, Any]:
    return {
        "id": str(uuid4()),
        "name": name,
        "filePath": f"/memes/{normalize_template_name(name).replace(' ', '-')}.png",
        "formatType": "text_overlay",
        "isEvergreen": True,
        "systemTags": {},
        "embedding": None,
        "sourceUrl": None,
        "createdAt": "2026-01-01T00:00:00+00:00",
    }


def service_with_templates(*template_ids: str) -> tuple[SuggestionService, FakeStore, FakeGateway]:
    catalog = MemeCatalog.load()
    selected_templates = [
        template for template in catalog.verified_templates if template.template_id in template_ids
    ]
    store = FakeStore()
    store.memes = [global_meme(template.name) for template in selected_templates]
    gateway = FakeGateway()
    service = SuggestionService(
        store,
        catalog,
        gateway,
        Settings(database_url="postgresql://localhost/test"),
    )
    return service, store, gateway


async def test_service_uses_one_joint_model_call_and_context() -> None:
    service, _, gateway = service_with_templates("this-is-fine", "surprised-pikachu")
    gateway.selections = [
        TemplateSelection("surprised-pikachu", "predictable result", 0.96),
        TemplateSelection("this-is-fine", "calm chaos", 0.9),
    ]
    gateway.captions = {
        "surprised-pikachu": {"top_reaction_caption": "Skipped tests + Friday deploy"},
        "this-is-fine": {
            "speech_bubble_text": "This is fine",
            "bottom_caption": "Friday deploy on vibes",
        },
    }

    result = await service.get_suggestions(
        "We skipped tests and deployed Friday. Who could have predicted this?",
        user_id=INSTALL_ID,
        limit=2,
    )

    assert [item["name"] for item in result] == ["Surprised Pikachu", "This Is Fine"]
    assert result[0]["score"] == 0.96
    assert result[0]["use_case_label"] == "predictable consequence"
    assert result[0]["feedback_context"]["intent"] == "dunking"
    assert result[0]["feedback_context"]["suggestion_mode"] == "automatic"
    assert gateway.seen_contexts[0] is not None
    assert gateway.seen_contexts[0].comedic_tension == (
        "what they expected vs the predictable consequence"
    )
    assert "tweet_context" not in result[0]
    assert set(result[0]["feedback_context"]).isdisjoint(
        {
            "core_claim",
            "implied_context",
            "comedic_tension",
            "caption_anchors",
            "joke_target",
            "keywords",
        }
    )
    assert result[0]["tailored_overlay"]["regions"][0]["text"] == ("Skipped tests + Friday deploy")
    assert result[1]["tailored_overlay"] is not None
    assert gateway.joint_calls == 1
    assert gateway.caption_calls == 0


async def test_service_uses_steering_for_retrieval_and_joint_generation() -> None:
    service, _, gateway = service_with_templates("distracted-boyfriend", "this-is-fine")
    gateway.selections = [TemplateSelection("distracted-boyfriend", "requested format", 0.9)]
    gateway.captions = {
        "distracted-boyfriend": {
            "girlfriend": "the stable plan",
            "boyfriend": "the team",
            "temptation": "the new framework",
        }
    }

    result = await service.get_suggestions(
        "The migration is going smoothly.",
        user_id=INSTALL_ID,
        limit=1,
        steering_instruction="Use the distracted boyfriend format.",
    )

    assert gateway.seen_steering_instructions == ["Use the distracted boyfriend format."]
    assert gateway.seen_contexts[0] is not None
    assert "distracted boyfriend" not in gateway.seen_contexts[0].core_claim.lower()
    assert result[0]["name"] == "Distracted Boyfriend"
    assert result[0]["feedback_context"]["suggestion_mode"] == "steered"


async def test_steering_changes_the_local_retrieval_query_without_changing_automatic_ranking() -> (
    None
):
    service, _, gateway = service_with_templates("change-my-mind", "this-is-fine")
    gateway.fail_joint = True

    await service.get_suggestions("A generic update.", user_id=INSTALL_ID, limit=1)
    await service.get_suggestions(
        "A generic update.",
        user_id=INSTALL_ID,
        limit=1,
        steering_instruction="this is fine",
    )

    assert gateway.seen_template_ids[0][0] == "change-my-mind"
    assert gateway.seen_template_ids[1][0] == "this-is-fine"


async def test_feedback_context_excludes_source_derived_terms_for_a_long_post() -> None:
    service, _, gateway = service_with_templates("this-is-fine")
    gateway.selections = [TemplateSelection("this-is-fine", "test selection", 0.9)]
    gateway.captions = {
        "this-is-fine": {
            "speech_bubble_text": "This is fine",
            "bottom_caption": "Ordinary words everywhere",
        }
    }
    raw_token = "ultravioletpineapple"
    tweet = f"{raw_token} " + "ordinary words " * 80
    assert len(tweet) > 280

    suggestion = (await service.get_suggestions(tweet, user_id=INSTALL_ID, limit=1))[0]
    feedback_context = suggestion["feedback_context"]
    parsed = UsageBatchRequest.model_validate(
        {
            "events": [
                {
                    "meme_id": suggestion["meme_id"],
                    "action": "shown",
                    "source": suggestion["source"],
                    "tweet_context": feedback_context,
                }
            ]
        }
    )

    assert parsed.events[0].tweet_context.model_dump(exclude_none=True) == feedback_context
    assert raw_token not in str(feedback_context).lower()
    assert set(feedback_context).isdisjoint({"joke_target", "keywords"})


async def test_service_preserves_a_legitimate_zero_selection_score() -> None:
    service, _, gateway = service_with_templates("this-is-fine")
    gateway.selections = [TemplateSelection("this-is-fine", "deliberately neutral", 0.0)]

    suggestion = (
        await service.get_suggestions("Everything is on fire", user_id=INSTALL_ID, limit=1)
    )[0]

    assert suggestion["score"] == 0.0


async def test_service_uses_catalog_thumbnail_for_preview_and_preserves_attachment() -> None:
    service, store, gateway = service_with_templates("this-is-fine")
    gateway.fail_joint = True
    meme = store.memes[0]
    meme["systemTags"] = {"thumbnail_path": "/memes/catalog/thumbnails/this-is-fine.webp"}

    thumbnail = (
        await service.get_suggestions("Everything is on fire", user_id=INSTALL_ID, limit=1)
    )[0]
    assert thumbnail["preview_image_url"] == "/memes/catalog/thumbnails/this-is-fine.webp"
    assert thumbnail["image_url"] == meme["filePath"]

    fallback_service, _, fallback_gateway = service_with_templates("this-is-fine")
    fallback_gateway.fail_joint = True
    fallback = (
        await fallback_service.get_suggestions("Everything is on fire", user_id=INSTALL_ID, limit=1)
    )[0]
    assert fallback["preview_image_url"] == fallback["image_url"]


async def test_service_bounds_joint_shortlist_and_returns_at_most_five() -> None:
    catalog = MemeCatalog.load()
    template_ids = [template.template_id for template in catalog.verified_templates]
    service, _, gateway = service_with_templates(*template_ids)
    gateway.selections = [
        TemplateSelection(template.template_id, "fit", 0.9)
        for template in catalog.verified_templates[:6]
    ]
    gateway.captions = {
        template.template_id: {
            region.id: f"beat {region_index + 1}"
            for region_index, region in enumerate(template.regions)
        }
        for template in catalog.verified_templates[:5]
    }

    result = await service.get_suggestions("A generic post", user_id=INSTALL_ID, limit=99)

    assert len(result) == 5
    assert gateway.joint_calls == 1
    assert gateway.seen_template_counts == [min(12, len(template_ids))]


async def test_service_respects_model_omissions_instead_of_filling_weak_results() -> None:
    service, _, gateway = service_with_templates(
        "this-is-fine", "oprah-you-get-a", "surprised-pikachu"
    )
    gateway.selections = [TemplateSelection("surprised-pikachu", "model pick", 0.96)]

    result = await service.get_suggestions(
        "Prod is down and the dashboard is red", user_id=INSTALL_ID, limit=3
    )

    assert result[0]["name"] == "Surprised Pikachu"
    assert len(result) == 1


async def test_reported_quantity_comparison_never_uses_repeated_again_fallback() -> None:
    service, _, gateway = service_with_templates(
        "one-does-not-simply",
        "buff-doge-vs-cheems",
        "laughing-leo",
        "megamind-peeking",
    )
    gateway.fail_joint = True

    result = await service.get_suggestions(
        "Google hired 33 students from IIT Patna 💀 Bro even TCS does not hire that many from clg",
        user_id=INSTALL_ID,
        limit=5,
    )

    assert [item["name"] for item in result] == ["Buff Doge vs Cheems"]
    overlay_text = [region["text"] for region in result[0]["tailored_overlay"]["regions"]]
    assert overlay_text == ["Google: 33 hires", "TCS sweating"]
    assert all("again" not in text.lower() for text in overlay_text)


async def test_service_cache_avoids_repeating_model_work_and_refresh_bypasses() -> None:
    service, _, gateway = service_with_templates("this-is-fine")

    first = await service.get_suggestions("Prod is down", user_id=INSTALL_ID)
    second = await service.get_suggestions("Prod is down", user_id=INSTALL_ID)
    refreshed = await service.get_suggestions("Prod is down", user_id=INSTALL_ID, refresh=True)

    assert first == second == refreshed
    assert gateway.joint_calls == 2
    assert gateway.caption_calls == 0


async def test_concurrent_identical_suggestions_share_one_model_call() -> None:
    service, _, gateway = service_with_templates("this-is-fine")
    original_select = gateway.select_and_caption
    model_started = asyncio.Event()
    allow_model = asyncio.Event()

    async def delayed_select(  # type: ignore[no-untyped-def]
        tweet_text,
        templates,
        limit,
        *,
        context=None,
        steering_instruction=None,
        trend_cards=(),
    ):
        model_started.set()
        await allow_model.wait()
        return await original_select(
            tweet_text,
            templates,
            limit,
            context=context,
            steering_instruction=steering_instruction,
            trend_cards=trend_cards,
        )

    gateway.select_and_caption = delayed_select  # type: ignore[method-assign]
    first = asyncio.create_task(service.get_suggestions("Prod is down", user_id=INSTALL_ID))
    await model_started.wait()
    second = asyncio.create_task(service.get_suggestions("Prod is down", user_id=INSTALL_ID))
    await asyncio.sleep(0)

    allow_model.set()
    first_result, second_result = await asyncio.gather(first, second)

    assert first_result == second_result
    assert gateway.joint_calls == 1


async def test_concurrent_refreshes_share_work_but_not_completed_cache() -> None:
    service, _, gateway = service_with_templates("this-is-fine")
    await service.get_suggestions("Prod is down", user_id=INSTALL_ID)
    original_select = gateway.select_and_caption
    model_started = asyncio.Event()
    allow_model = asyncio.Event()

    async def delayed_select(  # type: ignore[no-untyped-def]
        tweet_text,
        templates,
        limit,
        *,
        context=None,
        steering_instruction=None,
        trend_cards=(),
    ):
        model_started.set()
        await allow_model.wait()
        return await original_select(
            tweet_text,
            templates,
            limit,
            context=context,
            steering_instruction=steering_instruction,
            trend_cards=trend_cards,
        )

    gateway.select_and_caption = delayed_select  # type: ignore[method-assign]
    first = asyncio.create_task(
        service.get_suggestions("Prod is down", user_id=INSTALL_ID, refresh=True)
    )
    await model_started.wait()
    second = asyncio.create_task(
        service.get_suggestions("Prod is down", user_id=INSTALL_ID, refresh=True)
    )
    await asyncio.sleep(0)

    allow_model.set()
    await asyncio.gather(first, second)

    # One initial call warmed the cache; the two refreshes ran one new shared request.
    assert gateway.joint_calls == 2


async def test_singleflight_key_does_not_share_requests_across_users_or_tweet_text() -> None:
    service, _, gateway = service_with_templates("this-is-fine")
    original_select = gateway.select_and_caption
    model_started = asyncio.Event()
    allow_model = asyncio.Event()

    async def delayed_select(  # type: ignore[no-untyped-def]
        tweet_text,
        templates,
        limit,
        *,
        context=None,
        steering_instruction=None,
        trend_cards=(),
    ):
        model_started.set()
        await allow_model.wait()
        return await original_select(
            tweet_text,
            templates,
            limit,
            context=context,
            steering_instruction=steering_instruction,
            trend_cards=trend_cards,
        )

    gateway.select_and_caption = delayed_select  # type: ignore[method-assign]
    first = asyncio.create_task(
        service.get_suggestions("Prod is down", user_id=INSTALL_ID, cache_key="same-client-key")
    )
    await model_started.wait()
    second = asyncio.create_task(
        service.get_suggestions(
            "Different post entirely",
            user_id=uuid4(),
            cache_key="same-client-key",
        )
    )
    await asyncio.sleep(0)

    allow_model.set()
    await asyncio.gather(first, second)

    assert gateway.joint_calls == 2


async def test_service_loads_global_catalog_once_and_applies_feedback_per_user() -> None:
    service, store, gateway = service_with_templates("change-my-mind", "disaster-girl")
    gateway.captions = {
        "change-my-mind": {"sign": "Generic reactions are content"},
        "disaster-girl": {
            "top_caption": "A generic reaction",
            "bottom_caption": "Engagement acquired",
        },
    }
    preferred = next(row for row in store.memes if row["name"] == "Disaster Girl")
    another_user = uuid4()
    store.feedback_scores_by_user[INSTALL_ID] = {preferred["id"]: 0.12}

    first = await service.get_suggestions("A generic reaction", user_id=INSTALL_ID, limit=1)
    second = await service.get_suggestions("A generic reaction", user_id=another_user, limit=1)

    assert first[0]["name"] == "Disaster Girl"
    assert second[0]["name"] == "Change My Mind"
    assert store.list_global_memes_calls == 1
    assert store.feedback_score_calls == [INSTALL_ID, another_user]


async def test_warm_feedback_cache_avoids_a_second_store_call() -> None:
    service, store, gateway = service_with_templates("this-is-fine")
    gateway.fail_joint = True

    await service.get_suggestions("Prod is down", user_id=INSTALL_ID)
    await service.get_suggestions("The dashboard is red", user_id=INSTALL_ID)

    assert store.feedback_score_calls == [INSTALL_ID]


async def test_invalidating_feedback_reloads_only_the_feedback_signal() -> None:
    service, store, gateway = service_with_templates("this-is-fine")
    gateway.fail_joint = True

    await service.get_suggestions("Prod is down", user_id=INSTALL_ID)
    service.invalidate_feedback(INSTALL_ID)
    # A new request shape avoids the intentionally retained suggestion-result cache.
    await service.get_suggestions("The dashboard is red", user_id=INSTALL_ID)

    assert store.feedback_score_calls == [INSTALL_ID, INSTALL_ID]


async def test_feedback_invalidation_cannot_repopulate_cache_from_a_pre_write_read() -> None:
    service, store, _ = service_with_templates("this-is-fine")
    snapshot_taken = asyncio.Event()
    release_stale_read = asyncio.Event()
    stale_scores = {store.memes[0]["id"]: 0.04}
    fresh_scores = {store.memes[0]["id"]: 0.12}

    async def delayed_feedback(user_id: UUID) -> dict[str, float]:
        store.feedback_score_calls.append(user_id)
        snapshot = dict(stale_scores)
        snapshot_taken.set()
        await release_stale_read.wait()
        return snapshot

    store.global_meme_feedback_scores = delayed_feedback  # type: ignore[method-assign]
    stale_read = asyncio.create_task(service._load_feedback_scores(INSTALL_ID, refresh=False))
    await snapshot_taken.wait()
    service.invalidate_feedback(INSTALL_ID)
    release_stale_read.set()
    assert await stale_read == stale_scores
    assert INSTALL_ID not in service._feedback_scores
    assert INSTALL_ID not in service._feedback_cache_generation

    async def fresh_feedback(user_id: UUID) -> dict[str, float]:
        store.feedback_score_calls.append(user_id)
        return dict(fresh_scores)

    store.global_meme_feedback_scores = fresh_feedback  # type: ignore[method-assign]
    assert await service._load_feedback_scores(INSTALL_ID, refresh=False) == fresh_scores
    assert service._feedback_scores[INSTALL_ID][1] == fresh_scores
    assert store.feedback_score_calls == [INSTALL_ID, INSTALL_ID]
    assert INSTALL_ID not in service._feedback_cache_generation


async def test_feedback_cache_expires_and_refresh_bypasses_it() -> None:
    service, store, gateway = service_with_templates("this-is-fine")
    gateway.fail_joint = True

    await service.get_suggestions("Prod is down", user_id=INSTALL_ID)
    expires_at, scores = service._feedback_scores[INSTALL_ID]
    service._feedback_scores[INSTALL_ID] = (expires_at - 120, scores)
    await service.get_suggestions("The dashboard is red", user_id=INSTALL_ID)
    await service.get_suggestions("Everything is on fire", user_id=INSTALL_ID, refresh=True)

    assert store.feedback_score_calls == [INSTALL_ID, INSTALL_ID, INSTALL_ID]


async def test_feedback_cache_singleflight_isolated_by_user_and_bounded(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    service, store, gateway = service_with_templates("this-is-fine")
    gateway.fail_joint = True
    original_feedback = store.global_meme_feedback_scores
    feedback_started = asyncio.Event()
    allow_feedback = asyncio.Event()

    async def delayed_feedback(user_id: UUID) -> dict[str, float]:
        feedback_started.set()
        await allow_feedback.wait()
        return await original_feedback(user_id)

    store.global_meme_feedback_scores = delayed_feedback  # type: ignore[method-assign]
    first = asyncio.create_task(service._load_feedback_scores(INSTALL_ID, refresh=False))
    await feedback_started.wait()
    second = asyncio.create_task(service._load_feedback_scores(INSTALL_ID, refresh=False))
    other_user = uuid4()
    third = asyncio.create_task(service._load_feedback_scores(other_user, refresh=False))
    await asyncio.sleep(0)
    allow_feedback.set()
    await asyncio.gather(first, second, third)

    assert store.feedback_score_calls.count(INSTALL_ID) == 1
    assert store.feedback_score_calls.count(other_user) == 1

    monkeypatch.setattr(suggestion_engine, "FEEDBACK_SCORE_CACHE_MAX", 2)
    service._write_feedback_scores(uuid4(), {})
    assert len(service._feedback_scores) == 2


async def test_concurrent_cold_suggestions_share_one_global_catalog_load() -> None:
    service, store, _ = service_with_templates("this-is-fine")
    original_load = store.list_global_memes
    original_feedback = store.global_meme_feedback_scores
    load_started = asyncio.Event()
    feedback_started = asyncio.Event()
    allow_load = asyncio.Event()

    async def delayed_load() -> list[dict[str, Any]]:
        load_started.set()
        await allow_load.wait()
        return await original_load()

    async def delayed_feedback(user_id: UUID) -> dict[str, float]:
        feedback_started.set()
        return await original_feedback(user_id)

    store.list_global_memes = delayed_load  # type: ignore[method-assign]
    store.global_meme_feedback_scores = delayed_feedback  # type: ignore[method-assign]
    first = asyncio.create_task(service.get_suggestions("Prod is down", user_id=INSTALL_ID))
    await load_started.wait()
    await feedback_started.wait()
    second = asyncio.create_task(service.get_suggestions("Prod is down", user_id=uuid4()))
    await asyncio.sleep(0)
    allow_load.set()
    await asyncio.gather(first, second)

    assert store.list_global_memes_calls == 1


async def test_service_falls_back_when_joint_model_fails_without_a_second_provider_call() -> None:
    service, _, gateway = service_with_templates(
        "this-is-fine", "oprah-you-get-a", "surprised-pikachu"
    )
    gateway.fail_joint = True

    result = await service.get_suggestions(
        "Prod is down and the dashboard is red", user_id=INSTALL_ID, limit=1
    )

    assert result[0]["name"] == "This Is Fine"
    assert gateway.joint_calls == 1
    assert gateway.caption_calls == 0


async def test_service_treats_joint_timeout_as_expected_fallback_without_traceback(
    caplog,  # type: ignore[no-untyped-def]
) -> None:
    service, _, gateway = service_with_templates("this-is-fine", "surprised-pikachu")
    gateway.joint_error = TimeoutError()

    with caplog.at_level(logging.WARNING, logger="memedrop.suggestions"):
        result = await service.get_suggestions(
            "Prod is down and the dashboard is red",
            user_id=INSTALL_ID,
            limit=1,
        )

    timeout_record = next(
        record for record in caplog.records if "timed out after 4500ms" in record.message
    )
    assert timeout_record.exc_info is None
    assert result[0]["name"] == "This Is Fine"
    assert gateway.joint_calls == 1
    assert gateway.caption_calls == 0


async def test_local_ranking_uses_bounded_personal_feedback() -> None:
    service, store, gateway = service_with_templates("change-my-mind", "disaster-girl")
    gateway.captions = {
        "change-my-mind": {"sign": "Generic reactions are content"},
        "disaster-girl": {
            "top_caption": "A generic reaction",
            "bottom_caption": "Engagement acquired",
        },
    }
    preferred = next(row for row in store.memes if row["name"] == "Disaster Girl")
    store.feedback_scores[preferred["id"]] = 0.12

    result = await service.get_suggestions("A generic reaction", user_id=INSTALL_ID, limit=1)

    assert result[0]["name"] == "Disaster Girl"


async def test_caption_for_one_meme_and_missing_meme() -> None:
    service, store, gateway = service_with_templates("drake-hotline-bling")
    meme_id = UUID(store.memes[0]["id"])
    gateway.captions = {"drake-hotline-bling": {"reject": "tests", "approve": "deploying on vibes"}}

    overlay = await service.get_tailored_overlay("We deployed without tests", meme_id)
    missing = await service.get_tailored_overlay("tweet", uuid4())

    assert overlay is not None
    assert len(overlay["regions"]) == 2
    assert missing is None


async def test_suggestion_routes_validate_and_return_contract(api_harness: ApiHarness) -> None:
    api_harness.store.memes = [global_meme("This Is Fine")]

    invalid = await api_harness.client.post("/api/v1/suggest", json={})
    valid = await api_harness.client.post(
        "/api/v1/suggest",
        headers={"x-memedrop-install-id": str(INSTALL_ID)},
        json={"tweet_text": "Prod is down and everything is on fire", "limit": 1},
    )
    long_post = await api_harness.client.post(
        "/api/v1/suggest",
        headers={"x-memedrop-install-id": str(INSTALL_ID)},
        json={"tweet_text": "LinkedIn post content " * 100, "limit": 1},
    )
    oversized_post = await api_harness.client.post(
        "/api/v1/suggest",
        headers={"x-memedrop-install-id": str(INSTALL_ID)},
        json={"tweet_text": "x" * (MAX_SOURCE_POST_LENGTH + 1), "limit": 1},
    )

    assert invalid.status_code == 400
    assert invalid.json()["error"] == "Invalid request"
    assert valid.status_code == 200
    assert long_post.status_code == 200
    assert oversized_post.status_code == 400
    suggestion = valid.json()["suggestions"][0]
    assert suggestion["name"] == "This Is Fine"
    assert "tweet_context" not in suggestion
    assert suggestion["feedback_context"]
    assert suggestion["feedback_context"]["suggestion_mode"] == "automatic"
    feedback_context = suggestion["feedback_context"]
    assert set(feedback_context).isdisjoint(
        {
            "core_claim",
            "implied_context",
            "comedic_tension",
            "caption_anchors",
            "joke_target",
            "keywords",
        }
    )
    assert suggestion["source"] == "global"
    assert api_harness.store.ensured_users == []

    feedback = await api_harness.client.post(
        "/api/v1/usage/batch",
        headers={"x-memedrop-install-id": str(INSTALL_ID)},
        json={
            "events": [
                {
                    "meme_id": suggestion["meme_id"],
                    "action": "shown",
                    "source": suggestion["source"],
                    "tweet_context": feedback_context,
                }
            ]
        },
    )

    assert feedback.status_code == 200
    assert feedback.json() == {"logged": 1}


async def test_suggestion_route_rejects_blank_and_overlong_steering_instruction(
    api_harness: ApiHarness,
) -> None:
    request = {"tweet_text": "Prod is down", "steering_instruction": " "}
    headers = {"x-memedrop-install-id": str(INSTALL_ID)}
    blank = await api_harness.client.post("/api/v1/suggest", headers=headers, json=request)
    request["steering_instruction"] = "x" * 281
    overlong = await api_harness.client.post("/api/v1/suggest", headers=headers, json=request)

    assert blank.status_code == overlong.status_code == 400


async def test_suggestion_route_exposes_non_sensitive_server_timing(
    api_harness: ApiHarness,
) -> None:
    api_harness.store.memes = [global_meme("This Is Fine")]
    request = {
        "tweet_text": "Prod is down and everything is on fire",
        "limit": 1,
    }
    headers = {"x-memedrop-install-id": str(INSTALL_ID)}

    cold = await api_harness.client.post("/api/v1/suggest", headers=headers, json=request)
    warm = await api_harness.client.post("/api/v1/suggest", headers=headers, json=request)

    assert cold.status_code == warm.status_code == 200
    assert cold.json() == warm.json()
    timing = cold.headers["server-timing"]
    for metric in (
        "candidate-load;dur=",
        "local-rank;dur=",
        "joint-model;dur=",
        "response-assembly;dur=",
        "total;dur=",
    ):
        assert metric in timing
    assert "Prod is down" not in timing
    assert 'cache;desc="hit"' in warm.headers["server-timing"]


async def test_caption_route_returns_overlay_and_null_for_missing_meme(
    api_harness: ApiHarness,
) -> None:
    meme = global_meme("Drake Hotline Bling")
    api_harness.store.memes = [meme]
    gateway = FakeGateway()
    gateway.captions = {
        "drake-hotline-bling": {"reject": "skipping tests", "approve": "shipping safely"}
    }
    api_harness.app.state.suggestion_service.gateway = gateway

    response = await api_harness.client.post(
        "/api/v1/suggest/caption",
        json={"tweet_text": "Skipping tests versus shipping safely", "meme_id": meme["id"]},
    )
    missing = await api_harness.client.post(
        "/api/v1/suggest/caption",
        json={"tweet_text": "A tweet", "meme_id": str(uuid4())},
    )

    assert response.status_code == 200
    assert response.json()["tailored_overlay"]["template_id"] == "drake-hotline-bling"
    assert missing.status_code == 200
    assert missing.json() == {"tailored_overlay": None}


def test_safe_suggestion_logs_hash_cache_keys() -> None:
    assert safe_log_cache_key("tweet text").startswith("sha256:")
    assert "tweet text" not in safe_log_cache_key("tweet text")


def test_suggestion_cache_key_hashes_and_separates_steering_instruction() -> None:
    instruction = "Use the distracted boyfriend format"
    automatic = suggestion_request_key(
        "A migration update",
        user_id=INSTALL_ID,
        limit=1,
        cache_key=None,
    )
    steered = suggestion_request_key(
        "A migration update",
        user_id=INSTALL_ID,
        limit=1,
        cache_key=None,
        steering_instruction=instruction,
    )

    assert automatic != steered
    assert instruction not in steered


async def test_trends_are_retrieved_before_cache_and_versions_invalidate_results() -> None:
    service, _, gateway = service_with_templates("this-is-fine")
    gateway.selections = [TemplateSelection("this-is-fine", "current context", 0.91)]
    gateway.captions = {
        "this-is-fine": {
            "speech_bubble_text": "This is current",
            "bottom_caption": "Project Zephyr launch",
        }
    }
    trend_id = UUID("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")
    card_v1 = SimpleNamespace(id=trend_id, version=1)
    card_v2 = SimpleNamespace(id=trend_id, version=2)
    v1 = TrendRetrieval(version="index-v1", cards=(card_v1,))  # type: ignore[arg-type]
    v2 = TrendRetrieval(version="index-v2", cards=(card_v2,))  # type: ignore[arg-type]
    retriever = RotatingTrendRetriever([v1, v1, v2])
    service.trend_retriever = retriever  # type: ignore[assignment]

    post = "Secret Project Zephyr launch fell over after the victory lap"
    first = await service.get_suggestions(post, user_id=INSTALL_ID, limit=1)
    cached = await service.get_suggestions(post, user_id=INSTALL_ID, limit=1)
    refreshed_by_trend = await service.get_suggestions(post, user_id=INSTALL_ID, limit=1)

    assert first == cached == refreshed_by_trend
    assert len(retriever.calls) == 3
    assert gateway.joint_calls == 2
    assert gateway.seen_trend_cards == [(card_v1,), (card_v2,)]
    assert all(
        "secret project zephyr launch" not in signal.value for signal in retriever.calls[0]
    )


async def test_standalone_caption_generation_receives_trend_cards() -> None:
    service, store, gateway = service_with_templates("this-is-fine")
    meme = global_meme("This Is Fine")
    store.memes = [meme]
    gateway.captions = {
        "this-is-fine": {
            "speech_bubble_text": "Still current",
            "bottom_caption": "The trend matched",
        }
    }
    card = SimpleNamespace(
        id=UUID("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"),
        version=1,
    )
    retrieval = TrendRetrieval(version="index-v1", cards=(card,))  # type: ignore[arg-type]
    service.trend_retriever = RotatingTrendRetriever([retrieval])  # type: ignore[assignment]

    overlay = await service.get_tailored_overlay("A current launch joke", UUID(meme["id"]))

    assert overlay is not None
    assert gateway.seen_caption_trend_cards == [(card,)]


def test_local_ranker_meets_benchmark_retrieval_gates() -> None:
    benchmark_path = (
        Path(__file__).resolve().parents[3]
        / "tools"
        / "template-tools"
        / "evals"
        / "suggestion-benchmark.json"
    )
    cases = json.loads(benchmark_path.read_text(encoding="utf-8"))["cases"]
    catalog = MemeCatalog.load()
    candidates = [
        Candidate(
            meme_id=template.template_id,
            name=template.name,
            image_url="/memes/test.png",
            system_tags={},
            is_evergreen=True,
            template=template,
        )
        for template in {item.template_id: item for item in catalog.verified_templates}.values()
    ]
    top3 = 0
    top5 = 0
    for case in cases:
        selections = fallback_template_selections(case["tweet"], candidates, 5)
        names = [
            normalize_template_name(
                next(
                    item.name
                    for item in candidates
                    if item.template.template_id == selection.template_id
                )
            )
            for selection in selections
        ]
        expected = [normalize_template_name(name) for name in case.get("expected_memes", [])]
        best = next(
            (
                index
                for index, name in enumerate(names)
                if any(name in family or family in name for family in expected)
            ),
            None,
        )
        top3 += int(best is not None and best < 3)
        top5 += int(best is not None and best < 5)

    assert top3 / len(cases) >= 0.55
    assert top5 / len(cases) >= 0.75


def test_local_ranker_uses_bm25_signal_instead_of_catalog_position() -> None:
    catalog = MemeCatalog.load()
    first, second = [
        next(
            template
            for template in catalog.verified_templates
            if template.template_id == template_id
        )
        for template_id in ("change-my-mind", "this-is-fine")
    ]
    candidates = [
        Candidate(
            meme_id=first.template_id,
            name=first.name,
            image_url="/memes/first.png",
            system_tags={},
            is_evergreen=True,
            template=first,
        ),
        Candidate(
            meme_id=second.template_id,
            name=second.name,
            image_url="/memes/second.png",
            system_tags={"example_contexts": ["neonflux telemetry"]},
            is_evergreen=True,
            template=second,
        ),
    ]

    lexical_index = LexicalCandidateIndex.build(candidates)
    selections = fallback_template_selections(
        "The neonflux telemetry is acting strange", candidates, 2, lexical_index=lexical_index
    )

    assert lexical_index.score("neonflux telemetry")["this-is-fine"] > 0
    assert [selection.template_id for selection in selections] == ["this-is-fine", "change-my-mind"]


async def test_service_reuses_precomputed_global_lexical_index() -> None:
    service, _, gateway = service_with_templates("this-is-fine", "change-my-mind")
    gateway.fail_joint = True

    await service.get_suggestions("Prod is down", user_id=INSTALL_ID)
    index = service._global_lexical_index
    await service.get_suggestions("Prod is down again", user_id=uuid4())

    assert index is not None
    assert service._global_lexical_index is index


def test_local_ranker_detects_forced_choice_and_false_label_joke_shapes() -> None:
    forced_choice = semantic_template_signals(
        "Should I fix the bug properly or add another feature flag and pretend it was planned?"
    )
    false_label = semantic_template_signals(
        "Calling this spreadsheet with macros a modern data platform is certainly "
        "one way to describe it."
    )

    assert forced_choice["two-buttons"] > 0
    assert forced_choice["evil-kermit"] > 0
    assert false_label["is-this-a-pigeon"] > 0
    assert false_label["they-re-the-same-picture"] > 0


def test_local_ranker_infers_reusable_mechanics_from_paraphrased_language() -> None:
    calm_interrupted = infer_humor_mechanics(
        "The wellness retreat promised a peaceful meditation, then road crews began drilling "
        "outside the studio."
    )
    ceremony_for_trivial_change = infer_humor_mechanics(
        "The company held a launch event with an audience to announce a slightly different "
        "brand color."
    )
    self_serving_loophole = infer_humor_mechanics(
        "My activity tracker counted carrying cookies upstairs as exercise, so I treated "
        "myself to dessert."
    )

    assert "calm_interrupted" in calm_interrupted
    assert "ceremony_for_trivial_change" in ceremony_for_trivial_change
    assert "self_serving_loophole" in self_serving_loophole

    catalog = MemeCatalog.load()
    future_source = catalog.verified_templates[0]
    future_template = future_source.model_copy(
        update={
            "template_id": "future-annoyed-observer",
            "name": "Future Annoyed Observer",
            "retrieval": future_source.retrieval.model_copy(
                update={"joke_shapes": ["annoyed observer"]}
            ),
        }
    )
    future_candidate = Candidate(
        meme_id=future_template.template_id,
        name=future_template.name,
        image_url="/memes/future.png",
        system_tags={},
        is_evergreen=True,
        template=future_template,
    )

    assert (
        candidate_joke_shape_boost(inferred_joke_shape_boosts(calm_interrupted), future_candidate)
        == 0.46
    )


def test_local_ranker_infers_choice_conflict_and_rebuttal_mechanics_from_paraphrases() -> None:
    absurd_workaround = infer_humor_mechanics(
        "The committee had a direct repair available but selected a lengthy training protocol."
    )
    internal_temptation = infer_humor_mechanics(
        "The reasonable voice in my mind says to save the draft; an impulse wants to delete it."
    )
    derailed_goal = infer_humor_mechanics(
        "I started cleaning the desk; moments later a sprinkler erupted and interrupted everything."
    )
    hidden_constraint = infer_humor_mechanics(
        "They said to simply upload the file, having never encountered the blocked approval system."
    )
    dismissive_rebuttal = infer_humor_mechanics(
        "Residents requested the broken lift be fixed; management responded that they should "
        "relax and enjoy the stairs."
    )

    assert "absurd_workaround_chosen" in absurd_workaround
    assert "responsibility_versus_temptation" in internal_temptation
    assert "goal_instantly_derailed" in derailed_goal
    assert "casual_advice_hides_constraint" in hidden_constraint
    assert "dismissive_rebuttal" in dismissive_rebuttal


def test_local_ranker_infers_failure_reveal_and_consensus_mechanics_from_paraphrases() -> None:
    rejected_improvement = infer_humor_mechanics(
        "The committee rejected installing a simple guard because risk makes work exciting."
    )
    obstacle_reveal = infer_humor_mechanics(
        "I guaranteed this route was faster, then found the entrance locked."
    )
    renamed_status_quo = infer_humor_mechanics(
        "The clinic replaced its old queue with Priority Journey, but patients still wait."
    )
    interrupted_errand = infer_humor_mechanics(
        "I began sorting the archive; a moment later a pipe burst and interrupted everything."
    )
    sole_witness = infer_humor_mechanics(
        "The audience cheered the prediction; only I noticed the hidden earpiece."
    )
    unlikely_consensus = infer_humor_mechanics(
        "Both architects and musicians agreed that the notification sound was unbearable."
    )

    assert "group_rejects_improvement" in rejected_improvement
    assert "confidence_meets_obstacle" in obstacle_reveal
    assert "fancy_name_same_outcome" in renamed_status_quo
    assert "goal_instantly_derailed" in interrupted_errand
    assert "sole_witness_hidden_truth" in sole_witness
    assert "cross_group_agreement" in unlikely_consensus


def test_local_ranker_infers_spin_culprit_and_recursive_failure_from_paraphrases() -> None:
    positive_spin = infer_humor_mechanics(
        "They called the failed safety test a growth opportunity and told everyone to enjoy "
        "the experience."
    )
    culprit_reveal = infer_humor_mechanics(
        "The office blamed interns for the missing snacks until access records revealed the "
        "director taking them."
    )
    harmful_efficiency = infer_humor_mechanics(
        "To save time, the team removed backup checks and ordered extra replacement parts "
        "for the damage."
    )
    failed_self_teaching = infer_humor_mechanics(
        "I guaranteed the shelf would hold after watching a tutorial; immediately it collapsed."
    )
    recursive_access = infer_humor_mechanics(
        "The dashboard requires approval to request approval, and approval needs a dashboard "
        "request."
    )

    assert "danger_reframed_positive" in positive_spin
    assert "evidence_reveals_culprit" in culprit_reveal
    assert "efficiency_creates_harm" in harmful_efficiency
    assert "self_taught_confidence_fails" in failed_self_teaching
    assert "recursive_prerequisite" in recursive_access


def test_tokenizer_exposes_hyphenated_concept_components() -> None:
    terms = tokenize_sequence("A premium-label rollout")

    assert "premium-label" in terms
    assert "premium" in terms
    assert "label" in terms


def test_anti_use_hints_apply_a_bounded_negative_retrieval_signal() -> None:
    catalog = MemeCatalog.load()
    source_templates = catalog.verified_templates[:2]
    candidates = []
    for index, source in enumerate(source_templates):
        retrieval = source.retrieval.model_copy(
            update={
                "joke_shapes": ["celebration"],
                "positive_hints": ["celebrate a milestone victory"],
                "anti_hints": ["milestone victory"] if index else [],
            }
        )
        template = source.model_copy(update={"retrieval": retrieval})
        candidates.append(
            Candidate(
                meme_id=template.template_id,
                name=template.name,
                image_url=f"/memes/{index}.png",
                system_tags={},
                is_evergreen=True,
                template=template,
            )
        )

    selections = fallback_template_selections("Celebrate the milestone victory", candidates, 2)

    assert selections[0].template_id == candidates[0].template.template_id
    assert selections[0].score > selections[1].score


def test_soft_diversity_prevents_one_shape_from_monopolizing_shortlist() -> None:
    catalog = MemeCatalog.load()
    candidates = []
    for index, source in enumerate(catalog.verified_templates[:4]):
        shape = "same grammar" if index < 3 else "different grammar"
        retrieval = source.retrieval.model_copy(update={"joke_shapes": [shape]})
        template = source.model_copy(update={"retrieval": retrieval})
        candidates.append(
            Candidate(
                meme_id=template.template_id,
                name=template.name,
                image_url=f"/memes/{index}.png",
                system_tags={},
                is_evergreen=True,
                template=template,
            )
        )
    relevance_pool = [
        (0.90, candidates[0]),
        (0.89, candidates[1]),
        (0.88, candidates[2]),
        (0.87, candidates[3]),
    ]

    selected = diversify_shortlist(relevance_pool, 3)

    assert selected[0] == relevance_pool[0]
    assert candidates[3] in [candidate for _, candidate in selected[:2]]
    assert any(candidate in candidates[1:3] for _, candidate in selected)
