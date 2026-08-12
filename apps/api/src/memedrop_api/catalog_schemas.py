from __future__ import annotations

import re
from typing import Annotated, Literal

from pydantic import AnyHttpUrl, AwareDatetime, Field, StringConstraints, model_validator

from memedrop_api.catalog_visual_qa import render_fingerprint, render_validation_issues
from memedrop_api.schemas import StrictModel

CatalogStatus = Literal["draft", "in_review", "needs_work", "approved", "rejected"]
BoundedText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1)]
TemplateId = Annotated[
    str,
    StringConstraints(
        strip_whitespace=True,
        min_length=1,
        max_length=120,
        pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$",
    ),
]
ShortLabel = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=100)]


class CatalogDraftCreate(StrictModel):
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    template_id: TemplateId | None = None
    base_template_id: TemplateId | None = None
    aliases: list[ShortLabel] = Field(default_factory=list, max_length=20)
    source_image_url: AnyHttpUrl = Field(max_length=2048)


class CatalogFontAnnotation(StrictModel):
    family: Literal["Impact"] = "Impact"
    min_size: int = Field(default=18, ge=10, le=96)
    max_size: int = Field(default=48, ge=10, le=120)
    stroke_ratio: float = Field(default=0.1, ge=0.06, le=0.2)

    @model_validator(mode="after")
    def font_bounds_are_ordered(self) -> CatalogFontAnnotation:
        if self.min_size > self.max_size:
            raise ValueError("font.min_size must not exceed font.max_size")
        return self


class CatalogRegionAnnotation(StrictModel):
    id: Annotated[
        str,
        StringConstraints(
            strip_whitespace=True,
            min_length=1,
            max_length=80,
            pattern=r"^[a-z0-9]+(?:_[a-z0-9]+)*$",
        ),
    ]
    role: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=180)]
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    width: float = Field(ge=0.04, le=1)
    height: float = Field(ge=0.04, le=1)
    align: Literal["left", "center", "right"] = "center"
    valign: Literal["top", "middle", "bottom"] = "middle"
    max_lines: int = Field(ge=1, le=4)
    max_chars: int = Field(ge=8, le=90)
    font: CatalogFontAnnotation = Field(default_factory=CatalogFontAnnotation)
    notes: str | None = Field(default=None, max_length=240)

    @model_validator(mode="after")
    def region_stays_inside_image(self) -> CatalogRegionAnnotation:
        if self.x + self.width > 1.001 or self.y + self.height > 1.001:
            raise ValueError("region must remain inside the image")
        return self


class CatalogCaptionGuidance(StrictModel):
    pattern: str = Field(default="", max_length=500)
    good_examples: list[dict[str, str]] = Field(default_factory=list, max_length=8)
    bad_examples: list[dict[str, str]] = Field(default_factory=list, max_length=8)


class CatalogVisualQA(StrictModel):
    """A human sign-off tied to an immutable render-input fingerprint."""

    status: Literal["passed"]
    render_fingerprint: Annotated[str, StringConstraints(pattern=r"^[a-f0-9]{64}$")]
    reviewed_region_ids: list[
        Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=80)]
    ] = Field(default_factory=list, max_length=8)
    reviewed_example_indexes: list[Annotated[int, Field(ge=0)]] = Field(
        default_factory=list, max_length=8
    )
    reviewed_at: AwareDatetime

    @model_validator(mode="after")
    def review_targets_are_unique(self) -> CatalogVisualQA:
        if len(self.reviewed_region_ids) != len(set(self.reviewed_region_ids)):
            raise ValueError("visual_qa.reviewed_region_ids must be unique")
        if len(self.reviewed_example_indexes) != len(set(self.reviewed_example_indexes)):
            raise ValueError("visual_qa.reviewed_example_indexes must be unique")
        return self


class CatalogRetrievalAnnotation(StrictModel):
    version: Literal[1] = 1
    joke_shapes: list[ShortLabel] = Field(default_factory=list, max_length=12)
    positive_hints: list[ShortLabel] = Field(default_factory=list, max_length=24)
    anti_hints: list[ShortLabel] = Field(default_factory=list, max_length=24)


class CatalogEditorialAnnotation(StrictModel):
    description: str = Field(default="", max_length=800)
    use_cases: list[ShortLabel] = Field(default_factory=list, max_length=16)
    anti_use_cases: list[ShortLabel] = Field(default_factory=list, max_length=16)


class CatalogTemplateAnnotation(StrictModel):
    template_id: TemplateId
    name: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    aliases: list[ShortLabel] = Field(default_factory=list, max_length=20)
    source_image: Annotated[
        str,
        StringConstraints(strip_whitespace=True, pattern=r"^/memes/[A-Za-z0-9._/-]+$"),
    ]
    supports_overlay: bool = True
    quality: Literal["draft"] = "draft"
    regions: list[CatalogRegionAnnotation] = Field(default_factory=list, max_length=8)
    caption_guidance: CatalogCaptionGuidance = Field(default_factory=CatalogCaptionGuidance)
    retrieval: CatalogRetrievalAnnotation = Field(default_factory=CatalogRetrievalAnnotation)
    editorial: CatalogEditorialAnnotation = Field(default_factory=CatalogEditorialAnnotation)
    visual_qa: CatalogVisualQA | None = None

    @model_validator(mode="after")
    def region_ids_are_unique(self) -> CatalogTemplateAnnotation:
        region_ids = [region.id for region in self.regions]
        if len(region_ids) != len(set(region_ids)):
            raise ValueError("region ids must be unique")
        region_set = set(region_ids)
        for group_name, examples in (
            ("good_examples", self.caption_guidance.good_examples),
            ("bad_examples", self.caption_guidance.bad_examples),
        ):
            for example in examples:
                unknown = set(example) - region_set
                if unknown:
                    raise ValueError(
                        f"{group_name} contains unknown regions: {', '.join(sorted(unknown))}"
                    )
        return self


class CatalogDraftUpdate(StrictModel):
    revision: int = Field(ge=1)
    status: CatalogStatus
    annotation: CatalogTemplateAnnotation

    @model_validator(mode="after")
    def reviewable_drafts_have_quality_annotations(self) -> CatalogDraftUpdate:
        if self.status not in {"in_review", "approved"}:
            return self
        missing = []
        if not self.annotation.regions:
            missing.append("at least one caption region")
        if not self.annotation.caption_guidance.pattern.strip():
            missing.append("caption guidance")
        if not self.annotation.caption_guidance.good_examples:
            missing.append("good caption examples")
        if not self.annotation.caption_guidance.bad_examples:
            missing.append("bad caption examples")
        if not self.annotation.editorial.description.strip():
            missing.append("a visual description")
        if not self.annotation.editorial.use_cases:
            missing.append("use cases")
        if not self.annotation.editorial.anti_use_cases:
            missing.append("anti-use cases")
        if not self.annotation.retrieval.joke_shapes:
            missing.append("joke shapes")
        if not self.annotation.retrieval.positive_hints:
            missing.append("positive retrieval hints")
        if not self.annotation.retrieval.anti_hints:
            missing.append("negative retrieval hints")
        if missing:
            raise ValueError("in-review drafts require " + ", ".join(missing))
        if self.status != "approved":
            return self

        render_inputs = self.annotation.model_dump(mode="json")
        issues = render_validation_issues(render_inputs)
        if issues:
            raise ValueError(
                "approved drafts require renderable good examples: "
                + "; ".join(issue["message"] for issue in issues)
            )
        visual_qa = self.annotation.visual_qa
        if visual_qa is None:
            raise ValueError("approved drafts require current visual QA")
        if visual_qa.render_fingerprint != render_fingerprint(render_inputs):
            raise ValueError("approved drafts require current visual QA")
        expected_region_ids = {region.id for region in self.annotation.regions}
        if set(visual_qa.reviewed_region_ids) != expected_region_ids:
            raise ValueError("approved drafts require every caption region to be visually reviewed")
        expected_example_indexes = set(range(len(self.annotation.caption_guidance.good_examples)))
        if set(visual_qa.reviewed_example_indexes) != expected_example_indexes:
            raise ValueError("approved drafts require every good example to be visually reviewed")
        return self


class CatalogVisualQACheck(StrictModel):
    annotation: CatalogTemplateAnnotation


def slugify_template_id(value: str) -> str:
    normalized = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    if not normalized:
        raise ValueError("name must contain letters or numbers")
    return normalized[:120].rstrip("-")
