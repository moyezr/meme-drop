from __future__ import annotations

from contextlib import asynccontextmanager
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace
from typing import Any, cast

import pytest
from PIL import Image

import memedrop_api.cli as cli
from memedrop_api.cli import (
    RemoteTemplate,
    match_remote_template,
    migrate_legacy_meme_files,
    production_env_findings,
    repository_root,
)
from memedrop_api.config import Settings
from memedrop_api.db import Meme
from memedrop_api.services.storage import LocalMemeStorage


def valid_environment() -> dict[str, str]:
    return {
        "MEMEDROP_ENV": "production",
        "DATABASE_URL": "postgresql://memedrop:secret@db.internal:5432/memedrop",
        "OPENROUTER_API_KEY": "a-secure-production-api-key",
        "OPENROUTER_SITE_URL": "https://api.memedrop.app",
        "OPENROUTER_APP_NAME": "MemeDrop",
        "OPENROUTER_SUGGESTION_MODEL": "openai/gpt-5.4-mini",
        "OPENROUTER_CAPTION_MODEL": "openai/gpt-5.4-mini",
        "OPENROUTER_AUTO_TAG_MODEL": "qwen/qwen3.6-plus",
        "MEMEDROP_CORS_ORIGINS": "chrome-extension://abcdefghijklmnopabcdefghijklmnop",
        "MEMEDROP_RATE_LIMIT_STORE": "redis",
        "REDIS_URL": "rediss://default:secret@redis.internal:6379/0",
        "MEMEDROP_REQUIRE_INSTALL_ID": "true",
        "MEMEDROP_USE_DRAFT_TEMPLATES": "false",
        "MEMEDROP_RATE_LIMIT_WINDOW_MS": "60000",
        "MEMEDROP_RATE_LIMIT_MAX": "600",
        "MEMEDROP_EXPENSIVE_RATE_LIMIT_WINDOW_MS": "60000",
        "MEMEDROP_EXPENSIVE_RATE_LIMIT_MAX": "180",
        "MEMEDROP_IMAGE_DOWNLOAD_TIMEOUT_MS": "10000",
        "MEMEDROP_MAX_IMAGE_BYTES": "8388608",
        "MEMEDROP_STORAGE_BACKEND": "s3",
        "S3_BUCKET_NAME": "meme-drop-prod",
        "S3_ENDPOINT": "https://project.storage.supabase.co/storage/v1/s3",
        "S3_REGION": "ap-south-1",
        "S3_ACCESS_KEY_ID": "access-key",
        "S3_SECRET_ACCESS_KEY": "secret-key",
    }


def test_valid_production_environment_has_no_findings() -> None:
    assert production_env_findings(valid_environment()) == ([], [])


def test_production_environment_rejects_removed_shared_variables() -> None:
    environment = valid_environment()
    environment["OPENROUTER_MEME_MODEL"] = "old/shared-model"
    environment["MEMEDROP_STORAGE_BUCKET"] = "meme-drop-prod"

    errors, _ = production_env_findings(environment)

    assert any("OPENROUTER_MEME_MODEL was removed" in error for error in errors)
    assert any("MEMEDROP_STORAGE_BUCKET was removed" in error for error in errors)


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
            "MEMEDROP_USE_DRAFT_TEMPLATES": "true",
            "MEMEDROP_RATE_LIMIT_MAX": "zero",
            "MEMEDROP_STORAGE_BACKEND": "local",
            "S3_BUCKET_NAME": "meme-drop-dev",
            "S3_ENDPOINT": "http://localhost:9000",
        }
    )

    errors, _ = production_env_findings(environment)

    assert len(errors) >= 10
    assert any("must be production" in error for error in errors)
    assert any("placeholder" in error for error in errors)
    assert any("S3_BUCKET_NAME must be meme-drop-prod" in error for error in errors)


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


def test_production_environment_rejects_supabase_direct_runtime_url() -> None:
    environment = valid_environment()
    environment["DATABASE_URL"] = (
        "postgresql://postgres:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres"
    )

    errors, _ = production_env_findings(environment)

    assert any("Supabase pooler endpoint" in error for error in errors)


def test_repository_root_contains_workspace_config() -> None:
    assert (repository_root() / "pyproject.toml").is_file()


def test_seed_catalog_matches_remote_names_and_aliases() -> None:
    remote: dict[str, RemoteTemplate] = {
        "drake": {"name": "Drake", "url": "https://example.test/drake.jpg"}
    }

    assert match_remote_template("Drake Hotline Bling", ("Drake",), remote) == remote["drake"]
    assert match_remote_template("Missing", (), remote) is None


@pytest.mark.asyncio
async def test_legacy_meme_migration_validates_all_files_before_upload(
    tmp_path: Path,
) -> None:
    source_root = tmp_path / "source"
    source_root.mkdir()
    (source_root / "available.jpg").write_bytes(b"meme")
    settings = Settings(  # type: ignore[call-arg]
        _env_file=None,
        database_url="postgresql://localhost/test",
        meme_storage_path=source_root,
    )
    storage = LocalMemeStorage(tmp_path / "objects")
    available = Meme(
        name="Available",
        file_path="/memes/available.jpg",
        format_type="reaction_image",
        source_url="https://example.test/available.jpg",
    )
    missing = Meme(
        name="Missing",
        file_path="/memes/missing.jpg",
        format_type="reaction_image",
        source_url="https://example.test/missing.jpg",
    )
    migrated = Meme(
        name="Migrated",
        file_path="/memes/catalog/already.jpg",
        format_type="reaction_image",
        source_url="https://example.test/already.jpg",
    )

    with pytest.raises(FileNotFoundError, match="missing.jpg"):
        await migrate_legacy_meme_files(
            settings, storage, [available, missing, migrated]
        )

    assert available.file_path == "/memes/available.jpg"
    assert not (tmp_path / "objects/catalog/legacy/available.jpg").exists()

    count = await migrate_legacy_meme_files(settings, storage, [available, migrated])

    assert count == 1
    assert available.file_path == "/memes/catalog/legacy/available.jpg"
    assert (tmp_path / "objects/catalog/legacy/available.jpg").read_bytes() == b"meme"
    assert migrated.file_path == "/memes/catalog/already.jpg"


def png_bytes() -> bytes:
    image = Image.new("RGB", (960, 480), color=(20, 30, 40))
    output = BytesIO()
    image.save(output, format="PNG")
    return output.getvalue()


class FakeStorage:
    def __init__(self) -> None:
        self.objects: list[tuple[str, bytes, str | None]] = []

    async def put_bytes(
        self, object_key: str, content: bytes, *, content_type: str | None = None
    ) -> str:
        self.objects.append((object_key, content, content_type))
        return f"/memes/{object_key}"


class FakeResponse:
    def __init__(self, *, payload: dict[str, Any] | None = None, content: bytes = b"") -> None:
        self.payload = payload
        self.content = content
        self.headers = {"content-type": "image/png"}

    def json(self) -> dict[str, Any]:
        assert self.payload is not None
        return self.payload

    def raise_for_status(self) -> None:
        return None


class FakeHttpClient:
    def __init__(self, responses: dict[str, FakeResponse]) -> None:
        self.responses = responses
        self.requested: list[str] = []

    async def __aenter__(self) -> FakeHttpClient:
        return self

    async def __aexit__(self, *args: object) -> None:
        return None

    async def get(self, url: str) -> FakeResponse:
        self.requested.append(url)
        return self.responses[url]


class FakeSession:
    def __init__(self, existing: Meme | None) -> None:
        self.existing = existing
        self.added: list[Meme] = []

    async def __aenter__(self) -> FakeSession:
        return self

    async def __aexit__(self, *args: object) -> None:
        return None

    @asynccontextmanager
    async def begin(self) -> Any:
        yield self

    async def scalar(self, statement: object) -> Meme | None:
        del statement
        return self.existing

    def add(self, row: Meme) -> None:
        self.added.append(row)


class FakeDatabase:
    def __init__(self, session: FakeSession) -> None:
        self.fake_session = session
        self.closed = False

    def session(self) -> FakeSession:
        return self.fake_session

    async def close(self) -> None:
        self.closed = True


def fake_catalog() -> SimpleNamespace:
    template = SimpleNamespace(
        name="Drake Hotline Bling",
        aliases=["Drake"],
        template_id="drake-hotline-bling",
        caption_guidance=SimpleNamespace(pattern="top/bottom"),
        supports_overlay=True,
    )
    return SimpleNamespace(verified_templates=[template])


def seed_settings() -> Settings:
    return cast(
        Settings,
        SimpleNamespace(storage_backend="local", image_download_timeout_ms=1, database_url="test"),
    )


@pytest.mark.asyncio
async def test_seed_catalog_uploads_original_and_thumbnail(monkeypatch: pytest.MonkeyPatch) -> None:
    remote_url = "https://example.test/drake.png"
    client = FakeHttpClient(
        {
            "https://api.imgflip.com/get_memes": FakeResponse(
                payload={"data": {"memes": [{"name": "Drake", "url": remote_url}]}}
            ),
            remote_url: FakeResponse(content=png_bytes()),
        }
    )
    storage = FakeStorage()
    session = FakeSession(existing=None)
    database = FakeDatabase(session)
    monkeypatch.setattr(cli.MemeCatalog, "load", staticmethod(fake_catalog))
    monkeypatch.setattr(cli, "create_meme_storage", lambda settings: storage)
    monkeypatch.setattr(cli, "Database", lambda url: database)
    monkeypatch.setattr(cli.httpx, "AsyncClient", lambda **kwargs: client)

    inserted, migrated, skipped = await cli.seed_meme_catalog(seed_settings())

    assert (inserted, migrated, skipped) == (1, 0, 0)
    assert [item[0] for item in storage.objects] == [
        "catalog/thumbnails/drake-hotline-bling.webp",
        "catalog/seed-drake-hotline-bling.png",
    ]
    assert storage.objects[0][2] == "image/webp"
    assert session.added[0].system_tags == {
        "caption_pattern": "top/bottom",
        "thumbnail_path": "/memes/catalog/thumbnails/drake-hotline-bling.webp",
    }
    assert database.closed


@pytest.mark.asyncio
async def test_seed_catalog_backfills_missing_thumbnail_from_existing_source(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    remote_url = "https://example.test/drake.png"
    existing_source = "https://cdn.example.test/existing.png"
    client = FakeHttpClient(
        {
            "https://api.imgflip.com/get_memes": FakeResponse(
                payload={"data": {"memes": [{"name": "Drake", "url": remote_url}]}}
            ),
            existing_source: FakeResponse(content=png_bytes()),
        }
    )
    existing = Meme(
        name="Drake Hotline Bling",
        file_path="/memes/catalog/seed-drake.png",
        format_type="text_overlay",
        system_tags={"caption_pattern": "top/bottom"},
        source_url=existing_source,
    )
    storage = FakeStorage()
    session = FakeSession(existing=existing)
    database = FakeDatabase(session)
    monkeypatch.setattr(cli.MemeCatalog, "load", staticmethod(fake_catalog))
    monkeypatch.setattr(cli, "create_meme_storage", lambda settings: storage)
    monkeypatch.setattr(cli, "Database", lambda url: database)
    monkeypatch.setattr(cli.httpx, "AsyncClient", lambda **kwargs: client)

    inserted, migrated, skipped = await cli.seed_meme_catalog(seed_settings())

    assert (inserted, migrated, skipped) == (0, 0, 0)
    assert client.requested == ["https://api.imgflip.com/get_memes", existing_source]
    assert [item[0] for item in storage.objects] == [
        "catalog/thumbnails/drake-hotline-bling.webp"
    ]
    assert existing.system_tags["thumbnail_path"] == (
        "/memes/catalog/thumbnails/drake-hotline-bling.webp"
    )
    assert not session.added


@pytest.mark.asyncio
async def test_seed_catalog_backfills_existing_source_without_an_imgflip_match(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    existing_source = "https://cdn.example.test/existing.png"
    client = FakeHttpClient(
        {
            "https://api.imgflip.com/get_memes": FakeResponse(payload={"data": {"memes": []}}),
            existing_source: FakeResponse(content=png_bytes()),
        }
    )
    existing = Meme(
        name="Drake Hotline Bling",
        file_path="/memes/catalog/seed-drake.png",
        format_type="text_overlay",
        system_tags=None,  # type: ignore[arg-type]
        source_url=existing_source,
    )
    storage = FakeStorage()
    session = FakeSession(existing=existing)
    database = FakeDatabase(session)
    monkeypatch.setattr(cli.MemeCatalog, "load", staticmethod(fake_catalog))
    monkeypatch.setattr(cli, "create_meme_storage", lambda settings: storage)
    monkeypatch.setattr(cli, "Database", lambda url: database)
    monkeypatch.setattr(cli.httpx, "AsyncClient", lambda **kwargs: client)

    inserted, migrated, skipped = await cli.seed_meme_catalog(seed_settings())

    assert (inserted, migrated, skipped) == (0, 0, 0)
    assert client.requested == ["https://api.imgflip.com/get_memes", existing_source]
    assert existing.system_tags == {
        "thumbnail_path": "/memes/catalog/thumbnails/drake-hotline-bling.webp"
    }
