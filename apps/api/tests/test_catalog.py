from pathlib import Path

from memedrop_api.services.catalog import (
    DEFAULT_CATALOG_PATH,
    MemeCatalog,
    load_catalog_json,
    normalize_template_name,
)


def test_language_neutral_catalog_loads_all_sources() -> None:
    catalog = MemeCatalog.load()
    raw = load_catalog_json(DEFAULT_CATALOG_PATH)

    assert len(catalog.manifest.templates) == 112
    assert len(catalog.verified_templates) >= 45
    assert raw["sources"] == {"curated": 45, "promoted": 4, "generated": 63}


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
