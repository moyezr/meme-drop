from __future__ import annotations

import pytest
from memedrop_api.config import DEFAULT_ALLOWED_ORIGINS, Settings
from pydantic import ValidationError


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
        rate_limit_store="database",
        suggestion_log_text="redacted",
    )

    assert settings.is_production is True
    assert settings.cors_origins == ["chrome-extension://abcdefghijklmnopabcdefghijklmnop"]
