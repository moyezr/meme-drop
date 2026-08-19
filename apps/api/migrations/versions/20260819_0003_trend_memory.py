"""Add durable trend memory and immutable serving snapshots.

Revision ID: 20260819_0003
Revises: 20260812_0002
Create Date: 2026-08-19
"""

import sqlalchemy as sa
from alembic import op
from pgvector.sqlalchemy import Vector
from sqlalchemy.dialects import postgresql

revision = "20260819_0003"
down_revision = "20260812_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("trend_cards"):
        op.create_table(
            "trend_cards",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("key", sa.String(length=160), nullable=False),
            sa.Column("name", sa.Text(), nullable=False),
            sa.Column("premise", sa.Text(), nullable=False),
            sa.Column(
                "aliases", postgresql.ARRAY(sa.Text()), server_default="{}", nullable=False
            ),
            sa.Column(
                "entities", postgresql.ARRAY(sa.Text()), server_default="{}", nullable=False
            ),
            sa.Column(
                "topics", postgresql.ARRAY(sa.Text()), server_default="{}", nullable=False
            ),
            sa.Column(
                "communities", postgresql.ARRAY(sa.Text()), server_default="{}", nullable=False
            ),
            sa.Column(
                "recognition_cues",
                postgresql.ARRAY(sa.Text()),
                server_default="{}",
                nullable=False,
            ),
            sa.Column(
                "comic_tensions",
                postgresql.ARRAY(sa.Text()),
                server_default="{}",
                nullable=False,
            ),
            sa.Column("usage_guidance", sa.Text(), nullable=False),
            sa.Column(
                "avoid_guidance",
                postgresql.ARRAY(sa.Text()),
                server_default="{}",
                nullable=False,
            ),
            sa.Column("lifecycle", sa.String(length=20), nullable=False),
            sa.Column("duration_class", sa.String(length=20), nullable=False),
            sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_confirmed_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("confidence", sa.Float(), nullable=False),
            sa.Column("momentum", sa.Float(), nullable=False),
            sa.Column("vitality", sa.Float(), nullable=False),
            sa.Column("source_count", sa.Integer(), nullable=False),
            sa.Column("observation_count", sa.Integer(), nullable=False),
            sa.Column("recurrence_count", sa.Integer(), server_default="0", nullable=False),
            sa.Column("version", sa.Integer(), server_default="1", nullable=False),
            sa.Column("embedding", Vector(1536), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.CheckConstraint(
                "lifecycle IN ('emerging', 'rising', 'established', 'cooling', 'dormant')",
                name="trend_cards_lifecycle_check",
            ),
            sa.CheckConstraint(
                "duration_class IN ('flash', 'fast', 'persistent', 'recurring')",
                name="trend_cards_duration_class_check",
            ),
            sa.CheckConstraint(
                "confidence >= 0 AND confidence <= 1",
                name="trend_cards_confidence_check",
            ),
            sa.CheckConstraint(
                "momentum >= 0 AND momentum <= 1", name="trend_cards_momentum_check"
            ),
            sa.CheckConstraint(
                "vitality >= 0 AND vitality <= 1", name="trend_cards_vitality_check"
            ),
            sa.CheckConstraint(
                "source_count >= 1 AND observation_count >= source_count",
                name="trend_cards_evidence_counts_check",
            ),
            sa.CheckConstraint(
                "recurrence_count >= 0 AND version >= 1",
                name="trend_cards_version_counts_check",
            ),
            sa.CheckConstraint(
                "last_confirmed_at >= first_seen_at AND expires_at > last_confirmed_at",
                name="trend_cards_timestamps_check",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("key"),
        )
        op.create_index(
            "idx_trend_cards_lifecycle_expires_at",
            "trend_cards",
            ["lifecycle", "expires_at"],
            unique=False,
        )
        op.create_index(
            "idx_trend_cards_last_confirmed_at",
            "trend_cards",
            ["last_confirmed_at"],
            unique=False,
        )
        for column in ("aliases", "entities", "topics"):
            op.create_index(
                f"idx_trend_cards_{column}_gin",
                "trend_cards",
                [column],
                unique=False,
                postgresql_using="gin",
            )
        op.create_index(
            "idx_trend_cards_embedding_hnsw",
            "trend_cards",
            ["embedding"],
            unique=False,
            postgresql_using="hnsw",
            postgresql_ops={"embedding": "vector_cosine_ops"},
        )

    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("trend_observations"):
        op.create_table(
            "trend_observations",
            sa.Column("id", sa.Uuid(), nullable=False),
            sa.Column("trend_id", sa.Uuid(), nullable=False),
            sa.Column("observation_key", sa.String(length=64), nullable=False),
            sa.Column("provider", sa.String(length=40), nullable=False),
            sa.Column("source_url", sa.Text(), nullable=False),
            sa.Column("source_url_hash", sa.String(length=64), nullable=False),
            sa.Column("source_domain", sa.String(length=255), nullable=False),
            sa.Column("content_hash", sa.String(length=64), nullable=False),
            sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("first_seen_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("last_seen_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("seen_count", sa.Integer(), server_default="1", nullable=False),
            sa.Column("provider_score", sa.Float(), nullable=True),
            sa.Column("provider_result_id", sa.String(length=255), nullable=True),
            sa.Column("query_fingerprint", sa.String(length=64), nullable=True),
            sa.CheckConstraint(
                "seen_count >= 1", name="trend_observations_seen_count_check"
            ),
            sa.CheckConstraint(
                "provider_score IS NULL OR (provider_score >= 0 AND provider_score <= 1)",
                name="trend_observations_provider_score_check",
            ),
            sa.CheckConstraint(
                "last_seen_at >= first_seen_at",
                name="trend_observations_timestamps_check",
            ),
            sa.ForeignKeyConstraint(["trend_id"], ["trend_cards.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "trend_id", "observation_key", name="uq_trend_observations_trend_key"
            ),
        )
        op.create_index(
            "idx_trend_observations_trend_last_seen",
            "trend_observations",
            ["trend_id", "last_seen_at"],
            unique=False,
        )
        op.create_index(
            "idx_trend_observations_source_url_hash",
            "trend_observations",
            ["source_url_hash"],
            unique=False,
        )
        op.create_index(
            "idx_trend_observations_source_domain",
            "trend_observations",
            ["source_domain"],
            unique=False,
        )

    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("trend_snapshots"):
        op.create_table(
            "trend_snapshots",
            sa.Column("version", sa.BigInteger(), autoincrement=False, nullable=False),
            sa.Column("schema_version", sa.Integer(), server_default="1", nullable=False),
            sa.Column("fingerprint", sa.String(length=64), nullable=False),
            sa.Column("card_count", sa.Integer(), nullable=False),
            sa.Column(
                "cards", postgresql.JSONB(astext_type=sa.Text()), nullable=False
            ),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
            sa.CheckConstraint("version >= 1", name="trend_snapshots_version_check"),
            sa.CheckConstraint(
                "schema_version >= 1", name="trend_snapshots_schema_version_check"
            ),
            sa.CheckConstraint("card_count >= 0", name="trend_snapshots_card_count_check"),
            sa.CheckConstraint(
                "published_at IS NULL OR published_at >= created_at",
                name="trend_snapshots_timestamps_check",
            ),
            sa.PrimaryKeyConstraint("version"),
            sa.UniqueConstraint("fingerprint"),
        )
        op.create_index(
            "idx_trend_snapshots_published_at",
            "trend_snapshots",
            ["published_at"],
            unique=False,
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("trend_snapshots"):
        op.drop_index("idx_trend_snapshots_published_at", table_name="trend_snapshots")
        op.drop_table("trend_snapshots")
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("trend_observations"):
        op.drop_index(
            "idx_trend_observations_source_domain", table_name="trend_observations"
        )
        op.drop_index(
            "idx_trend_observations_source_url_hash", table_name="trend_observations"
        )
        op.drop_index(
            "idx_trend_observations_trend_last_seen", table_name="trend_observations"
        )
        op.drop_table("trend_observations")
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("trend_cards"):
        op.drop_index("idx_trend_cards_embedding_hnsw", table_name="trend_cards")
        op.drop_index("idx_trend_cards_topics_gin", table_name="trend_cards")
        op.drop_index("idx_trend_cards_entities_gin", table_name="trend_cards")
        op.drop_index("idx_trend_cards_aliases_gin", table_name="trend_cards")
        op.drop_index("idx_trend_cards_last_confirmed_at", table_name="trend_cards")
        op.drop_index("idx_trend_cards_lifecycle_expires_at", table_name="trend_cards")
        op.drop_table("trend_cards")
