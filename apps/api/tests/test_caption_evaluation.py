from __future__ import annotations

import json

import pytest

from memedrop_api.caption_evaluation import (
    DEFAULT_SAMPLE_PATH,
    evaluate_caption_sample,
    safe_model_filename,
)
from memedrop_api.services.openrouter import JointSuggestionResult, TemplateSelection
from memedrop_api.suggestion_evaluation import default_benchmark_path


class FakeCaptionGateway:
    async def select_and_caption(  # type: ignore[no-untyped-def]
        self, tweet_text, templates, limit, *, context=None, steering_instruction=None
    ):
        assert len(templates) <= 12
        assert context is not None
        return JointSuggestionResult(
            selections=[TemplateSelection("this-is-fine", "calm inside chaos", 0.91)],
            captions={
                "this-is-fine": {
                    "speech_bubble_text": "This is fine",
                    "bottom_caption": "Production is on fire",
                }
            },
        )

    async def generate_captions(  # type: ignore[no-untyped-def]
        self, tweet_text, templates, *, context=None
    ):
        return {}


async def test_live_caption_sample_is_fixed_structured_and_reviewable(tmp_path) -> None:  # type: ignore[no-untyped-def]
    benchmark_path = tmp_path / "benchmark.json"
    benchmark_path.write_text(
        json.dumps(
            {
                "cases": [
                    {
                        "id": "production-fire",
                        "category": "chaos",
                        "tweet": "Production is on fire and the dashboard is red again.",
                    }
                ]
            }
        ),
        encoding="utf-8",
    )
    sample_path = tmp_path / "sample.json"
    sample_path.write_text('{"case_ids":["production-fire"]}', encoding="utf-8")

    report = await evaluate_caption_sample(
        benchmark_path=benchmark_path,
        sample_path=sample_path,
        gateway=FakeCaptionGateway(),
        model_name="test/model",
    )

    assert report["model"] == "test/model"
    assert report["summary"]["cases"] == 1  # type: ignore[index]
    assert report["summary"]["contract_valid_rate"] == 1.0  # type: ignore[index]
    suggestion = report["cases"][0]["suggestions"][0]  # type: ignore[index]
    assert suggestion["contract_valid"] is True
    assert suggestion["human_review"] == {
        "post_fit": None,
        "comic_turn": None,
        "template_fit": None,
        "caption_readability": None,
        "notes": "",
    }


async def test_live_caption_sample_rejects_unknown_case_ids(tmp_path) -> None:  # type: ignore[no-untyped-def]
    benchmark_path = tmp_path / "benchmark.json"
    benchmark_path.write_text('{"cases":[]}', encoding="utf-8")
    sample_path = tmp_path / "sample.json"
    sample_path.write_text('{"case_ids":["missing"]}', encoding="utf-8")

    with pytest.raises(ValueError, match="unknown benchmark cases: missing"):
        await evaluate_caption_sample(
            benchmark_path=benchmark_path,
            sample_path=sample_path,
            gateway=FakeCaptionGateway(),
            model_name="test/model",
        )


def test_live_caption_sample_uses_safe_output_names() -> None:
    assert safe_model_filename("OpenAI/GPT 5.4 Mini") == "openai-gpt-5-4-mini"


def test_live_caption_sample_is_a_stable_diverse_benchmark_subset() -> None:
    sample_ids = json.loads(DEFAULT_SAMPLE_PATH.read_text(encoding="utf-8"))["case_ids"]
    benchmark_cases = json.loads(default_benchmark_path().read_text(encoding="utf-8"))["cases"]
    benchmark_ids = {item["id"] for item in benchmark_cases}

    assert len(sample_ids) == 12
    assert len(set(sample_ids)) == 12
    assert set(sample_ids) <= benchmark_ids
