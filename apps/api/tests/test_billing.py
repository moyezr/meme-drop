from __future__ import annotations

import os
from collections.abc import AsyncIterator
from typing import cast

import pytest
import pytest_asyncio
from sqlalchemy import Connection, Table, select

from memedrop_api.billing import (
    PACK_100_CREDITS,
    BillingCheckoutService,
    HostedCheckout,
    MetadataValue,
    _checkout_idempotency_hash,
)
from memedrop_api.db import Base, BillingCheckout, Database, User
from memedrop_api.public_ids import PublicIdKind, create_public_id

TEST_DATABASE_URL = os.environ.get("MEMEDROP_TEST_DATABASE_URL")
BILLING_TABLES: tuple[Table, ...] = (
    cast(Table, User.__table__),
    cast(Table, BillingCheckout.__table__),
)


class RecordingCheckoutGateway:
    def __init__(self) -> None:
        self.calls: list[dict[str, object]] = []

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
            "cks_test_billing_checkout",
            "https://test.checkout.dodopayments.com/session/cks_test_billing_checkout",
        )


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
