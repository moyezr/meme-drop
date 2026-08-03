from __future__ import annotations

from uuid import UUID

from tests.conftest import INSTALL_ID, ApiHarness
from tests.fakes import make_user_meme

HEADERS = {"x-memedrop-install-id": str(INSTALL_ID)}
MEME_ID = UUID("22222222-2222-4222-8222-222222222222")


async def test_account_export_requires_install_id(api_harness: ApiHarness) -> None:
    response = await api_harness.client.get("/api/v1/account/export")

    assert response.status_code == 401
    assert response.json() == {"error": "x-memedrop-install-id is required"}


async def test_account_export_returns_library_and_usage(api_harness: ApiHarness) -> None:
    api_harness.store.user_memes.append(make_user_meme(user_id=INSTALL_ID, meme_id=MEME_ID))
    await api_harness.store.record_usage(
        user_id=INSTALL_ID,
        meme_id=MEME_ID,
        action="shown",
        tweet_context={},
        source="global",
    )

    response = await api_harness.client.get("/api/v1/account/export", headers=HEADERS)

    assert response.status_code == 200
    body = response.json()
    assert body["install_id"] == str(INSTALL_ID)
    assert len(body["library"]) == 1
    assert len(body["usage_events"]) == 1
    assert body["exported_at"].endswith("+00:00")


async def test_account_delete_removes_records_and_files(api_harness: ApiHarness) -> None:
    api_harness.store.user_memes.append(
        make_user_meme(user_id=INSTALL_ID, meme_id=MEME_ID, file_path="/memes/account-delete.png")
    )
    await api_harness.store.record_usage(
        user_id=INSTALL_ID,
        meme_id=MEME_ID,
        action="used",
        tweet_context={},
        source="global",
    )

    response = await api_harness.client.delete("/api/v1/account", headers=HEADERS)

    assert response.status_code == 200
    assert response.json() == {
        "deleted": True,
        "install_id": str(INSTALL_ID),
        "deleted_library_items": 1,
        "deleted_usage_events": 1,
        "deleted_files": 1,
        "deleted_account": True,
    }
    assert api_harness.store.user_memes == []
    assert api_harness.store.usage_events == []
    assert api_harness.deleted_paths == ["/memes/account-delete.png"]
