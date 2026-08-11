from __future__ import annotations

import pytest
from pydantic import ValidationError

from memedrop_api.catalog_schemas import CatalogDraftUpdate, slugify_template_id


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
