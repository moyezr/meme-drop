from __future__ import annotations

from memedrop_api.cli import production_env_findings, repository_root


def valid_environment() -> dict[str, str]:
    return {
        "MEMEDROP_ENV": "production",
        "DATABASE_URL": "postgresql://memedrop:secret@db.internal:5432/memedrop",
        "OPENROUTER_API_KEY": "a-secure-production-api-key",
        "OPENROUTER_SITE_URL": "https://api.memedrop.app",
        "OPENROUTER_APP_NAME": "MemeDrop",
        "MEMEDROP_CORS_ORIGINS": "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
        "MEMEDROP_RATE_LIMIT_STORE": "database",
        "MEMEDROP_REQUIRE_INSTALL_ID": "true",
        "MEMEDROP_SUGGESTION_LOG_TEXT": "redacted",
        "MEMEDROP_USE_DRAFT_TEMPLATES": "false",
        "MEMEDROP_RATE_LIMIT_WINDOW_MS": "60000",
        "MEMEDROP_RATE_LIMIT_MAX": "600",
        "MEMEDROP_EXPENSIVE_RATE_LIMIT_WINDOW_MS": "60000",
        "MEMEDROP_EXPENSIVE_RATE_LIMIT_MAX": "180",
        "MEMEDROP_IMAGE_DOWNLOAD_TIMEOUT_MS": "10000",
        "MEMEDROP_MAX_IMAGE_BYTES": "8388608",
        "MEME_STORAGE_PATH": "/var/lib/memedrop/memes",
    }


def test_valid_production_environment_has_no_findings() -> None:
    assert production_env_findings(valid_environment()) == ([], [])


def test_production_environment_rejects_unsafe_deployment_values() -> None:
    environment = valid_environment()
    environment.update(
        {
            "MEMEDROP_ENV": "development",
            "DATABASE_URL": "postgresql://localhost/memedrop",
            "OPENROUTER_API_KEY": "test-key",
            "OPENROUTER_SITE_URL": "http://localhost:3001",
            "MEMEDROP_CORS_ORIGINS": "*,chrome-extension://not-real",
            "MEMEDROP_RATE_LIMIT_STORE": "memory",
            "MEMEDROP_REQUIRE_INSTALL_ID": "false",
            "MEMEDROP_SUGGESTION_LOG_TEXT": "full",
            "MEMEDROP_USE_DRAFT_TEMPLATES": "true",
            "MEMEDROP_RATE_LIMIT_MAX": "zero",
            "MEME_STORAGE_PATH": "./memes",
        }
    )

    errors, _ = production_env_findings(environment)

    assert len(errors) >= 10
    assert any("must be production" in error for error in errors)
    assert any("placeholder" in error for error in errors)
    assert any("must be an absolute path" in error for error in errors)


def test_repository_root_contains_workspace_config() -> None:
    assert (repository_root() / "pyproject.toml").is_file()
