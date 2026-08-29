"""Compact, public-safe identifiers for new agent-facing records.

Existing browser, catalog, and trend records remain UUID-backed.  New agent
records use one of the typed prefixes in :class:`PublicIdKind` so an ID can be
validated before a database lookup without making it sequential or guessable.
"""

from __future__ import annotations

import secrets
from dataclasses import dataclass
from enum import StrEnum

# Excludes visually ambiguous characters (0/O, 1/I/l) while remaining URL-safe.
PUBLIC_ID_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"
PUBLIC_ID_TOKEN_LENGTH = 12


class PublicIdKind(StrEnum):
    """The record kinds that receive compact IDs in the agent platform."""

    USER = "u"
    API_KEY = "k"
    GENERATION = "g"
    ASSET = "a"


class PublicIdError(ValueError):
    """Raised when a public ID is malformed or has an unexpected kind."""


@dataclass(frozen=True, slots=True)
class PublicId:
    """A validated compact ID with a typed public prefix."""

    kind: PublicIdKind
    value: str

    def __str__(self) -> str:
        return self.value


def create_public_id(kind: PublicIdKind) -> PublicId:
    """Create a non-sequential, URL-safe public ID for ``kind``.

    Twelve characters from a 57-character alphabet provide about 70 bits of
    entropy. Database uniqueness plus bounded insert retries handle the already
    remote collision case without making every public identifier oversized.
    """

    if not isinstance(kind, PublicIdKind):
        raise TypeError("kind must be a PublicIdKind")

    token = "".join(secrets.choice(PUBLIC_ID_ALPHABET) for _ in range(PUBLIC_ID_TOKEN_LENGTH))
    return PublicId(kind=kind, value=f"{kind}_{token}")


def parse_public_id(value: str, *, expected_kind: PublicIdKind | None = None) -> PublicId:
    """Strictly parse a public ID without normalizing or accepting aliases."""

    if not isinstance(value, str):
        raise PublicIdError("public ID must be a string")

    prefix, separator, token = value.partition("_")
    if not separator or "_" in token:
        raise PublicIdError("public ID must have one typed prefix and token")

    try:
        kind = PublicIdKind(prefix)
    except ValueError as error:
        raise PublicIdError("public ID has an unknown prefix") from error

    if expected_kind is not None and kind is not expected_kind:
        raise PublicIdError("public ID has an unexpected prefix")

    if len(token) != PUBLIC_ID_TOKEN_LENGTH or any(
        char not in PUBLIC_ID_ALPHABET for char in token
    ):
        raise PublicIdError("public ID token is malformed")

    return PublicId(kind=kind, value=value)
