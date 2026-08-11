from __future__ import annotations

import os
from collections.abc import AsyncIterator
from uuid import UUID, uuid4

import pytest
import pytest_asyncio
from sqlalchemy import delete, text

from memedrop_api.catalog_workbench import CatalogDraftConflict, SqlAlchemyCatalogDraftStore
from memedrop_api.db import Base, CatalogDraft, Database, Meme
from memedrop_api.repositories import SqlAlchemyStore

pytestmark = pytest.mark.integration
TEST_DATABASE_URL = os.environ.get("MEMEDROP_TEST_DATABASE_URL")


@pytest_asyncio.fixture
async def database() -> AsyncIterator[Database]:
    if not TEST_DATABASE_URL:
        pytest.skip("MEMEDROP_TEST_DATABASE_URL is not configured")
    database = Database(TEST_DATABASE_URL)
    async with database.engine.begin() as connection:
        await connection.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        await connection.run_sync(Base.metadata.create_all)
    try:
        yield database
    finally:
        await database.close()


async def test_sqlalchemy_store_exercises_every_data_feature(database: Database) -> None:
    store = SqlAlchemyStore(database)
    user_id = uuid4()
    global_id = uuid4()

    async with database.session() as session, session.begin():
        session.add(
            Meme(
                id=global_id,
                name="Integration This Is Fine",
                file_path="/memes/integration-global.png",
                format_type="text_overlay",
                is_evergreen=True,
                system_tags={"emotion": "sarcastic", "use_cases": ["cope"]},
            )
        )

    try:
        await store.ensure_install_user(user_id)
        await store.ensure_install_user(user_id)

        first = await store.create_user_meme(
            user_id=user_id,
            file_path="/memes/integration-first.png",
            user_name="Alpha Reaction",
            system_tags={
                "emotion": "confused",
                "use_cases": ["reaction", "relatability"],
            },
        )
        second = await store.create_user_meme(
            user_id=user_id,
            file_path="/memes/integration-second.png",
            user_name="Beta Meme",
            system_tags={"emotion": "sarcastic", "use_cases": ["dunking"]},
        )

        browsed = await store.browse_memes(
            format_type="text_overlay", emotion="sarcastic", search="This Is Fine"
        )
        assert [row["id"] for row in browsed if row["id"] == str(global_id)] == [str(global_id)]
        global_memes = await store.list_global_memes()
        assert str(global_id) in {row["id"] for row in global_memes}
        global_meme = await store.get_global_meme(global_id)
        assert global_meme is not None
        assert global_meme["name"] == "Integration This Is Fine"
        assert await store.get_global_meme(uuid4()) is None

        searched = await store.list_user_memes(
            user_id,
            search="Alpha",
            tag="reaction",
            emotion="confused",
            sort="alphabetical",
        )
        assert [row["id"] for row in searched] == [first["id"]]

        updated = await store.update_user_meme(
            user_id,
            UUID(first["id"]),
            user_name="Renamed Reaction",
            user_tags=["work", "favorite"],
        )
        assert updated is not None
        assert updated["userName"] == "Renamed Reaction"
        assert updated["userTags"] == ["work", "favorite"]

        await store.record_usage(
            user_id=user_id,
            meme_id=UUID(first["id"]),
            action="used",
            tweet_context={"tone": "sarcastic"},
            source=None,
        )
        await store.record_usage(
            user_id=user_id,
            meme_id=global_id,
            action="shown",
            tweet_context={"topic": "tech"},
            source="global",
        )

        library, usage = await store.export_account(user_id)
        used = next(row for row in library if row["id"] == first["id"])
        assert used["useCount"] == 1
        assert used["lastUsedAt"] is not None
        assert {row["action"] for row in usage} == {"used", "shown"}

        deleted = await store.delete_user_meme(user_id, UUID(second["id"]))
        assert deleted is not None
        assert deleted["id"] == second["id"]
        assert await store.delete_user_meme(user_id, UUID(second["id"])) is None

        saved, deleted_memes, deleted_usage, deleted_user = await store.delete_account(user_id)
        assert len(saved) == 1
        assert deleted_memes == 1
        assert deleted_usage == 2
        assert deleted_user is True
        assert await store.export_account(user_id) == ([], [])
    finally:
        async with database.session() as session, session.begin():
            await session.execute(delete(Meme).where(Meme.id == global_id))


async def test_catalog_drafts_use_postgres_revision_guards(database: Database) -> None:
    store = SqlAlchemyCatalogDraftStore(database)
    template_id = f"integration-catalog-{uuid4()}"
    asset_path = f"/memes/catalog/drafts/{template_id}/source.png"
    annotation = {
        "template_id": template_id,
        "name": "Integration Catalog Draft",
        "aliases": [],
        "source_image": asset_path,
        "supports_overlay": True,
        "quality": "draft",
        "regions": [],
        "caption_guidance": {"pattern": "", "good_examples": [], "bad_examples": []},
        "retrieval": {
            "version": 1,
            "joke_shapes": [],
            "positive_hints": [],
            "anti_hints": [],
        },
        "editorial": {"description": "", "use_cases": [], "anti_use_cases": []},
    }
    created = await store.create_draft(
        template_id=template_id,
        name="Integration Catalog Draft",
        asset_path=asset_path,
        thumbnail_path=None,
        source_url="https://example.test/source.png",
        annotation=annotation,
    )
    draft_id = UUID(created["id"])
    try:
        assert [
            row["id"] for row in await store.list_drafts(status="draft", search=template_id)
        ] == [created["id"]]
        annotation["name"] = "Updated Integration Catalog Draft"
        updated = await store.update_draft(
            draft_id,
            expected_revision=1,
            status="needs_work",
            annotation=annotation,
        )
        assert updated is not None
        assert updated["revision"] == 2
        assert updated["status"] == "needs_work"
        with pytest.raises(CatalogDraftConflict, match="another tab"):
            await store.update_draft(
                draft_id,
                expected_revision=1,
                status="draft",
                annotation=annotation,
            )
    finally:
        async with database.session() as session, session.begin():
            await session.execute(delete(CatalogDraft).where(CatalogDraft.id == draft_id))
