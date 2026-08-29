from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
from collections.abc import Sequence
from pathlib import Path
from typing import Protocol, TypedDict, cast
from urllib.parse import urlparse
from uuid import UUID

import httpx
from alembic import command
from alembic.config import Config
from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert

from memedrop_api.agent_credentials import (
    AgentCredentialError,
    AgentCredentialService,
    ApiKeyRecord,
    IssuedApiKey,
    UserCredentialStatus,
    UserRecord,
)
from memedrop_api.agent_generation_credits import (
    AgentGenerationCreditError,
    AgentGenerationCreditService,
    CreditBalance,
)
from memedrop_api.config import PRODUCTION_API_ORIGIN, PRODUCTION_BUCKET, Settings
from memedrop_api.db import Database, InstallUser, Meme
from memedrop_api.services.catalog import MemeCatalog, normalize_template_name
from memedrop_api.services.storage import (
    MemeStorage,
    create_meme_storage,
    object_key_from_public_path,
)
from memedrop_api.services.thumbnails import THUMBNAIL_CONTENT_TYPE, make_thumbnail
from memedrop_api.services.usage_feedback import load_usage_feedback
from memedrop_api.user_repository import SqlAlchemyUserRepository

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


class AgentCredentialAdministrator(Protocol):
    async def create_user(
        self, *, auth_provider: str, auth_subject: str, email: str | None = None
    ) -> UserRecord: ...

    async def user_status(self, *, user_id: str) -> UserCredentialStatus: ...

    async def issue_api_key(self, *, user_id: str, name: str) -> IssuedApiKey: ...

    async def rotate_api_key(
        self,
        *,
        user_id: str,
        key_id: str,
        name: str,
    ) -> IssuedApiKey: ...

    async def revoke_api_key(
        self,
        *,
        user_id: str,
        key_id: str,
    ) -> ApiKeyRecord: ...


class AgentCreditAdministrator(Protocol):
    async def grant_credits(
        self,
        *,
        user_id: str,
        credits: int,
        grant_idempotency_key: str,
    ) -> CreditBalance: ...

    async def balance(self, *, user_id: str) -> CreditBalance: ...


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
        f"[MemeDrop] Meme catalog seeded: inserted={inserted} migrated={migrated} skipped={skipped}"
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
                migrated = await migrate_legacy_meme_files(settings, storage, legacy_memes)

        async with httpx.AsyncClient(timeout=settings.image_download_timeout_ms / 1000) as client:
            response = await client.get("https://api.imgflip.com/get_memes")
            response.raise_for_status()
            remote = cast(list[RemoteTemplate], response.json()["data"]["memes"])
            by_name = {normalize_template_name(item["name"]): item for item in remote}
            async with database.session() as session, session.begin():
                for template in catalog.verified_templates:
                    item = match_remote_template(template.name, template.aliases, by_name)
                    existing = await session.scalar(
                        select(Meme).where(func.lower(Meme.name) == template.name.lower())
                    )
                    existing_tags = dict(existing.system_tags or {}) if existing is not None else {}
                    if existing is not None:
                        if existing_tags.get("thumbnail_path"):
                            skipped += 1
                            continue
                        source_url = existing.source_url or (
                            item["url"] if item is not None else None
                        )
                        if source_url is None:
                            skipped += 1
                            continue
                    else:
                        if item is None:
                            skipped += 1
                            continue
                        extension = Path(httpx.URL(item["url"]).path).suffix.lower()
                        if extension not in {".jpg", ".jpeg", ".png", ".webp"}:
                            skipped += 1
                            continue
                        source_url = item["url"]
                    image = await client.get(source_url)
                    image.raise_for_status()
                    try:
                        thumbnail_path = await upload_catalog_thumbnail(
                            storage, template.template_id, image.content
                        )
                    except (OSError, ValueError):
                        skipped += 1
                        continue
                    if existing is not None:
                        existing.system_tags = {
                            **existing_tags,
                            "thumbnail_path": thumbnail_path,
                        }
                        continue
                    assert item is not None
                    filename = f"seed-{template.template_id}{extension}"
                    file_path = await storage.put_bytes(
                        f"catalog/{filename}",
                        image.content,
                        content_type=image.headers.get("content-type", "image/jpeg").split(";", 1)[
                            0
                        ],
                    )
                    session.add(
                        Meme(
                            name=template.name,
                            file_path=file_path,
                            format_type="text_overlay"
                            if template.supports_overlay
                            else "reaction_image",
                            is_evergreen=True,
                            system_tags={
                                "caption_pattern": template.caption_guidance.pattern,
                                "thumbnail_path": thumbnail_path,
                            },
                            source_url=item["url"],
                        )
                    )
                    inserted += 1
    finally:
        await database.close()
    return inserted, migrated, skipped


async def upload_catalog_thumbnail(
    storage: MemeStorage, template_id: str, image_bytes: bytes
) -> str:
    thumbnail = await asyncio.to_thread(make_thumbnail, image_bytes)
    return await storage.put_bytes(
        f"catalog/thumbnails/{template_id}.webp",
        thumbnail,
        content_type=THUMBNAIL_CONTENT_TYPE,
    )


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
            statement = insert(InstallUser).values(id=DEV_USER_ID, email="dev@memedrop.local")
            await session.execute(statement.on_conflict_do_nothing(index_elements=[InstallUser.id]))
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


def agent_admin() -> None:
    """Run one explicit private-beta account administration operation."""

    parser = agent_admin_parser()
    arguments = parser.parse_args()
    settings = Settings()  # type: ignore[call-arg]
    database = Database(settings.database_url)
    credentials = AgentCredentialService(SqlAlchemyUserRepository(database))
    credits = AgentGenerationCreditService(database)
    try:
        result = asyncio.run(
            _run_agent_admin_operation(
                arguments,
                credentials=credentials,
                credits=credits,
                database=database,
            )
        )
    except (AgentCredentialError, AgentGenerationCreditError) as error:
        parser.error(str(error))
    print(json.dumps(result, sort_keys=True))


def agent_admin_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="memedrop-agent-admin",
        description="Administer private-beta API users without exposing user content",
    )
    commands = parser.add_subparsers(dest="command", required=True)

    user_create = commands.add_parser("user-create", help="create a customer user")
    user_create.add_argument("--auth-provider", required=True)
    user_create.add_argument("--auth-subject", required=True)
    user_create.add_argument("--email")
    _require_confirmation(user_create)

    key_issue = commands.add_parser("key-issue", help="issue a new API key")
    key_issue.add_argument("--user-id", required=True)
    key_issue.add_argument("--name", required=True)
    _require_confirmation(key_issue)

    key_rotate = commands.add_parser("key-rotate", help="atomically rotate an active API key")
    key_rotate.add_argument("--user-id", required=True)
    key_rotate.add_argument("--key-id", required=True)
    key_rotate.add_argument("--name", required=True)
    _require_confirmation(key_rotate)

    key_revoke = commands.add_parser("key-revoke", help="revoke an active API key")
    key_revoke.add_argument("--user-id", required=True)
    key_revoke.add_argument("--key-id", required=True)
    _require_confirmation(key_revoke)

    credit_grant = commands.add_parser(
        "credits-grant", help="append an idempotent operator credit grant"
    )
    credit_grant.add_argument("--user-id", required=True)
    credit_grant.add_argument("--credits", required=True, type=_credit_count)
    credit_grant.add_argument("--idempotency-key", required=True)
    _require_confirmation(credit_grant)

    status = commands.add_parser("status", help="inspect content-free user status")
    status.add_argument("--user-id", required=True)
    return parser


async def execute_agent_admin_operation(
    arguments: argparse.Namespace,
    *,
    credentials: AgentCredentialAdministrator,
    credits: AgentCreditAdministrator,
) -> dict[str, object]:
    command = cast(str, arguments.command)
    if command == "user-create":
        user = await credentials.create_user(
            auth_provider=arguments.auth_provider,
            auth_subject=arguments.auth_subject,
            email=arguments.email,
        )
        return {"status": "created", "user": _user_status_json(user)}
    if command == "key-issue":
        issued = await credentials.issue_api_key(
            user_id=arguments.user_id,
            name=arguments.name,
        )
        return _issued_key_json(issued, status="issued")
    if command == "key-rotate":
        issued = await credentials.rotate_api_key(
            user_id=arguments.user_id,
            key_id=arguments.key_id,
            name=arguments.name,
        )
        return _issued_key_json(issued, status="rotated")
    if command == "key-revoke":
        key = await credentials.revoke_api_key(
            user_id=arguments.user_id,
            key_id=arguments.key_id,
        )
        return {"status": "revoked", "api_key": _api_key_status_json(key)}
    if command == "credits-grant":
        balance = await credits.grant_credits(
            user_id=arguments.user_id,
            credits=arguments.credits,
            grant_idempotency_key=arguments.idempotency_key,
        )
        return {"status": "granted", "balance": _credit_balance_json(balance)}
    if command == "status":
        user_status = await credentials.user_status(user_id=arguments.user_id)
        balance = await credits.balance(user_id=arguments.user_id)
        return {
            "status": "ok",
            "user": _user_status_json(user_status.user),
            "api_keys": [_api_key_status_json(key) for key in user_status.api_keys],
            "balance": _credit_balance_json(balance),
        }
    raise AssertionError("argparse returned an unknown agent admin command")


async def _run_agent_admin_operation(
    arguments: argparse.Namespace,
    *,
    credentials: AgentCredentialAdministrator,
    credits: AgentCreditAdministrator,
    database: Database,
) -> dict[str, object]:
    try:
        return await execute_agent_admin_operation(
            arguments,
            credentials=credentials,
            credits=credits,
        )
    finally:
        await database.close()


def _issued_key_json(issued: IssuedApiKey, *, status: str) -> dict[str, object]:
    # This is the only serialization path for plaintext credentials. The caller prints this
    # result once; status and later inspection paths contain key metadata only.
    return {
        "status": status,
        "api_key": _api_key_status_json(issued.key),
        "credential": issued.credential,
    }


def _user_status_json(user: UserRecord) -> dict[str, object]:
    return {
        "id": user.id,
        "auth_provider": user.auth_provider,
        "auth_subject": user.auth_subject,
        "email": user.email,
        "credits": user.credits,
        "created_at": user.created_at.isoformat(),
    }


def _api_key_status_json(key: ApiKeyRecord) -> dict[str, object]:
    return {
        "id": key.id,
        "user_id": key.user_id,
        "name": key.name,
        "last_used_at": key.last_used_at.isoformat() if key.last_used_at else None,
        "revoked_at": key.revoked_at.isoformat() if key.revoked_at else None,
        "created_at": key.created_at.isoformat(),
    }


def _credit_balance_json(balance: CreditBalance) -> dict[str, object]:
    return {"user_id": balance.user_id, "credits": balance.credits}


def _require_confirmation(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--confirm",
        action="store_true",
        required=True,
        help="confirm this database mutation",
    )


def _credit_count(raw: str) -> int:
    try:
        credits = int(raw)
    except ValueError as error:
        raise argparse.ArgumentTypeError("credits must be a whole number") from error
    if not 1 <= credits <= 1_000_000:
        raise argparse.ArgumentTypeError("credits must be from 1 to 1000000")
    return credits


def _audit_code(raw: str) -> str:
    if not re.fullmatch(r"[a-z0-9_]{1,40}", raw):
        raise argparse.ArgumentTypeError("reason must be 1 to 40 lowercase code characters")
    return raw


def _operator_actor(raw: str) -> str:
    if not re.fullmatch(r"[A-Za-z0-9_.:@-]{1,120}", raw):
        raise argparse.ArgumentTypeError("actor must be a 1 to 120 character operator identifier")
    return raw


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


def trend_refresh() -> None:
    """Run the bounded scheduled collector; Tavily is never imported by the API app."""

    from memedrop_api.services.trend_runtime import (  # noqa: PLC0415
        TREND_QUERY_PROFILES,
        TrendRefreshConfigurationError,
        TrendRefreshFailed,
        refresh_trends,
    )

    parser = argparse.ArgumentParser(
        description="Collect normalized cultural trends and publish the Redis serving index"
    )
    parser.add_argument(
        "--profile",
        action="append",
        choices=[profile.name for profile in TREND_QUERY_PROFILES],
        help="run one curated cadence profile; repeat to run several (default: all)",
    )
    arguments = parser.parse_args()
    settings = Settings()  # type: ignore[call-arg]
    try:
        report = asyncio.run(refresh_trends(settings, profile_names=arguments.profile))
    except (TrendRefreshConfigurationError, TrendRefreshFailed) as error:
        parser.error(str(error))
    print(json.dumps(report.as_json(), sort_keys=True))


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

    def bounded_int(name: str, *, minimum: int, maximum: int) -> int | None:
        raw = value(name)
        try:
            parsed = int(raw)
        except ValueError:
            if raw:
                errors.append(f"{name} must be an integer from {minimum} to {maximum}.")
            return None
        if not minimum <= parsed <= maximum:
            errors.append(f"{name} must be from {minimum} to {maximum}.")
            return None
        return parsed

    def bounded_float(name: str, *, minimum: float, maximum: float) -> float | None:
        raw = value(name)
        try:
            parsed = float(raw)
        except ValueError:
            if raw:
                errors.append(f"{name} must be a number from {minimum} to {maximum}.")
            return None
        if not minimum <= parsed <= maximum:
            errors.append(f"{name} must be from {minimum} to {maximum}.")
            return None
        return parsed

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
    public_origin = value("MEMEDROP_API_PUBLIC_ORIGIN")
    validate_url("MEMEDROP_API_PUBLIC_ORIGIN", public_origin, {"https"}, errors)
    if public_origin.rstrip("/") != PRODUCTION_API_ORIGIN:
        errors.append(f"MEMEDROP_API_PUBLIC_ORIGIN must be exactly {PRODUCTION_API_ORIGIN}.")

    api_key = value("OPENROUTER_API_KEY")
    if is_placeholder_value(api_key):
        errors.append("OPENROUTER_API_KEY must not use a placeholder value.")
    elif api_key and len(api_key) < 16:
        warnings.append("OPENROUTER_API_KEY looks unusually short.")

    value("OPENROUTER_APP_NAME")
    for name in (
        "OPENROUTER_SUGGESTION_MODEL",
        "OPENROUTER_CAPTION_MODEL",
        "OPENROUTER_AUTO_TAG_MODEL",
        "OPENROUTER_TREND_MODEL",
        "OPENROUTER_EMBEDDING_MODEL",
    ):
        reject_placeholder(name, value(name))
    if value("MEMEDROP_TRENDS_ENABLED").lower() not in {"1", "true", "yes", "on"}:
        errors.append("MEMEDROP_TRENDS_ENABLED must be true for production launch.")
    tavily_api_key = value("TAVILY_API_KEY")
    reject_placeholder("TAVILY_API_KEY", tavily_api_key)
    cron_secret = value("CRON_SECRET")
    reject_placeholder("CRON_SECRET", cron_secret)
    if cron_secret and not 16 <= len(cron_secret) <= 512:
        errors.append("CRON_SECRET must contain 16 to 512 characters.")

    bounded_int("MEMEDROP_TREND_MONTHLY_CREDIT_BUDGET", minimum=1, maximum=1_000)
    bounded_float("MEMEDROP_TREND_COLLECTION_TIMEOUT_SECONDS", minimum=0.1, maximum=30)
    bounded_float("MEMEDROP_TREND_ENRICHMENT_TIMEOUT_SECONDS", minimum=0.1, maximum=60)
    bounded_float("MEMEDROP_TREND_EMBEDDING_TIMEOUT_SECONDS", minimum=0.1, maximum=60)
    bounded_int("MEMEDROP_TREND_EMBEDDING_BATCH_SIZE", minimum=1, maximum=128)
    bounded_float("MEMEDROP_TREND_COLLECTION_COOLDOWN_SECONDS", minimum=0, maximum=60)
    bounded_int("MEMEDROP_TREND_REFRESH_LOCK_TTL_SECONDS", minimum=60, maximum=3_600)
    bounded_int("MEMEDROP_TREND_SNAPSHOT_MAX_AGE_SECONDS", minimum=3_600, maximum=86_400)

    bounded_int("MEMEDROP_GENERATED_ASSET_CLEANUP_BATCH_SIZE", minimum=1, maximum=100)
    cleanup_claim_timeout = bounded_int(
        "MEMEDROP_GENERATED_ASSET_CLEANUP_CLAIM_TIMEOUT_SECONDS",
        minimum=60,
        maximum=86_400,
    )
    cleanup_lock_ttl = bounded_int(
        "MEMEDROP_GENERATED_ASSET_CLEANUP_LOCK_TTL_SECONDS",
        minimum=60,
        maximum=3_600,
    )
    if (
        cleanup_claim_timeout is not None
        and cleanup_lock_ttl is not None
        and cleanup_claim_timeout < cleanup_lock_ttl
    ):
        errors.append(
            "MEMEDROP_GENERATED_ASSET_CLEANUP_CLAIM_TIMEOUT_SECONDS must be greater than or "
            "equal to MEMEDROP_GENERATED_ASSET_CLEANUP_LOCK_TTL_SECONDS."
        )
    if environment.get("OPENROUTER_MEME_MODEL", "").strip():
        errors.append(
            "OPENROUTER_MEME_MODEL was removed; set OPENROUTER_SUGGESTION_MODEL and "
            "OPENROUTER_CAPTION_MODEL."
        )
    origins = [item.strip() for item in value("MEMEDROP_CORS_ORIGINS").split(",") if item.strip()]
    if "*" in origins:
        errors.append("MEMEDROP_CORS_ORIGINS must not include *.")
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
    if value("S3_BUCKET_NAME") != PRODUCTION_BUCKET:
        errors.append(f"S3_BUCKET_NAME must be {PRODUCTION_BUCKET}.")
    if environment.get("MEMEDROP_STORAGE_BUCKET", "").strip():
        errors.append("MEMEDROP_STORAGE_BUCKET was removed; use S3_BUCKET_NAME.")
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
