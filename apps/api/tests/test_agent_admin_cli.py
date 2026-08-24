from __future__ import annotations

from datetime import UTC, datetime

import pytest

from memedrop_api.agent_credentials import (
    AgentAccountRecord,
    AgentAccountStatus,
    ApiKeyRecord,
    IssuedApiKey,
)
from memedrop_api.agent_generation_credits import CreditBalance
from memedrop_api.cli import agent_admin_parser, execute_agent_admin_operation

ACCOUNT_ID = "acct_23456789ABCDEFGHJKLMNP"
KEY_ID = "key_23456789ABCDEFGHJKLMNP"
REPLACEMENT_KEY_ID = "key_3456789ABCDEFGHJKLMNPQ"
NOW = datetime(2026, 8, 24, tzinfo=UTC)


def account_record() -> AgentAccountRecord:
    return AgentAccountRecord(
        id=ACCOUNT_ID,
        name="Private beta account",
        status="active",
        created_at=NOW,
        updated_at=NOW,
    )


def key_record(*, key_id: str = KEY_ID, status: str = "active") -> ApiKeyRecord:
    return ApiKeyRecord(
        id=key_id,
        agent_account_id=ACCOUNT_ID,
        name="Production key",
        status=status,
        last_used_at=None,
        revoked_at=NOW if status == "revoked" else None,
        revocation_reason="operator_request" if status == "revoked" else None,
        revoked_by_actor="operator:alice" if status == "revoked" else None,
        created_at=NOW,
        updated_at=NOW,
    )


class FakeCredentials:
    def __init__(self) -> None:
        self.calls: list[tuple[str, object]] = []

    async def create_account(self, *, name: str) -> AgentAccountRecord:
        self.calls.append(("account-create", name))
        return account_record()

    async def account_status(self, *, account_id: str) -> AgentAccountStatus:
        self.calls.append(("status", account_id))
        return AgentAccountStatus(account=account_record(), api_keys=(key_record(),))

    async def issue_api_key(self, *, account_id: str, name: str) -> IssuedApiKey:
        self.calls.append(("key-issue", (account_id, name)))
        return IssuedApiKey(key=key_record(), secret="one-time-credential")

    async def rotate_api_key(
        self,
        *,
        account_id: str,
        key_id: str,
        name: str,
        reason: str,
        actor: str,
    ) -> IssuedApiKey:
        self.calls.append(("key-rotate", (account_id, key_id, name, reason, actor)))
        return IssuedApiKey(
            key=key_record(key_id=REPLACEMENT_KEY_ID),
            secret="rotated-one-time-credential",
        )

    async def revoke_api_key(
        self,
        *,
        account_id: str,
        key_id: str,
        reason: str,
        actor: str,
    ) -> ApiKeyRecord:
        self.calls.append(("key-revoke", (account_id, key_id, reason, actor)))
        return key_record(status="revoked")


class FakeCredits:
    def __init__(self) -> None:
        self.calls: list[tuple[str, object]] = []

    async def grant_credits(
        self,
        *,
        account_id: str,
        credits: int,
        grant_idempotency_key: str,
        operator_actor_id: str | None = None,
    ) -> CreditBalance:
        self.calls.append(
            (
                "credits-grant",
                (account_id, credits, grant_idempotency_key, operator_actor_id),
            )
        )
        return CreditBalance(account_id, credits)

    async def balance(self, *, account_id: str) -> CreditBalance:
        self.calls.append(("balance", account_id))
        return CreditBalance(account_id, 17)


@pytest.mark.parametrize(
    "arguments",
    (
        ["account-create", "--name", "Beta account"],
        ["key-issue", "--account-id", ACCOUNT_ID, "--name", "Production"],
        [
            "key-rotate",
            "--account-id",
            ACCOUNT_ID,
            "--key-id",
            KEY_ID,
            "--name",
            "Replacement",
            "--reason",
            "scheduled_rotation",
            "--actor",
            "operator:alice",
        ],
        [
            "key-revoke",
            "--account-id",
            ACCOUNT_ID,
            "--key-id",
            KEY_ID,
            "--reason",
            "operator_request",
            "--actor",
            "operator:alice",
        ],
        [
            "credits-grant",
            "--account-id",
            ACCOUNT_ID,
            "--credits",
            "10",
            "--idempotency-key",
            "beta-initial-10",
            "--actor",
            "operator:alice",
        ],
    ),
)
def test_every_mutation_requires_explicit_confirmation(arguments: list[str]) -> None:
    with pytest.raises(SystemExit):
        agent_admin_parser().parse_args(arguments)


async def test_issue_and_rotation_serialize_credentials_only_on_one_time_paths() -> None:
    credentials = FakeCredentials()
    credits = FakeCredits()
    issue = agent_admin_parser().parse_args(
        [
            "key-issue",
            "--account-id",
            ACCOUNT_ID,
            "--name",
            "Production",
            "--confirm",
        ]
    )
    rotate = agent_admin_parser().parse_args(
        [
            "key-rotate",
            "--account-id",
            ACCOUNT_ID,
            "--key-id",
            KEY_ID,
            "--name",
            "Replacement",
            "--reason",
            "scheduled_rotation",
            "--actor",
            "operator:alice",
            "--confirm",
        ]
    )

    issued = await execute_agent_admin_operation(
        issue, credentials=credentials, credits=credits
    )
    rotated = await execute_agent_admin_operation(
        rotate, credentials=credentials, credits=credits
    )

    assert issued["credential"] == f"{KEY_ID}.one-time-credential"
    assert rotated["credential"] == (
        f"{REPLACEMENT_KEY_ID}.rotated-one-time-credential"
    )
    assert set(issued) == {"status", "api_key", "credential"}
    assert "secret_hash" not in str(issued)


async def test_status_is_content_free_and_never_replays_a_credential() -> None:
    credentials = FakeCredentials()
    credits = FakeCredits()
    arguments = agent_admin_parser().parse_args(["status", "--account-id", ACCOUNT_ID])

    result = await execute_agent_admin_operation(
        arguments,
        credentials=credentials,
        credits=credits,
    )

    assert result == {
        "status": "ok",
        "account": {
            "id": ACCOUNT_ID,
            "name": "Private beta account",
            "status": "active",
            "created_at": NOW.isoformat(),
            "updated_at": NOW.isoformat(),
        },
        "api_keys": [
            {
                "id": KEY_ID,
                "account_id": ACCOUNT_ID,
                "name": "Production key",
                "status": "active",
                "last_used_at": None,
                "revoked_at": None,
                "created_at": NOW.isoformat(),
                "updated_at": NOW.isoformat(),
            }
        ],
        "balance": {"account_id": ACCOUNT_ID, "credits": 17},
    }
    assert "credential" not in str(result)


async def test_credit_grant_passes_explicit_idempotency_identity() -> None:
    credentials = FakeCredentials()
    credits = FakeCredits()
    arguments = agent_admin_parser().parse_args(
        [
            "credits-grant",
            "--account-id",
            ACCOUNT_ID,
            "--credits",
            "25",
            "--idempotency-key",
            "beta-grant-2026-08-24",
            "--actor",
            "operator:alice",
            "--confirm",
        ]
    )

    result = await execute_agent_admin_operation(
        arguments,
        credentials=credentials,
        credits=credits,
    )

    assert credits.calls == [
        (
            "credits-grant",
            (ACCOUNT_ID, 25, "beta-grant-2026-08-24", "operator:alice"),
        )
    ]
    assert result == {
        "status": "granted",
        "balance": {"account_id": ACCOUNT_ID, "credits": 25},
    }


@pytest.mark.parametrize(
    "arguments",
    (
        [
            "credits-grant",
            "--account-id",
            ACCOUNT_ID,
            "--credits",
            "0",
            "--idempotency-key",
            "grant",
            "--actor",
            "operator:alice",
            "--confirm",
        ],
        [
            "key-revoke",
            "--account-id",
            ACCOUNT_ID,
            "--key-id",
            KEY_ID,
            "--reason",
            "Free form reason",
            "--actor",
            "operator:alice",
            "--confirm",
        ],
        [
            "credits-grant",
            "--account-id",
            ACCOUNT_ID,
            "--credits",
            "10",
            "--idempotency-key",
            "grant-without-actor",
            "--confirm",
        ],
    ),
)
def test_mutation_inputs_are_bounded_before_database_work(arguments: list[str]) -> None:
    with pytest.raises(SystemExit):
        agent_admin_parser().parse_args(arguments)
