"""Small, bounded coordination primitives for scheduled trend refreshes."""

from __future__ import annotations

from secrets import token_urlsafe

from redis.asyncio import Redis

TREND_REFRESH_LOCK_KEY = "memedrop:trend-refresh:lock"
_RELEASE_IF_OWNER = """
if redis.call('get', KEYS[1]) == ARGV[1] then
    return redis.call('del', KEYS[1])
end
return 0
"""


class RedisTrendRefreshLock:
    """A short lease that prevents duplicate cron deliveries from running together.

    The random lease token is compared by Redis before deleting the lock. This means a
    slow worker cannot release a newer worker's lease after its own TTL expires.
    """

    def __init__(
        self,
        redis_url: str,
        *,
        ttl_seconds: int,
        key: str = TREND_REFRESH_LOCK_KEY,
    ) -> None:
        self._redis = Redis.from_url(redis_url, decode_responses=True)
        self._ttl_seconds = ttl_seconds
        self._key = key

    async def acquire(self) -> str | None:
        token = token_urlsafe(32)
        acquired = await self._redis.set(
            self._key,
            token,
            nx=True,
            ex=self._ttl_seconds,
        )
        return token if acquired else None

    async def release(self, token: str) -> bool:
        result = await self._redis.eval(_RELEASE_IF_OWNER, 1, self._key, token)
        return bool(result)

    async def close(self) -> None:
        await self._redis.aclose()
