"""Add durable compact-ID records for the public agent platform.

Revision ID: 20260824_0005
Revises: 20260819_0004
Create Date: 2026-08-24
"""

import sqlalchemy as sa
from alembic import op

revision = "20260824_0005"
down_revision = "20260819_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("agent_accounts"):
        op.create_table(
            "agent_accounts",
            sa.Column("id", sa.String(length=27), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("status", sa.String(length=20), server_default="active", nullable=False),
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
                "id ~ '^acct_[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{22}$'",
                name="agent_accounts_id_format_check",
            ),
            sa.CheckConstraint(
                "status IN ('active', 'suspended', 'closed')",
                name="agent_accounts_status_check",
            ),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index(
            "idx_agent_accounts_status_created_at",
            "agent_accounts",
            ["status", "created_at"],
            unique=False,
        )

    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("agent_api_keys"):
        op.create_table(
            "agent_api_keys",
            sa.Column("id", sa.String(length=26), nullable=False),
            sa.Column("agent_account_id", sa.String(length=27), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("secret_hash", sa.String(length=128), nullable=False),
            sa.Column("status", sa.String(length=20), server_default="active", nullable=False),
            sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("revocation_reason", sa.String(length=40), nullable=True),
            sa.Column("revoked_by_actor", sa.String(length=120), nullable=True),
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
                "id ~ '^key_[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{22}$'",
                name="agent_api_keys_id_format_check",
            ),
            sa.CheckConstraint(
                "status IN ('active', 'revoked')", name="agent_api_keys_status_check"
            ),
            sa.CheckConstraint(
                "(status = 'active' AND revoked_at IS NULL AND revocation_reason IS NULL "
                "AND revoked_by_actor IS NULL) OR "
                "(status = 'revoked' AND revoked_at IS NOT NULL AND revocation_reason IS NOT NULL "
                "AND revoked_by_actor IS NOT NULL)",
                name="agent_api_keys_revocation_state_check",
            ),
            sa.CheckConstraint(
                "last_used_at IS NULL OR last_used_at >= created_at",
                name="agent_api_keys_last_used_at_check",
            ),
            sa.CheckConstraint(
                "revoked_at IS NULL OR revoked_at >= created_at",
                name="agent_api_keys_revoked_at_check",
            ),
            sa.ForeignKeyConstraint(
                ["agent_account_id"], ["agent_accounts.id"], ondelete="RESTRICT"
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("id", "agent_account_id", name="uq_agent_api_keys_id_account"),
            sa.UniqueConstraint("secret_hash", name="uq_agent_api_keys_secret_hash"),
        )
        op.create_index(
            "idx_agent_api_keys_account_status",
            "agent_api_keys",
            ["agent_account_id", "status"],
            unique=False,
        )
        op.create_index(
            "idx_agent_api_keys_last_used_at",
            "agent_api_keys",
            ["last_used_at"],
            unique=False,
        )

    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("agent_generations"):
        op.create_table(
            "agent_generations",
            sa.Column("id", sa.String(length=26), nullable=False),
            sa.Column("agent_account_id", sa.String(length=27), nullable=False),
            sa.Column("api_key_id", sa.String(length=26), nullable=False),
            sa.Column("idempotency_key_hash", sa.String(length=64), nullable=False),
            sa.Column("request_fingerprint", sa.String(length=64), nullable=False),
            sa.Column("status", sa.String(length=20), server_default="pending", nullable=False),
            sa.Column("failure_code", sa.String(length=64), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
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
                "id ~ '^gen_[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{22}$'",
                name="agent_generations_id_format_check",
            ),
            sa.CheckConstraint(
                "status IN ('pending', 'processing', 'succeeded', 'no_fit', 'failed', 'cancelled')",
                name="agent_generations_status_check",
            ),
            sa.CheckConstraint(
                "(status IN ('pending', 'processing') AND completed_at IS NULL "
                "AND failure_code IS NULL) OR "
                "(status IN ('succeeded', 'no_fit') AND completed_at IS NOT NULL "
                "AND failure_code IS NULL) OR "
                "(status IN ('failed', 'cancelled') AND completed_at IS NOT NULL "
                "AND failure_code IS NOT NULL)",
                name="agent_generations_completion_state_check",
            ),
            sa.CheckConstraint(
                "completed_at IS NULL OR completed_at >= created_at",
                name="agent_generations_completed_at_check",
            ),
            sa.ForeignKeyConstraint(
                ["agent_account_id"], ["agent_accounts.id"], ondelete="RESTRICT"
            ),
            sa.ForeignKeyConstraint(
                ["api_key_id", "agent_account_id"],
                ["agent_api_keys.id", "agent_api_keys.agent_account_id"],
                ondelete="RESTRICT",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "agent_account_id",
                "idempotency_key_hash",
                name="uq_agent_generations_account_idempotency",
            ),
            sa.UniqueConstraint("id", "agent_account_id", name="uq_agent_generations_id_account"),
        )
        op.create_index(
            "idx_agent_generations_account_created_at",
            "agent_generations",
            ["agent_account_id", "created_at"],
            unique=False,
        )
        op.create_index(
            "idx_agent_generations_account_status",
            "agent_generations",
            ["agent_account_id", "status"],
            unique=False,
        )
        op.create_index(
            "idx_agent_generations_api_key_created_at",
            "agent_generations",
            ["api_key_id", "created_at"],
            unique=False,
        )

    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("credit_ledger_entries"):
        op.create_table(
            "credit_ledger_entries",
            sa.Column("id", sa.String(length=26), nullable=False),
            sa.Column("agent_account_id", sa.String(length=27), nullable=False),
            sa.Column("generation_id", sa.String(length=26), nullable=True),
            sa.Column("credit_delta", sa.Integer(), nullable=False),
            sa.Column("reason", sa.String(length=40), nullable=False),
            sa.Column("actor_type", sa.String(length=20), nullable=False),
            sa.Column("actor_id", sa.String(length=120), nullable=False),
            sa.Column("idempotency_key_hash", sa.String(length=64), nullable=False),
            sa.Column(
                "recorded_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now()"),
                nullable=False,
            ),
            sa.CheckConstraint(
                "id ~ '^led_[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{22}$'",
                name="credit_ledger_entries_id_format_check",
            ),
            sa.CheckConstraint(
                "reason IN ('purchase', 'grant', 'generation_reservation', "
                "'generation_commit', 'generation_release', 'adjustment', 'expiration', 'refund')",
                name="credit_ledger_entries_reason_check",
            ),
            sa.CheckConstraint(
                "(reason IN ('purchase', 'grant', 'refund') AND credit_delta > 0) OR "
                "(reason = 'generation_reservation' AND credit_delta < 0) OR "
                "(reason = 'generation_commit' AND credit_delta = 0) OR "
                "(reason = 'generation_release' AND credit_delta > 0) OR "
                "(reason = 'expiration' AND credit_delta < 0) OR "
                "(reason = 'adjustment' AND credit_delta <> 0)",
                name="credit_ledger_entries_reason_delta_check",
            ),
            sa.CheckConstraint(
                "actor_type IN ('system', 'account', 'operator', 'payment')",
                name="credit_ledger_entries_actor_type_check",
            ),
            sa.ForeignKeyConstraint(
                ["agent_account_id"], ["agent_accounts.id"], ondelete="RESTRICT"
            ),
            sa.ForeignKeyConstraint(
                ["generation_id", "agent_account_id"],
                ["agent_generations.id", "agent_generations.agent_account_id"],
                ondelete="RESTRICT",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "agent_account_id",
                "idempotency_key_hash",
                name="uq_credit_ledger_entries_account_idempotency",
            ),
        )
        op.create_index(
            "idx_credit_ledger_entries_account_recorded_at",
            "credit_ledger_entries",
            ["agent_account_id", "recorded_at"],
            unique=False,
        )
        op.create_index(
            "idx_credit_ledger_entries_generation",
            "credit_ledger_entries",
            ["generation_id"],
            unique=False,
        )

    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("generated_assets"):
        op.create_table(
            "generated_assets",
            sa.Column("id", sa.String(length=28), nullable=False),
            sa.Column("agent_account_id", sa.String(length=27), nullable=False),
            sa.Column("generation_id", sa.String(length=26), nullable=False),
            sa.Column("object_key", sa.Text(), nullable=False),
            sa.Column("content_type", sa.String(length=127), nullable=False),
            sa.Column("content_hash", sa.String(length=64), nullable=False),
            sa.Column(
                "expires_at",
                sa.DateTime(timezone=True),
                server_default=sa.text("now() + interval '30 days'"),
                nullable=False,
            ),
            sa.Column(
                "deletion_state", sa.String(length=20), server_default="active", nullable=False
            ),
            sa.Column("deletion_attempts", sa.Integer(), server_default="0", nullable=False),
            sa.Column("last_deletion_attempt_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("deletion_error_code", sa.String(length=64), nullable=True),
            sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
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
                "id ~ '^asset_[23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz]{22}$'",
                name="generated_assets_id_format_check",
            ),
            sa.CheckConstraint(
                "deletion_state IN ('active', 'pending', 'failed', 'deleted')",
                name="generated_assets_deletion_state_check",
            ),
            sa.CheckConstraint(
                "expires_at > created_at", name="generated_assets_expiry_check"
            ),
            sa.CheckConstraint(
                "deletion_attempts >= 0", name="generated_assets_deletion_attempts_check"
            ),
            sa.CheckConstraint(
                "deleted_at IS NULL OR deleted_at >= created_at",
                name="generated_assets_deleted_at_check",
            ),
            sa.CheckConstraint(
                "(deletion_state = 'deleted' AND deleted_at IS NOT NULL) OR "
                "(deletion_state IN ('active', 'pending', 'failed') AND deleted_at IS NULL)",
                name="generated_assets_deletion_timestamps_check",
            ),
            sa.ForeignKeyConstraint(
                ["agent_account_id"], ["agent_accounts.id"], ondelete="RESTRICT"
            ),
            sa.ForeignKeyConstraint(
                ["generation_id", "agent_account_id"],
                ["agent_generations.id", "agent_generations.agent_account_id"],
                ondelete="RESTRICT",
            ),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("object_key", name="uq_generated_assets_object_key"),
        )
        op.create_index(
            "idx_generated_assets_account_created_at",
            "generated_assets",
            ["agent_account_id", "created_at"],
            unique=False,
        )
        op.create_index(
            "idx_generated_assets_deletion_state_expires_at",
            "generated_assets",
            ["deletion_state", "expires_at"],
            unique=False,
        )
        op.create_index(
            "idx_generated_assets_generation",
            "generated_assets",
            ["generation_id"],
            unique=False,
        )

    op.execute(
        """
        CREATE OR REPLACE FUNCTION prevent_credit_ledger_entry_mutation()
        RETURNS trigger AS $$
        BEGIN
            RAISE EXCEPTION 'credit ledger entries are immutable';
        END;
        $$ LANGUAGE plpgsql;
        """
    )
    op.execute(
        """
        DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_trigger
                WHERE tgname = 'credit_ledger_entries_immutable'
                  AND tgrelid = 'credit_ledger_entries'::regclass
            ) THEN
                CREATE TRIGGER credit_ledger_entries_immutable
                BEFORE UPDATE OR DELETE ON credit_ledger_entries
                FOR EACH ROW EXECUTE FUNCTION prevent_credit_ledger_entry_mutation();
            END IF;
        END;
        $$;
        """
    )


def downgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("credit_ledger_entries"):
        op.execute(
            "DROP TRIGGER IF EXISTS credit_ledger_entries_immutable ON credit_ledger_entries"
        )
    op.execute("DROP FUNCTION IF EXISTS prevent_credit_ledger_entry_mutation()")

    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("generated_assets"):
        op.drop_index("idx_generated_assets_generation", table_name="generated_assets")
        op.drop_index(
            "idx_generated_assets_deletion_state_expires_at", table_name="generated_assets"
        )
        op.drop_index("idx_generated_assets_account_created_at", table_name="generated_assets")
        op.drop_table("generated_assets")
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("credit_ledger_entries"):
        op.drop_index("idx_credit_ledger_entries_generation", table_name="credit_ledger_entries")
        op.drop_index(
            "idx_credit_ledger_entries_account_recorded_at", table_name="credit_ledger_entries"
        )
        op.drop_table("credit_ledger_entries")
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("agent_generations"):
        op.drop_index(
            "idx_agent_generations_api_key_created_at", table_name="agent_generations"
        )
        op.drop_index("idx_agent_generations_account_status", table_name="agent_generations")
        op.drop_index(
            "idx_agent_generations_account_created_at", table_name="agent_generations"
        )
        op.drop_table("agent_generations")
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("agent_api_keys"):
        op.drop_index("idx_agent_api_keys_last_used_at", table_name="agent_api_keys")
        op.drop_index("idx_agent_api_keys_account_status", table_name="agent_api_keys")
        op.drop_table("agent_api_keys")
    inspector = sa.inspect(op.get_bind())
    if inspector.has_table("agent_accounts"):
        op.drop_index("idx_agent_accounts_status_created_at", table_name="agent_accounts")
        op.drop_table("agent_accounts")
