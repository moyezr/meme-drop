from __future__ import annotations

import logging
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException
from starlette.responses import Response

from memedrop_api.api.account import router as account_router
from memedrop_api.api.agent_memes import router as agent_memes_router
from memedrop_api.api.health import ReadinessCheck, TrendSnapshotCheck
from memedrop_api.api.health import router as health_router
from memedrop_api.api.internal_catalog import router as internal_catalog_router
from memedrop_api.api.internal_trends import TrendRefreshLock, TrendRefreshRunner
from memedrop_api.api.internal_trends import router as internal_trends_router
from memedrop_api.api.library import router as library_router
from memedrop_api.api.memes import router as memes_router
from memedrop_api.api.suggest import router as suggest_router
from memedrop_api.api.usage import router as usage_router
from memedrop_api.catalog_workbench import CatalogDraftStore, SqlAlchemyCatalogDraftStore
from memedrop_api.config import Settings
from memedrop_api.db import Database
from memedrop_api.rate_limit import (
    EXPENSIVE_ROUTES,
    MemoryRateLimitStore,
    PostgresRateLimitStore,
    RateLimitStore,
    RedisRateLimitStore,
    rate_limit_client_key,
)
from memedrop_api.repositories import BackendStore, SqlAlchemyStore
from memedrop_api.services.agent_memes import AgentMemeService, MemeRenderer
from memedrop_api.services.auto_tagger import auto_tag_meme
from memedrop_api.services.catalog import MemeCatalog
from memedrop_api.services.image_downloader import download_image
from memedrop_api.services.meme_renderer import render_meme
from memedrop_api.services.openrouter import OpenRouterSuggestionGateway
from memedrop_api.services.storage import MemeStorage, create_meme_storage
from memedrop_api.services.suggestion_engine import SuggestionService
from memedrop_api.services.trend_cron import RedisTrendRefreshLock
from memedrop_api.services.trend_index import RedisTrendIndex
from memedrop_api.services.trend_monitoring import TrendSnapshotHealthCheck
from memedrop_api.services.trend_runtime import refresh_trends

LOGGER = logging.getLogger("memedrop.api")
REQUEST_ID_HEADER = "x-request-id"
SAFE_REQUEST_ID = re.compile(r"^[A-Za-z0-9_-]{8,128}$")


def create_app(
    settings: Settings | None = None,
    *,
    readiness_check: ReadinessCheck | None = None,
    store: BackendStore | None = None,
    rate_limiter: RateLimitStore | None = None,
    download_image_service=None,  # type: ignore[no-untyped-def]
    auto_tag_service=None,  # type: ignore[no-untyped-def]
    suggestion_service: SuggestionService | None = None,
    storage: MemeStorage | None = None,
    catalog_draft_store: CatalogDraftStore | None = None,
    meme_renderer: MemeRenderer | None = None,
    trend_snapshot_check: TrendSnapshotCheck | None = None,
    trend_refresh_lock: TrendRefreshLock | None = None,
    trend_refresh_runner: TrendRefreshRunner | None = None,
) -> FastAPI:
    app_settings = settings or Settings()  # type: ignore[call-arg]
    meme_storage = storage or create_meme_storage(app_settings)
    database = Database(app_settings.database_url)
    backend_store = store or SqlAlchemyStore(database)
    catalog_store = catalog_draft_store or SqlAlchemyCatalogDraftStore(database)
    catalog = MemeCatalog.load()
    default_gateway: OpenRouterSuggestionGateway | None = None
    default_trend_index: RedisTrendIndex | None = None
    default_trend_refresh_lock: RedisTrendRefreshLock | None = None
    default_trend_snapshot_check: TrendSnapshotHealthCheck | None = None
    trend_redis_url = app_settings.trend_redis_url
    if suggestion_service is None:
        default_gateway = OpenRouterSuggestionGateway(app_settings)
        if trend_redis_url:
            default_trend_index = RedisTrendIndex(trend_redis_url)
        suggestions = SuggestionService(
            backend_store,
            catalog,
            default_gateway,
            app_settings,
            trend_retriever=default_trend_index,
        )
    else:
        suggestions = suggestion_service
    if trend_redis_url:
        default_trend_refresh_lock = RedisTrendRefreshLock(
            trend_redis_url,
            ttl_seconds=app_settings.trend_refresh_lock_ttl_seconds,
        )
        default_trend_snapshot_check = TrendSnapshotHealthCheck(
            database,
            max_age_seconds=app_settings.trend_snapshot_max_age_seconds,
        )
    if rate_limiter is not None:
        limiter = rate_limiter
    elif app_settings.rate_limit_store == "redis":
        limiter = RedisRateLimitStore(app_settings.redis_url or "")
    elif app_settings.rate_limit_store == "database":
        limiter = PostgresRateLimitStore(database)
    else:
        limiter = MemoryRateLimitStore()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        try:
            await limiter.setup()
            yield
        finally:
            if default_gateway is not None:
                await default_gateway.close()
            if default_trend_index is not None:
                await default_trend_index.close()
            if default_trend_refresh_lock is not None:
                await default_trend_refresh_lock.close()
            await limiter.close()
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
    app.state.store = backend_store
    app.state.catalog_draft_store = catalog_store
    app.state.rate_limiter = limiter
    app.state.readiness_check = readiness_check or database.is_ready
    app.state.download_image = download_image_service or download_image
    app.state.auto_tag_meme = auto_tag_service or auto_tag_meme
    app.state.meme_storage = meme_storage
    app.state.suggestion_service = suggestions
    app.state.trend_index = default_trend_index
    app.state.trend_snapshot_check = trend_snapshot_check or default_trend_snapshot_check
    app.state.trend_refresh_lock = trend_refresh_lock or default_trend_refresh_lock
    app.state.trend_refresh_runner = trend_refresh_runner or refresh_trends
    app.state.agent_meme_service = AgentMemeService(
        suggestions,
        meme_storage,
        meme_renderer or render_meme,
    )
    app.state.meme_catalog = catalog

    app.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.cors_origins,
        allow_origin_regex=app_settings.cors_origin_regex,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Content-Type", "x-memedrop-install-id", REQUEST_ID_HEADER],
        expose_headers=["Server-Timing", REQUEST_ID_HEADER],
    )

    @app.middleware("http")
    async def request_context(request: Request, call_next):  # type: ignore[no-untyped-def]
        incoming = request.headers.get(REQUEST_ID_HEADER)
        request_id = incoming if incoming and SAFE_REQUEST_ID.fullmatch(incoming) else str(uuid4())
        request.state.request_id = request_id
        try:
            path = request.url.path
            if request.method != "OPTIONS" and path not in {
                "/live",
                "/health",
                "/internal/cron/trends/refresh",
            }:
                route_key = f"{request.method} {path}"
                expensive = route_key in EXPENSIVE_ROUTES
                client_ip = request.client.host if request.client else None
                client_key = rate_limit_client_key(request.headers, client_ip)
                allowed = await limiter.consume(
                    f"{client_key}:{route_key}",
                    app_settings.expensive_rate_limit_window_ms
                    if expensive
                    else app_settings.api_rate_limit_window_ms,
                    app_settings.expensive_rate_limit_max
                    if expensive
                    else app_settings.api_rate_limit_max,
                )
                if not allowed:
                    response = JSONResponse(status_code=429, content={"error": "Too many requests"})
                else:
                    response = await call_next(request)
            else:
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
        if error.status_code == 404 and error.detail == "Not Found":
            return JSONResponse(
                status_code=404,
                content={"error": "Not Found", "request_id": request.state.request_id},
            )
        detail = error.detail if isinstance(error.detail, str) else "Request failed"
        return JSONResponse(status_code=error.status_code, content={"error": detail})

    app.include_router(health_router)
    app.include_router(internal_trends_router)
    app.include_router(account_router)
    app.include_router(agent_memes_router)
    app.include_router(library_router)
    app.include_router(memes_router)
    app.include_router(suggest_router)
    app.include_router(usage_router)
    if not app_settings.is_production:
        app.include_router(internal_catalog_router)

    @app.get("/memes/{object_key:path}", include_in_schema=False)
    async def serve_meme(object_key: str) -> Response:
        return await meme_storage.serve(f"/memes/{object_key}")

    return app
