"""
SAMARTH AI — Audit Service

Structured audit logging for security-relevant events.
All writes go to the MongoDB `audit_logs` collection.

Retention is configurable via AUDIT_LOG_RETENTION_DAYS (0 = infinite).
"""

import logging
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from app.core.config import get_settings
from app.core.database import Database
from app.models.audit import AuditEventType, AuditLogEntry

logger = logging.getLogger("samarth.audit")

COLLECTION = "audit_logs"


class AuditService:
    """Audit log writer and reader."""

    def __init__(self, db: Database):
        self._db = db
        self._collection = db.get_collection(COLLECTION)

    async def log_event(
        self,
        event_type: AuditEventType,
        *,
        user_id: Optional[str] = None,
        email: Optional[str] = None,
        target_user_id: Optional[str] = None,
        ip_address: str = "",
        user_agent: str = "",
        resource_type: Optional[str] = None,
        resource_id: Optional[str] = None,
        details: Optional[dict[str, Any]] = None,
    ) -> str:
        """
        Write an audit log entry. Returns the log_id.

        This method never raises — audit failures are logged but
        do not break the request flow.
        """
        log_id = str(uuid4())
        entry = AuditLogEntry(
            log_id=log_id,
            event_type=event_type,
            user_id=user_id,
            email=email,
            target_user_id=target_user_id,
            ip_address=ip_address,
            user_agent=user_agent,
            resource_type=resource_type,
            resource_id=resource_id,
            details=details or {},
            timestamp=datetime.now(timezone.utc),
        )

        try:
            await self._collection.insert_one(entry.model_dump())
            logger.info(
                "Audit: %s | user=%s | target=%s | ip=%s",
                event_type.value,
                user_id or email or "anonymous",
                target_user_id or "-",
                ip_address,
            )
        except Exception as exc:
            logger.error(
                "Failed to write audit log: %s (event=%s, user=%s)",
                exc,
                event_type.value,
                user_id or email,
            )

        return log_id

    log = log_event

    async def get_logs(
        self,
        *,
        event_type: Optional[AuditEventType] = None,
        user_id: Optional[str] = None,
        target_user_id: Optional[str] = None,
        since: Optional[datetime] = None,
        until: Optional[datetime] = None,
        skip: int = 0,
        limit: int = 50,
    ) -> tuple[list[dict[str, Any]], int]:
        """
        Query audit logs with optional filters.
        Returns (logs, total_count).
        """
        query: dict[str, Any] = {}

        if event_type:
            query["event_type"] = event_type.value
        if user_id:
            query["user_id"] = user_id
        if target_user_id:
            query["target_user_id"] = target_user_id
        if since or until:
            ts_filter: dict[str, Any] = {}
            if since:
                ts_filter["$gte"] = since
            if until:
                ts_filter["$lte"] = until
            query["timestamp"] = ts_filter

        total = await self._collection.count_documents(query)
        cursor = (
            self._collection.find(query, {"_id": 0})
            .sort("timestamp", -1)
            .skip(skip)
            .limit(limit)
        )
        logs = await cursor.to_list(length=limit)
        return logs, total

    async def ensure_indexes(self) -> None:
        """Create indexes for efficient audit log queries."""
        await self._collection.create_index("timestamp")
        await self._collection.create_index("user_id")
        await self._collection.create_index("event_type")
        await self._collection.create_index("target_user_id")

        # Configurable TTL index for retention
        settings = get_settings()
        if settings.AUDIT_LOG_RETENTION_DAYS > 0:
            await self._collection.create_index(
                "timestamp",
                expireAfterSeconds=settings.AUDIT_LOG_RETENTION_DAYS * 86400,
                name="audit_ttl_index",
            )
            logger.info(
                "Audit log TTL index set: %d days",
                settings.AUDIT_LOG_RETENTION_DAYS,
            )
        else:
            logger.info("Audit log retention: infinite (no TTL)")
