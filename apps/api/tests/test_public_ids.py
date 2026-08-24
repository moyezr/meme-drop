from __future__ import annotations

import secrets

import pytest

from memedrop_api.public_ids import (
    PUBLIC_ID_ALPHABET,
    PUBLIC_ID_TOKEN_LENGTH,
    PublicIdError,
    PublicIdKind,
    create_public_id,
    parse_public_id,
)


@pytest.mark.parametrize("kind", list(PublicIdKind))
def test_create_public_id_uses_typed_prefix_and_url_safe_token(kind: PublicIdKind) -> None:
    public_id = create_public_id(kind)

    assert public_id.kind is kind
    assert public_id.value.startswith(f"{kind}_")
    assert len(public_id.value.removeprefix(f"{kind}_")) == PUBLIC_ID_TOKEN_LENGTH
    assert set(public_id.value.removeprefix(f"{kind}_")) <= set(PUBLIC_ID_ALPHABET)


def test_create_public_id_uses_cryptographic_random_source(monkeypatch: pytest.MonkeyPatch) -> None:
    calls = 0

    def deterministic_choice(alphabet: str) -> str:
        nonlocal calls
        calls += 1
        assert alphabet == PUBLIC_ID_ALPHABET
        return alphabet[0]

    monkeypatch.setattr(secrets, "choice", deterministic_choice)

    public_id = create_public_id(PublicIdKind.GENERATION)

    assert public_id.value == f"gen_{PUBLIC_ID_ALPHABET[0] * PUBLIC_ID_TOKEN_LENGTH}"
    assert calls == PUBLIC_ID_TOKEN_LENGTH


def test_create_public_id_requires_a_known_kind() -> None:
    with pytest.raises(TypeError, match="PublicIdKind"):
        create_public_id("gen")  # type: ignore[arg-type]


@pytest.mark.parametrize("kind", list(PublicIdKind))
def test_parse_public_id_round_trips_a_valid_id(kind: PublicIdKind) -> None:
    generated = create_public_id(kind)

    assert parse_public_id(generated.value) == generated


@pytest.mark.parametrize(
    ("value", "message"),
    [
        ("", "one typed prefix"),
        ("gen", "one typed prefix"),
        ("unknown_" + "a" * PUBLIC_ID_TOKEN_LENGTH, "unknown prefix"),
        ("gen_" + "a" * (PUBLIC_ID_TOKEN_LENGTH - 1), "token is malformed"),
        ("gen_" + "a" * (PUBLIC_ID_TOKEN_LENGTH - 1) + "_", "one typed prefix"),
        ("gen_" + "a" * (PUBLIC_ID_TOKEN_LENGTH - 1) + "0", "token is malformed"),
        ("GEN_" + "a" * PUBLIC_ID_TOKEN_LENGTH, "unknown prefix"),
    ],
)
def test_parse_public_id_rejects_malformed_values(value: str, message: str) -> None:
    with pytest.raises(PublicIdError, match=message):
        parse_public_id(value)


def test_parse_public_id_rejects_unexpected_typed_prefix() -> None:
    asset_id = create_public_id(PublicIdKind.ASSET)

    with pytest.raises(PublicIdError, match="unexpected prefix"):
        parse_public_id(asset_id.value, expected_kind=PublicIdKind.GENERATION)


def test_parse_public_id_does_not_normalize_input() -> None:
    generation_id = create_public_id(PublicIdKind.GENERATION)

    with pytest.raises(PublicIdError, match="unknown prefix"):
        parse_public_id(generation_id.value.upper())
