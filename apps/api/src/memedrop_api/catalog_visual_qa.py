"""Deterministic render-review checks for catalog drafts.

The catalog workbench calls this module before a human signs off a template.
Keeping the fingerprint server-owned prevents a client implementation from
silently drifting from the promotion gate.
"""

from __future__ import annotations

import json
import re
from collections.abc import Mapping
from hashlib import sha256
from typing import Any


def render_fingerprint(annotation: Mapping[str, Any]) -> str:
    """Return a stable identity for all annotation values that affect rendering."""

    caption_guidance = annotation.get("caption_guidance")
    guidance = caption_guidance if isinstance(caption_guidance, Mapping) else {}
    payload = {
        "template_id": annotation.get("template_id"),
        "source_image": annotation.get("source_image"),
        "supports_overlay": annotation.get("supports_overlay"),
        "regions": annotation.get("regions", []),
        "good_examples": guidance.get("good_examples", []),
    }
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return sha256(encoded).hexdigest()


def render_validation_issues(annotation: Mapping[str, Any]) -> list[dict[str, str]]:
    """Return deterministic, renderer-independent problems visible before approval.

    These checks deliberately cover only structural and bounded-text failures. A
    human still judges composition, punchline, and visual readability in the
    workbench before recording visual QA.
    """

    regions_value = annotation.get("regions")
    regions = regions_value if isinstance(regions_value, list) else []
    if not regions:
        return [
            {
                "code": "missing_regions",
                "message": "Add at least one caption region before visual review.",
            }
        ]
    allowed: dict[str, Mapping[str, Any]] = {
        str(region.get("id")): region
        for region in regions
        if isinstance(region, Mapping) and isinstance(region.get("id"), str)
    }
    guidance_value = annotation.get("caption_guidance")
    guidance = guidance_value if isinstance(guidance_value, Mapping) else {}
    examples_value = guidance.get("good_examples")
    examples = examples_value if isinstance(examples_value, list) else []
    issues: list[dict[str, str]] = []
    if not examples:
        issues.append(
            {
                "code": "missing_good_examples",
                "message": "Add a complete good caption example before visual review.",
            }
        )
        return issues

    required_region_ids = set(allowed)
    for example_index, example in enumerate(examples):
        if not isinstance(example, Mapping):
            issues.append(
                {
                    "code": "invalid_good_example",
                    "message": f"Good example {example_index + 1} is not a caption map.",
                }
            )
            continue
        keys = {str(key) for key in example}
        missing = required_region_ids - keys
        if missing:
            issues.append(
                {
                    "code": "missing_region_caption",
                    "message": (
                        f"Good example {example_index + 1} is missing captions for: "
                        f"{', '.join(sorted(missing))}."
                    ),
                }
            )
        for region_id in sorted(required_region_ids & keys):
            value = example.get(region_id)
            text = str(value) if isinstance(value, str) else ""
            if not text.strip():
                issues.append(
                    {
                        "code": "blank_caption",
                        "message": (
                            f"Good example {example_index + 1}, {region_id}, has a blank caption."
                        ),
                    }
                )
                continue
            region = allowed[region_id]
            normalized = re.sub(r"\s+", " ", text).strip()
            max_chars = region.get("max_chars")
            if isinstance(max_chars, int) and len(normalized) > max_chars:
                issues.append(
                    {
                        "code": "caption_too_long",
                        "message": (
                            f"Good example {example_index + 1}, {region_id}, has "
                            f"{len(normalized)} characters; limit is {max_chars}."
                        ),
                    }
                )
            max_lines = region.get("max_lines")
            line_count = len(text.splitlines()) or 1
            if isinstance(max_lines, int) and line_count > max_lines:
                issues.append(
                    {
                        "code": "too_many_explicit_lines",
                        "message": (
                            f"Good example {example_index + 1}, {region_id}, has "
                            f"{line_count} explicit lines; limit is {max_lines}."
                        ),
                    }
                )
    return issues
