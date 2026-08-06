from __future__ import annotations

from typing import cast

from memedrop_api.suggestion_evaluation import (
    DEFAULT_THRESHOLDS,
    CaseResult,
    EvaluationThresholds,
    build_report,
    percentile,
)


def test_default_thresholds_include_a_top_one_quality_floor() -> None:
    assert DEFAULT_THRESHOLDS.top_1_floor == 0.70


def case_result(
    case_id: str,
    rank: int | None,
    *,
    rejected: tuple[str, ...] = (),
    latency_ms: float = 1.0,
) -> CaseResult:
    return CaseResult(
        case_id=case_id,
        category="test",
        expected_memes=("expected meme",),
        rejected_memes=("rejected meme",),
        selected_templates=("first choice", "second choice"),
        acceptable_rank=rank,
        rejected_templates_at_top_5=rejected,
        ranking_latency_ms=latency_ms,
    )


def test_report_calculates_retrieval_intrusion_and_latency_metrics() -> None:
    report = build_report(
        [
            case_result("top-1", 1, latency_ms=0.1),
            case_result("top-3", 2, latency_ms=0.2),
            case_result("top-5", 5, rejected=("rejected meme",), latency_ms=0.3),
            case_result("miss", None, latency_ms=0.4),
        ],
        thresholds=EvaluationThresholds(
            top_1_floor=0.25,
            top_3_floor=0.5,
            top_5_floor=0.75,
            rejected_top_5_ceiling=0.25,
        ),
    )

    assert report["passed"] is True
    assert report["metrics"] == {
        "cases": 4,
        "top_1_acceptable_rate": 0.25,
        "top_3_acceptable_rate": 0.5,
        "top_5_acceptable_rate": 0.75,
        "rejected_family_intrusion_at_top_5_rate": 0.25,
        "ranking_latency_ms": {"p50": 0.2, "p95": 0.4},
    }
    misses = cast(list[dict[str, object]], report["misses"])
    assert [miss["id"] for miss in misses] == ["top-5", "miss"]
    assert misses[0]["reason"] == "rejected family in top 5"
    assert misses[1]["reason"] == "no acceptable family in top 5"
    gates = cast(dict[str, dict[str, object]], report["gates"])
    assert gates["top_1_acceptable_rate"]["passed"] is True


def test_report_fails_the_honest_retrieval_quality_gates() -> None:
    report = build_report(
        [
            case_result("top-1", 1),
            case_result("top-3", 3),
            case_result("top-5", 5),
            case_result("intrusion", 5, rejected=("rejected meme",)),
            case_result("miss", None),
        ]
    )

    assert report["passed"] is False
    gates = cast(dict[str, dict[str, object]], report["gates"])
    assert gates["top_1_acceptable_rate"]["passed"] is False
    assert gates["top_3_acceptable_rate"]["passed"] is False
    assert gates["top_5_acceptable_rate"]["passed"] is False
    assert gates["rejected_family_intrusion_at_top_5_rate"]["passed"] is False


def test_percentile_uses_nearest_rank() -> None:
    assert percentile([1.0, 2.0, 3.0, 4.0], 0.50) == 2.0
    assert percentile([1.0, 2.0, 3.0, 4.0], 0.95) == 4.0
