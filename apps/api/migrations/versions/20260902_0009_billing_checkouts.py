"""Add durable Dodo checkout identities.

Revision ID: 20260902_0009
Revises: 20260829_0008
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "20260902_0009"
down_revision = "20260829_0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    if "billing_checkouts" in inspect(op.get_bind()).get_table_names():
        return
    op.create_table(
        "billing_checkouts",
        sa.Column("session_id", sa.String(255), primary_key=True),
        sa.Column("user_id", sa.String(14), nullable=False),
        sa.Column("idempotency_key_hash", sa.LargeBinary(32), nullable=False),
        sa.Column("pack_key", sa.String(40), nullable=False),
        sa.Column("product_id", sa.String(80), nullable=False),
        sa.Column("credits", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(20), server_default=sa.text("'pending'"), nullable=False),
        sa.Column("payment_id", sa.String(255), nullable=True),
        sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("credits > 0", name="billing_checkouts_credits_check"),
        sa.CheckConstraint(
            "status IN ('pending', 'paid')",
            name="billing_checkouts_status_check",
        ),
        sa.CheckConstraint(
            "(status = 'pending' AND payment_id IS NULL AND paid_at IS NULL) OR "
            "(status = 'paid' AND payment_id IS NOT NULL AND paid_at IS NOT NULL)",
            name="billing_checkouts_payment_state_check",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint(
            "user_id",
            "idempotency_key_hash",
            name="uq_billing_checkouts_user_idempotency",
        ),
        sa.UniqueConstraint("payment_id", name="uq_billing_checkouts_payment_id"),
    )
    op.create_index(
        "idx_billing_checkouts_user_created_at",
        "billing_checkouts",
        ["user_id", "created_at"],
    )


def downgrade() -> None:
    if "billing_checkouts" not in inspect(op.get_bind()).get_table_names():
        return
    op.drop_table("billing_checkouts")
