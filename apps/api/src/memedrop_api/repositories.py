from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import UUID

from sqlalchemy import String, and_, asc, cast, delete, desc, func, or_, select, update

from memedrop_api.db import Database, InstallUser, Meme, UsageEvent, UserMeme

JsonRecord = dict[str, Any]


@dataclass(frozen=True)
class UsageEventData:
    meme_id: UUID
    action: str
    tweet_context: Mapping[str, Any]
    source: str | None


class BackendStore(Protocol):
    async def ensure_install_user(self, user_id: UUID) -> None: ...

    async def browse_memes(
        self, *, format_type: str | None, emotion: str | None, search: str | None
    ) -> list[JsonRecord]: ...

    async def list_global_memes(self) -> list[JsonRecord]: ...

    async def get_global_meme(self, meme_id: UUID) -> JsonRecord | None: ...

    async def global_meme_feedback_scores(self, user_id: UUID) -> dict[str, float]: ...

    async def create_user_meme(
        self,
        *,
        user_id: UUID,
        file_path: str,
        user_name: str,
        system_tags: Mapping[str, Any],
    ) -> JsonRecord: ...

    async def list_user_memes(
        self,
        user_id: UUID,
        *,
        search: str | None,
        tag: str | None,
        emotion: str | None,
        sort: str,
    ) -> list[JsonRecord]: ...

    async def update_user_meme(
        self,
        user_id: UUID,
        meme_id: UUID,
        *,
        user_name: str | None,
        user_tags: list[str] | None,
    ) -> JsonRecord | None: ...

    async def delete_user_meme(self, user_id: UUID, meme_id: UUID) -> JsonRecord | None: ...

    async def record_usage(
        self,
        *,
        user_id: UUID,
        meme_id: UUID,
        action: str,
        tweet_context: Mapping[str, Any],
        source: str | None,
    ) -> None: ...

    async def record_usage_batch(
        self, *, user_id: UUID, events: Sequence[UsageEventData]
    ) -> None: ...

    async def export_account(self, user_id: UUID) -> tuple[list[JsonRecord], list[JsonRecord]]: ...

    async def delete_account(self, user_id: UUID) -> tuple[list[JsonRecord], int, int, bool]: ...


class SqlAlchemyStore:
    def __init__(self, database: Database) -> None:
        self.database = database

    async def ensure_install_user(self, user_id: UUID) -> None:
        async with self.database.session() as session, session.begin():
            existing = await session.get(InstallUser, user_id)
            if existing is None:
                session.add(
                    InstallUser(
                        id=user_id,
                        email=f"install-{user_id}@anonymous.memedrop.local",
                    )
                )

    async def browse_memes(
        self, *, format_type: str | None, emotion: str | None, search: str | None
    ) -> list[JsonRecord]:
        statement = select(Meme)
        conditions = []
        if format_type:
            conditions.append(Meme.format_type == format_type)
        if emotion:
            conditions.append(Meme.system_tags["emotion"].astext == emotion)
        if search:
            conditions.append(Meme.name.ilike(f"%{search}%"))
        if conditions:
            statement = statement.where(and_(*conditions))
        statement = statement.order_by(desc(Meme.created_at))
        async with self.database.session() as session:
            rows = (await session.scalars(statement)).all()
        return [meme_record(row) for row in rows]

    async def list_global_memes(self) -> list[JsonRecord]:
        async with self.database.session() as session:
            rows = (await session.scalars(select(Meme).order_by(asc(Meme.name)))).all()
        return [meme_record(row) for row in rows]

    async def get_global_meme(self, meme_id: UUID) -> JsonRecord | None:
        async with self.database.session() as session:
            row = await session.get(Meme, meme_id)
        return meme_record(row) if row else None

    async def global_meme_feedback_scores(self, user_id: UUID) -> dict[str, float]:
        statement = (
            select(UsageEvent.global_meme_id, UsageEvent.action, func.count(UsageEvent.id))
            .where(and_(UsageEvent.user_id == user_id, UsageEvent.global_meme_id.is_not(None)))
            .group_by(UsageEvent.global_meme_id, UsageEvent.action)
        )
        async with self.database.session() as session:
            rows = (await session.execute(statement)).all()
        grouped: dict[str, dict[str, int]] = {}
        for meme_id, action, count in rows:
            grouped.setdefault(str(meme_id), {})[str(action)] = int(count)
        return {
            meme_id: feedback_ranking_boost(actions)
            for meme_id, actions in grouped.items()
            if actions.get("shown", 0) + actions.get("suggested", 0) >= 5
        }

    async def create_user_meme(
        self,
        *,
        user_id: UUID,
        file_path: str,
        user_name: str,
        system_tags: Mapping[str, Any],
    ) -> JsonRecord:
        row = UserMeme(
            user_id=user_id,
            file_path=file_path,
            user_name=user_name,
            user_tags=[],
            system_tags=dict(system_tags),
            use_count=0,
        )
        async with self.database.session() as session, session.begin():
            session.add(row)
            await session.flush()
            await session.refresh(row)
        return user_meme_record(row)

    async def list_user_memes(
        self,
        user_id: UUID,
        *,
        search: str | None,
        tag: str | None,
        emotion: str | None,
        sort: str,
    ) -> list[JsonRecord]:
        conditions = [UserMeme.user_id == user_id]
        if search:
            pattern = f"%{search}%"
            conditions.append(
                or_(
                    UserMeme.user_name.ilike(pattern),
                    func.array_to_string(UserMeme.user_tags, ",").ilike(pattern),
                    cast(UserMeme.system_tags, String).ilike(pattern),
                )
            )
        if emotion:
            conditions.append(UserMeme.system_tags["emotion"].astext == emotion)
        if tag:
            conditions.append(UserMeme.system_tags["use_cases"].has_key(tag))  # type: ignore[attr-defined]

        order = (
            desc(UserMeme.use_count)
            if sort == "most_used"
            else asc(UserMeme.user_name)
            if sort == "alphabetical"
            else desc(UserMeme.created_at)
        )
        statement = select(UserMeme).where(and_(*conditions)).order_by(order)
        async with self.database.session() as session:
            rows = (await session.scalars(statement)).all()
        return [user_meme_record(row) for row in rows]

    async def update_user_meme(
        self,
        user_id: UUID,
        meme_id: UUID,
        *,
        user_name: str | None,
        user_tags: list[str] | None,
    ) -> JsonRecord | None:
        values: dict[str, Any] = {}
        if user_name is not None:
            values["user_name"] = user_name
        if user_tags is not None:
            values["user_tags"] = user_tags
        statement = (
            update(UserMeme)
            .where(and_(UserMeme.id == meme_id, UserMeme.user_id == user_id))
            .values(**values)
            .returning(UserMeme)
        )
        async with self.database.session() as session, session.begin():
            row = (await session.scalars(statement)).one_or_none()
        return user_meme_record(row) if row else None

    async def delete_user_meme(self, user_id: UUID, meme_id: UUID) -> JsonRecord | None:
        statement = (
            delete(UserMeme)
            .where(and_(UserMeme.id == meme_id, UserMeme.user_id == user_id))
            .returning(UserMeme)
        )
        async with self.database.session() as session, session.begin():
            row = (await session.scalars(statement)).one_or_none()
        return user_meme_record(row) if row else None

    async def record_usage(
        self,
        *,
        user_id: UUID,
        meme_id: UUID,
        action: str,
        tweet_context: Mapping[str, Any],
        source: str | None,
    ) -> None:
        await self.record_usage_batch(
            user_id=user_id,
            events=[
                UsageEventData(
                    meme_id=meme_id,
                    action=action,
                    tweet_context=tweet_context,
                    source=source,
                )
            ],
        )

    async def record_usage_batch(
        self, *, user_id: UUID, events: Sequence[UsageEventData]
    ) -> None:
        if not events:
            return
        async with self.database.session() as session, session.begin():
            unresolved_ids = {event.meme_id for event in events if event.source is None}
            user_meme_ids: set[UUID] = set()
            if unresolved_ids:
                user_meme_ids = set(
                    (
                        await session.scalars(
                            select(UserMeme.id).where(
                                and_(
                                    UserMeme.user_id == user_id,
                                    UserMeme.id.in_(unresolved_ids),
                                )
                            )
                        )
                    ).all()
                )
            resolved_events = [
                (
                    event,
                    event.source or ("user" if event.meme_id in user_meme_ids else "global"),
                )
                for event in events
            ]
            session.add_all(
                [
                    UsageEvent(
                        user_id=user_id,
                        user_meme_id=event.meme_id if source == "user" else None,
                        global_meme_id=event.meme_id if source == "global" else None,
                        action=event.action,
                        tweet_context=dict(event.tweet_context),
                    )
                    for event, source in resolved_events
                ]
            )
            used_user_meme_counts: dict[UUID, int] = {}
            for event, source in resolved_events:
                if source == "user" and event.action in {"used", "inserted"}:
                    used_user_meme_counts[event.meme_id] = (
                        used_user_meme_counts.get(event.meme_id, 0) + 1
                    )
            for meme_id, use_increment in used_user_meme_counts.items():
                await session.execute(
                    update(UserMeme)
                    .where(
                        and_(
                            UserMeme.id == meme_id,
                            UserMeme.user_id == user_id,
                        )
                    )
                    .values(
                        use_count=UserMeme.use_count + use_increment,
                        last_used_at=datetime.now(UTC),
                    )
                )

    async def export_account(self, user_id: UUID) -> tuple[list[JsonRecord], list[JsonRecord]]:
        async with self.database.session() as session:
            library = (
                await session.scalars(select(UserMeme).where(UserMeme.user_id == user_id))
            ).all()
            usage = (
                await session.scalars(select(UsageEvent).where(UsageEvent.user_id == user_id))
            ).all()
        return (
            [user_meme_record(row) for row in library],
            [usage_event_record(row) for row in usage],
        )

    async def delete_account(self, user_id: UUID) -> tuple[list[JsonRecord], int, int, bool]:
        async with self.database.session() as session, session.begin():
            memes = (
                await session.scalars(select(UserMeme).where(UserMeme.user_id == user_id))
            ).all()
            deleted_usage = await session.execute(
                delete(UsageEvent).where(UsageEvent.user_id == user_id).returning(UsageEvent.id)
            )
            deleted_memes = await session.execute(
                delete(UserMeme).where(UserMeme.user_id == user_id).returning(UserMeme.id)
            )
            deleted_user = await session.execute(
                delete(InstallUser)
                .where(
                    and_(
                        InstallUser.id == user_id,
                        InstallUser.email == f"install-{user_id}@anonymous.memedrop.local",
                    )
                )
                .returning(InstallUser.id)
            )
            return (
                [user_meme_record(row) for row in memes],
                len(deleted_memes.all()),
                len(deleted_usage.all()),
                deleted_user.first() is not None,
            )


def meme_record(row: Meme) -> JsonRecord:
    return {
        "id": str(row.id),
        "name": row.name,
        "filePath": row.file_path,
        "formatType": row.format_type,
        "isEvergreen": row.is_evergreen,
        "systemTags": row.system_tags,
        "embedding": row.embedding,
        "sourceUrl": row.source_url,
        "createdAt": row.created_at.isoformat(),
    }


def user_meme_record(row: UserMeme) -> JsonRecord:
    return {
        "id": str(row.id),
        "userId": str(row.user_id),
        "globalMemeId": str(row.global_meme_id) if row.global_meme_id else None,
        "filePath": row.file_path,
        "userName": row.user_name,
        "userTags": row.user_tags,
        "systemTags": row.system_tags,
        "embedding": row.embedding,
        "useCount": row.use_count,
        "lastUsedAt": row.last_used_at.isoformat() if row.last_used_at else None,
        "createdAt": row.created_at.isoformat(),
    }


def usage_event_record(row: UsageEvent) -> JsonRecord:
    return {
        "id": str(row.id),
        "userId": str(row.user_id),
        "userMemeId": str(row.user_meme_id) if row.user_meme_id else None,
        "globalMemeId": str(row.global_meme_id) if row.global_meme_id else None,
        "action": row.action,
        "tweetContext": row.tweet_context,
        "createdAt": row.created_at.isoformat(),
    }


def feedback_ranking_boost(actions: Mapping[str, int]) -> float:
    shown = max(1, actions.get("shown", 0) + actions.get("suggested", 0))
    used = actions.get("used", 0) + actions.get("inserted", 0)
    positive = used + actions.get("saved", 0) * 0.8 + actions.get("clicked", 0) * 0.25
    negative = actions.get("dismissed", 0) * 0.2
    return max(-0.12, min(0.12, (positive - negative) / shown * 0.3))
