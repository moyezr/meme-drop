"""Loopback-only backend for the packaged extension's provider-free browser smoke."""

from __future__ import annotations

import asyncio
import os
from collections.abc import Sequence
from pathlib import Path
from typing import Any, Literal
from uuid import UUID

from fastapi import Request, Response
from PIL import Image, ImageDraw

from memedrop_api.app import create_app
from memedrop_api.config import Settings
from memedrop_api.performance_metrics import BrowserPerformanceSample, PerformanceCleanupResult
from memedrop_api.rate_limit import MemoryRateLimitStore
from memedrop_api.schemas import TweetContext
from memedrop_api.services.catalog import MemeCatalog, MemeTemplate
from memedrop_api.services.openrouter import JointSuggestionResult, TemplateSelection
from memedrop_api.services.storage import LocalMemeStorage
from memedrop_api.services.suggestion_engine import SuggestionService
from memedrop_api.services.trend_index import TrendQuerySignal, TrendRetrieval
from memedrop_api.trends import TrendCard
from tests.fakes import FakeStore

if os.environ.get("MEMEDROP_BROWSER_FIXTURE") != "1":
    raise RuntimeError("Browser fixture must be explicitly enabled by its loopback smoke runner")

root = Path(os.environ["MEMEDROP_BROWSER_FIXTURE_PATH"])
root.mkdir(parents=True, exist_ok=True)
settings = Settings(
    database_url="postgresql://test:test@127.0.0.1:1/browser_fixture_test",
    meme_storage_path=root,
    storage_backend="local",
    openrouter_api_key=None,
    tavily_api_key=None,
    trends_enabled=False,
    redis_url=None,
    rate_limit_store="memory",
    require_install_id=True,
    cors_origins_value="https://x.com,https://www.linkedin.com",
)
catalog = MemeCatalog.load()
fixture_mode = "success"
suggestion_calls = 0
suggestion_pending = 0
fixture_revision = 0
performance_samples: list[dict[str, object]] = []


class FixturePerformanceStore:
    async def record(self, samples: Sequence[BrowserPerformanceSample]) -> int:
        recorded = 0
        for sample in samples:
            safe = sample.model_dump(mode="json", exclude_none=True)
            if any(row["event_id"] == safe["event_id"] for row in performance_samples):
                continue
            performance_samples.append(safe)
            recorded += 1
        return recorded

    async def cleanup_expired(self) -> PerformanceCleanupResult:
        return PerformanceCleanupResult(0, 0)


class FixtureStore(FakeStore):
    async def list_global_memes(self) -> list[dict[str, Any]]:
        if fixture_mode == "error":
            raise TimeoutError("Fixture catalog unavailable")
        return await super().list_global_memes()


store = FixtureStore()
for index, template_id in enumerate(("surprised-pikachu", "this-is-fine"), start=1):
    template = next(item for item in catalog.verified_templates if item.template_id == template_id)
    image = Image.new("RGB", (480, 480), (246, 210, 96))
    ImageDraw.Draw(image).rectangle((40, 120, 440, 320), fill=(98, 130, 180))
    image.save(root / f"fixture-{index}.png")
    store.memes.append(
        {
            "id": str(UUID(int=index)),
            "name": template.name,
            "filePath": f"/memes/fixture-{index}.png",
            "formatType": "text_overlay",
            "isEvergreen": True,
            "systemTags": {},
        }
    )


class FixtureGateway:
    async def select_and_caption(
        self,
        tweet_text: str,
        templates: list[MemeTemplate],
        limit: int,
        *,
        context: TweetContext | None = None,
        steering_instruction: str | None = None,
        trend_cards: Sequence[TrendCard] = (),
        timeout_ms: int | None = None,
    ) -> JointSuggestionResult:
        if fixture_mode == "slow":
            await asyncio.sleep(20)
        return JointSuggestionResult(
            selections=[
                TemplateSelection("surprised-pikachu", "predictable result", 0.96),
                TemplateSelection("this-is-fine", "calm chaos", 0.9),
            ][:limit],
            captions={
                "surprised-pikachu": {"top_reaction_caption": "Skipped tests. Shocking result."},
                "this-is-fine": {
                    "speech_bubble_text": "This is fine",
                    "bottom_caption": "Deploying on vibes",
                },
            },
        )

    async def generate_captions(
        self,
        tweet_text: str,
        templates: list[MemeTemplate],
        *,
        context: TweetContext | None = None,
        trend_cards: Sequence[TrendCard] = (),
    ) -> dict[str, dict[str, str]]:
        return {}


class FixtureTrends:
    async def retrieve(self, signals: Sequence[TrendQuerySignal]) -> TrendRetrieval:
        if fixture_mode == "slow":
            await asyncio.sleep(20)
        return TrendRetrieval.empty()


async def ready() -> bool:
    return True


service = SuggestionService(
    store,
    catalog,
    FixtureGateway(),
    settings,
    trend_retriever=FixtureTrends(),
)
rate_limiter = MemoryRateLimitStore()
app = create_app(
    settings,
    store=store,
    suggestion_service=service,
    readiness_check=ready,
    storage=LocalMemeStorage(root),
    performance_store=FixturePerformanceStore(),
    rate_limiter=rate_limiter,
)


@app.middleware("http")
async def count_requests(request: Request, call_next):  # type: ignore[no-untyped-def]
    global suggestion_calls, suggestion_pending
    suggestion = request.url.path == "/api/v1/suggest"
    if suggestion:
        suggestion_calls += 1
        suggestion_pending += 1
    if fixture_mode == "broken_media" and request.url.path.startswith("/memes/"):
        return Response(b"broken", media_type="image/png")
    try:
        return await call_next(request)
    finally:
        if suggestion:
            suggestion_pending -= 1


@app.post("/_fixture/reset")
async def reset(
    mode: Literal["success", "slow", "error", "broken_media"] = "success",
) -> dict[str, bool]:
    global fixture_mode, suggestion_calls, fixture_revision
    fixture_mode = mode
    suggestion_calls = 0
    fixture_revision += 1
    # Polling earlier scenarios must not exhaust the next scenario's diagnostics.
    # Keep normal limits within each scenario; only the loopback fixture resets them.
    async with rate_limiter.lock:
        rate_limiter.buckets.clear()
    store.usage_events.clear()
    performance_samples.clear()
    service.cache.clear()
    service._global_candidates = None
    for index, row in enumerate(store.memes, start=1):
        row["filePath"] = f"/memes/fixture-{index}.png?revision={fixture_revision}"
    return {"ready": True}


@app.get("/_fixture/state")
async def state() -> dict[str, object]:
    return {
        "suggestion_calls": suggestion_calls,
        "suggestion_pending": suggestion_pending,
        "events": store.usage_events,
        "performance_samples": performance_samples,
    }
