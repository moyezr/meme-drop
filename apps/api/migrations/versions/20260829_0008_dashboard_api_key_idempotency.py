"""Add idempotency identity for dashboard API-key issuance.

Revision ID: 20260829_0008
Revises: 20260827_0007
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "20260829_0008"
down_revision = "20260827_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    columns = {column["name"] for column in inspect(connection).get_columns("api_keys")}
    if "issuance_idempotency_hash" in columns:
        return
    op.add_column(
        "api_keys",
        sa.Column("issuance_idempotency_hash", sa.LargeBinary(32), nullable=True),
    )
    op.create_unique_constraint(
        "uq_api_keys_user_issuance_idempotency",
        "api_keys",
        ["user_id", "issuance_idempotency_hash"],
    )


def downgrade() -> None:
    connection = op.get_bind()
    columns = {column["name"] for column in inspect(connection).get_columns("api_keys")}
    if "issuance_idempotency_hash" not in columns:
        return
    op.drop_constraint(
        "uq_api_keys_user_issuance_idempotency", "api_keys", type_="unique"
    )
    op.drop_column("api_keys", "issuance_idempotency_hash")
