from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import datetime
from typing import Any
from uuid import UUID, uuid4

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    DateTime,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from memedrop_api.public_ids import PublicIdKind, create_public_id


def normalize_database_url(url: str) -> str:
    if url.startswith("postgresql+psycopg://"):
        return url
    if url.startswith("postgresql://"):
        return url.replace("postgresql://", "postgresql+psycopg://", 1)
    if url.startswith("postgres://"):
        return url.replace("postgres://", "postgresql+psycopg://", 1)
    return url


def database_connect_args(url: str) -> dict[str, Any]:
    parsed = make_url(normalize_database_url(url))
    if parsed.port == 6543:
        return {"prepare_threshold": None}
    return {}


class Base(DeclarativeBase):
    pass


class InstallUser(Base):
    """Anonymous extension installation identity kept separate from customers."""

    __tablename__ = "install_users"

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
        ForeignKey("install_users.id", ondelete="CASCADE"), nullable=False
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
        ForeignKey("install_users.id", ondelete="CASCADE"), nullable=False
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


class CatalogDraft(Base):
    """Human-owned catalog work that is deliberately separate from runtime memes."""

    __tablename__ = "catalog_drafts"
    __table_args__ = (
        CheckConstraint(
            "status IN ('draft', 'in_review', 'needs_work', 'approved', 'rejected')",
            name="catalog_drafts_status_check",
        ),
        Index("idx_catalog_drafts_status_updated_at", "status", "updated_at"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    template_id: Mapped[str] = mapped_column(String(120), unique=True)
    name: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="draft", server_default=text("'draft'"))
    asset_path: Mapped[str] = mapped_column(Text)
    thumbnail_path: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    annotation: Mapped[dict[str, Any]] = mapped_column(
        JSONB, default=dict, server_default=text("'{}'::jsonb")
    )
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class TrendCardRecord(Base):
    """Current normalized trend state; source material lives only as hashed evidence."""

    __tablename__ = "trend_cards"
    __table_args__ = (
        CheckConstraint(
            "lifecycle IN ('emerging', 'rising', 'established', 'cooling', 'dormant')",
            name="trend_cards_lifecycle_check",
        ),
        CheckConstraint(
            "duration_class IN ('flash', 'fast', 'persistent', 'recurring')",
            name="trend_cards_duration_class_check",
        ),
        CheckConstraint(
            "confidence >= 0 AND confidence <= 1",
            name="trend_cards_confidence_check",
        ),
        CheckConstraint(
            "momentum >= 0 AND momentum <= 1",
            name="trend_cards_momentum_check",
        ),
        CheckConstraint(
            "vitality >= 0 AND vitality <= 1",
            name="trend_cards_vitality_check",
        ),
        CheckConstraint(
            "source_count >= 1 AND observation_count >= source_count",
            name="trend_cards_evidence_counts_check",
        ),
        CheckConstraint(
            "recurrence_count >= 0 AND version >= 1",
            name="trend_cards_version_counts_check",
        ),
        CheckConstraint(
            "last_confirmed_at >= first_seen_at AND expires_at > last_confirmed_at",
            name="trend_cards_timestamps_check",
        ),
        CheckConstraint(
            "(embedding IS NULL AND embedding_model IS NULL AND embedding_fingerprint IS NULL) "
            "OR (embedding IS NOT NULL AND embedding_model IS NOT NULL "
            "AND embedding_fingerprint ~ '^[a-f0-9]{64}$')",
            name="trend_cards_embedding_metadata_check",
        ),
        Index("idx_trend_cards_lifecycle_expires_at", "lifecycle", "expires_at"),
        Index("idx_trend_cards_last_confirmed_at", "last_confirmed_at"),
        Index("idx_trend_cards_aliases_gin", "aliases", postgresql_using="gin"),
        Index("idx_trend_cards_entities_gin", "entities", postgresql_using="gin"),
        Index("idx_trend_cards_topics_gin", "topics", postgresql_using="gin"),
        Index(
            "idx_trend_cards_embedding_hnsw",
            "embedding",
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True)
    key: Mapped[str] = mapped_column(String(160), unique=True)
    name: Mapped[str] = mapped_column(Text)
    premise: Mapped[str] = mapped_column(Text)
    aliases: Mapped[list[str]] = mapped_column(
        ARRAY(Text), default=list, server_default=text("'{}'::text[]")
    )
    entities: Mapped[list[str]] = mapped_column(
        ARRAY(Text), default=list, server_default=text("'{}'::text[]")
    )
    topics: Mapped[list[str]] = mapped_column(
        ARRAY(Text), default=list, server_default=text("'{}'::text[]")
    )
    communities: Mapped[list[str]] = mapped_column(
        ARRAY(Text), default=list, server_default=text("'{}'::text[]")
    )
    recognition_cues: Mapped[list[str]] = mapped_column(
        ARRAY(Text), default=list, server_default=text("'{}'::text[]")
    )
    comic_tensions: Mapped[list[str]] = mapped_column(
        ARRAY(Text), default=list, server_default=text("'{}'::text[]")
    )
    usage_guidance: Mapped[str] = mapped_column(Text)
    avoid_guidance: Mapped[list[str]] = mapped_column(
        ARRAY(Text), default=list, server_default=text("'{}'::text[]")
    )
    lifecycle: Mapped[str] = mapped_column(String(20))
    duration_class: Mapped[str] = mapped_column(String(20))
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_confirmed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    confidence: Mapped[float] = mapped_column(Float)
    momentum: Mapped[float] = mapped_column(Float)
    vitality: Mapped[float] = mapped_column(Float)
    source_count: Mapped[int] = mapped_column(Integer)
    observation_count: Mapped[int] = mapped_column(Integer)
    recurrence_count: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    version: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"))
    embedding: Mapped[list[float] | None] = mapped_column(Vector(1536), nullable=True)
    embedding_model: Mapped[str | None] = mapped_column(String(120), nullable=True)
    embedding_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class TrendObservationRecord(Base):
    """Idempotent provenance metadata; deliberately excludes source titles and bodies."""

    __tablename__ = "trend_observations"
    __table_args__ = (
        UniqueConstraint("trend_id", "observation_key", name="uq_trend_observations_trend_key"),
        CheckConstraint("seen_count >= 1", name="trend_observations_seen_count_check"),
        CheckConstraint(
            "provider_score IS NULL OR (provider_score >= 0 AND provider_score <= 1)",
            name="trend_observations_provider_score_check",
        ),
        CheckConstraint(
            "last_seen_at >= first_seen_at",
            name="trend_observations_timestamps_check",
        ),
        Index("idx_trend_observations_trend_last_seen", "trend_id", "last_seen_at"),
        Index("idx_trend_observations_source_url_hash", "source_url_hash"),
        Index("idx_trend_observations_source_domain", "source_domain"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True)
    trend_id: Mapped[UUID] = mapped_column(
        ForeignKey("trend_cards.id", ondelete="CASCADE"), nullable=False
    )
    observation_key: Mapped[str] = mapped_column(String(64))
    provider: Mapped[str] = mapped_column(String(40))
    source_url: Mapped[str] = mapped_column(Text)
    source_url_hash: Mapped[str] = mapped_column(String(64))
    source_domain: Mapped[str] = mapped_column(String(255))
    content_hash: Mapped[str] = mapped_column(String(64))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    last_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    seen_count: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"))
    provider_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    provider_result_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    query_fingerprint: Mapped[str | None] = mapped_column(String(64), nullable=True)


class TrendSnapshotRecord(Base):
    """Immutable serving payload for atomic Redis publication and repeatable evaluations."""

    __tablename__ = "trend_snapshots"
    __table_args__ = (
        CheckConstraint("version >= 1", name="trend_snapshots_version_check"),
        CheckConstraint("schema_version >= 1", name="trend_snapshots_schema_version_check"),
        CheckConstraint("card_count >= 0", name="trend_snapshots_card_count_check"),
        CheckConstraint(
            "published_at IS NULL OR published_at >= created_at",
            name="trend_snapshots_timestamps_check",
        ),
        Index("idx_trend_snapshots_published_at", "published_at"),
    )

    version: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=False)
    schema_version: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"))
    fingerprint: Mapped[str] = mapped_column(String(64), unique=True)
    card_count: Mapped[int] = mapped_column(Integer)
    cards: Mapped[list[dict[str, Any]]] = mapped_column(JSONB)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class TrendScanQueryRecord(Base):
    """Opaque, leased collector work; query text must never be persisted here."""

    __tablename__ = "trend_scan_queries"
    __table_args__ = (
        CheckConstraint(
            "status IN ('claimed', 'released', 'completed')",
            name="trend_scan_queries_status_check",
        ),
        CheckConstraint(
            "attempt_count >= 1 AND cards_upserted >= 0 AND observations_stored >= 0",
            name="trend_scan_queries_counts_check",
        ),
        CheckConstraint(
            "(status = 'claimed' AND claimed_by IS NOT NULL "
            "AND lease_expires_at IS NOT NULL AND completed_at IS NULL) OR "
            "(status = 'released' AND claimed_by IS NULL "
            "AND lease_expires_at IS NULL AND completed_at IS NULL) OR "
            "(status = 'completed' AND claimed_by IS NULL "
            "AND lease_expires_at IS NULL AND completed_at IS NOT NULL)",
            name="trend_scan_queries_state_check",
        ),
        Index("idx_trend_scan_queries_status_lease", "status", "lease_expires_at"),
    )

    scan_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    query_fingerprint: Mapped[str] = mapped_column(String(64), primary_key=True)
    status: Mapped[str] = mapped_column(String(20))
    claimed_by: Mapped[str | None] = mapped_column(String(64), nullable=True)
    claimed_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))
    lease_expires_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    attempt_count: Mapped[int] = mapped_column(Integer, default=1, server_default=text("1"))
    cards_upserted: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    observations_stored: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))


class TrendCreditPeriodRecord(Base):
    """Monthly aggregate used to enforce the application-side Tavily ceiling."""

    __tablename__ = "trend_credit_periods"
    __table_args__ = (
        CheckConstraint(
            "period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'",
            name="trend_credit_periods_period_check",
        ),
        CheckConstraint("reserved_credits >= 0", name="trend_credit_periods_credits_check"),
    )

    period: Mapped[str] = mapped_column(String(7), primary_key=True)
    reserved_credits: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class TrendCreditReservationRecord(Base):
    """Idempotency ledger for provider-credit reservations."""

    __tablename__ = "trend_credit_reservations"
    __table_args__ = (
        CheckConstraint("credits > 0", name="trend_credit_reservations_credits_check"),
        Index("idx_trend_credit_reservations_period", "period"),
    )

    reservation_id: Mapped[str] = mapped_column(String(128), primary_key=True)
    period: Mapped[str] = mapped_column(
        ForeignKey("trend_credit_periods.period", ondelete="CASCADE"), nullable=False
    )
    credits: Mapped[int] = mapped_column(Integer)
    reserved_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))


class User(Base):
    """A customer who owns credentials, credits, generations, and assets."""

    __tablename__ = "users"
    __table_args__ = (
        CheckConstraint(
            "id ~ '^u_[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{12}$'",
            name="users_id_format_check",
        ),
        CheckConstraint("credits >= 0", name="users_credits_check"),
        UniqueConstraint("auth_provider", "auth_subject", name="uq_users_auth_identity"),
    )

    id: Mapped[str] = mapped_column(
        String(14), primary_key=True, default=lambda: create_public_id(PublicIdKind.USER).value
    )
    auth_provider: Mapped[str] = mapped_column(String(30))
    auth_subject: Mapped[str] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(320), nullable=True)
    credits: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class ApiKey(Base):
    """A user-owned API credential; the plaintext secret is never stored."""

    __tablename__ = "api_keys"
    __table_args__ = (
        CheckConstraint(
            "id ~ '^k_[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{12}$'",
            name="api_keys_id_format_check",
        ),
        CheckConstraint(
            "last_used_at IS NULL OR last_used_at >= created_at",
            name="api_keys_last_used_at_check",
        ),
        CheckConstraint(
            "revoked_at IS NULL OR revoked_at >= created_at", name="api_keys_revoked_at_check"
        ),
        UniqueConstraint("secret_hash", name="uq_api_keys_secret_hash"),
        UniqueConstraint("id", "user_id", name="uq_api_keys_id_user"),
        Index("idx_api_keys_user_created_at", "user_id", "created_at"),
    )

    id: Mapped[str] = mapped_column(
        String(14), primary_key=True, default=lambda: create_public_id(PublicIdKind.API_KEY).value
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    name: Mapped[str] = mapped_column(String(120))
    secret_hash: Mapped[bytes] = mapped_column(LargeBinary(32))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Generation(Base):
    """One idempotent user generation without source-post plaintext."""

    __tablename__ = "generations"
    __table_args__ = (
        CheckConstraint(
            "id ~ '^g_[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{12}$'",
            name="generations_id_format_check",
        ),
        CheckConstraint(
            "status IN ('processing', 'succeeded', 'no_fit', 'failed', 'cancelled')",
            name="generations_status_check",
        ),
        CheckConstraint("reserved_credits BETWEEN 1 AND 5", name="generations_reserved_check"),
        CheckConstraint(
            "(status = 'processing' AND completed_at IS NULL AND failure_code IS NULL) OR "
            "(status IN ('succeeded', 'no_fit') AND completed_at IS NOT NULL "
            "AND failure_code IS NULL) OR "
            "(status IN ('failed', 'cancelled') AND completed_at IS NOT NULL "
            "AND failure_code IS NOT NULL)",
            name="generations_completion_state_check",
        ),
        UniqueConstraint("user_id", "idempotency_key_hash", name="uq_generations_user_idempotency"),
        UniqueConstraint("id", "user_id", name="uq_generations_id_user"),
        ForeignKeyConstraint(
            ["api_key_id", "user_id"], ["api_keys.id", "api_keys.user_id"], ondelete="RESTRICT"
        ),
        Index("idx_generations_user_created_at", "user_id", "created_at"),
        Index("idx_generations_user_status", "user_id", "status"),
    )

    id: Mapped[str] = mapped_column(
        String(14),
        primary_key=True,
        default=lambda: create_public_id(PublicIdKind.GENERATION).value,
    )
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    api_key_id: Mapped[str] = mapped_column(String(14))
    idempotency_key_hash: Mapped[bytes] = mapped_column(LargeBinary(32))
    request_fingerprint: Mapped[bytes] = mapped_column(LargeBinary(32))
    reserved_credits: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), server_default=text("'processing'"))
    failure_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class CreditTransaction(Base):
    """Minimal durable history supporting balance audits and webhook idempotency."""

    __tablename__ = "credit_transactions"
    __table_args__ = (
        CheckConstraint("amount <> 0", name="credit_transactions_amount_check"),
        CheckConstraint(
            "type IN ('purchase', 'generation', 'generation_refund', 'grant', 'payment_refund')",
            name="credit_transactions_type_check",
        ),
        CheckConstraint(
            "(type IN ('purchase', 'generation_refund', 'grant') AND amount > 0) OR "
            "(type IN ('generation', 'payment_refund') AND amount < 0)",
            name="credit_transactions_type_amount_check",
        ),
        CheckConstraint(
            "(type IN ('generation', 'generation_refund') "
            "AND generation_id IS NOT NULL) OR "
            "(type IN ('purchase', 'grant', 'payment_refund') "
            "AND generation_id IS NULL)",
            name="credit_transactions_generation_identity_check",
        ),
        CheckConstraint(
            "type NOT IN ('purchase', 'payment_refund') OR external_id IS NOT NULL",
            name="credit_transactions_payment_external_id_check",
        ),
        UniqueConstraint("external_id", name="uq_credit_transactions_external_id"),
        UniqueConstraint("generation_id", "type", name="uq_credit_transactions_generation_type"),
        ForeignKeyConstraint(
            ["generation_id", "user_id"],
            ["generations.id", "generations.user_id"],
            ondelete="RESTRICT",
        ),
        Index("idx_credit_transactions_user_created_at", "user_id", "created_at"),
    )

    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    generation_id: Mapped[str | None] = mapped_column(String(14), nullable=True)
    amount: Mapped[int] = mapped_column(Integer)
    type: Mapped[str] = mapped_column(String(30))
    external_id: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class GeneratedAsset(Base):
    """A generated object with explicit ownership and retention/deletion state."""

    __tablename__ = "generated_assets"
    __table_args__ = (
        CheckConstraint(
            "id ~ '^a_[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{12}$'",
            name="generated_assets_id_format_check",
        ),
        CheckConstraint(
            "deletion_state IN ('active', 'pending', 'failed', 'deleted')",
            name="generated_assets_deletion_state_check",
        ),
        CheckConstraint("expires_at > created_at", name="generated_assets_expiry_check"),
        CheckConstraint("deletion_attempts >= 0", name="generated_assets_deletion_attempts_check"),
        CheckConstraint(
            "deleted_at IS NULL OR deleted_at >= created_at",
            name="generated_assets_deleted_at_check",
        ),
        CheckConstraint(
            "(deletion_state = 'deleted' AND deleted_at IS NOT NULL) OR "
            "(deletion_state IN ('active', 'pending', 'failed') AND deleted_at IS NULL)",
            name="generated_assets_deletion_timestamps_check",
        ),
        UniqueConstraint("object_key", name="uq_generated_assets_object_key"),
        ForeignKeyConstraint(
            ["generation_id", "user_id"],
            ["generations.id", "generations.user_id"],
            ondelete="RESTRICT",
        ),
        Index("idx_generated_assets_user_created_at", "user_id", "created_at"),
        Index(
            "idx_generated_assets_deletion_state_expires_at",
            "deletion_state",
            "expires_at",
        ),
        Index("idx_generated_assets_generation", "generation_id"),
    )

    id: Mapped[str] = mapped_column(
        String(14),
        primary_key=True,
        default=lambda: create_public_id(PublicIdKind.ASSET).value,
    )
    user_id: Mapped[str] = mapped_column(
        ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    generation_id: Mapped[str] = mapped_column(String(14))
    object_key: Mapped[str] = mapped_column(Text)
    content_type: Mapped[str] = mapped_column(String(127))
    content_hash: Mapped[str] = mapped_column(String(64))
    expires_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now() + interval '30 days'")
    )
    deletion_state: Mapped[str] = mapped_column(
        String(20), default="active", server_default=text("'active'")
    )
    deletion_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default=text("0"))
    last_deletion_attempt_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    deletion_error_code: Mapped[str | None] = mapped_column(String(64), nullable=True)
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )


class Database:
    def __init__(self, database_url: str) -> None:
        self.engine: AsyncEngine = create_async_engine(
            normalize_database_url(database_url),
            pool_pre_ping=True,
            connect_args=database_connect_args(database_url),
        )
        self.sessions = async_sessionmaker(self.engine, expire_on_commit=False)

    @asynccontextmanager
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
