from __future__ import annotations

from collections.abc import Iterable
from datetime import UTC, datetime
from typing import Any, TypedDict, cast

from sqlalchemy import text

from memedrop_api.db import Database


class FeedbackRow(TypedDict):
    meme_id: str
    meme_name: str
    meme_source: str
    action: str
    events: int


async def load_usage_feedback(
    database: Database, *, lookback_days: int, minimum_shown: int, limit: int
) -> dict[str, Any]:
    query = text(
        """
        SELECT COALESCE(u.global_meme_id, u.user_meme_id)::text AS meme_id,
               COALESCE(m.name, um.user_name, 'unknown meme') AS meme_name,
               CASE WHEN u.user_meme_id IS NULL THEN 'global' ELSE 'user' END AS meme_source,
               u.action,
               COUNT(*)::int AS events
          FROM usage_events u
          LEFT JOIN memes m ON m.id = u.global_meme_id
          LEFT JOIN user_memes um ON um.id = u.user_meme_id
         WHERE u.created_at > NOW() - make_interval(days => :days)
           AND COALESCE(u.global_meme_id, u.user_meme_id) IS NOT NULL
         GROUP BY 1, 2, 3, 4
        """
    )
    async with database.session() as session:
        rows = (await session.execute(query, {"days": lookback_days})).mappings().all()
    return summarize_usage_feedback(
        (cast(FeedbackRow, dict(row)) for row in rows),
        lookback_days=lookback_days,
        minimum_shown=minimum_shown,
        limit=limit,
    )


def summarize_usage_feedback(
    rows: Iterable[FeedbackRow], *, lookback_days: int, minimum_shown: int, limit: int = 50
) -> dict[str, Any]:
    grouped: dict[str, dict[str, Any]] = {}
    for row in rows:
        key = f"{row['meme_source']}:{row['meme_id']}"
        item = grouped.setdefault(
            key,
            {
                "meme_id": row["meme_id"],
                "meme_name": row["meme_name"],
                "meme_source": row["meme_source"],
                "shown": 0,
                "clicked": 0,
                "used": 0,
                "saved": 0,
                "dismissed": 0,
            },
        )
        action = row["action"]
        count = int(row["events"])
        if action in {"suggested", "shown"}:
            item["shown"] += count
        elif action == "clicked":
            item["clicked"] += count
        elif action in {"used", "inserted"}:
            item["used"] += count
        elif action == "saved":
            item["saved"] += count
        elif action == "dismissed":
            item["dismissed"] += count

    items = []
    for item in grouped.values():
        denominator = max(1, item["shown"])
        item["click_through_rate"] = round(item["clicked"] / denominator, 3)
        item["use_rate"] = round(item["used"] / denominator, 3)
        item["save_rate"] = round(item["saved"] / denominator, 3)
        item["dismissal_rate"] = round(item["dismissed"] / denominator, 3)
        item["quality_signal"] = classify_signal(item, minimum_shown)
        items.append(item)
    rank = {"promote": 4, "review": 3, "watch": 2, "insufficient_data": 1}
    items.sort(
        key=lambda item: (
            -rank[item["quality_signal"]],
            -item["use_rate"],
            -item["click_through_rate"],
            -item["shown"],
        )
    )
    return {
        "generated_at": datetime.now(UTC).isoformat(),
        "lookback_days": lookback_days,
        "minimum_shown": minimum_shown,
        "summary": {
            "memes": len(items),
            **{name: sum(item[name] for item in items) for name in ACTION_TOTALS},
            "promote_candidates": sum(item["quality_signal"] == "promote" for item in items),
            "review_candidates": sum(item["quality_signal"] == "review" for item in items),
        },
        "items": items[:limit] if limit > 0 else items,
    }


ACTION_TOTALS = ("shown", "clicked", "used", "saved", "dismissed")


def classify_signal(item: dict[str, Any], minimum_shown: int) -> str:
    if item["shown"] < minimum_shown:
        return "insufficient_data"
    if item["use_rate"] >= 0.18 or item["save_rate"] >= 0.08 or item["click_through_rate"] >= 0.35:
        return "promote"
    if (
        item["dismissal_rate"] >= 0.72
        and item["click_through_rate"] <= 0.08
        and item["use_rate"] <= 0.03
    ):
        return "review"
    return "watch"
