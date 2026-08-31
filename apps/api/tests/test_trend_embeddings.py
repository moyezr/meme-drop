from __future__ import annotations

import json
from datetime import UTC, datetime, timedelta

import httpx
import pytest

from memedrop_api.services.trend_embeddings import (
    OpenRouterTrendEmbedder,
    TrendEmbeddingError,
    trend_card_embedding_document,
    trend_card_embedding_fingerprint,
)
from memedrop_api.trends import (
    TrendCard,
    TrendDuration,
    TrendLifecycle,
    trend_id_for_key,
)


def make_card(key: str = "semantic-card") -> TrendCard:
    now = datetime(2026, 8, 24, 12, tzinfo=UTC)
    return TrendCard(
        id=trend_id_for_key(key),
        key=key,
        name=key.replace("-", " ").title(),
        premise="An expectation gets reversed at exactly the wrong moment.",
        aliases=("surprise reversal",),
        entities=("MemeDrop",),
        topics=("internet culture",),
        communities=("developers",),
        recognition_cues=("a sudden change of plan",),
        comic_tensions=("confidence versus immediate failure",),
        usage_guidance="Use for confident plans that fail immediately.",
        avoid_guidance=("Avoid serious emergencies.",),
        lifecycle=TrendLifecycle.RISING,
        duration_class=TrendDuration.FAST,
        first_seen_at=now - timedelta(days=2),
        last_confirmed_at=now,
        expires_at=now + timedelta(days=5),
        confidence=0.8,
        momentum=0.7,
        vitality=0.75,
        source_count=3,
        observation_count=4,
    )


def test_embedding_document_is_deterministic_compact_and_semantic_only() -> None:
    card = make_card()
    document = trend_card_embedding_document(card)

    assert document == trend_card_embedding_document(card)
    assert len(document) < 1_200
    assert "expectation gets reversed" in document
    assert {
        "source_count",
        "observation_count",
        "confidence",
        "lifecycle",
        "expires_at",
    }.isdisjoint(json.loads(document))
    assert "http" not in document
    assert trend_card_embedding_fingerprint(card) == trend_card_embedding_fingerprint(
        card.model_copy(update={"momentum": 0.2, "version": 7})
    )
    assert trend_card_embedding_fingerprint(card) != trend_card_embedding_fingerprint(
        card.model_copy(update={"premise": "A different semantic premise."})
    )


async def test_openrouter_embeddings_are_batched_validated_and_restored_to_input_order() -> None:
    requests: list[dict[str, object]] = []

    def handler(request: httpx.Request) -> httpx.Response:
        body = json.loads(request.content)
        requests.append(body)
        rows = []
        for index, document in reversed(list(enumerate(body["input"]))):
            value = 1.0 if "First Card" in document else 2.0 if "Second Card" in document else 3.0
            rows.append({"index": index, "embedding": [value] * 1_536})
        return httpx.Response(200, json={"data": rows})

    cards = [make_card("first-card"), make_card("second-card"), make_card("third-card")]
    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        embedder = OpenRouterTrendEmbedder(
            api_key="secret",
            model="google/gemini-embedding-2",
            timeout_seconds=5,
            batch_size=2,
            client=client,
        )
        vectors = await embedder.embed_cards(cards)

    assert [vector[0] for vector in vectors] == [1.0, 2.0, 3.0]
    assert [len(request["input"]) for request in requests] == [2, 1]  # type: ignore[arg-type]
    assert all(request["model"] == "google/gemini-embedding-2" for request in requests)
    assert all(request["dimensions"] == 1_536 for request in requests)


@pytest.mark.parametrize(
    "data",
    [
        [{"index": 0, "embedding": [0.0] * 1_535}],
        [{"index": 1, "embedding": [0.0] * 1_536}],
        [
            {"index": 0, "embedding": [0.0] * 1_536},
            {"index": 0, "embedding": [0.0] * 1_536},
        ],
        [{"index": 0, "embedding": [True] * 1_536}],
    ],
)
async def test_invalid_provider_vectors_use_one_content_free_category(
    data: list[dict[str, object]],
) -> None:
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(lambda _: httpx.Response(200, json={"data": data}))
    ) as client:
        embedder = OpenRouterTrendEmbedder(
            api_key="secret",
            model="google/gemini-embedding-2",
            timeout_seconds=5,
            batch_size=8,
            client=client,
        )
        with pytest.raises(TrendEmbeddingError) as captured:
            await embedder.embed_cards([make_card()])

    assert captured.value.category == "openrouter_embedding_response_invalid"
    assert "semantic-card" not in str(captured.value)


async def test_provider_transport_failure_has_a_bounded_content_free_category() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("sensitive upstream details", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        embedder = OpenRouterTrendEmbedder(
            api_key="secret",
            model="google/gemini-embedding-2",
            timeout_seconds=5,
            batch_size=8,
            client=client,
        )
        with pytest.raises(TrendEmbeddingError) as captured:
            await embedder.embed_cards([make_card()])

    assert captured.value.category == "openrouter_embedding_unavailable"
    assert "sensitive" not in str(captured.value)


async def test_provider_timeout_has_a_bounded_content_free_category() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise httpx.ReadTimeout("sensitive timeout details", request=request)

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        embedder = OpenRouterTrendEmbedder(
            api_key="secret",
            model="google/gemini-embedding-2",
            timeout_seconds=5,
            batch_size=8,
            client=client,
        )
        with pytest.raises(TrendEmbeddingError) as captured:
            await embedder.embed_cards([make_card()])

    assert captured.value.category == "openrouter_embedding_timeout"
    assert "sensitive" not in str(captured.value)


@pytest.mark.parametrize(
    ("status_code", "category"),
    [
        (401, "openrouter_embedding_auth"),
        (403, "openrouter_embedding_auth"),
        (429, "openrouter_embedding_rate_limit"),
        (529, "openrouter_embedding_capacity"),
        (500, "openrouter_embedding_unavailable"),
    ],
)
async def test_provider_http_failures_have_actionable_bounded_categories(
    status_code: int,
    category: str,
) -> None:
    async with httpx.AsyncClient(
        transport=httpx.MockTransport(
            lambda _: httpx.Response(status_code, text="sensitive provider body")
        )
    ) as client:
        embedder = OpenRouterTrendEmbedder(
            api_key="secret",
            model="google/gemini-embedding-2",
            timeout_seconds=5,
            batch_size=8,
            client=client,
        )
        with pytest.raises(TrendEmbeddingError) as captured:
            await embedder.embed_cards([make_card()])

    assert captured.value.category == category
    assert "sensitive" not in str(captured.value)
