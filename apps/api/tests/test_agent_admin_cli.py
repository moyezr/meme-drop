from __future__ import annotations

import pytest

from memedrop_api.cli import agent_admin_parser


def test_admin_cli_uses_user_commands_and_requires_confirmation() -> None:
    parser = agent_admin_parser()
    created = parser.parse_args(
        [
            "user-create",
            "--auth-provider",
            "github",
            "--auth-subject",
            "123",
            "--confirm",
        ]
    )
    assert created.command == "user-create"
    issued = parser.parse_args(
        ["key-issue", "--user-id", "u_23456789ABCD", "--name", "prod", "--confirm"]
    )
    assert issued.user_id == "u_23456789ABCD"


def test_admin_cli_rejects_old_account_shape() -> None:
    parser = agent_admin_parser()
    with pytest.raises(SystemExit):
        parser.parse_args(["account-create", "--name", "old", "--confirm"])
