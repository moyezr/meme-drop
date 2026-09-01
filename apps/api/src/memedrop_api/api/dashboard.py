"""Authenticated dashboard bridge for user overview and API-key management."""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, cast

from fastapi import APIRouter, Header, HTTPException, Request, status
from pydantic import BaseModel, ConfigDict, Field, StringConstraints

from memedrop_api.agent_credentials import (
    AgentApiKeyNotFound,
    AgentCredentialError,
    AgentCredentialService,
    ApiKeyIdempotencyConflict,
    ApiKeyLimitExceeded,
    ApiKeyRecord,
    UserCredentialStatus,
    UserRecord,
)
from memedrop_api.billing import (
    BillingCheckoutCreator,
    BillingError,
    BillingIdempotencyConflict,
    BillingUnavailable,
)
from memedrop_api.dashboard_auth import DashboardIdentity, DashboardPrincipal

router = APIRouter(prefix="/api/v1/dashboard", tags=["dashboard"])
ApiKeyName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class DashboardApiKey(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    name: str
    created_at: datetime
    last_used_at: datetime | None
    revoked_at: datetime | None


class DashboardUser(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    email: str | None
    credits: int = Field(ge=0)
    created_at: datetime


class DashboardOverview(BaseModel):
    model_config = ConfigDict(extra="forbid")

    user: DashboardUser
    api_keys: list[DashboardApiKey]


class CreateApiKeyRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    name: ApiKeyName


class IssuedDashboardApiKey(BaseModel):
    model_config = ConfigDict(extra="forbid")

    api_key: DashboardApiKey
    credential: str


class RevokedDashboardApiKey(BaseModel):
    model_config = ConfigDict(extra="forbid")

    api_key: DashboardApiKey


class DashboardCheckout(BaseModel):
    model_config = ConfigDict(extra="forbid")

    session_id: str
    checkout_url: str


@router.get("/overview", response_model=DashboardOverview)
async def dashboard_overview(
    request: Request,
    identity: DashboardIdentity,
) -> DashboardOverview:
    credentials = _credential_service(request)
    user = await _provision_user(credentials, identity)
    current = await credentials.user_status(user_id=user.id)
    return _overview(current)


@router.post(
    "/api-keys",
    response_model=IssuedDashboardApiKey,
    status_code=status.HTTP_201_CREATED,
)
async def create_dashboard_api_key(
    body: CreateApiKeyRequest,
    request: Request,
    identity: DashboardIdentity,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> IssuedDashboardApiKey:
    credentials = _credential_service(request)
    user = await _provision_user(credentials, identity)
    try:
        issued = await credentials.issue_dashboard_api_key(
            user_id=user.id,
            name=body.name,
            idempotency_key=idempotency_key or "",
            dashboard_secret=_dashboard_secret(request),
        )
    except ApiKeyIdempotencyConflict as error:
        raise HTTPException(status_code=409, detail="API key request conflicts") from error
    except ApiKeyLimitExceeded as error:
        raise HTTPException(status_code=429, detail="Active API key limit reached") from error
    except AgentCredentialError as error:
        raise HTTPException(status_code=400, detail="Invalid API key request") from error
    return IssuedDashboardApiKey(api_key=_api_key(issued.key), credential=issued.credential)


@router.post("/api-keys/{key_id}/revoke", response_model=RevokedDashboardApiKey)
async def revoke_dashboard_api_key(
    key_id: str,
    request: Request,
    identity: DashboardIdentity,
) -> RevokedDashboardApiKey:
    credentials = _credential_service(request)
    user = await _provision_user(credentials, identity)
    try:
        revoked = await credentials.revoke_api_key(user_id=user.id, key_id=key_id)
    except AgentApiKeyNotFound as error:
        raise HTTPException(status_code=404, detail="API key not found") from error
    except AgentCredentialError as error:
        raise HTTPException(status_code=400, detail="Invalid API key request") from error
    return RevokedDashboardApiKey(api_key=_api_key(revoked))


@router.post(
    "/billing/checkout",
    response_model=DashboardCheckout,
    status_code=status.HTTP_201_CREATED,
)
async def create_billing_checkout(
    request: Request,
    identity: DashboardIdentity,
    idempotency_key: Annotated[str | None, Header(alias="Idempotency-Key")] = None,
) -> DashboardCheckout:
    billing = _billing_service(request)
    if idempotency_key is None:
        raise HTTPException(status_code=400, detail="Invalid checkout request")
    credentials = _credential_service(request)
    user = await _provision_user(credentials, identity)
    try:
        checkout = await billing.create_checkout(
            user_id=user.id,
            email=user.email,
            idempotency_key=idempotency_key,
        )
    except BillingIdempotencyConflict as error:
        raise HTTPException(status_code=409, detail="Checkout request conflicts") from error
    except BillingUnavailable as error:
        raise HTTPException(status_code=503, detail="Billing provider unavailable") from error
    except BillingError as error:
        raise HTTPException(status_code=400, detail="Invalid checkout request") from error
    return DashboardCheckout(
        session_id=checkout.session_id,
        checkout_url=checkout.checkout_url,
    )


def _credential_service(request: Request) -> AgentCredentialService:
    return cast(AgentCredentialService, request.app.state.agent_credentials)


def _dashboard_secret(request: Request) -> str:
    secret = request.app.state.settings.dashboard_token_secret
    if not isinstance(secret, str):
        raise HTTPException(status_code=404, detail="Not Found")
    return secret


def _billing_service(request: Request) -> BillingCheckoutCreator:
    service = cast(BillingCheckoutCreator | None, request.app.state.billing_checkout_service)
    if service is None:
        raise HTTPException(status_code=503, detail="Billing is not configured")
    return service


async def _provision_user(
    credentials: AgentCredentialService, identity: DashboardPrincipal
) -> UserRecord:
    return await credentials.create_user(
        auth_provider=identity.provider,
        auth_subject=identity.provider_account_id,
        email=identity.email,
    )


def _overview(status: UserCredentialStatus) -> DashboardOverview:
    return DashboardOverview(
        user=DashboardUser(
            id=status.user.id,
            email=status.user.email,
            credits=status.user.credits,
            created_at=status.user.created_at,
        ),
        api_keys=[_api_key(key) for key in status.api_keys],
    )


def _api_key(key: ApiKeyRecord) -> DashboardApiKey:
    return DashboardApiKey(
        id=key.id,
        name=key.name,
        created_at=key.created_at,
        last_used_at=key.last_used_at,
        revoked_at=key.revoked_at,
    )
