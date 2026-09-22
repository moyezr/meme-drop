from __future__ import annotations

from typing import Any, cast

from memedrop_api.jev_evaluation import build_jev_request, parse_jev_response
from memedrop_api.services.catalog import MemeCatalog


def test_jev_request_uses_only_typed_decisions_over_the_bounded_shortlist() -> None:
    templates = MemeCatalog.load().verified_templates[:2]

    request = build_jev_request("The deploy is on fire again.", templates, "jev-1.13.0")

    assert request["model"] == "jev-1.13.0"
    questions = cast(dict[str, dict[str, Any]], request["questions"])
    assert set(questions) == {"best_template", "fit_0", "fit_1"}
    assert questions["best_template"]["type"] == "choice"
    assert questions["fit_0"]["type"] == "noul"
    state = cast(dict[str, Any], request["state"])
    assert state["source_post"] == "The deploy is on fire again."


def test_jev_response_ranks_absolute_fit_then_relative_choice() -> None:
    templates = MemeCatalog.load().verified_templates[:3]
    response = {
        "model": "jev-1.13.0",
        "answers": {
            "best_template": {
                "type": "choice",
                "choice": "template_1",
                "confidence": 0.8,
                "probabilities": {
                    "template_0": 0.1,
                    "template_1": 0.7,
                    "template_2": 0.2,
                    "none": 0.0,
                },
            },
            "fit_0": {"type": "noul", "noul": 0.4},
            "fit_1": {"type": "noul", "noul": 0.8},
            "fit_2": {"type": "noul", "noul": 0.8},
        },
        "usage": {"input_tokens": 321, "output_tokens": 45},
    }

    ranking = parse_jev_response(response, templates, 123.4)

    assert [item.template_id for item in ranking.scores] == [
        templates[1].template_id,
        templates[2].template_id,
        templates[0].template_id,
    ]
    assert ranking.input_tokens == 321
    assert ranking.latency_ms == 123.4
