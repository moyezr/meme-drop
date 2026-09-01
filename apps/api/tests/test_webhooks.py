from __future__ import annotations

from collections.abc import Mapping

import httpx

from memedrop_api.app import create_app
from memedrop_api.billing import InvalidBillingWebhook, WebhookResult
from memedrop_api.config import Settings


class RecordingWebhookProcessor:
    def __init__(self, *, invalid: bool = False) -> None:
        self.invalid = invalid
        self.calls: list[tuple[str, Mapping[str, str]]] = []

    async def process_webhook(self, *, payload: str, headers: Mapping[str, str]) -> WebhookResult:
        self.calls.append((payload, headers))
        if self.invalid:
            raise InvalidBillingWebhook("invalid")
        return WebhookResult("processed", "pay_test")


def _client(settings: Settings, processor: RecordingWebhookProcessor) -> httpx.AsyncClient:
    configured = settings.model_copy(
        update={
            "dodo_payments_api_key": None,
            "dodo_payments_credit_pack_100_product_id": None,
        }
    )
    app = create_app(configured, billing_webhook_service=processor)
    return httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
        base_url="http://test",
    )


async def test_webhook_uses_raw_body_and_standard_headers(settings: Settings) -> None:
    processor = RecordingWebhookProcessor()
    headers = {
        "webhook-id": "msg_1",
        "webhook-signature": "v1,signature",
        "webhook-timestamp": "1234567890",
        "Content-Type": "application/json",
    }
    async with _client(settings, processor) as client:
        response = await client.post(
            "/api/v1/webhooks/dodo",
            headers=headers,
            content='{"type":"payment.succeeded"}',
        )

    assert response.status_code == 200
    assert response.json() == {"received": True}
    assert processor.calls == [
        (
            '{"type":"payment.succeeded"}',
            {
                "webhook-id": "msg_1",
                "webhook-signature": "v1,signature",
                "webhook-timestamp": "1234567890",
            },
        )
    ]


async def test_webhook_rejects_invalid_signature_and_oversized_body(settings: Settings) -> None:
    invalid = RecordingWebhookProcessor(invalid=True)
    async with _client(settings, invalid) as client:
        rejected = await client.post("/api/v1/webhooks/dodo", content="invalid")
        oversized = await client.post(
            "/api/v1/webhooks/dodo",
            content=b"x" * (256 * 1024 + 1),
        )

    assert rejected.status_code == 401
    assert oversized.status_code == 413
