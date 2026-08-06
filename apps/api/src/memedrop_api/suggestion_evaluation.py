"""Offline evaluation for the deterministic meme-template fallback ranker.

This module deliberately calls ``fallback_template_selections`` from the production
suggestion engine.  It is a retrieval-quality check, not a mock of the ranking
algorithm, and never makes a model or database request.
"""

from __future__ import annotations

import argparse
import json
import math
import time
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from memedrop_api.services.catalog import MemeCatalog, normalize_template_name
from memedrop_api.services.suggestion_engine import (
    Candidate,
    LexicalCandidateIndex,
    fallback_template_selections,
)

TOP_1_FLOOR = 0.70
TOP_3_FLOOR = 0.80
TOP_5_FLOOR = 0.90
REJECTED_TOP_5_CEILING = 0.15
SCALE_CATALOG_SIZE = 5_000
SCALE_WARM_RANKING_P95_CEILING_MS = 50.0
SCALE_QUERIES = (
    "Production is down after the dashboard turned red again.",
    "Should we fix the bug properly or add a feature flag and pretend it was planned?",
    "We renamed the same spreadsheet with macros a modern data platform.",
    "The launch gave every team another button and nobody knows what it does.",
    "Still waiting for the autonomous agent to finish its first task.",
)


@dataclass(frozen=True)
class EvaluationThresholds:
    top_1_floor: float = TOP_1_FLOOR
    top_3_floor: float = TOP_3_FLOOR
    top_5_floor: float = TOP_5_FLOOR
    rejected_top_5_ceiling: float = REJECTED_TOP_5_CEILING


DEFAULT_THRESHOLDS = EvaluationThresholds()


@dataclass(frozen=True)
class CatalogScaleThresholds:
    catalog_size: int = SCALE_CATALOG_SIZE
    warm_ranking_p95_ceiling_ms: float = SCALE_WARM_RANKING_P95_CEILING_MS


DEFAULT_CATALOG_SCALE_THRESHOLDS = CatalogScaleThresholds()


@dataclass(frozen=True)
class CaseResult:
    case_id: str
    category: str
    expected_memes: tuple[str, ...]
    rejected_memes: tuple[str, ...]
    selected_templates: tuple[str, ...]
    acceptable_rank: int | None
    rejected_templates_at_top_5: tuple[str, ...]
    ranking_latency_ms: float


def repository_root() -> Path:
    return Path(__file__).resolve().parents[4]


def default_benchmark_path() -> Path:
    return repository_root() / "tools" / "template-tools" / "evals" / "suggestion-benchmark.json"


def production_candidates(catalog: MemeCatalog | None = None) -> list[Candidate]:
    """Build minimal candidates for the same verified runtime catalog as production."""
    loaded_catalog = catalog or MemeCatalog.load()
    return [
        Candidate(
            meme_id=template.template_id,
            name=template.name,
            image_url="/memes/evaluation-placeholder.png",
            system_tags={},
            is_evergreen=True,
            template=template,
        )
        for template in loaded_catalog.verified_templates
    ]


def evaluate_benchmark(
    benchmark_path: Path, *, candidates: Sequence[Candidate] | None = None
) -> dict[str, object]:
    """Evaluate the production fallback ranker over a benchmark JSON file."""
    raw_benchmark = json.loads(benchmark_path.read_text(encoding="utf-8"))
    raw_cases = raw_benchmark.get("cases")
    if not isinstance(raw_cases, list):
        raise ValueError("Benchmark must contain a cases array.")

    ranking_candidates = list(candidates or production_candidates())
    names_by_id = {
        candidate.template.template_id: normalize_template_name(candidate.name)
        for candidate in ranking_candidates
    }
    results: list[CaseResult] = []
    for raw_case in raw_cases:
        if not isinstance(raw_case, dict):
            raise ValueError("Each benchmark case must be an object.")
        case_id = required_string(raw_case, "id")
        category = required_string(raw_case, "category")
        tweet = required_string(raw_case, "tweet")
        expected = normalized_string_list(raw_case.get("expected_memes"), "expected_memes", case_id)
        rejected = normalized_rejected_names(raw_case.get("rejected_memes"), case_id)

        started = time.perf_counter()
        selections = fallback_template_selections(tweet, ranking_candidates, 5)
        latency_ms = (time.perf_counter() - started) * 1000
        selected = tuple(
            names_by_id[selection.template_id]
            for selection in selections
            if selection.template_id in names_by_id
        )
        acceptable_rank = next(
            (
                index + 1
                for index, template_name in enumerate(selected)
                if any(same_family(template_name, family) for family in expected)
            ),
            None,
        )
        rejected_at_top_5 = tuple(
            template_name
            for template_name in selected[:5]
            if any(same_family(template_name, family) for family in rejected)
        )
        results.append(
            CaseResult(
                case_id=case_id,
                category=category,
                expected_memes=tuple(expected),
                rejected_memes=tuple(rejected),
                selected_templates=selected,
                acceptable_rank=acceptable_rank,
                rejected_templates_at_top_5=rejected_at_top_5,
                ranking_latency_ms=latency_ms,
            )
        )
    report = build_report(results, benchmark_path=benchmark_path)
    catalog_scale = evaluate_catalog_scale(ranking_candidates)
    report["catalog_scale"] = catalog_scale
    report["passed"] = bool(report["passed"]) and bool(catalog_scale["passed"])
    return report


def build_scale_candidates(
    candidates: Sequence[Candidate], *, catalog_size: int = SCALE_CATALOG_SIZE
) -> list[Candidate]:
    """Expand verified production templates into distinct synthetic catalog entries.

    This is deliberately a catalog-scale performance fixture, not a quality fixture:
    the source metadata remains production metadata while every copy has a distinct
    template ID. That prevents the lexical index's deliberate duplicate-ID collapse
    from hiding the cost of a future catalog containing thousands of templates.
    """
    if not candidates:
        raise ValueError("Cannot build a scale catalog without production candidates.")
    if catalog_size < 1:
        raise ValueError("Scale catalog size must be positive.")

    scaled: list[Candidate] = []
    for position in range(catalog_size):
        source = candidates[position % len(candidates)]
        template_id = f"scale-{position:05d}-{source.template.template_id}"
        template = source.template.model_copy(
            update={"template_id": template_id, "meme_id": template_id}
        )
        scaled.append(
            Candidate(
                meme_id=template_id,
                name=source.name,
                image_url=source.image_url,
                system_tags=dict(source.system_tags),
                is_evergreen=source.is_evergreen,
                template=template,
                feedback_boost=source.feedback_boost,
            )
        )

    unique_template_ids = {candidate.template.template_id for candidate in scaled}
    if len(unique_template_ids) != catalog_size:
        raise AssertionError("Scale catalog must contain unique template IDs.")
    return scaled


def evaluate_catalog_scale(
    candidates: Sequence[Candidate],
    *,
    thresholds: CatalogScaleThresholds = DEFAULT_CATALOG_SCALE_THRESHOLDS,
    queries: Sequence[str] = SCALE_QUERIES,
) -> dict[str, object]:
    """Measure a warmed production ranker against a deterministic 5,000-template catalog."""
    if not queries:
        raise ValueError("Scale evaluation requires at least one representative query.")
    scaled_candidates = build_scale_candidates(candidates, catalog_size=thresholds.catalog_size)
    started = time.perf_counter()
    lexical_index = LexicalCandidateIndex.build(scaled_candidates)
    index_build_ms = (time.perf_counter() - started) * 1000
    if len(lexical_index.document_lengths) != len(scaled_candidates):
        raise AssertionError("Scale index unexpectedly collapsed distinct template IDs.")

    warm_latencies_ms: list[float] = []
    for query in queries:
        started = time.perf_counter()
        selections = fallback_template_selections(
            query,
            scaled_candidates,
            12,
            lexical_index=lexical_index,
        )
        warm_latencies_ms.append((time.perf_counter() - started) * 1000)
        if len(selections) != 12:
            raise AssertionError("Scale ranker must return the requested twelve results.")

    warm_p95_ms = percentile(warm_latencies_ms, 0.95)
    gates = {
        "warm_ranking_p95_ms": gate(
            warm_p95_ms,
            "<=",
            thresholds.warm_ranking_p95_ceiling_ms,
        )
    }
    return {
        "catalog_size": len(scaled_candidates),
        "unique_template_ids": len(lexical_index.document_lengths),
        "index_build_ms": index_build_ms,
        "warm_ranking_latency_ms": {
            "queries": len(queries),
            "p50": percentile(warm_latencies_ms, 0.50),
            "p95": warm_p95_ms,
        },
        "gates": gates,
        "passed": all(item["passed"] for item in gates.values()),
    }


def build_report(
    results: Sequence[CaseResult],
    *,
    benchmark_path: Path | None = None,
    thresholds: EvaluationThresholds = DEFAULT_THRESHOLDS,
) -> dict[str, object]:
    """Calculate metrics and gates from already-ranked benchmark cases."""
    if not results:
        raise ValueError("Benchmark must contain at least one case.")
    total = len(results)
    top_1 = sum(
        result.acceptable_rank is not None and result.acceptable_rank <= 1 for result in results
    )
    top_3 = sum(
        result.acceptable_rank is not None and result.acceptable_rank <= 3 for result in results
    )
    top_5 = sum(
        result.acceptable_rank is not None and result.acceptable_rank <= 5 for result in results
    )
    rejected_top_5 = sum(bool(result.rejected_templates_at_top_5) for result in results)
    latency = [result.ranking_latency_ms for result in results]
    metrics = {
        "cases": total,
        "top_1_acceptable_rate": top_1 / total,
        "top_3_acceptable_rate": top_3 / total,
        "top_5_acceptable_rate": top_5 / total,
        "rejected_family_intrusion_at_top_5_rate": rejected_top_5 / total,
        "ranking_latency_ms": {
            "p50": percentile(latency, 0.50),
            "p95": percentile(latency, 0.95),
        },
    }
    gates = {
        "top_1_acceptable_rate": gate(
            metrics["top_1_acceptable_rate"], ">=", thresholds.top_1_floor
        ),
        "top_3_acceptable_rate": gate(
            metrics["top_3_acceptable_rate"], ">=", thresholds.top_3_floor
        ),
        "top_5_acceptable_rate": gate(
            metrics["top_5_acceptable_rate"], ">=", thresholds.top_5_floor
        ),
        "rejected_family_intrusion_at_top_5_rate": gate(
            metrics["rejected_family_intrusion_at_top_5_rate"],
            "<=",
            thresholds.rejected_top_5_ceiling,
        ),
    }
    misses = [
        {
            "id": result.case_id,
            "category": result.category,
            "reason": miss_reason(result),
            "acceptable_rank": result.acceptable_rank,
            "expected_memes": list(result.expected_memes),
            "rejected_memes_at_top_5": list(result.rejected_templates_at_top_5),
            "selected_templates": list(result.selected_templates),
        }
        for result in results
        if miss_reason(result) is not None
    ]
    return {
        "benchmark": str(benchmark_path) if benchmark_path is not None else None,
        "metrics": metrics,
        "gates": gates,
        "passed": all(item["passed"] for item in gates.values()),
        "misses": misses,
        "cases": [asdict(result) for result in results],
    }


def same_family(left: str, right: str) -> bool:
    return left in right or right in left


def percentile(values: Sequence[float], quantile: float) -> float:
    """Return nearest-rank percentile, keeping small benchmark reports intuitive."""
    if not values:
        raise ValueError("Cannot calculate a percentile without values.")
    if not 0 <= quantile <= 1:
        raise ValueError("Quantile must be between zero and one.")
    ordered = sorted(values)
    return ordered[max(0, math.ceil(len(ordered) * quantile) - 1)]


def gate(actual: object, operator: str, threshold: float) -> dict[str, object]:
    if not isinstance(actual, float):
        raise TypeError("Gate values must be floats.")
    passed = actual >= threshold if operator == ">=" else actual <= threshold
    return {"actual": actual, "operator": operator, "threshold": threshold, "passed": passed}


def miss_reason(result: CaseResult) -> str | None:
    reasons = []
    if result.acceptable_rank is None or result.acceptable_rank > 5:
        reasons.append("no acceptable family in top 5")
    if result.rejected_templates_at_top_5:
        reasons.append("rejected family in top 5")
    return "; ".join(reasons) if reasons else None


def required_string(case: dict[str, Any], field: str) -> str:
    value = case.get(field)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"Benchmark case has an invalid {field!r} value.")
    return value


def normalized_string_list(value: object, field: str, case_id: str) -> list[str]:
    if not isinstance(value, list) or not value:
        raise ValueError(f"Benchmark case {case_id!r} must have a non-empty {field} array.")
    result = [
        normalize_template_name(item) for item in value if isinstance(item, str) and item.strip()
    ]
    if not result:
        raise ValueError(f"Benchmark case {case_id!r} must have valid {field} values.")
    return result


def normalized_rejected_names(value: object, case_id: str) -> list[str]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"Benchmark case {case_id!r} has an invalid rejected_memes array.")
    names = [
        normalize_template_name(item["name"])
        for item in value
        if isinstance(item, dict) and isinstance(item.get("name"), str) and item["name"].strip()
    ]
    if len(names) != len(value):
        raise ValueError(f"Benchmark case {case_id!r} has an invalid rejected meme name.")
    return names


def format_report(report: dict[str, object]) -> str:
    metrics = report["metrics"]
    assert isinstance(metrics, dict)
    latency = metrics["ranking_latency_ms"]
    assert isinstance(latency, dict)
    gates = report["gates"]
    assert isinstance(gates, dict)
    lines = [
        "MemeDrop deterministic suggestion evaluation",
        f"cases: {metrics['cases']}",
        f"top-1 acceptable: {float(metrics['top_1_acceptable_rate']):.1%}",
        f"top-3 acceptable: {float(metrics['top_3_acceptable_rate']):.1%}",
        f"top-5 acceptable: {float(metrics['top_5_acceptable_rate']):.1%}",
        "rejected-family intrusion at top 5: "
        f"{float(metrics['rejected_family_intrusion_at_top_5_rate']):.1%}",
        "local ranking latency: "
        f"p50={float(latency['p50']):.3f}ms p95={float(latency['p95']):.3f}ms",
        f"gates: {'PASS' if report['passed'] else 'FAIL'}",
    ]
    catalog_scale = report.get("catalog_scale")
    if isinstance(catalog_scale, dict):
        scale_latency = catalog_scale["warm_ranking_latency_ms"]
        assert isinstance(scale_latency, dict)
        lines.extend(
            [
                "catalog scale (synthetic verified templates): "
                f"{catalog_scale['catalog_size']} unique={catalog_scale['unique_template_ids']}",
                f"scale index build: {float(catalog_scale['index_build_ms']):.3f}ms",
                "scale warm ranking latency: "
                f"p50={float(scale_latency['p50']):.3f}ms "
                f"p95={float(scale_latency['p95']):.3f}ms",
            ]
        )
    misses = report["misses"]
    assert isinstance(misses, list)
    if misses:
        lines.append("misses:")
        for miss in misses:
            assert isinstance(miss, dict)
            lines.append(f"- {miss['id']}: {miss['reason']}")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate MemeDrop's local suggestion ranker")
    parser.add_argument("--benchmark", type=Path, default=default_benchmark_path())
    parser.add_argument("--json", action="store_true", help="print the complete report as JSON")
    parser.add_argument("--out", type=Path, help="write the complete JSON report to this path")
    arguments = parser.parse_args()
    report = evaluate_benchmark(arguments.benchmark)
    encoded = json.dumps(report, indent=2, sort_keys=True)
    if arguments.out:
        arguments.out.write_text(f"{encoded}\n", encoding="utf-8")
    print(encoded if arguments.json else format_report(report))
    if not report["passed"]:
        raise SystemExit("[MemeDrop] deterministic suggestion evaluation failed its quality gates.")


if __name__ == "__main__":
    main()
