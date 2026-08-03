from __future__ import annotations

import asyncio
import time
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol
from uuid import UUID

from sqlalchemy import text

from memedrop_api.db import Database

EXPENSIVE_ROUTES = {
    "POST /api/v1/suggest",
    "POST /api/v1/suggest/caption",
    "POST /api/v1/library/save",
    "GET /api/v1/account/export",
    "DELETE /api/v1/account",
}


class RateLimitStore(Protocol):
    async def setup(self) -> None: ...
    async def consume(self, key: str, window_ms: int, maximum: int) -> bool: ...


@dataclass
class Bucket:
    count: int
    reset_at: float


class MemoryRateLimitStore:
    def __init__(self) -> None:
        self.buckets: dict[str, Bucket] = {}
        self.lock = asyncio.Lock()

    async def setup(self) -> None:
        return None

    async def consume(self, key: str, window_ms: int, maximum: int) -> bool:
        now = time.monotonic()
        async with self.lock:
            bucket = self.buckets.get(key)
            if bucket is None or bucket.reset_at <= now:
                self.buckets[key] = Bucket(count=1, reset_at=now + window_ms / 1000)
                if len(self.buckets) >= 1000:
                    self.buckets = {
                        item_key: item
                        for item_key, item in self.buckets.items()
                        if item.reset_at > now
                    }
                return True
            bucket.count += 1
            return bucket.count <= maximum


class PostgresRateLimitStore:
    def __init__(self, database: Database) -> None:
        self.database = database

    async def setup(self) -> None:
        async with self.database.engine.begin() as connection:
            await connection.execute(
                text(
                    """
                    CREATE TABLE IF NOT EXISTS api_rate_limits (
                      bucket_key text PRIMARY KEY,
                      count integer NOT NULL,
                      reset_at timestamptz NOT NULL
                    )
                    """
                )
            )
            await connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS api_rate_limits_reset_at_idx "
                    "ON api_rate_limits (reset_at)"
                )
            )

    async def consume(self, key: str, window_ms: int, maximum: int) -> bool:
        statement = text(
            """
            INSERT INTO api_rate_limits (bucket_key, count, reset_at)
            VALUES (:key, 1, now() + (:window_ms * interval '1 millisecond'))
            ON CONFLICT (bucket_key) DO UPDATE SET
              count = CASE
                WHEN api_rate_limits.reset_at <= now() THEN 1
                ELSE api_rate_limits.count + 1
              END,
              reset_at = CASE
                WHEN api_rate_limits.reset_at <= now()
                  THEN now() + (:window_ms * interval '1 millisecond')
                ELSE api_rate_limits.reset_at
              END
            RETURNING count
            """
        )
        async with self.database.engine.begin() as connection:
            result = await connection.execute(statement, {"key": key, "window_ms": window_ms})
            return int(result.scalar_one()) <= maximum


def rate_limit_client_key(headers: Mapping[str, str], client_ip: str | None) -> str:
    install_id = headers.get("x-memedrop-install-id")
    if install_id:
        try:
            return f"install:{str(UUID(install_id)).lower()}"
        except ValueError:
            pass
    forwarded = headers.get("x-forwarded-for", "").split(",", 1)[0].strip()
    return f"ip:{forwarded or client_ip or 'unknown'}"
