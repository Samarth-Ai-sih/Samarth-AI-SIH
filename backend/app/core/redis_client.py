"""
SAMARTH AI — Async Redis Client

Connection manager for Redis used by:
- Rate limiting (login throttling)
- Future: cache, pub/sub

Uses redis-py 5.x async API (redis.asyncio).
"""

import logging
from typing import Optional

import redis.asyncio as aioredis

from app.core.config import Settings

logger = logging.getLogger("samarth.redis")


class RedisClient:
    """Async Redis connection manager."""

    def __init__(self, settings: Settings):
        self._settings = settings
        self._client: Optional[aioredis.Redis] = None

    @property
    def client(self) -> aioredis.Redis:
        if self._client is None:
            raise RuntimeError("Redis not connected. Call connect() first.")
        return self._client

    async def connect(self) -> None:
        """Establish connection to Redis."""
        logger.info("Connecting to Redis at %s", self._settings.REDIS_URL)
        self._client = aioredis.from_url(
            self._settings.REDIS_URL,
            decode_responses=True,
            socket_connect_timeout=5,
            socket_timeout=5,
            retry_on_timeout=True,
        )
        try:
            await self._client.ping()
            logger.info("Redis connection established successfully")
        except Exception as exc:
            logger.error("Failed to connect to Redis: %s", exc)
            self._client = None
            raise

    async def disconnect(self) -> None:
        """Close Redis connection."""
        if self._client is not None:
            await self._client.aclose()
            self._client = None
            logger.info("Redis connection closed")

    async def is_healthy(self) -> bool:
        """Check if Redis connection is alive."""
        if self._client is None:
            return False
        try:
            await self._client.ping()
            return True
        except Exception as exc:
            logger.warning("Redis health check failed: %s", exc)
            return False


# ── Global instance ──────────────────────────────────────────────
_redis_client: Optional[RedisClient] = None


def get_redis_client() -> RedisClient:
    """Get the global RedisClient instance. Used as a FastAPI dependency."""
    if _redis_client is None:
        raise RuntimeError("Redis not initialized")
    return _redis_client


def set_redis_client(client: RedisClient) -> None:
    """Set the global RedisClient instance."""
    global _redis_client
    _redis_client = client
