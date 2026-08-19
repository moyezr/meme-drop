from __future__ import annotations

import json
from collections.abc import Sequence
from datetime import UTC, datetime

import httpx
import pytest

from memedrop_api.services.tavily_trends import (
    DEFAULT_MONTHLY_CREDIT_BUDGET,
    TAVILY_MAX_RESULTS,
    TavilyCollectorConfig,
    TavilyEvidenceInput,
    TavilyTrendCollector,
    TrendCommitResult,
    TrendEnrichmentBatch,
    TrendSearchQuery,
    canonical_source_url,
    retry_delay_seconds,
)
from memedrop_api.trends import TrendObservation, trend_id_for_key

NOW = datetime(2026, 8, 19, 10, 30, tzinfo=UTC)


class CapturingEnricher:
    def __init__(self) -> None:
        self.calls: list[tuple[tuple[TavilyEvidenceInput, ...], datetime]] = []

    async def enrich(
        self,
        evidence: Sequence[TavilyEvidenceInput],
        *,
        observed_at: datetime,
    ) -> TrendEnrichmentBatch:
        captured = tuple(evidence)
        self.calls.append((captured, observed_at))
        return TrendEnrichmentBatch(
            observations=tuple(
                TrendObservation.from_evidence(
                    trend_id=trend_id_for_key("captured-trend"),
                    provider=item.provider,
                    source_url=item.source_url,
                    content_hash=item.content_fingerprint,
                    observed_at=observed_at,
                    published_at=item.published_at,
                    provider_score=item.provider_score,
                    query_fingerprint=item.query_fingerprint,
                )
                for item in captured
            )
        )


class FakeStore:
    def __init__(self, *, claim: bool = True, reservations: Sequence[bool] = (True,)) -> None:
        self.claim = claim
        self.reservations = iter(reservations)
        self.claims: list[dict[str, object]] = []
        self.reserved: list[dict[str, object]] = []
        self.commits: list[TrendEnrichmentBatch] = []
        self.releases: list[dict[str, object]] = []

    async def claim_scan_query(self, **values: object) -> bool:
        self.claims.append(values)
        return self.claim

    async def reserve_monthly_credits(self, **values: object) -> bool:
        self.reserved.append(values)
        return next(self.reservations, False)

    async def commit_scan_query(
        self,
        *,
        scan_id: str,
        query_fingerprint: str,
        enrichment: TrendEnrichmentBatch,
        completed_at: datetime,
    ) -> TrendCommitResult:
        self.commits.append(enrichment)
        return TrendCommitResult(
            cards_upserted=len(enrichment.cards),
            observations_stored=len(enrichment.observations),
        )

    async def release_scan_query(self, **values: object) -> None:
        self.releases.append(values)


def result(
    number: int,
    *,
    url: str | None = None,
    score: float = 0.8,
) -> dict[str, object]:
    return {
        "title": f"Trend {number}",
        "url": url or f"https://Example.com/trend/{number}?utm_source=test&item={number}",
        "content": f"Social context for trend {number}",
        "score": score,
        "published_date": "2026-08-19T08:00:00Z",
    }


async def test_collector_forces_basic_bounded_search_and_stores_only_enriched_observations() -> (
    None
):
    captured_request: httpx.Request | None = None

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal captured_request
        captured_request = request
        duplicate = result(
            20,
            url="https://example.com/trend/1?item=1&utm_campaign=duplicate",
            score=0.95,
        )
        return httpx.Response(
            200,
            json={"results": [result(number) for number in range(1, 7)] + [duplicate]},
            request=request,
        )

    store = FakeStore()
    enricher = CapturingEnricher()
    query = TrendSearchQuery(
        key="fast-ai",
        text="  current   AI meme trends  ",
        time_range="day",
        topic="news",
        include_domains=("Reddit.com", "reddit.com"),
    )
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        collector = TavilyTrendCollector(
            api_key="tvly-test-secret",
            store=store,
            enricher=enricher,
            client=client,
            clock=lambda: NOW,
        )
        report = await collector.collect(scan_id="scan-20260819-01", queries=[query])

    assert captured_request is not None
    request_body = json.loads(captured_request.content)
    assert request_body == {
        "query": "current AI meme trends",
        "search_depth": "basic",
        "auto_parameters": False,
        "max_results": 5,
        "include_answer": False,
        "include_raw_content": False,
        "include_images": False,
        "topic": "news",
        "time_range": "day",
        "include_domains": ["reddit.com"],
    }
    assert captured_request.headers["Authorization"] == "Bearer tvly-test-secret"
    assert len(enricher.calls) == 1
    evidence, observed_at = enricher.calls[0]
    assert len(evidence) == TAVILY_MAX_RESULTS
    assert observed_at == NOW
    assert evidence[0].source_url == "https://example.com/trend/1?item=1"
    assert evidence[0].source_domain == "example.com"
    assert evidence[0].published_at == datetime(2026, 8, 19, 8, tzinfo=UTC)
    assert not hasattr(store.commits[0].observations[0], "provider_excerpt")
    assert report.completed_queries == 1
    assert report.credits_reserved == 1
    assert report.evidence_discovered == 5
    assert report.cards_upserted == 0
    assert report.observations_stored == 5


async def test_duplicate_scan_query_is_skipped_before_budget_or_provider_call() -> None:
    calls = 0

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"results": []}, request=request)

    store = FakeStore(claim=False)
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        collector = TavilyTrendCollector(
            api_key="secret",
            store=store,
            enricher=CapturingEnricher(),
            config=TavilyCollectorConfig(cooldown_seconds=0),
            client=client,
            clock=lambda: NOW,
        )
        report = await collector.collect(
            scan_id="same-scan",
            queries=[TrendSearchQuery(key="daily", text="daily trends")],
        )

    assert calls == 0
    assert not store.reserved
    assert report.skipped_queries == 1
    assert report.claimed_queries == 0


async def test_duplicate_queries_inside_one_scan_are_locally_deduplicated() -> None:
    calls = 0

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"results": []}, request=request)

    query = TrendSearchQuery(key="daily", text="daily trends")
    store = FakeStore()
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        collector = TavilyTrendCollector(
            api_key="secret",
            store=store,
            enricher=CapturingEnricher(),
            config=TavilyCollectorConfig(cooldown_seconds=0),
            client=client,
            clock=lambda: NOW,
        )
        report = await collector.collect(scan_id="local-dedupe", queries=[query, query])

    assert calls == 1
    assert len(store.claims) == 1
    assert report.completed_queries == 1
    assert report.skipped_queries == 1


async def test_monthly_budget_denial_stops_scan_without_calling_provider() -> None:
    calls = 0

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(200, json={"results": []}, request=request)

    store = FakeStore(reservations=(False,))
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        collector = TavilyTrendCollector(
            api_key="secret",
            store=store,
            enricher=CapturingEnricher(),
            client=client,
            clock=lambda: NOW,
        )
        report = await collector.collect(
            scan_id="budget-scan",
            queries=[TrendSearchQuery(key="daily", text="daily trends")],
        )

    assert calls == 0
    assert store.reserved[0]["period"] == "2026-08"
    assert store.reserved[0]["hard_limit"] == DEFAULT_MONTHLY_CREDIT_BUDGET
    assert len(store.releases) == 1
    assert report.budget_exhausted
    assert report.credits_reserved == 0


async def test_429_retry_honors_retry_after_and_reserves_each_outbound_attempt() -> None:
    calls = 0
    delays: list[float] = []

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        if calls == 1:
            return httpx.Response(429, headers={"Retry-After": "2"}, request=request)
        return httpx.Response(200, json={"results": [result(1)]}, request=request)

    async def sleep(delay: float) -> None:
        delays.append(delay)

    store = FakeStore(reservations=(True, True))
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        collector = TavilyTrendCollector(
            api_key="secret",
            store=store,
            enricher=CapturingEnricher(),
            client=client,
            sleep=sleep,
            clock=lambda: NOW,
        )
        report = await collector.collect(
            scan_id="retry-scan",
            queries=[TrendSearchQuery(key="daily", text="daily trends")],
        )

    assert calls == 2
    assert delays == [2]
    assert len(store.reserved) == 2
    assert len({item["reservation_id"] for item in store.reserved}) == 2
    assert report.credits_reserved == 2
    assert report.completed_queries == 1


async def test_non_retryable_provider_failure_releases_claim_without_leaking_response() -> None:
    calls = 0

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal calls
        calls += 1
        return httpx.Response(400, json={"detail": "provider content"}, request=request)

    store = FakeStore()
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        collector = TavilyTrendCollector(
            api_key="secret",
            store=store,
            enricher=CapturingEnricher(),
            client=client,
            clock=lambda: NOW,
        )
        report = await collector.collect(
            scan_id="failed-scan",
            queries=[TrendSearchQuery(key="daily", text="daily trends")],
        )

    assert calls == 1
    assert len(store.releases) == 1
    assert report.failed_queries == 1
    assert report.completed_queries == 0


async def test_collector_applies_a_strict_wall_clock_timeout() -> None:
    async def respond(request: httpx.Request) -> httpx.Response:
        await __import__("asyncio").sleep(0.2)
        return httpx.Response(200, json={"results": []}, request=request)

    store = FakeStore()
    config = TavilyCollectorConfig(request_timeout_seconds=0.1, max_attempts=1)
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        collector = TavilyTrendCollector(
            api_key="secret",
            store=store,
            enricher=CapturingEnricher(),
            config=config,
            client=client,
            clock=lambda: NOW,
        )
        report = await collector.collect(
            scan_id="timeout-scan",
            queries=[TrendSearchQuery(key="daily", text="daily trends")],
        )

    assert report.failed_queries == 1
    assert len(store.releases) == 1


async def test_unexpected_enrichment_bug_is_released_and_propagated() -> None:
    class BrokenEnricher:
        async def enrich(
            self,
            evidence: Sequence[TavilyEvidenceInput],
            *,
            observed_at: datetime,
        ) -> TrendEnrichmentBatch:
            raise RuntimeError("enricher bug")

    def respond(request: httpx.Request) -> httpx.Response:
        return httpx.Response(200, json={"results": [result(1)]}, request=request)

    store = FakeStore()
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        collector = TavilyTrendCollector(
            api_key="secret",
            store=store,
            enricher=BrokenEnricher(),
            client=client,
            clock=lambda: NOW,
        )
        with pytest.raises(RuntimeError, match="enricher bug"):
            await collector.collect(
                scan_id="broken-enricher",
                queries=[TrendSearchQuery(key="daily", text="daily trends")],
            )

    assert len(store.releases) == 1


async def test_queries_are_bounded_and_cooldown_is_injectable() -> None:
    requests = 0
    delays: list[float] = []

    def respond(request: httpx.Request) -> httpx.Response:
        nonlocal requests
        requests += 1
        return httpx.Response(200, json={"results": []}, request=request)

    async def sleep(delay: float) -> None:
        delays.append(delay)

    store = FakeStore(reservations=(True, True))
    config = TavilyCollectorConfig(max_queries_per_scan=2, cooldown_seconds=0.25)
    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        collector = TavilyTrendCollector(
            api_key="secret",
            store=store,
            enricher=CapturingEnricher(),
            config=config,
            client=client,
            sleep=sleep,
            clock=lambda: NOW,
        )
        report = await collector.collect(
            scan_id="bounded-scan",
            queries=[
                TrendSearchQuery(key="one", text="first query"),
                TrendSearchQuery(key="two", text="second query"),
            ],
        )
        with pytest.raises(ValueError, match="query limit"):
            await collector.collect(
                scan_id="too-large",
                queries=[
                    TrendSearchQuery(key="one", text="first query"),
                    TrendSearchQuery(key="two", text="second query"),
                    TrendSearchQuery(key="three", text="third query"),
                ],
            )

    assert requests == 2
    assert delays == [0.25]
    assert report.completed_queries == 2


def test_query_identity_hashes_every_request_shaping_input_and_hides_text_from_repr() -> None:
    baseline = TrendSearchQuery(key="daily", text="current meme trends")
    different_horizon = TrendSearchQuery(
        key="daily",
        text="current meme trends",
        time_range="week",
    )

    assert baseline.fingerprint != different_horizon.fingerprint
    assert baseline.text not in repr(baseline)
    assert len(baseline.fingerprint) == 64


def test_url_canonicalization_drops_tracking_data_and_rejects_unsafe_urls() -> None:
    assert (
        canonical_source_url(
            "HTTPS://Example.COM:443/path?utm_source=x&b=2&a=1&fbclid=secret#fragment"
        )
        == "https://example.com/path?a=1&b=2"
    )
    assert canonical_source_url("javascript:alert(1)") is None
    assert canonical_source_url("https://user:password@example.com/path") is None


def test_retry_delay_caps_retry_after_and_uses_exponential_fallback() -> None:
    rate_limited = httpx.Response(429, headers={"Retry-After": "120"})
    unavailable = httpx.Response(503)

    assert (
        retry_delay_seconds(
            attempt=0,
            response=rate_limited,
            base_seconds=0.5,
            max_seconds=30,
            now=NOW,
        )
        == 30
    )
    assert (
        retry_delay_seconds(
            attempt=2,
            response=unavailable,
            base_seconds=0.5,
            max_seconds=30,
            now=NOW,
        )
        == 2
    )


def test_free_tier_configuration_cannot_exceed_provider_allowance() -> None:
    assert TavilyCollectorConfig().monthly_credit_budget == 750
    with pytest.raises(ValueError, match="between 1 and 1000"):
        TavilyCollectorConfig(monthly_credit_budget=1_001)
