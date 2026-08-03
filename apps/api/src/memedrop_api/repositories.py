from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any, Protocol
from uuid import UUID

from sqlalchemy import String, and_, asc, cast, delete, desc, func, or_, select, update

from memedrop_api.db import Database, Meme, UsageEvent, User, UserMeme

JsonRecord = dict[str, Any]


class BackendStore(Protocol):
    async def ensure_install_user(self, user_id: UUID) -> None: ...

    async def browse_memes(
        self, *, format_type: str | None, emotion: str | None, search: str | None
    ) -> list[JsonRecord]: ...

    async def list_global_memes(self) -> list[JsonRecord]: ...

    async def get_global_meme(self, meme_id: UUID) -> JsonRecord | None: ...

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

    async def export_account(self, user_id: UUID) -> tuple[list[JsonRecord], list[JsonRecord]]: ...

    async def delete_account(self, user_id: UUID) -> tuple[list[JsonRecord], int, int, bool]: ...


class SqlAlchemyStore:
    def __init__(self, database: Database) -> None:
        self.database = database

    async def ensure_install_user(self, user_id: UUID) -> None:
        async with self.database.session() as session, session.begin():
            existing = await session.get(User, user_id)
            if existing is None:
                session.add(
                    User(
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
        async with self.database.session() as session, session.begin():
            resolved_source = source
            if resolved_source is None:
                found = await session.scalar(
                    select(UserMeme.id).where(
                        and_(UserMeme.id == meme_id, UserMeme.user_id == user_id)
                    )
                )
                resolved_source = "user" if found else "global"
            session.add(
                UsageEvent(
                    user_id=user_id,
                    user_meme_id=meme_id if resolved_source == "user" else None,
                    global_meme_id=meme_id if resolved_source == "global" else None,
                    action=action,
                    tweet_context=dict(tweet_context),
                )
            )
            if action in {"used", "inserted"} and resolved_source == "user":
                await session.execute(
                    update(UserMeme)
                    .where(and_(UserMeme.id == meme_id, UserMeme.user_id == user_id))
                    .values(
                        use_count=UserMeme.use_count + 1,
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
                delete(User)
                .where(
                    and_(
                        User.id == user_id,
                        User.email == f"install-{user_id}@anonymous.memedrop.local",
                    )
                )
                .returning(User.id)
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
