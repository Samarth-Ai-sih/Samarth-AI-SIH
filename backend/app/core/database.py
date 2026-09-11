"""
SAMARTH AI — MongoDB Connection Layer

Async MongoDB client using Motor.
Provides connection lifecycle, health checks, and database access.
"""

import logging
from typing import Optional

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.errors import ConnectionFailure, ServerSelectionTimeoutError

from app.core.config import Settings

logger = logging.getLogger("samarth.database")


class Database:
    """
    Async MongoDB connection manager.

    Usage:
        db = Database(settings)
        await db.connect()
        collection = db.get_collection("works")
        await db.disconnect()
    """

    def __init__(self, settings: Settings):
        self._settings = settings
        self._client: Optional[AsyncIOMotorClient] = None
        self._db: Optional[AsyncIOMotorDatabase] = None
        self.using_development_fallback = False

    @property
    def client(self) -> AsyncIOMotorClient:
        if self._client is None:
            raise RuntimeError("Database not connected. Call connect() first.")
        return self._client

    @property
    def db(self) -> AsyncIOMotorDatabase:
        if self._db is None:
            raise RuntimeError("Database not connected. Call connect() first.")
        return self._db

    async def _connect_uri(self, uri: str, *, source: str) -> None:
        """Connect to and verify one configured MongoDB endpoint."""
        logger.info(
            "Connecting to MongoDB",
            extra={
                "source": source,
                "db_name": self._settings.MONGODB_DB_NAME,
                "min_pool": self._settings.MONGODB_MIN_POOL_SIZE,
                "max_pool": self._settings.MONGODB_MAX_POOL_SIZE,
            },
        )

        self._client = AsyncIOMotorClient(
            uri,
            minPoolSize=self._settings.MONGODB_MIN_POOL_SIZE,
            maxPoolSize=self._settings.MONGODB_MAX_POOL_SIZE,
            serverSelectionTimeoutMS=10_000,
            connectTimeoutMS=10_000,
            retryWrites=True,
            retryReads=True,
            appName="samarthAI",
        )
        self._db = self._client[self._settings.MONGODB_DB_NAME]

        # Verify connection
        try:
            await self._client.admin.command("ping")
            logger.info("MongoDB connection established successfully", extra={"source": source})
        except (ConnectionFailure, ServerSelectionTimeoutError) as exc:
            logger.error("Failed to connect to MongoDB: %s", exc, extra={"source": source})
            self._client.close()
            self._client = None
            self._db = None
            raise

    async def connect(self) -> None:
        """Establish the configured database connection with an explicit dev-only fallback."""
        fallback_uri = self._settings.MONGODB_DEV_FALLBACK_URI
        if self._settings.is_development and self._settings.MONGODB_USE_DEV_FALLBACK:
            logger.warning(
                "Using the explicitly selected local development MongoDB database"
            )
            await self._connect_uri(fallback_uri, source="development_fallback")
            self.using_development_fallback = True
            return

        try:
            await self._connect_uri(self._settings.MONGODB_URI, source="primary")
            return
        except (ConnectionFailure, ServerSelectionTimeoutError):
            if not (self._settings.is_development and fallback_uri):
                raise

        logger.warning(
            "Primary MongoDB is unavailable; using the explicitly configured local development fallback"
        )
        await self._connect_uri(fallback_uri, source="development_fallback")
        self.using_development_fallback = True

    async def disconnect(self) -> None:
        """Close MongoDB connection."""
        if self._client is not None:
            self._client.close()
            self._client = None
            self._db = None
            logger.info("MongoDB connection closed")

    async def is_healthy(self) -> bool:
        """Check if MongoDB connection is alive."""
        if self._client is None:
            return False
        try:
            await self._client.admin.command("ping")
            return True
        except Exception as exc:
            logger.warning("MongoDB health check failed: %s", exc)
            return False

    def get_collection(self, name: str):
        """Get a MongoDB collection by name."""
        return self.db[name]


# ── Global instance ──────────────────────────────────────────────
# Initialized in main.py lifespan
_database: Optional[Database] = None


def get_database() -> Database:
    """Get the global Database instance. Used as a FastAPI dependency."""
    if _database is None:
        raise RuntimeError("Database not initialized")
    return _database


def set_database(db: Database) -> None:
    """Set the global Database instance."""
    global _database
    _database = db
