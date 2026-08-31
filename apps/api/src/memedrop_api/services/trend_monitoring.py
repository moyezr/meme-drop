"""Snapshot-age health checks for the trend serving index."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Literal

from memedrop_api.db import Database
from memedrop_api.trend_repository import SqlAlchemyTrendRepository

TrendSnapshotState = Literal["fresh", "missing", "empty", "stale"]


@dataclass(frozen=True, slots=True)
class TrendSnapshotStatus:
    """A content-free signal for external health checks and alerting."""

    state: TrendSnapshotState
    max_age_seconds: int
    age_seconds: int | None
    snapshot_version: int | None
    card_count: int | None

    @property
    def is_fresh(self) -> bool:
        return self.state == "fresh"

    def as_json(self) -> dict[str, int | str | None]:
        return {
            "state": self.state,
            "max_age_seconds": self.max_age_seconds,
            "age_seconds": self.age_seconds,
            "snapshot_version": self.snapshot_version,
            "card_count": self.card_count,
        }


class TrendSnapshotHealthCheck:
    """Read the latest immutable snapshot without touching Tavily or Redis."""

    def __init__(self, database: Database, *, max_age_seconds: int) -> None:
        self._repository = SqlAlchemyTrendRepository(database)
        self._max_age_seconds = max_age_seconds

    async def __call__(self, *, now: datetime | None = None) -> TrendSnapshotStatus:
        checked_at = (now or datetime.now(UTC)).astimezone(UTC)
        snapshot = await self._repository.get_snapshot()
        if snapshot is None or snapshot.published_at is None:
            return TrendSnapshotStatus(
                state="missing",
                max_age_seconds=self._max_age_seconds,
                age_seconds=None,
                snapshot_version=None,
                card_count=None,
            )

        age_seconds = max(0, int((checked_at - snapshot.published_at).total_seconds()))
        card_count = len(snapshot.cards)
        return TrendSnapshotStatus(
            state=(
                "empty"
                if card_count == 0
                else "fresh"
                if age_seconds <= self._max_age_seconds
                else "stale"
            ),
            max_age_seconds=self._max_age_seconds,
            age_seconds=age_seconds,
            snapshot_version=snapshot.version,
            card_count=card_count,
        )
