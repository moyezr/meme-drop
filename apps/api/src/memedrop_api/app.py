from __future__ import annotations

import logging
import re
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from datetime import timedelta
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException
from starlette.responses import Response

from memedrop_api.agent_credentials import AgentCredentialService
from memedrop_api.agent_generated_assets import (
    AgentGeneratedAssetStore,
    SqlAlchemyAgentGeneratedAssetStore,
)
from memedrop_api.agent_generation_credits import AgentGenerationCreditService
from memedrop_api.api.account import router as account_router
from memedrop_api.api.agent_memes import router as agent_memes_router
from memedrop_api.api.dashboard import router as dashboard_router
from memedrop_api.api.health import ReadinessCheck, TrendSnapshotCheck
from memedrop_api.api.health import router as health_router
from memedrop_api.api.internal_assets import GeneratedAssetCleanupRunner
from memedrop_api.api.internal_assets import router as internal_assets_router
from memedrop_api.api.internal_catalog import router as internal_catalog_router
from memedrop_api.api.internal_trends import TrendRefreshRunner
from memedrop_api.api.internal_trends import router as internal_trends_router
from memedrop_api.api.library import router as library_router
from memedrop_api.api.memes import router as memes_router
from memedrop_api.api.suggest import router as suggest_router
from memedrop_api.api.usage import router as usage_router
from memedrop_api.billing import (
    BillingCheckoutCreator,
    BillingCheckoutService,
    DodoCheckoutGateway,
)
from memedrop_api.catalog_workbench import CatalogDraftStore, SqlAlchemyCatalogDraftStore
from memedrop_api.config import Settings
from memedrop_api.db import Database
from memedrop_api.generated_asset_repository import SqlAlchemyGeneratedAssetRetentionRepository
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
from memedrop_api.services.generated_asset_retention import (
    GeneratedAssetMaintenanceService,
    GeneratedAssetRetentionService,
)
from memedrop_api.services.hybrid_trend_retrieval import HybridTrendRetriever
from memedrop_api.services.image_downloader import download_image
from memedrop_api.services.meme_renderer import render_meme
from memedrop_api.services.openrouter import OpenRouterSuggestionGateway
from memedrop_api.services.storage import (
    GeneratedAgentObjectCleaner,
    MemeStorage,
    create_meme_storage,
)
from memedrop_api.services.suggestion_engine import SuggestionService
from memedrop_api.services.trend_cron import CronLock, RedisCronLock, RedisTrendRefreshLock
from memedrop_api.services.trend_embeddings import OpenRouterTrendEmbedder
from memedrop_api.services.trend_index import RedisTrendIndex
from memedrop_api.services.trend_monitoring import TrendSnapshotHealthCheck
from memedrop_api.services.trend_runtime import refresh_trends
from memedrop_api.trend_repository import SqlAlchemyTrendRepository
from memedrop_api.user_repository import SqlAlchemyUserRepository

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
    trend_refresh_lock: CronLock | None = None,
    trend_refresh_runner: TrendRefreshRunner | None = None,
    generated_asset_cleanup_lock: CronLock | None = None,
    generated_asset_cleanup_runner: GeneratedAssetCleanupRunner | None = None,
    database: Database | None = None,
    agent_credentials: AgentCredentialService | None = None,
    agent_generation_credits: AgentGenerationCreditService | None = None,
    agent_generated_asset_store: AgentGeneratedAssetStore | None = None,
    agent_meme_service: AgentMemeService | None = None,
    billing_checkout_service: BillingCheckoutCreator | None = None,
) -> FastAPI:
    app_settings = settings or Settings()  # type: ignore[call-arg]
    meme_storage = storage or create_meme_storage(app_settings)
    app_database = database or Database(app_settings.database_url)
    backend_store = store or SqlAlchemyStore(app_database)
    catalog_store = catalog_draft_store or SqlAlchemyCatalogDraftStore(app_database)
    catalog = MemeCatalog.load()
    default_gateway: OpenRouterSuggestionGateway | None = None
    default_trend_index: RedisTrendIndex | None = None
    default_hybrid_trend_retriever: HybridTrendRetriever | None = None
    default_trend_refresh_lock: RedisTrendRefreshLock | None = None
    default_generated_asset_cleanup_lock: RedisCronLock | None = None
    default_trend_snapshot_check: TrendSnapshotHealthCheck | None = None
    default_billing_gateway: DodoCheckoutGateway | None = None
    trend_redis_url = app_settings.trend_redis_url
    if suggestion_service is None:
        default_gateway = OpenRouterSuggestionGateway(app_settings)
        if trend_redis_url:
            default_trend_index = RedisTrendIndex(trend_redis_url)
            if app_settings.openrouter_api_key:
                default_hybrid_trend_retriever = HybridTrendRetriever(
                    lexical_retriever=default_trend_index,
                    repository=SqlAlchemyTrendRepository(app_database),
                    query_embedder=OpenRouterTrendEmbedder(
                        api_key=app_settings.openrouter_api_key,
                        model=app_settings.openrouter_embedding_model,
                        timeout_seconds=0.75,
                        batch_size=1,
                        site_url=app_settings.openrouter_site_url,
                        app_name=app_settings.openrouter_app_name,
                    ),
                    embedding_model=app_settings.openrouter_embedding_model,
                )
        suggestions = SuggestionService(
            backend_store,
            catalog,
            default_gateway,
            app_settings,
            trend_retriever=default_hybrid_trend_retriever or default_trend_index,
        )
    else:
        suggestions = suggestion_service
    if trend_redis_url:
        default_trend_refresh_lock = RedisTrendRefreshLock(
            trend_redis_url,
            ttl_seconds=app_settings.trend_refresh_lock_ttl_seconds,
        )
        default_trend_snapshot_check = TrendSnapshotHealthCheck(
            app_database,
            max_age_seconds=app_settings.trend_snapshot_max_age_seconds,
        )
    if app_settings.trend_cron_secret and app_settings.cron_redis_url:
        default_generated_asset_cleanup_lock = RedisCronLock(
            app_settings.cron_redis_url,
            ttl_seconds=app_settings.generated_asset_cleanup_lock_ttl_seconds,
            key="memedrop:generated-asset-cleanup:lock",
        )
    generated_asset_cleanup_service = GeneratedAssetRetentionService(
        SqlAlchemyGeneratedAssetRetentionRepository(app_database),
        meme_storage,
        batch_size=app_settings.generated_asset_cleanup_batch_size,
        claim_timeout=timedelta(seconds=app_settings.generated_asset_cleanup_claim_timeout_seconds),
    )
    generation_credits = agent_generation_credits or AgentGenerationCreditService(
        app_database,
        stale_generation_after=timedelta(
            seconds=app_settings.agent_generation_stale_timeout_seconds
        ),
        generation_object_cleaner=GeneratedAgentObjectCleaner(
            meme_storage,
        ),
    )
    if billing_checkout_service is not None:
        checkout_service: BillingCheckoutCreator | None = billing_checkout_service
    elif (
        app_settings.dodo_payments_api_key and app_settings.dodo_payments_credit_pack_100_product_id
    ):
        default_billing_gateway = DodoCheckoutGateway(
            api_key=app_settings.dodo_payments_api_key,
            webhook_key=app_settings.dodo_payments_webhook_key,
            environment=app_settings.dodo_payments_environment,
        )
        checkout_service = BillingCheckoutService(
            app_database,
            default_billing_gateway,
            product_id=app_settings.dodo_payments_credit_pack_100_product_id,
            return_url=app_settings.normalized_dodo_return_url,
        )
    else:
        checkout_service = None
    generated_asset_maintenance_service = GeneratedAssetMaintenanceService(
        generated_asset_cleanup_service,
        generation_credits,
    )
    if rate_limiter is not None:
        limiter = rate_limiter
    elif app_settings.rate_limit_store == "redis":
        limiter = RedisRateLimitStore(app_settings.redis_url or "")
    elif app_settings.rate_limit_store == "database":
        limiter = PostgresRateLimitStore(app_database)
    else:
        limiter = MemoryRateLimitStore()

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        try:
            try:
                await limiter.setup()
            except Exception:
                app.state.rate_limiter_ready = False
                LOGGER.exception("Rate limiter setup failed")
            yield
        finally:
            if default_gateway is not None:
                await default_gateway.close()
            if default_trend_index is not None:
                await default_trend_index.close()
            if default_hybrid_trend_retriever is not None:
                await default_hybrid_trend_retriever.close()
            if default_trend_refresh_lock is not None:
                await default_trend_refresh_lock.close()
            if default_generated_asset_cleanup_lock is not None:
                await default_generated_asset_cleanup_lock.close()
            if default_billing_gateway is not None:
                await default_billing_gateway.close()
            await limiter.close()
            await app_database.close()

    app = FastAPI(
        title="MemeDrop API",
        version="0.1.0",
        docs_url=None if app_settings.is_production else "/docs",
        redoc_url=None,
        lifespan=lifespan,
    )
    app.state.settings = app_settings
    app.state.database = app_database
    app.state.store = backend_store
    app.state.catalog_draft_store = catalog_store
    app.state.rate_limiter = limiter
    app.state.rate_limiter_ready = True
    app.state.readiness_check = readiness_check or app_database.is_ready
    app.state.download_image = download_image_service or download_image
    app.state.auto_tag_meme = auto_tag_service or auto_tag_meme
    app.state.meme_storage = meme_storage
    app.state.suggestion_service = suggestions
    app.state.trend_index = default_trend_index
    app.state.trend_snapshot_check = trend_snapshot_check or default_trend_snapshot_check
    app.state.trend_refresh_lock = trend_refresh_lock or default_trend_refresh_lock
    app.state.trend_refresh_runner = trend_refresh_runner or refresh_trends
    app.state.generated_asset_cleanup_lock = (
        generated_asset_cleanup_lock or default_generated_asset_cleanup_lock
    )
    app.state.generated_asset_cleanup_runner = (
        generated_asset_cleanup_runner or generated_asset_maintenance_service.cleanup_expired_assets
    )
    app.state.agent_credentials = agent_credentials or AgentCredentialService(
        SqlAlchemyUserRepository(app_database)
    )
    app.state.agent_generation_credits = generation_credits
    app.state.agent_generated_asset_store = (
        agent_generated_asset_store or SqlAlchemyAgentGeneratedAssetStore(app_database)
    )
    app.state.agent_meme_service = agent_meme_service or AgentMemeService(
        suggestions, meme_storage, meme_renderer or render_meme
    )
    app.state.billing_checkout_service = checkout_service
    app.state.meme_catalog = catalog

    app.add_middleware(
        CORSMiddleware,
        allow_origins=app_settings.cors_origins,
        allow_origin_regex=app_settings.cors_origin_regex,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=[
            "Authorization",
            "Content-Type",
            "Idempotency-Key",
            "x-memedrop-install-id",
            REQUEST_ID_HEADER,
        ],
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
                "/internal/cron/assets/cleanup",
            }:
                route_key = f"{request.method} {path}"
                expensive = route_key in EXPENSIVE_ROUTES
                client_ip = request.client.host if request.client else None
                client_key = rate_limit_client_key(request.headers, client_ip)
                if not app.state.rate_limiter_ready:
                    if path == "/api/v1/memes/generate":
                        response = JSONResponse(
                            status_code=503,
                            content={"error": {"code": "temporarily_unavailable"}},
                        )
                    else:
                        response = JSONResponse(
                            status_code=503,
                            content={"error": "Service unavailable"},
                        )
                else:
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
                        if path == "/api/v1/memes/generate":
                            response = JSONResponse(
                                status_code=429,
                                content={"error": {"code": "rate_limited"}},
                            )
                        else:
                            response = JSONResponse(
                                status_code=429,
                                content={"error": "Too many requests"},
                            )
                    else:
                        response = await call_next(request)
            else:
                response = await call_next(request)
        except Exception:
            LOGGER.exception("Request failed", extra={"request_id": request_id})
            if request.url.path == "/api/v1/memes/generate":
                response = JSONResponse(
                    status_code=500,
                    content={"error": {"code": "internal_failure"}, "request_id": request_id},
                )
            else:
                response = JSONResponse(
                    status_code=500,
                    content={"error": "Internal Server Error", "request_id": request_id},
                )
        if request.url.path.startswith("/api/v1/dashboard/"):
            response.headers["Cache-Control"] = "private, no-store"
            response.headers["Pragma"] = "no-cache"
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
        if request.url.path == "/api/v1/memes/generate":
            return JSONResponse(
                status_code=400,
                content={"error": {"code": "invalid_input"}, "details": details},
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
    app.include_router(internal_assets_router)
    app.include_router(account_router)
    app.include_router(agent_memes_router)
    if app_settings.dashboard_token_secret is not None:
        app.include_router(dashboard_router)
    app.include_router(library_router)
    app.include_router(memes_router)
    app.include_router(suggest_router)
    app.include_router(usage_router)
    if not app_settings.is_production:
        app.include_router(internal_catalog_router)

    @app.get("/memes/{object_key:path}", include_in_schema=False)
    async def serve_meme(object_key: str) -> Response:
        if object_key.startswith("generated/users/"):
            raise HTTPException(status_code=404, detail="Not Found")
        return await meme_storage.serve(f"/memes/{object_key}")

    return app
