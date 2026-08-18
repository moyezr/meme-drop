"""Import machine-generated template drafts into the local human-review catalog.

The importer is intentionally development-only, dry-runs by default, reuses media that is already
in ``meme-drop-dev``, and never updates an existing catalog row. A human save increments the row's
revision, but even untouched rows are protected: replacing machine suggestions is an explicit later
workflow rather than an accidental side effect of rerunning this command.
"""

from __future__ import annotations

import argparse
import asyncio
import json
from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path
from typing import Any, TypedDict

from pydantic import ValidationError
from sqlalchemy import select

from memedrop_api.catalog_schemas import CatalogTemplateAnnotation
from memedrop_api.config import DEVELOPMENT_BUCKET, Settings
from memedrop_api.db import CatalogDraft, Database


class ImportSummary(TypedDict):
    manifest: str
    templates: int
    would_insert: int
    inserted: int
    unchanged: int
    protected_existing: int
    semantic_models: dict[str, int]
    write: bool


@dataclass(frozen=True)
class ImportCandidate:
    template_id: str
    name: str
    asset_path: str
    source_url: str | None
    annotation: dict[str, Any]


def repository_root() -> Path:
    return Path(__file__).resolve().parents[4]


def default_manifest_path() -> Path:
    return repository_root() / ".memedrop" / "template-pipeline" / "manifest.json"


def load_import_candidates(manifest_path: Path) -> list[ImportCandidate]:
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except FileNotFoundError as error:
        raise ValueError(f"Template manifest does not exist: {manifest_path}") from error
    except json.JSONDecodeError as error:
        raise ValueError(f"Template manifest is not valid JSON: {error}") from error
    if not isinstance(manifest, dict) or manifest.get("version") != 2:
        raise ValueError("Template import requires a version 2 pipeline manifest.")
    templates = manifest.get("templates")
    if not isinstance(templates, list):
        raise ValueError("Template manifest must contain a templates array.")

    candidates: list[ImportCandidate] = []
    seen_ids: set[str] = set()
    seen_hashes: set[str] = set()
    for index, value in enumerate(templates):
        if not isinstance(value, dict):
            raise ValueError(f"Template {index + 1} must be an object.")
        candidate = import_candidate(value, index=index)
        if candidate.template_id in seen_ids:
            raise ValueError(f"Duplicate template_id in manifest: {candidate.template_id}")
        content_hash = str(candidate.annotation["machine_provenance"]["source_content_sha256"])
        if content_hash in seen_hashes:
            raise ValueError(f"Duplicate source content in manifest: {content_hash}")
        seen_ids.add(candidate.template_id)
        seen_hashes.add(content_hash)
        candidates.append(candidate)
    return candidates


def import_candidate(value: Mapping[str, Any], *, index: int = 0) -> ImportCandidate:
    template_id = required_string(value, "template_id", index)
    if value.get("quality") != "draft":
        raise ValueError(f"Template {template_id} is not a draft.")
    annotation_meta = required_mapping(value, "annotation_meta", template_id)
    if annotation_meta.get("requires_human_review") is not True:
        raise ValueError(f"Template {template_id} does not require human review.")
    source = required_mapping(value, "source", template_id)
    editorial = required_mapping(value, "editorial", template_id)
    source_image = required_string(value, "source_image", index)
    if not source_image.startswith("/memes/catalog/scraped/imgflip/"):
        raise ValueError(f"Template {template_id} does not reference pipeline media.")

    raw_annotation = {
        "template_id": template_id,
        "name": required_string(value, "name", index),
        "aliases": value.get("aliases", []),
        "source_image": source_image,
        "supports_overlay": value.get("supports_overlay", True),
        "quality": "draft",
        "regions": value.get("regions", []),
        "caption_guidance": value.get("caption_guidance", {}),
        "retrieval": value.get("retrieval", {}),
        "editorial": {
            "description": editorial.get("description", ""),
            "canonical_meaning": editorial.get("canonical_meaning", ""),
            "use_cases": editorial.get("use_cases", []),
            "anti_use_cases": editorial.get("anti_use_cases", []),
            "tone_tags": editorial.get("tone_tags", []),
            "trend_notes": editorial.get("trend_notes", []),
            "freshness": editorial.get("freshness", "unknown"),
        },
        "safety": value.get("safety", {}),
        "machine_provenance": {
            "status": annotation_meta.get("status"),
            "requires_human_review": annotation_meta.get("requires_human_review"),
            "semantic_model": annotation_meta.get("semantic_model"),
            "vision_model": annotation_meta.get("vision_model"),
            "geometry_source": annotation_meta.get("geometry_source"),
            "prompt_version": annotation_meta.get("prompt_version"),
            "input_sha256": annotation_meta.get("input_sha256"),
            "generated_at": annotation_meta.get("generated_at"),
            "source_provider": source.get("provider"),
            "source_id": source.get("source_id"),
            "source_content_sha256": source.get("content_sha256"),
        },
        "visual_qa": None,
    }
    try:
        annotation = CatalogTemplateAnnotation.model_validate(raw_annotation).model_dump(
            mode="json"
        )
    except ValidationError as error:
        raise ValueError(f"Template {template_id} cannot enter the workbench: {error}") from error
    source_url_value = source.get("source_url")
    source_url = source_url_value if isinstance(source_url_value, str) else None
    return ImportCandidate(
        template_id=template_id,
        name=str(annotation["name"]),
        asset_path=source_image,
        source_url=source_url,
        annotation=annotation,
    )


def candidate_matches_existing(candidate: ImportCandidate, existing: CatalogDraft) -> bool:
    try:
        annotation = CatalogTemplateAnnotation.model_validate(existing.annotation).model_dump(
            mode="json"
        )
    except ValidationError:
        return False
    return (
        existing.asset_path == candidate.asset_path
        and existing.source_url == candidate.source_url
        and annotation == candidate.annotation
    )


def validate_import_environment(settings: Settings) -> None:
    if settings.is_production:
        raise ValueError("Catalog manifest import is disabled in production.")
    if settings.storage_backend != "s3" or settings.s3_bucket_name != DEVELOPMENT_BUCKET:
        raise ValueError(
            "Catalog manifest import requires MEMEDROP_STORAGE_BACKEND=s3 and "
            f"S3_BUCKET_NAME={DEVELOPMENT_BUCKET}."
        )


async def import_catalog_manifest(
    settings: Settings, manifest_path: Path, *, write: bool
) -> ImportSummary:
    validate_import_environment(settings)
    candidates = load_import_candidates(manifest_path)
    database = Database(settings.database_url)
    try:
        async with database.session() as session, session.begin():
            existing_rows = list(
                await session.scalars(
                    select(CatalogDraft).where(
                        CatalogDraft.template_id.in_(
                            [candidate.template_id for candidate in candidates]
                        )
                    )
                )
            )
            existing_by_id = {row.template_id: row for row in existing_rows}
            new_candidates: list[ImportCandidate] = []
            unchanged = 0
            protected = 0
            for candidate in candidates:
                existing = existing_by_id.get(candidate.template_id)
                if existing is None:
                    new_candidates.append(candidate)
                elif candidate_matches_existing(candidate, existing):
                    unchanged += 1
                else:
                    protected += 1
            if write:
                session.add_all(
                    [
                        CatalogDraft(
                            template_id=candidate.template_id,
                            name=candidate.name,
                            status="draft",
                            asset_path=candidate.asset_path,
                            thumbnail_path=None,
                            source_url=candidate.source_url,
                            annotation=candidate.annotation,
                            revision=1,
                        )
                        for candidate in new_candidates
                    ]
                )
                await session.flush()
    finally:
        await database.close()

    models = Counter(
        str(candidate.annotation["machine_provenance"]["semantic_model"])
        for candidate in candidates
    )
    return {
        "manifest": str(manifest_path),
        "templates": len(candidates),
        "would_insert": len(new_candidates),
        "inserted": len(new_candidates) if write else 0,
        "unchanged": unchanged,
        "protected_existing": protected,
        "semantic_models": dict(sorted(models.items())),
        "write": write,
    }


def required_mapping(
    value: Mapping[str, Any], field: str, template: str
) -> Mapping[str, Any]:
    result = value.get(field)
    if not isinstance(result, dict):
        raise ValueError(f"Template {template} requires {field} metadata.")
    return result


def required_string(value: Mapping[str, Any], field: str, index: int) -> str:
    result = value.get(field)
    if not isinstance(result, str) or not result.strip():
        raise ValueError(f"Template {index + 1} requires a non-empty {field}.")
    return result.strip()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Import machine drafts into the local human-review catalog."
    )
    parser.add_argument("--manifest", type=Path, default=default_manifest_path())
    parser.add_argument(
        "--write",
        action="store_true",
        help="Insert missing drafts. Without this flag the command is a read-only dry run.",
    )
    arguments = parser.parse_args()
    try:
        summary = asyncio.run(
            import_catalog_manifest(Settings(), arguments.manifest, write=arguments.write)  # type: ignore[call-arg]
        )
    except (OSError, ValueError) as error:
        parser.exit(1, f"[MemeDrop] catalog import failed: {error}\n")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
