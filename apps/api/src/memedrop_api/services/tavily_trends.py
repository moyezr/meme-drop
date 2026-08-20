from __future__ import annotations

import asyncio
import hashlib
import json
import math
import re
import uuid
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass, field
from datetime import UTC, datetime
from email.utils import parsedate_to_datetime
from typing import Literal, Protocol
from urllib.parse import urlsplit

import httpx

from memedrop_api.trends import TrendCard, TrendObservation, canonicalize_evidence_url

TAVILY_SEARCH_URL = "https://api.tavily.com/search"
TAVILY_MAX_RESULTS = 5
DEFAULT_MONTHLY_CREDIT_BUDGET = 750
MAX_PROVIDER_EXCERPT_CHARS = 1_200
MAX_PROVIDER_TITLE_CHARS = 300
MAX_SOURCE_URL_CHARS = 2_048
MAX_TREND_CARDS_PER_QUERY = 10
MAX_TREND_OBSERVATIONS_PER_QUERY = 25
_QUERY_KEY_PATTERN = re.compile(r"^[a-z0-9][a-z0-9._:-]{0,79}$")
_SCAN_ID_PATTERN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$")

TrendTimeRange = Literal["day", "week", "month"]
TrendSearchTopic = Literal["general", "news"]
Sleep = Callable[[float], Awaitable[None]]
Clock = Callable[[], datetime]


class TavilyCollectionError(RuntimeError):
    """Base error for a bounded Tavily collection attempt."""


class TavilyResponseError(TavilyCollectionError):
    """Raised when Tavily returns a response that cannot be safely normalized."""


class TavilyBudgetExhausted(TavilyCollectionError):
    """Raised internally when the application credit ceiling rejects an attempt."""


class TrendEvidenceEnrichmentError(RuntimeError):
    """Known model availability or schema failure for one transient evidence batch."""


@dataclass(frozen=True, slots=True)
class TrendSearchQuery:
    """A curated discovery query.

    ``text`` is deliberately omitted from the dataclass representation. Callers should use
    ``key`` for metrics and diagnostics and must not log the query itself.
    """

    key: str
    text: str = field(repr=False)
    time_range: TrendTimeRange = "day"
    topic: TrendSearchTopic = "news"
    include_domains: tuple[str, ...] = ()
    exclude_domains: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        normalized_text = " ".join(self.text.split())
        if not _QUERY_KEY_PATTERN.fullmatch(self.key):
            raise ValueError("query key must be a short categorical identifier")
        if not normalized_text or len(normalized_text) > 400:
            raise ValueError("query text must contain between 1 and 400 characters")
        if self.time_range not in {"day", "week", "month"}:
            raise ValueError("time range must be day, week, or month")
        if self.topic not in {"general", "news"}:
            raise ValueError("search topic must be general or news")
        if len(self.include_domains) > 20 or len(self.exclude_domains) > 20:
            raise ValueError("domain filters are limited to 20 entries")
        normalized_includes = _normalize_domains(self.include_domains)
        normalized_excludes = _normalize_domains(self.exclude_domains)
        if set(normalized_includes) & set(normalized_excludes):
            raise ValueError("a domain cannot be both included and excluded")
        object.__setattr__(self, "text", normalized_text)
        object.__setattr__(self, "include_domains", normalized_includes)
        object.__setattr__(self, "exclude_domains", normalized_excludes)

    @property
    def fingerprint(self) -> str:
        """Return a cache-safe identity containing every request-shaping input."""
        canonical = json.dumps(
            {
                "exclude_domains": self.exclude_domains,
                "include_domains": self.include_domains,
                "key": self.key,
                "text": self.text,
                "time_range": self.time_range,
                "topic": self.topic,
            },
            ensure_ascii=False,
            separators=(",", ":"),
            sort_keys=True,
        )
        return hashlib.sha256(canonical.encode()).hexdigest()


@dataclass(frozen=True, slots=True)
class TavilyEvidenceInput:
    """Bounded, transient evidence supplied to a trusted trend enricher.

    Provider excerpts are never passed to the storage protocol. The enricher must convert these
    untrusted fields into the repository's normalized ``TrendObservation`` contract.
    """

    provider: Literal["tavily"]
    source_url: str
    source_domain: str
    source_title: str
    provider_excerpt: str = field(repr=False)
    provider_score: float
    published_at: datetime | None
    collected_at: datetime
    query_key: str
    query_fingerprint: str
    source_fingerprint: str
    content_fingerprint: str


@dataclass(frozen=True, slots=True)
class TrendEnrichmentBatch:
    """Validated durable output from one bounded provider query."""

    cards: tuple[TrendCard, ...] = ()
    observations: tuple[TrendObservation, ...] = ()

    def __post_init__(self) -> None:
        cards = tuple(self.cards)
        observations = tuple(self.observations)
        if len(cards) > MAX_TREND_CARDS_PER_QUERY:
            raise ValueError("enrichment returned too many trend cards")
        if len(observations) > MAX_TREND_OBSERVATIONS_PER_QUERY:
            raise ValueError("enrichment returned too many trend observations")
        if not all(isinstance(card, TrendCard) for card in cards):
            raise TypeError("enrichment cards must use the TrendCard contract")
        if not all(isinstance(observation, TrendObservation) for observation in observations):
            raise TypeError("enrichment observations must use the TrendObservation contract")
        if len({card.id for card in cards}) != len(cards):
            raise ValueError("enrichment cards must be unique")
        if len({observation.id for observation in observations}) != len(observations):
            raise ValueError("enrichment observations must be unique")
        object.__setattr__(self, "cards", cards)
        object.__setattr__(self, "observations", observations)


@dataclass(frozen=True, slots=True)
class TrendCommitResult:
    cards_upserted: int
    observations_stored: int

    def __post_init__(self) -> None:
        if self.cards_upserted < 0 or self.observations_stored < 0:
            raise ValueError("commit counts cannot be negative")


class TrendEvidenceEnricher(Protocol):
    """Convert transient provider evidence into durable normalized observations."""

    async def enrich(
        self,
        evidence: Sequence[TavilyEvidenceInput],
        *,
        observed_at: datetime,
    ) -> TrendEnrichmentBatch: ...


class TrendCollectionStore(Protocol):
    """Atomic state and persistence operations needed by the collector.

    Implementations must make the claim and credit reservation methods atomic across workers.
    ``commit_scan_query`` must idempotently persist observations and mark the claim complete in
    one transaction. ``release_scan_query`` makes a failed query eligible for a later retry.
    """

    async def claim_scan_query(
        self,
        *,
        scan_id: str,
        query_fingerprint: str,
        claimed_at: datetime,
    ) -> bool: ...

    async def reserve_monthly_credits(
        self,
        *,
        period: str,
        credits: int,
        hard_limit: int,
        reservation_id: str,
        reserved_at: datetime,
    ) -> bool: ...

    async def commit_scan_query(
        self,
        *,
        scan_id: str,
        query_fingerprint: str,
        enrichment: TrendEnrichmentBatch,
        completed_at: datetime,
    ) -> TrendCommitResult: ...

    async def release_scan_query(
        self,
        *,
        scan_id: str,
        query_fingerprint: str,
    ) -> None: ...


@dataclass(frozen=True, slots=True)
class TavilyCollectorConfig:
    monthly_credit_budget: int = DEFAULT_MONTHLY_CREDIT_BUDGET
    max_queries_per_scan: int = 24
    request_timeout_seconds: float = 8.0
    cooldown_seconds: float = 1.0
    max_attempts: int = 3
    retry_base_seconds: float = 0.5
    retry_max_seconds: float = 30.0

    def __post_init__(self) -> None:
        if not 1 <= self.monthly_credit_budget <= 1_000:
            raise ValueError("monthly credit budget must be between 1 and 1000")
        if not 1 <= self.max_queries_per_scan <= 50:
            raise ValueError("max queries per scan must be between 1 and 50")
        if not 0.1 <= self.request_timeout_seconds <= 30:
            raise ValueError("request timeout must be between 0.1 and 30 seconds")
        if not 0 <= self.cooldown_seconds <= 60:
            raise ValueError("cooldown must be between 0 and 60 seconds")
        if not 1 <= self.max_attempts <= 3:
            raise ValueError("max attempts must be between 1 and 3")
        if not 0 <= self.retry_base_seconds <= 30:
            raise ValueError("retry base must be between 0 and 30 seconds")
        if not 0 <= self.retry_max_seconds <= 60:
            raise ValueError("retry maximum must be between 0 and 60 seconds")
        if self.retry_base_seconds > self.retry_max_seconds:
            raise ValueError("retry base cannot exceed retry maximum")


@dataclass(frozen=True, slots=True)
class TrendCollectionReport:
    requested_queries: int
    claimed_queries: int
    skipped_queries: int
    completed_queries: int
    failed_queries: int
    credits_reserved: int
    evidence_discovered: int
    cards_upserted: int
    observations_stored: int
    budget_exhausted: bool


@dataclass(slots=True)
class _MutableReport:
    requested_queries: int
    claimed_queries: int = 0
    skipped_queries: int = 0
    completed_queries: int = 0
    failed_queries: int = 0
    credits_reserved: int = 0
    evidence_discovered: int = 0
    cards_upserted: int = 0
    observations_stored: int = 0
    budget_exhausted: bool = False

    def freeze(self) -> TrendCollectionReport:
        return TrendCollectionReport(
            requested_queries=self.requested_queries,
            claimed_queries=self.claimed_queries,
            skipped_queries=self.skipped_queries,
            completed_queries=self.completed_queries,
            failed_queries=self.failed_queries,
            credits_reserved=self.credits_reserved,
            evidence_discovered=self.evidence_discovered,
            cards_upserted=self.cards_upserted,
            observations_stored=self.observations_stored,
            budget_exhausted=self.budget_exhausted,
        )


class TavilyTrendCollector:
    """Collect a small, idempotent scan without putting Tavily on the request path."""

    def __init__(
        self,
        *,
        api_key: str,
        store: TrendCollectionStore,
        enricher: TrendEvidenceEnricher,
        config: TavilyCollectorConfig | None = None,
        client: httpx.AsyncClient | None = None,
        sleep: Sleep = asyncio.sleep,
        clock: Clock | None = None,
    ) -> None:
        if not api_key.strip():
            raise ValueError("Tavily API key is required")
        self._api_key = api_key.strip()
        self._store = store
        self._enricher = enricher
        self._config = config or TavilyCollectorConfig()
        self._client = client
        self._owns_client = client is None
        self._sleep = sleep
        self._clock = clock or (lambda: datetime.now(UTC))
        self._closed = False

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._owns_client and self._client is not None:
            await self._client.aclose()

    async def collect(
        self,
        *,
        scan_id: str,
        queries: Sequence[TrendSearchQuery],
    ) -> TrendCollectionReport:
        if self._closed:
            raise RuntimeError("Tavily trend collector is closed")
        if not _SCAN_ID_PATTERN.fullmatch(scan_id):
            raise ValueError("scan id must be an opaque identifier")
        if len(queries) > self._config.max_queries_per_scan:
            raise ValueError("scan exceeds the configured query limit")

        report = _MutableReport(requested_queries=len(queries))
        seen_fingerprints: set[str] = set()
        for position, query in enumerate(queries):
            if query.fingerprint in seen_fingerprints:
                report.skipped_queries += 1
                continue
            seen_fingerprints.add(query.fingerprint)
            claimed = await self._store.claim_scan_query(
                scan_id=scan_id,
                query_fingerprint=query.fingerprint,
                claimed_at=self._utc_now(),
            )
            if not claimed:
                report.skipped_queries += 1
                continue
            report.claimed_queries += 1
            try:
                evidence = await self._search(query, report)
                observed_at = self._utc_now()
                enrichment = await self._enricher.enrich(evidence, observed_at=observed_at)
                commit = await self._store.commit_scan_query(
                    scan_id=scan_id,
                    query_fingerprint=query.fingerprint,
                    enrichment=enrichment,
                    completed_at=self._utc_now(),
                )
            except TavilyBudgetExhausted:
                report.budget_exhausted = True
                await self._store.release_scan_query(
                    scan_id=scan_id,
                    query_fingerprint=query.fingerprint,
                )
                break
            except (TavilyCollectionError, TrendEvidenceEnrichmentError):
                report.failed_queries += 1
                await self._store.release_scan_query(
                    scan_id=scan_id,
                    query_fingerprint=query.fingerprint,
                )
                await self._cooldown_after(position, len(queries))
                continue
            except Exception:
                # Provider availability is an expected batch-level failure, but an
                # enrichment or persistence programming error must remain visible.
                await self._store.release_scan_query(
                    scan_id=scan_id,
                    query_fingerprint=query.fingerprint,
                )
                raise

            report.evidence_discovered += len(evidence)
            report.cards_upserted += commit.cards_upserted
            report.observations_stored += commit.observations_stored
            report.completed_queries += 1
            await self._cooldown_after(position, len(queries))

        return report.freeze()

    async def _search(
        self,
        query: TrendSearchQuery,
        report: _MutableReport,
    ) -> tuple[TavilyEvidenceInput, ...]:
        last_error: BaseException | None = None
        for attempt in range(self._config.max_attempts):
            reserved_at = self._utc_now()
            reserved = await self._store.reserve_monthly_credits(
                period=reserved_at.strftime("%Y-%m"),
                credits=1,
                hard_limit=self._config.monthly_credit_budget,
                reservation_id=uuid.uuid4().hex,
                reserved_at=reserved_at,
            )
            if not reserved:
                raise TavilyBudgetExhausted
            report.credits_reserved += 1

            response: httpx.Response | None = None
            try:
                response = await self._post_search(query)
                response.raise_for_status()
                return normalize_tavily_response(
                    response,
                    query=query,
                    collected_at=self._utc_now(),
                )
            except (httpx.TransportError, TimeoutError, TavilyResponseError) as error:
                last_error = error
            except httpx.HTTPStatusError as error:
                last_error = error
                retryable_server_error = 500 <= error.response.status_code < 600
                if error.response.status_code != 429 and not retryable_server_error:
                    raise TavilyCollectionError("Tavily rejected the search request") from error

            if attempt + 1 < self._config.max_attempts:
                delay = retry_delay_seconds(
                    attempt=attempt,
                    response=response,
                    base_seconds=self._config.retry_base_seconds,
                    max_seconds=self._config.retry_max_seconds,
                    now=self._utc_now(),
                )
                if delay:
                    await self._sleep(delay)

        raise TavilyCollectionError("Tavily search attempts were exhausted") from last_error

    async def _post_search(self, query: TrendSearchQuery) -> httpx.Response:
        client = await self._get_client()
        body: dict[str, object] = {
            "query": query.text,
            "search_depth": "basic",
            "auto_parameters": False,
            "max_results": TAVILY_MAX_RESULTS,
            "include_answer": False,
            "include_raw_content": False,
            "include_images": False,
            "topic": query.topic,
            "time_range": query.time_range,
        }
        if query.include_domains:
            body["include_domains"] = list(query.include_domains)
        if query.exclude_domains:
            body["exclude_domains"] = list(query.exclude_domains)

        timeout = httpx.Timeout(self._config.request_timeout_seconds)
        async with asyncio.timeout(self._config.request_timeout_seconds):
            return await client.post(
                TAVILY_SEARCH_URL,
                headers={"Authorization": f"Bearer {self._api_key}"},
                json=body,
                timeout=timeout,
            )

    async def _get_client(self) -> httpx.AsyncClient:
        if self._closed:
            raise RuntimeError("Tavily trend collector is closed")
        if self._client is None:
            self._client = httpx.AsyncClient()
        return self._client

    async def _cooldown_after(self, position: int, query_count: int) -> None:
        if position < query_count - 1 and self._config.cooldown_seconds:
            await self._sleep(self._config.cooldown_seconds)

    def _utc_now(self) -> datetime:
        current = self._clock()
        if current.tzinfo is None:
            raise ValueError("collector clock must return a timezone-aware datetime")
        return current.astimezone(UTC)


def normalize_tavily_response(
    response: httpx.Response,
    *,
    query: TrendSearchQuery,
    collected_at: datetime,
) -> tuple[TavilyEvidenceInput, ...]:
    if collected_at.tzinfo is None or collected_at.utcoffset() is None:
        raise ValueError("collected_at must be timezone-aware")
    collected_at = collected_at.astimezone(UTC)
    try:
        payload = response.json()
    except ValueError as error:
        raise TavilyResponseError("Tavily returned invalid JSON") from error
    if not isinstance(payload, dict) or not isinstance(payload.get("results"), list):
        raise TavilyResponseError("Tavily response omitted its results list")

    normalized: dict[str, TavilyEvidenceInput] = {}
    for item in payload["results"][:TAVILY_MAX_RESULTS]:
        if not isinstance(item, dict):
            continue
        source_url = canonical_source_url(item.get("url"))
        if source_url is None:
            continue
        parsed_url = urlsplit(source_url)
        source_title = _bounded_text(item.get("title"), MAX_PROVIDER_TITLE_CHARS)
        provider_excerpt = _bounded_text(item.get("content"), MAX_PROVIDER_EXCERPT_CHARS)
        if not source_title and not provider_excerpt:
            continue
        source_fingerprint = hashlib.sha256(source_url.encode()).hexdigest()
        content_fingerprint = hashlib.sha256(
            f"{source_title}\n{provider_excerpt}".encode()
        ).hexdigest()
        published_at = _published_at(item.get("published_date"))
        if published_at is not None and published_at > collected_at:
            published_at = None
        evidence = TavilyEvidenceInput(
            provider="tavily",
            source_url=source_url,
            source_domain=parsed_url.hostname or "",
            source_title=source_title,
            provider_excerpt=provider_excerpt,
            provider_score=_bounded_score(item.get("score")),
            published_at=published_at,
            collected_at=collected_at,
            query_key=query.key,
            query_fingerprint=query.fingerprint,
            source_fingerprint=source_fingerprint,
            content_fingerprint=content_fingerprint,
        )
        previous = normalized.get(source_fingerprint)
        if previous is None or evidence.provider_score > previous.provider_score:
            normalized[source_fingerprint] = evidence
    return tuple(normalized.values())


def retry_delay_seconds(
    *,
    attempt: int,
    response: httpx.Response | None,
    base_seconds: float,
    max_seconds: float,
    now: datetime,
) -> float:
    exponential = min(max_seconds, base_seconds * (2**attempt))
    if response is None or response.status_code != 429:
        return exponential
    retry_after = _retry_after_seconds(response.headers.get("Retry-After"), now)
    if retry_after is None:
        return exponential
    return min(max_seconds, max(exponential, retry_after))


def canonical_source_url(value: object) -> str | None:
    if not isinstance(value, str) or not value or len(value) > MAX_SOURCE_URL_CHARS:
        return None
    try:
        parsed = urlsplit(value.strip())
        canonical = canonicalize_evidence_url(value)
    except ValueError:
        return None
    if parsed.username is not None or parsed.password is not None:
        return None
    return canonical if len(canonical) <= MAX_SOURCE_URL_CHARS else None


def _normalize_domains(domains: Sequence[str]) -> tuple[str, ...]:
    normalized: list[str] = []
    for value in domains:
        domain = value.strip().lower().rstrip(".")
        if not domain or len(domain) > 253 or "/" in domain or ":" in domain or " " in domain:
            raise ValueError("domain filters must contain hostnames only")
        normalized.append(domain)
    return tuple(dict.fromkeys(normalized))


def _bounded_text(value: object, limit: int) -> str:
    if not isinstance(value, str):
        return ""
    return " ".join(value.split())[:limit]


def _bounded_score(value: object) -> float:
    if isinstance(value, bool) or not isinstance(value, int | float):
        return 0.0
    score = float(value)
    if not math.isfinite(score):
        return 0.0
    return min(1.0, max(0.0, score))


def _published_at(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    normalized = value.strip().replace("Z", "+00:00")
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError:
        try:
            parsed = parsedate_to_datetime(value)
        except (TypeError, ValueError, OverflowError):
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


def _retry_after_seconds(value: str | None, now: datetime) -> float | None:
    if not value:
        return None
    try:
        seconds = float(value)
    except ValueError:
        try:
            retry_at = parsedate_to_datetime(value)
        except (TypeError, ValueError, OverflowError):
            return None
        if retry_at.tzinfo is None:
            retry_at = retry_at.replace(tzinfo=UTC)
        seconds = (retry_at.astimezone(UTC) - now.astimezone(UTC)).total_seconds()
    if not math.isfinite(seconds):
        return None
    return max(0.0, seconds)
