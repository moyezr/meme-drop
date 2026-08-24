from sqlalchemy.dialects import postgresql

from memedrop_api.trend_repository import (
    _embedding_is_stale,
    _store_card_embedding_statement,
)
from memedrop_api.trends import trend_id_for_key


def test_embedding_model_and_fingerprint_control_idempotent_recomputation() -> None:
    fingerprint = "a" * 64
    assert _embedding_is_stale(
        missing=False,
        stored_model="google/gemini-embedding-2",
        stored_fingerprint=fingerprint,
        required_model="google/gemini-embedding-2",
        required_fingerprint=fingerprint,
    ) is False
    assert _embedding_is_stale(
        missing=True,
        stored_model="google/gemini-embedding-2",
        stored_fingerprint=fingerprint,
        required_model="google/gemini-embedding-2",
        required_fingerprint=fingerprint,
    )
    assert _embedding_is_stale(
        missing=False,
        stored_model="google/gemini-embedding-2",
        stored_fingerprint=fingerprint,
        required_model="provider/new-embedding-space",
        required_fingerprint=fingerprint,
    )
    assert _embedding_is_stale(
        missing=False,
        stored_model="google/gemini-embedding-2",
        stored_fingerprint=fingerprint,
        required_model="google/gemini-embedding-2",
        required_fingerprint="b" * 64,
    )


def test_embedding_write_is_a_compare_and_set_on_card_version() -> None:
    statement = _store_card_embedding_statement(
        card_id=trend_id_for_key("version-race"),
        embedding=[0.0] * 1_536,
        model="google/gemini-embedding-2",
        fingerprint="a" * 64,
        expected_version=7,
    )
    compiled = statement.compile(dialect=postgresql.dialect())
    sql = str(compiled)

    assert "trend_cards.id =" in sql
    assert "trend_cards.version =" in sql
    assert "trend_cards.embedding IS NULL" in sql
    assert 7 in compiled.params.values()
