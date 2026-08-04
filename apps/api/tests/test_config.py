from __future__ import annotations

import pytest
from pydantic import ValidationError

from memedrop_api.config import DEFAULT_ALLOWED_ORIGINS, Settings


def test_development_defaults_are_safe_and_usable() -> None:
    settings = Settings(database_url="postgresql://localhost/memedrop")

    assert settings.is_production is False
    assert settings.port == 3001
    assert settings.cors_origins == list(DEFAULT_ALLOWED_ORIGINS)
    assert settings.require_install_id is False


def test_production_requires_openrouter_key() -> None:
    with pytest.raises(ValidationError, match="OPENROUTER_API_KEY is required"):
        Settings(
            node_env="production",
            database_url="postgresql://localhost/memedrop",
            openrouter_api_key="",
            cors_origins_value="chrome-extension://abcdefghijklmnopabcdefghijklmnop",
        )


def test_production_requires_explicit_non_wildcard_cors() -> None:
    with pytest.raises(ValidationError, match="MEMEDROP_CORS_ORIGINS is required"):
        Settings(
            node_env="production",
            database_url="postgresql://localhost/memedrop",
            openrouter_api_key="secret",
        )

    with pytest.raises(ValidationError, match="must not include"):
        Settings(
            node_env="production",
            database_url="postgresql://localhost/memedrop",
            openrouter_api_key="secret",
            cors_origins_value="*",
        )


def test_production_configuration_is_accepted() -> None:
    settings = Settings(
        node_env="production",
        database_url="postgresql://localhost/memedrop",
        openrouter_api_key="secret",
        cors_origins_value="chrome-extension://abcdefghijklmnopabcdefghijklmnop",
        require_install_id=True,
        rate_limit_store="redis",
        redis_url="rediss://default:secret@redis.internal:6379/0",
        suggestion_log_text="redacted",
        storage_backend="s3",
        s3_endpoint="https://project.storage.supabase.co/storage/v1/s3",
        s3_region="ap-south-1",
        s3_access_key_id="access-key",
        s3_secret_access_key="secret-key",
    )

    assert settings.is_production is True
    assert settings.cors_origins == ["chrome-extension://abcdefghijklmnopabcdefghijklmnop"]
    assert settings.storage_bucket == "meme-drop-prod"


def test_redis_rate_limit_store_requires_a_redis_url() -> None:
    with pytest.raises(ValidationError, match="REDIS_URL must be a valid"):
        Settings(
            database_url="postgresql://localhost/memedrop",
            rate_limit_store="redis",
        )

    settings = Settings(
        database_url="postgresql://localhost/memedrop",
        rate_limit_store="redis",
        redis_url="redis://localhost:6379/0",
    )

    assert settings.redis_url == "redis://localhost:6379/0"


def test_s3_configuration_requires_credentials_and_environment_bucket() -> None:
    with pytest.raises(ValidationError, match="S3 storage requires"):
        Settings(
            database_url="postgresql://localhost/memedrop",
            storage_backend="s3",
        )

    with pytest.raises(ValidationError, match="must be meme-drop-dev"):
        Settings(
            database_url="postgresql://localhost/memedrop",
            storage_bucket_override="meme-drop-prod",
        )

    with pytest.raises(ValidationError, match="valid storage endpoint URL"):
        Settings(
            database_url="postgresql://localhost/memedrop",
            storage_backend="s3",
            s3_endpoint="not-a-url",
            s3_region="ap-south-1",
            s3_access_key_id="access-key",
            s3_secret_access_key="secret-key",
        )


def test_production_requires_s3_storage() -> None:
    with pytest.raises(ValidationError, match="MEMEDROP_STORAGE_BACKEND must be s3"):
        Settings(
            node_env="production",
            database_url="postgresql://localhost/memedrop",
            openrouter_api_key="secret",
            cors_origins_value="chrome-extension://abcdefghijklmnopabcdefghijklmnop",
        )
