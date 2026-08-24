from __future__ import annotations

import pytest
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import IntegrityError

from memedrop_api.agent_account_repository import (
    SqlAlchemyAgentCredentialRepository,
    _active_key_for_rotation_statement,
    _is_primary_key_collision,
)
from memedrop_api.public_ids import PublicIdKind, create_public_id


class _FakeDatabaseError(Exception):
    def __init__(self, constraint_name: str) -> None:
        self.diag = type("Diagnostic", (), {"constraint_name": constraint_name})()


def _integrity_error(constraint_name: str) -> IntegrityError:
    return IntegrityError("INSERT", {}, _FakeDatabaseError(constraint_name))


def test_rotation_key_lookup_is_tenant_scoped_and_locks_the_row() -> None:
    account_id = create_public_id(PublicIdKind.AGENT_ACCOUNT).value
    key_id = create_public_id(PublicIdKind.API_KEY).value
    statement = _active_key_for_rotation_statement(
        account_id=account_id,
        key_id=key_id,
    )

    compiled = statement.compile(dialect=postgresql.dialect())
    sql = str(compiled)

    assert "agent_api_keys.id =" in sql
    assert "agent_api_keys.agent_account_id =" in sql
    assert "agent_api_keys.status =" in sql
    assert sql.endswith("FOR UPDATE")
    assert account_id in compiled.params.values()
    assert key_id in compiled.params.values()


def test_primary_key_collision_detection_is_limited_to_the_target_table() -> None:
    assert _is_primary_key_collision(_integrity_error("agent_api_keys_pkey"), "agent_api_keys")
    assert not _is_primary_key_collision(
        _integrity_error("uq_agent_api_keys_secret_hash"), "agent_api_keys"
    )
    assert not _is_primary_key_collision(_integrity_error("agent_accounts_pkey"), "agent_api_keys")


async def test_public_id_retry_retries_only_a_target_primary_key_collision() -> None:
    repository = object.__new__(SqlAlchemyAgentCredentialRepository)
    calls = 0

    async def operation() -> str:
        nonlocal calls
        calls += 1
        if calls == 1:
            raise _integrity_error("agent_api_keys_pkey")
        return "inserted"

    assert await repository._retry_public_id_insert("agent_api_keys", operation) == "inserted"
    assert calls == 2


async def test_public_id_retry_does_not_retry_other_unique_constraints() -> None:
    repository = object.__new__(SqlAlchemyAgentCredentialRepository)
    calls = 0

    async def operation() -> str:
        nonlocal calls
        calls += 1
        raise _integrity_error("uq_agent_api_keys_secret_hash")

    with pytest.raises(IntegrityError):
        await repository._retry_public_id_insert("agent_api_keys", operation)
    assert calls == 1
