from __future__ import annotations

import asyncio
import os
import re
from pathlib import Path
from urllib.parse import urlparse
from uuid import UUID

from alembic import command
from alembic.config import Config
from sqlalchemy.dialects.postgresql import insert

from memedrop_api.config import Settings
from memedrop_api.db import Database, User

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

    if value("MEMEDROP_ENV") != "production":
        errors.append("MEMEDROP_ENV must be production.")
    database_url = value("DATABASE_URL")
    validate_url("DATABASE_URL", database_url, {"postgres", "postgresql"}, errors)
    site_url = value("OPENROUTER_SITE_URL")
    validate_url("OPENROUTER_SITE_URL", site_url, {"https"}, errors)

    api_key = value("OPENROUTER_API_KEY")
    if re.search(r"example|placeholder|change-me|dummy|test-key", api_key, re.I):
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

    if value("MEMEDROP_RATE_LIMIT_STORE") != "database":
        errors.append("MEMEDROP_RATE_LIMIT_STORE must be database.")
    if value("MEMEDROP_REQUIRE_INSTALL_ID").lower() not in {"1", "true", "yes", "on"}:
        errors.append("MEMEDROP_REQUIRE_INSTALL_ID must be true.")
    if environment.get("MEMEDROP_SUGGESTION_LOG_TEXT", "").strip().lower() == "full":
        errors.append("MEMEDROP_SUGGESTION_LOG_TEXT must not be full in production.")
    if environment.get("MEMEDROP_USE_DRAFT_TEMPLATES", "").strip().lower() == "true":
        errors.append("MEMEDROP_USE_DRAFT_TEMPLATES must not be true in production.")
    for name in (
        "MEMEDROP_RATE_LIMIT_WINDOW_MS",
        "MEMEDROP_RATE_LIMIT_MAX",
        "MEMEDROP_EXPENSIVE_RATE_LIMIT_WINDOW_MS",
        "MEMEDROP_EXPENSIVE_RATE_LIMIT_MAX",
        "MEMEDROP_IMAGE_DOWNLOAD_TIMEOUT_MS",
        "MEMEDROP_MAX_IMAGE_BYTES",
    ):
        positive_int(name)
    storage = value("MEME_STORAGE_PATH")
    if storage and not Path(storage).is_absolute():
        errors.append("MEME_STORAGE_PATH must be an absolute path.")
    return errors, warnings


def validate_url(name: str, raw: str, schemes: set[str], errors: list[str]) -> None:
    if not raw:
        return
    parsed = urlparse(raw)
    if parsed.scheme not in schemes or not parsed.hostname:
        errors.append(f"{name} must be a valid {', '.join(sorted(schemes))} URL.")
    elif parsed.hostname.lower() in PLACEHOLDER_HOSTS:
        errors.append(f"{name} must not use a local or placeholder host: {parsed.hostname}.")


def repository_root() -> Path:
    return Path(__file__).resolve().parents[4]
