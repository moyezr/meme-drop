"""Transactional, user-owned credits for idempotent meme generations."""

from __future__ import annotations

import hashlib
import logging
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Protocol

from sqlalchemy import insert, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from memedrop_api.db import ApiKey, CreditTransaction, Database, GeneratedAsset, Generation, User
from memedrop_api.public_ids import PublicIdError, PublicIdKind, create_public_id, parse_public_id
from memedrop_api.services.storage import MAX_GENERATED_AGENT_OBJECTS

_ID_INSERT_ATTEMPTS = 5
_IDEMPOTENCY_KEY_MAX_LENGTH = 200
_FINGERPRINT_PATTERN = re.compile(r"[0-9a-f]{64}\Z")
_FAILURE_CODE_PATTERN = re.compile(r"[a-z0-9_]{1,64}\Z")
_ASSET_RETENTION = timedelta(days=30)
_MAX_GENERATION_ASSETS = MAX_GENERATED_AGENT_OBJECTS
_DEFAULT_STALE_GENERATION_AFTER = timedelta(minutes=30)
_DEFAULT_STALE_RECONCILIATION_LIMIT = 100
LOGGER = logging.getLogger(__name__)


class AgentGenerationCreditError(ValueError):
    pass


class UserNotFound(AgentGenerationCreditError):
    pass


class AgentApiKeyNotActive(AgentGenerationCreditError):
    pass


class InsufficientCredits(AgentGenerationCreditError):
    pass


class GenerationNotFound(AgentGenerationCreditError):
    pass


class IdempotencyConflict(AgentGenerationCreditError):
    pass


class InvalidGenerationTransition(AgentGenerationCreditError):
    pass


class PublicIdCollisionExhausted(RuntimeError):
    pass


class GenerationObjectCleanupUnavailable(AgentGenerationCreditError):
    pass


class GenerationStatus(StrEnum):
    PROCESSING = "processing"
    SUCCEEDED = "succeeded"
    NO_FIT = "no_fit"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass(frozen=True, slots=True)
class CreditBalance:
    user_id: str
    credits: int


@dataclass(frozen=True, slots=True)
class GenerationResult:
    id: str
    status: GenerationStatus
    failure_code: str | None
    balance: CreditBalance
    replayed: bool = False


@dataclass(frozen=True, slots=True)
class GenerationAssetInput:
    object_key: str
    content_type: str
    content_hash: str


@dataclass(frozen=True, slots=True)
class DurableGenerationAsset:
    id: str
    user_id: str
    generation_id: str
    object_key: str
    content_type: str
    content_hash: str
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class GenerationCompletion:
    generation: GenerationResult
    assets: tuple[DurableGenerationAsset, ...]


PublicIdFactory = Callable[[PublicIdKind], str]


class GenerationObjectCleaner(Protocol):
    async def cleanup_generation_objects(self, *, user_id: str, generation_id: str) -> None: ...


class AgentGenerationCreditService:
    """Reserve requested credits and settle to one credit per durable asset."""

    def __init__(
        self,
        database: Database,
        *,
        id_factory: PublicIdFactory | None = None,
        id_insert_attempts: int = _ID_INSERT_ATTEMPTS,
        stale_generation_after: timedelta = _DEFAULT_STALE_GENERATION_AFTER,
        generation_object_cleaner: GenerationObjectCleaner | None = None,
    ) -> None:
        if id_insert_attempts < 1:
            raise ValueError("id_insert_attempts must be positive")
        if stale_generation_after <= timedelta(0):
            raise ValueError("stale_generation_after must be positive")
        self._database = database
        self._id_factory = id_factory or (lambda kind: create_public_id(kind).value)
        self._id_insert_attempts = id_insert_attempts
        self._stale_generation_after = stale_generation_after
        self._generation_object_cleaner = generation_object_cleaner

    async def grant_credits(
        self, *, user_id: str, credits: int, grant_idempotency_key: str
    ) -> CreditBalance:
        _validate_user_id(user_id)
        if not isinstance(credits, int) or isinstance(credits, bool) or credits < 1:
            raise AgentGenerationCreditError("credits must be a positive whole number")
        external_id = (
            f"grant:{user_id}:"
            + _hash_idempotency_key(grant_idempotency_key, namespace="grant").hex()
        )
        async with self._database.session() as session, session.begin():
            user = await _lock_user(session, user_id)
            existing = await session.scalar(
                select(CreditTransaction).where(CreditTransaction.external_id == external_id)
            )
            if existing is not None:
                if (
                    existing.user_id != user_id
                    or existing.type != "grant"
                    or existing.amount != credits
                ):
                    raise IdempotencyConflict("grant idempotency key conflicts with prior grant")
                return CreditBalance(user_id, user.credits)
            session.add(
                CreditTransaction(
                    user_id=user_id, amount=credits, type="grant", external_id=external_id
                )
            )
            user.credits += credits
            await session.flush()
            return CreditBalance(user_id, user.credits)

    async def begin_generation(
        self,
        *,
        user_id: str,
        api_key_id: str,
        idempotency_key: str,
        request_fingerprint: str,
        requested_count: int,
    ) -> GenerationResult:
        _validate_user_id(user_id)
        _validate_api_key_id(api_key_id)
        fingerprint = _fingerprint_bytes(request_fingerprint)
        if (
            not isinstance(requested_count, int)
            or isinstance(requested_count, bool)
            or not 1 <= requested_count <= 5
        ):
            raise AgentGenerationCreditError("requested count must be 1 to 5")
        key_hash = _hash_idempotency_key(idempotency_key, namespace="generation")
        async with self._database.session() as session, session.begin():
            user = await _lock_user(session, user_id)
            await _require_active_api_key(session, user_id=user_id, api_key_id=api_key_id)
            existing = await _generation_for_identity(session, user_id, key_hash)
            if existing is not None:
                if existing.request_fingerprint != fingerprint:
                    raise IdempotencyConflict(
                        "idempotency key conflicts with a different request fingerprint"
                    )
                return _generation_result(existing, user.credits, replayed=True)
            if user.credits < requested_count:
                raise InsufficientCredits("insufficient credits")
            generation_id = await self._insert_generation(
                session,
                user_id=user_id,
                api_key_id=api_key_id,
                key_hash=key_hash,
                fingerprint=fingerprint,
                requested_count=requested_count,
            )
            user.credits -= requested_count
            session.add(
                CreditTransaction(
                    user_id=user_id,
                    generation_id=generation_id,
                    amount=-requested_count,
                    type="generation",
                )
            )
            await session.flush()
            generation = await _generation_for_id(session, user_id, generation_id)
            return _generation_result(generation, user.credits)

    async def settle_generation(
        self,
        *,
        user_id: str,
        generation_id: str,
        outcome: GenerationStatus,
        returned_asset_count: int = 0,
        failure_code: str | None = None,
    ) -> GenerationResult:
        _validate_settlement(outcome, returned_asset_count, failure_code)
        if outcome is GenerationStatus.SUCCEEDED:
            raise InvalidGenerationTransition(
                "successful generations must be completed with durable assets"
            )
        async with self._database.session() as session, session.begin():
            user = await _lock_user(session, user_id)
            generation = await _generation_for_id(session, user_id, generation_id)
            _require_processing(generation)
            _refund(session, user, generation, generation.reserved_credits)
            generation.status = outcome.value
            generation.failure_code = failure_code
            generation.completed_at = datetime.now(UTC)
            await session.flush()
            return _generation_result(generation, user.credits)

    async def complete_generation_with_assets(
        self,
        *,
        user_id: str,
        generation_id: str,
        assets: Sequence[GenerationAssetInput],
    ) -> GenerationCompletion:
        _validate_asset_inputs(user_id, generation_id, assets)
        expires_at = datetime.now(UTC) + _ASSET_RETENTION
        async with self._database.session() as session, session.begin():
            user = await _lock_user(session, user_id)
            generation = await _generation_for_id(session, user_id, generation_id)
            _require_processing(generation)
            if len(assets) > generation.reserved_credits:
                raise AgentGenerationCreditError("asset count exceeds reserved credits")
            durable = [
                await self._insert_generated_asset(
                    session,
                    user_id=user_id,
                    generation_id=generation_id,
                    asset=asset,
                    expires_at=expires_at,
                )
                for asset in assets
            ]
            _refund(session, user, generation, generation.reserved_credits - len(assets))
            generation.status = GenerationStatus.SUCCEEDED.value
            generation.completed_at = datetime.now(UTC)
            await session.flush()
            return GenerationCompletion(
                generation=_generation_result(generation, user.credits), assets=tuple(durable)
            )

    async def reconcile_stale_generations(
        self,
        *,
        as_of: datetime | None = None,
        limit: int = _DEFAULT_STALE_RECONCILIATION_LIMIT,
        user_id: str | None = None,
    ) -> int:
        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 1_000:
            raise AgentGenerationCreditError("reconciliation limit must be 1 to 1000")
        current = as_of or datetime.now(UTC)
        if current.tzinfo is None or current.utcoffset() is None:
            raise AgentGenerationCreditError("reconciliation time must be timezone-aware")
        cutoff = current - self._stale_generation_after
        async with self._database.session() as session:
            query = select(Generation.id, Generation.user_id).where(
                Generation.status == GenerationStatus.PROCESSING.value,
                Generation.created_at < cutoff,
            )
            if user_id is not None:
                query = query.where(Generation.user_id == user_id)
            candidates = (
                await session.execute(
                    query.order_by(Generation.created_at, Generation.id).limit(limit)
                )
            ).all()
        reconciled = 0
        for generation_id, owner_id in candidates:
            async with self._database.session() as session, session.begin():
                user = await _lock_user(session, owner_id)
                generation = await session.scalar(
                    select(Generation)
                    .where(Generation.id == generation_id, Generation.user_id == owner_id)
                    .with_for_update()
                )
                if (
                    generation is None
                    or generation.status != GenerationStatus.PROCESSING.value
                    or generation.created_at >= cutoff
                ):
                    continue
                if self._generation_object_cleaner is None:
                    raise GenerationObjectCleanupUnavailable(
                        "stale generation object cleanup is not configured"
                    )
                try:
                    await self._generation_object_cleaner.cleanup_generation_objects(
                        user_id=owner_id, generation_id=generation_id
                    )
                except Exception as error:
                    # One bounded storage failure must leave this reservation
                    # untouched and must not prevent later candidates from
                    # being reconciled. The candidate remains retryable.
                    LOGGER.warning(
                        "Stale generation object cleanup failed",
                        extra={
                            "event": "stale_generation_cleanup_failed",
                            "user_id": owner_id,
                            "generation_id": generation_id,
                            "failure_category": _cleanup_failure_category(error),
                        },
                    )
                    continue
                _refund(session, user, generation, generation.reserved_credits)
                generation.status = GenerationStatus.FAILED.value
                generation.failure_code = "generation_timeout"
                generation.completed_at = current
                await session.flush()
                reconciled += 1
        return reconciled

    async def balance(self, *, user_id: str) -> CreditBalance:
        _validate_user_id(user_id)
        async with self._database.session() as session:
            user = await session.get(User, user_id)
        if user is None:
            raise UserNotFound("user not found")
        return CreditBalance(user_id, user.credits)

    async def generation_result(self, *, user_id: str, generation_id: str) -> GenerationResult:
        async with self._database.session() as session:
            user = await session.get(User, user_id)
            if user is None:
                raise UserNotFound("user not found")
            generation = await _generation_for_id(session, user_id, generation_id)
            return _generation_result(generation, user.credits)

    async def _insert_generation(
        self,
        session: AsyncSession,
        *,
        user_id: str,
        api_key_id: str,
        key_hash: bytes,
        fingerprint: bytes,
        requested_count: int,
    ) -> str:
        for _ in range(self._id_insert_attempts):
            generation_id = self._new_public_id(PublicIdKind.GENERATION)
            try:
                async with session.begin_nested():
                    await session.execute(
                        insert(Generation).values(
                            id=generation_id,
                            user_id=user_id,
                            api_key_id=api_key_id,
                            idempotency_key_hash=key_hash,
                            request_fingerprint=fingerprint,
                            reserved_credits=requested_count,
                            status=GenerationStatus.PROCESSING.value,
                        )
                    )
            except IntegrityError as error:
                if _is_primary_key_collision(error, "generations"):
                    continue
                raise
            return generation_id
        raise PublicIdCollisionExhausted("could not allocate a unique generation ID")

    async def _insert_generated_asset(
        self,
        session: AsyncSession,
        *,
        user_id: str,
        generation_id: str,
        asset: GenerationAssetInput,
        expires_at: datetime,
    ) -> DurableGenerationAsset:
        for _ in range(self._id_insert_attempts):
            asset_id = self._new_public_id(PublicIdKind.ASSET)
            try:
                async with session.begin_nested():
                    await session.execute(
                        insert(GeneratedAsset).values(
                            id=asset_id,
                            user_id=user_id,
                            generation_id=generation_id,
                            object_key=asset.object_key,
                            content_type=asset.content_type,
                            content_hash=asset.content_hash,
                            expires_at=expires_at,
                            deletion_state="active",
                        )
                    )
            except IntegrityError as error:
                if _is_primary_key_collision(error, "generated_assets"):
                    continue
                raise
            return DurableGenerationAsset(
                asset_id,
                user_id,
                generation_id,
                asset.object_key,
                asset.content_type,
                asset.content_hash,
                expires_at,
            )
        raise PublicIdCollisionExhausted("could not allocate a unique asset ID")

    def _new_public_id(self, kind: PublicIdKind) -> str:
        value = self._id_factory(kind)
        try:
            return parse_public_id(value, expected_kind=kind).value
        except PublicIdError as error:
            raise ValueError(f"id_factory returned an invalid {kind} ID") from error


async def _lock_user(session: AsyncSession, user_id: str) -> User:
    user = await session.scalar(select(User).where(User.id == user_id).with_for_update())
    if user is None:
        raise UserNotFound("user not found")
    return user


async def _require_active_api_key(session: AsyncSession, *, user_id: str, api_key_id: str) -> None:
    key = await session.scalar(
        select(ApiKey).where(
            ApiKey.id == api_key_id, ApiKey.user_id == user_id, ApiKey.revoked_at.is_(None)
        )
    )
    if key is None:
        raise AgentApiKeyNotActive("API key is not active")


async def _generation_for_identity(
    session: AsyncSession, user_id: str, key_hash: bytes
) -> Generation | None:
    return await session.scalar(
        select(Generation).where(
            Generation.user_id == user_id, Generation.idempotency_key_hash == key_hash
        )
    )


async def _generation_for_id(session: AsyncSession, user_id: str, generation_id: str) -> Generation:
    generation = await session.scalar(
        select(Generation).where(Generation.id == generation_id, Generation.user_id == user_id)
    )
    if generation is None:
        raise GenerationNotFound("generation not found")
    return generation


def _refund(session: AsyncSession, user: User, generation: Generation, amount: int) -> None:
    if amount <= 0:
        return
    session.add(
        CreditTransaction(
            user_id=user.id,
            generation_id=generation.id,
            amount=amount,
            type="generation_refund",
        )
    )
    user.credits += amount


def _require_processing(generation: Generation) -> None:
    if generation.status != GenerationStatus.PROCESSING.value:
        raise InvalidGenerationTransition(f"generation cannot transition from {generation.status}")


def _generation_result(
    generation: Generation, credits: int, *, replayed: bool = False
) -> GenerationResult:
    return GenerationResult(
        generation.id,
        GenerationStatus(generation.status),
        generation.failure_code,
        CreditBalance(generation.user_id, credits),
        replayed,
    )


def _hash_idempotency_key(value: str, *, namespace: str) -> bytes:
    if (
        not isinstance(value, str)
        or not value
        or len(value) > _IDEMPOTENCY_KEY_MAX_LENGTH
        or any(character.isspace() for character in value)
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
    ):
        raise AgentGenerationCreditError("idempotency key must be 1 to 200 visible characters")
    return hashlib.sha256(f"memedrop:{namespace}:v1:{value}".encode()).digest()


def _fingerprint_bytes(value: str) -> bytes:
    if not isinstance(value, str) or not _FINGERPRINT_PATTERN.fullmatch(value):
        raise AgentGenerationCreditError("request fingerprint must be a SHA-256 hex digest")
    return bytes.fromhex(value)


def _validate_user_id(user_id: str) -> None:
    _validate_public_id(user_id, PublicIdKind.USER, "user ID")


def _validate_api_key_id(api_key_id: str) -> None:
    _validate_public_id(api_key_id, PublicIdKind.API_KEY, "API key ID")


def _validate_public_id(value: str, kind: PublicIdKind, label: str) -> None:
    try:
        parse_public_id(value, expected_kind=kind)
    except PublicIdError as error:
        raise AgentGenerationCreditError(f"invalid {label}") from error


def _validate_settlement(
    outcome: GenerationStatus, returned_asset_count: int, failure_code: str | None
) -> None:
    if not isinstance(outcome, GenerationStatus):
        raise AgentGenerationCreditError("outcome must be a GenerationStatus")
    if (
        not isinstance(returned_asset_count, int)
        or isinstance(returned_asset_count, bool)
        or returned_asset_count < 0
    ):
        raise AgentGenerationCreditError("returned asset count must be a non-negative whole number")
    if outcome is GenerationStatus.PROCESSING:
        raise AgentGenerationCreditError("processing is not a terminal outcome")
    if outcome is GenerationStatus.SUCCEEDED:
        if returned_asset_count < 1:
            raise AgentGenerationCreditError("successful generations must return an asset")
        if failure_code is not None:
            raise AgentGenerationCreditError("successful generations cannot include a failure code")
        return
    if returned_asset_count:
        raise AgentGenerationCreditError("non-successful generations cannot return assets")
    if outcome is GenerationStatus.NO_FIT:
        if failure_code is not None:
            raise AgentGenerationCreditError("no-fit generations cannot include a failure code")
        return
    if not isinstance(failure_code, str) or not _FAILURE_CODE_PATTERN.fullmatch(failure_code):
        raise AgentGenerationCreditError(
            "failed or cancelled generations require a safe failure code"
        )


def _validate_asset_inputs(
    user_id: str, generation_id: str, assets: Sequence[GenerationAssetInput]
) -> None:
    _validate_user_id(user_id)
    _validate_public_id(generation_id, PublicIdKind.GENERATION, "generation ID")
    if not 1 <= len(assets) <= _MAX_GENERATION_ASSETS:
        raise AgentGenerationCreditError(
            f"successful generations must include 1 to {_MAX_GENERATION_ASSETS} assets"
        )
    object_keys: set[str] = set()
    for asset in assets:
        if not isinstance(asset, GenerationAssetInput):
            raise AgentGenerationCreditError("generation asset is invalid")
        if (
            not asset.object_key.startswith(f"generated/users/{user_id}/{generation_id}/")
            or not 1 <= len(asset.object_key) <= 1_024
            or asset.object_key in object_keys
        ):
            raise AgentGenerationCreditError("generation asset key is invalid")
        if not 1 <= len(asset.content_type) <= 127 or any(
            character.isspace() for character in asset.content_type
        ):
            raise AgentGenerationCreditError("generation asset content type is invalid")
        if len(asset.content_hash) != 64 or any(
            character not in "0123456789abcdef" for character in asset.content_hash
        ):
            raise AgentGenerationCreditError("generation asset hash is invalid")
        object_keys.add(asset.object_key)


def _is_primary_key_collision(error: IntegrityError, table_name: str) -> bool:
    diagnostic = getattr(getattr(error, "orig", None), "diag", None)
    return getattr(diagnostic, "constraint_name", None) == f"{table_name}_pkey"


def _cleanup_failure_category(error: Exception) -> str:
    if isinstance(error, TimeoutError):
        return "storage_timeout"
    if isinstance(error, OSError):
        return "storage_io"
    return "storage_unavailable"
