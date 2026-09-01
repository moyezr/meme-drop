"""Dodo-hosted one-time credit-pack checkout orchestration."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Any, Protocol

from dodopayments import APIConnectionError, APIStatusError, APITimeoutError, AsyncDodoPayments
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from memedrop_api.db import BillingCheckout, Database
from memedrop_api.public_ids import PublicIdError, PublicIdKind, parse_public_id

PACK_100_KEY = "credits_100"
PACK_100_CREDITS = 100
MetadataValue = str | float | bool


class BillingError(ValueError):
    """Base error for a safe customer billing operation."""


class BillingUnavailable(BillingError):
    """The hosted billing provider is unavailable or misconfigured."""


class BillingIdempotencyConflict(BillingError):
    """A checkout idempotency key was reused for a different operation."""


@dataclass(frozen=True, slots=True)
class HostedCheckout:
    session_id: str
    checkout_url: str


class CheckoutGateway(Protocol):
    async def create_checkout(
        self,
        *,
        product_id: str,
        email: str | None,
        return_url: str,
        metadata: dict[str, MetadataValue],
        idempotency_key: str,
    ) -> HostedCheckout: ...


class BillingCheckoutCreator(Protocol):
    async def create_checkout(
        self,
        *,
        user_id: str,
        email: str | None,
        idempotency_key: str,
    ) -> HostedCheckout: ...


class DodoCheckoutGateway:
    """Bounded adapter around Dodo's official asynchronous SDK."""

    def __init__(
        self,
        *,
        api_key: str,
        environment: str,
        webhook_key: str | None = None,
    ) -> None:
        if environment not in {"test_mode", "live_mode"}:
            raise ValueError("invalid Dodo environment")
        self._client = AsyncDodoPayments(
            bearer_token=api_key,
            webhook_key=webhook_key,
            environment=environment,  # type: ignore[arg-type]
            timeout=10.0,
            max_retries=1,
        )

    async def create_checkout(
        self,
        *,
        product_id: str,
        email: str | None,
        return_url: str,
        metadata: dict[str, MetadataValue],
        idempotency_key: str,
    ) -> HostedCheckout:
        customer: Any = {"email": email, "name": email.partition("@")[0]} if email else None
        try:
            response = await self._client.checkout_sessions.create(
                product_cart=[{"product_id": product_id, "quantity": 1}],
                customer=customer,
                return_url=return_url,
                cancel_url=return_url,
                metadata=metadata,
                extra_headers={"Idempotency-Key": idempotency_key},
            )
        except (APIConnectionError, APIStatusError, APITimeoutError) as error:
            raise BillingUnavailable("Dodo checkout could not be created") from error
        if not response.checkout_url:
            raise BillingUnavailable("Dodo checkout response omitted its hosted URL")
        return HostedCheckout(response.session_id, response.checkout_url)

    async def close(self) -> None:
        await self._client.close()


class BillingCheckoutService:
    def __init__(
        self,
        database: Database,
        gateway: CheckoutGateway,
        *,
        product_id: str,
        return_url: str,
    ) -> None:
        self._database = database
        self._gateway = gateway
        self._product_id = product_id
        self._return_url = return_url

    async def create_checkout(
        self,
        *,
        user_id: str,
        email: str | None,
        idempotency_key: str,
    ) -> HostedCheckout:
        _validate_user_id(user_id)
        key_hash = _checkout_idempotency_hash(idempotency_key)
        existing = await self._existing_checkout(user_id=user_id, key_hash=key_hash)
        if existing is not None:
            return _hosted_checkout(existing)

        provider_key = f"memedrop-{key_hash.hex()}"
        checkout = await self._gateway.create_checkout(
            product_id=self._product_id,
            email=email,
            return_url=self._return_url,
            metadata={
                "application": "memedrop",
                "schema_version": "1",
                "user_id": user_id,
                "pack_key": PACK_100_KEY,
                "credits": str(PACK_100_CREDITS),
            },
            idempotency_key=provider_key,
        )
        try:
            async with self._database.session() as session, session.begin():
                session.add(
                    BillingCheckout(
                        session_id=checkout.session_id,
                        checkout_url=checkout.checkout_url,
                        user_id=user_id,
                        idempotency_key_hash=key_hash,
                        pack_key=PACK_100_KEY,
                        product_id=self._product_id,
                        credits=PACK_100_CREDITS,
                    )
                )
                await session.flush()
        except IntegrityError:
            replay = await self._existing_checkout(user_id=user_id, key_hash=key_hash)
            if replay is None:
                raise BillingIdempotencyConflict("checkout identity conflicts") from None
            return _hosted_checkout(replay)
        return checkout

    async def _existing_checkout(self, *, user_id: str, key_hash: bytes) -> BillingCheckout | None:
        async with self._database.session() as session:
            return await session.scalar(
                select(BillingCheckout).where(
                    BillingCheckout.user_id == user_id,
                    BillingCheckout.idempotency_key_hash == key_hash,
                )
            )


def _checkout_idempotency_hash(value: str) -> bytes:
    if not isinstance(value, str) or not 1 <= len(value) <= 200:
        raise BillingError("idempotency key is required")
    try:
        encoded = value.encode("ascii")
    except UnicodeEncodeError as error:
        raise BillingError("idempotency key must be ASCII") from error
    if any(byte < 33 or byte > 126 for byte in encoded):
        raise BillingError("idempotency key contains invalid characters")
    return hashlib.sha256(b"memedrop:billing-checkout:v1\0" + encoded).digest()


def _validate_user_id(user_id: str) -> None:
    try:
        parse_public_id(user_id, expected_kind=PublicIdKind.USER)
    except PublicIdError as error:
        raise BillingError("invalid user ID") from error


def _hosted_checkout(checkout: BillingCheckout) -> HostedCheckout:
    if checkout.pack_key != PACK_100_KEY or checkout.credits != PACK_100_CREDITS:
        raise BillingIdempotencyConflict("checkout idempotency key conflicts")
    return HostedCheckout(checkout.session_id, checkout.checkout_url)
