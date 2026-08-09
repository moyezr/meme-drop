from __future__ import annotations

from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_ALLOWED_ORIGINS = (
    "http://localhost:5173",
    "http://localhost:3001",
    "https://x.com",
    "https://twitter.com",
)
DEFAULT_STORAGE_PATH = Path("/tmp/memedrop-storage")
DEFAULT_DOWNLOAD_PATH = Path("/tmp/memedrop-downloads")
DEVELOPMENT_BUCKET = "meme-drop-dev"
PRODUCTION_BUCKET = "meme-drop-prod"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "apps/api/.env"),
        env_file_encoding="utf-8",
        extra="ignore",
        populate_by_name=True,
    )

    node_env: str = Field(
        default="development",
        validation_alias=AliasChoices("MEMEDROP_ENV", "NODE_ENV"),
    )
    port: int = Field(default=3001, validation_alias="PORT", gt=0, le=65535)
    database_url: str = Field(validation_alias="DATABASE_URL", min_length=1)
    openrouter_api_key: str | None = Field(default=None, validation_alias="OPENROUTER_API_KEY")
    openrouter_site_url: str = Field(
        default="http://localhost:3001", validation_alias="OPENROUTER_SITE_URL"
    )
    openrouter_app_name: str = Field(default="MemeDrop", validation_alias="OPENROUTER_APP_NAME")
    openrouter_meme_model: str = Field(
        default="openai/gpt-5.4-mini", validation_alias="OPENROUTER_MEME_MODEL"
    )
    cors_origins_value: str = Field(default="", validation_alias="MEMEDROP_CORS_ORIGINS")
    rate_limit_store: Literal["memory", "database", "redis"] = Field(
        default="memory", validation_alias="MEMEDROP_RATE_LIMIT_STORE"
    )
    redis_url: str | None = Field(default=None, validation_alias="REDIS_URL")
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
    storage_bucket_override: str | None = Field(
        default=None, validation_alias="MEMEDROP_STORAGE_BUCKET"
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
    def storage_bucket(self) -> str:
        return self.storage_bucket_override or (
            PRODUCTION_BUCKET if self.is_production else DEVELOPMENT_BUCKET
        )

    @model_validator(mode="after")
    def validate_production_requirements(self) -> Settings:
        expected_bucket = PRODUCTION_BUCKET if self.is_production else DEVELOPMENT_BUCKET
        if self.storage_bucket != expected_bucket:
            raise ValueError(
                f"MEMEDROP_STORAGE_BUCKET must be {expected_bucket} in {self.node_env}"
            )
        if self.storage_backend == "s3":
            missing = [
                name
                for name, value in (
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
        return self
