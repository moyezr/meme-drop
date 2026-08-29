from __future__ import annotations

import importlib
import os
from uuid import uuid4

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import Connection, inspect

from memedrop_api.db import Database


def _upgrade_real_0006_shape(connection: Connection, schema: str) -> None:
    quoted_schema = connection.dialect.identifier_preparer.quote(schema)
    connection.exec_driver_sql(f"CREATE SCHEMA {quoted_schema}")
    connection.exec_driver_sql(f"SET LOCAL search_path TO {quoted_schema}")
    connection.exec_driver_sql(
        "CREATE TABLE users (id UUID PRIMARY KEY, email TEXT NOT NULL UNIQUE)"
    )
    legacy_user_id = uuid4()
    connection.exec_driver_sql(
        "INSERT INTO users (id, email) VALUES (%s, %s)",
        (legacy_user_id, "install@example.test"),
    )
    connection.exec_driver_sql("CREATE TABLE agent_accounts (id VARCHAR(27) PRIMARY KEY)")
    connection.exec_driver_sql("CREATE TABLE agent_api_keys (id VARCHAR(26) PRIMARY KEY)")
    connection.exec_driver_sql("CREATE TABLE agent_generations (id VARCHAR(26) PRIMARY KEY)")
    connection.exec_driver_sql("CREATE TABLE credit_ledger_entries (id VARCHAR(26) PRIMARY KEY)")
    connection.exec_driver_sql(
        "CREATE FUNCTION prevent_credit_ledger_entry_mutation() RETURNS trigger "
        "LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$"
    )
    connection.exec_driver_sql(
        "CREATE TABLE generated_assets ("
        "id VARCHAR(28) PRIMARY KEY, agent_account_id VARCHAR(27) NOT NULL)"
    )

    migration = importlib.import_module(
        "migrations.versions.20260827_0007_user_owned_agent_platform"
    )
    with Operations.context(MigrationContext.configure(connection)):
        migration.upgrade()

    inspector = inspect(connection)
    tables = set(inspector.get_table_names())
    assert {"install_users", "users", "api_keys", "generations"} <= tables
    assert {
        "agent_accounts",
        "agent_api_keys",
        "agent_generations",
        "credit_ledger_entries",
    }.isdisjoint(tables)
    assert inspector.get_pk_constraint("install_users")["name"] == "install_users_pkey"
    assert inspector.get_pk_constraint("users")["name"] == "users_pkey"
    assert (
        connection.exec_driver_sql(
            "SELECT id FROM install_users WHERE email = 'install@example.test'"
        ).scalar_one()
        == legacy_user_id
    )

    credit_checks = {
        constraint["name"] for constraint in inspector.get_check_constraints("credit_transactions")
    }
    assert "credit_transactions_generation_identity_check" in credit_checks
    assert "credit_transactions_payment_external_id_check" in credit_checks

    with Operations.context(MigrationContext.configure(connection)):
        migration.downgrade()
    downgraded = inspect(connection)
    downgraded_tables = set(downgraded.get_table_names())
    assert "users" in downgraded_tables
    assert "install_users" not in downgraded_tables
    assert "agent_accounts" in downgraded_tables
    assert downgraded.get_pk_constraint("users")["name"] == "users_pkey"
    assert (
        connection.exec_driver_sql(
            "SELECT id FROM users WHERE email = 'install@example.test'"
        ).scalar_one()
        == legacy_user_id
    )


@pytest.mark.integration
async def test_0007_upgrades_a_real_0006_shaped_schema() -> None:
    database_url = os.environ.get("MEMEDROP_TEST_DATABASE_URL")
    if not database_url:
        pytest.skip("MEMEDROP_TEST_DATABASE_URL is not configured")
    database = Database(database_url)
    schema = f"test_user_platform_migration_{uuid4().hex}"
    quoted_schema = database.engine.dialect.identifier_preparer.quote(schema)
    try:
        async with database.engine.begin() as connection:
            await connection.run_sync(_upgrade_real_0006_shape, schema)
    finally:
        async with database.engine.begin() as connection:
            await connection.exec_driver_sql(f"DROP SCHEMA IF EXISTS {quoted_schema} CASCADE")
        await database.close()
