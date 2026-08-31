"""Track trend embedding model and semantic fingerprint.

Revision ID: 20260824_0006
Revises: 20260824_0005
Create Date: 2026-08-24
"""

import sqlalchemy as sa
from alembic import op

revision = "20260824_0006"
down_revision = "20260824_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = {column["name"] for column in inspector.get_columns("trend_cards")}
    added_provenance = False
    if "embedding_model" not in columns:
        op.add_column(
            "trend_cards",
            sa.Column("embedding_model", sa.String(length=120), nullable=True),
        )
        added_provenance = True
    if "embedding_fingerprint" not in columns:
        op.add_column(
            "trend_cards",
            sa.Column("embedding_fingerprint", sa.String(length=64), nullable=True),
        )
        added_provenance = True

    if added_provenance:
        # Historical vectors have no trustworthy model/version provenance.
        # Fresh baselines already contain all three fields and retain their
        # internally consistent state.
        op.execute(
            "UPDATE trend_cards SET embedding = NULL, embedding_model = NULL, "
            "embedding_fingerprint = NULL"
        )

    inspector = sa.inspect(bind)
    constraints = {
        constraint["name"]
        for constraint in inspector.get_check_constraints("trend_cards")
    }
    if "trend_cards_embedding_metadata_check" not in constraints:
        op.create_check_constraint(
            "trend_cards_embedding_metadata_check",
            "trend_cards",
            "(embedding IS NULL AND embedding_model IS NULL "
            "AND embedding_fingerprint IS NULL) "
            "OR (embedding IS NOT NULL AND embedding_model IS NOT NULL "
            "AND embedding_fingerprint ~ '^[a-f0-9]{64}$')",
        )


def downgrade() -> None:
    op.drop_constraint(
        "trend_cards_embedding_metadata_check",
        "trend_cards",
        type_="check",
    )
    op.drop_column("trend_cards", "embedding_fingerprint")
    op.drop_column("trend_cards", "embedding_model")
