from __future__ import annotations

from uuid import UUID

import pytest
from fastapi import HTTPException

from memedrop_api.identity import DEV_USER_ID, resolve_install_identity
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


async def test_usage_records_all_context_and_ensures_user(api_harness: ApiHarness) -> None:
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
                "keywords": ["deploy", "prod"],
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
        "keywords": ["deploy", "prod"],
    }


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


async def test_usage_batch_requires_between_one_and_fifty_events(api_harness: ApiHarness) -> None:
    empty = await api_harness.client.post(
        "/api/v1/usage/batch", headers=HEADERS, json={"events": []}
    )
    oversized = await api_harness.client.post(
        "/api/v1/usage/batch",
        headers=HEADERS,
        json={
            "events": [
                {"meme_id": str(MEME_ID), "action": "shown", "tweet_context": {}}
                for _ in range(51)
            ]
        },
    )

    assert empty.status_code == 400
    assert oversized.status_code == 400


async def test_usage_accepts_every_supported_action(api_harness: ApiHarness) -> None:
    actions = ["suggested", "shown", "clicked", "used", "inserted", "saved", "dismissed"]
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
