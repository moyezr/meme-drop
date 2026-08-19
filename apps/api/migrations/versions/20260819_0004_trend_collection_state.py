"""Add leased trend collection claims and a monthly credit ledger.

Revision ID: 20260819_0004
Revises: 20260819_0003
Create Date: 2026-08-19
"""

import sqlalchemy as sa
from alembic import op

revision = "20260819_0004"
down_revision = "20260819_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("trend_scan_queries"):
        op.create_table(
            "trend_scan_queries",
            sa.Column("scan_id", sa.String(length=128), nullable=False),
            sa.Column("query_fingerprint", sa.String(length=64), nullable=False),
            sa.Column("status", sa.String(length=20), nullable=False),
            sa.Column("claimed_by", sa.String(length=64), nullable=True),
            sa.Column("claimed_at", sa.DateTime(timezone=True), nullable=False),
            sa.Column("lease_expires_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("attempt_count", sa.Integer(), server_default="1", nullable=False),
            sa.Column("cards_upserted", sa.Integer(), server_default="0", nullable=False),
            sa.Column(
                "observations_stored", sa.Integer(), server_default="0", nullable=False
            ),
            sa.CheckConstraint(
                "status IN ('claimed', 'released', 'completed')",
                name="trend_scan_queries_status_check",
            ),
            sa.CheckConstraint(
                "attempt_count >= 1 AND cards_upserted >= 0 AND observations_stored >= 0",
                name="trend_scan_queries_counts_check",
            ),
            sa.CheckConstraint(
                "(status = 'claimed' AND claimed_by IS NOT NULL "
                "AND lease_expires_at IS NOT NULL AND completed_at IS NULL) OR "
                "(status = 'released' AND claimed_by IS NULL "
                "AND lease_expires_at IS NULL AND completed_at IS NULL) OR "
                "(status = 'completed' AND claimed_by IS NULL "
                "AND lease_expires_at IS NULL AND completed_at IS NOT NULL)",
                name="trend_scan_queries_state_check",
            ),
            sa.PrimaryKeyConstraint("scan_id", "query_fingerprint"),
        )
        op.create_index(
            "idx_trend_scan_queries_status_lease",
            "trend_scan_queries",
            ["status", "lease_expires_at"],
            unique=False,
        )

    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("trend_credit_periods"):
        op.create_table(
            "trend_credit_periods",
            sa.Column("period", sa.String(length=7), nullable=False),
            sa.Column("reserved_credits", sa.Integer(), server_default="0", nullable=False),
            sa.Column(
                "updated_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.CheckConstraint(
                "period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'",
                name="trend_credit_periods_period_check",
            ),
            sa.CheckConstraint(
                "reserved_credits >= 0", name="trend_credit_periods_credits_check"
            ),
            sa.PrimaryKeyConstraint("period"),
        )

    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("trend_credit_reservations"):
        op.create_table(
            "trend_credit_reservations",
            sa.Column("reservation_id", sa.String(length=128), nullable=False),
            sa.Column("period", sa.String(length=7), nullable=False),
            sa.Column("credits", sa.Integer(), nullable=False),
            sa.Column("reserved_at", sa.DateTime(timezone=True), nullable=False),
            sa.CheckConstraint(
                "credits > 0", name="trend_credit_reservations_credits_check"
            ),
            sa.ForeignKeyConstraint(
                ["period"], ["trend_credit_periods.period"], ondelete="CASCADE"
            ),
            sa.PrimaryKeyConstraint("reservation_id"),
        )
        op.create_index(
            "idx_trend_credit_reservations_period",
            "trend_credit_reservations",
            ["period"],
            unique=False,
        )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("trend_credit_reservations"):
        op.drop_index(
            "idx_trend_credit_reservations_period",
            table_name="trend_credit_reservations",
        )
        op.drop_table("trend_credit_reservations")
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("trend_credit_periods"):
        op.drop_table("trend_credit_periods")
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("trend_scan_queries"):
        op.drop_index(
            "idx_trend_scan_queries_status_lease", table_name="trend_scan_queries"
        )
        op.drop_table("trend_scan_queries")
