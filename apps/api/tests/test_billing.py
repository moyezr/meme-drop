from __future__ import annotations

import os
from collections.abc import AsyncIterator, Mapping
from datetime import UTC, datetime
from typing import cast
from uuid import uuid4

import pytest
import pytest_asyncio
from sqlalchemy import Connection, Table, select
from standardwebhooks import Webhook

from memedrop_api.billing import (
    PACK_100_CREDITS,
    BillingCheckoutService,
    DodoCheckoutGateway,
    HostedCheckout,
    InvalidBillingWebhook,
    MetadataValue,
    _checkout_idempotency_hash,
)
from memedrop_api.db import Base, BillingCheckout, CreditTransaction, Database, User
from memedrop_api.public_ids import PublicIdKind, create_public_id

TEST_DATABASE_URL = os.environ.get("MEMEDROP_TEST_DATABASE_URL")
BILLING_TABLES: tuple[Table, ...] = (
    cast(Table, User.__table__),
    cast(Table, BillingCheckout.__table__),
    cast(Table, CreditTransaction.__table__),
)


class RecordingCheckoutGateway:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []
        self.session_id = f"cks_test_{uuid4().hex}"

    async def create_checkout(
        self,
        *,
        product_id: str,
        email: str | None,
        return_url: str,
        metadata: dict[str, MetadataValue],
        idempotency_key: str,
    ) -> HostedCheckout:
        self.calls.append(
            {
                "product_id": product_id,
                "email": email,
                "return_url": return_url,
                "metadata": metadata,
                "idempotency_key": idempotency_key,
            }
        )
        return HostedCheckout(
            self.session_id,
            f"https://test.checkout.dodopayments.com/session/{self.session_id}",
        )


class RecordingWebhookVerifier:
    def __init__(self) -> None:
        self.event: dict[str, object] = {}

    def unwrap_webhook(self, *, payload: str, headers: Mapping[str, str]) -> dict[str, object]:
        assert payload == "signed-body"
        assert headers
        return self.event


def _create_billing_tables(connection: Connection) -> None:
    Base.metadata.create_all(connection, tables=BILLING_TABLES)


@pytest_asyncio.fixture
async def database() -> AsyncIterator[Database]:
    if not TEST_DATABASE_URL:
        pytest.skip("MEMEDROP_TEST_DATABASE_URL is not configured")
    database = Database(TEST_DATABASE_URL)
    async with database.engine.begin() as connection:
        await connection.run_sync(_create_billing_tables)
    try:
        yield database
    finally:
        await database.close()


def test_checkout_idempotency_hash_is_namespaced_and_hides_input() -> None:
    digest = _checkout_idempotency_hash("purchase-attempt-1")
    assert len(digest) == 32
    assert digest == _checkout_idempotency_hash("purchase-attempt-1")
    assert b"purchase-attempt-1" not in digest


async def test_official_dodo_verifier_accepts_standard_webhook_signature() -> None:
    secret = b"secret\n"
    gateway = DodoCheckoutGateway(
        api_key="test_api_key_0123456789",
        webhook_key="whsec_c2VjcmV0Cg==",
        environment="test_mode",
    )
    payload = (
        '{"business_id":"business_id","data":{"abandoned_at":'
        '"2019-12-27T18:11:19.117Z","abandonment_reason":"payment_failed",'
        '"brand_id":"brand_id","customer_id":"customer_id","payment_id":'
        '"payment_id","status":"abandoned","recovered_payment_id":null},'
        '"timestamp":"2019-12-27T18:11:19.117Z",'
        '"type":"abandoned_checkout.detected"}'
    )
    timestamp = datetime.now(UTC)
    headers = {
        "webhook-id": "msg_test_1",
        "webhook-timestamp": str(int(timestamp.timestamp())),
        "webhook-signature": Webhook(secret).sign(
            msg_id="msg_test_1", timestamp=timestamp, data=payload
        ),
    }
    try:
        event = gateway.unwrap_webhook(payload=payload, headers=headers)
        assert event["type"] == "abandoned_checkout.detected"
        with pytest.raises(InvalidBillingWebhook):
            gateway.unwrap_webhook(
                payload=payload,
                headers={**headers, "webhook-signature": "v1,invalid"},
            )
    finally:
        await gateway.close()


@pytest.mark.integration
async def test_checkout_creation_is_persisted_and_provider_idempotent(database: Database) -> None:
    user_id = create_public_id(PublicIdKind.USER).value
    async with database.session() as session, session.begin():
        session.add(
            User(
                id=user_id,
                auth_provider="billing-test",
                auth_subject=user_id,
                email="buyer@example.test",
            )
        )
    gateway = RecordingCheckoutGateway()
    service = BillingCheckoutService(
        database,
        gateway,
        product_id="pdt_0NmdxP8VNKdUvJyokZR9m",
        return_url="https://example.test/dashboard/billing?checkout=return",
    )

    created = await service.create_checkout(
        user_id=user_id,
        email="buyer@example.test",
        idempotency_key="purchase-attempt-1",
    )
    replayed = await service.create_checkout(
        user_id=user_id,
        email="buyer@example.test",
        idempotency_key="purchase-attempt-1",
    )

    assert replayed == created
    assert len(gateway.calls) == 1
    assert gateway.calls[0]["metadata"] == {
        "application": "memedrop",
        "schema_version": "1",
        "user_id": user_id,
        "pack_key": "credits_100",
        "credits": str(PACK_100_CREDITS),
    }
    assert gateway.calls[0]["idempotency_key"] == (
        f"memedrop-{_checkout_idempotency_hash('purchase-attempt-1').hex()}"
    )
    async with database.session() as session:
        stored = await session.scalar(
            select(BillingCheckout).where(BillingCheckout.session_id == created.session_id)
        )
    assert stored is not None
    assert stored.user_id == user_id
    assert stored.checkout_url == created.checkout_url
    assert stored.credits == 100


@pytest.mark.integration
async def test_signed_payment_fulfillment_grants_credits_exactly_once(database: Database) -> None:
    user_id = create_public_id(PublicIdKind.USER).value
    async with database.session() as session, session.begin():
        session.add(
            User(
                id=user_id,
                auth_provider="billing-webhook-test",
                auth_subject=user_id,
                email="buyer@example.test",
            )
        )
    gateway = RecordingCheckoutGateway()
    verifier = RecordingWebhookVerifier()
    service = BillingCheckoutService(
        database,
        gateway,
        product_id="pdt_0NmdxP8VNKdUvJyokZR9m",
        return_url="https://example.test/dashboard/billing?checkout=return",
        webhook_verifier=verifier,
    )
    checkout = await service.create_checkout(
        user_id=user_id,
        email="buyer@example.test",
        idempotency_key=f"purchase-{uuid4().hex}",
    )
    payment_id = f"pay_test_{uuid4().hex}"
    verifier.event = {
        "type": "payment.succeeded",
        "data": {
            "payment_id": payment_id,
            "checkout_session_id": checkout.session_id,
            "status": "succeeded",
            "product_cart": [{"product_id": "pdt_0NmdxP8VNKdUvJyokZR9m", "quantity": 1}],
            "metadata": {
                "application": "memedrop",
                "schema_version": "1",
                "user_id": user_id,
                "pack_key": "credits_100",
                "credits": "100",
            },
        },
    }

    processed = await service.process_webhook(payload="signed-body", headers={"webhook-id": "1"})
    duplicate = await service.process_webhook(payload="signed-body", headers={"webhook-id": "1"})

    assert processed.outcome == "processed"
    assert duplicate.outcome == "duplicate"
    async with database.session() as session:
        user = await session.get(User, user_id)
        stored_checkout = await session.get(BillingCheckout, checkout.session_id)
        transactions = list(
            await session.scalars(
                select(CreditTransaction).where(
                    CreditTransaction.external_id == f"dodo:payment:{payment_id}"
                )
            )
        )
    assert user is not None and user.credits == 100
    assert stored_checkout is not None and stored_checkout.status == "paid"
    assert stored_checkout.payment_id == payment_id
    assert [(item.type, item.amount) for item in transactions] == [("purchase", 100)]
