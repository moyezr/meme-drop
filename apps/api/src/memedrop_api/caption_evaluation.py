"""Reproducible live caption samples for human taste and latency review.

This is intentionally not a CI gate: creative model output is stochastic and a
model judging itself would give false confidence. The deterministic tuning gate
covers contracts; this command captures a fixed, reviewable sample before prompt,
context, or model changes are accepted.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import time
from datetime import UTC, datetime
from pathlib import Path

from memedrop_api.config import Settings
from memedrop_api.services.context_analyzer import heuristic_tweet_context
from memedrop_api.services.meme_text import clean_generated_regions
from memedrop_api.services.openrouter import OpenRouterSuggestionGateway, SuggestionModelGateway
from memedrop_api.services.suggestion_engine import (
    MODEL_SHORTLIST_SIZE,
    LexicalCandidateIndex,
    fallback_template_selections,
)
from memedrop_api.suggestion_evaluation import (
    default_benchmark_path,
    percentile,
    production_candidates,
)

DEFAULT_SAMPLE_PATH = (
    Path(__file__).resolve().parents[4]
    / "tools"
    / "template-tools"
    / "evals"
    / "caption-taste-sample.json"
)


async def evaluate_caption_sample(
    *,
    benchmark_path: Path,
    sample_path: Path,
    gateway: SuggestionModelGateway,
    model_name: str,
) -> dict[str, object]:
    benchmark, sample = load_evaluation_inputs(benchmark_path, sample_path)
    raw_cases = benchmark.get("cases")
    case_ids = sample.get("case_ids")
    if not isinstance(raw_cases, list) or not isinstance(case_ids, list) or not case_ids:
        raise ValueError(
            "Caption evaluation requires benchmark cases and a non-empty case_ids list."
        )
    cases_by_id = {
        item["id"]: item
        for item in raw_cases
        if isinstance(item, dict) and isinstance(item.get("id"), str)
    }
    requested_ids = [str(value) for value in case_ids]
    missing = [case_id for case_id in requested_ids if case_id not in cases_by_id]
    if missing:
        raise ValueError(f"Caption sample references unknown benchmark cases: {', '.join(missing)}")

    candidates = production_candidates()
    by_template = {candidate.template.template_id: candidate for candidate in candidates}
    lexical_index = LexicalCandidateIndex.build(candidates)
    results: list[dict[str, object]] = []
    latencies: list[float] = []
    valid_suggestions = 0
    total_suggestions = 0
    for case_id in requested_ids:
        raw_case = cases_by_id[case_id]
        tweet = str(raw_case["tweet"])
        context = heuristic_tweet_context(tweet)
        shortlist = fallback_template_selections(
            tweet,
            candidates,
            MODEL_SHORTLIST_SIZE,
            lexical_index=lexical_index,
        )
        templates = [
            by_template[item.template_id].template
            for item in shortlist
            if item.template_id in by_template
        ]
        started = time.perf_counter()
        generated = await gateway.select_and_caption(
            tweet,
            templates,
            5,
            context=context,
        )
        latency_ms = (time.perf_counter() - started) * 1000
        latencies.append(latency_ms)
        suggestions: list[dict[str, object]] = []
        for selection in generated.selections:
            candidate = by_template.get(selection.template_id)
            if candidate is None:
                continue
            raw_regions = generated.captions.get(selection.template_id, {})
            clean_regions = clean_generated_regions(
                raw_regions,
                candidate.template,
                require_complete=True,
                reject_overlong=True,
            )
            contract_valid = bool(clean_regions)
            total_suggestions += 1
            valid_suggestions += int(contract_valid)
            suggestions.append(
                {
                    "template_id": selection.template_id,
                    "template_name": candidate.name,
                    "reason": selection.reason,
                    "score": selection.score,
                    "regions": raw_regions,
                    "contract_valid": contract_valid,
                    "human_review": {
                        "post_fit": None,
                        "comic_turn": None,
                        "template_fit": None,
                        "caption_readability": None,
                        "notes": "",
                    },
                }
            )
        results.append(
            {
                "id": case_id,
                "category": raw_case.get("category"),
                "tweet": tweet,
                "shortlist": [item.template_id for item in shortlist],
                "latency_ms": round(latency_ms, 1),
                "suggestions": suggestions,
            }
        )

    return {
        "version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "model": model_name,
        "sample": str(sample_path),
        "summary": {
            "cases": len(results),
            "suggestions": total_suggestions,
            "contract_valid_rate": valid_suggestions / total_suggestions
            if total_suggestions
            else 0.0,
            "latency_ms": {
                "p50": percentile(latencies, 0.5),
                "p95": percentile(latencies, 0.95),
            },
        },
        "cases": results,
    }


def load_evaluation_inputs(
    benchmark_path: Path, sample_path: Path
) -> tuple[dict[str, object], dict[str, object]]:
    benchmark = json.loads(benchmark_path.read_text(encoding="utf-8"))
    sample = json.loads(sample_path.read_text(encoding="utf-8"))
    if not isinstance(benchmark, dict) or not isinstance(sample, dict):
        raise ValueError("Caption benchmark and sample must be JSON objects.")
    return benchmark, sample


def safe_model_filename(model_name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", model_name.lower()).strip("-") or "model"


async def run(arguments: argparse.Namespace) -> None:
    settings = Settings(database_url=os.environ.get("DATABASE_URL", "postgresql://evaluation"))
    if arguments.model:
        settings = settings.model_copy(update={"openrouter_suggestion_model": arguments.model})
    if not settings.openrouter_api_key:
        raise SystemExit("[MemeDrop] OPENROUTER_API_KEY is required for the live caption sample.")
    output_path = arguments.out or (
        Path(".memedrop")
        / f"caption-eval-{safe_model_filename(settings.openrouter_suggestion_model)}.json"
    )
    gateway = OpenRouterSuggestionGateway(settings)
    try:
        report = await evaluate_caption_sample(
            benchmark_path=arguments.benchmark,
            sample_path=arguments.sample,
            gateway=gateway,
            model_name=settings.openrouter_suggestion_model,
        )
    finally:
        await gateway.close()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(f"{json.dumps(report, indent=2)}\n", encoding="utf-8")
    summary = report["summary"]
    assert isinstance(summary, dict)
    latency = summary["latency_ms"]
    assert isinstance(latency, dict)
    print(
        "MemeDrop live caption sample: "
        f"model={report['model']} cases={summary['cases']} suggestions={summary['suggestions']} "
        f"contract-valid={float(summary['contract_valid_rate']):.1%} "
        f"p50={float(latency['p50']):.0f}ms p95={float(latency['p95']):.0f}ms"
    )
    print(f"Review and score every suggestion in {output_path}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Capture a fixed live caption sample for review")
    parser.add_argument("--benchmark", type=Path, default=default_benchmark_path())
    parser.add_argument("--sample", type=Path, default=DEFAULT_SAMPLE_PATH)
    parser.add_argument("--model", help="override OPENROUTER_SUGGESTION_MODEL for this sample")
    parser.add_argument("--out", type=Path)
    asyncio.run(run(parser.parse_args()))


if __name__ == "__main__":
    main()
