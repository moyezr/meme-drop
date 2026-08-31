"""Offline OpenRouter embeddings for normalized trend cards."""

from __future__ import annotations

import asyncio
import hashlib
import json
import math
from collections.abc import Sequence
from typing import Any, Literal

import httpx

from memedrop_api.trends import TrendCard

OPENROUTER_EMBEDDINGS_URL = "https://openrouter.ai/api/v1/embeddings"
TREND_EMBEDDING_DIMENSIONS = 1_536
_MAX_PROVIDER_RESPONSE_BYTES = 16 * 1024 * 1024
_SEMANTIC_FIELDS = (
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
TrendEmbeddingFailureCategory = Literal[
    "openrouter_embedding_auth",
    "openrouter_embedding_rate_limit",
    "openrouter_embedding_capacity",
    "openrouter_embedding_timeout",
    "openrouter_embedding_unavailable",
    "openrouter_embedding_response_invalid",
    "trend_embedding_persistence_conflict",
]


class TrendEmbeddingError(RuntimeError):
    """A content-free provider category safe to expose to operators."""

    def __init__(self, category: TrendEmbeddingFailureCategory) -> None:
        super().__init__(f"trend embedding failed ({category})")
        self.category = category


class OpenRouterTrendEmbedder:
    """Batch trend-card documents through OpenRouter's embedding endpoint."""

    def __init__(
        self,
        *,
        api_key: str,
        model: str,
        timeout_seconds: float,
        batch_size: int,
        site_url: str = "http://localhost:3001",
        app_name: str = "MemeDrop",
        endpoint: str = OPENROUTER_EMBEDDINGS_URL,
        client: httpx.AsyncClient | None = None,
    ) -> None:
        if not api_key.strip() or not model.strip():
            raise ValueError("OpenRouter embedding credentials and model are required")
        if not endpoint.startswith("https://"):
            raise ValueError("OpenRouter embedding endpoint must use HTTPS")
        if not site_url.strip() or not app_name.strip():
            raise ValueError("OpenRouter attribution values are required")
        if timeout_seconds < 0.1 or timeout_seconds > 60:
            raise ValueError("embedding timeout must be between 0.1 and 60 seconds")
        if batch_size < 1 or batch_size > 128:
            raise ValueError("embedding batch size must be between 1 and 128")
        self._api_key = api_key.strip()
        self._model = model.strip()
        self._timeout_seconds = timeout_seconds
        self._batch_size = batch_size
        self._site_url = site_url.strip()
        self._app_name = app_name.strip()
        self._endpoint = endpoint
        self._client = client
        self._owns_client = client is None
        self._closed = False

    async def embed_cards(self, cards: Sequence[TrendCard]) -> list[list[float]]:
        """Return embeddings in the exact same order as ``cards``."""

        return await self.embed_texts(
            [trend_card_embedding_document(card) for card in cards]
        )

    async def embed_texts(self, documents: Sequence[str]) -> list[list[float]]:
        """Embed bounded caller-owned documents in their original order."""

        if self._closed:
            raise RuntimeError("trend embedder is closed")
        vectors: list[list[float]] = []
        for offset in range(0, len(documents), self._batch_size):
            vectors.extend(await self._embed_batch(documents[offset : offset + self._batch_size]))
        return vectors

    async def close(self) -> None:
        if self._closed:
            return
        self._closed = True
        if self._owns_client and self._client is not None:
            await self._client.aclose()

    async def _embed_batch(self, documents: Sequence[str]) -> list[list[float]]:
        client = await self._get_client()
        try:
            async with asyncio.timeout(self._timeout_seconds):
                response = await client.post(
                    self._endpoint,
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "HTTP-Referer": self._site_url,
                        "X-Title": self._app_name,
                    },
                    json={
                        "model": self._model,
                        "input": list(documents),
                        "dimensions": TREND_EMBEDDING_DIMENSIONS,
                    },
                    timeout=httpx.Timeout(self._timeout_seconds),
                )
            response.raise_for_status()
        except TimeoutError:
            raise TrendEmbeddingError("openrouter_embedding_timeout") from None
        except httpx.TimeoutException:
            raise TrendEmbeddingError("openrouter_embedding_timeout") from None
        except httpx.HTTPStatusError as error:
            status_code = error.response.status_code
            if status_code in {401, 403}:
                category: TrendEmbeddingFailureCategory = "openrouter_embedding_auth"
            elif status_code == 429:
                category = "openrouter_embedding_rate_limit"
            elif status_code == 529:
                category = "openrouter_embedding_capacity"
            else:
                category = "openrouter_embedding_unavailable"
            raise TrendEmbeddingError(category) from None
        except httpx.HTTPError:
            raise TrendEmbeddingError("openrouter_embedding_unavailable") from None
        if len(response.content) > _MAX_PROVIDER_RESPONSE_BYTES:
            raise TrendEmbeddingError("openrouter_embedding_response_invalid")
        try:
            payload = response.json()
            return _validated_vectors(payload, expected_count=len(documents))
        except (TypeError, ValueError, KeyError, IndexError):
            raise TrendEmbeddingError("openrouter_embedding_response_invalid") from None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._closed:
            raise RuntimeError("trend embedder is closed")
        if self._client is None:
            self._client = httpx.AsyncClient()
        return self._client


def trend_card_embedding_document(card: TrendCard) -> str:
    """Build deterministic semantic text without evidence, URLs, or volatile scores."""

    document = {
        field: list(value) if isinstance(value, tuple) else value
        for field in _SEMANTIC_FIELDS
        if (value := getattr(card, field))
    }
    return json.dumps(document, ensure_ascii=False, separators=(",", ":"), sort_keys=True)


def trend_card_embedding_fingerprint(card: TrendCard) -> str:
    return hashlib.sha256(trend_card_embedding_document(card).encode("utf-8")).hexdigest()


def _validated_vectors(payload: Any, *, expected_count: int) -> list[list[float]]:
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise ValueError("embedding response must contain a data array")
    rows = payload["data"]
    if len(rows) != expected_count:
        raise ValueError("embedding response count does not match request")

    ordered: list[list[float] | None] = [None] * expected_count
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("embedding result must be an object")
        index = row.get("index")
        embedding = row.get("embedding")
        if not isinstance(index, int) or isinstance(index, bool) or not 0 <= index < expected_count:
            raise ValueError("embedding result index is invalid")
        if ordered[index] is not None:
            raise ValueError("embedding result index is duplicated")
        if not isinstance(embedding, list) or len(embedding) != TREND_EMBEDDING_DIMENSIONS:
            raise ValueError("embedding vector dimension is invalid")
        if any(
            not isinstance(value, (int, float))
            or isinstance(value, bool)
            or not math.isfinite(value)
            for value in embedding
        ):
            raise ValueError("embedding vector values are invalid")
        ordered[index] = [float(value) for value in embedding]
    if any(vector is None for vector in ordered):
        raise ValueError("embedding response omitted an input")
    return [vector for vector in ordered if vector is not None]
