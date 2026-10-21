"""Allow distinct corrected browser feedback outcomes.

Revision ID: 20261021_0011
Revises: 20260902_0010
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261021_0011"
down_revision = "20260902_0010"
branch_labels = None
depends_on = None

LEGACY_ACTIONS = "'suggested', 'shown', 'clicked', 'used', 'inserted', 'saved', 'dismissed'"
NEW_ACTIONS = "'copied', 'rejected', 'abandoned', 'attachment_failed'"


def upgrade() -> None:
    op.drop_constraint("usage_events_action_check", "usage_events", type_="check")
    op.create_check_constraint(
        "usage_events_action_check", "usage_events", f"action IN ({LEGACY_ACTIONS}, {NEW_ACTIONS})"
    )


def downgrade() -> None:
    # Retain user feedback rather than deleting or relabeling corrected outcomes.
    if op.get_bind().execute(
        sa.text(f"SELECT EXISTS (SELECT 1 FROM usage_events WHERE action IN ({NEW_ACTIONS}))")
    ).scalar_one():
        raise RuntimeError("Cannot downgrade while corrected usage events exist")
    op.drop_constraint("usage_events_action_check", "usage_events", type_="check")
    op.create_check_constraint(
        "usage_events_action_check", "usage_events", f"action IN ({LEGACY_ACTIONS})"
    )
