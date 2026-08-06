from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

import memedrop_api.services.suggestion_engine as suggestion_engine
from memedrop_api.config import Settings
from memedrop_api.services.catalog import MemeCatalog, normalize_template_name
from memedrop_api.services.openrouter import JointSuggestionResult, TemplateSelection
from memedrop_api.services.suggestion_engine import (
    Candidate,
    LexicalCandidateIndex,
    SuggestionService,
    diversify_shortlist,
    fallback_template_selections,
    safe_log_cache_key,
    safe_log_tweet_text,
    semantic_template_signals,
)
from tests.conftest import INSTALL_ID, ApiHarness
from tests.fakes import FakeStore


class FakeGateway:
    def __init__(self) -> None:
        self.selections: list[TemplateSelection] = []
        self.captions: dict[str, dict[str, str]] = {}
        self.joint_calls = 0
        self.caption_calls = 0
        self.fail_joint = False
        self.seen_template_counts: list[int] = []

    async def select_and_caption(self, tweet_text, templates, limit):  # type: ignore[no-untyped-def]
        self.joint_calls += 1
        self.seen_template_counts.append(len(templates))
        if self.fail_joint:
            raise RuntimeError("model unavailable")
        return JointSuggestionResult(self.selections[:limit], self.captions)

    async def generate_captions(self, tweet_text, templates):  # type: ignore[no-untyped-def]
        self.caption_calls += 1
        return self.captions


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
        "surprised-pikachu": {"top_reaction_caption": "Skipped tests + Friday deploy"}
    }

    result = await service.get_suggestions(
        "We skipped tests and deployed Friday. Who could have predicted this?",
        user_id=INSTALL_ID,
        limit=2,
    )

    assert [item["name"] for item in result] == ["Surprised Pikachu", "This Is Fine"]
    assert result[0]["score"] == 0.96
    assert result[0]["use_case_label"] == "predictable consequence"
    assert result[0]["tweet_context"]["intent"] == "dunking"
    assert result[0]["feedback_context"]["intent"] == "dunking"
    assert set(result[0]["feedback_context"]).isdisjoint(
        {"core_claim", "implied_context", "comedic_tension", "caption_anchors"}
    )
    assert result[0]["tailored_overlay"]["regions"][0]["text"] == ("Skipped tests + Friday deploy")
    assert result[1]["tailored_overlay"] is not None
    assert gateway.joint_calls == 1
    assert gateway.caption_calls == 0


async def test_service_bounds_joint_shortlist_and_returns_at_most_five() -> None:
    catalog = MemeCatalog.load()
    template_ids = [template.template_id for template in catalog.verified_templates]
    service, _, gateway = service_with_templates(*template_ids)
    gateway.selections = [
        TemplateSelection(template.template_id, "fit", 0.9)
        for template in catalog.verified_templates[:6]
    ]

    result = await service.get_suggestions("A generic post", user_id=INSTALL_ID, limit=99)

    assert len(result) == 5
    assert gateway.joint_calls == 1
    assert gateway.seen_template_counts == [min(12, len(template_ids))]


async def test_service_fills_missing_joint_results_from_local_ranking() -> None:
    service, _, gateway = service_with_templates(
        "this-is-fine", "oprah-you-get-a", "surprised-pikachu"
    )
    gateway.selections = [TemplateSelection("surprised-pikachu", "model pick", 0.96)]

    result = await service.get_suggestions(
        "Prod is down and the dashboard is red", user_id=INSTALL_ID, limit=3
    )

    assert result[0]["name"] == "Surprised Pikachu"
    assert len(result) == 3
    assert {item["name"] for item in result} == {
        "Surprised Pikachu",
        "This Is Fine",
        "Oprah You Get A",
    }


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

    async def delayed_select(tweet_text, templates, limit):  # type: ignore[no-untyped-def]
        model_started.set()
        await allow_model.wait()
        return await original_select(tweet_text, templates, limit)

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

    async def delayed_select(tweet_text, templates, limit):  # type: ignore[no-untyped-def]
        model_started.set()
        await allow_model.wait()
        return await original_select(tweet_text, templates, limit)

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

    async def delayed_select(tweet_text, templates, limit):  # type: ignore[no-untyped-def]
        model_started.set()
        await allow_model.wait()
        return await original_select(tweet_text, templates, limit)

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
    gateway.fail_joint = True
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


async def test_local_ranking_uses_bounded_personal_feedback() -> None:
    service, store, gateway = service_with_templates("change-my-mind", "disaster-girl")
    gateway.fail_joint = True
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

    assert invalid.status_code == 400
    assert invalid.json()["error"] == "Invalid request"
    assert valid.status_code == 200
    suggestion = valid.json()["suggestions"][0]
    assert suggestion["name"] == "This Is Fine"
    assert suggestion["tweet_context"]
    assert suggestion["feedback_context"]
    feedback_context = suggestion["feedback_context"]
    assert set(feedback_context).isdisjoint(
        {"core_claim", "implied_context", "comedic_tension", "caption_anchors"}
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


def test_safe_suggestion_logs_hash_sensitive_text() -> None:
    assert safe_log_cache_key("tweet text").startswith("sha256:")
    assert "tweet text" not in safe_log_cache_key("tweet text")
    assert safe_log_tweet_text("secret tweet", "redacted").startswith("[redacted:")
    assert safe_log_tweet_text("  local   preview ", "preview") == "local preview"


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
