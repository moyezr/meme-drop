"""Store the hosted checkout URL for idempotent replay.

Revision ID: 20260902_0010
Revises: 20260902_0009
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "20260902_0010"
down_revision = "20260902_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("billing_checkouts")}
    if "checkout_url" in columns:
        return
    op.add_column("billing_checkouts", sa.Column("checkout_url", sa.Text(), nullable=False))


def downgrade() -> None:
    columns = {column["name"] for column in inspect(op.get_bind()).get_columns("billing_checkouts")}
    if "checkout_url" not in columns:
        return
    op.drop_column("billing_checkouts", "checkout_url")
