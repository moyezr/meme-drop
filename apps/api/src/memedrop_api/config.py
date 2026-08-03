from __future__ import annotations

from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_ALLOWED_ORIGINS = (
    "http://localhost:5173",
    "http://localhost:3001",
    "https://x.com",
    "https://twitter.com",
)
DEFAULT_STORAGE_PATH = Path(__file__).resolve().parents[3] / "data" / "memes"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "backend/.env", "apps/api/.env"),
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
        default="z-ai/glm-5.2", validation_alias="OPENROUTER_MEME_MODEL"
    )
    cors_origins_value: str = Field(default="", validation_alias="MEMEDROP_CORS_ORIGINS")
    rate_limit_store: Literal["memory", "database"] = Field(
        default="memory", validation_alias="MEMEDROP_RATE_LIMIT_STORE"
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
    require_install_id: bool = Field(default=False, validation_alias="MEMEDROP_REQUIRE_INSTALL_ID")
    suggestion_log_mode: Literal["off", "compact", "pretty"] = Field(
        default="pretty", validation_alias="MEMEDROP_SUGGESTION_LOGS"
    )
    suggestion_log_text: Literal["full", "preview", "redacted"] = Field(
        default="preview", validation_alias="MEMEDROP_SUGGESTION_LOG_TEXT"
    )
    use_draft_templates: bool = Field(
        default=False, validation_alias="MEMEDROP_USE_DRAFT_TEMPLATES"
    )

    @property
    def is_production(self) -> bool:
        return self.node_env == "production"

    @property
    def cors_origins(self) -> list[str]:
        configured = [item.strip() for item in self.cors_origins_value.split(",") if item.strip()]
        return configured or list(DEFAULT_ALLOWED_ORIGINS)

    @model_validator(mode="after")
    def validate_production_requirements(self) -> Settings:
        if not self.is_production:
            return self
        if not self.openrouter_api_key:
            raise ValueError("OPENROUTER_API_KEY is required in production")
        if not self.cors_origins_value.strip():
            raise ValueError("MEMEDROP_CORS_ORIGINS is required in production")
        if "*" in self.cors_origins:
            raise ValueError("MEMEDROP_CORS_ORIGINS must not include * in production")
        return self
