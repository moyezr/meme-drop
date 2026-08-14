from pathlib import Path

from memedrop_api.services.catalog import (
    DEFAULT_CATALOG_PATH,
    FontSpec,
    MemeCatalog,
    MemeTemplate,
    load_catalog_json,
    normalize_template_name,
)


def test_language_neutral_catalog_loads_all_sources() -> None:
    catalog = MemeCatalog.load()
    raw = load_catalog_json(DEFAULT_CATALOG_PATH)

    assert len(catalog.manifest.templates) == 112
    assert len(catalog.verified_templates) >= 45
    assert raw["sources"] == {"curated": 45, "promoted": 4, "generated": 63}


def test_verified_runtime_catalog_has_reviewed_retrieval_metadata() -> None:
    catalog = MemeCatalog.load()

    assert len(catalog.verified_templates) == 49
    for template in catalog.verified_templates:
        assert template.retrieval.version == 1, template.template_id
        assert template.retrieval.joke_shapes, template.template_id
        assert template.retrieval.positive_hints, template.template_id
        assert template.retrieval.anti_hints, template.template_id


def test_catalog_prefers_verified_templates_and_supports_aliases() -> None:
    catalog = MemeCatalog.load()

    drake = catalog.find_template("Drake")
    assert drake is not None
    assert drake.template_id == "drake-hotline-bling"
    assert drake.quality == "verified"
    assert catalog.find_template("unknown template") is None


def test_catalog_can_load_an_explicit_path() -> None:
    catalog = MemeCatalog.load(Path(DEFAULT_CATALOG_PATH))

    assert catalog.manifest.version == 1


def test_template_name_normalization_handles_punctuation() -> None:
    assert normalize_template_name("They're  The-Same Picture") == "theyre the same picture"


def test_catalog_retrieval_metadata_is_versioned_and_backward_compatible() -> None:
    template = MemeTemplate.model_validate(
        {
            "template_id": "test-template",
            "name": "Test Template",
            "supports_overlay": True,
            "quality": "verified",
            "regions": [],
            "caption_guidance": {"pattern": "test"},
            "retrieval": {
                "version": 1,
                "joke_shapes": ["contrast"],
                "positive_hints": ["choosing a better option"],
                "anti_hints": ["sincere praise"],
            },
        }
    )
    legacy_template = MemeTemplate.model_validate(
        {
            "template_id": "legacy-template",
            "name": "Legacy Template",
            "supports_overlay": True,
            "quality": "verified",
            "regions": [],
            "caption_guidance": {"pattern": "test"},
        }
    )

    assert template.retrieval.version == 1
    assert template.retrieval.joke_shapes == ["contrast"]
    assert legacy_template.retrieval.model_dump() == {
        "version": 1,
        "joke_shapes": [],
        "positive_hints": [],
        "anti_hints": [],
    }


def test_runtime_catalog_normalizes_anton_to_its_available_weight() -> None:
    font = FontSpec.model_validate(
        {
            "family": "Anton",
            "weight": 900,
            "min_size": 18,
            "max_size": 48,
            "stroke_ratio": 0.12,
        }
    )

    assert font.weight == 400
