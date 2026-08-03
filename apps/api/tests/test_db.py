from memedrop_api.db import Base, normalize_database_url


def test_postgres_urls_use_async_psycopg_driver() -> None:
    assert normalize_database_url("postgresql://db/memedrop") == (
        "postgresql+psycopg://db/memedrop"
    )
    assert normalize_database_url("postgres://db/memedrop") == ("postgresql+psycopg://db/memedrop")
    assert normalize_database_url("postgresql+psycopg://db/memedrop") == (
        "postgresql+psycopg://db/memedrop"
    )


def test_database_models_preserve_existing_table_names() -> None:
    assert set(Base.metadata.tables) == {"users", "memes", "user_memes", "usage_events"}
