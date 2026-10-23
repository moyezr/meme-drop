from __future__ import annotations

import asyncio
import json
from collections.abc import Sequence
from typing import Any
from uuid import uuid4

import httpx
import pytest

from memedrop_api.api import performance as route
from memedrop_api.app import create_app
from memedrop_api.config import Settings
from memedrop_api.performance_baseline import METRICS, OUTCOMES, summarize_group
from memedrop_api.performance_metrics import BrowserPerformanceSample, PerformanceCleanupResult
from tests.conftest import INSTALL_ID
from tests.fakes import FakeStore


class RecordingPerformanceStore:
    def __init__(self) -> None:
        self.samples: list[dict[str, Any]] = []

    async def record(self, samples: Sequence[BrowserPerformanceSample]) -> int:
        self.samples.extend(sample.model_dump(mode="json", exclude_none=True) for sample in samples)
        return len(samples)

    async def cleanup_expired(self) -> PerformanceCleanupResult:
        return PerformanceCleanupResult(0, 0)


def sample(**overrides: Any) -> dict[str, Any]:
    return {
        "event_id": str(uuid4()),
        "kind": "request",
        "platform": "x",
        "extension_version": "0.0.4",
        "outcome": "usable",
        "elapsed_ms": 1234.5,
        "first_usable_preview_ms": 1230.0,
        "api_response_ms": 900.0,
        "suggestion_count": 2,
        "cache_status": "unknown",
        "generation_mode": "unknown",
        **overrides,
    }


async def post(
    settings: Settings,
    store: RecordingPerformanceStore,
    body: Any,
    *,
    identity: str | None = str(INSTALL_ID),
) -> tuple[httpx.Response, FakeStore]:
    users = FakeStore()
    app = create_app(
        settings.model_copy(update={"require_install_id": True}),
        store=users,
        performance_store=store,
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test"
    ) as client:
        return await client.post(
            "/api/v1/performance/batch",
            json=body,
            headers={"x-memedrop-install-id": identity} if identity else {},
        ), users


async def test_collects_only_explicit_measurements_without_creating_install(
    settings: Settings,
) -> None:
    store = RecordingPerformanceStore()
    response, users = await post(settings, store, {"samples": [sample()]})
    assert response.status_code == 200
    assert response.json() == {"received": 1, "recorded": 1}
    assert users.ensured_users == []
    assert len(store.samples) == 1
    assert "created_at" not in store.samples[0]
    assert "install_id" not in store.samples[0]


@pytest.mark.parametrize(
    "field", ["post_text", "caption", "url", "request_id", "install_id", "created_at"]
)
async def test_rejects_content_and_identifiers_without_echo_or_log(
    settings: Settings, field: str, caplog: pytest.LogCaptureFixture
) -> None:
    store = RecordingPerformanceStore()
    private = "PRIVATE user content must not survive"
    response, _ = await post(settings, store, {"samples": [sample(**{field: private})]})
    assert response.status_code == 400
    assert response.json() == {"error": "Invalid performance batch"}
    assert private not in response.text + caplog.text
    assert field not in response.text
    assert store.samples == []


@pytest.mark.parametrize(
    "changes",
    [
        {"extension_version": "my private post"},
        {"elapsed_ms": True},
        {"elapsed_ms": "1234"},
        {"elapsed_ms": 120001},
        {"first_usable_preview_ms": 1500},
        {"api_response_ms": 1500},
        {"outcome": "usable", "suggestion_count": 0},
        {"platform": "https://x.com/user/status/id"},
        {"cache_status": "cold"},
        {"generation_mode": "probably_model"},
        {"outcome": "empty"},
        {"outcome": "cancelled"},
        {"event_id": "11111111-1111-1111-8111-111111111111"},
    ],
)
async def test_rejects_invalid_or_inconsistent_samples(
    settings: Settings, changes: dict[str, Any]
) -> None:
    response, _ = await post(
        settings, RecordingPerformanceStore(), {"samples": [sample(**changes)]}
    )
    assert response.status_code == 400


async def test_copied_is_not_inserted_and_insertion_requires_confirmation(
    settings: Settings,
) -> None:
    attachment = {
        "event_id": str(uuid4()),
        "kind": "attachment",
        "platform": "linkedin",
        "extension_version": "0.0.4",
        "outcome": "copied",
        "elapsed_ms": 4400.0,
        "selected_preparation_ms": 200.0,
    }
    store = RecordingPerformanceStore()
    response, _ = await post(settings, store, {"samples": [attachment]})
    assert response.status_code == 200
    response, _ = await post(settings, store, {"samples": [{**attachment, "outcome": "inserted"}]})
    assert response.status_code == 400
    response, _ = await post(
        settings, store, {"samples": [{**attachment, "native_attachment_confirmation_ms": 4000.0}]}
    )
    assert response.status_code == 400
    response, _ = await post(
        settings,
        store,
        {
            "samples": [
                {**attachment, "outcome": "inserted", "native_attachment_confirmation_ms": 4000.0}
            ]
        },
    )
    assert response.status_code == 200


@pytest.mark.parametrize("identity,status", [(None, 401), ("not-an-id", 400)])
async def test_requires_existing_identity_contract(
    settings: Settings, identity: str | None, status: int
) -> None:
    store = RecordingPerformanceStore()
    response, users = await post(settings, store, {"samples": [sample()]}, identity=identity)
    assert response.status_code == status
    assert store.samples == []
    assert users.ensured_users == []


async def test_bounds_batch_size_and_body_bytes(settings: Settings) -> None:
    store = RecordingPerformanceStore()
    response, _ = await post(settings, store, {"samples": [sample() for _ in range(21)]})
    assert response.status_code == 400
    response, _ = await post(settings, store, {"samples": [], "private": "x" * 33_000})
    assert response.status_code == 413
    assert store.samples == []


async def test_storage_errors_are_best_effort_and_content_free(
    settings: Settings, caplog: pytest.LogCaptureFixture
) -> None:
    class Failed(RecordingPerformanceStore):
        async def record(self, samples: Sequence[BrowserPerformanceSample]) -> int:
            raise RuntimeError("PRIVATE database driver details")

    response, _ = await post(settings, Failed(), {"samples": [sample()]})
    assert response.status_code == 503
    assert "PRIVATE" not in response.text + caplog.text


async def test_stalled_write_is_cancelled_and_bounded(
    settings: Settings, monkeypatch: pytest.MonkeyPatch
) -> None:
    cancelled = asyncio.Event()

    class Stalled(RecordingPerformanceStore):
        async def record(self, samples: Sequence[BrowserPerformanceSample]) -> int:
            try:
                await asyncio.Event().wait()
                return 0
            finally:
                cancelled.set()

    monkeypatch.setattr(route, "WRITE_TIMEOUT_SECONDS", 0.01)
    response, _ = await asyncio.wait_for(post(settings, Stalled(), {"samples": [sample()]}), 0.3)
    assert response.status_code == 503
    assert cancelled.is_set()


def test_sparse_quantiles_and_rates_are_unknown_with_explicit_coverage() -> None:
    row: dict[str, Any] = {"kind": "request", "samples": 10, **dict.fromkeys(OUTCOMES, 0)}
    row["usable"] = 5
    row["empty"] = 5
    for name in METRICS:
        row.update({f"{name}_count": 5, f"{name}_p50": 100.0, f"{name}_p95": 120.0})
    report = summarize_group(row)
    assert report["metrics"]["first_usable_preview_ms"] == {
        "samples": 5,
        "coverage": 0.5,
        "p50": None,
        "p95": None,
        "status": "insufficient_data",
    }
    assert report["rates"]["usable"]["rate"] is None
    assert report["rates"]["usable"]["denominator"] == 10
    assert "PRIVATE" not in json.dumps(report)
