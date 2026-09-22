"""Live, offline-only evaluation of Jev as MemeDrop's shortlist re-ranker.

Jev cannot write captions. This experiment gives it the same bounded shortlist as
the production joint model, records its typed fit judgments, and optionally asks
MemeDrop's existing caption model to caption Jev's top five. It does not change the
runtime suggestion path.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import os
import time
from collections.abc import Sequence
from datetime import UTC, datetime
from pathlib import Path

from memedrop_api.caption_evaluation import DEFAULT_SAMPLE_PATH, load_evaluation_inputs
from memedrop_api.config import Settings
from memedrop_api.services.catalog import normalize_template_name
from memedrop_api.services.context_analyzer import heuristic_tweet_context
from memedrop_api.services.jev_reranker import TypeSafeJevReranker
from memedrop_api.services.meme_text import clean_generated_regions
from memedrop_api.services.openrouter import OpenRouterSuggestionGateway
from memedrop_api.services.suggestion_engine import (
    MODEL_SHORTLIST_SIZE,
    Candidate,
    LexicalCandidateIndex,
    fallback_template_selections,
)
from memedrop_api.suggestion_evaluation import (
    default_benchmark_path,
    load_evaluation_candidates,
    percentile,
    same_family,
)

JEV_INPUT_PRICE_PER_MILLION_TOKENS = 0.042


async def evaluate_jev(
    *,
    benchmark_path: Path,
    sample_path: Path,
    ranker: TypeSafeJevReranker,
    candidates: Sequence[Candidate],
    caption_gateway: OpenRouterSuggestionGateway | None = None,
    case_ids: Sequence[str] | None = None,
) -> dict[str, object]:
    benchmark, sample = load_evaluation_inputs(benchmark_path, sample_path)
    raw_cases = benchmark.get("cases")
    if not isinstance(raw_cases, list):
        raise ValueError("Jev evaluation requires a benchmark cases array")
    requested = set(case_ids or [])
    if requested:
        raw_cases = [
            case for case in raw_cases if isinstance(case, dict) and case.get("id") in requested
        ]
        missing = requested - {str(case.get("id")) for case in raw_cases if isinstance(case, dict)}
        if missing:
            raise ValueError(f"Unknown case ids: {', '.join(sorted(missing))}")
    raw_caption_ids = sample.get("case_ids", [])
    caption_ids = (
        {str(case_id) for case_id in raw_caption_ids}
        if caption_gateway is not None and isinstance(raw_caption_ids, list)
        else set()
    )
    ranking_candidates = list(candidates)
    by_id = {candidate.template.template_id: candidate for candidate in ranking_candidates}
    lexical_index = LexicalCandidateIndex.build(ranking_candidates)
    results: list[dict[str, object]] = []
    latencies: list[float] = []
    caption_latencies: list[float] = []
    total_input_tokens = 0
    acceptable_ranks: list[int | None] = []
    rejected_top_5_cases = 0
    valid_captions = 0
    total_captions = 0

    for raw_case in raw_cases:
        if not isinstance(raw_case, dict):
            continue
        tweet = str(raw_case.get("tweet", ""))
        local = fallback_template_selections(
            tweet,
            ranking_candidates,
            MODEL_SHORTLIST_SIZE,
            lexical_index=lexical_index,
        )
        templates = [
            by_id[item.template_id].template for item in local if item.template_id in by_id
        ]
        context = heuristic_tweet_context(tweet)
        rerank_started = time.perf_counter()
        ranking = await ranker.rerank(
            tweet,
            templates,
            len(templates),
            context=context,
        )
        rerank_latency_ms = (time.perf_counter() - rerank_started) * 1000
        latencies.append(rerank_latency_ms)
        total_input_tokens += ranking.input_tokens
        selected_ids = [item.template_id for item in ranking.scores]
        selected_names = [normalize_template_name(by_id[item].name) for item in selected_ids]
        expected = [
            normalize_template_name(str(item)) for item in raw_case.get("expected_memes", [])
        ]
        rejected = [
            normalize_template_name(str(item.get("name", "")))
            for item in raw_case.get("rejected_memes", [])
            if isinstance(item, dict)
        ]
        acceptable_rank = next(
            (
                index + 1
                for index, name in enumerate(selected_names)
                if any(same_family(name, family) for family in expected)
            ),
            None,
        )
        acceptable_ranks.append(acceptable_rank)
        rejected_top_5 = [
            name
            for name in selected_names[:5]
            if any(same_family(name, family) for family in rejected)
        ]
        rejected_top_5_cases += int(bool(rejected_top_5))
        case_result: dict[str, object] = {
            "id": raw_case.get("id"),
            "category": raw_case.get("category"),
            "tweet": tweet,
            "local_shortlist": [item.template_id for item in local],
            "jev_ranking": [
                {
                    "template_id": item.template_id,
                    "template_name": by_id[item.template_id].name,
                    "fit_probability": item.fit_probability,
                    "choice_probability": item.choice_probability,
                }
                for item in ranking.scores
            ],
            "acceptable_rank": acceptable_rank,
            "rejected_templates_at_top_5": rejected_top_5,
            "jev": {
                "model": ranking.model,
                "latency_ms": round(rerank_latency_ms, 1),
                "confidence": ranking.confidence,
                "none_probability": ranking.none_probability,
                "input_tokens": ranking.input_tokens,
            },
        }
        if caption_gateway is not None and raw_case.get("id") in caption_ids:
            selected_templates = [by_id[item].template for item in selected_ids[:5]]
            caption_started = time.perf_counter()
            captions = await caption_gateway.generate_captions(
                tweet,
                selected_templates,
                context=context,
            )
            caption_latency = (time.perf_counter() - caption_started) * 1000
            caption_latencies.append(caption_latency)
            rendered = []
            for template in selected_templates:
                raw_regions = captions.get(template.template_id, {})
                clean = clean_generated_regions(
                    raw_regions,
                    template,
                    require_complete=True,
                    reject_overlong=True,
                )
                total_captions += 1
                valid_captions += int(bool(clean))
                rendered.append(
                    {
                        "template_id": template.template_id,
                        "template_name": template.name,
                        "regions": raw_regions,
                        "contract_valid": bool(clean),
                        "human_review": {
                            "post_fit": None,
                            "comic_turn": None,
                            "template_fit": None,
                            "caption_readability": None,
                            "notes": "",
                        },
                    }
                )
            case_result["captions"] = rendered
            case_result["caption_latency_ms"] = round(caption_latency, 1)
        results.append(case_result)

    case_count = len(results)
    summary = {
        "cases": case_count,
        "acceptable_recall": {
            f"top_{cutoff}": sum(rank is not None and rank <= cutoff for rank in acceptable_ranks)
            / case_count
            if case_count
            else 0.0
            for cutoff in (1, 3, 5, 12)
        },
        "rejected_case_rate_top_5": rejected_top_5_cases / case_count if case_count else 0.0,
        "latency_ms": {
            "p50": percentile(latencies, 0.5),
            "p95": percentile(latencies, 0.95),
        },
        "input_tokens": total_input_tokens,
        "estimated_jev_cost_usd": total_input_tokens
        / 1_000_000
        * JEV_INPUT_PRICE_PER_MILLION_TOKENS,
        "caption_cases": len(caption_latencies),
        "caption_contract_valid_rate": valid_captions / total_captions if total_captions else None,
        "caption_latency_ms": {
            "p50": percentile(caption_latencies, 0.5) if caption_latencies else None,
            "p95": percentile(caption_latencies, 0.95) if caption_latencies else None,
        },
    }
    return {
        "version": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "experiment": "jev-shortlist-reranker",
        "summary": summary,
        "cases": results,
    }


async def run(arguments: argparse.Namespace) -> None:
    api_key = os.environ.get("TYPESAFE_API_KEY")
    if not api_key:
        raise SystemExit("[MemeDrop] TYPESAFE_API_KEY is required for the Jev evaluation")
    candidates = load_evaluation_candidates(arguments.catalog)
    ranker = TypeSafeJevReranker(
        api_key,
        model=arguments.model,
        timeout_ms=10_000,
        cooldown_ms=0,
    )
    caption_gateway = None
    if arguments.with_captions:
        settings = Settings(database_url=os.environ.get("DATABASE_URL", "postgresql://evaluation"))
        if not settings.openrouter_api_key:
            raise SystemExit("[MemeDrop] OPENROUTER_API_KEY is required with --with-captions")
        caption_gateway = OpenRouterSuggestionGateway(settings)
    try:
        report = await evaluate_jev(
            benchmark_path=arguments.benchmark,
            sample_path=arguments.sample,
            ranker=ranker,
            candidates=candidates,
            caption_gateway=caption_gateway,
            case_ids=arguments.case_id,
        )
    finally:
        await ranker.close()
        if caption_gateway is not None:
            await caption_gateway.close()
    arguments.out.parent.mkdir(parents=True, exist_ok=True)
    arguments.out.write_text(f"{json.dumps(report, indent=2)}\n", encoding="utf-8")
    summary = report["summary"]
    assert isinstance(summary, dict)
    recalls = summary["acceptable_recall"]
    latency = summary["latency_ms"]
    assert isinstance(recalls, dict) and isinstance(latency, dict)
    print(
        "MemeDrop Jev evaluation: "
        f"cases={summary['cases']} top1={float(recalls['top_1']):.1%} "
        f"top3={float(recalls['top_3']):.1%} top5={float(recalls['top_5']):.1%} "
        f"rejected@5={float(summary['rejected_case_rate_top_5']):.1%} "
        f"p50={float(latency['p50']):.0f}ms p95={float(latency['p95']):.0f}ms "
        f"cost=${float(summary['estimated_jev_cost_usd']):.6f}"
    )
    print(f"Detailed report: {arguments.out}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate Jev as MemeDrop's shortlist re-ranker")
    parser.add_argument("--benchmark", type=Path, default=default_benchmark_path())
    parser.add_argument("--sample", type=Path, default=DEFAULT_SAMPLE_PATH)
    parser.add_argument("--model", default="jev-1.13.0")
    parser.add_argument("--catalog", type=Path)
    parser.add_argument("--case-id", action="append")
    parser.add_argument("--with-captions", action="store_true")
    parser.add_argument("--out", type=Path, default=Path(".memedrop/jev-evaluation.json"))
    arguments = parser.parse_args()
    asyncio.run(run(arguments))


if __name__ == "__main__":
    main()
