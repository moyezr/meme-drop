from __future__ import annotations

from memedrop_api.cli import (
    RemoteTemplate,
    match_remote_template,
    production_env_findings,
    repository_root,
)


def valid_environment() -> dict[str, str]:
    return {
        "MEMEDROP_ENV": "production",
        "DATABASE_URL": "postgresql://memedrop:secret@db.internal:5432/memedrop",
        "OPENROUTER_API_KEY": "a-secure-production-api-key",
        "OPENROUTER_SITE_URL": "https://api.memedrop.app",
        "OPENROUTER_APP_NAME": "MemeDrop",
        "MEMEDROP_CORS_ORIGINS": "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
        "MEMEDROP_RATE_LIMIT_STORE": "redis",
        "REDIS_URL": "rediss://default:secret@redis.internal:6379/0",
        "MEMEDROP_REQUIRE_INSTALL_ID": "true",
        "MEMEDROP_SUGGESTION_LOG_TEXT": "redacted",
        "MEMEDROP_USE_DRAFT_TEMPLATES": "false",
        "MEMEDROP_RATE_LIMIT_WINDOW_MS": "60000",
        "MEMEDROP_RATE_LIMIT_MAX": "600",
        "MEMEDROP_EXPENSIVE_RATE_LIMIT_WINDOW_MS": "60000",
        "MEMEDROP_EXPENSIVE_RATE_LIMIT_MAX": "180",
        "MEMEDROP_IMAGE_DOWNLOAD_TIMEOUT_MS": "10000",
        "MEMEDROP_MAX_IMAGE_BYTES": "8388608",
        "MEMEDROP_STORAGE_BACKEND": "s3",
        "MEMEDROP_STORAGE_BUCKET": "meme-drop-prod",
        "S3_ENDPOINT": "https://project.storage.supabase.co/storage/v1/s3",
        "S3_REGION": "ap-south-1",
        "S3_ACCESS_KEY_ID": "access-key",
        "S3_SECRET_ACCESS_KEY": "secret-key",
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
            "MEMEDROP_STORAGE_BACKEND": "local",
            "MEMEDROP_STORAGE_BUCKET": "meme-drop-dev",
            "S3_ENDPOINT": "http://localhost:9000",
        }
    )

    errors, _ = production_env_findings(environment)

    assert len(errors) >= 10
    assert any("must be production" in error for error in errors)
    assert any("placeholder" in error for error in errors)
    assert any("MEMEDROP_STORAGE_BUCKET must be meme-drop-prod" in error for error in errors)


def test_production_environment_rejects_example_credentials() -> None:
    environment = valid_environment()
    environment.update(
        {
            "DATABASE_URL": "postgresql://memedrop:change-me@db:5432/memedrop",
            "OPENROUTER_SITE_URL": "https://api.your-domain.com",
            "S3_ENDPOINT": "https://your-project-ref.storage.supabase.co/storage/v1/s3",
            "S3_REGION": "your-s3-region",
            "S3_ACCESS_KEY_ID": "change-me-s3-access-key",
            "S3_SECRET_ACCESS_KEY": "change-me-s3-secret-key",
            "REDIS_URL": "rediss://default:change-me@redis.your-domain.com:6379/0",
        }
    )

    errors, _ = production_env_findings(environment)

    for name in (
        "DATABASE_URL",
        "OPENROUTER_SITE_URL",
        "S3_ENDPOINT",
        "S3_REGION",
        "S3_ACCESS_KEY_ID",
        "S3_SECRET_ACCESS_KEY",
        "REDIS_URL",
    ):
        assert any(error.startswith(name) and "placeholder" in error for error in errors)


def test_repository_root_contains_workspace_config() -> None:
    assert (repository_root() / "pyproject.toml").is_file()


def test_seed_catalog_matches_remote_names_and_aliases() -> None:
    remote: dict[str, RemoteTemplate] = {
        "drake": {"name": "Drake", "url": "https://example.test/drake.jpg"}
    }

    assert match_remote_template("Drake Hotline Bling", ("Drake",), remote) == remote["drake"]
    assert match_remote_template("Missing", (), remote) is None
