from __future__ import annotations

import json
from unittest.mock import Mock

import httpx
import pytest

from memedrop_api.config import Settings
from memedrop_api.services.catalog import MemeCatalog
from memedrop_api.services.openrouter import (
    OpenRouterSuggestionGateway,
    clamp_score,
    strip_json_fence,
)


def settings() -> Settings:
    return Settings(database_url="postgresql://localhost/test", openrouter_api_key="secret")


async def test_gateway_filters_invalid_and_duplicate_template_selections() -> None:
    templates = MemeCatalog.load().verified_templates[:2]
    content = {
        "suggestions": [
            {"template_id": templates[0].template_id, "reason": "best", "score": 2},
            {"template_id": templates[0].template_id, "reason": "duplicate", "score": 0.5},
            {"template_id": "not-valid", "reason": "bad", "score": 1},
        ]
    }
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps(content)}}]},
            request=request,
        )
    )
    async with httpx.AsyncClient(transport=transport) as client:
        gateway = OpenRouterSuggestionGateway(settings(), client)
        result = await gateway.select_templates("tweet", templates, 2)

    assert len(result) == 1
    assert result[0].template_id == templates[0].template_id
    assert result[0].score == 1


async def test_gateway_parses_batched_caption_response() -> None:
    template = MemeCatalog.load().verified_templates[0]
    content = {"captions": {template.template_id: {"regions": {template.regions[0].id: "caption"}}}}
    transport = httpx.MockTransport(
        lambda request: httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps(content)}}]},
            request=request,
        )
    )
    async with httpx.AsyncClient(transport=transport) as client:
        gateway = OpenRouterSuggestionGateway(settings(), client)
        result = await gateway.generate_captions("tweet", [template])

    assert result == {template.template_id: {template.regions[0].id: "caption"}}


async def test_gateway_reuses_owned_client_for_selection_and_captions(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    template = MemeCatalog.load().verified_templates[0]
    responses = iter(
        [
            {"suggestions": [{"template_id": template.template_id, "score": 0.9}]},
            {"captions": {template.template_id: {"regions": {template.regions[0].id: "caption"}}}},
        ]
    )
    requests: list[httpx.Request] = []

    def respond(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        return httpx.Response(
            200,
            json={"choices": [{"message": {"content": json.dumps(next(responses))}}]},
            request=request,
        )

    client = httpx.AsyncClient(
        transport=httpx.MockTransport(respond)
    )
    client_factory = Mock(return_value=client)
    monkeypatch.setattr("memedrop_api.services.openrouter.httpx.AsyncClient", client_factory)
    gateway = OpenRouterSuggestionGateway(settings())

    await gateway.select_templates("tweet", [template], 1)
    await gateway.generate_captions("tweet", [template])

    assert client_factory.call_count == 1
    assert len(requests) == 2
    await gateway.close()


async def test_gateway_close_only_closes_owned_client(monkeypatch) -> None:  # type: ignore[no-untyped-def]
    owned_client = httpx.AsyncClient()
    injected_client = httpx.AsyncClient()
    factory = Mock(return_value=owned_client)
    monkeypatch.setattr("memedrop_api.services.openrouter.httpx.AsyncClient", factory)
    owned_gateway = OpenRouterSuggestionGateway(settings())

    await owned_gateway._get_client()
    await owned_gateway.close()
    await owned_gateway.close()

    assert owned_client.is_closed
    with pytest.raises(RuntimeError, match="gateway is closed"):
        await owned_gateway._get_client()

    injected_gateway = OpenRouterSuggestionGateway(settings(), injected_client)
    await injected_gateway.close()

    assert not injected_client.is_closed
    await injected_client.aclose()


async def test_gateway_is_disabled_without_api_key() -> None:
    gateway = OpenRouterSuggestionGateway(
        Settings(database_url="postgresql://localhost/test", openrouter_api_key="")
    )
    template = MemeCatalog.load().verified_templates[0]

    assert await gateway.select_templates("tweet", [template], 1) == []
    assert await gateway.generate_captions("tweet", [template]) == {}


def test_openrouter_helpers_handle_fences_and_bad_scores() -> None:
    assert strip_json_fence("```json\n{}\n```") == "{}"
    assert clamp_score("bad") == 0.8
    assert clamp_score(-1) == 0
