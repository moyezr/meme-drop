"""Read-only aggregate baseline; no raw samples or content enter the report."""

from __future__ import annotations

import argparse
import asyncio
import json
from collections.abc import Mapping
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import text

from memedrop_api.config import Settings
from memedrop_api.db import Database
from memedrop_api.performance_metrics import RETENTION_DAYS

MINIMUM_SAMPLES = 20
MAX_SLICES = 100
METRICS = (
    "elapsed_ms",
    "first_usable_preview_ms",
    "api_response_ms",
    "selected_preparation_ms",
    "native_attachment_confirmation_ms",
)
OUTCOMES = (
    "usable",
    "empty",
    "failed",
    "timeout",
    "cancelled",
    "inserted",
    "copied",
    "attachment_failed",
)


def _aggregates() -> str:
    # Column names and outcomes are module-owned constants, never request input.
    return ", ".join(
        [
            "COUNT(*)::int AS samples",
            *[f"COUNT(*) FILTER (WHERE outcome = '{name}')::int AS {name}" for name in OUTCOMES],
            *[
                expression
                for name in METRICS
                for expression in (
                    f"COUNT({name})::int AS {name}_count",
                    f"percentile_cont(0.5) WITHIN GROUP (ORDER BY {name}) AS {name}_p50",
                    f"percentile_cont(0.95) WITHIN GROUP (ORDER BY {name}) AS {name}_p95",
                )
            ],
        ]
    )


def _rate(numerator: int, denominator: int) -> dict[str, int | float | str | None]:
    return {
        "numerator": numerator,
        "denominator": denominator,
        "rate": round(numerator / denominator, 4) if denominator >= MINIMUM_SAMPLES else None,
        "status": "observed" if denominator >= MINIMUM_SAMPLES else "insufficient_data",
    }


def summarize_group(row: Mapping[str, Any]) -> dict[str, Any]:
    samples = int(row["samples"])
    metrics = {}
    for name in METRICS:
        count = int(row[f"{name}_count"])
        metrics[name] = {
            "samples": count,
            "coverage": round(count / samples, 4) if samples else None,
            "p50": round(float(row[f"{name}_p50"]), 1) if count >= MINIMUM_SAMPLES else None,
            "p95": round(float(row[f"{name}_p95"]), 1) if count >= MINIMUM_SAMPLES else None,
            "status": "observed" if count >= MINIMUM_SAMPLES else "insufficient_data",
        }
    result = {
        "samples": samples,
        "outcomes": {name: int(row[name]) for name in OUTCOMES if int(row[name]) > 0},
        "metrics": metrics,
    }
    if row["kind"] == "request":
        result["rates"] = {
            name: _rate(int(row[name]), samples)
            for name in ("usable", "empty", "failed", "timeout", "cancelled")
        }
    else:
        result["rates"] = {"confirmed_attachment": _rate(int(row["inserted"]), samples)}
    return result


async def load_performance_baseline(
    database: Database, *, days: int = 30, since: datetime | None = None
) -> dict[str, Any]:
    if not 1 <= days <= RETENTION_DAYS:
        raise ValueError("days must be between 1 and 30")
    if since is not None and (since.tzinfo is None or since.utcoffset() is None):
        raise ValueError("since must include a timezone")
    async with database.session() as session, session.begin():
        await session.execute(text("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"))
        await session.execute(text("SET LOCAL statement_timeout = '5s'"))
        now = (await session.execute(text("SELECT now()"))).scalar_one()
        if since is not None and since > now:
            raise ValueError("since must not be in the future")
        cutoff = max(now - timedelta(days=days), since or now - timedelta(days=days))
        params = {"since": cutoff}
        table_exists = (
            await session.execute(
                text("SELECT to_regclass('public.suggestion_performance_samples') IS NOT NULL")
            )
        ).scalar_one()
        report: dict[str, Any] = {
            "schema_version": 1,
            "generated_at": now.isoformat(),
            "lookback_days": days,
            "samples_since": cutoff.isoformat(),
            "minimum_samples_for_rates_and_quantiles": MINIMUM_SAMPLES,
            "collection": {
                "status": "available" if table_exists else "not_deployed",
                "identity": "anonymous_random_retry_ids_only",
                "reported_by": "best_effort_untrusted_clients",
                "window_days": RETENTION_DAYS,
                "deletion": "bounded_on_ingest_and_weekly_maintenance",
            },
            "limitations": [
                "Not a census: closed browsers, dropped batches and old extensions are unobserved.",
                "Preview quantiles cover usable results; inspect failure and empty counts too.",
                "Client cache and generation categories remain unknown without explicit evidence.",
                "Serverless cold/warm state is not inferred or collected.",
                "Anonymous samples cannot be joined to installations, templates or usage events.",
                "Usage conversion is per visible card impression, not per request or person.",
                "Deletion runs on ingest and weekly maintenance; failures/backlog need operators.",
            ],
            "overall": {},
            "slices": [],
            "slice_groups": 0,
            "slices_truncated": False,
        }
        if table_exists:
            where = "created_at >= :since"
            overall = (
                (
                    await session.execute(
                        text(
                            f"SELECT kind, {_aggregates()} FROM suggestion_performance_samples "
                            f"WHERE {where} GROUP BY kind"
                        ),
                        params,
                    )
                )
                .mappings()
                .all()
            )
            report["overall"] = {row["kind"]: summarize_group(dict(row)) for row in overall}
            slices = (
                (
                    await session.execute(
                        text(
                            "SELECT kind, platform, extension_version, cache_status, "
                            "generation_mode, "
                            f"{_aggregates()}, COUNT(*) OVER()::int AS groups "
                            f"FROM suggestion_performance_samples WHERE {where} "
                            "GROUP BY kind, platform, extension_version, cache_status, "
                            "generation_mode "
                            "ORDER BY COUNT(*) DESC, kind, platform, extension_version, "
                            "cache_status, generation_mode "
                            "LIMIT :limit"
                        ),
                        {**params, "limit": MAX_SLICES},
                    )
                )
                .mappings()
                .all()
            )
            report["slices"] = [
                {
                    **{
                        name: row[name]
                        for name in (
                            "kind",
                            "platform",
                            "extension_version",
                            "cache_status",
                            "generation_mode",
                        )
                    },
                    **summarize_group(dict(row)),
                }
                for row in slices
            ]
            report["slice_groups"] = int(slices[0]["groups"]) if slices else 0
            report["slices_truncated"] = report["slice_groups"] > MAX_SLICES
        feedback = (
            (
                await session.execute(
                    text("""
            WITH impressions AS (
                SELECT user_id, tweet_context->>'impression_id' AS impression_id,
                       BOOL_OR(action = 'shown') AS shown,
                       BOOL_OR(action = 'clicked') AS clicked,
                       BOOL_OR(action = 'inserted') AS inserted,
                       BOOL_OR(action = 'copied') AS copied
                  FROM usage_events
                 WHERE created_at >= :since
                   AND tweet_context->>'telemetry_version' = '2'
                   AND tweet_context->>'impression_id' IS NOT NULL
                 GROUP BY user_id, tweet_context->>'impression_id'
            )
            SELECT COUNT(*) FILTER (WHERE shown)::int AS shown,
                   COUNT(*) FILTER (WHERE shown AND clicked)::int AS clicked,
                   COUNT(*) FILTER (WHERE shown AND inserted)::int AS inserted,
                   COUNT(*) FILTER (WHERE shown AND copied)::int AS copied,
                   COUNT(*) FILTER (WHERE NOT shown)::int AS without_shown
              FROM impressions
        """),
                    params,
                )
            )
            .mappings()
            .one()
        )
        actions = (
            (
                await session.execute(
                    text("""
            SELECT action, COUNT(*)::int AS events FROM usage_events
             WHERE created_at >= :since
               AND tweet_context->>'telemetry_version' = '2'
             GROUP BY action
        """),
                    params,
                )
            )
            .mappings()
            .all()
        )
        report["feedback_v2"] = {
            "unit": "distinct_visible_card_impressions",
            "shown": feedback["shown"],
            "matched_clicked": feedback["clicked"],
            "matched_inserted": feedback["inserted"],
            "matched_copied": feedback["copied"],
            "impressions_without_shown": feedback["without_shown"],
            "confirmed_attachment_rate": _rate(feedback["inserted"], feedback["shown"]),
            "click_rate": _rate(feedback["clicked"], feedback["shown"]),
            "events": {row["action"]: row["events"] for row in actions},
        }
        return report


def main() -> None:
    parser = argparse.ArgumentParser(description="Read anonymous suggestion baseline aggregates")
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--out", type=Path)
    parser.add_argument(
        "--since", help="Exclude operator QA before this timezone-aware ISO timestamp"
    )
    arguments = parser.parse_args()
    if not 1 <= arguments.days <= RETENTION_DAYS:
        parser.error("days must be between 1 and 30")
    try:
        since = datetime.fromisoformat(arguments.since) if arguments.since else None
        if since is not None:
            if since.tzinfo is None or since.utcoffset() is None:
                raise ValueError("timezone required")
            since = since.astimezone(UTC)
    except ValueError:
        parser.error("since must be a timezone-aware ISO timestamp")

    async def run() -> dict[str, Any]:
        settings = Settings()  # type: ignore[call-arg]
        database = Database(settings.database_url)
        try:
            return await load_performance_baseline(database, days=arguments.days, since=since)
        finally:
            await database.close()

    result = asyncio.run(run())
    output = json.dumps(result, indent=2) + "\n"
    if arguments.out:
        arguments.out.parent.mkdir(parents=True, exist_ok=True)
        arguments.out.write_text(output, encoding="utf-8")
    print(output, end="")


if __name__ == "__main__":
    main()
