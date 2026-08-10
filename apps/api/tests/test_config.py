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
    assert settings.openrouter_suggestion_model == "openai/gpt-5.4-mini"
    assert settings.openrouter_caption_model == "openai/gpt-5.4-mini"
    assert settings.openrouter_auto_tag_model == "qwen/qwen3.6-plus"
    assert settings.joint_provider_sort == "latency"
    assert settings.joint_provider_preferred_p90_latency_seconds == 2.5


def test_legacy_shared_model_variable_is_rejected() -> None:
    with pytest.raises(ValidationError, match="OPENROUTER_MEME_MODEL was removed"):
        Settings(
            database_url="postgresql://localhost/memedrop",
            legacy_openrouter_meme_model="old-shared-model",
        )


def test_purpose_specific_models_are_loaded_independently(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("OPENROUTER_SUGGESTION_MODEL", "provider/fast")
    monkeypatch.setenv("OPENROUTER_CAPTION_MODEL", "provider/funny")
    monkeypatch.setenv("OPENROUTER_AUTO_TAG_MODEL", "provider/vision")

    settings = Settings(  # type: ignore[call-arg]
        database_url="postgresql://localhost/memedrop",
        _env_file=None,
    )

    assert settings.openrouter_suggestion_model == "provider/fast"
    assert settings.openrouter_caption_model == "provider/funny"
    assert settings.openrouter_auto_tag_model == "provider/vision"


def test_joint_provider_latency_preference_has_a_bounded_positive_value() -> None:
    with pytest.raises(ValidationError):
        Settings(
            database_url="postgresql://localhost/memedrop",
            joint_provider_preferred_p90_latency_seconds=0,
        )
    with pytest.raises(ValidationError):
        Settings(
            database_url="postgresql://localhost/memedrop",
            joint_provider_preferred_p90_latency_seconds=30.1,
        )


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
        storage_backend="s3",
        s3_bucket_name="meme-drop-prod",
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
            s3_bucket_name="meme-drop-prod",
        )

    with pytest.raises(ValidationError, match="valid storage endpoint URL"):
        Settings(
            database_url="postgresql://localhost/memedrop",
            storage_backend="s3",
            s3_bucket_name="meme-drop-dev",
            s3_endpoint="not-a-url",
            s3_region="ap-south-1",
            s3_access_key_id="access-key",
            s3_secret_access_key="secret-key",
        )


def test_legacy_bucket_variable_is_rejected() -> None:
    with pytest.raises(ValidationError, match="MEMEDROP_STORAGE_BUCKET was removed"):
        Settings(
            database_url="postgresql://localhost/memedrop",
            legacy_storage_bucket="meme-drop-dev",
        )


def test_s3_bucket_name_is_loaded_explicitly_from_environment(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    monkeypatch.setenv("S3_BUCKET_NAME", "meme-drop-dev")

    settings = Settings(  # type: ignore[call-arg]
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
        Settings(
            node_env="production",
            database_url="postgresql://localhost/memedrop",
            openrouter_api_key="secret",
            cors_origins_value="chrome-extension://abcdefghijklmnopabcdefghijklmnop",
        )
