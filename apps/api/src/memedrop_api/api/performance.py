"""Best-effort anonymous browser measurements, separate from ranking feedback."""

from __future__ import annotations

import asyncio

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError

from memedrop_api.identity import InstallHeader, resolve_install_identity
from memedrop_api.performance_metrics import PerformanceBatch, PerformanceStore

router = APIRouter(prefix="/api/v1/performance", tags=["performance"])
MAX_BODY_BYTES = 32_768
BODY_TIMEOUT_SECONDS = 1.0
WRITE_TIMEOUT_SECONDS = 1.0


@router.post("/batch")
async def record_performance_batch(
    request: Request, install_id: InstallHeader = None
) -> JSONResponse:
    # Validate the existing isolation header without creating or retaining an
    # install record or associating it with these anonymous measurements.
    resolve_install_identity(
        install_id=install_id,
        require_install_id=request.app.state.settings.require_install_id,
    )
    try:
        body = bytearray()
        async with asyncio.timeout(BODY_TIMEOUT_SECONDS):
            async for chunk in request.stream():
                if len(body) + len(chunk) > MAX_BODY_BYTES:
                    return JSONResponse(status_code=413, content={"error": "Batch too large"})
                body.extend(chunk)
        batch = PerformanceBatch.model_validate_json(body)
    except (ValidationError, ValueError, TimeoutError):
        # Do not echo arbitrary field names, values, or a validation error's
        # input representation into responses or application logs.
        return JSONResponse(status_code=400, content={"error": "Invalid performance batch"})
    store: PerformanceStore = request.app.state.performance_store
    try:
        async with asyncio.timeout(WRITE_TIMEOUT_SECONDS):
            recorded = await store.record(batch.samples)
    except Exception:
        # Diagnostics must never hold up or corrupt the actual suggestion flow.
        return JSONResponse(status_code=503, content={"error": "Measurements unavailable"})
    return JSONResponse(content={"received": len(batch.samples), "recorded": recorded})
