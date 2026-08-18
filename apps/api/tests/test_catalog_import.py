from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import pytest

from memedrop_api.catalog_import import (
    candidate_matches_existing,
    import_candidate,
    load_import_candidates,
    validate_import_environment,
)
from memedrop_api.config import Settings
from memedrop_api.db import CatalogDraft


def pipeline_template() -> dict[str, Any]:
    return {
        "schema_version": 2,
        "template_id": "demo-template-imgflip-source-1",
        "name": "Demo Template",
        "aliases": ["Demo Template", "Demo alias"],
        "source_image": "/memes/catalog/scraped/imgflip/source-1-aaaaaaaaaaaa.jpg",
        "image_width": 800,
        "image_height": 600,
        "image_aspect_ratio": 1.3333,
        "supports_overlay": True,
        "quality": "draft",
        "regions": [
            {
                "id": "top_caption",
                "role": "setup that establishes the expectation",
                "x": 0.1,
                "y": 0.05,
                "width": 0.8,
                "height": 0.2,
                "align": "center",
                "valign": "middle",
                "max_lines": 2,
                "max_chars": 36,
                "padding_ratio": 0.055,
                "text_transform": "uppercase",
                "font": {
                    "family": "Impact",
                    "weight": 900,
                    "min_size": 18,
                    "max_size": 48,
                    "fill_color": "#FFFFFF",
                    "stroke_color": "#000000",
                    "stroke_ratio": 0.12,
                    "line_height_ratio": 1.08,
                },
                "notes": "Keep clear of the subject.",
            }
        ],
        "caption_guidance": {
            "pattern": "Set up a confident expectation and contrast it with the outcome.",
            "good_examples": [
                {"top_caption": "THE SIMPLE PLAN"},
                {"top_caption": "WHAT COULD GO WRONG"},
            ],
            "bad_examples": [{"top_caption": "A GENERIC REACTION"}],
        },
        "retrieval": {
            "version": 1,
            "joke_shapes": ["expectation versus reality"],
            "positive_hints": [
                "confident plan fails",
                "obvious reversal",
                "predictable consequence",
            ],
            "anti_hints": ["quiet success", "balanced choice", "unrelated celebration"],
        },
        "editorial": {
            "description": "Two people react on opposite sides of a blank image.",
            "canonical_meaning": "Confidence is contrasted with a predictably worse reality.",
            "use_cases": ["a plan backfires", "confidence meets evidence", "a consequence arrives"],
            "anti_use_cases": ["a simple success", "a neutral update", "a sincere condolence"],
            "tone_tags": ["sarcastic"],
            "trend_notes": [],
            "freshness": "unknown",
        },
        "safety": {"sensitive_topics": [], "brand_risks": []},
        "source": {
            "provider": "imgflip",
            "source_id": "source-1",
            "source_url": "https://i.imgflip.com/source-1.jpg",
            "page_url": "https://imgflip.com/meme/Demo-Template",
            "content_sha256": "a" * 64,
        },
        "annotation_meta": {
            "status": "machine_generated",
            "requires_human_review": True,
            "semantic_model": "gemini-3.7-flash",
            "vision_model": "gemini-3.7-flash",
            "geometry_source": "vision_model",
            "prompt_version": "semantic-template-v6",
            "input_sha256": "b" * 64,
            "generated_at": "2026-08-18T00:00:00Z",
        },
    }


def test_pipeline_draft_maps_to_prefilled_human_review_annotation() -> None:
    candidate = import_candidate(pipeline_template())

    assert candidate.asset_path.startswith("/memes/catalog/scraped/imgflip/")
    assert candidate.annotation["quality"] == "draft"
    assert candidate.annotation["visual_qa"] is None
    assert candidate.annotation["editorial"]["canonical_meaning"].startswith("Confidence")
    assert candidate.annotation["safety"] == {"sensitive_topics": [], "brand_risks": []}
    assert candidate.annotation["machine_provenance"] == {
        "status": "machine_generated",
        "requires_human_review": True,
        "semantic_model": "gemini-3.7-flash",
        "vision_model": "gemini-3.7-flash",
        "geometry_source": "vision_model",
        "prompt_version": "semantic-template-v6",
        "input_sha256": "b" * 64,
        "generated_at": "2026-08-18T00:00:00Z",
        "source_provider": "imgflip",
        "source_id": "source-1",
        "source_content_sha256": "a" * 64,
    }


def test_manifest_loader_rejects_duplicate_media(tmp_path: Path) -> None:
    manifest = {"version": 2, "generated_at": "2026-08-18T00:00:00Z", "templates": []}
    manifest["templates"] = [pipeline_template(), {**pipeline_template(), "template_id": "other"}]
    path = tmp_path / "manifest.json"
    path.write_text(json.dumps(manifest), encoding="utf-8")

    with pytest.raises(ValueError, match="Duplicate source content"):
        load_import_candidates(path)


def test_existing_catalog_rows_are_idempotent_but_never_overwritten() -> None:
    candidate = import_candidate(pipeline_template())
    existing = CatalogDraft(
        template_id=candidate.template_id,
        name=candidate.name,
        asset_path=candidate.asset_path,
        source_url=candidate.source_url,
        annotation=candidate.annotation,
    )

    assert candidate_matches_existing(candidate, existing)
    existing.annotation = {**candidate.annotation, "name": "Human correction"}
    assert not candidate_matches_existing(candidate, existing)


def test_import_environment_requires_the_development_s3_bucket() -> None:
    valid = cast(
        Settings,
        SimpleNamespace(
            is_production=False,
            storage_backend="s3",
            s3_bucket_name="meme-drop-dev",
        ),
    )
    validate_import_environment(valid)

    production = cast(
        Settings,
        SimpleNamespace(
            is_production=True,
            storage_backend="s3",
            s3_bucket_name="meme-drop-prod",
        ),
    )
    with pytest.raises(ValueError, match="disabled in production"):
        validate_import_environment(production)

    local = cast(
        Settings,
        SimpleNamespace(is_production=False, storage_backend="local", s3_bucket_name=None),
    )
    with pytest.raises(ValueError, match="meme-drop-dev"):
        validate_import_environment(local)
