"""Public, signature-verified payment-provider callbacks."""

from __future__ import annotations

from typing import cast

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict

from memedrop_api.billing import (
    BillingFulfillmentConflict,
    BillingUnavailable,
    BillingWebhookProcessor,
    InvalidBillingWebhook,
)

router = APIRouter(prefix="/api/v1/webhooks", tags=["webhooks"])
_MAX_WEBHOOK_BYTES = 256 * 1024


class WebhookAcknowledgement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    received: bool


@router.post("/dodo", response_model=WebhookAcknowledgement)
async def receive_dodo_webhook(request: Request) -> WebhookAcknowledgement:
    service = cast(
        BillingWebhookProcessor | None,
        request.app.state.billing_webhook_service,
    )
    if service is None:
        raise HTTPException(status_code=503, detail="Billing webhook is not configured")
    content_length = request.headers.get("content-length")
    if content_length:
        try:
            if int(content_length) > _MAX_WEBHOOK_BYTES:
                raise HTTPException(status_code=413, detail="Webhook body is too large")
        except ValueError as error:
            raise HTTPException(status_code=400, detail="Invalid content length") from error
    raw_body = await request.body()
    if len(raw_body) > _MAX_WEBHOOK_BYTES:
        raise HTTPException(status_code=413, detail="Webhook body is too large")
    try:
        payload = raw_body.decode("utf-8")
    except UnicodeDecodeError as error:
        raise HTTPException(status_code=400, detail="Webhook body must be UTF-8") from error
    headers = {
        name: request.headers.get(name, "")
        for name in ("webhook-id", "webhook-signature", "webhook-timestamp")
    }
    try:
        await service.process_webhook(payload=payload, headers=headers)
    except InvalidBillingWebhook as error:
        raise HTTPException(status_code=401, detail="Invalid webhook") from error
    except BillingUnavailable as error:
        raise HTTPException(status_code=503, detail="Billing webhook is unavailable") from error
    except BillingFulfillmentConflict as error:
        raise HTTPException(status_code=500, detail="Billing fulfillment failed") from error
    return WebhookAcknowledgement(received=True)
