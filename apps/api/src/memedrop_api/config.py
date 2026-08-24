from __future__ import annotations

from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import urlparse

from pydantic import AliasChoices, Field, StringConstraints, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_ALLOWED_ORIGINS = (
    "http://localhost:5173",
    "http://localhost:3001",
    "https://x.com",
    "https://twitter.com",
)
DEVELOPMENT_EXTENSION_ORIGIN_REGEX = r"^chrome-extension://[a-p]{32}$"
DEFAULT_STORAGE_PATH = Path("/tmp/memedrop-storage")
DEFAULT_DOWNLOAD_PATH = Path("/tmp/memedrop-downloads")
DEVELOPMENT_BUCKET = "meme-drop-dev"
PRODUCTION_BUCKET = "meme-drop-prod"
CronSecret = Annotated[str, StringConstraints(strip_whitespace=True, min_length=16, max_length=512)]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "apps/api/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        hide_input_in_errors=True,
        populate_by_name=True,
    )

    node_env: str = Field(
        default="development",
        validation_alias=AliasChoices("MEMEDROP_ENV", "VERCEL_ENV", "NODE_ENV"),
    )
    port: int = Field(default=3001, validation_alias="PORT", gt=0, le=65535)
    database_url: str = Field(validation_alias="DATABASE_URL", min_length=1)
    openrouter_api_key: str | None = Field(
        default=None,
        validation_alias="OPENROUTER_API_KEY",
        exclude=True,
        repr=False,
    )
    openrouter_site_url: str = Field(
        default="http://localhost:3001", validation_alias="OPENROUTER_SITE_URL"
    )
    openrouter_app_name: str = Field(default="MemeDrop", validation_alias="OPENROUTER_APP_NAME")
    openrouter_suggestion_model: str = Field(
        default="google/gemini-3.7-flash", validation_alias="OPENROUTER_SUGGESTION_MODEL"
    )
    openrouter_caption_model: str = Field(
        default="google/gemini-3.7-flash", validation_alias="OPENROUTER_CAPTION_MODEL"
    )
    openrouter_auto_tag_model: str = Field(
        default="google/gemini-3.7-flash", validation_alias="OPENROUTER_AUTO_TAG_MODEL"
    )
    openrouter_trend_model: str = Field(
        default="google/gemini-3.7-flash", validation_alias="OPENROUTER_TREND_MODEL"
    )
    tavily_api_key: str | None = Field(
        default=None,
        validation_alias="TAVILY_API_KEY",
        exclude=True,
        repr=False,
    )
    legacy_openrouter_meme_model: str | None = Field(
        default=None,
        validation_alias="OPENROUTER_MEME_MODEL",
        exclude=True,
        repr=False,
    )
    cors_origins_value: str = Field(default="", validation_alias="MEMEDROP_CORS_ORIGINS")
    rate_limit_store: Literal["memory", "database", "redis"] = Field(
        default="memory", validation_alias="MEMEDROP_RATE_LIMIT_STORE"
    )
    redis_url: str | None = Field(default=None, validation_alias="REDIS_URL")
    trends_enabled: bool = Field(default=False, validation_alias="MEMEDROP_TRENDS_ENABLED")
    trend_monthly_credit_budget: int = Field(
        default=900,
        validation_alias="MEMEDROP_TREND_MONTHLY_CREDIT_BUDGET",
        ge=1,
        le=1_000,
    )
    trend_collection_timeout_seconds: float = Field(
        default=8.0,
        validation_alias="MEMEDROP_TREND_COLLECTION_TIMEOUT_SECONDS",
        ge=0.1,
        le=30,
    )
    trend_enrichment_timeout_seconds: float = Field(
        default=20.0,
        validation_alias="MEMEDROP_TREND_ENRICHMENT_TIMEOUT_SECONDS",
        ge=0.1,
        le=60,
    )
    trend_collection_cooldown_seconds: float = Field(
        default=1.0,
        validation_alias="MEMEDROP_TREND_COLLECTION_COOLDOWN_SECONDS",
        ge=0,
        le=60,
    )
    trend_cron_secret: CronSecret | None = Field(
        default=None,
        validation_alias=AliasChoices("CRON_SECRET", "MEMEDROP_TREND_CRON_SECRET"),
        exclude=True,
        repr=False,
    )
    trend_refresh_lock_ttl_seconds: int = Field(
        default=3_600,
        validation_alias="MEMEDROP_TREND_REFRESH_LOCK_TTL_SECONDS",
        ge=60,
        le=3_600,
    )
    trend_snapshot_max_age_seconds: int = Field(
        default=28_800,
        validation_alias="MEMEDROP_TREND_SNAPSHOT_MAX_AGE_SECONDS",
        ge=3_600,
        le=86_400,
    )
    api_rate_limit_window_ms: int = Field(
        default=60_000, validation_alias="MEMEDROP_RATE_LIMIT_WINDOW_MS", gt=0
    )
    api_rate_limit_max: int = Field(default=600, validation_alias="MEMEDROP_RATE_LIMIT_MAX", gt=0)
    expensive_rate_limit_window_ms: int = Field(
        default=60_000,
        validation_alias="MEMEDROP_EXPENSIVE_RATE_LIMIT_WINDOW_MS",
        gt=0,
    )
    expensive_rate_limit_max: int = Field(
        default=180, validation_alias="MEMEDROP_EXPENSIVE_RATE_LIMIT_MAX", gt=0
    )
    image_download_timeout_ms: int = Field(
        default=10_000, validation_alias="MEMEDROP_IMAGE_DOWNLOAD_TIMEOUT_MS", gt=0
    )
    max_image_bytes: int = Field(
        default=8 * 1024 * 1024, validation_alias="MEMEDROP_MAX_IMAGE_BYTES", gt=0
    )
    meme_storage_path: Path = Field(
        default=DEFAULT_STORAGE_PATH, validation_alias="MEME_STORAGE_PATH"
    )
    image_download_path: Path = Field(
        default=DEFAULT_DOWNLOAD_PATH, validation_alias="MEMEDROP_IMAGE_DOWNLOAD_PATH"
    )
    storage_backend: Literal["local", "s3"] = Field(
        default="local", validation_alias="MEMEDROP_STORAGE_BACKEND"
    )
    s3_endpoint: str | None = Field(default=None, validation_alias="S3_ENDPOINT")
    s3_region: str | None = Field(default=None, validation_alias="S3_REGION")
    s3_access_key_id: str | None = Field(default=None, validation_alias="S3_ACCESS_KEY_ID")
    s3_secret_access_key: str | None = Field(
        default=None, validation_alias="S3_SECRET_ACCESS_KEY"
    )
    s3_bucket_name: str | None = Field(default=None, validation_alias="S3_BUCKET_NAME")
    legacy_storage_bucket: str | None = Field(
        default=None,
        validation_alias="MEMEDROP_STORAGE_BUCKET",
        exclude=True,
        repr=False,
    )
    require_install_id: bool = Field(default=False, validation_alias="MEMEDROP_REQUIRE_INSTALL_ID")
    use_draft_templates: bool = Field(
        default=False, validation_alias="MEMEDROP_USE_DRAFT_TEMPLATES"
    )
    caption_timeout_ms: int = Field(
        default=20_000, validation_alias="MEMEDROP_CAPTION_TIMEOUT_MS", gt=0
    )
    joint_suggestion_timeout_ms: int = Field(
        default=4_500,
        validation_alias="MEMEDROP_JOINT_SUGGESTION_TIMEOUT_MS",
        gt=0,
    )
    joint_provider_sort: Literal["throughput", "latency", "price"] = Field(
        default="latency",
        validation_alias="MEMEDROP_JOINT_PROVIDER_SORT",
    )
    joint_provider_preferred_p90_latency_seconds: float = Field(
        default=2.5,
        validation_alias="MEMEDROP_JOINT_PROVIDER_P90_MAX_LATENCY_SECONDS",
        gt=0,
        le=30,
    )
    joint_suggestion_cooldown_ms: int = Field(
        default=5_000,
        validation_alias="MEMEDROP_JOINT_SUGGESTION_COOLDOWN_MS",
        ge=0,
    )
    contextual_caption_fallback: bool = Field(
        default=True,
        validation_alias="MEMEDROP_USE_CONTEXTUAL_CAPTION_FALLBACK",
    )

    @property
    def is_production(self) -> bool:
        return self.node_env == "production"

    @property
    def cors_origins(self) -> list[str]:
        configured = [item.strip() for item in self.cors_origins_value.split(",") if item.strip()]
        return configured or list(DEFAULT_ALLOWED_ORIGINS)

    @property
    def cors_origin_regex(self) -> str | None:
        """Allow unpacked Chrome extensions locally; production stays ID-specific."""

        return None if self.is_production else DEVELOPMENT_EXTENSION_ORIGIN_REGEX

    @property
    def storage_bucket(self) -> str:
        if not self.s3_bucket_name:
            raise RuntimeError("S3_BUCKET_NAME is required for S3 storage")
        return self.s3_bucket_name

    @property
    def trend_redis_url(self) -> str | None:
        """Return a usable optional trend-index endpoint without making it an app dependency."""

        if not self.trends_enabled or not self.redis_url:
            return None
        endpoint = urlparse(self.redis_url)
        if endpoint.scheme not in {"redis", "rediss"} or not endpoint.hostname:
            return None
        return self.redis_url

    @model_validator(mode="after")
    def validate_production_requirements(self) -> Settings:
        if self.legacy_openrouter_meme_model:
            raise ValueError(
                "OPENROUTER_MEME_MODEL was removed; use OPENROUTER_SUGGESTION_MODEL and "
                "OPENROUTER_CAPTION_MODEL"
            )
        expected_bucket = PRODUCTION_BUCKET if self.is_production else DEVELOPMENT_BUCKET
        if self.legacy_storage_bucket:
            raise ValueError("MEMEDROP_STORAGE_BUCKET was removed; use S3_BUCKET_NAME")
        if self.s3_bucket_name and self.s3_bucket_name != expected_bucket:
            raise ValueError(
                f"S3_BUCKET_NAME must be {expected_bucket} in {self.node_env}"
            )
        if self.storage_backend == "s3":
            missing = [
                name
                for name, value in (
                    ("S3_BUCKET_NAME", self.s3_bucket_name),
                    ("S3_ENDPOINT", self.s3_endpoint),
                    ("S3_REGION", self.s3_region),
                    ("S3_ACCESS_KEY_ID", self.s3_access_key_id),
                    ("S3_SECRET_ACCESS_KEY", self.s3_secret_access_key),
                )
                if not value
            ]
            if missing:
                raise ValueError(f"S3 storage requires {', '.join(missing)}")
            endpoint = urlparse(self.s3_endpoint or "")
            allowed_schemes = {"https"} if self.is_production else {"http", "https"}
            if endpoint.scheme not in allowed_schemes or not endpoint.hostname:
                raise ValueError("S3_ENDPOINT must be a valid storage endpoint URL")
        if self.rate_limit_store == "redis":
            redis_endpoint = urlparse(self.redis_url or "")
            if redis_endpoint.scheme not in {"redis", "rediss"} or not redis_endpoint.hostname:
                raise ValueError("REDIS_URL must be a valid redis:// or rediss:// URL")
        if self.is_production:
            if not self.openrouter_api_key:
                raise ValueError("OPENROUTER_API_KEY is required in production")
            if not self.cors_origins_value.strip():
                raise ValueError("MEMEDROP_CORS_ORIGINS is required in production")
            if "*" in self.cors_origins:
                raise ValueError("MEMEDROP_CORS_ORIGINS must not include * in production")
            if self.storage_backend != "s3":
                raise ValueError("MEMEDROP_STORAGE_BACKEND must be s3 in production")
            if self.rate_limit_store != "redis":
                raise ValueError("MEMEDROP_RATE_LIMIT_STORE must be redis in production")
            if self.trends_enabled:
                missing_trend_settings = [
                    name
                    for name, value in (
                        ("TAVILY_API_KEY", self.tavily_api_key),
                        ("CRON_SECRET", self.trend_cron_secret),
                    )
                    if not value
                ]
                if missing_trend_settings:
                    raise ValueError(
                        "production trend refresh requires " + ", ".join(missing_trend_settings)
                    )
        return self
