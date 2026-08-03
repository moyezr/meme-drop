from __future__ import annotations

from collections.abc import Mapping
from datetime import UTC, datetime
from typing import Any
from uuid import UUID, uuid4


class FakeStore:
    def __init__(self) -> None:
        self.ensured_users: list[UUID] = []
        self.memes: list[dict[str, Any]] = []
        self.user_memes: list[dict[str, Any]] = []
        self.usage_events: list[dict[str, Any]] = []
        self.last_browse_filters: dict[str, Any] | None = None
        self.last_library_filters: dict[str, Any] | None = None
        self.deleted_account = False
        self.feedback_scores: dict[str, float] = {}

    async def ensure_install_user(self, user_id: UUID) -> None:
        self.ensured_users.append(user_id)

    async def browse_memes(
        self, *, format_type: str | None, emotion: str | None, search: str | None
    ) -> list[dict[str, Any]]:
        self.last_browse_filters = {
            "format_type": format_type,
            "emotion": emotion,
            "search": search,
        }
        return self.memes

    async def list_global_memes(self) -> list[dict[str, Any]]:
        return self.memes

    async def get_global_meme(self, meme_id: UUID) -> dict[str, Any] | None:
        return next((row for row in self.memes if row["id"] == str(meme_id)), None)

    async def global_meme_feedback_scores(self, user_id: UUID) -> dict[str, float]:
        return self.feedback_scores

    async def create_user_meme(
        self,
        *,
        user_id: UUID,
        file_path: str,
        user_name: str,
        system_tags: Mapping[str, Any],
    ) -> dict[str, Any]:
        meme = make_user_meme(
            user_id=user_id,
            file_path=file_path,
            user_name=user_name,
            system_tags=dict(system_tags),
        )
        self.user_memes.append(meme)
        return meme

    async def list_user_memes(
        self,
        user_id: UUID,
        *,
        search: str | None,
        tag: str | None,
        emotion: str | None,
        sort: str,
    ) -> list[dict[str, Any]]:
        self.last_library_filters = {
            "user_id": user_id,
            "search": search,
            "tag": tag,
            "emotion": emotion,
            "sort": sort,
        }
        return [row for row in self.user_memes if row["userId"] == str(user_id)]

    async def update_user_meme(
        self,
        user_id: UUID,
        meme_id: UUID,
        *,
        user_name: str | None,
        user_tags: list[str] | None,
    ) -> dict[str, Any] | None:
        row = self._find_user_meme(user_id, meme_id)
        if row is None:
            return None
        if user_name is not None:
            row["userName"] = user_name
        if user_tags is not None:
            row["userTags"] = user_tags
        return row

    async def delete_user_meme(self, user_id: UUID, meme_id: UUID) -> dict[str, Any] | None:
        row = self._find_user_meme(user_id, meme_id)
        if row is None:
            return None
        self.user_memes.remove(row)
        return row

    async def record_usage(
        self,
        *,
        user_id: UUID,
        meme_id: UUID,
        action: str,
        tweet_context: Mapping[str, Any],
        source: str | None,
    ) -> None:
        self.usage_events.append(
            {
                "id": str(uuid4()),
                "userId": str(user_id),
                "memeId": str(meme_id),
                "action": action,
                "tweetContext": dict(tweet_context),
                "source": source,
                "createdAt": datetime.now(UTC).isoformat(),
            }
        )

    async def export_account(
        self, user_id: UUID
    ) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
        return (
            [row for row in self.user_memes if row["userId"] == str(user_id)],
            [row for row in self.usage_events if row["userId"] == str(user_id)],
        )

    async def delete_account(self, user_id: UUID) -> tuple[list[dict[str, Any]], int, int, bool]:
        library, usage = await self.export_account(user_id)
        self.user_memes = [row for row in self.user_memes if row not in library]
        self.usage_events = [row for row in self.usage_events if row not in usage]
        self.deleted_account = True
        return library, len(library), len(usage), True

    def _find_user_meme(self, user_id: UUID, meme_id: UUID) -> dict[str, Any] | None:
        return next(
            (
                row
                for row in self.user_memes
                if row["userId"] == str(user_id) and row["id"] == str(meme_id)
            ),
            None,
        )


def make_user_meme(
    *,
    user_id: UUID,
    meme_id: UUID | None = None,
    file_path: str = "/memes/test.png",
    user_name: str = "Test Meme",
    system_tags: dict[str, Any] | None = None,
) -> dict[str, Any]:
    now = datetime.now(UTC).isoformat()
    return {
        "id": str(meme_id or uuid4()),
        "userId": str(user_id),
        "globalMemeId": None,
        "filePath": file_path,
        "userName": user_name,
        "userTags": [],
        "systemTags": system_tags or {"emotion": "confused", "use_cases": ["reaction"]},
        "embedding": None,
        "useCount": 0,
        "lastUsedAt": None,
        "createdAt": now,
    }
