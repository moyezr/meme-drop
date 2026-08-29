from __future__ import annotations

import pytest
from sqlalchemy.exc import IntegrityError

from memedrop_api.user_repository import SqlAlchemyUserRepository, _is_primary_key_collision


class Diagnostic:
    constraint_name = "api_keys_pkey"


class Original(Exception):
    diag = Diagnostic()


class Error:
    orig = Original()


def test_public_id_retry_recognizes_only_target_primary_key() -> None:
    error = Error()
    assert _is_primary_key_collision(error, "api_keys")  # type: ignore[arg-type]
    assert not _is_primary_key_collision(error, "users")  # type: ignore[arg-type]


@pytest.mark.asyncio
async def test_public_id_insert_retries_only_a_target_primary_key_collision() -> None:
    repository = SqlAlchemyUserRepository(None)  # type: ignore[arg-type]
    attempts = 0

    async def operation() -> str:
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise IntegrityError("insert", {}, Original())
        return "inserted"

    assert await repository._retry_public_id_insert("api_keys", operation) == "inserted"
    assert attempts == 2


@pytest.mark.asyncio
async def test_public_id_insert_does_not_retry_an_identity_conflict() -> None:
    repository = SqlAlchemyUserRepository(None)  # type: ignore[arg-type]
    attempts = 0

    async def operation() -> str:
        nonlocal attempts
        attempts += 1
        raise IntegrityError("insert", {}, Original())

    with pytest.raises(IntegrityError):
        await repository._retry_public_id_insert("users", operation)
    assert attempts == 1
