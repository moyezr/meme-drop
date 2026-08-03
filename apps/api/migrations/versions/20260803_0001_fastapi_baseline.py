"""Create the FastAPI-compatible MemeDrop schema.

Revision ID: 20260803_0001
Revises:
Create Date: 2026-08-03
"""

from alembic import op
from memedrop_api.db import Base

revision = "20260803_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    connection = op.get_bind()
    connection.exec_driver_sql("CREATE EXTENSION IF NOT EXISTS vector")
    Base.metadata.create_all(connection, checkfirst=True)
    connection.exec_driver_sql(
        """
        DO $$
        BEGIN
          IF to_regclass('public.usage_events') IS NOT NULL THEN
            ALTER TABLE usage_events
              DROP CONSTRAINT IF EXISTS usage_events_action_check;
            ALTER TABLE usage_events
              ADD CONSTRAINT usage_events_action_check
              CHECK (action IN (
                'suggested', 'shown', 'clicked', 'used', 'inserted', 'saved', 'dismissed'
              ));
          END IF;
        END $$;
        """
    )


def downgrade() -> None:
    # The baseline intentionally has a non-destructive downgrade. Existing installs may have been
    # created by Drizzle; dropping shared production tables during a runtime migration is unsafe.
    pass
