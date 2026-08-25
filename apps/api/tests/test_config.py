from __future__ import annotations

from typing import Any

import pytest
from pydantic import ValidationError

from memedrop_api.config import (
    DEFAULT_ALLOWED_ORIGINS,
    DEVELOPMENT_EXTENSION_ORIGIN_REGEX,
    PRODUCTION_API_ORIGIN,
    Settings,
)


def make_settings(**overrides: Any) -> Settings:
    values: dict[str, Any] = {
        "database_url": "postgresql://localhost/memedrop",
        "_env_file": None,
    }
    values.update(overrides)
    return Settings(**values)


def test_development_defaults_are_safe_and_usable() -> None:
    settings = make_settings()

    assert settings.is_production is False
    assert settings.port == 3001
    assert settings.cors_origins == list(DEFAULT_ALLOWED_ORIGINS)
    assert settings.cors_origin_regex == DEVELOPMENT_EXTENSION_ORIGIN_REGEX
    assert settings.require_install_id is False
    assert settings.openrouter_suggestion_model == "google/gemini-3.7-flash"
    assert settings.openrouter_caption_model == "google/gemini-3.7-flash"
    assert settings.openrouter_auto_tag_model == "google/gemini-3.7-flash"
    assert settings.openrouter_trend_model == "google/gemini-3.7-flash"
    assert settings.openrouter_embedding_model == "google/gemini-embedding-2"
    assert settings.trend_embedding_timeout_seconds == 20
    assert settings.trend_embedding_batch_size == 32
    assert settings.joint_provider_sort == "latency"
    assert settings.joint_provider_preferred_p90_latency_seconds == 2.5
    assert settings.generated_asset_cleanup_batch_size == 100
    assert settings.generated_asset_cleanup_claim_timeout_seconds == 900
    assert settings.generated_asset_cleanup_lock_ttl_seconds == 900
    assert settings.agent_generation_stale_timeout_seconds == 1_800


def test_legacy_shared_model_variable_is_rejected() -> None:
    with pytest.raises(ValidationError, match="OPENROUTER_MEME_MODEL was removed"):
        make_settings(
            database_url="postgresql://localhost/memedrop",
            legacy_openrouter_meme_model="old-shared-model",
            _env_file=None,
        )


def test_purpose_specific_models_are_loaded_independently(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("OPENROUTER_SUGGESTION_MODEL", "provider/fast")
    monkeypatch.setenv("OPENROUTER_CAPTION_MODEL", "provider/funny")
    monkeypatch.setenv("OPENROUTER_AUTO_TAG_MODEL", "provider/vision")
    monkeypatch.setenv("OPENROUTER_TREND_MODEL", "provider/trends")
    monkeypatch.setenv("OPENROUTER_EMBEDDING_MODEL", "provider/embeddings")

    settings = make_settings(
        database_url="postgresql://localhost/memedrop",
        _env_file=None,
    )

    assert settings.openrouter_suggestion_model == "provider/fast"
    assert settings.openrouter_caption_model == "provider/funny"
    assert settings.openrouter_auto_tag_model == "provider/vision"
    assert settings.openrouter_trend_model == "provider/trends"
    assert settings.openrouter_embedding_model == "provider/embeddings"


def test_vercel_environment_selects_production_when_explicit_override_is_absent(
    monkeypatch,
) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("VERCEL_ENV", "production")

    settings = make_settings(
        database_url="postgresql://localhost/memedrop",
        api_public_origin=PRODUCTION_API_ORIGIN,
        openrouter_api_key="secret",
        cors_origins_value="chrome-extension://abcdefghijklmnopabcdefghijklmnop",
        require_install_id=True,
        rate_limit_store="redis",
        redis_url="rediss://default:secret@redis.internal:6379/0",
        storage_backend="s3",
        s3_bucket_name="meme-drop-prod",
        s3_endpoint="https://project.storage.supabase.co/storage/v1/s3",
        s3_region="ap-south-1",
        s3_access_key_id="access-key",
        s3_secret_access_key="secret-key",
        trend_cron_secret="cron-secret-0123456789",
        _env_file=None,
    )

    assert settings.is_production is True


def test_configuration_errors_do_not_echo_secret_inputs() -> None:
    with pytest.raises(ValidationError) as captured:
        make_settings(
            node_env="production",
            database_url="postgresql://user:database-secret@localhost/memedrop",
            api_public_origin=PRODUCTION_API_ORIGIN,
            openrouter_api_key="openrouter-secret",
            cors_origins_value="chrome-extension://abcdefghijklmnopabcdefghijklmnop",
            storage_backend="s3",
            s3_bucket_name="meme-drop-dev",
            _env_file=None,
        )

    message = str(captured.value)
    assert "database-secret" not in message
    assert "openrouter-secret" not in message


def test_joint_provider_latency_preference_has_a_bounded_positive_value() -> None:
    with pytest.raises(ValidationError):
        make_settings(
            database_url="postgresql://localhost/memedrop",
            joint_provider_preferred_p90_latency_seconds=0,
            _env_file=None,
        )
    with pytest.raises(ValidationError):
        make_settings(
            database_url="postgresql://localhost/memedrop",
            joint_provider_preferred_p90_latency_seconds=30.1,
            _env_file=None,
        )


def test_production_requires_openrouter_key() -> None:
    with pytest.raises(ValidationError, match="OPENROUTER_API_KEY is required"):
        make_settings(
            node_env="production",
            database_url="postgresql://localhost/memedrop",
            api_public_origin=PRODUCTION_API_ORIGIN,
            openrouter_api_key="",
            cors_origins_value="chrome-extension://abcdefghijklmnopabcdefghijklmnop",
            _env_file=None,
        )


def test_production_requires_explicit_non_wildcard_cors() -> None:
    with pytest.raises(ValidationError, match="MEMEDROP_CORS_ORIGINS is required"):
        make_settings(
            node_env="production",
            database_url="postgresql://localhost/memedrop",
            api_public_origin=PRODUCTION_API_ORIGIN,
            openrouter_api_key="secret",
            _env_file=None,
        )

    with pytest.raises(ValidationError, match="must not include"):
        make_settings(
            node_env="production",
            database_url="postgresql://localhost/memedrop",
            api_public_origin=PRODUCTION_API_ORIGIN,
            openrouter_api_key="secret",
            cors_origins_value="*",
            _env_file=None,
        )


def test_production_configuration_is_accepted() -> None:
    settings = make_settings(
        node_env="production",
        database_url="postgresql://localhost/memedrop",
        api_public_origin=PRODUCTION_API_ORIGIN,
        openrouter_api_key="secret",
        cors_origins_value="chrome-extension://abcdefghijklmnopabcdefghijklmnop",
        require_install_id=True,
        rate_limit_store="redis",
        redis_url="rediss://default:secret@redis.internal:6379/0",
        storage_backend="s3",
        s3_bucket_name="meme-drop-prod",
        s3_endpoint="https://project.storage.supabase.co/storage/v1/s3",
        s3_region="ap-south-1",
        s3_access_key_id="access-key",
        s3_secret_access_key="secret-key",
        trend_cron_secret="cron-secret-0123456789",
        _env_file=None,
    )

    assert settings.is_production is True
    assert settings.cors_origins == ["chrome-extension://abcdefghijklmnopabcdefghijklmnop"]
    assert settings.cors_origin_regex is None
    assert settings.storage_bucket == "meme-drop-prod"


def test_redis_rate_limit_store_requires_a_redis_url() -> None:
    with pytest.raises(ValidationError, match="REDIS_URL must be a valid"):
        make_settings(
            database_url="postgresql://localhost/memedrop",
            rate_limit_store="redis",
            _env_file=None,
        )

    settings = make_settings(
        database_url="postgresql://localhost/memedrop",
        rate_limit_store="redis",
        redis_url="redis://localhost:6379/0",
        _env_file=None,
    )

    assert settings.redis_url == "redis://localhost:6379/0"


def test_s3_configuration_requires_credentials_and_environment_bucket() -> None:
    with pytest.raises(ValidationError, match="S3 storage requires"):
        make_settings(
            database_url="postgresql://localhost/memedrop",
            storage_backend="s3",
            _env_file=None,
        )

    with pytest.raises(ValidationError, match="must be meme-drop-dev"):
        make_settings(
            database_url="postgresql://localhost/memedrop",
            s3_bucket_name="meme-drop-prod",
            _env_file=None,
        )

    with pytest.raises(ValidationError, match="valid storage endpoint URL"):
        make_settings(
            database_url="postgresql://localhost/memedrop",
            storage_backend="s3",
            s3_bucket_name="meme-drop-dev",
            s3_endpoint="not-a-url",
            s3_region="ap-south-1",
            s3_access_key_id="access-key",
            s3_secret_access_key="secret-key",
            _env_file=None,
        )


def test_legacy_bucket_variable_is_rejected() -> None:
    with pytest.raises(ValidationError, match="MEMEDROP_STORAGE_BUCKET was removed"):
        make_settings(
            database_url="postgresql://localhost/memedrop",
            legacy_storage_bucket="meme-drop-dev",
            _env_file=None,
        )


def test_s3_bucket_name_is_loaded_explicitly_from_environment(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("S3_BUCKET_NAME", "meme-drop-dev")

    settings = make_settings(
        database_url="postgresql://localhost/memedrop",
        storage_backend="s3",
        s3_endpoint="https://project.storage.supabase.co/storage/v1/s3",
        s3_region="ap-south-1",
        s3_access_key_id="access-key",
        s3_secret_access_key="secret-key",
        _env_file=None,
    )

    assert settings.storage_bucket == "meme-drop-dev"


def test_production_requires_s3_storage() -> None:
    with pytest.raises(ValidationError, match="MEMEDROP_STORAGE_BACKEND must be s3"):
        make_settings(
            node_env="production",
            database_url="postgresql://localhost/memedrop",
            api_public_origin=PRODUCTION_API_ORIGIN,
            openrouter_api_key="secret",
            cors_origins_value="chrome-extension://abcdefghijklmnopabcdefghijklmnop",
            _env_file=None,
        )


def test_production_trends_require_a_secret_without_echoing_it() -> None:
    values = {
        "node_env": "production",
        "database_url": "postgresql://localhost/memedrop",
        "api_public_origin": PRODUCTION_API_ORIGIN,
        "openrouter_api_key": "openrouter-secret",
        "tavily_api_key": "tavily-secret",
        "cors_origins_value": "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
        "rate_limit_store": "redis",
        "redis_url": "rediss://default:secret@redis.internal:6379/0",
        "storage_backend": "s3",
        "s3_bucket_name": "meme-drop-prod",
        "s3_endpoint": "https://project.storage.supabase.co/storage/v1/s3",
        "s3_region": "ap-south-1",
        "s3_access_key_id": "access-key",
        "s3_secret_access_key": "storage-secret",
        "trends_enabled": True,
        "_env_file": None,
    }

    with pytest.raises(ValidationError, match="CRON_SECRET") as captured:
        make_settings(**values)

    assert "tavily-secret" not in str(captured.value)
    configured_secret = "cron-secret-0123456789"
    configured = make_settings(**(values | {"trend_cron_secret": configured_secret}))
    assert configured_secret not in repr(configured)


def test_production_cleanup_requires_cron_secret_even_when_trends_are_disabled() -> None:
    values = {
        "node_env": "production",
        "database_url": "postgresql://localhost/memedrop",
        "api_public_origin": PRODUCTION_API_ORIGIN,
        "openrouter_api_key": "openrouter-secret",
        "cors_origins_value": "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
        "rate_limit_store": "redis",
        "redis_url": "rediss://default:secret@redis.internal:6379/0",
        "storage_backend": "s3",
        "s3_bucket_name": "meme-drop-prod",
        "s3_endpoint": "https://project.storage.supabase.co/storage/v1/s3",
        "s3_region": "ap-south-1",
        "s3_access_key_id": "access-key",
        "s3_secret_access_key": "storage-secret",
        "_env_file": None,
    }

    with pytest.raises(ValidationError, match="CRON_SECRET is required"):
        make_settings(**values)


def test_cleanup_claim_timeout_cannot_expire_before_distributed_lock() -> None:
    with pytest.raises(ValidationError, match="CLAIM_TIMEOUT_SECONDS"):
        make_settings(
            database_url="postgresql://localhost/memedrop",
            generated_asset_cleanup_claim_timeout_seconds=899,
            generated_asset_cleanup_lock_ttl_seconds=900,
            _env_file=None,
        )


def test_production_requires_the_canonical_https_api_origin() -> None:
    with pytest.raises(ValidationError, match="must be https://api.memedrop.moyezrabbani.dev"):
        make_settings(
            node_env="production",
            api_public_origin="https://other.example.net",
        )


def test_cron_secret_has_a_bounded_deployment_safe_length() -> None:
    for invalid_secret in ("x" * 15, "x" * 513):
        with pytest.raises(ValidationError):
            make_settings(
                database_url="postgresql://localhost/memedrop",
                trend_cron_secret=invalid_secret,
                _env_file=None,
            )

    settings = make_settings(
        database_url="postgresql://localhost/memedrop",
        trend_cron_secret="x" * 16,
        _env_file=None,
    )
    assert settings.trend_cron_secret == "x" * 16
