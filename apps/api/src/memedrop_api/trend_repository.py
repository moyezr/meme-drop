from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import Any, cast
from uuid import UUID

from sqlalchemy import case, func, or_, select, text, tuple_, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.engine import CursorResult
from sqlalchemy.ext.asyncio import AsyncSession

from memedrop_api.db import (
    Database,
    TrendCardRecord,
    TrendObservationRecord,
    TrendSnapshotRecord,
)
from memedrop_api.trends import (
    TrendAssessment,
    TrendCard,
    TrendDuration,
    TrendEvidenceState,
    TrendLifecycle,
    TrendObservation,
    TrendSnapshot,
    assess_trend,
    trend_snapshot_fingerprint,
)

_SNAPSHOT_ADVISORY_LOCK = 7_164_364_771


@dataclass(frozen=True)
class ObservationWriteResult:
    observation_id: UUID
    changed: bool
    seen_count: int
    last_seen_at: datetime


@dataclass(frozen=True)
class TrendVectorMatch:
    card: TrendCard
    cosine_distance: float


@dataclass(frozen=True)
class CanonicalEnrichmentWrite:
    cards: tuple[TrendCard, ...]
    observations: tuple[ObservationWriteResult, ...]

    @property
    def observations_created(self) -> int:
        return sum(
            result.changed and result.seen_count == 1 for result in self.observations
        )


class SqlAlchemyTrendRepository:
    def __init__(self, database: Database) -> None:
        self.database = database

    async def upsert_card(
        self,
        card: TrendCard,
        *,
        embedding: Sequence[float] | None = None,
        embedding_model: str | None = None,
        embedding_fingerprint: str | None = None,
    ) -> TrendCard:
        _validate_embedding_metadata(
            embedding,
            model=embedding_model,
            fingerprint=embedding_fingerprint,
        )
        async with self.database.session() as session, session.begin():
            row = await self._upsert_card(
                session,
                card,
                embedding=embedding,
                embedding_model=embedding_model,
                embedding_fingerprint=embedding_fingerprint,
            )
        return _card_from_record(row)

    async def record_observation(
        self, observation: TrendObservation
    ) -> ObservationWriteResult:
        async with self.database.session() as session, session.begin():
            return await self._record_observation(session, observation)

    async def save_enrichment(
        self,
        *,
        cards: Sequence[TrendCard],
        observations: Sequence[TrendObservation],
    ) -> tuple[list[TrendCard], list[ObservationWriteResult]]:
        """Persist one normalized collector result atomically."""

        async with self.database.session() as session, session.begin():
            stored_cards = [await self._upsert_card(session, card) for card in cards]
            stored_observations = [
                await self._record_observation(session, observation)
                for observation in observations
            ]
        return (
            [_card_from_record(row) for row in stored_cards],
            stored_observations,
        )

    async def persist_canonical_enrichment(
        self,
        session: AsyncSession,
        *,
        cards: Sequence[TrendCard],
        observations: Sequence[TrendObservation],
        assessed_at: datetime,
    ) -> CanonicalEnrichmentWrite:
        """Merge one enrichment into durable evidence and reassess affected cards.

        Model-provided evidence counts and lifecycle fields are provisional. Durable rows are
        the authority for source diversity, observation counts, historical timestamps, and
        recurrence. The caller owns the transaction so claim completion can be committed with
        these writes atomically.
        """

        _validate_aware_time(assessed_at, field_name="assessed_at")
        card_by_id = {card.id: card for card in cards}
        if len(card_by_id) != len(cards):
            raise ValueError("enrichment cards must be unique")
        if len({observation.id for observation in observations}) != len(observations):
            raise ValueError("enrichment observations must be unique")
        if any(observation.observed_at > assessed_at for observation in observations):
            raise ValueError("observations cannot follow the assessment time")

        affected_ids = set(card_by_id)
        affected_ids.update(observation.trend_id for observation in observations)
        if not affected_ids:
            return CanonicalEnrichmentWrite(cards=(), observations=())

        locked_rows = (
            await session.scalars(
                select(TrendCardRecord)
                .where(TrendCardRecord.id.in_(affected_ids))
                .order_by(TrendCardRecord.id)
                .with_for_update()
            )
        ).all()
        existing_by_id = {row.id: row for row in locked_rows}
        missing_observation_cards = {
            observation.trend_id
            for observation in observations
            if observation.trend_id not in existing_by_id
            and observation.trend_id not in card_by_id
        }
        if missing_observation_cards:
            raise ValueError("observations must reference an existing or enriched trend card")

        observed_trend_ids = {observation.trend_id for observation in observations}
        missing_evidence = set(card_by_id) - set(existing_by_id) - observed_trend_ids
        if missing_evidence:
            raise ValueError("new trend cards require at least one durable observation")

        for trend_id in sorted(set(card_by_id) - set(existing_by_id), key=str):
            incoming = [
                observation
                for observation in observations
                if observation.trend_id == trend_id
            ]
            source_count = len({observation.source_domain for observation in incoming})
            first_seen_at = min(
                observation.published_at or observation.observed_at
                for observation in incoming
            )
            last_confirmed_at = max(observation.observed_at for observation in incoming)
            candidate = card_by_id[trend_id]
            state = TrendEvidenceState(
                first_seen_at=first_seen_at,
                last_confirmed_at=last_confirmed_at,
                confidence=candidate.confidence,
                momentum=candidate.momentum,
                source_count=source_count,
                observation_count=len(incoming),
                recurrence_count=0,
            )
            assessment = assess_trend(state, as_of=assessed_at)
            canonical_new = _reassessed_card(candidate, state, assessment)
            row = await self._upsert_card(session, canonical_new)
            card_by_id[trend_id] = canonical_new
            existing_by_id[trend_id] = row

        observation_results: list[ObservationWriteResult] = []
        changed_observed_at: dict[UUID, datetime] = {}
        for observation in sorted(observations, key=lambda item: str(item.id)):
            result = await self._record_observation(session, observation)
            observation_results.append(result)
            if result.changed:
                previous = changed_observed_at.get(observation.trend_id)
                if previous is None or observation.observed_at > previous:
                    changed_observed_at[observation.trend_id] = observation.observed_at

        stored_cards: list[TrendCard] = []
        originally_existing_ids = {row.id for row in locked_rows}
        for trend_id in sorted(affected_ids, key=str):
            current_row = existing_by_id[trend_id]
            base_card = card_by_id.get(trend_id, _card_from_record(current_row))
            evidence = (
                await session.execute(
                    select(
                        func.count(TrendObservationRecord.id),
                        func.count(func.distinct(TrendObservationRecord.source_domain)),
                        func.min(TrendObservationRecord.first_seen_at),
                        func.min(TrendObservationRecord.published_at),
                        func.max(TrendObservationRecord.last_seen_at),
                    ).where(TrendObservationRecord.trend_id == trend_id)
                )
            ).one()
            observation_count = int(evidence[0] or 0)
            source_count = int(evidence[1] or 0)
            if observation_count < 1 or source_count < 1 or evidence[2] is None:
                raise RuntimeError("trend card has no durable evidence")

            first_seen_candidates = [evidence[2]]
            if evidence[3] is not None:
                first_seen_candidates.append(evidence[3])
            if trend_id in originally_existing_ids:
                first_seen_candidates.append(current_row.first_seen_at)
            first_seen_at = min(first_seen_candidates)
            last_confirmed_at = evidence[4]
            if trend_id in originally_existing_ids:
                last_confirmed_at = max(
                    last_confirmed_at,
                    current_row.last_confirmed_at,
                )
            if last_confirmed_at > assessed_at:
                raise ValueError("durable evidence cannot follow the assessment time")

            recurrence_count = (
                current_row.recurrence_count if trend_id in originally_existing_ids else 0
            )
            latest_change = changed_observed_at.get(trend_id)
            if (
                trend_id in originally_existing_ids
                and latest_change is not None
                and latest_change > current_row.expires_at
            ):
                recurrence_count += 1

            state = TrendEvidenceState(
                first_seen_at=first_seen_at,
                last_confirmed_at=last_confirmed_at,
                confidence=base_card.confidence,
                momentum=base_card.momentum,
                source_count=source_count,
                observation_count=observation_count,
                recurrence_count=recurrence_count,
            )
            assessment = assess_trend(state, as_of=assessed_at)
            canonical = _reassessed_card(
                base_card,
                state,
                assessment,
                version=current_row.version,
            )
            stored = await self._upsert_card(session, canonical)
            existing_by_id[trend_id] = stored
            stored_cards.append(_card_from_record(stored))

        return CanonicalEnrichmentWrite(
            cards=tuple(stored_cards),
            observations=tuple(observation_results),
        )

    async def list_active_cards(
        self, *, as_of: datetime, limit: int = 500
    ) -> list[TrendCard]:
        _validate_aware_time(as_of, field_name="as_of")
        _validate_limit(limit, maximum=1_000)
        statement = (
            select(TrendCardRecord)
            .where(
                TrendCardRecord.lifecycle != "dormant",
                TrendCardRecord.expires_at > as_of,
            )
            .order_by(
                TrendCardRecord.vitality.desc(),
                TrendCardRecord.last_confirmed_at.desc(),
                TrendCardRecord.id,
            )
            .limit(limit)
        )
        async with self.database.session() as session:
            rows = (await session.scalars(statement)).all()
        return [_card_from_record(row) for row in rows]

    async def list_stale_embedding_ids(
        self,
        fingerprints: Mapping[UUID, str],
        *,
        model: str,
    ) -> set[UUID]:
        """Return addressed cards missing the exact requested semantic vector."""

        if not fingerprints:
            return set()
        card_ids = list(fingerprints)
        if len(card_ids) > 1_000:
            raise ValueError("embedding candidate list is limited to 1000 cards")
        _validate_embedding_model(model)
        for fingerprint in fingerprints.values():
            _validate_embedding_fingerprint(fingerprint)
        statement = select(
            TrendCardRecord.id,
            TrendCardRecord.embedding.is_(None),
            TrendCardRecord.embedding_model,
            TrendCardRecord.embedding_fingerprint,
        ).where(
            TrendCardRecord.id.in_(card_ids),
        )
        async with self.database.session() as session:
            rows = (await session.execute(statement)).all()
        return {
            card_id
            for card_id, missing, stored_model, stored_fingerprint in rows
            if _embedding_is_stale(
                missing=missing,
                stored_model=stored_model,
                stored_fingerprint=stored_fingerprint,
                required_model=model,
                required_fingerprint=fingerprints[card_id],
            )
        }

    async def store_card_embeddings(
        self,
        embeddings: Sequence[tuple[UUID, Sequence[float], str, int]],
        *,
        model: str,
    ) -> int:
        """Persist validated vectors without changing semantic card versions."""

        if not embeddings:
            return 0
        _validate_embedding_model(model)
        card_ids = [card_id for card_id, _, _, _ in embeddings]
        if len(card_ids) > 1_000:
            raise ValueError("embedding write is limited to 1000 cards")
        if len(set(card_ids)) != len(card_ids):
            raise ValueError("embedding writes must have unique card IDs")
        for _, embedding, fingerprint, expected_version in embeddings:
            _validate_embedding(embedding, required=True)
            _validate_embedding_fingerprint(fingerprint)
            if expected_version < 1:
                raise ValueError("expected card version must be positive")

        stored = 0
        async with self.database.session() as session, session.begin():
            for card_id, embedding, fingerprint, expected_version in embeddings:
                result = cast(
                    CursorResult[Any],
                    await session.execute(
                        _store_card_embedding_statement(
                            card_id=card_id,
                            embedding=embedding,
                            model=model,
                            fingerprint=fingerprint,
                            expected_version=expected_version,
                        )
                    ),
                )
                stored += result.rowcount
        return stored

    async def search_active_by_embedding(
        self,
        embedding: Sequence[float],
        *,
        model: str,
        eligible_card_versions: Mapping[UUID, int],
        as_of: datetime,
        limit: int = 20,
    ) -> list[TrendVectorMatch]:
        """Bounded semantic candidate retrieval; callers still apply lifecycle reranking."""

        _validate_aware_time(as_of, field_name="as_of")
        _validate_embedding(embedding, required=True)
        _validate_embedding_model(model)
        _validate_limit(limit, maximum=100)
        if not eligible_card_versions:
            return []
        if len(eligible_card_versions) > 500:
            raise ValueError("semantic retrieval is limited to 500 published cards")
        if any(version < 1 for version in eligible_card_versions.values()):
            raise ValueError("published semantic candidate versions must be positive")
        vector = list(embedding)
        distance = TrendCardRecord.embedding.cosine_distance(vector).label("cosine_distance")
        statement = (
            select(TrendCardRecord, distance)
            .where(
                TrendCardRecord.embedding.is_not(None),
                TrendCardRecord.embedding_model == model,
                tuple_(TrendCardRecord.id, TrendCardRecord.version).in_(
                    tuple(eligible_card_versions.items())
                ),
                TrendCardRecord.lifecycle != "dormant",
                TrendCardRecord.expires_at > as_of,
            )
            .order_by(distance, TrendCardRecord.id)
            .limit(limit)
        )
        async with self.database.session() as session:
            rows = (await session.execute(statement)).all()
        return [
            TrendVectorMatch(card=_card_from_record(row), cosine_distance=float(score))
            for row, score in rows
        ]

    async def publish_snapshot(
        self,
        cards: Sequence[TrendCard],
        *,
        created_at: datetime,
    ) -> TrendSnapshot:
        """Create and publish a snapshot without an external serving-index handoff."""

        snapshot = await self.stage_snapshot(cards, created_at=created_at)
        return await self.mark_snapshot_published(
            snapshot.version,
            published_at=created_at,
        )

    async def stage_snapshot(
        self,
        cards: Sequence[TrendCard],
        *,
        created_at: datetime,
    ) -> TrendSnapshot:
        """Create or reuse an immutable snapshot without marking it served."""

        _validate_aware_time(created_at, field_name="created_at")
        ordered_cards = tuple(sorted(cards, key=lambda card: str(card.id)))
        fingerprint = trend_snapshot_fingerprint(ordered_cards)
        async with self.database.session() as session, session.begin():
            await session.execute(
                text("SELECT pg_advisory_xact_lock(:lock_key)"),
                {"lock_key": _SNAPSHOT_ADVISORY_LOCK},
            )
            existing = await session.scalar(
                select(TrendSnapshotRecord).where(
                    TrendSnapshotRecord.fingerprint == fingerprint
                )
            )
            if existing is not None:
                return _snapshot_from_record(existing)
            version = int(
                await session.scalar(
                    select(func.coalesce(func.max(TrendSnapshotRecord.version), 0))
                )
                or 0
            ) + 1
            snapshot = TrendSnapshot.create(
                version=version,
                cards=ordered_cards,
                created_at=created_at,
            )
            row = TrendSnapshotRecord(
                version=snapshot.version,
                schema_version=snapshot.schema_version,
                fingerprint=snapshot.fingerprint,
                card_count=len(snapshot.cards),
                cards=[card.model_dump(mode="json") for card in snapshot.cards],
                created_at=snapshot.created_at,
                published_at=snapshot.published_at,
            )
            session.add(row)
            await session.flush()
            return snapshot

    async def mark_snapshot_published(
        self,
        version: int,
        *,
        published_at: datetime,
    ) -> TrendSnapshot:
        """Publish a staged snapshot after its external serving pointer has switched."""

        if version < 1:
            raise ValueError("version must be positive")
        _validate_aware_time(published_at, field_name="published_at")
        async with self.database.session() as session, session.begin():
            row = await session.scalar(
                select(TrendSnapshotRecord)
                .where(TrendSnapshotRecord.version == version)
                .with_for_update()
            )
            if row is None:
                raise ValueError("trend snapshot does not exist")
            if row.published_at is None:
                if published_at < row.created_at:
                    raise ValueError("published_at must not precede snapshot creation")
                row.published_at = published_at
                await session.flush()
            return _snapshot_from_record(row)

    async def get_snapshot(self, version: int | None = None) -> TrendSnapshot | None:
        statement = select(TrendSnapshotRecord).where(
            TrendSnapshotRecord.published_at.is_not(None)
        )
        if version is None:
            statement = statement.order_by(TrendSnapshotRecord.version.desc()).limit(1)
        else:
            if version < 1:
                raise ValueError("version must be positive")
            statement = statement.where(TrendSnapshotRecord.version == version)
        async with self.database.session() as session:
            row = await session.scalar(statement)
        return _snapshot_from_record(row) if row is not None else None

    async def _upsert_card(
        self,
        session: AsyncSession,
        card: TrendCard,
        *,
        embedding: Sequence[float] | None = None,
        embedding_model: str | None = None,
        embedding_fingerprint: str | None = None,
    ) -> TrendCardRecord:
        values = _card_values(card)
        values["embedding"] = list(embedding) if embedding is not None else None
        values["embedding_model"] = embedding_model
        values["embedding_fingerprint"] = embedding_fingerprint
        insert_statement = insert(TrendCardRecord).values(**values)
        excluded = insert_statement.excluded
        updated_values = {
            field: getattr(excluded, field)
            for field in (
                "name",
                "premise",
                "aliases",
                "entities",
                "topics",
                "communities",
                "recognition_cues",
                "comic_tensions",
                "usage_guidance",
                "avoid_guidance",
                "lifecycle",
                "duration_class",
                "first_seen_at",
                "last_confirmed_at",
                "expires_at",
                "confidence",
                "momentum",
                "vitality",
                "source_count",
                "observation_count",
                "recurrence_count",
            )
        }
        semantic_change_conditions = [
            getattr(TrendCardRecord, field).is_distinct_from(getattr(excluded, field))
            for field in (
                "name",
                "premise",
                "aliases",
                "entities",
                "topics",
                "communities",
                "recognition_cues",
                "comic_tensions",
                "usage_guidance",
                "avoid_guidance",
            )
        ]
        if embedding is not None:
            updated_values["embedding"] = excluded.embedding
            updated_values["embedding_model"] = excluded.embedding_model
            updated_values["embedding_fingerprint"] = excluded.embedding_fingerprint
        else:
            updated_values["embedding"] = case(
                (or_(*semantic_change_conditions), None),
                else_=TrendCardRecord.embedding,
            )
            updated_values["embedding_model"] = case(
                (or_(*semantic_change_conditions), None),
                else_=TrendCardRecord.embedding_model,
            )
            updated_values["embedding_fingerprint"] = case(
                (or_(*semantic_change_conditions), None),
                else_=TrendCardRecord.embedding_fingerprint,
            )
        updated_values["version"] = TrendCardRecord.version + 1
        updated_values["updated_at"] = func.now()
        change_conditions = [
            getattr(TrendCardRecord, field).is_distinct_from(getattr(excluded, field))
            for field in updated_values
            if field
            not in {
                "version",
                "updated_at",
                "embedding",
                "embedding_model",
                "embedding_fingerprint",
            }
        ]
        if embedding is not None:
            change_conditions.extend(
                (
                    TrendCardRecord.embedding.is_(None),
                    TrendCardRecord.embedding_model.is_distinct_from(embedding_model),
                    TrendCardRecord.embedding_fingerprint.is_distinct_from(
                        embedding_fingerprint
                    ),
                )
            )
        upsert_statement = insert_statement.on_conflict_do_update(
            index_elements=[TrendCardRecord.id],
            set_=updated_values,
            where=or_(*change_conditions),
        ).returning(TrendCardRecord)
        row = (await session.scalars(upsert_statement)).one_or_none()
        if row is None:
            row = await session.get(TrendCardRecord, card.id)
        if row is None:  # pragma: no cover - defensive against an impossible concurrent delete
            raise RuntimeError("trend card disappeared during upsert")
        return row

    async def _record_observation(
        self,
        session: AsyncSession,
        observation: TrendObservation,
    ) -> ObservationWriteResult:
        insert_statement = insert(TrendObservationRecord).values(
            id=observation.id,
            trend_id=observation.trend_id,
            observation_key=observation.observation_key,
            provider=observation.provider,
            source_url=observation.source_url,
            source_url_hash=observation.source_url_hash,
            source_domain=observation.source_domain,
            content_hash=observation.content_hash,
            published_at=observation.published_at,
            first_seen_at=observation.observed_at,
            last_seen_at=observation.observed_at,
            seen_count=1,
            provider_score=observation.provider_score,
            provider_result_id=observation.provider_result_id,
            query_fingerprint=observation.query_fingerprint,
        )
        excluded = insert_statement.excluded
        upsert_statement = insert_statement.on_conflict_do_update(
            constraint="uq_trend_observations_trend_key",
            set_={
                "source_url": excluded.source_url,
                "source_url_hash": excluded.source_url_hash,
                "source_domain": excluded.source_domain,
                "content_hash": excluded.content_hash,
                "published_at": func.coalesce(
                    TrendObservationRecord.published_at, excluded.published_at
                ),
                "last_seen_at": excluded.last_seen_at,
                "seen_count": TrendObservationRecord.seen_count + 1,
                "provider_score": excluded.provider_score,
                "provider_result_id": excluded.provider_result_id,
                "query_fingerprint": excluded.query_fingerprint,
            },
            where=excluded.last_seen_at > TrendObservationRecord.last_seen_at,
        ).returning(TrendObservationRecord)
        row = (await session.scalars(upsert_statement)).one_or_none()
        changed = row is not None
        if row is None:
            row = await session.get(TrendObservationRecord, observation.id)
        if row is None:  # pragma: no cover - defensive against an impossible concurrent delete
            raise RuntimeError("trend observation disappeared during upsert")
        return ObservationWriteResult(
            observation_id=row.id,
            changed=changed,
            seen_count=row.seen_count,
            last_seen_at=row.last_seen_at,
        )


def _card_values(card: TrendCard) -> dict[str, object]:
    return {
        "id": card.id,
        "key": card.key,
        "name": card.name,
        "premise": card.premise,
        "aliases": list(card.aliases),
        "entities": list(card.entities),
        "topics": list(card.topics),
        "communities": list(card.communities),
        "recognition_cues": list(card.recognition_cues),
        "comic_tensions": list(card.comic_tensions),
        "usage_guidance": card.usage_guidance,
        "avoid_guidance": list(card.avoid_guidance),
        "lifecycle": card.lifecycle.value,
        "duration_class": card.duration_class.value,
        "first_seen_at": card.first_seen_at,
        "last_confirmed_at": card.last_confirmed_at,
        "expires_at": card.expires_at,
        "confidence": card.confidence,
        "momentum": card.momentum,
        "vitality": card.vitality,
        "source_count": card.source_count,
        "observation_count": card.observation_count,
        "recurrence_count": card.recurrence_count,
        "version": card.version,
    }


def _reassessed_card(
    card: TrendCard,
    state: TrendEvidenceState,
    assessment: TrendAssessment,
    *,
    version: int = 1,
) -> TrendCard:
    values = card.model_dump()
    values.update(
        {
            "first_seen_at": state.first_seen_at,
            "last_confirmed_at": state.last_confirmed_at,
            "expires_at": assessment.expires_at,
            "confidence": state.confidence,
            "momentum": state.momentum,
            "source_count": state.source_count,
            "observation_count": state.observation_count,
            "recurrence_count": state.recurrence_count,
            "lifecycle": assessment.lifecycle,
            "duration_class": assessment.duration_class,
            "vitality": assessment.vitality,
            "version": version,
        }
    )
    return TrendCard.model_validate(values)


def _card_from_record(row: TrendCardRecord) -> TrendCard:
    return TrendCard(
        id=row.id,
        key=row.key,
        name=row.name,
        premise=row.premise,
        aliases=tuple(row.aliases),
        entities=tuple(row.entities),
        topics=tuple(row.topics),
        communities=tuple(row.communities),
        recognition_cues=tuple(row.recognition_cues),
        comic_tensions=tuple(row.comic_tensions),
        usage_guidance=row.usage_guidance,
        avoid_guidance=tuple(row.avoid_guidance),
        lifecycle=TrendLifecycle(row.lifecycle),
        duration_class=TrendDuration(row.duration_class),
        first_seen_at=row.first_seen_at,
        last_confirmed_at=row.last_confirmed_at,
        expires_at=row.expires_at,
        confidence=row.confidence,
        momentum=row.momentum,
        vitality=row.vitality,
        source_count=row.source_count,
        observation_count=row.observation_count,
        recurrence_count=row.recurrence_count,
        version=row.version,
    )


def _snapshot_from_record(row: TrendSnapshotRecord) -> TrendSnapshot:
    return TrendSnapshot(
        version=row.version,
        schema_version=row.schema_version,
        fingerprint=row.fingerprint,
        cards=tuple(TrendCard.model_validate(card) for card in row.cards),
        created_at=row.created_at,
        published_at=row.published_at,
    )


def _validate_embedding(
    embedding: Sequence[float] | None, *, required: bool = False
) -> None:
    if embedding is None:
        if required:
            raise ValueError("embedding is required")
        return
    if len(embedding) != 1_536:
        raise ValueError("trend embeddings must contain exactly 1536 values")
    if not all(math.isfinite(value) for value in embedding):
        raise ValueError("trend embeddings must contain only finite values")


def _validate_embedding_metadata(
    embedding: Sequence[float] | None,
    *,
    model: str | None,
    fingerprint: str | None,
) -> None:
    _validate_embedding(embedding)
    if embedding is None:
        if model is not None or fingerprint is not None:
            raise ValueError("embedding metadata requires an embedding")
        return
    if model is None or fingerprint is None:
        raise ValueError("embedding model and fingerprint are required")
    _validate_embedding_model(model)
    _validate_embedding_fingerprint(fingerprint)


def _validate_embedding_model(model: str) -> None:
    if not model or model != model.strip() or len(model) > 120:
        raise ValueError("embedding model must be 1 to 120 trimmed characters")


def _validate_embedding_fingerprint(fingerprint: str) -> None:
    if len(fingerprint) != 64 or any(
        character not in "0123456789abcdef" for character in fingerprint
    ):
        raise ValueError("embedding fingerprint must be a lowercase SHA-256 digest")


def _embedding_is_stale(
    *,
    missing: bool,
    stored_model: str | None,
    stored_fingerprint: str | None,
    required_model: str,
    required_fingerprint: str,
) -> bool:
    return (
        missing
        or stored_model != required_model
        or stored_fingerprint != required_fingerprint
    )


def _store_card_embedding_statement(
    *,
    card_id: UUID,
    embedding: Sequence[float],
    model: str,
    fingerprint: str,
    expected_version: int,
):
    """Build a compare-and-set write that rejects stale semantic documents."""

    return (
        update(TrendCardRecord)
        .where(
            TrendCardRecord.id == card_id,
            TrendCardRecord.version == expected_version,
            or_(
                TrendCardRecord.embedding.is_(None),
                TrendCardRecord.embedding_model.is_distinct_from(model),
                TrendCardRecord.embedding_fingerprint.is_distinct_from(fingerprint),
            ),
        )
        .values(
            embedding=list(embedding),
            embedding_model=model,
            embedding_fingerprint=fingerprint,
            updated_at=func.now(),
        )
    )


def _validate_aware_time(value: datetime, *, field_name: str) -> None:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field_name} must be timezone-aware")


def _validate_limit(value: int, *, maximum: int) -> None:
    if value < 1 or value > maximum:
        raise ValueError(f"limit must be between 1 and {maximum}")
