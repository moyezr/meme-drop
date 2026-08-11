"""Add the human-reviewed catalog draft workspace.

Revision ID: 20260812_0002
Revises: 20260803_0001
Create Date: 2026-08-12
"""

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "20260812_0002"
down_revision = "20260803_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The repository's compatibility baseline creates the current metadata on a fresh database.
    # Existing installations still need this explicit migration, while fresh ones already have it.
    if sa.inspect(op.get_bind()).has_table("catalog_drafts"):
        return
    op.create_table(
        "catalog_drafts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("template_id", sa.String(length=120), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), server_default="draft", nullable=False),
        sa.Column("asset_path", sa.Text(), nullable=False),
        sa.Column("thumbnail_path", sa.Text(), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column(
            "annotation",
            postgresql.JSONB(astext_type=sa.Text()),
            server_default=sa.text("'{}'::jsonb"),
            nullable=False,
        ),
        sa.Column("revision", sa.Integer(), server_default="1", nullable=False),
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
            "status IN ('draft', 'in_review', 'needs_work', 'approved', 'rejected')",
            name="catalog_drafts_status_check",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("template_id"),
    )
    op.create_index(
        "idx_catalog_drafts_status_updated_at",
        "catalog_drafts",
        ["status", "updated_at"],
        unique=False,
    )


def downgrade() -> None:
    if not sa.inspect(op.get_bind()).has_table("catalog_drafts"):
        return
    op.drop_index("idx_catalog_drafts_status_updated_at", table_name="catalog_drafts")
    op.drop_table("catalog_drafts")
