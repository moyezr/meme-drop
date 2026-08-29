"""Replace agent accounts with user-owned credentials and credits.

Revision ID: 20260827_0007
Revises: 20260824_0006
"""

from __future__ import annotations

import importlib

import sqlalchemy as sa
from alembic import op
from sqlalchemy import inspect

revision = "20260827_0007"
down_revision = "20260824_0006"
branch_labels = None
depends_on = None

_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"


def upgrade() -> None:
    # Production has no customer records yet, so replace the private-beta
    # account experiment instead of carrying its unused abstractions forward.
    connection = op.get_bind()
    inspector = inspect(connection)
    existing_tables = set(inspector.get_table_names())
    asset_columns = (
        {column["name"] for column in inspector.get_columns("generated_assets")}
        if "generated_assets" in existing_tables
        else set()
    )

    op.execute("DROP TRIGGER IF EXISTS credit_ledger_entries_immutable ON credit_ledger_entries")
    op.execute("DROP FUNCTION IF EXISTS prevent_credit_ledger_entry_mutation()")
    if "agent_account_id" in asset_columns:
        op.drop_table("generated_assets")
        existing_tables.remove("generated_assets")
    for table_name in (
        "credit_ledger_entries",
        "agent_generations",
        "agent_api_keys",
        "agent_accounts",
    ):
        if table_name in existing_tables:
            op.drop_table(table_name)

    # The baseline migration historically creates current metadata. On a fresh
    # database that means the desired tables already exist before this revision.
    # Applied installations, by contrast, take the explicit replacement path.
    if {
        "install_users",
        "users",
        "api_keys",
        "generations",
        "credit_transactions",
        "generated_assets",
    } <= existing_tables:
        return

    # The original users table contains anonymous extension installs. Keep it
    # intact under an accurate name so customer users can own the simple name.
    if "install_users" not in existing_tables:
        legacy_users_pk = inspector.get_pk_constraint("users").get("name")
        if not isinstance(legacy_users_pk, str) or not legacy_users_pk:
            raise RuntimeError("legacy users table must have a named primary key")
        quote = connection.dialect.identifier_preparer.quote
        op.execute(
            f"ALTER TABLE {quote('users')} RENAME CONSTRAINT "
            f"{quote(legacy_users_pk)} TO {quote('install_users_pkey')}"
        )
        op.rename_table("users", "install_users")

    op.create_table(
        "users",
        sa.Column("id", sa.String(14), primary_key=True),
        sa.Column("auth_provider", sa.String(30), nullable=False),
        sa.Column("auth_subject", sa.String(255), nullable=False),
        sa.Column("email", sa.String(320), nullable=True),
        sa.Column("credits", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(f"id ~ '^u_[{_ALPHABET}]{{12}}$'", name="users_id_format_check"),
        sa.CheckConstraint("credits >= 0", name="users_credits_check"),
        sa.UniqueConstraint("auth_provider", "auth_subject", name="uq_users_auth_identity"),
    )
    op.create_table(
        "api_keys",
        sa.Column("id", sa.String(14), primary_key=True),
        sa.Column("user_id", sa.String(14), nullable=False),
        sa.Column("name", sa.String(120), nullable=False),
        sa.Column("secret_hash", sa.LargeBinary(32), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.CheckConstraint(f"id ~ '^k_[{_ALPHABET}]{{12}}$'", name="api_keys_id_format_check"),
        sa.CheckConstraint(
            "last_used_at IS NULL OR last_used_at >= created_at",
            name="api_keys_last_used_at_check",
        ),
        sa.CheckConstraint(
            "revoked_at IS NULL OR revoked_at >= created_at", name="api_keys_revoked_at_check"
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.UniqueConstraint("secret_hash", name="uq_api_keys_secret_hash"),
        sa.UniqueConstraint("id", "user_id", name="uq_api_keys_id_user"),
    )
    op.create_index("idx_api_keys_user_created_at", "api_keys", ["user_id", "created_at"])
    op.create_table(
        "generations",
        sa.Column("id", sa.String(14), primary_key=True),
        sa.Column("user_id", sa.String(14), nullable=False),
        sa.Column("api_key_id", sa.String(14), nullable=False),
        sa.Column("idempotency_key_hash", sa.LargeBinary(32), nullable=False),
        sa.Column("request_fingerprint", sa.LargeBinary(32), nullable=False),
        sa.Column("reserved_credits", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(20), server_default=sa.text("'processing'"), nullable=False),
        sa.Column("failure_code", sa.String(64), nullable=True),
        sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(f"id ~ '^g_[{_ALPHABET}]{{12}}$'", name="generations_id_format_check"),
        sa.CheckConstraint(
            "status IN ('processing', 'succeeded', 'no_fit', 'failed', 'cancelled')",
            name="generations_status_check",
        ),
        sa.CheckConstraint("reserved_credits BETWEEN 1 AND 5", name="generations_reserved_check"),
        sa.CheckConstraint(
            "(status = 'processing' AND completed_at IS NULL AND failure_code IS NULL) OR "
            "(status IN ('succeeded', 'no_fit') AND completed_at IS NOT NULL "
            "AND failure_code IS NULL) OR "
            "(status IN ('failed', 'cancelled') AND completed_at IS NOT NULL "
            "AND failure_code IS NOT NULL)",
            name="generations_completion_state_check",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["api_key_id", "user_id"], ["api_keys.id", "api_keys.user_id"], ondelete="RESTRICT"
        ),
        sa.UniqueConstraint(
            "user_id", "idempotency_key_hash", name="uq_generations_user_idempotency"
        ),
        sa.UniqueConstraint("id", "user_id", name="uq_generations_id_user"),
    )
    op.create_index("idx_generations_user_created_at", "generations", ["user_id", "created_at"])
    op.create_index("idx_generations_user_status", "generations", ["user_id", "status"])
    op.create_table(
        "credit_transactions",
        sa.Column("id", sa.BigInteger(), primary_key=True, autoincrement=True),
        sa.Column("user_id", sa.String(14), nullable=False),
        sa.Column("generation_id", sa.String(14), nullable=True),
        sa.Column("amount", sa.Integer(), nullable=False),
        sa.Column("type", sa.String(30), nullable=False),
        sa.Column("external_id", sa.String(255), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint("amount <> 0", name="credit_transactions_amount_check"),
        sa.CheckConstraint(
            "type IN ('purchase', 'generation', 'generation_refund', 'grant', 'payment_refund')",
            name="credit_transactions_type_check",
        ),
        sa.CheckConstraint(
            "(type IN ('purchase', 'generation_refund', 'grant') AND amount > 0) OR "
            "(type IN ('generation', 'payment_refund') AND amount < 0)",
            name="credit_transactions_type_amount_check",
        ),
        sa.CheckConstraint(
            "(type IN ('generation', 'generation_refund') AND generation_id IS NOT NULL) OR "
            "(type IN ('purchase', 'grant', 'payment_refund') AND generation_id IS NULL)",
            name="credit_transactions_generation_identity_check",
        ),
        sa.CheckConstraint(
            "type NOT IN ('purchase', 'payment_refund') OR external_id IS NOT NULL",
            name="credit_transactions_payment_external_id_check",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["generation_id", "user_id"],
            ["generations.id", "generations.user_id"],
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("external_id", name="uq_credit_transactions_external_id"),
        sa.UniqueConstraint("generation_id", "type", name="uq_credit_transactions_generation_type"),
    )
    op.create_index(
        "idx_credit_transactions_user_created_at",
        "credit_transactions",
        ["user_id", "created_at"],
    )
    op.create_table(
        "generated_assets",
        sa.Column("id", sa.String(14), primary_key=True),
        sa.Column("user_id", sa.String(14), nullable=False),
        sa.Column("generation_id", sa.String(14), nullable=False),
        sa.Column("object_key", sa.Text(), nullable=False),
        sa.Column("content_type", sa.String(127), nullable=False),
        sa.Column("content_hash", sa.String(64), nullable=False),
        sa.Column(
            "expires_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now() + interval '30 days'"),
            nullable=False,
        ),
        sa.Column(
            "deletion_state", sa.String(20), server_default=sa.text("'active'"), nullable=False
        ),
        sa.Column("deletion_attempts", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.Column("last_deletion_attempt_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("deletion_error_code", sa.String(64), nullable=True),
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
            f"id ~ '^a_[{_ALPHABET}]{{12}}$'", name="generated_assets_id_format_check"
        ),
        sa.CheckConstraint(
            "deletion_state IN ('active', 'pending', 'failed', 'deleted')",
            name="generated_assets_deletion_state_check",
        ),
        sa.CheckConstraint("expires_at > created_at", name="generated_assets_expiry_check"),
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
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="RESTRICT"),
        sa.ForeignKeyConstraint(
            ["generation_id", "user_id"],
            ["generations.id", "generations.user_id"],
            ondelete="RESTRICT",
        ),
        sa.UniqueConstraint("object_key", name="uq_generated_assets_object_key"),
    )
    op.create_index(
        "idx_generated_assets_user_created_at", "generated_assets", ["user_id", "created_at"]
    )
    op.create_index(
        "idx_generated_assets_deletion_state_expires_at",
        "generated_assets",
        ["deletion_state", "expires_at"],
    )
    op.create_index("idx_generated_assets_generation", "generated_assets", ["generation_id"])


def downgrade() -> None:
    op.drop_table("generated_assets")
    op.drop_table("credit_transactions")
    op.drop_table("generations")
    op.drop_table("api_keys")
    op.drop_table("users")
    op.rename_table("install_users", "users")
    op.execute("ALTER TABLE users RENAME CONSTRAINT install_users_pkey TO users_pkey")
    previous = importlib.import_module("migrations.versions.20260824_0005_agent_platform_records")
    previous.upgrade()
