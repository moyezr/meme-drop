"""Authentication for short-lived assertions issued by the MemeDrop web app."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Annotated, Literal, cast

import jwt
from fastapi import Depends, Header, HTTPException, Request

from memedrop_api.config import Settings

DASHBOARD_ASSERTION_ISSUER = "memedrop-web"
DASHBOARD_ASSERTION_AUDIENCE = "memedrop-dashboard-api"
DASHBOARD_ASSERTION_MAX_TTL_SECONDS = 45
_MAX_ASSERTION_LENGTH = 4_096
_REQUIRED_CLAIMS = (
    "exp",
    "iat",
    "iss",
    "aud",
    "sub",
    "provider",
    "provider_account_id",
)
DashboardProvider = Literal["github", "google"]


@dataclass(frozen=True, slots=True)
class DashboardPrincipal:
    subject: str
    provider: DashboardProvider
    provider_account_id: str
    email: str | None


def verify_dashboard_assertion(token: str, secret: str) -> DashboardPrincipal:
    """Verify one tightly scoped, short-lived HS256 web-to-API assertion."""

    if (
        not token
        or len(token) > _MAX_ASSERTION_LENGTH
        or any(character.isspace() for character in token)
    ):
        raise _unauthorized()
    try:
        payload = cast(
            dict[str, object],
            jwt.decode(
                token,
                secret,
                algorithms=["HS256"],
                audience=DASHBOARD_ASSERTION_AUDIENCE,
                issuer=DASHBOARD_ASSERTION_ISSUER,
                options={"require": list(_REQUIRED_CLAIMS)},
            ),
        )
    except jwt.PyJWTError as error:
        raise _unauthorized() from error

    issued_at = payload.get("iat")
    expires_at = payload.get("exp")
    provider = payload.get("provider")
    provider_account_id = payload.get("provider_account_id")
    subject = payload.get("sub")
    email = payload.get("email")
    if (
        type(issued_at) is not int
        or type(expires_at) is not int
        or expires_at <= issued_at
        or expires_at - issued_at > DASHBOARD_ASSERTION_MAX_TTL_SECONDS
        or payload.get("iss") != DASHBOARD_ASSERTION_ISSUER
        or payload.get("aud") != DASHBOARD_ASSERTION_AUDIENCE
        or provider not in {"github", "google"}
        or not _valid_claim_string(provider_account_id, max_length=255)
        or not _valid_claim_string(subject, max_length=286)
        or subject != f"{provider}:{provider_account_id}"
        or (email is not None and not _valid_claim_string(email, max_length=320))
    ):
        raise _unauthorized()
    return DashboardPrincipal(
        subject=subject,
        provider=provider,
        provider_account_id=cast(str, provider_account_id),
        email=cast(str | None, email),
    )


def require_dashboard_principal(
    request: Request,
    authorization: Annotated[str | None, Header()] = None,
) -> DashboardPrincipal:
    settings = cast(Settings, request.app.state.settings)
    secret = settings.dashboard_token_secret
    if secret is None:
        raise HTTPException(status_code=404, detail="Not Found")
    if authorization is None:
        raise _unauthorized()
    scheme, separator, token = authorization.partition(" ")
    if scheme != "Bearer" or separator != " " or not token:
        raise _unauthorized()
    return verify_dashboard_assertion(token, secret)


DashboardIdentity = Annotated[DashboardPrincipal, Depends(require_dashboard_principal)]


def _valid_claim_string(value: object, *, max_length: int) -> bool:
    return (
        isinstance(value, str)
        and value == value.strip()
        and 0 < len(value) <= max_length
        and all(ord(character) >= 32 and ord(character) != 127 for character in value)
    )


def _unauthorized() -> HTTPException:
    return HTTPException(status_code=401, detail="Invalid dashboard assertion")
