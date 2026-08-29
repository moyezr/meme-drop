from __future__ import annotations

from typing import Any, cast

from sqlalchemy import BigInteger, LargeBinary, String, Table

from memedrop_api.db import ApiKey, CreditTransaction, GeneratedAsset, Generation, InstallUser, User
from memedrop_api.public_ids import PublicIdKind, parse_public_id


def _table(model: Any) -> Table:
    return cast(Table, model.__table__)


def _names(items: set[Any]) -> set[str]:
    return {item.name for item in items if isinstance(item.name, str)}


def test_customer_and_install_users_are_distinct() -> None:
    assert InstallUser.__tablename__ == "install_users"
    assert User.__tablename__ == "users"
    assert {"auth_provider", "auth_subject", "email", "credits"} <= set(_table(User).columns.keys())
    assert "users_credits_check" in _names(_table(User).constraints)


def test_public_records_use_twelve_character_typed_ids() -> None:
    records = (
        (User, PublicIdKind.USER),
        (ApiKey, PublicIdKind.API_KEY),
        (Generation, PublicIdKind.GENERATION),
        (GeneratedAsset, PublicIdKind.ASSET),
    )
    for model, kind in records:
        column = _table(model).c.id
        assert isinstance(column.type, String)
        assert column.type.length == 14
        default = column.default
        assert default is not None
        generated = cast(Any, default).arg(None)
        assert parse_public_id(generated, expected_kind=kind).value == generated


def test_hashes_are_fixed_binary_and_api_keys_are_minimal() -> None:
    key_columns = set(_table(ApiKey).columns.keys())
    assert key_columns == {
        "id",
        "user_id",
        "name",
        "secret_hash",
        "created_at",
        "last_used_at",
        "revoked_at",
    }
    assert isinstance(_table(ApiKey).c.secret_hash.type, LargeBinary)
    assert cast(LargeBinary, _table(ApiKey).c.secret_hash.type).length == 32
    assert isinstance(_table(Generation).c.idempotency_key_hash.type, LargeBinary)
    assert isinstance(_table(Generation).c.request_fingerprint.type, LargeBinary)


def test_credit_transactions_are_internal_and_naturally_idempotent() -> None:
    table = _table(CreditTransaction)
    assert isinstance(table.c.id.type, BigInteger)
    constraints = _names(table.constraints)
    assert "uq_credit_transactions_external_id" in constraints
    assert "uq_credit_transactions_generation_type" in constraints
    assert "credit_transactions_type_amount_check" in constraints
    assert "actor_type" not in table.c
    assert "actor_id" not in table.c
    assert "idempotency_key_hash" not in table.c


def test_generation_and_assets_are_owned_directly_by_users() -> None:
    assert "user_id" in _table(Generation).c
    assert "agent_account_id" not in _table(Generation).c
    assert "reserved_credits" in _table(Generation).c
    assert "user_id" in _table(GeneratedAsset).c
    assert "agent_account_id" not in _table(GeneratedAsset).c
