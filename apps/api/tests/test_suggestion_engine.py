from __future__ import annotations

import json
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from memedrop_api.config import Settings
from memedrop_api.services.catalog import MemeCatalog, normalize_template_name
from memedrop_api.services.openrouter import TemplateSelection
from memedrop_api.services.suggestion_engine import (
    Candidate,
    SuggestionService,
    fallback_template_selections,
    safe_log_cache_key,
    safe_log_tweet_text,
)
from tests.conftest import INSTALL_ID, ApiHarness
from tests.fakes import FakeStore


class FakeGateway:
    def __init__(self) -> None:
        self.selections: list[TemplateSelection] = []
        self.captions: dict[str, dict[str, str]] = {}
        self.selection_calls = 0
        self.caption_calls = 0
        self.fail_selection = False

    async def select_templates(self, tweet_text, templates, limit):  # type: ignore[no-untyped-def]
        self.selection_calls += 1
        if self.fail_selection:
            raise RuntimeError("model unavailable")
        return self.selections[:limit]

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


async def test_service_uses_model_order_batched_captions_and_context() -> None:
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
    assert result[0]["tweet_context"]["intent"] == "dunking"
    assert result[0]["feedback_context"]["intent"] == "dunking"
    assert set(result[0]["feedback_context"]).isdisjoint(
        {"core_claim", "implied_context", "comedic_tension", "caption_anchors"}
    )
    assert result[0]["tailored_overlay"]["regions"][0]["text"] == ("Skipped tests + Friday deploy")
    assert result[1]["tailored_overlay"] is not None
    assert gateway.caption_calls == 1


async def test_service_cache_avoids_repeating_model_work_and_refresh_bypasses() -> None:
    service, _, gateway = service_with_templates("this-is-fine")

    first = await service.get_suggestions("Prod is down", user_id=INSTALL_ID)
    second = await service.get_suggestions("Prod is down", user_id=INSTALL_ID)
    refreshed = await service.get_suggestions("Prod is down", user_id=INSTALL_ID, refresh=True)

    assert first == second == refreshed
    assert gateway.selection_calls == 2
    assert gateway.caption_calls == 2


async def test_service_falls_back_when_selection_model_fails() -> None:
    service, _, gateway = service_with_templates(
        "this-is-fine", "oprah-you-get-a", "surprised-pikachu"
    )
    gateway.fail_selection = True

    result = await service.get_suggestions(
        "Prod is down and the dashboard is red", user_id=INSTALL_ID, limit=1
    )

    assert result[0]["name"] == "This Is Fine"


async def test_local_ranking_uses_bounded_personal_feedback() -> None:
    service, store, gateway = service_with_templates("change-my-mind", "disaster-girl")
    gateway.fail_selection = True
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
