"""Strict, content-free browser measurements; no installation or content identity."""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Annotated, Literal, Protocol
from uuid import UUID

from pydantic import UUID4, BaseModel, ConfigDict, Field, StringConstraints, model_validator
from sqlalchemy import Select, delete, func, select, text
from sqlalchemy.dialects.postgresql import insert

from memedrop_api.db import Database, SuggestionPerformanceSample

RETENTION_DAYS = 30
INGEST_PRUNE_LIMIT = 1_000
CLEANUP_PRUNE_LIMIT = 10_000

Duration = Annotated[float, Field(strict=True, ge=0, le=120_000, allow_inf_nan=False)]
ExtensionVersion = Annotated[
    str,
    StringConstraints(pattern=r"^(0|[1-9][0-9]{0,3})(\.(0|[1-9][0-9]{0,3})){2,3}$", max_length=19),
]


class PerformanceSample(BaseModel):
    model_config = ConfigDict(extra="forbid")

    event_id: UUID4
    platform: Literal["x", "linkedin"]
    extension_version: ExtensionVersion
    elapsed_ms: Duration


class RequestPerformanceSample(PerformanceSample):
    kind: Literal["request"]
    outcome: Literal["usable", "empty", "failed", "timeout", "cancelled"]
    suggestion_count: Annotated[int, Field(strict=True, ge=0, le=5)]
    first_usable_preview_ms: Duration | None = None
    api_response_ms: Duration | None = None
    cache_status: Literal["hit", "miss", "unknown"] = "unknown"
    generation_mode: Literal["model", "fallback", "unknown"] = "unknown"

    @model_validator(mode="after")
    def consistent_request(self) -> RequestPerformanceSample:
        if self.outcome == "usable":
            if self.suggestion_count == 0 or self.first_usable_preview_ms is None:
                raise ValueError("usable requires a nonempty visible preview")
        elif self.first_usable_preview_ms is not None:
            raise ValueError("only usable requests have a visible preview duration")
        if self.outcome == "empty" and self.suggestion_count != 0:
            raise ValueError("empty requests must have zero suggestions")
        for value in (self.first_usable_preview_ms, self.api_response_ms):
            if value is not None and value > self.elapsed_ms:
                raise ValueError("component duration exceeds elapsed duration")
        return self


class AttachmentPerformanceSample(PerformanceSample):
    kind: Literal["attachment"]
    outcome: Literal["inserted", "copied", "attachment_failed", "cancelled"]
    selected_preparation_ms: Duration | None = None
    native_attachment_confirmation_ms: Duration | None = None

    @model_validator(mode="after")
    def consistent_attachment(self) -> AttachmentPerformanceSample:
        if self.outcome == "inserted":
            if self.native_attachment_confirmation_ms is None:
                raise ValueError("insertion requires native confirmation duration")
        elif self.native_attachment_confirmation_ms is not None:
            raise ValueError("only inserted attachments have native confirmation duration")
        for value in (self.selected_preparation_ms, self.native_attachment_confirmation_ms):
            if value is not None and value > self.elapsed_ms:
                raise ValueError("component duration exceeds elapsed duration")
        return self


BrowserPerformanceSample = Annotated[
    RequestPerformanceSample | AttachmentPerformanceSample, Field(discriminator="kind")
]


class PerformanceBatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    samples: list[BrowserPerformanceSample] = Field(min_length=1, max_length=20)


@dataclass(frozen=True)
class PerformanceCleanupResult:
    deleted: int
    remaining: int


class PerformanceStore(Protocol):
    async def record(self, samples: Sequence[BrowserPerformanceSample]) -> int: ...

    async def cleanup_expired(self) -> PerformanceCleanupResult: ...


def _expired_ids(limit: int) -> Select[tuple[UUID]]:
    return (
        select(SuggestionPerformanceSample.id)
        .where(SuggestionPerformanceSample.created_at < func.now() - text("interval '30 days'"))
        .order_by(SuggestionPerformanceSample.created_at)
        .limit(limit)
        .with_for_update(skip_locked=True)
    )


class SqlAlchemyPerformanceStore:
    def __init__(self, database: Database) -> None:
        self.database = database

    async def record(self, samples: Sequence[BrowserPerformanceSample]) -> int:
        rows = []
        for sample in samples:
            row = sample.model_dump(exclude_none=True)
            row["id"] = row.pop("event_id")
            # Both variants use identical insert columns, so mixed batches stay
            # deterministic and cannot derive persistence fields from input keys.
            rows.append(
                {
                    column.name: row.get(column.name)
                    for column in SuggestionPerformanceSample.__table__.columns
                    if column.name != "created_at"
                }
            )
        async with self.database.session() as session, session.begin():
            await session.execute(text("SET LOCAL statement_timeout = '800ms'"))
            await session.execute(
                delete(SuggestionPerformanceSample).where(
                    SuggestionPerformanceSample.id.in_(_expired_ids(INGEST_PRUNE_LIMIT))
                )
            )
            result = await session.execute(
                insert(SuggestionPerformanceSample)
                .values(rows)
                .on_conflict_do_nothing(index_elements=[SuggestionPerformanceSample.id])
                .returning(SuggestionPerformanceSample.id)
            )
            return len(result.scalars().all())

    async def cleanup_expired(self) -> PerformanceCleanupResult:
        async with self.database.session() as session, session.begin():
            await session.execute(text("SET LOCAL statement_timeout = '4s'"))
            deleted = (
                (
                    await session.execute(
                        delete(SuggestionPerformanceSample)
                        .where(
                            SuggestionPerformanceSample.id.in_(_expired_ids(CLEANUP_PRUNE_LIMIT))
                        )
                        .returning(SuggestionPerformanceSample.id)
                    )
                )
                .scalars()
                .all()
            )
            remaining = (
                await session.execute(
                    select(func.count())
                    .select_from(SuggestionPerformanceSample)
                    .where(
                        SuggestionPerformanceSample.created_at
                        < func.now() - text("interval '30 days'")
                    )
                )
            ).scalar_one()
            return PerformanceCleanupResult(len(deleted), remaining)
