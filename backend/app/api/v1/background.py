"""Protected Phase 16 background-job and in-app-notification APIs."""

from __future__ import annotations

import hashlib
from uuid import uuid4

from fastapi import APIRouter, Depends, Header, HTTPException, Request

from app.core.config import get_settings
from app.core.database import Database, get_database
from app.core.dependencies import get_current_user, get_jurisdiction_filter, require_role
from app.core.rate_limit import get_client_ip
from app.models.background import (
    BackgroundJobListResponse,
    BackgroundJobRecord,
    BackgroundJobStatus,
    BackgroundJobType,
    JobTriggerRequest,
    ManualEscalationRequest,
    ManualEscalationResponse,
    NotificationListResponse,
    NotificationPreference,
    NotificationPreferenceUpdate,
    NotificationRecord,
)
from app.models.case_management import CaseReasonRequest
from app.models.user import UserInDB, UserRole
from app.services.background_job_service import BackgroundJobService
from app.services.case_management_service import CaseManagementService
from app.services.notification_service import NotificationService
from app.tasks.background_tasks import JOB_TASKS

router = APIRouter(prefix="/api/v1/background", tags=["Background Processing & Notifications"])
job_read_dep = require_role(UserRole.ADMIN, UserRole.MOSPI)
job_write_dep = require_role(UserRole.ADMIN)
manual_escalation_dep = require_role(UserRole.DISTRICT_AUTHORITY, UserRole.ADMIN)


def _context(request: Request) -> dict[str, str]:
    return {
        "ip_address": get_client_ip(request),
        "user_agent": request.headers.get("user-agent", ""),
    }


@router.get("/jobs", response_model=BackgroundJobListResponse, summary="List durable background job records")
async def list_jobs(
    job_type: BackgroundJobType | None = None,
    user: UserInDB = Depends(job_read_dep),
    db: Database = Depends(get_database),
):
    jobs = await BackgroundJobService(db).list(job_type=job_type)
    return BackgroundJobListResponse(jobs=jobs, total=len(jobs))


@router.get("/jobs/{job_id}", response_model=BackgroundJobRecord, summary="Get durable job state")
async def get_job(
    job_id: str,
    user: UserInDB = Depends(job_read_dep),
    db: Database = Depends(get_database),
):
    job = await BackgroundJobService(db).get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Background job not found")
    return job


@router.post("/jobs/{job_type}", response_model=BackgroundJobRecord, status_code=202, summary="Queue an idempotent background job")
async def queue_job(
    job_type: BackgroundJobType,
    body: JobTriggerRequest,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: UserInDB = Depends(job_write_dep),
    db: Database = Depends(get_database),
):
    key = idempotency_key or body.idempotency_key or f"manual:{job_type.value}:{user.user_id}:{uuid4()}"
    tracker = BackgroundJobService(db)
    job = await tracker.create_or_get(
        job_type=job_type, idempotency_key=key, payload=body.payload,
        requested_by=user.user_id, max_retries=get_settings().CELERY_TASK_MAX_RETRIES,
    )
    if job.status in {BackgroundJobStatus.QUEUED, BackgroundJobStatus.RETRYING}:
        try:
            queued = JOB_TASKS[job_type].apply_async(args=[job.job_id])
            job = await tracker.set_celery_task_id(job.job_id, queued.id) or job
        except Exception as exc:
            await tracker.record_failure(job.job_id, exc, will_retry=False)
            raise HTTPException(status_code=503, detail="The background queue is unavailable. Retry later or use the manual escalation fallback where applicable.") from exc
    return job


@router.post("/manual-escalation", response_model=ManualEscalationResponse, summary="Manual demo fallback for SLA escalation")
async def manual_escalation(
    body: ManualEscalationRequest,
    request: Request,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    user: UserInDB = Depends(manual_escalation_dep),
    jurisdiction_filter: dict = Depends(get_jurisdiction_filter),
    db: Database = Depends(get_database),
):
    digest = hashlib.sha256(body.reason.strip().encode("utf-8")).hexdigest()[:16]
    key = idempotency_key or f"manual-escalation:{body.case_id}:{digest}"
    tracker = BackgroundJobService(db)
    job = await tracker.create_or_get(
        job_type=BackgroundJobType.AUTO_ESCALATION, idempotency_key=key,
        payload={"case_id": body.case_id, "manual_demo": True}, requested_by=user.user_id,
        max_retries=0,
    )
    if job.status == BackgroundJobStatus.COMPLETED:
        level = str(job.result.get("escalation_level", "state"))
        return ManualEscalationResponse(job=job, escalation_level=level)
    await tracker.start(job.job_id)
    service = CaseManagementService(db)
    case = await service.get_case_for_manager(body.case_id, jurisdiction_filter=jurisdiction_filter)
    if not case:
        await tracker.record_failure(job.job_id, "Case not found in your jurisdiction", will_retry=False)
        raise HTTPException(status_code=404, detail="Case not found in your jurisdiction")
    updated = await service.escalate(body.case_id, CaseReasonRequest(reason=body.reason), actor=user.user_id, **_context(request))
    if not updated:
        await tracker.record_failure(job.job_id, "Case cannot be escalated from its current state", will_retry=False)
        raise HTTPException(status_code=409, detail="Case cannot be escalated from its current state")
    job = await tracker.complete(job.job_id, {"case_id": updated.case_id, "escalation_level": updated.escalation_level, "manual_demo": True}) or job
    return ManualEscalationResponse(job=job, escalation_level=updated.escalation_level)


@router.get("/notifications", response_model=NotificationListResponse, summary="List the current user’s privacy-safe in-app notifications")
async def list_notifications(
    user: UserInDB = Depends(get_current_user),
    db: Database = Depends(get_database),
):
    notifications, unread = await NotificationService(db).list_in_app(user.user_id)
    return NotificationListResponse(notifications=notifications, total=len(notifications), unread_total=unread)


@router.put("/notifications/read-all", summary="Mark all in-app notifications as read")
async def read_all_notifications(
    user: UserInDB = Depends(get_current_user),
    db: Database = Depends(get_database),
):
    count = await NotificationService(db).mark_all_read(user.user_id)
    return {"marked_read": count}


@router.put("/notifications/{notification_id}/read", response_model=NotificationRecord, summary="Mark an in-app notification as read")
async def read_notification(
    notification_id: str,
    user: UserInDB = Depends(get_current_user),
    db: Database = Depends(get_database),
):
    notification = await NotificationService(db).mark_read(notification_id, recipient_user_id=user.user_id)
    if not notification:
        raise HTTPException(status_code=404, detail="Notification not found")
    return notification


@router.get("/notification-preferences", response_model=NotificationPreference, summary="Get current notification preferences")
async def get_notification_preferences(
    user: UserInDB = Depends(get_current_user),
    db: Database = Depends(get_database),
):
    return await NotificationService(db).get_preferences(user.user_id)


@router.put("/notification-preferences", response_model=NotificationPreference, summary="Update notification preferences")
async def update_notification_preferences(
    body: NotificationPreferenceUpdate,
    user: UserInDB = Depends(get_current_user),
    db: Database = Depends(get_database),
):
    return await NotificationService(db).update_preferences(user.user_id, body)
