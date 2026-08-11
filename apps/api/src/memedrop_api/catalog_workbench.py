from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import UUID

from sqlalchemy import and_, desc, func, or_, select, update
from sqlalchemy.exc import IntegrityError

from memedrop_api.db import CatalogDraft, Database

CatalogRecord = dict[str, Any]


class CatalogDraftConflict(Exception):
    pass


class CatalogDraftStore(Protocol):
    async def list_drafts(
        self, *, status: str | None, search: str | None
    ) -> list[CatalogRecord]: ...

    async def get_draft(self, draft_id: UUID) -> CatalogRecord | None: ...

    async def create_draft(
        self,
        *,
        template_id: str,
        name: str,
        asset_path: str,
        thumbnail_path: str | None,
        source_url: str | None,
        annotation: Mapping[str, Any],
    ) -> CatalogRecord: ...

    async def update_draft(
        self,
        draft_id: UUID,
        *,
        expected_revision: int,
        status: str,
        annotation: Mapping[str, Any],
    ) -> CatalogRecord | None: ...


class SqlAlchemyCatalogDraftStore:
    def __init__(self, database: Database) -> None:
        self.database = database

    async def list_drafts(self, *, status: str | None, search: str | None) -> list[CatalogRecord]:
        statement = select(CatalogDraft)
        conditions = []
        if status:
            conditions.append(CatalogDraft.status == status)
        if search:
            pattern = f"%{search}%"
            conditions.append(
                or_(
                    CatalogDraft.name.ilike(pattern),
                    CatalogDraft.template_id.ilike(pattern),
                )
            )
        if conditions:
            statement = statement.where(and_(*conditions))
        statement = statement.order_by(desc(CatalogDraft.updated_at), CatalogDraft.template_id)
        async with self.database.session() as session:
            rows = (await session.scalars(statement)).all()
        return [catalog_draft_record(row) for row in rows]

    async def get_draft(self, draft_id: UUID) -> CatalogRecord | None:
        async with self.database.session() as session:
            row = await session.get(CatalogDraft, draft_id)
        return catalog_draft_record(row) if row else None

    async def create_draft(
        self,
        *,
        template_id: str,
        name: str,
        asset_path: str,
        thumbnail_path: str | None,
        source_url: str | None,
        annotation: Mapping[str, Any],
    ) -> CatalogRecord:
        row = CatalogDraft(
            template_id=template_id,
            name=name,
            status="draft",
            asset_path=asset_path,
            thumbnail_path=thumbnail_path,
            source_url=source_url,
            annotation=dict(annotation),
            revision=1,
        )
        try:
            async with self.database.session() as session, session.begin():
                session.add(row)
                await session.flush()
                await session.refresh(row)
        except IntegrityError as error:
            raise CatalogDraftConflict(f'Template id "{template_id}" already exists') from error
        return catalog_draft_record(row)

    async def update_draft(
        self,
        draft_id: UUID,
        *,
        expected_revision: int,
        status: str,
        annotation: Mapping[str, Any],
    ) -> CatalogRecord | None:
        annotation_value = dict(annotation)
        statement = (
            update(CatalogDraft)
            .where(
                and_(
                    CatalogDraft.id == draft_id,
                    CatalogDraft.revision == expected_revision,
                )
            )
            .values(
                name=str(annotation_value["name"]),
                status=status,
                annotation=annotation_value,
                revision=CatalogDraft.revision + 1,
                updated_at=datetime.now(UTC),
            )
            .returning(CatalogDraft)
        )
        async with self.database.session() as session, session.begin():
            row = (await session.scalars(statement)).one_or_none()
            if row is None:
                exists = await session.scalar(
                    select(func.count())
                    .select_from(CatalogDraft)
                    .where(CatalogDraft.id == draft_id)
                )
                if exists:
                    raise CatalogDraftConflict(
                        "This draft changed in another tab. Reload it before saving."
                    )
        return catalog_draft_record(row) if row else None


def catalog_draft_record(row: CatalogDraft) -> CatalogRecord:
    return {
        "id": str(row.id),
        "template_id": row.template_id,
        "name": row.name,
        "status": row.status,
        "asset_path": row.asset_path,
        "thumbnail_path": row.thumbnail_path,
        "source_url": row.source_url,
        "annotation": dict(row.annotation or {}),
        "revision": row.revision,
        "created_at": row.created_at.isoformat(),
        "updated_at": row.updated_at.isoformat(),
    }
