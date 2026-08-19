from memedrop_api.db import (
    Base,
    TrendCardRecord,
    TrendObservationRecord,
    TrendSnapshotRecord,
    database_connect_args,
    normalize_database_url,
)


def test_postgres_urls_use_async_psycopg_driver() -> None:
    assert normalize_database_url("postgresql://db/memedrop") == (
        "postgresql+psycopg://db/memedrop"
    )
    assert normalize_database_url("postgres://db/memedrop") == ("postgresql+psycopg://db/memedrop")
    assert normalize_database_url("postgresql+psycopg://db/memedrop") == (
        "postgresql+psycopg://db/memedrop"
    )


def test_database_models_preserve_existing_table_names() -> None:
    assert set(Base.metadata.tables) == {
        "users",
        "memes",
        "user_memes",
        "usage_events",
        "catalog_drafts",
        "trend_cards",
        "trend_observations",
        "trend_snapshots",
    }


def test_trend_tables_keep_raw_provider_content_out_of_durable_storage() -> None:
    assert set(TrendObservationRecord.__table__.columns.keys()) == {
        "id",
        "trend_id",
        "observation_key",
        "provider",
        "source_url",
        "source_url_hash",
        "source_domain",
        "content_hash",
        "published_at",
        "first_seen_at",
        "last_seen_at",
        "seen_count",
        "provider_score",
        "provider_result_id",
        "query_fingerprint",
    }
    assert "embedding" in TrendCardRecord.__table__.columns
    assert "cards" in TrendSnapshotRecord.__table__.columns
    assert "raw_content" not in Base.metadata.tables["trend_observations"].columns


def test_transaction_pooler_disables_psycopg_prepared_statements() -> None:
    assert database_connect_args(
        "postgresql://postgres.project:secret@aws-0-region.pooler.supabase.com:6543/postgres"
    ) == {"prepare_threshold": None}
    assert database_connect_args("postgresql://localhost:5432/memedrop") == {}
