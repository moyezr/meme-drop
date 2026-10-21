from __future__ import annotations

from fastapi import APIRouter, Request

from memedrop_api.identity import InstallHeader, resolve_request_user_id
from memedrop_api.repositories import BackendStore, UsageEventData
from memedrop_api.schemas import UsageBatchRequest, UsageRequest
from memedrop_api.services.suggestion_engine import SuggestionService

router = APIRouter(prefix="/api/v1", tags=["usage"])


def usage_event_data(body: UsageRequest) -> UsageEventData:
    return UsageEventData(
        meme_id=body.meme_id,
        action=body.action,
        tweet_context=body.tweet_context.model_dump(exclude_none=True),
        source=body.source,
        event_id=body.event_id,
        telemetry_version=body.telemetry_version,
        impression_id=body.impression_id,
        position=body.position,
    )


@router.post("/usage")
async def record_usage(
    body: UsageRequest,
    request: Request,
    install_id: InstallHeader = None,
) -> dict[str, bool]:
    user_id = await resolve_request_user_id(request, install_id)
    store: BackendStore = request.app.state.store
    await store.record_usage_batch(user_id=user_id, events=[usage_event_data(body)])
    suggestion_service: SuggestionService = request.app.state.suggestion_service
    if body.telemetry_version == 2 and body.action in {
        "shown",
        "clicked",
        "inserted",
        "saved",
        "rejected",
    }:
        suggestion_service.invalidate_feedback(user_id)
    return {"logged": True}


@router.post("/usage/batch")
async def record_usage_batch(
    body: UsageBatchRequest,
    request: Request,
    install_id: InstallHeader = None,
) -> dict[str, int]:
    user_id = await resolve_request_user_id(request, install_id)
    store: BackendStore = request.app.state.store
    await store.record_usage_batch(
        user_id=user_id,
        events=[usage_event_data(event) for event in body.events],
    )
    suggestion_service: SuggestionService = request.app.state.suggestion_service
    if any(
        event.telemetry_version == 2
        and event.action in {"shown", "clicked", "inserted", "saved", "rejected"}
        for event in body.events
    ):
        suggestion_service.invalidate_feedback(user_id)
    return {"logged": len(body.events)}
