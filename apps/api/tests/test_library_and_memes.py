from __future__ import annotations

from uuid import UUID

import pytest

from tests.conftest import INSTALL_ID, ApiHarness
from tests.fakes import make_user_meme

HEADERS = {"x-memedrop-install-id": str(INSTALL_ID)}
MEME_ID = UUID("22222222-2222-4222-8222-222222222222")


async def test_browse_memes_passes_validated_filters(api_harness: ApiHarness) -> None:
    api_harness.store.memes = [{"id": str(MEME_ID), "name": "This Is Fine"}]

    response = await api_harness.client.get(
        "/api/v1/memes/browse?format=text_overlay&emotion=sarcastic&search=fine"
    )

    assert response.status_code == 200
    assert response.json() == {"memes": api_harness.store.memes}
    assert api_harness.store.last_browse_filters == {
        "format_type": "text_overlay",
        "emotion": "sarcastic",
        "search": "fine",
    }


async def test_browse_memes_rejects_oversized_filter(api_harness: ApiHarness) -> None:
    response = await api_harness.client.get(f"/api/v1/memes/browse?search={'x' * 121}")

    assert response.status_code == 400
    assert response.json()["error"] == "Invalid request"


async def test_save_meme_downloads_tags_and_persists(api_harness: ApiHarness) -> None:
    response = await api_harness.client.post(
        "/api/v1/library/save",
        headers=HEADERS,
        json={"image_url": "https://cdn.example.com/reaction.png"},
    )

    assert response.status_code == 200
    meme = response.json()["meme"]
    assert meme["filePath"] == f"/memes/users/{INSTALL_ID}/downloaded.png"
    assert meme["userName"] == "Saved Reaction"
    assert meme["systemTags"]["emotion"] == "sarcastic"


async def test_save_meme_validates_url_before_identity(api_harness: ApiHarness) -> None:
    response = await api_harness.client.post(
        "/api/v1/library/save", json={"image_url": "not-a-url"}
    )

    assert response.status_code == 400
    assert response.json()["error"] == "Invalid request"


async def test_save_meme_removes_uploaded_object_when_database_write_fails(
    api_harness: ApiHarness, monkeypatch: pytest.MonkeyPatch
) -> None:
    async def fail_create(**_: object) -> dict[str, object]:
        raise RuntimeError("database unavailable")

    monkeypatch.setattr(api_harness.store, "create_user_meme", fail_create)

    response = await api_harness.client.post(
        "/api/v1/library/save",
        headers=HEADERS,
        json={"image_url": "https://cdn.example.com/reaction.png"},
    )

    expected_path = f"/memes/users/{INSTALL_ID}/downloaded.png"
    assert response.status_code == 400
    assert response.json() == {"error": "Failed to save meme"}
    assert api_harness.deleted_paths == [expected_path]


async def test_list_library_returns_contract_and_filters(api_harness: ApiHarness) -> None:
    api_harness.store.user_memes.append(make_user_meme(user_id=INSTALL_ID, meme_id=MEME_ID))

    response = await api_harness.client.get(
        "/api/v1/library?search=test&tag=reaction&emotion=confused&sort=alphabetical",
        headers=HEADERS,
    )

    assert response.status_code == 200
    assert response.json()["total"] == 1
    assert response.json()["page"] == 1
    assert response.json()["memes"][0]["id"] == str(MEME_ID)
    assert api_harness.store.last_library_filters == {
        "user_id": INSTALL_ID,
        "search": "test",
        "tag": "reaction",
        "emotion": "confused",
        "sort": "alphabetical",
    }


async def test_update_library_meme_and_reject_empty_update(api_harness: ApiHarness) -> None:
    api_harness.store.user_memes.append(make_user_meme(user_id=INSTALL_ID, meme_id=MEME_ID))

    updated = await api_harness.client.put(
        f"/api/v1/library/{MEME_ID}",
        headers=HEADERS,
        json={"user_name": "Renamed", "user_tags": ["work", "reaction"]},
    )
    empty = await api_harness.client.put(f"/api/v1/library/{MEME_ID}", headers=HEADERS, json={})

    assert updated.status_code == 200
    assert updated.json()["meme"]["userName"] == "Renamed"
    assert updated.json()["meme"]["userTags"] == ["work", "reaction"]
    assert empty.status_code == 400
    assert empty.json()["error"] == "Invalid request"


async def test_update_missing_library_meme_returns_404(api_harness: ApiHarness) -> None:
    response = await api_harness.client.put(
        f"/api/v1/library/{MEME_ID}", headers=HEADERS, json={"user_name": "Missing"}
    )

    assert response.status_code == 404
    assert response.json() == {"error": "Meme not found"}


async def test_delete_library_meme_removes_database_and_file(api_harness: ApiHarness) -> None:
    api_harness.store.user_memes.append(
        make_user_meme(user_id=INSTALL_ID, meme_id=MEME_ID, file_path="/memes/delete-me.png")
    )

    response = await api_harness.client.delete(f"/api/v1/library/{MEME_ID}", headers=HEADERS)

    assert response.status_code == 200
    assert response.json() == {"deleted": True}
    assert api_harness.store.user_memes == []
    assert api_harness.deleted_paths == ["/memes/delete-me.png"]
