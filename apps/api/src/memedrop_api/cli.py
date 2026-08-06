from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
from collections.abc import Sequence
from pathlib import Path
from typing import TypedDict, cast
from urllib.parse import urlparse
from uuid import UUID

import httpx
from alembic import command
from alembic.config import Config
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from memedrop_api.config import Settings
from memedrop_api.db import Database, Meme, User
from memedrop_api.services.catalog import MemeCatalog, normalize_template_name
from memedrop_api.services.storage import (
    MemeStorage,
    create_meme_storage,
    object_key_from_public_path,
)
from memedrop_api.services.usage_feedback import load_usage_feedback

DEV_USER_ID = UUID("00000000-0000-0000-0000-000000000001")
PLACEHOLDER_HOSTS = {
    "localhost",
    "127.0.0.1",
    "0.0.0.0",
    "::1",
    "example.com",
    "memedrop.example",
    "api.memedrop.example",
}
PLACEHOLDER_MARKERS = (
    "change-me",
    "placeholder",
    "dummy",
    "test-key",
    "your-domain",
    "your-project-ref",
    "your-s3-region",
)


class RemoteTemplate(TypedDict):
    name: str
    url: str


def db_init() -> None:
    settings = Settings()  # type: ignore[call-arg]
    config = Config(str(repository_root() / "alembic.ini"))
    config.set_main_option("sqlalchemy.url", settings.database_url)
    command.upgrade(config, "head")
    asyncio.run(seed_development_user(settings))
    print("[MemeDrop] Database initialized at the latest migration.")


def db_seed() -> None:
    settings = Settings()  # type: ignore[call-arg]
    asyncio.run(seed_development_user(settings))
    print("[MemeDrop] Development identity seeded.")


def db_seed_memes() -> None:
    settings = Settings()  # type: ignore[call-arg]
    inserted, migrated, skipped = asyncio.run(seed_meme_catalog(settings))
    print(
        f"[MemeDrop] Meme catalog seeded: inserted={inserted} "
        f"migrated={migrated} skipped={skipped}"
    )


async def seed_meme_catalog(settings: Settings) -> tuple[int, int, int]:
    catalog = MemeCatalog.load()
    storage = create_meme_storage(settings)
    database = Database(settings.database_url)
    inserted = 0
    migrated = 0
    skipped = 0
    try:
        if settings.storage_backend == "s3":
            async with database.session() as session, session.begin():
                legacy_memes = list(
                    await session.scalars(
                        select(Meme).where(
                            Meme.file_path.like("/memes/%"),
                            ~Meme.file_path.like("/memes/catalog/%"),
                        )
                    )
                )
                migrated = await migrate_legacy_meme_files(
                    settings, storage, legacy_memes
                )

        async with httpx.AsyncClient(
            timeout=settings.image_download_timeout_ms / 1000
        ) as client:
            response = await client.get("https://api.imgflip.com/get_memes")
            response.raise_for_status()
            remote = cast(list[RemoteTemplate], response.json()["data"]["memes"])
            by_name = {normalize_template_name(item["name"]): item for item in remote}
            async with database.session() as session, session.begin():
                for template in catalog.verified_templates:
                    item = match_remote_template(template.name, template.aliases, by_name)
                    existing = await session.scalar(
                        select(Meme.id).where(func.lower(Meme.name) == template.name.lower())
                    )
                    if item is None or existing is not None:
                        skipped += 1
                        continue
                    image = await client.get(item["url"])
                    image.raise_for_status()
                    extension = Path(httpx.URL(item["url"]).path).suffix.lower()
                    if extension not in {".jpg", ".jpeg", ".png", ".webp"}:
                        skipped += 1
                        continue
                    filename = f"seed-{template.template_id}{extension}"
                    file_path = await storage.put_bytes(
                        f"catalog/{filename}",
                        image.content,
                        content_type=image.headers.get("content-type", "image/jpeg").split(
                            ";", 1
                        )[0],
                    )
                    session.add(
                        Meme(
                            name=template.name,
                            file_path=file_path,
                            format_type="text_overlay"
                            if template.supports_overlay
                            else "reaction_image",
                            is_evergreen=True,
                            system_tags={"caption_pattern": template.caption_guidance.pattern},
                            source_url=item["url"],
                        )
                    )
                    inserted += 1
    finally:
        await database.close()
    return inserted, migrated, skipped


async def migrate_legacy_meme_files(
    settings: Settings,
    storage: MemeStorage,
    memes: Sequence[Meme],
) -> int:
    root = settings.meme_storage_path.resolve()
    pending: list[tuple[Meme, str, Path]] = []
    for meme in memes:
        object_key = object_key_from_public_path(meme.file_path)
        if object_key is None or object_key.startswith("catalog/"):
            continue
        source = (root / object_key).resolve()
        if not source.is_relative_to(root):
            raise ValueError(f"Legacy meme path escaped the storage root: {object_key}")
        if not source.is_file():
            raise FileNotFoundError(f"Legacy meme file is missing: {object_key}")
        pending.append((meme, object_key, source))

    migrated = 0
    for meme, object_key, source in pending:
        meme.file_path = await storage.put_file(source, f"catalog/legacy/{object_key}")
        migrated += 1
    return migrated


def match_remote_template(
    name: str, aliases: Sequence[str], remote_by_name: dict[str, RemoteTemplate]
) -> RemoteTemplate | None:
    return next(
        (
            remote_by_name.get(normalize_template_name(candidate))
            for candidate in (name, *aliases)
            if remote_by_name.get(normalize_template_name(candidate))
        ),
        None,
    )


async def seed_development_user(settings: Settings) -> None:
    database = Database(settings.database_url)
    try:
        async with database.session() as session, session.begin():
            statement = insert(User).values(id=DEV_USER_ID, email="dev@memedrop.local")
            await session.execute(statement.on_conflict_do_nothing(index_elements=[User.id]))
    finally:
        await database.close()


def validate_production_env() -> None:
    errors, warnings = production_env_findings(os.environ)
    for message in errors:
        print(f"ERROR {message}")
    for message in warnings:
        print(f"WARN {message}")
    if errors:
        raise SystemExit(
            f"[MemeDrop] production env validation failed: errors={len(errors)} "
            f"warnings={len(warnings)}"
        )
    print(f"[MemeDrop] production env validated (warnings={len(warnings)})")


def usage_feedback() -> None:
    parser = argparse.ArgumentParser(description="Summarize recommendation outcome signals")
    parser.add_argument("--days", type=int, default=30)
    parser.add_argument("--min-shown", type=int, default=20)
    parser.add_argument("--limit", type=int, default=50)
    parser.add_argument("--out")
    arguments = parser.parse_args()
    if arguments.days < 1 or arguments.min_shown < 1 or arguments.limit < 0:
        parser.error("days and min-shown must be positive; limit must be non-negative")
    settings = Settings()  # type: ignore[call-arg]
    report = asyncio.run(
        build_usage_feedback_report(
            settings,
            days=arguments.days,
            minimum_shown=arguments.min_shown,
            limit=arguments.limit,
        )
    )
    output = f"{json.dumps(report, indent=2)}\n"
    if arguments.out:
        Path(arguments.out).write_text(output, encoding="utf-8")
    print(output, end="")


def storage_check() -> None:
    parser = argparse.ArgumentParser(description="Validate object storage and report latency")
    parser.add_argument(
        "--latency",
        action="store_true",
        help="also upload, download, and delete a temporary probe object",
    )
    arguments = parser.parse_args()
    settings = Settings()  # type: ignore[call-arg]
    storage = create_meme_storage(settings)
    result = asyncio.run(storage.check(include_write=arguments.latency))
    print(json.dumps(result, sort_keys=True))


async def build_usage_feedback_report(
    settings: Settings, *, days: int, minimum_shown: int, limit: int
) -> dict[str, object]:
    database = Database(settings.database_url)
    try:
        return await load_usage_feedback(
            database, lookback_days=days, minimum_shown=minimum_shown, limit=limit
        )
    finally:
        await database.close()


def production_env_findings(
    environment: os._Environ[str] | dict[str, str],
) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    def value(name: str) -> str:
        result = environment.get(name, "").strip()
        if not result:
            errors.append(f"{name} is required.")
        return result

    def positive_int(name: str) -> None:
        raw = value(name)
        if raw and (not raw.isdigit() or int(raw) <= 0):
            errors.append(f"{name} must be a positive integer.")

    def reject_placeholder(name: str, raw: str) -> None:
        if raw and is_placeholder_value(raw):
            errors.append(f"{name} must not use a placeholder value.")

    if value("MEMEDROP_ENV") != "production":
        errors.append("MEMEDROP_ENV must be production.")
    database_url = value("DATABASE_URL")
    validate_url("DATABASE_URL", database_url, {"postgres", "postgresql"}, errors)
    reject_placeholder("DATABASE_URL", database_url)
    database_endpoint = urlparse(database_url)
    if (
        database_endpoint.hostname
        and database_endpoint.hostname.endswith(".supabase.co")
        and database_endpoint.port == 5432
    ):
        errors.append(
            "DATABASE_URL must use a Supabase pooler endpoint for the Vercel runtime, "
            "preferably transaction mode on port 6543."
        )
    site_url = value("OPENROUTER_SITE_URL")
    validate_url("OPENROUTER_SITE_URL", site_url, {"https"}, errors)

    api_key = value("OPENROUTER_API_KEY")
    if is_placeholder_value(api_key):
        errors.append("OPENROUTER_API_KEY must not use a placeholder value.")
    elif api_key and len(api_key) < 16:
        warnings.append("OPENROUTER_API_KEY looks unusually short.")

    value("OPENROUTER_APP_NAME")
    origins = [item.strip() for item in value("MEMEDROP_CORS_ORIGINS").split(",") if item.strip()]
    if "*" in origins:
        errors.append("MEMEDROP_CORS_ORIGINS must not include *.")
    chrome_origins = [item for item in origins if item.startswith("chrome-extension://")]
    if not chrome_origins:
        errors.append("MEMEDROP_CORS_ORIGINS must include the final Chrome extension origin.")
    for origin in origins:
        parsed = urlparse(origin)
        if parsed.scheme not in {"https", "chrome-extension"} or not parsed.hostname:
            errors.append(f"MEMEDROP_CORS_ORIGINS has an invalid origin: {origin}.")
        elif parsed.hostname.lower() in PLACEHOLDER_HOSTS:
            errors.append(f"MEMEDROP_CORS_ORIGINS has a local or placeholder origin: {origin}.")
        if parsed.scheme == "chrome-extension" and not re.fullmatch(
            r"[a-p]{32}", parsed.hostname or ""
        ):
            errors.append(f"MEMEDROP_CORS_ORIGINS has an invalid extension ID: {origin}.")

    if value("MEMEDROP_RATE_LIMIT_STORE") != "redis":
        errors.append("MEMEDROP_RATE_LIMIT_STORE must be redis.")
    redis_url = value("REDIS_URL")
    validate_url("REDIS_URL", redis_url, {"redis", "rediss"}, errors)
    reject_placeholder("REDIS_URL", redis_url)
    if value("MEMEDROP_REQUIRE_INSTALL_ID").lower() not in {"1", "true", "yes", "on"}:
        errors.append("MEMEDROP_REQUIRE_INSTALL_ID must be true.")
    if environment.get("MEMEDROP_USE_DRAFT_TEMPLATES", "").strip().lower() == "true":
        errors.append("MEMEDROP_USE_DRAFT_TEMPLATES must not be true in production.")
    if value("MEMEDROP_STORAGE_BACKEND") != "s3":
        errors.append("MEMEDROP_STORAGE_BACKEND must be s3.")
    storage_endpoint = value("S3_ENDPOINT")
    validate_url("S3_ENDPOINT", storage_endpoint, {"https"}, errors)
    storage_region = value("S3_REGION")
    storage_access_key = value("S3_ACCESS_KEY_ID")
    storage_secret_key = value("S3_SECRET_ACCESS_KEY")
    reject_placeholder("S3_REGION", storage_region)
    reject_placeholder("S3_ACCESS_KEY_ID", storage_access_key)
    reject_placeholder("S3_SECRET_ACCESS_KEY", storage_secret_key)
    if value("MEMEDROP_STORAGE_BUCKET") != "meme-drop-prod":
        errors.append("MEMEDROP_STORAGE_BUCKET must be meme-drop-prod.")
    for name in (
        "MEMEDROP_RATE_LIMIT_WINDOW_MS",
        "MEMEDROP_RATE_LIMIT_MAX",
        "MEMEDROP_EXPENSIVE_RATE_LIMIT_WINDOW_MS",
        "MEMEDROP_EXPENSIVE_RATE_LIMIT_MAX",
        "MEMEDROP_IMAGE_DOWNLOAD_TIMEOUT_MS",
        "MEMEDROP_MAX_IMAGE_BYTES",
    ):
        positive_int(name)
    return errors, warnings


def validate_url(name: str, raw: str, schemes: set[str], errors: list[str]) -> None:
    if not raw:
        return
    parsed = urlparse(raw)
    if parsed.scheme not in schemes or not parsed.hostname:
        errors.append(f"{name} must be a valid {', '.join(sorted(schemes))} URL.")
    elif parsed.hostname.lower() in PLACEHOLDER_HOSTS or is_placeholder_value(parsed.hostname):
        errors.append(f"{name} must not use a local or placeholder host: {parsed.hostname}.")


def is_placeholder_value(raw: str) -> bool:
    normalized = raw.strip().lower()
    return any(marker in normalized for marker in PLACEHOLDER_MARKERS)


def repository_root() -> Path:
    return Path(__file__).resolve().parents[2]
