from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest

from memedrop_api.services.trend_monitoring import TrendSnapshotHealthCheck


@pytest.mark.parametrize(
    ("published_at", "cards", "expected_state"),
    (
        (datetime(2026, 8, 24, 11, 0, tzinfo=UTC), ("card",), "fresh"),
        (datetime(2026, 8, 24, 11, 0, tzinfo=UTC), (), "empty"),
        (datetime(2026, 8, 24, 9, 59, tzinfo=UTC), ("card",), "stale"),
        (None, (), "missing"),
    ),
)
async def test_snapshot_health_reports_fresh_stale_and_missing_without_content(
    monkeypatch: pytest.MonkeyPatch,
    published_at: datetime | None,
    cards: tuple[str, ...],
    expected_state: str,
) -> None:
    snapshot = (
        None
        if published_at is None
        else SimpleNamespace(published_at=published_at, version=7, cards=cards)
    )

    class FakeRepository:
        def __init__(self, database: object) -> None:
            assert database == "database"

        async def get_snapshot(self) -> object:
            return snapshot

    monkeypatch.setattr(
        "memedrop_api.services.trend_monitoring.SqlAlchemyTrendRepository",
        FakeRepository,
    )
    check = TrendSnapshotHealthCheck("database", max_age_seconds=7_200)  # type: ignore[arg-type]

    status = await check(now=datetime(2026, 8, 24, 12, 0, tzinfo=UTC))

    assert status.state == expected_state
    assert status.max_age_seconds == 7_200
    assert "published_at" not in status.as_json()
    assert status.is_fresh is (expected_state == "fresh")


@pytest.mark.parametrize(
    ("age_seconds", "state"), ((86_401, "fresh"), (172_800, "fresh"), (172_801, "stale"))
)
async def test_daily_snapshot_freshness_tolerates_one_missed_run(
    monkeypatch: pytest.MonkeyPatch, age_seconds: int, state: str
) -> None:
    now = datetime(2026, 10, 7, 12, 0, tzinfo=UTC)
    snapshot = SimpleNamespace(
        published_at=now - timedelta(seconds=age_seconds), version=7, cards=("card",)
    )

    class FakeRepository:
        def __init__(self, database: object) -> None:
            pass

        async def get_snapshot(self) -> object:
            return snapshot

    monkeypatch.setattr(
        "memedrop_api.services.trend_monitoring.SqlAlchemyTrendRepository", FakeRepository
    )
    check = TrendSnapshotHealthCheck("database", max_age_seconds=172_800)  # type: ignore[arg-type]

    assert (await check(now=now)).state == state
