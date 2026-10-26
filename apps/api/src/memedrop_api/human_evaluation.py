"""Local human review of the packaged synthetic corpus, never customer input.

The review HTML contains authored synthetic contexts and generated captions. The
companion manifest, score exports, summaries and stdout contain only allowlisted
identifiers, categorical outcomes and numbers. This is not a promotion gate.
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import json
import os
import re
import statistics
import time
from collections import Counter
from collections.abc import Sequence
from io import BytesIO
from pathlib import Path
from typing import Annotated, Any, Literal, Never, cast
from uuid import UUID, uuid4

from PIL import Image
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource

from memedrop_api.config import Settings
from memedrop_api.human_evaluation_cases import DEFAULT_CASES_PATH, load_human_evaluation_cases
from memedrop_api.repositories import BackendStore
from memedrop_api.services.catalog import DEFAULT_CATALOG_PATH, MemeCatalog
from memedrop_api.services.openrouter import OpenRouterSuggestionGateway
from memedrop_api.services.suggestion_engine import SuggestionService
from memedrop_api.suggestion_evaluation import percentile, repository_root

DIMENSIONS = ("post_fit", "comic_turn", "template_fit", "caption_readability")
Rating = Annotated[int, Field(strict=True, ge=1, le=5)]
Identifier = Annotated[str, Field(strict=True, pattern=r"^[a-z][a-z0-9-]{0,79}$")]
Digest = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]
JointOutcome = Literal["model", "timeout", "fallback", "cache", "error"]


class _EvaluationSettings(Settings):
    """Validate normal settings without loading unrelated deployment credentials."""

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return (init_settings,)


def _evaluation_settings(*, live_provider: bool, model: str | None = None) -> Settings:
    key = os.environ.get("OPENROUTER_API_KEY") if live_provider else None
    if live_provider and not key:
        raise ValueError("Explicit live capture requires OPENROUTER_API_KEY in the environment.")
    return _EvaluationSettings(  # type: ignore[call-arg]
        _env_file=None,
        database_url="postgresql://evaluation",
        node_env="development",
        openrouter_api_key=key,
        openrouter_suggestion_model=model
        or os.environ.get("OPENROUTER_SUGGESTION_MODEL", "openai/gpt-6-luna"),
        openrouter_site_url=os.environ.get("OPENROUTER_SITE_URL", "http://localhost:3001"),
        openrouter_app_name=os.environ.get("OPENROUTER_APP_NAME", "MemeDrop"),
        trends_enabled=False,
        storage_backend="local",
        use_draft_templates=False,
    )


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", hide_input_in_errors=True)


class ManifestSuggestion(StrictModel):
    template_id: Identifier
    position: Annotated[int, Field(strict=True, ge=1, le=5)]
    media_available: bool


class ManifestCase(StrictModel):
    case_id: Identifier
    status: Literal["ok", "error"]
    service_ms: Annotated[float, Field(ge=0, le=120_000)]
    joint_outcome: JointOutcome = "fallback"
    suggestions: list[ManifestSuggestion] = Field(max_length=5)


class ReviewManifest(StrictModel):
    version: Literal[1] = 1
    run_id: UUID
    variant: Identifier
    mode: Literal["fallback", "live_model"]
    corpus_digest: Digest
    catalog_digest: Digest
    pipeline_digest: Digest
    model: Annotated[str, Field(pattern=r"^[a-zA-Z0-9][a-zA-Z0-9./:_-]{0,119}$")]
    measurement: Literal["service_only_no_database_or_trends"] = (
        "service_only_no_database_or_trends"
    )
    cases: list[ManifestCase] = Field(min_length=1, max_length=48)


class SuggestionScore(StrictModel):
    template_id: Identifier
    position: Annotated[int, Field(strict=True, ge=1, le=5)]
    render_status: Literal["pending", "ready", "failed"] = "pending"
    post_fit: Rating | None = None
    comic_turn: Rating | None = None
    template_fit: Rating | None = None
    caption_readability: Rating | None = None
    would_use: Annotated[bool, Field(strict=True)] | None = None


class CaseScore(StrictModel):
    case_id: Identifier
    judgment: Literal["reply", "abstain", "context_needed"] | None = None
    suggestions: list[SuggestionScore] = Field(max_length=5)


class ReviewScores(StrictModel):
    version: Literal[1] = 1
    run_id: UUID
    variant: Identifier
    corpus_digest: Digest
    cases: list[CaseScore] = Field(max_length=48)


class _CatalogStore:
    """Only the two reads used by SuggestionService; no database or user feedback."""

    def __init__(self, catalog: MemeCatalog) -> None:
        self.rows = [
            {
                "id": template.template_id,
                "name": template.name,
                "filePath": f"/memes/{template.template_id}",
                "systemTags": {},
            }
            for template in catalog.verified_templates
        ]

    async def list_global_memes(self) -> list[dict[str, Any]]:
        return self.rows

    async def global_meme_feedback_scores(self, user_id: UUID) -> dict[str, float]:
        return {}


def corpus_digest() -> str:
    return hashlib.sha256(DEFAULT_CASES_PATH.read_bytes()).hexdigest()


def pipeline_digest() -> str:
    directory = Path(__file__).parent
    paths = [directory / "config.py"] + [
        directory / "services" / name
        for name in ("suggestion_engine.py", "openrouter.py", "context_analyzer.py", "meme_text.py")
    ]
    return hashlib.sha256(b"".join(path.read_bytes() for path in paths)).hexdigest()


def _catalog_media(template_id: str, catalog: MemeCatalog, media_dir: Path) -> str | None:
    template = next(t for t in catalog.verified_templates if t.template_id == template_id)
    candidates = []
    if template.source_image and template.source_image.startswith("/memes/"):
        candidates.append(media_dir / template.source_image.removeprefix("/memes/"))
    for directory in (media_dir, media_dir / "catalog"):
        candidates.extend(sorted(directory.glob(f"seed-{template_id}.*")))
        candidates.extend(sorted(directory.glob(f"seed-{template_id}-*.*")))
    root = media_dir.resolve()
    for source in candidates:
        if not source.is_file() or not source.resolve().is_relative_to(root):
            continue
        if source.stat().st_size > 20 * 1024 * 1024:
            continue
        try:
            with Image.open(source) as image:
                if image.width * image.height > 16_000_000 or max(image.size) > 4096:
                    continue
                if image.format not in {"JPEG", "PNG", "WEBP"}:
                    continue
                # Drop source metadata; only reviewed catalog art enters the packet.
                output = BytesIO()
                image.convert("RGB").save(output, format="PNG")
                return "data:image/png;base64," + base64.b64encode(output.getvalue()).decode()
        except (OSError, ValueError, Image.DecompressionBombError):
            continue
    return None


async def capture_review(
    service: SuggestionService,
    *,
    catalog: MemeCatalog,
    media_dir: Path,
    split: str = "development",
    case_ids: Sequence[str] = (),
    variant: str = "baseline",
    mode: Literal["fallback", "live_model"] = "fallback",
) -> tuple[ReviewManifest, list[dict[str, Any]]]:
    """Capture only canonical authored cases; caller cannot supply post text."""
    cases = [case for case in load_human_evaluation_cases() if case.split == split]
    if case_ids:
        wanted = set(case_ids)
        cases = [case for case in cases if case.id in wanted]
        if wanted != {case.id for case in cases}:
            raise ValueError("Requested case IDs must belong to the selected corpus split.")
    if not cases:
        raise ValueError("Select at least one canonical synthetic case.")
    run_id = uuid4()
    manifest_cases = []
    page_cases = []
    media: dict[str, str | None] = {}
    allowed_templates = {template.template_id for template in catalog.verified_templates}
    for case in cases:
        started = time.perf_counter()
        status: Literal["ok", "error"] = "ok"
        joint_outcome: JointOutcome = "error"
        try:
            run = await service.get_suggestion_run(case.text, user_id=run_id, limit=5, refresh=True)
            suggestions = run.suggestions
            joint_outcome = cast(JointOutcome, run.timing.joint_outcome)
        except Exception:
            # Exception strings may contain provider payloads; never retain them.
            suggestions = []
            status = "error"
        elapsed = round((time.perf_counter() - started) * 1000, 1)
        manifest_suggestions = []
        page_suggestions = []
        for position, suggestion in enumerate(suggestions[:5], 1):
            template_id = str(suggestion.get("meme_id", ""))
            if template_id not in allowed_templates:
                raise ValueError("Review service returned an unknown or unverified template.")
            if template_id not in media:
                media[template_id] = _catalog_media(template_id, catalog, media_dir)
            source = media[template_id]
            manifest_suggestions.append(
                ManifestSuggestion(
                    template_id=template_id, position=position, media_available=source is not None
                )
            )
            page_suggestions.append(
                {
                    "template_id": template_id,
                    "position": position,
                    "image": source,
                    "overlay": suggestion.get("tailored_overlay"),
                }
            )
        manifest_cases.append(
            ManifestCase(
                case_id=case.id,
                status=status,
                service_ms=elapsed,
                joint_outcome=joint_outcome,
                suggestions=manifest_suggestions,
            )
        )
        page_cases.append(
            {
                "case_id": case.id,
                "platform": case.platform,
                "text": case.text,
                "status": status,
                "suggestions": page_suggestions,
            }
        )
    return ReviewManifest(
        run_id=run_id,
        variant=variant,
        mode=mode,
        corpus_digest=corpus_digest(),
        catalog_digest=hashlib.sha256(DEFAULT_CATALOG_PATH.read_bytes()).hexdigest(),
        pipeline_digest=pipeline_digest(),
        model=service.settings.openrouter_suggestion_model if mode == "live_model" else "disabled",
        cases=manifest_cases,
    ), page_cases


def build_review_html(manifest: ReviewManifest, cases: list[dict[str, Any]]) -> str:
    root = repository_root()
    renderer = root / "packages/shared/dist/overlay-renderer.js"
    if not renderer.is_file():
        raise ValueError("Build the shared renderer first: npm run build:shared")
    fonts = []
    for family, weights in (("anton", (400,)), ("inter", (400, 700, 900))):
        for weight in weights:
            path = (
                root
                / f"node_modules/@fontsource/{family}/files/{family}-latin-{weight}-normal.woff2"
            )
            if not path.is_file():
                raise ValueError(
                    "Install the locked workspace dependencies before building review."
                )
            data = base64.b64encode(path.read_bytes()).decode()
            fonts.append(
                f"@font-face{{font-family:{family.title()};font-weight:{weight};"
                f"src:url(data:font/woff2;base64,{data}) format('woff2');}}"
            )
    # Repeated templates share one embedded source instead of multiplying image bytes.
    images = {
        suggestion["template_id"]: suggestion["image"]
        for case in cases
        for suggestion in case["suggestions"]
    }
    page_cases = [
        {
            **case,
            "suggestions": [
                {key: value for key, value in suggestion.items() if key != "image"}
                for suggestion in case["suggestions"]
            ],
        }
        for case in cases
    ]
    payload = json.dumps(
        {
            "manifest": manifest.model_dump(mode="json"),
            "cases": page_cases,
            "images": images,
            "dimensions": list(DIMENSIONS),
        },
        ensure_ascii=False,
    ).replace("<", "\\u003c")
    template = (Path(__file__).parent / "data/human_review.html").read_text()
    return (
        template.replace("__FONTS__", "\n".join(fonts))
        .replace("__RENDERER__", renderer.read_text().replace("</script", "<\\/script"))
        .replace("__PAYLOAD__", payload)
    )


def validate_scores(manifest: ReviewManifest, scores: ReviewScores) -> None:
    if manifest.corpus_digest != corpus_digest():
        raise ValueError("Manifest belongs to a different corpus revision.")
    if (scores.run_id, scores.variant, scores.corpus_digest) != (
        manifest.run_id,
        manifest.variant,
        manifest.corpus_digest,
    ):
        raise ValueError("Scores do not belong to this review manifest.")
    known = {case.id for case in load_human_evaluation_cases()}
    expected = {case.case_id: case for case in manifest.cases}
    if len(expected) != len(manifest.cases) or not set(expected) <= known:
        raise ValueError("Manifest has duplicate or unknown synthetic cases.")
    templates = {
        template.template_id
        for template in MemeCatalog.load(DEFAULT_CATALOG_PATH).verified_templates
    }
    for row in manifest.cases:
        if any(s.template_id not in templates for s in row.suggestions):
            raise ValueError("Manifest contains an unknown or unverified template.")
        if [s.position for s in row.suggestions] != list(range(1, len(row.suggestions) + 1)):
            raise ValueError("Manifest positions must match the captured suggestion order.")
    seen = set()
    for case in scores.cases:
        if case.case_id in seen or case.case_id not in expected:
            raise ValueError("Scores have duplicate or unknown cases.")
        seen.add(case.case_id)
        row = expected[case.case_id]
        allowed = {(s.template_id, s.position): s for s in row.suggestions}
        selected = set()
        for score in case.suggestions:
            key = (score.template_id, score.position)
            if key not in allowed or key in selected:
                raise ValueError("Scores have duplicate or unknown suggestions.")
            selected.add(key)
            rated = any(getattr(score, key) is not None for key in (*DIMENSIONS, "would_use"))
            if rated and (score.render_status != "ready" or not allowed[key].media_available):
                raise ValueError("Suggestions must render successfully before receiving scores.")
        if selected != set(allowed):
            raise ValueError("Include all captured suggestions; leave unreviewed ratings null.")


def summarize_review(manifest: ReviewManifest, scores: ReviewScores) -> dict[str, Any]:
    validate_scores(manifest, scores)
    cases = {case.id: case for case in load_human_evaluation_cases()}
    rows = {case.case_id: case for case in scores.cases}
    all_scores = [s for case in scores.cases for s in case.suggestions]
    rated = [s for s in all_scores if all(getattr(s, key) is not None for key in DIMENSIONS)]
    judgments = [row for row in scores.cases if row.judgment is not None]
    groups = {cases[row.case_id].group_id for row in judgments}
    slices: dict[str, dict[str, Any]] = {}
    for label in sorted({s for case in manifest.cases for s in cases[case.case_id].slices}):
        slice_cases = [case for case in manifest.cases if label in cases[case.case_id].slices]
        completed = [rows[case.case_id] for case in slice_cases if case.case_id in rows]
        values = [
            s.post_fit for row in completed for s in row.suggestions if s.post_fit is not None
        ]
        slices[label] = {
            "cases": len(slice_cases),
            "judged_cases": sum(row.judgment is not None for row in completed),
            "groups": len({cases[case.case_id].group_id for case in slice_cases}),
            "post_fit_ratings": len(values),
            "post_fit_mean": statistics.mean(values) if values else None,
        }
    latencies = [case.service_ms for case in manifest.cases]
    return {
        "version": 1,
        "run_id": str(manifest.run_id),
        "variant": manifest.variant,
        "mode": manifest.mode,
        "model": manifest.model,
        "catalog_digest": manifest.catalog_digest,
        "pipeline_digest": manifest.pipeline_digest,
        "cases": len(manifest.cases),
        "judged_cases": len(judgments),
        "judged_groups": len(groups),
        "unjudged_cases": len(manifest.cases) - len(judgments),
        "expected_suggestions": sum(len(case.suggestions) for case in manifest.cases),
        "fully_rated_suggestions": len(rated),
        "errors": sum(case.status == "error" for case in manifest.cases),
        "empty_results": sum(
            case.status == "ok" and not case.suggestions for case in manifest.cases
        ),
        "generation_outcomes": dict(Counter(case.joint_outcome for case in manifest.cases)),
        "generation_breakdown": {
            outcome: {
                "requests": len(selected),
                "with_suggestions": sum(bool(case.suggestions) for case in selected),
                "empty": sum(case.status == "ok" and not case.suggestions for case in selected),
                "errors": sum(case.status == "error" for case in selected),
            }
            for outcome in sorted({case.joint_outcome for case in manifest.cases})
            for selected in [[case for case in manifest.cases if case.joint_outcome == outcome]]
        },
        "judgments": dict(Counter(row.judgment for row in judgments)),
        "dimensions": {
            key: {"n": len(values), "mean": statistics.mean(values) if values else None}
            for key in DIMENSIONS
            for values in [[getattr(s, key) for s in all_scores if getattr(s, key) is not None]]
        },
        "would_use": {
            "n": sum(s.would_use is not None for s in all_scores),
            "yes": sum(s.would_use is True for s in all_scores),
        },
        "service_ms": {"p50": percentile(latencies, 0.5), "p95": percentile(latencies, 0.95)},
        "slices": slices,
        "interpretation": (
            "Synthetic seed only; related variants are not independent. No automatic promotion."
        ),
    }


def compare_scores(left: ReviewScores, right: ReviewScores) -> dict[str, Any]:
    """Pair case means, not arbitrary suggestion positions across different runs."""
    if left.corpus_digest != right.corpus_digest:
        raise ValueError("Compare only the same corpus revision.")
    left_cases = {case.case_id: case for case in left.cases}
    right_cases = {case.case_id: case for case in right.cases}
    result = {}
    for dimension in DIMENSIONS:
        deltas = []
        for case_id in left_cases.keys() & right_cases.keys():
            a = [getattr(s, dimension) for s in left_cases[case_id].suggestions]
            b = [getattr(s, dimension) for s in right_cases[case_id].suggestions]
            # Partial case reviews would bias a paired comparison.
            if a and b and None not in a and None not in b:
                deltas.append(statistics.mean(b) - statistics.mean(a))
        result[dimension] = {
            "paired_cases": len(deltas),
            "mean_delta_right_minus_left": statistics.mean(deltas) if deltas else None,
            "improved_cases": sum(value > 0 for value in deltas),
            "worse_cases": sum(value < 0 for value in deltas),
        }
    return {
        "dimensions": result,
        "interpretation": "Paired case means; no significance or promotion claim.",
    }


async def _capture(arguments: argparse.Namespace) -> None:
    if arguments.model and not arguments.confirm_live_provider:
        raise ValueError(
            "--model requires --confirm-live-provider; default capture is offline fallback."
        )
    if not re.fullmatch(r"[a-z][a-z0-9-]{0,79}", arguments.variant):
        raise ValueError("Variant must be a short lowercase identifier.")
    root = repository_root()
    output = arguments.out.resolve()
    if not output.is_relative_to((root / ".memedrop").resolve()) or output.suffix != ".html":
        raise ValueError("Write review HTML under the ignored repository .memedrop directory.")
    settings = _evaluation_settings(
        live_provider=arguments.confirm_live_provider, model=arguments.model
    )
    catalog = MemeCatalog.load(DEFAULT_CATALOG_PATH)
    gateway = OpenRouterSuggestionGateway(settings)
    service = SuggestionService(
        cast(BackendStore, _CatalogStore(catalog)), catalog, gateway, settings
    )
    try:
        manifest, cases = await capture_review(
            service,
            catalog=catalog,
            media_dir=arguments.media_dir,
            split=arguments.split,
            case_ids=arguments.case_id,
            variant=arguments.variant,
            mode="live_model" if arguments.confirm_live_provider else "fallback",
        )
    finally:
        await gateway.close()
    html = build_review_html(manifest, cases)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(html, encoding="utf-8")
    output.with_suffix(".manifest.json").write_text(manifest.model_dump_json(indent=2) + "\n")
    print(
        json.dumps(
            {
                "mode": manifest.mode,
                "cases": len(manifest.cases),
                "suggestions": sum(len(c.suggestions) for c in manifest.cases),
                "review_html": str(output),
                "ratings": "Not rated; open the local HTML to score.",
            }
        )
    )


class _SafeArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> Never:
        self.exit(2, "Invalid evaluation arguments; run --help for the supported options.\n")


def main() -> None:
    parser = _SafeArgumentParser(description="Review canonical synthetic cases without user posts")
    commands = parser.add_subparsers(dest="command", required=True)
    capture = commands.add_parser("capture", help="Create an offline synthetic review page")
    capture.add_argument(
        "--out", type=Path, default=repository_root() / ".memedrop/human-review.html"
    )
    capture.add_argument(
        "--media-dir", type=Path, default=repository_root() / "apps/api/data/memes"
    )
    capture.add_argument("--split", choices=["development", "holdout"], default="development")
    capture.add_argument("--case-id", action="append", default=[])
    capture.add_argument("--variant", default="baseline")
    capture.add_argument("--confirm-live-provider", action="store_true")
    capture.add_argument("--model")
    summary = commands.add_parser(
        "summary", help="Validate and summarize content-free score exports"
    )
    summary.add_argument("--manifest", type=Path, required=True)
    summary.add_argument("--scores", type=Path, required=True)
    summary.add_argument("--compare-manifest", type=Path)
    summary.add_argument("--compare", type=Path)
    args = parser.parse_args()
    try:
        if args.command == "capture":
            asyncio.run(_capture(args))
        else:
            manifest = ReviewManifest.model_validate_json(args.manifest.read_text())
            scores = ReviewScores.model_validate_json(args.scores.read_text())
            report = summarize_review(manifest, scores)
            if bool(args.compare) != bool(args.compare_manifest):
                raise ValueError(
                    "Paired comparison requires both --compare and --compare-manifest."
                )
            if args.compare:
                other = ReviewManifest.model_validate_json(args.compare_manifest.read_text())
                other_scores = ReviewScores.model_validate_json(args.compare.read_text())
                validate_scores(other, other_scores)
                report["comparison"] = compare_scores(scores, other_scores)
            print(json.dumps(report, indent=2))
    except ValidationError:
        parser.exit(
            2, "Invalid review data: only the documented IDs, numbers and enums are allowed.\n"
        )
    except (ValueError, OSError):
        parser.exit(
            2, "Review failed: check corpus selection, paths, dependencies and score schema.\n"
        )


if __name__ == "__main__":
    main()
