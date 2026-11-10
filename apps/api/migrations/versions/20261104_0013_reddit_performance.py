"""Allow anonymous Reddit measurements without changing historical rows.

Revision ID: 20261104_0013
Revises: 20261023_0012
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261104_0013"
down_revision = "20261023_0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_constraint(
        "performance_platform_check", "suggestion_performance_samples", type_="check"
    )
    op.create_check_constraint(
        "performance_platform_check",
        "suggestion_performance_samples",
        "platform IN ('x', 'linkedin', 'reddit')",
    )


def downgrade() -> None:
    if (
        op.get_bind()
        .execute(
            sa.text(
                "SELECT EXISTS (SELECT 1 FROM suggestion_performance_samples "
                "WHERE platform = 'reddit')"
            )
        )
        .scalar_one()
    ):
        raise RuntimeError("Cannot downgrade while Reddit performance samples exist")
    op.drop_constraint(
        "performance_platform_check", "suggestion_performance_samples", type_="check"
    )
    op.create_check_constraint(
        "performance_platform_check",
        "suggestion_performance_samples",
        "platform IN ('x', 'linkedin')",
    )
