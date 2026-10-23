"""Add anonymous, bounded browser performance samples.

Revision ID: 20261023_0012
Revises: 20261021_0011
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261023_0012"
down_revision = "20261021_0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # The compatibility baseline (0001) creates current ORM metadata on fresh
    # databases; existing installations need the explicit additive operation.
    if sa.inspect(op.get_bind()).has_table("suggestion_performance_samples"):
        return
    op.create_table(
        "suggestion_performance_samples",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("kind", sa.String(12), nullable=False),
        sa.Column("platform", sa.String(8), nullable=False),
        sa.Column("extension_version", sa.String(19), nullable=False),
        sa.Column("outcome", sa.String(20), nullable=False),
        sa.Column("elapsed_ms", sa.Float(), nullable=False),
        sa.Column("suggestion_count", sa.Integer(), nullable=True),
        sa.Column("first_usable_preview_ms", sa.Float(), nullable=True),
        sa.Column("api_response_ms", sa.Float(), nullable=True),
        sa.Column("cache_status", sa.String(8), nullable=True),
        sa.Column("generation_mode", sa.String(8), nullable=True),
        sa.Column("selected_preparation_ms", sa.Float(), nullable=True),
        sa.Column("native_attachment_confirmation_ms", sa.Float(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("kind IN ('request', 'attachment')", name="performance_kind_check"),
        sa.CheckConstraint("platform IN ('x', 'linkedin')", name="performance_platform_check"),
        sa.CheckConstraint(
            "elapsed_ms >= 0 AND elapsed_ms <= 120000", name="performance_elapsed_check"
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("idx_performance_created_at", "suggestion_performance_samples", ["created_at"])


def downgrade() -> None:
    if (
        op.get_bind()
        .execute(sa.text("SELECT EXISTS (SELECT 1 FROM suggestion_performance_samples)"))
        .scalar_one()
    ):
        raise RuntimeError("Cannot downgrade while browser performance samples exist")
    op.drop_index("idx_performance_created_at", table_name="suggestion_performance_samples")
    op.drop_table("suggestion_performance_samples")
