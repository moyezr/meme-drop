from __future__ import annotations

from uuid import UUID, uuid4

import pytest
from fastapi import HTTPException

from memedrop_api.identity import DEV_USER_ID, resolve_install_identity
from memedrop_api.services.suggestion_engine import SuggestionService
from tests.conftest import INSTALL_ID, ApiHarness

HEADERS = {"x-memedrop-install-id": str(INSTALL_ID)}
MEME_ID = UUID("22222222-2222-4222-8222-222222222222")


def test_resolve_install_identity_preserves_development_and_production_rules() -> None:
    assert resolve_install_identity(install_id=None, require_install_id=False) == DEV_USER_ID
    assert (
        resolve_install_identity(install_id=str(INSTALL_ID), require_install_id=True) == INSTALL_ID
    )

    with pytest.raises(HTTPException, match="x-memedrop-install-id is required"):
        resolve_install_identity(install_id=None, require_install_id=True)


async def test_usage_requires_install_identity(api_harness: ApiHarness) -> None:
    response = await api_harness.client.post(
        "/api/v1/usage",
        json={"meme_id": str(MEME_ID), "action": "shown", "tweet_context": {}},
    )

    assert response.status_code == 401
    assert response.json() == {"error": "x-memedrop-install-id is required"}


async def test_invalid_install_identity_is_rejected(api_harness: ApiHarness) -> None:
    response = await api_harness.client.post(
        "/api/v1/usage",
        headers={"x-memedrop-install-id": "not-a-uuid"},
        json={"meme_id": str(MEME_ID), "action": "shown", "tweet_context": {}},
    )

    assert response.status_code == 400
    assert response.json() == {"error": "x-memedrop-install-id must be a UUID"}


async def test_usage_records_safe_context_and_ensures_user(api_harness: ApiHarness) -> None:
    response = await api_harness.client.post(
        "/api/v1/usage",
        headers=HEADERS,
        json={
            "meme_id": str(MEME_ID),
            "action": "used",
            "source": "global",
            "tweet_context": {
                "sentiment": "negative",
                "tone": "sarcastic",
                "topic": "tech",
                "intent": "dunking",
                "intensity": 0.8,
            },
        },
    )

    assert response.status_code == 200
    assert response.json() == {"logged": True}
    assert api_harness.store.ensured_users == [INSTALL_ID]
    assert api_harness.store.usage_events[0]["tweetContext"] == {
        "sentiment": "negative",
        "tone": "sarcastic",
        "topic": "tech",
        "intent": "dunking",
        "intensity": 0.8,
    }


async def test_usage_accepts_legacy_source_fields_but_never_persists_them(
    api_harness: ApiHarness,
) -> None:
    response = await api_harness.client.post(
        "/api/v1/usage",
        headers=HEADERS,
        json={
            "meme_id": str(MEME_ID),
            "action": "used",
            "tweet_context": {
                "joke_target": "the exact post subject",
                "keywords": ["source", "terms"],
            },
        },
    )

    assert response.status_code == 200
    assert api_harness.store.usage_events[0]["tweetContext"] == {}


async def test_usage_batch_records_events_and_ensures_user_once(api_harness: ApiHarness) -> None:
    response = await api_harness.client.post(
        "/api/v1/usage/batch",
        headers=HEADERS,
        json={
            "events": [
                {"meme_id": str(MEME_ID), "action": "shown", "tweet_context": {}},
                {"meme_id": str(MEME_ID), "action": "clicked", "tweet_context": {}},
            ]
        },
    )

    assert response.status_code == 200
    assert response.json() == {"logged": 2}
    assert api_harness.store.ensured_users == [INSTALL_ID]
    assert [event["action"] for event in api_harness.store.usage_events] == ["shown", "clicked"]


async def test_usage_writes_invalidate_only_the_users_feedback_cache(
    api_harness: ApiHarness, monkeypatch: pytest.MonkeyPatch
) -> None:
    invalidated: list[UUID] = []

    def record_invalidation(_: SuggestionService, user_id: UUID) -> None:
        invalidated.append(user_id)

    monkeypatch.setattr(SuggestionService, "invalidate_feedback", record_invalidation)

    single = await api_harness.client.post(
        "/api/v1/usage",
        headers=HEADERS,
        json={
            "meme_id": str(MEME_ID),
            "action": "shown",
            "tweet_context": {},
            "event_id": str(uuid4()),
            "telemetry_version": 2,
        },
    )
    batch = await api_harness.client.post(
        "/api/v1/usage/batch",
        headers=HEADERS,
        json={
            "events": [
                {
                    "meme_id": str(MEME_ID),
                    "action": "clicked",
                    "tweet_context": {},
                    "event_id": str(uuid4()),
                    "telemetry_version": 2,
                }
            ]
        },
    )

    assert single.status_code == batch.status_code == 200
    assert invalidated == [INSTALL_ID, INSTALL_ID]
    neutral = await api_harness.client.post(
        "/api/v1/usage/batch",
        headers=HEADERS,
        json={
            "events": [
                {
                    "meme_id": str(MEME_ID),
                    "action": "copied",
                    "event_id": str(uuid4()),
                    "telemetry_version": 2,
                }
            ]
        },
    )
    legacy = await api_harness.client.post(
        "/api/v1/usage",
        headers=HEADERS,
        json={"meme_id": str(MEME_ID), "action": "used"},
    )
    assert neutral.status_code == legacy.status_code == 200
    assert invalidated == [INSTALL_ID, INSTALL_ID]


async def test_usage_batch_requires_between_one_and_fifty_events(api_harness: ApiHarness) -> None:
    empty = await api_harness.client.post(
        "/api/v1/usage/batch", headers=HEADERS, json={"events": []}
    )
    oversized = await api_harness.client.post(
        "/api/v1/usage/batch",
        headers=HEADERS,
        json={
            "events": [
                {"meme_id": str(MEME_ID), "action": "shown", "tweet_context": {}} for _ in range(51)
            ]
        },
    )

    assert empty.status_code == 400
    assert oversized.status_code == 400


async def test_usage_accepts_every_supported_action(api_harness: ApiHarness) -> None:
    actions = [
        "suggested",
        "shown",
        "clicked",
        "used",
        "inserted",
        "saved",
        "dismissed",
        "copied",
        "rejected",
        "abandoned",
        "attachment_failed",
    ]
    for action in actions:
        response = await api_harness.client.post(
            "/api/v1/usage",
            headers=HEADERS,
            json={"meme_id": str(MEME_ID), "action": action, "tweet_context": {}},
        )
        assert response.status_code == 200, action

    assert [event["action"] for event in api_harness.store.usage_events] == actions


async def test_usage_rejects_unknown_actions_and_context_fields(
    api_harness: ApiHarness,
) -> None:
    unknown_action = await api_harness.client.post(
        "/api/v1/usage",
        headers=HEADERS,
        json={"meme_id": str(MEME_ID), "action": "hovered", "tweet_context": {}},
    )
    unknown_context = await api_harness.client.post(
        "/api/v1/usage",
        headers=HEADERS,
        json={
            "meme_id": str(MEME_ID),
            "action": "shown",
            "tweet_context": {"raw_tweet_text": "must not be stored"},
        },
    )

    assert unknown_action.status_code == 400
    assert unknown_action.json()["error"] == "Invalid request"
    assert unknown_context.status_code == 400
    assert unknown_context.json()["error"] == "Invalid request"
    assert "Extra inputs" in str(unknown_context.json()["details"])


async def test_usage_rejects_oversized_context(api_harness: ApiHarness) -> None:
    response = await api_harness.client.post(
        "/api/v1/usage",
        headers=HEADERS,
        json={
            "meme_id": str(MEME_ID),
            "action": "shown",
            "tweet_context": {"humor_angle": "x" * 181},
        },
    )

    assert response.status_code == 400
    assert response.json()["error"] == "Invalid request"


async def test_versioned_feedback_is_retry_safe_and_has_only_reviewed_context(
    api_harness: ApiHarness,
) -> None:
    impression_id = str(uuid4())
    event = {
        "meme_id": str(MEME_ID),
        "action": "inserted",
        "event_id": str(uuid4()),
        "telemetry_version": 2,
        "impression_id": impression_id,
        "position": 2,
        "tweet_context": {
            "topic": "tech",
            "reply_style": "source text",
            "humor_angle": "raw model text",
        },
    }
    for _ in range(2):
        response = await api_harness.client.post(
            "/api/v1/usage/batch", headers=HEADERS, json={"events": [event, event]}
        )
        assert response.status_code == 200
    assert len(api_harness.store.usage_events) == 1
    assert api_harness.store.usage_events[0]["tweetContext"] == {
        "topic": "tech",
        "telemetry_version": 2,
        "impression_id": impression_id,
        "position": 2,
    }


@pytest.mark.parametrize(
    "metadata",
    [
        {"telemetry_version": 2},
        {"event_id": "not-random"},
        {"impression_id": "source-derived"},
        {"position": 0},
        {"position": 6},
        {"position": 1.5},
        {"telemetry_version": 3},
    ],
)
async def test_usage_rejects_invalid_impression_metadata(
    api_harness: ApiHarness, metadata: dict
) -> None:
    response = await api_harness.client.post(
        "/api/v1/usage",
        headers=HEADERS,
        json={
            "meme_id": str(MEME_ID),
            "action": "shown",
            **metadata,
        },
    )
    assert response.status_code == 400
    assert api_harness.store.usage_events == []
