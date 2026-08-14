from __future__ import annotations

import pytest
from pydantic import ValidationError

from memedrop_api.catalog_schemas import (
    CatalogDraftUpdate,
    CatalogFontAnnotation,
    CatalogTemplateAnnotation,
    slugify_template_id,
)
from memedrop_api.catalog_visual_qa import render_fingerprint


def annotation(**overrides: object) -> dict[str, object]:
    value: dict[str, object] = {
        "template_id": "quality-template",
        "name": "Quality Template",
        "aliases": [],
        "source_image": "/memes/catalog/drafts/quality/source.png",
        "supports_overlay": True,
        "quality": "draft",
        "regions": [],
        "caption_guidance": {"pattern": "", "good_examples": [], "bad_examples": []},
        "retrieval": {
            "version": 1,
            "joke_shapes": [],
            "positive_hints": [],
            "anti_hints": [],
        },
        "editorial": {"description": "", "use_cases": [], "anti_use_cases": []},
    }
    value.update(overrides)
    return value


def test_slugify_template_id_is_stable() -> None:
    assert slugify_template_id("  This Is Fine!  ") == "this-is-fine"


def test_draft_can_be_saved_before_annotations_are_complete() -> None:
    value = CatalogDraftUpdate.model_validate(
        {"revision": 1, "status": "draft", "annotation": annotation()}
    )
    assert value.status == "draft"


def test_in_review_requires_human_quality_annotations() -> None:
    with pytest.raises(ValidationError, match="in-review drafts require"):
        CatalogDraftUpdate.model_validate(
            {"revision": 1, "status": "in_review", "annotation": annotation()}
        )


def test_regions_must_stay_inside_image_and_use_unique_ids() -> None:
    region = {
        "id": "top_caption",
        "role": "Set up the expectation",
        "x": 0.8,
        "y": 0.1,
        "width": 0.3,
        "height": 0.2,
        "align": "center",
        "valign": "middle",
        "max_lines": 2,
        "max_chars": 30,
        "font": {"family": "Impact", "min_size": 18, "max_size": 48, "stroke_ratio": 0.1},
    }
    with pytest.raises(ValidationError, match="region must remain inside"):
        CatalogDraftUpdate.model_validate(
            {
                "revision": 1,
                "status": "draft",
                "annotation": annotation(regions=[region]),
            }
        )


def test_typography_contract_defaults_and_rejects_invalid_values() -> None:
    parsed = CatalogTemplateAnnotation.model_validate(
        annotation(
            regions=[
                {
                    "id": "top_caption",
                    "role": "Setup",
                    "x": 0.05,
                    "y": 0.05,
                    "width": 0.9,
                    "height": 0.22,
                    "max_lines": 2,
                    "max_chars": 24,
                }
            ]
        )
    )
    region = parsed.regions[0]
    assert region.padding_ratio == 0.055
    assert region.text_transform == "uppercase"
    assert region.font.model_dump() == {
        "family": "Impact",
        "min_size": 18,
        "max_size": 48,
        "weight": 900,
        "fill_color": "#FFFFFF",
        "stroke_color": "#000000",
        "stroke_ratio": 0.1,
        "line_height_ratio": 1.08,
    }

    invalid = complete_annotation()
    invalid_regions = invalid["regions"]
    assert isinstance(invalid_regions, list)
    invalid_region = invalid_regions[0]
    assert isinstance(invalid_region, dict)
    invalid_region["font"] = {
        "family": "Comic Sans",
        "min_size": 18,
        "max_size": 48,
        "fill_color": "white",
        "stroke_color": "#000000",
        "stroke_ratio": 0.3,
        "line_height_ratio": 2,
    }
    with pytest.raises(ValidationError):
        CatalogTemplateAnnotation.model_validate(invalid)


def test_anton_annotations_normalize_to_the_available_weight() -> None:
    font = CatalogFontAnnotation.model_validate({"family": "Anton", "weight": 900})

    assert font.weight == 400


def complete_annotation(**overrides: object) -> dict[str, object]:
    region = {
        "id": "top_caption",
        "role": "Setup",
        "x": 0.05,
        "y": 0.05,
        "width": 0.9,
        "height": 0.22,
        "align": "center",
        "valign": "middle",
        "max_lines": 2,
        "max_chars": 24,
        "font": {"family": "Impact", "min_size": 18, "max_size": 48, "stroke_ratio": 0.1},
    }
    value = annotation(
        regions=[region],
        caption_guidance={
            "pattern": "Setup then reaction",
            "good_examples": [{"top_caption": "Me shipping on Friday"}],
            "bad_examples": [{"top_caption": "An unfunny explanation"}],
        },
        retrieval={
            "version": 1,
            "joke_shapes": ["reaction"],
            "positive_hints": ["deadline"],
            "anti_hints": ["formal"],
        },
        editorial={
            "description": "A person reacting to a deadline.",
            "use_cases": ["deadline reaction"],
            "anti_use_cases": ["formal announcement"],
        },
    )
    value.update(overrides)
    return value


def visual_qa(value: dict[str, object]) -> dict[str, object]:
    parsed = CatalogTemplateAnnotation.model_validate(value)
    fingerprint = render_fingerprint(parsed.model_dump(mode="json"))
    return {
        "status": "passed",
        "render_fingerprint": fingerprint,
        "reviewed_region_ids": ["top_caption"],
        "reviewed_example_indexes": [0],
        "reviewed_at": "2026-08-12T12:00:00Z",
    }


def test_examples_reject_unknown_region_keys_even_for_drafts() -> None:
    with pytest.raises(ValidationError, match="unknown regions"):
        CatalogDraftUpdate.model_validate(
            {
                "revision": 1,
                "status": "draft",
                "annotation": complete_annotation(
                    caption_guidance={
                        "pattern": "Setup",
                        "good_examples": [{"not_a_region": "Nope"}],
                        "bad_examples": [],
                    }
                ),
            }
        )


def test_approval_requires_current_visual_qa() -> None:
    value = complete_annotation()
    value["visual_qa"] = visual_qa(value)
    approved = CatalogDraftUpdate.model_validate(
        {"revision": 1, "status": "approved", "annotation": value}
    )
    assert approved.annotation.visual_qa is not None

    changed = complete_annotation()
    changed["visual_qa"] = visual_qa(value)
    changed["caption_guidance"] = {
        "pattern": "Setup then reaction",
        "good_examples": [{"top_caption": "Me shipping on a Monday"}],
        "bad_examples": [{"top_caption": "An unfunny explanation"}],
    }
    with pytest.raises(ValidationError, match="current visual QA"):
        CatalogDraftUpdate.model_validate(
            {"revision": 1, "status": "approved", "annotation": changed}
        )


def test_typography_change_makes_visual_qa_stale() -> None:
    value = complete_annotation()
    value["visual_qa"] = visual_qa(value)

    changed = complete_annotation()
    changed["visual_qa"] = value["visual_qa"]
    changed_regions = changed["regions"]
    assert isinstance(changed_regions, list)
    changed_region = changed_regions[0]
    assert isinstance(changed_region, dict)
    changed_region["padding_ratio"] = 0.12
    changed_font = changed_region["font"]
    assert isinstance(changed_font, dict)
    changed_font["line_height_ratio"] = 1.24

    with pytest.raises(ValidationError, match="current visual QA"):
        CatalogDraftUpdate.model_validate(
            {"revision": 1, "status": "approved", "annotation": changed}
        )


def test_approval_rejects_overlong_good_example_captions() -> None:
    value = complete_annotation()
    value["caption_guidance"] = {
        "pattern": "Setup then reaction",
        "good_examples": [
            {"top_caption": "This caption is substantially longer than twenty four characters"}
        ],
        "bad_examples": [{"top_caption": "An unfunny explanation"}],
    }
    value["visual_qa"] = visual_qa(value)
    with pytest.raises(ValidationError, match="renderable good examples"):
        CatalogDraftUpdate.model_validate(
            {"revision": 1, "status": "approved", "annotation": value}
        )


def test_approval_rejects_incomplete_good_example_even_with_current_review() -> None:
    value = complete_annotation()
    value["caption_guidance"] = {
        "pattern": "Setup then reaction",
        "good_examples": [{}],
        "bad_examples": [{"top_caption": "An unfunny explanation"}],
    }
    value["visual_qa"] = visual_qa(value)
    with pytest.raises(ValidationError, match="renderable good examples"):
        CatalogDraftUpdate.model_validate(
            {"revision": 1, "status": "approved", "annotation": value}
        )
