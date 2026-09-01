"""Dodo-hosted one-time credit-pack checkout orchestration."""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any, Protocol

from dodopayments import APIConnectionError, APIStatusError, APITimeoutError, AsyncDodoPayments
from pydantic import BaseModel, ConfigDict, Field, ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from standardwebhooks import WebhookVerificationError

from memedrop_api.db import BillingCheckout, CreditTransaction, Database, User
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


class InvalidBillingWebhook(BillingError):
    """A webhook signature or supported event payload is invalid."""


class BillingFulfillmentConflict(RuntimeError):
    """A verified event conflicts with the durable checkout or ledger."""


@dataclass(frozen=True, slots=True)
class HostedCheckout:
    session_id: str
    checkout_url: str


@dataclass(frozen=True, slots=True)
class WebhookResult:
    outcome: str
    payment_id: str | None = None


class _PaymentCartItem(BaseModel):
    model_config = ConfigDict(extra="ignore")

    product_id: str = Field(min_length=1, max_length=80)
    quantity: int = Field(ge=1, le=100)


class _PaymentSucceededData(BaseModel):
    model_config = ConfigDict(extra="ignore")

    payment_id: str = Field(min_length=1, max_length=200)
    checkout_session_id: str = Field(min_length=1, max_length=255)
    status: str
    product_cart: list[_PaymentCartItem]
    metadata: dict[str, MetadataValue]


class _PaymentSucceededEvent(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: str
    data: _PaymentSucceededData


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


class BillingWebhookProcessor(Protocol):
    async def process_webhook(
        self, *, payload: str, headers: Mapping[str, str]
    ) -> WebhookResult: ...


class WebhookVerifier(Protocol):
    def unwrap_webhook(self, *, payload: str, headers: Mapping[str, str]) -> dict[str, Any]: ...


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

    def unwrap_webhook(self, *, payload: str, headers: Mapping[str, str]) -> dict[str, Any]:
        try:
            event = self._client.webhooks.unwrap(payload, headers=headers)
        except (WebhookVerificationError, ValueError) as error:
            raise InvalidBillingWebhook("Dodo webhook verification failed") from error
        return event.model_dump(mode="json")


class BillingCheckoutService:
    def __init__(
        self,
        database: Database,
        gateway: CheckoutGateway,
        *,
        product_id: str,
        return_url: str,
        webhook_verifier: WebhookVerifier | None = None,
    ) -> None:
        self._database = database
        self._gateway = gateway
        self._product_id = product_id
        self._return_url = return_url
        self._webhook_verifier = webhook_verifier

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

    async def process_webhook(self, *, payload: str, headers: Mapping[str, str]) -> WebhookResult:
        if self._webhook_verifier is None:
            raise BillingUnavailable("Dodo webhook verification is not configured")
        event = self._webhook_verifier.unwrap_webhook(payload=payload, headers=headers)
        if event.get("type") != "payment.succeeded":
            return WebhookResult("ignored")
        try:
            payment = _PaymentSucceededEvent.model_validate(event).data
        except ValidationError as error:
            raise InvalidBillingWebhook("Dodo payment webhook is invalid") from error
        if payment.status != "succeeded":
            raise InvalidBillingWebhook("Dodo payment status is not succeeded")
        return await self._fulfill_payment(payment)

    async def _fulfill_payment(self, payment: _PaymentSucceededData) -> WebhookResult:
        external_id = f"dodo:payment:{payment.payment_id}"
        async with self._database.session() as session, session.begin():
            checkout = await session.scalar(
                select(BillingCheckout)
                .where(BillingCheckout.session_id == payment.checkout_session_id)
                .with_for_update()
            )
            if checkout is None:
                return WebhookResult("ignored", payment.payment_id)
            _validate_payment_matches_checkout(payment, checkout)
            if checkout.status == "paid":
                if checkout.payment_id != payment.payment_id:
                    raise BillingFulfillmentConflict("checkout has a different payment")
                return WebhookResult("duplicate", payment.payment_id)

            user = await session.scalar(
                select(User).where(User.id == checkout.user_id).with_for_update()
            )
            if user is None:
                raise BillingFulfillmentConflict("checkout owner does not exist")
            existing = await session.scalar(
                select(CreditTransaction).where(CreditTransaction.external_id == external_id)
            )
            if existing is not None:
                if (
                    existing.user_id != checkout.user_id
                    or existing.type != "purchase"
                    or existing.amount != checkout.credits
                ):
                    raise BillingFulfillmentConflict("payment ledger identity conflicts")
            else:
                session.add(
                    CreditTransaction(
                        user_id=checkout.user_id,
                        amount=checkout.credits,
                        type="purchase",
                        external_id=external_id,
                    )
                )
                user.credits += checkout.credits
            checkout.status = "paid"
            checkout.payment_id = payment.payment_id
            checkout.paid_at = datetime.now(UTC)
            await session.flush()
            return WebhookResult("processed", payment.payment_id)


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


def _validate_payment_matches_checkout(
    payment: _PaymentSucceededData, checkout: BillingCheckout
) -> None:
    product_cart = [(item.product_id, item.quantity) for item in payment.product_cart]
    if product_cart != [(checkout.product_id, 1)]:
        raise BillingFulfillmentConflict("payment product does not match checkout")
    expected_metadata = {
        "application": "memedrop",
        "schema_version": "1",
        "user_id": checkout.user_id,
        "pack_key": checkout.pack_key,
        "credits": str(checkout.credits),
    }
    if any(payment.metadata.get(key) != value for key, value in expected_metadata.items()):
        raise BillingFulfillmentConflict("payment metadata does not match checkout")
