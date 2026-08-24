"""Transactional credit accounting for idempotent agent meme generations.

The public route owns request parsing and asset delivery.  This module owns the
durable part of a generation: it stores only fixed-size request hashes, reserves
one credit before work begins, and settles that reservation exactly once.
"""

from __future__ import annotations

import hashlib
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from enum import StrEnum
from typing import Protocol

from sqlalchemy import func, insert, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from memedrop_api.db import (
    AgentAccount,
    AgentApiKey,
    AgentGeneration,
    CreditLedgerEntry,
    Database,
    GeneratedAsset,
)
from memedrop_api.public_ids import PublicIdError, PublicIdKind, create_public_id, parse_public_id
from memedrop_api.services.storage import MAX_GENERATED_AGENT_OBJECTS

_CREDIT_COST = 1
_ID_INSERT_ATTEMPTS = 5
_IDEMPOTENCY_KEY_MAX_LENGTH = 200
_FINGERPRINT_PATTERN = re.compile(r"[0-9a-f]{64}\Z")
_FAILURE_CODE_PATTERN = re.compile(r"[a-z0-9_]{1,64}\Z")
_OPERATOR_ACTOR_PATTERN = re.compile(r"[A-Za-z0-9_.:@-]{1,120}\Z")
_ASSET_RETENTION = timedelta(days=30)
_MAX_GENERATION_ASSETS = MAX_GENERATED_AGENT_OBJECTS
_DEFAULT_STALE_GENERATION_AFTER = timedelta(minutes=30)
_DEFAULT_STALE_RECONCILIATION_LIMIT = 100


class AgentGenerationCreditError(ValueError):
    """Base error for safe, content-free generation accounting failures."""


class AgentAccountNotFound(AgentGenerationCreditError):
    """The requested agent account does not exist."""


class AgentAccountInactive(AgentGenerationCreditError):
    """New generation work cannot start for an inactive account."""


class AgentApiKeyNotActive(AgentGenerationCreditError):
    """The supplied API key does not belong to the active account."""


class InsufficientCredits(AgentGenerationCreditError):
    """The account has no available whole credit to reserve."""


class GenerationNotFound(AgentGenerationCreditError):
    """The generation is not owned by the addressed account."""


class IdempotencyConflict(AgentGenerationCreditError):
    """An idempotency key was reused with a different request fingerprint."""


class InvalidGenerationTransition(AgentGenerationCreditError):
    """A generation cannot be settled from its current state."""


class PublicIdCollisionExhausted(RuntimeError):
    """A compact primary-key collision persisted beyond the bounded retry budget."""


class GenerationObjectCleanupUnavailable(AgentGenerationCreditError):
    """A stale reservation cannot be released until its objects are reconciled."""


class GenerationStatus(StrEnum):
    """States exposed to the route without source-post or caption content."""

    PROCESSING = "processing"
    SUCCEEDED = "succeeded"
    NO_FIT = "no_fit"
    FAILED = "failed"
    CANCELLED = "cancelled"


@dataclass(frozen=True, slots=True)
class CreditBalance:
    """The content-free, integer balance for one agent account."""

    agent_account_id: str
    credits: int


@dataclass(frozen=True, slots=True)
class GenerationResult:
    """A content-free generation state returned by the accounting boundary."""

    id: str
    status: GenerationStatus
    failure_code: str | None
    balance: CreditBalance
    replayed: bool = False


@dataclass(frozen=True, slots=True)
class GenerationAssetInput:
    """A stored render prepared for one pending generation, without caption text."""

    object_key: str
    content_type: str
    content_hash: str


@dataclass(frozen=True, slots=True)
class DurableGenerationAsset:
    """A committed generated-asset record in ranked output order."""

    id: str
    agent_account_id: str
    generation_id: str
    object_key: str
    content_type: str
    content_hash: str
    expires_at: datetime


@dataclass(frozen=True, slots=True)
class GenerationCompletion:
    """The atomically settled generation and its durable media records."""

    generation: GenerationResult
    assets: tuple[DurableGenerationAsset, ...]


PublicIdFactory = Callable[[PublicIdKind], str]


class GenerationObjectCleaner(Protocol):
    """Bounded storage repair required before stale credit release."""

    async def cleanup_generation_objects(self, *, account_id: str, generation_id: str) -> None: ...


class AgentGenerationCreditService:
    """Reserve and settle generation credits in short PostgreSQL transactions.

    Every mutation first locks the account row.  That intentionally serializes
    an account's balance changes, so two concurrent generation starts cannot
    both spend the last available credit.  It does not serialize unrelated
    accounts.
    """

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
        self._id_factory = id_factory or _default_public_id
        self._id_insert_attempts = id_insert_attempts
        self._stale_generation_after = stale_generation_after
        self._generation_object_cleaner = generation_object_cleaner

    async def grant_credits(
        self,
        *,
        account_id: str,
        credits: int,
        grant_idempotency_key: str,
        operator_actor_id: str | None = None,
    ) -> CreditBalance:
        """Append an idempotent system grant, useful for initial or promotional credit.

        Payment handling can build on the same immutable ledger later.  This
        small primitive deliberately does not accept free-form descriptions.
        """

        _validate_account_id(account_id)
        if not isinstance(credits, int) or isinstance(credits, bool) or credits < 1:
            raise AgentGenerationCreditError("credits must be a positive whole number")
        actor_type, actor_id = _grant_actor_metadata(operator_actor_id)
        grant_hash = _hash_idempotency_key(grant_idempotency_key, namespace="grant")

        async with self._database.session() as session, session.begin():
            await _lock_account(session, account_id, require_active=False)
            existing = await _ledger_entry_for_identity(
                session, account_id=account_id, idempotency_key_hash=grant_hash
            )
            if existing is not None:
                if (
                    existing.reason != "grant"
                    or existing.credit_delta != credits
                    or existing.generation_id is not None
                    or existing.actor_type != actor_type
                    or existing.actor_id != actor_id
                ):
                    raise IdempotencyConflict("grant idempotency key conflicts with prior grant")
                return CreditBalance(account_id, await _balance_for_account(session, account_id))

            await self._insert_ledger_entry(
                session,
                account_id=account_id,
                generation_id=None,
                credit_delta=credits,
                reason="grant",
                actor_type=actor_type,
                actor_id=actor_id,
                idempotency_key_hash=grant_hash,
            )
            return CreditBalance(account_id, await _balance_for_account(session, account_id))

    async def begin_generation(
        self,
        *,
        account_id: str,
        api_key_id: str,
        idempotency_key: str,
        request_fingerprint: str,
    ) -> GenerationResult:
        """Create a processing generation and reserve one credit atomically.

        A matching idempotent replay returns its original durable state without
        inserting any ledger entry.  The fingerprint must already be a SHA-256
        digest of the canonical request; raw request content is never accepted
        by this persistence layer.
        """

        _validate_account_id(account_id)
        _validate_api_key_id(api_key_id)
        _validate_fingerprint(request_fingerprint)
        request_key_hash = _hash_idempotency_key(idempotency_key, namespace="generation")

        async with self._database.session() as session, session.begin():
            await _lock_account(session, account_id, require_active=True)
            await _require_active_api_key(session, account_id=account_id, api_key_id=api_key_id)
            existing = await _generation_for_identity(
                session,
                account_id=account_id,
                idempotency_key_hash=request_key_hash,
            )
            if existing is not None:
                if existing.request_fingerprint != request_fingerprint:
                    raise IdempotencyConflict(
                        "idempotency key conflicts with a different request fingerprint"
                    )
                return _generation_result(
                    existing,
                    balance=await _balance_for_account(session, account_id),
                    replayed=True,
                )

            if await _balance_for_account(session, account_id) < _CREDIT_COST:
                raise InsufficientCredits("insufficient credits")

            generation_id = await self._insert_generation(
                session,
                account_id=account_id,
                api_key_id=api_key_id,
                idempotency_key_hash=request_key_hash,
                request_fingerprint=request_fingerprint,
            )
            await self._insert_ledger_entry(
                session,
                account_id=account_id,
                generation_id=generation_id,
                credit_delta=-_CREDIT_COST,
                reason="generation_reservation",
                actor_type="system",
                actor_id="generation_credit",
                idempotency_key_hash=_derived_ledger_identity(generation_id, "reservation"),
            )
            generation = await _generation_for_id(session, account_id, generation_id)
            return _generation_result(
                generation,
                balance=await _balance_for_account(session, account_id),
            )

    async def settle_generation(
        self,
        *,
        account_id: str,
        generation_id: str,
        outcome: GenerationStatus,
        returned_asset_count: int = 0,
        failure_code: str | None = None,
    ) -> GenerationResult:
        """Commit or release a reservation after rendering has reached an outcome.

        ``SUCCEEDED`` is allowed only with at least one returned asset.  That
        includes deterministic fallback output, which therefore costs exactly
        one reserved credit.  All other terminal states release that credit.
        """

        _validate_account_id(account_id)
        _validate_generation_id(generation_id)
        _validate_settlement(outcome, returned_asset_count, failure_code)
        if outcome is GenerationStatus.SUCCEEDED:
            raise InvalidGenerationTransition(
                "successful generations must be completed with durable assets"
            )

        async with self._database.session() as session, session.begin():
            await _lock_account(session, account_id, require_active=False)
            generation = await _generation_for_id(session, account_id, generation_id)
            if generation.status != GenerationStatus.PROCESSING.value:
                raise InvalidGenerationTransition(
                    f"generation cannot transition from {generation.status}"
                )

            await self._insert_ledger_entry(
                session,
                account_id=account_id,
                generation_id=generation_id,
                credit_delta=_CREDIT_COST,
                reason="generation_release",
                actor_type="system",
                actor_id="generation_credit",
                idempotency_key_hash=_derived_ledger_identity(generation_id, "release"),
            )
            generation.status = outcome.value
            generation.failure_code = failure_code
            generation.completed_at = datetime.now(UTC)
            await session.flush()
            return _generation_result(
                generation,
                balance=await _balance_for_account(session, account_id),
            )

    async def complete_generation_with_assets(
        self,
        *,
        account_id: str,
        generation_id: str,
        assets: Sequence[GenerationAssetInput],
    ) -> GenerationCompletion:
        """Atomically persist all returned assets and commit their reserved credit.

        Rendering and object storage happen before this call.  Within one
        database transaction we lock the tenant, insert every generated-asset
        row, append the zero-delta commit ledger entry, and mark the generation
        successful.  A collision or any later insert failure rolls back every
        asset row and leaves the reservation processing for the caller to
        release after exact-key storage cleanup.
        """

        _validate_account_id(account_id)
        _validate_generation_id(generation_id)
        _validate_asset_inputs(account_id, generation_id, assets)
        expires_at = datetime.now(UTC) + _ASSET_RETENTION
        async with self._database.session() as session, session.begin():
            await _lock_account(session, account_id, require_active=False)
            generation = await _generation_for_id(session, account_id, generation_id)
            if generation.status != GenerationStatus.PROCESSING.value:
                raise InvalidGenerationTransition(
                    f"generation cannot transition from {generation.status}"
                )
            durable_assets: list[DurableGenerationAsset] = []
            for asset in assets:
                durable_assets.append(
                    await self._insert_generated_asset(
                        session,
                        account_id=account_id,
                        generation_id=generation_id,
                        asset=asset,
                        expires_at=expires_at,
                    )
                )
            await self._insert_ledger_entry(
                session,
                account_id=account_id,
                generation_id=generation_id,
                credit_delta=0,
                reason="generation_commit",
                actor_type="system",
                actor_id="generation_credit",
                idempotency_key_hash=_derived_ledger_identity(generation_id, "commit"),
            )
            generation.status = GenerationStatus.SUCCEEDED.value
            generation.failure_code = None
            generation.completed_at = datetime.now(UTC)
            await session.flush()
            return GenerationCompletion(
                generation=_generation_result(
                    generation,
                    balance=await _balance_for_account(session, account_id),
                ),
                assets=tuple(durable_assets),
            )

    async def reconcile_stale_generations(
        self,
        *,
        as_of: datetime | None = None,
        limit: int = _DEFAULT_STALE_RECONCILIATION_LIMIT,
        account_id: str | None = None,
    ) -> int:
        """Release bounded, abandoned reservations exactly once.

        This is intended for a scheduled worker.  Candidate selection is only
        an optimization: each candidate is re-read under its account and row
        locks, so overlapping workers cannot double-release a credit.
        """

        if not isinstance(limit, int) or isinstance(limit, bool) or not 1 <= limit <= 1_000:
            raise AgentGenerationCreditError("reconciliation limit must be 1 to 1000")
        if account_id is not None:
            _validate_account_id(account_id)
        current = as_of or datetime.now(UTC)
        if current.tzinfo is None or current.utcoffset() is None:
            raise AgentGenerationCreditError("reconciliation time must be timezone-aware")
        cutoff = current - self._stale_generation_after
        async with self._database.session() as session:
            candidate_query = select(AgentGeneration.id, AgentGeneration.agent_account_id).where(
                AgentGeneration.status == GenerationStatus.PROCESSING.value,
                AgentGeneration.created_at < cutoff,
            )
            if account_id is not None:
                candidate_query = candidate_query.where(
                    AgentGeneration.agent_account_id == account_id
                )
            candidates = (
                await session.execute(
                    candidate_query.order_by(AgentGeneration.created_at, AgentGeneration.id).limit(
                        limit
                    )
                )
            ).all()

        reconciled = 0
        for generation_id, account_id in candidates:
            async with self._database.session() as session, session.begin():
                await _lock_account(session, account_id, require_active=False)
                generation = await session.scalar(
                    select(AgentGeneration)
                    .where(
                        AgentGeneration.id == generation_id,
                        AgentGeneration.agent_account_id == account_id,
                    )
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
                await self._generation_object_cleaner.cleanup_generation_objects(
                    account_id=account_id,
                    generation_id=generation_id,
                )
                release_identity = _derived_ledger_identity(generation_id, "release")
                if (
                    await _ledger_entry_for_identity(
                        session,
                        account_id=account_id,
                        idempotency_key_hash=release_identity,
                    )
                    is None
                ):
                    await self._insert_ledger_entry(
                        session,
                        account_id=account_id,
                        generation_id=generation_id,
                        credit_delta=_CREDIT_COST,
                        reason="generation_release",
                        actor_type="system",
                        actor_id="generation_credit",
                        idempotency_key_hash=release_identity,
                    )
                generation.status = GenerationStatus.FAILED.value
                generation.failure_code = "generation_timeout"
                generation.completed_at = current
                await session.flush()
                reconciled += 1
        return reconciled

    async def balance(self, *, account_id: str) -> CreditBalance:
        """Return the current signed ledger total without exposing request content."""

        _validate_account_id(account_id)
        async with self._database.session() as session:
            await _lock_account(session, account_id, require_active=False)
            return CreditBalance(account_id, await _balance_for_account(session, account_id))

    async def generation_result(self, *, account_id: str, generation_id: str) -> GenerationResult:
        """Read one content-free generation status for its owning account."""

        _validate_account_id(account_id)
        _validate_generation_id(generation_id)
        async with self._database.session() as session:
            generation = await _generation_for_id(session, account_id, generation_id)
            return _generation_result(
                generation,
                balance=await _balance_for_account(session, account_id),
            )

    async def _insert_generation(
        self,
        session: AsyncSession,
        *,
        account_id: str,
        api_key_id: str,
        idempotency_key_hash: str,
        request_fingerprint: str,
    ) -> str:
        for _ in range(self._id_insert_attempts):
            generation_id = self._new_public_id(PublicIdKind.GENERATION)
            try:
                async with session.begin_nested():
                    await session.execute(
                        insert(AgentGeneration).values(
                            id=generation_id,
                            agent_account_id=account_id,
                            api_key_id=api_key_id,
                            idempotency_key_hash=idempotency_key_hash,
                            request_fingerprint=request_fingerprint,
                            status=GenerationStatus.PROCESSING.value,
                        )
                    )
            except IntegrityError as error:
                if _is_primary_key_collision(error, "agent_generations"):
                    continue
                raise
            return generation_id
        raise PublicIdCollisionExhausted("could not allocate a unique generation ID")

    async def _insert_ledger_entry(
        self,
        session: AsyncSession,
        *,
        account_id: str,
        generation_id: str | None,
        credit_delta: int,
        reason: str,
        actor_type: str,
        actor_id: str,
        idempotency_key_hash: str,
    ) -> str:
        for _ in range(self._id_insert_attempts):
            ledger_id = self._new_public_id(PublicIdKind.LEDGER_ENTRY)
            try:
                async with session.begin_nested():
                    await session.execute(
                        insert(CreditLedgerEntry).values(
                            id=ledger_id,
                            agent_account_id=account_id,
                            generation_id=generation_id,
                            credit_delta=credit_delta,
                            reason=reason,
                            actor_type=actor_type,
                            actor_id=actor_id,
                            idempotency_key_hash=idempotency_key_hash,
                        )
                    )
            except IntegrityError as error:
                if _is_primary_key_collision(error, "credit_ledger_entries"):
                    continue
                raise
            return ledger_id
        raise PublicIdCollisionExhausted("could not allocate a unique ledger entry ID")

    async def _insert_generated_asset(
        self,
        session: AsyncSession,
        *,
        account_id: str,
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
                            agent_account_id=account_id,
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
                id=asset_id,
                agent_account_id=account_id,
                generation_id=generation_id,
                object_key=asset.object_key,
                content_type=asset.content_type,
                content_hash=asset.content_hash,
                expires_at=expires_at,
            )
        raise PublicIdCollisionExhausted("could not allocate a unique generated asset ID")

    def _new_public_id(self, kind: PublicIdKind) -> str:
        value = self._id_factory(kind)
        try:
            return parse_public_id(value, expected_kind=kind).value
        except PublicIdError as error:
            raise ValueError(f"id_factory returned an invalid {kind} ID") from error


def _default_public_id(kind: PublicIdKind) -> str:
    return create_public_id(kind).value


async def _lock_account(
    session: AsyncSession, account_id: str, *, require_active: bool
) -> AgentAccount:
    account = await session.scalar(
        select(AgentAccount).where(AgentAccount.id == account_id).with_for_update()
    )
    if account is None:
        raise AgentAccountNotFound("agent account not found")
    if require_active and account.status != "active":
        raise AgentAccountInactive("agent account is not active")
    return account


async def _require_active_api_key(
    session: AsyncSession, *, account_id: str, api_key_id: str
) -> None:
    key = await session.scalar(
        select(AgentApiKey).where(
            AgentApiKey.id == api_key_id,
            AgentApiKey.agent_account_id == account_id,
            AgentApiKey.status == "active",
        )
    )
    if key is None:
        raise AgentApiKeyNotActive("agent API key is not active")


async def _balance_for_account(session: AsyncSession, account_id: str) -> int:
    balance = await session.scalar(
        select(func.coalesce(func.sum(CreditLedgerEntry.credit_delta), 0)).where(
            CreditLedgerEntry.agent_account_id == account_id
        )
    )
    return int(balance or 0)


async def _generation_for_identity(
    session: AsyncSession, *, account_id: str, idempotency_key_hash: str
) -> AgentGeneration | None:
    return await session.scalar(
        select(AgentGeneration).where(
            AgentGeneration.agent_account_id == account_id,
            AgentGeneration.idempotency_key_hash == idempotency_key_hash,
        )
    )


async def _generation_for_id(
    session: AsyncSession, account_id: str, generation_id: str
) -> AgentGeneration:
    generation = await session.scalar(
        select(AgentGeneration).where(
            AgentGeneration.id == generation_id,
            AgentGeneration.agent_account_id == account_id,
        )
    )
    if generation is None:
        raise GenerationNotFound("generation not found")
    return generation


async def _ledger_entry_for_identity(
    session: AsyncSession, *, account_id: str, idempotency_key_hash: str
) -> CreditLedgerEntry | None:
    return await session.scalar(
        select(CreditLedgerEntry).where(
            CreditLedgerEntry.agent_account_id == account_id,
            CreditLedgerEntry.idempotency_key_hash == idempotency_key_hash,
        )
    )


def _generation_result(
    generation: AgentGeneration, *, balance: int, replayed: bool = False
) -> GenerationResult:
    return GenerationResult(
        id=generation.id,
        status=GenerationStatus(generation.status),
        failure_code=generation.failure_code,
        balance=CreditBalance(generation.agent_account_id, balance),
        replayed=replayed,
    )


def _hash_idempotency_key(value: str, *, namespace: str) -> str:
    if (
        not isinstance(value, str)
        or not value
        or len(value) > _IDEMPOTENCY_KEY_MAX_LENGTH
        or any(character.isspace() for character in value)
        or any(ord(character) < 32 or ord(character) == 127 for character in value)
    ):
        raise AgentGenerationCreditError("idempotency key must be 1 to 200 visible characters")
    return hashlib.sha256(f"memedrop:{namespace}:v1:{value}".encode()).hexdigest()


def _grant_actor_metadata(operator_actor_id: str | None) -> tuple[str, str]:
    if operator_actor_id is None:
        return "system", "credit_grant"
    if not isinstance(operator_actor_id, str) or not _OPERATOR_ACTOR_PATTERN.fullmatch(
        operator_actor_id
    ):
        raise AgentGenerationCreditError("operator actor must be a 1 to 120 character identifier")
    return "operator", operator_actor_id


def _derived_ledger_identity(generation_id: str, action: str) -> str:
    return hashlib.sha256(
        f"memedrop:generation-ledger:v1:{generation_id}:{action}".encode("ascii")
    ).hexdigest()


def _validate_account_id(account_id: str) -> None:
    _validate_public_id(account_id, PublicIdKind.AGENT_ACCOUNT, "agent account ID")


def _validate_api_key_id(api_key_id: str) -> None:
    _validate_public_id(api_key_id, PublicIdKind.API_KEY, "agent API key ID")


def _validate_generation_id(generation_id: str) -> None:
    _validate_public_id(generation_id, PublicIdKind.GENERATION, "generation ID")


def _validate_public_id(value: str, kind: PublicIdKind, label: str) -> None:
    try:
        parse_public_id(value, expected_kind=kind)
    except PublicIdError as error:
        raise AgentGenerationCreditError(f"invalid {label}") from error


def _validate_fingerprint(request_fingerprint: str) -> None:
    if not isinstance(request_fingerprint, str) or not _FINGERPRINT_PATTERN.fullmatch(
        request_fingerprint
    ):
        raise AgentGenerationCreditError("request fingerprint must be a SHA-256 hex digest")


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
    if returned_asset_count != 0:
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
    account_id: str, generation_id: str, assets: Sequence[GenerationAssetInput]
) -> None:
    if not 1 <= len(assets) <= _MAX_GENERATION_ASSETS:
        raise AgentGenerationCreditError(
            f"successful generations must include 1 to {_MAX_GENERATION_ASSETS} assets"
        )
    object_keys: set[str] = set()
    for asset in assets:
        if not isinstance(asset, GenerationAssetInput):
            raise AgentGenerationCreditError("generation asset is invalid")
        if (
            not asset.object_key.startswith(f"generated/agents/{account_id}/{generation_id}/")
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
    """Recognize only the compact-ID primary-key collision that may be retried."""

    original = error.orig
    diagnostic = getattr(original, "diag", None)
    constraint_name = getattr(diagnostic, "constraint_name", None)
    return constraint_name == f"{table_name}_pkey"
