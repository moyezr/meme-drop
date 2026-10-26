from __future__ import annotations

import json
from collections import Counter
from pathlib import Path
from typing import Any

import pytest

from memedrop_api.human_evaluation_cases import DEFAULT_CASES_PATH, load_human_evaluation_cases


def _case() -> dict[str, Any]:
    return {
        "id": "fixture-one",
        "group_id": "fixture-group",
        "split": "development",
        "platform": "x",
        "language": "en",
        "provenance": "authored_synthetic",
        "slices": ["everyday"],
        "text": "I bought a planner to schedule the time I spend reorganizing my other planners.",
        "expectation": "reply",
    }


def _write(tmp_path: Path, data: object) -> Path:
    path = tmp_path / "cases.json"
    path.write_text(json.dumps(data), encoding="utf-8")
    return path


def test_packaged_seed_set_has_grouped_holdout_and_repeated_slices() -> None:
    cases = load_human_evaluation_cases()
    assert DEFAULT_CASES_PATH.is_file()
    assert len(cases) == 48
    assert Counter(case.split for case in cases) == {"development": 32, "holdout": 16}
    assert Counter(case.platform for case in cases) == {"x": 24, "linkedin": 24}
    assert Counter(case.expectation for case in cases) == {
        "reply": 30,
        "abstain": 10,
        "context_needed": 8,
    }
    assert all(count == 2 for count in Counter(case.group_id for case in cases).values())
    for split in ("development", "holdout"):
        assert Counter(case.platform for case in cases if case.split == split) == {
            "x": 16 if split == "development" else 8,
            "linkedin": 16 if split == "development" else 8,
        }
    slice_groups: dict[str, set[str]] = {}
    for case in cases:
        assert case.provenance == "authored_synthetic"
        for category in case.slices:
            slice_groups.setdefault(category, set()).add(case.group_id)
    assert all(len(groups) >= 2 for groups in slice_groups.values())
    assert sum(len(case.text) < 40 for case in cases) >= 6
    assert sum(len(case.text) > 2_000 for case in cases) >= 6


@pytest.mark.parametrize(
    "data",
    [
        {"version": True, "cases": [_case()]},
        {"version": 2, "cases": [_case()]},
        {"version": 1, "cases": []},
        {"version": 1, "cases": [_case()], "source_posts": "must-not-be-retained"},
    ],
)
def test_corpus_rejects_unknown_fields_or_invalid_version(tmp_path: Path, data: object) -> None:
    with pytest.raises(ValueError, match="requires version 1"):
        load_human_evaluation_cases(_write(tmp_path, data))


@pytest.mark.parametrize(
    ("field", "value"),
    [
        ("id", "not a bounded identifier"),
        ("group_id", ""),
        ("platform", "reddit"),
        ("split", "training"),
        ("language", "und"),
        ("provenance", "customer_post"),
        ("expectation", "guaranteed_funny"),
        ("text", "  "),
        ("text", "x" * 20_001),
        ("text", 123),
        ("slices", ["arbitrary-free-text"]),
        ("slices", ["work", "work"]),
        ("slices", [None]),
        ("slices", []),
    ],
)
def test_case_metadata_is_strict(tmp_path: Path, field: str, value: object) -> None:
    case = _case()
    case[field] = value
    with pytest.raises(ValueError):
        load_human_evaluation_cases(_write(tmp_path, {"version": 1, "cases": [case]}))


def test_case_rejects_extra_fields_without_echoing_them(tmp_path: Path) -> None:
    case = _case()
    case["source_url"] = "DO_NOT_ECHO_PRIVATE_INPUT"
    with pytest.raises(ValueError) as raised:
        load_human_evaluation_cases(_write(tmp_path, {"version": 1, "cases": [case]}))
    assert "DO_NOT_ECHO_PRIVATE_INPUT" not in str(raised.value)


@pytest.mark.parametrize("slices", [["short"], ["long"], ["no_fit"], ["missing_context"]])
def test_declared_slices_must_match_input_shape(tmp_path: Path, slices: list[str]) -> None:
    case = _case()
    case["slices"] = slices
    with pytest.raises(ValueError):
        load_human_evaluation_cases(_write(tmp_path, {"version": 1, "cases": [case]}))


def test_abstain_case_requires_explicit_no_fit_slice(tmp_path: Path) -> None:
    case = _case()
    case["expectation"] = "abstain"
    with pytest.raises(ValueError, match="No-fit"):
        load_human_evaluation_cases(_write(tmp_path, {"version": 1, "cases": [case]}))


@pytest.mark.parametrize("duplicate", ["id", "text"])
def test_duplicate_ids_and_normalized_text_are_rejected(tmp_path: Path, duplicate: str) -> None:
    first = _case()
    second = {**first, "id": "fixture-two", "text": "An unrelated but original second fixture."}
    second[duplicate] = first[duplicate]
    if duplicate == "text":
        second["text"] = "  " + str(first["text"]).upper().replace(" ", "  ")
    with pytest.raises(ValueError, match="unique|duplicated"):
        load_human_evaluation_cases(_write(tmp_path, {"version": 1, "cases": [first, second]}))


def test_group_cannot_cross_holdout_boundary(tmp_path: Path) -> None:
    first = _case()
    second = {
        **first,
        "id": "fixture-two",
        "split": "holdout",
        "text": "The community greenhouse has grown its first unexpectedly enormous tomato.",
    }
    with pytest.raises(ValueError, match="same split"):
        load_human_evaluation_cases(_write(tmp_path, {"version": 1, "cases": [first, second]}))


def test_renaming_a_related_case_does_not_bypass_near_duplicate_check(tmp_path: Path) -> None:
    first = _case()
    second = {
        **first,
        "id": "fixture-two",
        "group_id": "different-group",
        "split": "holdout",
        "text": str(first["text"]) + " Again.",
    }
    with pytest.raises(ValueError, match="Near-duplicate"):
        load_human_evaluation_cases(_write(tmp_path, {"version": 1, "cases": [first, second]}))
