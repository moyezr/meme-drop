"""Durable ownership records for public-agent generated images.

Asset rows intentionally store no caption, source post, or alt text.  They are
the replay source for a finished agent generation and the authorization source
for the private media endpoint.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

from sqlalchemy import select

from memedrop_api.db import Database, GeneratedAsset


class GeneratedAssetNotFound(ValueError):
    """The asset is absent, expired, deleted, or belongs to another tenant."""


class GeneratedAssetExpired(ValueError):
    """The asset exists for this tenant but is expired or no longer active."""


@dataclass(frozen=True, slots=True)
class AgentGeneratedAsset:
    """The minimal durable data required to authorize and serve one image."""

    id: str
    agent_account_id: str
    generation_id: str
    object_key: str
    content_type: str
    content_hash: str
    expires_at: datetime


class AgentGeneratedAssetStore(Protocol):
    """Persistence operations required by the agent generation HTTP boundary."""

    async def list_for_generation(
        self, *, account_id: str, generation_id: str, as_of: datetime | None = None
    ) -> list[AgentGeneratedAsset]: ...

    async def get_for_serving(
        self, *, account_id: str, asset_id: str, as_of: datetime | None = None
    ) -> AgentGeneratedAsset: ...

    async def has_any_for_generation(self, *, account_id: str, generation_id: str) -> bool: ...


class SqlAlchemyAgentGeneratedAssetStore:
    """Own and retrieve generated images with tenant and expiry predicates."""

    def __init__(
        self,
        database: Database,
        *,
        now: Callable[[], datetime] | None = None,
    ) -> None:
        self._database = database
        self._now = now or (lambda: datetime.now(UTC))

    async def list_for_generation(
        self, *, account_id: str, generation_id: str, as_of: datetime | None = None
    ) -> list[AgentGeneratedAsset]:
        current = _require_aware(as_of or self._now())
        async with self._database.session() as session:
            rows = (
                await session.scalars(
                    select(GeneratedAsset)
                    .where(
                        GeneratedAsset.agent_account_id == account_id,
                        GeneratedAsset.generation_id == generation_id,
                        GeneratedAsset.deletion_state == "active",
                        GeneratedAsset.expires_at > current,
                    )
                    .order_by(GeneratedAsset.object_key, GeneratedAsset.id)
                )
            ).all()
        return [_asset_record(row) for row in rows]

    async def get_for_serving(
        self, *, account_id: str, asset_id: str, as_of: datetime | None = None
    ) -> AgentGeneratedAsset:
        current = _require_aware(as_of or self._now())
        async with self._database.session() as session:
            row = await session.scalar(
                select(GeneratedAsset).where(
                    GeneratedAsset.id == asset_id,
                    GeneratedAsset.agent_account_id == account_id,
                )
            )
        if row is None:
            raise GeneratedAssetNotFound("generated asset not found")
        if row.deletion_state != "active" or row.expires_at <= current:
            raise GeneratedAssetExpired("generated asset is expired")
        return _asset_record(row)

    async def has_any_for_generation(self, *, account_id: str, generation_id: str) -> bool:
        async with self._database.session() as session:
            row = await session.scalar(
                select(GeneratedAsset.id).where(
                    GeneratedAsset.agent_account_id == account_id,
                    GeneratedAsset.generation_id == generation_id,
                )
            )
        return row is not None


def _asset_record(row: GeneratedAsset) -> AgentGeneratedAsset:
    return AgentGeneratedAsset(
        id=row.id,
        agent_account_id=row.agent_account_id,
        generation_id=row.generation_id,
        object_key=row.object_key,
        content_type=row.content_type,
        content_hash=row.content_hash,
        expires_at=_require_aware(row.expires_at),
    )


def _require_aware(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("generated asset time must be timezone-aware")
    return value
