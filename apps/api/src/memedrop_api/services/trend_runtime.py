from __future__ import annotations

import asyncio
import re
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from urllib.parse import urlparse

from memedrop_api.config import Settings
from memedrop_api.db import Database
from memedrop_api.services.tavily_trends import (
    TavilyCollectionError,
    TavilyCollectorConfig,
    TavilyTrendCollector,
    TavilyUsage,
    TrendCollectionReport,
    TrendSearchQuery,
    TrendSearchTopic,
)
from memedrop_api.services.trend_enricher import OpenRouterTrendEnricher
from memedrop_api.services.trend_index import RedisTrendIndex, TrendIndexDocument
from memedrop_api.trend_collection_store import SqlAlchemyTrendCollectionStore
from memedrop_api.trend_repository import SqlAlchemyTrendRepository
from memedrop_api.trends import TrendCard, TrendSnapshot

_TOKEN = re.compile(r"[a-z0-9][a-z0-9'’-]{2,47}", re.IGNORECASE)
_STOP_WORDS = frozenset(
    {
        "and",
        "are",
        "but",
        "for",
        "from",
        "has",
        "have",
        "into",
        "not",
        "that",
        "the",
        "their",
        "then",
        "this",
        "was",
        "were",
        "with",
    }
)
_MONTHLY_HOURS = 30 * 24
_MAX_INDEX_TERMS = 8
_MAX_INDEX_ENTITIES = 4
_MAX_INDEX_CATEGORIES = 6
_MAX_INDEX_MECHANICS = 4

Sleep = Callable[[float], Awaitable[None]]


class TrendRefreshConfigurationError(RuntimeError):
    """Raised before a scheduled refresh can consume provider credits."""


class TrendRefreshFailed(RuntimeError):
    """Raised when a refresh has no successful provider query to safely publish."""


@dataclass(frozen=True, slots=True)
class TrendQueryProfile:
    name: str
    cadence: timedelta
    queries: tuple[TrendSearchQuery, ...]

    @property
    def estimated_monthly_credits(self) -> float:
        cadence_hours = self.cadence.total_seconds() / 3_600
        return len(self.queries) * _MONTHLY_HOURS / cadence_hours


@dataclass(frozen=True, slots=True)
class ProfileRefreshReport:
    profile: str
    scan_id: str
    collection: TrendCollectionReport


@dataclass(frozen=True, slots=True)
class TrendRefreshReport:
    profiles: tuple[ProfileRefreshReport, ...]
    active_cards: int
    snapshot_version: int
    index_version: str
    tavily_usage: TavilyUsage

    def as_json(self) -> dict[str, Any]:
        return {
            "profiles": [
                {
                    "profile": item.profile,
                    "scan_id": item.scan_id,
                    **asdict(item.collection),
                }
                for item in self.profiles
            ],
            "active_cards": self.active_cards,
            "snapshot_version": self.snapshot_version,
            "index_version": self.index_version,
            "tavily_usage": asdict(self.tavily_usage),
        }


TREND_QUERY_PROFILES = (
    TrendQueryProfile(
        name="pulse",
        cadence=timedelta(hours=4),
        queries=(
            TrendSearchQuery(
                key="pulse.internet",
                text="viral internet moments memes social media today",
            ),
            TrendSearchQuery(
                key="pulse.reactions",
                text="trending reactions catchphrases social media today",
            ),
            TrendSearchQuery(
                key="pulse.tech-work",
                text="technology workplace culture viral discussion today",
            ),
        ),
    ),
    TrendQueryProfile(
        name="daily",
        cadence=timedelta(days=1),
        queries=(
            TrendSearchQuery(
                key="daily.memes",
                text="internet culture meme formats trending this week",
                time_range="week",
                topic="general",
            ),
            TrendSearchQuery(
                key="daily.entertainment",
                text="entertainment moments viral reactions this week",
                time_range="week",
            ),
            TrendSearchQuery(
                key="daily.sports",
                text="sports moments viral reactions this week",
                time_range="week",
            ),
            TrendSearchQuery(
                key="daily.ai-tech",
                text="technology AI startup discourse trending this week",
                time_range="week",
            ),
            TrendSearchQuery(
                key="daily.workplace",
                text="workplace corporate culture viral jokes this week",
                time_range="week",
                topic="general",
            ),
            TrendSearchQuery(
                key="daily.creators",
                text="gaming creator communities viral moments this week",
                time_range="week",
                topic="general",
            ),
        ),
    ),
    TrendQueryProfile(
        name="weekly",
        cadence=timedelta(days=7),
        queries=tuple(
            TrendSearchQuery(
                key=f"weekly.{key}",
                text=text,
                time_range="month",
                topic=cast(TrendSearchTopic, topic),
            )
            for key, text, topic in (
                (
                    "culture",
                    "internet culture references gaining recognition this month",
                    "general",
                ),
                ("music", "music moments driving viral social reactions this month", "news"),
                ("film-tv", "film television moments driving viral reactions this month", "news"),
                ("sports", "sports storylines driving internet reactions this month", "news"),
                ("gaming", "gaming community moments becoming mainstream this month", "general"),
                (
                    "technology",
                    "technology product moments driving online reactions this month",
                    "news",
                ),
                ("ai", "artificial intelligence discourse viral moments this month", "news"),
                ("work", "workplace culture phrases spreading online this month", "general"),
                ("brands", "consumer brand moments driving online reactions this month", "news"),
                (
                    "creators",
                    "creator economy moments becoming viral references this month",
                    "general",
                ),
                (
                    "science-design",
                    "science and design moments becoming cultural references this month",
                    "general",
                ),
                ("recurring", "recurring seasonal internet jokes returning this month", "general"),
            )
        ),
    ),
)


def scheduled_monthly_credit_estimate(
    profiles: Sequence[TrendQueryProfile] = TREND_QUERY_PROFILES,
) -> float:
    """Estimate one-credit basic searches, excluding retries covered by the hard ceiling."""

    return sum(profile.estimated_monthly_credits for profile in profiles)


def resolve_trend_profiles(names: Sequence[str] | None) -> tuple[TrendQueryProfile, ...]:
    if not names:
        return TREND_QUERY_PROFILES
    by_name = {profile.name: profile for profile in TREND_QUERY_PROFILES}
    unknown = sorted(set(names) - by_name.keys())
    if unknown:
        raise TrendRefreshConfigurationError(f"unknown trend profile(s): {', '.join(unknown)}")
    return tuple(by_name[name] for name in dict.fromkeys(names))


def trend_scan_id(profile: TrendQueryProfile, *, at: datetime) -> str:
    if at.tzinfo is None or at.utcoffset() is None:
        raise ValueError("trend scan time must be timezone-aware")
    current = at.astimezone(UTC)
    bucket_seconds = int(profile.cadence.total_seconds())
    bucket_start = datetime.fromtimestamp(
        int(current.timestamp()) // bucket_seconds * bucket_seconds,
        tz=UTC,
    )
    return f"trend-{profile.name}-{bucket_start.strftime('%Y%m%dT%H%M%SZ')}"


def trend_index_document(card: TrendCard) -> TrendIndexDocument:
    """Project a card into exact fields plus token terms that request signals can match."""

    token_sources = (
        *card.entities,
        *card.recognition_cues,
        *card.aliases,
        card.name,
    )
    terms = _normalized_tokens(token_sources, limit=_MAX_INDEX_TERMS)
    categories = _unique_values((*card.topics, *card.communities), limit=_MAX_INDEX_CATEGORIES)
    return TrendIndexDocument(
        card=card,
        terms=terms,
        entities=_unique_values(card.entities, limit=_MAX_INDEX_ENTITIES),
        categories=categories,
        humor_mechanics=_unique_values(card.comic_tensions, limit=_MAX_INDEX_MECHANICS),
    )


def serving_trend_cards(cards: Sequence[TrendCard]) -> tuple[TrendCard, ...]:
    """Keep weak single-source evidence durable but out of caption-serving snapshots."""

    return tuple(
        card
        for card in cards
        if card.source_count >= 2
        and card.observation_count >= 2
        and card.confidence >= 0.55
    )


async def publish_serving_snapshot(
    repository: SqlAlchemyTrendRepository,
    index: RedisTrendIndex,
    cards: Sequence[TrendCard],
    *,
    published_at: datetime,
) -> TrendSnapshot:
    """Switch the Redis serving pointer before exposing the snapshot as published in SQL."""

    snapshot = await repository.stage_snapshot(cards, created_at=published_at)
    await index.publish(
        f"snapshot-v{snapshot.version}",
        [trend_index_document(card) for card in snapshot.cards],
    )
    return await repository.mark_snapshot_published(
        snapshot.version,
        published_at=published_at,
    )


def validate_trend_refresh_settings(settings: Settings) -> None:
    missing: list[str] = []
    if not settings.trends_enabled:
        missing.append("MEMEDROP_TRENDS_ENABLED=true")
    if not settings.tavily_api_key:
        missing.append("TAVILY_API_KEY")
    if not settings.openrouter_api_key:
        missing.append("OPENROUTER_API_KEY")
    endpoint = urlparse(settings.redis_url or "")
    if endpoint.scheme not in {"redis", "rediss"} or not endpoint.hostname:
        missing.append("REDIS_URL=redis://... or rediss://...")
    if missing:
        raise TrendRefreshConfigurationError(
            "trend refresh is not configured; set " + ", ".join(missing)
        )


async def refresh_trends(
    settings: Settings,
    *,
    profile_names: Sequence[str] | None = None,
    at: datetime | None = None,
    sleep: Sleep = asyncio.sleep,
) -> TrendRefreshReport:
    """Run one idempotent scheduled collection and publish a complete serving index."""

    validate_trend_refresh_settings(settings)
    profiles = resolve_trend_profiles(profile_names)
    observed_at = (at or datetime.now(UTC)).astimezone(UTC)
    database = Database(settings.database_url)
    store = SqlAlchemyTrendCollectionStore(database)
    repository = SqlAlchemyTrendRepository(database)
    enricher = OpenRouterTrendEnricher(
        api_key=settings.openrouter_api_key or "",
        model=settings.openrouter_trend_model,
        timeout_seconds=settings.trend_enrichment_timeout_seconds,
        site_url=settings.openrouter_site_url,
        app_name=settings.openrouter_app_name,
    )
    collector = TavilyTrendCollector(
        api_key=settings.tavily_api_key or "",
        store=store,
        enricher=enricher,
        config=TavilyCollectorConfig(
            monthly_credit_budget=settings.trend_monthly_credit_budget,
            max_queries_per_scan=max(len(profile.queries) for profile in profiles),
            request_timeout_seconds=settings.trend_collection_timeout_seconds,
            cooldown_seconds=settings.trend_collection_cooldown_seconds,
        ),
    )
    index = RedisTrendIndex(settings.redis_url or "")
    reports: list[ProfileRefreshReport] = []
    try:
        try:
            tavily_usage = await collector.preflight()
        except TavilyCollectionError as error:
            raise TrendRefreshConfigurationError(
                f"Tavily usage preflight failed ({error.category})"
            ) from None
        for position, profile in enumerate(profiles):
            scan_id = trend_scan_id(profile, at=observed_at)
            collection = await collector.collect(scan_id=scan_id, queries=profile.queries)
            reports.append(
                ProfileRefreshReport(
                    profile=profile.name,
                    scan_id=scan_id,
                    collection=collection,
                )
            )
            if position < len(profiles) - 1 and settings.trend_collection_cooldown_seconds:
                await sleep(settings.trend_collection_cooldown_seconds)

        if _all_claimed_queries_failed(reports):
            categories = _failure_categories(reports)
            category_text = ", ".join(categories) or "unknown"
            raise TrendRefreshFailed(
                "trend refresh had no successful provider queries; preserving the last "
                f"published snapshot ({category_text})"
            )

        active_cards = serving_trend_cards(
            await repository.list_active_cards(as_of=observed_at, limit=500)
        )
        snapshot = await publish_serving_snapshot(
            repository,
            index,
            active_cards,
            published_at=observed_at,
        )
        index_version = f"snapshot-v{snapshot.version}"
        return TrendRefreshReport(
            profiles=tuple(reports),
            active_cards=len(snapshot.cards),
            snapshot_version=snapshot.version,
            index_version=index_version,
            tavily_usage=tavily_usage,
        )
    finally:
        await collector.close()
        await enricher.close()
        await index.close()
        await database.close()


def _all_claimed_queries_failed(reports: Sequence[ProfileRefreshReport]) -> bool:
    collections = tuple(item.collection for item in reports)
    return (
        bool(collections)
        and sum(item.claimed_queries for item in collections) > 0
        and sum(item.completed_queries for item in collections) == 0
        and sum(item.failed_queries for item in collections) > 0
    )


def _failure_categories(reports: Sequence[ProfileRefreshReport]) -> tuple[str, ...]:
    return tuple(
        sorted(
            {
                category
                for report in reports
                for category, count in report.collection.failure_categories.items()
                if count > 0
            }
        )
    )


def _normalized_tokens(values: Sequence[str], *, limit: int) -> tuple[str, ...]:
    tokens: list[str] = []
    seen: set[str] = set()
    for value in values:
        for match in _TOKEN.findall(value):
            token = match.casefold()
            if token in _STOP_WORDS or token in seen:
                continue
            seen.add(token)
            tokens.append(token)
            if len(tokens) == limit:
                return tuple(tokens)
    return tuple(tokens)


def _unique_values(values: Sequence[str], *, limit: int) -> tuple[str, ...]:
    output: list[str] = []
    seen: set[str] = set()
    for value in values:
        normalized = " ".join(value.strip().split())
        identity = normalized.casefold()
        if not normalized or identity in seen:
            continue
        seen.add(identity)
        output.append(normalized)
        if len(output) == limit:
            break
    return tuple(output)
