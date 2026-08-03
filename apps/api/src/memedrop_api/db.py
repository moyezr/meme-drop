from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from pgvector.sqlalchemy import Vector
from sqlalchemy import Boolean, DateTime, ForeignKey, Index, Integer, String, Text, text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def normalize_database_url(url: str) -> str:
    if url.startswith("postgresql+psycopg://"):
        return url
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    return url


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    email: Mapped[str] = mapped_column(Text, unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class Meme(Base):
    __tablename__ = "memes"
    __table_args__ = (
        Index("idx_memes_format_type", "format_type"),
        Index(
            "idx_memes_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(Text)
    file_path: Mapped[str] = mapped_column(Text)
    format_type: Mapped[str] = mapped_column(String(40))
    is_evergreen: Mapped[bool] = mapped_column(Boolean, default=True, server_default=text("true"))
    system_tags: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class UserMeme(Base):
    __tablename__ = "user_memes"
    __table_args__ = (Index("idx_user_memes_user_id", "user_id"),)

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    global_meme_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("memes.id", ondelete="SET NULL"), nullable=True
    )
    file_path: Mapped[str] = mapped_column(Text)
    user_name: Mapped[str] = mapped_column(Text)
    user_tags: Mapped[list[str]] = mapped_column(
        ARRAY(Text), default=list, server_default=text("'{}'::text[]")
    )
    system_tags: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)
    use_count: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class UsageEvent(Base):
    __tablename__ = "usage_events"
    __table_args__ = (
        Index("idx_usage_events_user_id", "user_id"),
        Index("idx_usage_events_user_action_created_at", "user_id", "action", "created_at"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    user_meme_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("user_memes.id", ondelete="SET NULL"), nullable=True
    )
    global_meme_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("memes.id", ondelete="SET NULL"), nullable=True
    )
    action: Mapped[str] = mapped_column(String(20))
    tweet_context: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class Database:
    def __init__(self, database_url: str) -> None:
        self.engine: AsyncEngine = create_async_engine(
            normalize_database_url(database_url), pool_pre_ping=True
        )
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)

    async def session(self) -> AsyncIterator[AsyncSession]:
        async with self.sessions() as session:
            yield session

    async def is_ready(self) -> bool:
        try:
            async with asyncio.timeout(1):
                async with self.engine.connect() as connection:
                    result = await connection.execute(text("SELECT 1"))
                    return result.scalar_one() == 1
        except Exception:
            return False

    async def close(self) -> None:
        await self.engine.dispose()
