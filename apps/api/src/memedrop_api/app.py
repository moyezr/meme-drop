from __future__ import annotations

import logging
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException

from memedrop_api.api.health import ReadinessCheck
from memedrop_api.api.health import router as health_router
from memedrop_api.config import Settings
from memedrop_api.db import Database

LOGGER = logging.getLogger("memedrop.api")
REQUEST_ID_HEADER = "x-request-id"
SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9_-]{8,128}$")


def create_app(
    settings: Settings | None = None,
    *,
    readiness_check: ReadinessCheck | None = None,
) -> FastAPI:
    app_settings = settings or Settings()  # type: ignore[call-arg]
    Path(app_settings.meme_storage_path).mkdir(parents=True, exist_ok=True)
    database = Database(app_settings.database_url) if readiness_check is None else None

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        yield
        if database is not None:
            await database.close()

    app = FastAPI(
        title="MemeDrop API",
        version="0.1.0",
        docs_url=None if app_settings.is_production else "/docs",
        redoc_url=None,
        lifespan=lifespan,
    )
    app.state.settings = app_settings
    app.state.database = database
    app.state.readiness_check = readiness_check or database.is_ready  # type: ignore[union-attr]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "x-memedrop-install-id", REQUEST_ID_HEADER],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):  # type: ignore[no-untyped-def]
        incoming = request.headers.get(REQUEST_ID_HEADER)
        request_id = incoming if incoming and SAFE_REQUEST_ID.fullmatch(incoming) else str(uuid4())
        request.state.request_id = request_id
        try:
            response = await call_next(request)
        except Exception:
            LOGGER.exception("Request failed", extra={"request_id": request_id})
            response = JSONResponse(
                status_code=500,
                content={"error": "Internal Server Error", "request_id": request_id},
            )
        response.headers[REQUEST_ID_HEADER] = request_id
        return response

    @app.exception_handler(RequestValidationError)
    async def validation_error_handler(
        request: Request, error: RequestValidationError
    ) -> JSONResponse:
        details = []
        for issue in error.errors():
            location = [
                str(part) for part in issue.get("loc", ()) if part not in {"body", "query", "path"}
            ]
            details.append(
                {"path": ".".join(location), "message": issue.get("msg", "Invalid value")}
            )
        return JSONResponse(
            status_code=400,
            content={"error": "Invalid request", "details": details},
        )

    @app.exception_handler(HTTPException)
    async def http_error_handler(request: Request, error: HTTPException) -> JSONResponse:
        if error.status_code == 404:
            return JSONResponse(
                status_code=404,
                content={"error": "Not Found", "request_id": request.state.request_id},
            )
        detail = error.detail if isinstance(error.detail, str) else "Request failed"
        return JSONResponse(status_code=error.status_code, content={"error": detail})

    app.include_router(health_router)
    app.mount(
        "/memes",
        StaticFiles(directory=str(app_settings.meme_storage_path), check_dir=False),
        name="memes",
    )
    return app
