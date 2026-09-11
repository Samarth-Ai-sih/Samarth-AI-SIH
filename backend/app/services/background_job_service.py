"""MongoDB-backed job tracking used by Celery workers and manual demo runs."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from app.core.database import Database
from app.models.background import (
    BackgroundJobRecord,
    BackgroundJobStatus,
    BackgroundJobType,
)

logger = logging.getLogger("samarth.background_jobs")

JOBS_COLLECTION = "background_jobs"


class BackgroundJobService:
    """Tracks each background operation independently of the Celery result TTL.

    ``idempotency_key`` is caller supplied for manual work and deterministic for
    periodic jobs. Returning an already-completed job prevents a retry from
    duplicating an irreversible workflow transition.
    """

    def __init__(self, db: Database):
        self._jobs = db.get_collection(JOBS_COLLECTION)

    async def ensure_indexes(self) -> None:
        await self._jobs.create_index("job_id", unique=True)
        await self._jobs.create_index("idempotency_key", unique=True)
        await self._jobs.create_index([("job_type", 1), ("created_at", -1)])
        await self._jobs.create_index([("status", 1), ("updated_at", -1)])

    async def create_or_get(
        self,
        *,
        job_type: BackgroundJobType,
        idempotency_key: str,
        payload: Optional[dict[str, Any]] = None,
        requested_by: str = "system",
        max_retries: int = 4,
    ) -> BackgroundJobRecord:
        existing = await self._jobs.find_one({"idempotency_key": idempotency_key}, {"_id": 0})
        if existing:
            return BackgroundJobRecord(**existing)
        now = datetime.now(timezone.utc)
        record = BackgroundJobRecord(
            job_id=str(uuid4()), job_type=job_type, idempotency_key=idempotency_key,
            payload=payload or {}, requested_by=requested_by, max_retries=max_retries,
            created_at=now, updated_at=now,
        )
        try:
            await self._jobs.insert_one(record.model_dump(mode="python"))
        except Exception:
            # A competing request may have won the unique-key race. Read it
            # back; otherwise preserve the original exception for retry logic.
            existing = await self._jobs.find_one({"idempotency_key": idempotency_key}, {"_id": 0})
            if not existing:
                raise
            return BackgroundJobRecord(**existing)
        return record

    async def get(self, job_id: str) -> Optional[BackgroundJobRecord]:
        document = await self._jobs.find_one({"job_id": job_id}, {"_id": 0})
        return BackgroundJobRecord(**document) if document else None

    async def list(
        self,
        *,
        job_type: Optional[BackgroundJobType] = None,
        limit: int = 100,
    ) -> list[BackgroundJobRecord]:
        query: dict[str, Any] = {"job_type": job_type.value} if job_type else {}
        docs = await self._jobs.find(query, {"_id": 0}).sort([("created_at", -1)]).limit(limit).to_list(length=limit)
        return [BackgroundJobRecord(**doc) for doc in docs]

    async def start(self, job_id: str, *, celery_task_id: Optional[str] = None) -> Optional[BackgroundJobRecord]:
        record = await self.get(job_id)
        if not record:
            return None
        if record.status == BackgroundJobStatus.COMPLETED:
            return record
        now = datetime.now(timezone.utc)
        updates = {
            "status": BackgroundJobStatus.RUNNING.value,
            "attempt_count": record.attempt_count + 1,
            "started_at": record.started_at or now,
            "updated_at": now,
            "error_summary": "",
        }
        if celery_task_id:
            updates["celery_task_id"] = celery_task_id
        await self._jobs.update_one({"job_id": job_id}, {"$set": updates})
        return await self.get(job_id)

    async def set_celery_task_id(self, job_id: str, celery_task_id: str) -> Optional[BackgroundJobRecord]:
        await self._jobs.update_one(
            {"job_id": job_id},
            {"$set": {"celery_task_id": celery_task_id, "updated_at": datetime.now(timezone.utc)}},
        )
        return await self.get(job_id)

    async def complete(self, job_id: str, result: Optional[dict[str, Any]] = None) -> Optional[BackgroundJobRecord]:
        record = await self.get(job_id)
        if not record:
            return None
        if record.status == BackgroundJobStatus.COMPLETED:
            return record
        now = datetime.now(timezone.utc)
        await self._jobs.update_one(
            {"job_id": job_id},
            {"$set": {"status": BackgroundJobStatus.COMPLETED.value, "result": result or {}, "completed_at": now, "updated_at": now, "error_summary": ""}},
        )
        return await self.get(job_id)

    async def record_failure(self, job_id: str, error: Exception | str, *, will_retry: bool) -> Optional[BackgroundJobRecord]:
        record = await self.get(job_id)
        if not record:
            return None
        # Do not persist request payloads, stack traces, or source records;
        # those can contain sensitive material. Workers retain full errors in
        # structured server logs keyed by this job ID.
        summary = str(error).replace("\n", " ")[:500]
        status = BackgroundJobStatus.RETRYING if will_retry else BackgroundJobStatus.FAILED
        await self._jobs.update_one(
            {"job_id": job_id},
            {"$set": {"status": status.value, "error_summary": summary, "updated_at": datetime.now(timezone.utc)}},
        )
        logger.exception("Background job failed: job_id=%s retry=%s", job_id, will_retry)
        return await self.get(job_id)
