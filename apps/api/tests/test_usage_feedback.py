from __future__ import annotations

from memedrop_api.repositories import feedback_ranking_boost
from memedrop_api.services.usage_feedback import FeedbackRow, summarize_usage_feedback


def row(meme_id: str, action: str, events: int) -> FeedbackRow:
    return FeedbackRow(
        meme_id=meme_id,
        meme_name=f"Meme {meme_id}",
        meme_source="global",
        action=action,
        events=events,
    )


def test_feedback_report_classifies_strong_weak_and_sparse_templates() -> None:
    report = summarize_usage_feedback(
        [
            row("strong", "shown", 100),
            row("strong", "inserted", 20),
            row("weak", "shown", 100),
            row("weak", "clicked", 4),
            row("weak", "rejected", 85),
            row("new", "shown", 4),
            row("new", "inserted", 2),
        ],
        lookback_days=30,
        minimum_shown=20,
    )

    signals = {item["meme_id"]: item["quality_signal"] for item in report["items"]}
    assert signals == {"strong": "promote", "weak": "review", "new": "insufficient_data"}
    assert report["summary"]["shown"] == 204
    assert report["summary"]["used"] == 22


def test_personal_feedback_boost_is_directional_and_bounded() -> None:
    assert feedback_ranking_boost({"shown": 10, "inserted": 10}) == 0.12
    assert feedback_ranking_boost({"shown": 10, "rejected": 10}) == -0.06
    assert feedback_ranking_boost({"shown": 10}) == 0


def test_ambiguous_legacy_and_neutral_feedback_do_not_train_personalization() -> None:
    assert (
        feedback_ranking_boost(
            {
                "shown": 10,
                "used": 50,
                "dismissed": 50,
                "suggested": 50,
                "copied": 50,
                "abandoned": 50,
            }
        )
        == 0
    )
    report = summarize_usage_feedback(
        [
            row("m", "shown", 20),
            row("m", "used", 20),
            row("m", "dismissed", 20),
            row("m", "suggested", 20),
            row("m", "copied", 4),
            row("m", "abandoned", 3),
        ],
        lookback_days=30,
        minimum_shown=20,
    )
    item = report["items"][0]
    assert item["shown"] == 20
    assert item["used"] == item["dismissed"] == 0
    assert item["copied"] == 4
    assert item["abandoned"] == 3
    assert item["quality_signal"] == "watch"
