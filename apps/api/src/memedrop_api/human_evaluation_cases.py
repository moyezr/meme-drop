"""Authored synthetic seed cases for human review, separate from ranking gates.

The expectations are review prompts, not human-verified gold labels. Related
variants share a group and split; a holdout must not be used to tune a candidate.
This loader validates structure, not whether a new source is safe to retain.
The review workflow accepts only the packaged corpus, never user-supplied posts.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, cast

DEFAULT_CASES_PATH = Path(__file__).parent / "data" / "human_evaluation_cases.json"
CaseSplit = Literal["development", "holdout"]
CasePlatform = Literal["x", "linkedin"]
CaseExpectation = Literal["reply", "abstain", "context_needed"]
SLICES = frozenset(
    {
        "short",
        "long",
        "ambiguous",
        "missing_context",
        "no_fit",
        "work",
        "everyday",
        "self_deprecating",
        "celebratory",
        "disagreement",
        "sensitive",
        "quoted_context",
    }
)
_CASE_FIELDS = frozenset(
    {
        "id",
        "group_id",
        "split",
        "platform",
        "language",
        "provenance",
        "slices",
        "text",
        "expectation",
    }
)
_IDENTIFIER = re.compile(r"[a-z][a-z0-9-]{2,79}\Z")


@dataclass(frozen=True)
class HumanEvaluationCase:
    id: str
    group_id: str
    split: CaseSplit
    platform: CasePlatform
    language: str
    provenance: str
    slices: tuple[str, ...]
    text: str
    expectation: CaseExpectation


def load_human_evaluation_cases(path: Path = DEFAULT_CASES_PATH) -> list[HumanEvaluationCase]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if (
        not isinstance(data, dict)
        or set(data) != {"version", "cases"}
        or type(data["version"]) is not int
        or data["version"] != 1
        or not isinstance(data["cases"], list)
        or not data["cases"]
    ):
        raise ValueError("Human evaluation corpus requires version 1 and a nonempty cases array.")
    cases: list[HumanEvaluationCase] = []
    identifiers: set[str] = set()
    texts: set[str] = set()
    group_splits: dict[str, CaseSplit] = {}
    for raw in data["cases"]:
        if not isinstance(raw, dict) or set(raw) != _CASE_FIELDS:
            raise ValueError("Human evaluation case fields do not match the schema.")
        for field in _CASE_FIELDS - {"slices"}:
            if not isinstance(raw[field], str):
                raise ValueError("Human evaluation case string fields must be strings.")
        if not _IDENTIFIER.fullmatch(raw["id"]) or not _IDENTIFIER.fullmatch(raw["group_id"]):
            raise ValueError("Human evaluation case and group identifiers must be bounded slugs.")
        if raw["id"] in identifiers:
            raise ValueError("Human evaluation case identifiers must be unique.")
        identifiers.add(raw["id"])
        if raw["split"] not in {"development", "holdout"}:
            raise ValueError("Human evaluation case split is invalid.")
        if raw["platform"] not in {"x", "linkedin"}:
            raise ValueError("Human evaluation case platform is invalid.")
        if raw["language"] != "en" or raw["provenance"] != "authored_synthetic":
            raise ValueError("Human evaluation cases require English synthetic provenance.")
        if raw["expectation"] not in {"reply", "abstain", "context_needed"}:
            raise ValueError("Human evaluation case expectation is invalid.")
        slices = raw["slices"]
        if (
            not isinstance(slices, list)
            or not slices
            or any(not isinstance(value, str) or value not in SLICES for value in slices)
            or len(slices) != len(set(slices))
        ):
            raise ValueError("Human evaluation case slices must be unique reviewed categories.")
        text = raw["text"]
        if not text.strip() or len(text) > 20_000:
            raise ValueError("Human evaluation case text must contain 1 to 20000 characters.")
        if "short" in slices and len(text) >= 40:
            raise ValueError("Short human evaluation cases must contain fewer than 40 characters.")
        if "long" in slices and len(text) <= 2_000:
            raise ValueError("Long human evaluation cases must contain more than 2000 characters.")
        if ("no_fit" in slices) != (raw["expectation"] == "abstain"):
            raise ValueError("No-fit human evaluation cases must have an abstain review target.")
        if "missing_context" in slices and raw["expectation"] != "context_needed":
            raise ValueError("Missing-context cases must have a context-needed review target.")
        normalized = " ".join(text.casefold().split())
        if normalized in texts:
            raise ValueError("Human evaluation case text must not be duplicated.")
        texts.add(normalized)
        split = cast(CaseSplit, raw["split"])
        previous_split = group_splits.setdefault(raw["group_id"], split)
        if previous_split != split:
            raise ValueError("Related human evaluation cases must remain in the same split.")
        cases.append(
            HumanEvaluationCase(
                id=raw["id"],
                group_id=raw["group_id"],
                split=split,
                platform=cast(CasePlatform, raw["platform"]),
                language=raw["language"],
                provenance=raw["provenance"],
                slices=tuple(slices),
                text=text,
                expectation=cast(CaseExpectation, raw["expectation"]),
            )
        )
    _reject_cross_split_near_duplicates(cases)
    return cases


def _reject_cross_split_near_duplicates(cases: list[HumanEvaluationCase]) -> None:
    tokens = [set(re.findall(r"\w+", case.text.casefold())) for case in cases]
    for index, case in enumerate(cases):
        for other_index in range(index):
            if case.split == cases[other_index].split:
                continue
            left, right = tokens[index], tokens[other_index]
            if min(len(left), len(right)) >= 5 and len(left & right) / len(left | right) >= 0.85:
                raise ValueError("Near-duplicate evaluation cases cross the holdout boundary.")
