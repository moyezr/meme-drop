from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

DEFAULT_CATALOG_PATH = Path(__file__).resolve().parents[1] / "data" / "meme_catalog.json"


class FontSpec(BaseModel):
    model_config = ConfigDict(extra="ignore")

    family: Literal["Impact"] = "Impact"
    min_size: int
    max_size: int
    stroke_ratio: float


class TemplateRegion(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    role: str
    x: float
    y: float
    width: float
    height: float
    align: Literal["left", "center", "right"] = "center"
    valign: Literal["top", "middle", "bottom"] = "middle"
    max_lines: int
    max_chars: int
    font: FontSpec


class CaptionGuidance(BaseModel):
    model_config = ConfigDict(extra="ignore")

    pattern: str
    good_examples: list[dict[str, str]] = Field(default_factory=list)
    bad_examples: list[dict[str, str]] = Field(default_factory=list)


class MemeTemplate(BaseModel):
    model_config = ConfigDict(extra="ignore")

    template_id: str
    meme_id: str | None = None
    name: str
    aliases: list[str] = Field(default_factory=list)
    source_image: str | None = None
    supports_overlay: bool
    quality: Literal["verified", "draft", "disabled"]
    regions: list[TemplateRegion]
    caption_guidance: CaptionGuidance


class CatalogManifest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    version: int
    generated_at: str
    templates: list[MemeTemplate]


class MemeCatalog:
    def __init__(self, manifest: CatalogManifest) -> None:
        self.manifest = manifest
        self.verified_templates = [
            template
            for template in manifest.templates
            if template.supports_overlay and template.quality == "verified" and template.regions
        ]
        self.draft_templates = [
            template
            for template in manifest.templates
            if template.supports_overlay and template.quality != "disabled" and template.regions
        ]
        self.promoted_by_meme_id = {
            template.meme_id: template
            for template in self.verified_templates
            if template.meme_id is not None
        }

    @classmethod
    def load(cls, path: Path | None = None) -> MemeCatalog:
        configured = os.environ.get("MEMEDROP_CATALOG_PATH")
        catalog_path = path or (Path(configured) if configured else DEFAULT_CATALOG_PATH)
        manifest = CatalogManifest.model_validate_json(catalog_path.read_text(encoding="utf-8"))
        return cls(manifest)

    def find_template(
        self, name: str, *, meme_id: str | None = None, include_drafts: bool = False
    ) -> MemeTemplate | None:
        verified = find_best_template(name, self.verified_templates)
        if verified is not None:
            return verified
        if meme_id and meme_id in self.promoted_by_meme_id:
            return self.promoted_by_meme_id[meme_id]
        return find_best_template(name, self.draft_templates) if include_drafts else None


def normalize_template_name(name: str) -> str:
    return re.sub(
        r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", name.lower().replace("’", "").replace("'", ""))
    ).strip()


def match_score(left: str, right: str) -> float:
    if not left or not right:
        return 0
    if left == right:
        return 1
    if left in right or right in left:
        return min(len(left), len(right)) / max(len(left), len(right))
    left_tokens = set(left.split())
    right_tokens = set(right.split())
    return len(left_tokens & right_tokens) / max(len(left_tokens), len(right_tokens))


def find_best_template(name: str, templates: list[MemeTemplate]) -> MemeTemplate | None:
    normalized = normalize_template_name(name)
    best: MemeTemplate | None = None
    best_score = 0.0
    for template in templates:
        for candidate in [template.name, *template.aliases, template.template_id]:
            score = match_score(normalized, normalize_template_name(candidate))
            if score > best_score:
                best = template
                best_score = score
    return best if best_score >= 0.82 else None


def load_catalog_json(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))
