from __future__ import annotations

from collections.abc import Callable, Iterable
from typing import Any, cast

from sqlalchemy import String, Table

from memedrop_api.db import (
    AgentAccount,
    AgentApiKey,
    AgentGeneration,
    CreditLedgerEntry,
    GeneratedAsset,
)
from memedrop_api.public_ids import PublicIdKind, parse_public_id


def _names(items: Iterable[object]) -> set[str]:
    return {
        name
        for item in items
        if isinstance(name := getattr(item, "name", None), str)
    }


def _foreign_key_constraints(
    table: Table,
) -> set[tuple[tuple[str, ...], tuple[str, ...], str | None]]:
    return {
        (
            tuple(element.parent.name for element in constraint.elements),
            tuple(element.target_fullname for element in constraint.elements),
            constraint.ondelete,
        )
        for constraint in table.foreign_key_constraints
    }


def _table(model: Any) -> Table:
    return cast(Table, model.__table__)


def test_agent_platform_records_use_typed_compact_primary_keys() -> None:
    records = (
        (AgentAccount, PublicIdKind.AGENT_ACCOUNT),
        (AgentApiKey, PublicIdKind.API_KEY),
        (AgentGeneration, PublicIdKind.GENERATION),
        (CreditLedgerEntry, PublicIdKind.LEDGER_ENTRY),
        (GeneratedAsset, PublicIdKind.ASSET),
    )

    for record, kind in records:
        table = _table(record)
        column = table.c.id

        assert isinstance(column.type, String)
        assert column.default is not None
        generated_id = cast(Callable[[object], str], cast(Any, column.default).arg)(None)
        assert parse_public_id(generated_id, expected_kind=kind).value == generated_id
        assert any(
            constraint.name == f"{record.__tablename__}_id_format_check"
            for constraint in table.constraints
        )


def test_api_keys_store_only_a_hash_of_the_secret_and_revocation_audit_fields() -> None:
    table = _table(AgentApiKey)
    columns = set(table.columns.keys())

    assert {"secret_hash", "name", "status", "last_used_at", "revoked_at"} <= columns
    assert {"revocation_reason", "revoked_by_actor", "created_at", "updated_at"} <= columns
    assert "secret" not in columns
    assert "plaintext_secret" not in columns
    assert "uq_agent_api_keys_secret_hash" in _names(table.constraints)


def test_agent_records_preserve_tenant_idempotency_and_retention_indexes() -> None:
    generation_table = _table(AgentGeneration)
    ledger_table = _table(CreditLedgerEntry)
    asset_table = _table(GeneratedAsset)
    generation_constraints = _names(generation_table.constraints)
    ledger_constraints = _names(ledger_table.constraints)
    asset_constraints = _names(asset_table.constraints)

    assert "uq_agent_generations_account_idempotency" in generation_constraints
    assert "uq_credit_ledger_entries_account_idempotency" in ledger_constraints
    assert "credit_ledger_entries_reason_delta_check" in ledger_constraints
    assert "generated_assets_expiry_check" in asset_constraints
    assert "generated_assets_deletion_timestamps_check" in asset_constraints
    assert {
        "idx_agent_generations_account_created_at",
        "idx_agent_generations_account_status",
    } <= _names(generation_table.indexes)
    assert "idx_credit_ledger_entries_account_recorded_at" in _names(
        ledger_table.indexes
    )
    assert "idx_generated_assets_deletion_state_expires_at" in _names(
        asset_table.indexes
    )
    server_default = asset_table.c.expires_at.server_default
    assert server_default is not None
    assert str(cast(Any, server_default).arg) == (
        "now() + interval '30 days'"
    )


def test_agent_history_foreign_keys_are_restrictive() -> None:
    assert {
        (("agent_account_id",), ("agent_accounts.id",), "RESTRICT"),
    } <= _foreign_key_constraints(_table(AgentApiKey))
    assert {
        (("agent_account_id",), ("agent_accounts.id",), "RESTRICT"),
        (
            ("api_key_id", "agent_account_id"),
            ("agent_api_keys.id", "agent_api_keys.agent_account_id"),
            "RESTRICT",
        ),
    } <= _foreign_key_constraints(_table(AgentGeneration))
    assert {
        (("agent_account_id",), ("agent_accounts.id",), "RESTRICT"),
        (
            ("generation_id", "agent_account_id"),
            ("agent_generations.id", "agent_generations.agent_account_id"),
            "RESTRICT",
        ),
    } <= _foreign_key_constraints(_table(CreditLedgerEntry))
    assert {
        (("agent_account_id",), ("agent_accounts.id",), "RESTRICT"),
        (
            ("generation_id", "agent_account_id"),
            ("agent_generations.id", "agent_generations.agent_account_id"),
            "RESTRICT",
        ),
    } <= _foreign_key_constraints(_table(GeneratedAsset))


def test_generation_and_ledger_terminal_state_constraints_are_explicit() -> None:
    generation_checks = {
        constraint.name: str(constraint.sqltext)
        for constraint in _table(AgentGeneration).constraints
        if hasattr(constraint, "sqltext")
    }
    ledger_checks = {
        constraint.name: str(constraint.sqltext)
        for constraint in _table(CreditLedgerEntry).constraints
        if hasattr(constraint, "sqltext")
    }

    assert "'no_fit'" in generation_checks["agent_generations_status_check"]
    assert "failure_code IS NOT NULL" in generation_checks[
        "agent_generations_completion_state_check"
    ]
    assert "reason = 'generation_commit' AND credit_delta = 0" in ledger_checks[
        "credit_ledger_entries_reason_delta_check"
    ]
    assert "reason = 'generation_reservation' AND credit_delta < 0" in ledger_checks[
        "credit_ledger_entries_reason_delta_check"
    ]
    assert "'purchase'" in ledger_checks["credit_ledger_entries_reason_check"]
