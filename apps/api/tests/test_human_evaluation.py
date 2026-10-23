from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, cast
from uuid import uuid4

import pytest
from PIL import Image
from pydantic import ValidationError

from memedrop_api.config import Settings
from memedrop_api.human_evaluation import (
    DIMENSIONS,
    ManifestCase,
    ManifestSuggestion,
    ReviewManifest,
    ReviewScores,
    _catalog_media,
    _evaluation_settings,
    build_review_html,
    capture_review,
    compare_scores,
    corpus_digest,
    summarize_review,
    validate_scores,
)
from memedrop_api.human_evaluation_cases import load_human_evaluation_cases
from memedrop_api.services.catalog import DEFAULT_CATALOG_PATH, MemeCatalog
from memedrop_api.services.openrouter import JointSuggestionResult, TemplateSelection
from memedrop_api.services.suggestion_engine import SuggestionService
from tests.fakes import FakeStore


@pytest.mark.parametrize("live_provider", [False, True])
def test_evaluation_settings_ignore_deployment_environment(
    monkeypatch: pytest.MonkeyPatch, live_provider: bool
) -> None:
    inherited = {
        "MEMEDROP_ENV": "production",
        "DATABASE_URL": "postgresql://deployment-credentials",
        "S3_BUCKET_NAME": "meme-drop-prod",
        "MEMEDROP_STORAGE_BACKEND": "s3",
        "MEMEDROP_RATE_LIMIT_STORE": "redis",
        "REDIS_URL": "redis://deployment-credentials",
        "QSTASH_TOKEN": "deployment-secret",
        "MEMEDROP_TRENDS_ENABLED": "true",
        "OPENROUTER_API_KEY": "explicit-provider-key",
        "OPENROUTER_SUGGESTION_MODEL": "openai/gpt-6-luna",
    }
    for name, value in inherited.items():
        monkeypatch.setenv(name, value)
    settings = _evaluation_settings(live_provider=live_provider)
    assert settings.node_env == "development"
    assert settings.database_url == "postgresql://evaluation"
    assert settings.storage_backend == "local"
    assert settings.s3_bucket_name is None
    assert settings.rate_limit_store == "memory"
    assert settings.redis_url is None
    assert settings.qstash_token is None
    assert not settings.trends_enabled
    assert settings.openrouter_api_key == ("explicit-provider-key" if live_provider else None)
    assert settings.openrouter_suggestion_model == "openai/gpt-6-luna"
    assert all(os.environ[name] == value for name, value in inherited.items())


class CaptionGateway:
    async def generate_captions(self, *args: Any, **kwargs: Any) -> dict[str, dict[str, str]]:
        return {}

    async def select_and_caption(self, *args: Any, **kwargs: Any) -> JointSuggestionResult:
        assert args[0] in {case.text for case in load_human_evaluation_cases()}
        return JointSuggestionResult(
            [TemplateSelection("this-is-fine", "fixture", 0.9)],
            {
                "this-is-fine": {
                    "speech_bubble_text": "This is fine",
                    "bottom_caption": "Fixture joke",
                }
            },
        )


def manifest() -> ReviewManifest:
    return ReviewManifest(
        run_id=uuid4(),
        variant="baseline",
        mode="fallback",
        corpus_digest=corpus_digest(),
        catalog_digest="a" * 64,
        pipeline_digest="b" * 64,
        model="disabled",
        cases=[
            ManifestCase(
                case_id="x-launch-a",
                status="ok",
                service_ms=12,
                suggestions=[
                    ManifestSuggestion(template_id="this-is-fine", position=1, media_available=True)
                ],
            ),
            ManifestCase(case_id="x-launch-b", status="ok", service_ms=14, suggestions=[]),
        ],
    )


def scores_for(m: ReviewManifest, value: int | None = None) -> ReviewScores:
    return ReviewScores.model_validate(
        {
            "version": 1,
            "run_id": str(m.run_id),
            "variant": m.variant,
            "corpus_digest": m.corpus_digest,
            "cases": [
                {
                    "case_id": c.case_id,
                    "judgment": "reply" if value else None,
                    "suggestions": [
                        {
                            "template_id": s.template_id,
                            "position": s.position,
                            "render_status": "ready" if s.media_available else "failed",
                            **dict.fromkeys(DIMENSIONS, value),
                            "would_use": value is not None,
                        }
                        for s in c.suggestions
                    ],
                }
                for c in m.cases
            ],
        }
    )


async def test_capture_calls_production_service_and_renders_only_canonical_synthetic_cases(
    tmp_path: Path,
    settings: Settings,
) -> None:
    media = tmp_path / "seed-this-is-fine-907eec71.jpg"
    Image.new("RGB", (640, 480), "gray").save(media)
    catalog = MemeCatalog.load(DEFAULT_CATALOG_PATH)
    store = FakeStore()
    store.memes = [{"id": "this-is-fine", "name": "This Is Fine", "filePath": "/memes/test.jpg"}]
    service = SuggestionService(store, catalog, CaptionGateway(), settings)
    m, page = await capture_review(
        service, catalog=catalog, media_dir=tmp_path, case_ids=["x-launch-a"]
    )
    assert store.list_global_memes_calls == 1
    assert len(m.cases[0].suggestions) == 1
    assert m.cases[0].suggestions[0].media_available
    assert m.measurement == "service_only_no_database_or_trends"
    assert page[0]["text"] == load_human_evaluation_cases()[0].text
    assert page[0]["suggestions"][0]["overlay"]["regions"]
    html = build_review_html(m, page)
    assert "function drawMemeTextOverlay(" in html
    assert "data:image/png;base64," in html
    assert "data:font/woff2;base64," in html
    assert "connect-src" not in html  # default-src none prohibits network connections
    assert "default-src 'none'" in html
    safe_manifest = m.model_dump_json()
    assert page[0]["text"] not in safe_manifest
    assert "Fixture joke" not in safe_manifest
    assert "overlay" not in safe_manifest


async def test_capture_does_not_accept_external_post_inputs(tmp_path: Path) -> None:
    class UnusedService:
        async def get_suggestion_run(self, *args: Any, **kwargs: Any) -> list[dict[str, Any]]:
            raise AssertionError("must not run")

    with pytest.raises(ValueError, match="canonical|selected corpus"):
        await capture_review(
            cast(SuggestionService, UnusedService()),
            catalog=MemeCatalog.load(DEFAULT_CATALOG_PATH),
            media_dir=tmp_path,
            case_ids=["private source text"],
        )


async def test_capture_preserves_failure_without_exception_payload(tmp_path: Path) -> None:
    class BrokenService:
        async def get_suggestion_run(self, *args: Any, **kwargs: Any) -> list[dict[str, Any]]:
            raise RuntimeError("sensitive-provider-error")

    m, page = await capture_review(
        cast(SuggestionService, BrokenService()),
        catalog=MemeCatalog.load(DEFAULT_CATALOG_PATH),
        media_dir=tmp_path,
        case_ids=["x-launch-a"],
    )
    assert m.cases[0].status == "error"
    assert page[0]["status"] == "error"
    assert "sensitive-provider-error" not in m.model_dump_json() + json.dumps(page)


def test_unrated_is_missing_not_zero_and_related_groups_are_counted() -> None:
    m = manifest()
    scores = scores_for(m)
    summary = summarize_review(m, scores)
    assert summary["judged_cases"] == 0
    assert summary["unjudged_cases"] == 2
    assert summary["dimensions"]["post_fit"] == {"n": 0, "mean": None}
    rated = summarize_review(m, scores_for(m, 4))
    assert rated["judged_cases"] == 2
    assert rated["judged_groups"] == 1
    assert rated["fully_rated_suggestions"] == 1
    assert rated["empty_results"] == 1
    assert "No automatic promotion" in rated["interpretation"]


@pytest.mark.parametrize(
    "field,value",
    [
        ("notes", "private source"),
        ("text", "private source"),
        ("caption", "secret caption"),
        ("post_fit", True),
        ("post_fit", 0),
        ("would_use", "yes"),
    ],
)
def test_scores_reject_free_text_unknown_fields_and_invalid_ratings(field: str, value: Any) -> None:
    raw = scores_for(manifest()).model_dump(mode="json")
    raw["cases"][0]["suggestions"][0][field] = value
    with pytest.raises(ValidationError):
        ReviewScores.model_validate(raw)


def test_score_manifest_binding_and_partial_suggestion_lists_are_rejected() -> None:
    m = manifest()
    score = scores_for(m, 4)
    with pytest.raises(ValueError, match="belong"):
        validate_scores(m, score.model_copy(update={"run_id": uuid4()}))
    score.cases[0].suggestions = []
    with pytest.raises(ValueError, match="all captured"):
        validate_scores(m, score)


def test_missing_media_and_failed_render_cannot_be_rated() -> None:
    m = manifest()
    score = scores_for(m, 4)
    score.cases[0].suggestions[0].render_status = "failed"
    with pytest.raises(ValueError, match="render successfully"):
        validate_scores(m, score)
    score.cases[0].suggestions[0].render_status = "ready"
    m.cases[0].suggestions[0].media_available = False
    with pytest.raises(ValueError, match="render successfully"):
        validate_scores(m, score)


def test_comparison_pairs_complete_case_means_and_reports_regressions() -> None:
    m = manifest()
    a, b = scores_for(m, 4), scores_for(m, 2)
    comparison = compare_scores(a, b)["dimensions"]["post_fit"]
    assert comparison == {
        "paired_cases": 1,
        "mean_delta_right_minus_left": -2,
        "improved_cases": 0,
        "worse_cases": 1,
    }
    b.cases[0].suggestions[0].post_fit = None
    assert compare_scores(a, b)["dimensions"]["post_fit"]["paired_cases"] == 0


def test_symlink_media_cannot_escape_explicit_catalog_directory(tmp_path: Path) -> None:
    outside = tmp_path / "outside.jpg"
    Image.new("RGB", (20, 20)).save(outside)
    media = tmp_path / "media"
    media.mkdir()
    (media / "seed-this-is-fine-907eec71.jpg").symlink_to(outside)
    assert _catalog_media("this-is-fine", MemeCatalog.load(DEFAULT_CATALOG_PATH), media) is None


def test_cli_rejects_external_text_without_echoing_it() -> None:
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "memedrop_api.human_evaluation",
            "capture",
            "--text",
            "sensitive-customer-text",
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 2
    assert "sensitive-customer-text" not in result.stdout + result.stderr


def test_cli_summary_exports_only_allowlisted_metadata(tmp_path: Path) -> None:
    m = manifest()
    scores = scores_for(m, 4)
    mp = tmp_path / "manifest.json"
    sp = tmp_path / "scores.json"
    mp.write_text(m.model_dump_json())
    sp.write_text(scores.model_dump_json())
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "memedrop_api.human_evaluation",
            "summary",
            "--manifest",
            str(mp),
            "--scores",
            str(sp),
        ],
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["fully_rated_suggestions"] == 1
    assert all(c.text not in result.stdout for c in load_human_evaluation_cases())
