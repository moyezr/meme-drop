from datetime import timedelta
from typing import cast

import pytest

from memedrop_api.db import Database
from memedrop_api.trend_collection_store import SqlAlchemyTrendCollectionStore


def test_collection_store_bounds_claim_leases_and_worker_identity() -> None:
    database = cast(Database, object())

    with pytest.raises(ValueError, match="claim lease"):
        SqlAlchemyTrendCollectionStore(database, claim_lease=timedelta(seconds=59))
    with pytest.raises(ValueError, match="worker id"):
        SqlAlchemyTrendCollectionStore(database, worker_id="contains spaces")

    store = SqlAlchemyTrendCollectionStore(
        database,
        claim_lease=timedelta(minutes=5),
        worker_id="worker-01",
    )
    assert store.claim_lease == timedelta(minutes=5)
    assert store.worker_id == "worker-01"
