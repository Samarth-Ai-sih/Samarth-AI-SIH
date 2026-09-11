"""Retryable Phase 16 Celery jobs with MongoDB durability and idempotency."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Awaitable, Callable

from celery import Task

from app.celery_app import celery_app
from app.core.config import get_settings
from app.core.database import Database
from app.ml.model_registry import ModelRegistry
from app.models.background import BackgroundJobStatus, BackgroundJobType, NotificationEventType
from app.models.case_management import CaseReasonRequest, CaseStatus
from app.services.background_job_service import BackgroundJobService
from app.services.case_management_service import CaseManagementService, TERMINAL_STATUSES
from app.services.duplicate_detection_service import DuplicateDetectionService
from app.services.evidence_verification_service import EvidenceVerificationService
from app.services.ingestion import IngestionService
from app.services.notification_service import NotificationService
from app.services.risk_service import RiskScoringService

logger = logging.getLogger("samarth.tasks")
settings = get_settings()


async def _with_database(operation: Callable[[Database], Awaitable[dict[str, Any]]]) -> dict[str, Any]:
    db = Database(settings)
    await db.connect()
    try:
        return await operation(db)
    finally:
        await db.disconnect()


async def _execute(
    task: Task,
    job_id: str,
    operation: Callable[[Database, dict[str, Any], str], Awaitable[dict[str, Any]]],
) -> dict[str, Any]:
    async def run(db: Database) -> dict[str, Any]:
        tracker = BackgroundJobService(db)
        job = await tracker.get(job_id)
        if not job:
            raise ValueError("Tracked background job was not found")
        if job.status == BackgroundJobStatus.COMPLETED:
            return {"job_id": job.job_id, "status": "already_completed", **job.result}
        job = await tracker.start(job_id, celery_task_id=task.request.id)
        if not job:
            raise ValueError("Tracked background job was not found")
        try:
            result = await operation(db, job.payload, job.job_id)
        except Exception as exc:
            will_retry = task.request.retries < job.max_retries
            await tracker.record_failure(job_id, exc, will_retry=will_retry)
            raise
        completed = await tracker.complete(job_id, result)
        return {"job_id": job_id, "status": completed.status.value if completed else "completed", **result}

    return await _with_database(run)


def _task(job_type: BackgroundJobType, queue: str = "default"):
    return celery_app.task(
        bind=True,
        name=f"samarth.jobs.{job_type.value}",
        queue=queue,
        autoretry_for=(Exception,),
        retry_backoff=True,
        retry_backoff_max=600,
        retry_jitter=True,
        max_retries=settings.CELERY_TASK_MAX_RETRIES,
    )


async def _scheduled_ingestion(db: Database, payload: dict[str, Any], job_id: str) -> dict[str, Any]:
    service = IngestionService(db)
    requested_batch_id = str(payload.get("batch_id") or "")
    batches = [requested_batch_id] if requested_batch_id else [
        str(item["batch_id"])
        for item in await db.get_collection("import_batches").find({"status": "validated"}, {"_id": 0, "batch_id": 1}).to_list(length=None)
        if item.get("batch_id")
    ]
    completed = 0
    for batch_id in sorted(set(batches)):
        result = await service.import_batch(batch_id)
        if result.status in {"completed", "partially_completed"}:
            completed += 1
    return {"batches_considered": len(batches), "batches_imported": completed}


async def _batch_risk_scoring(db: Database, payload: dict[str, Any], job_id: str) -> dict[str, Any]:
    risk = RiskScoringService(db)
    notifications = NotificationService(db)
    requested = payload.get("work_ids")
    query = {"work_id": {"$in": requested}} if isinstance(requested, list) else {}
    works = await db.get_collection("works").find(query, {"_id": 0, "work_id": 1, "state_code": 1, "district_code": 1}).to_list(length=None)
    scored = red_alerts = material_changes = 0
    for work in sorted(works, key=lambda item: str(item.get("work_id", ""))):
        work_id = str(work.get("work_id", ""))
        if not work_id:
            continue
        previous = await risk.get_latest_score(work_id)
        score = await risk.score_work(work_id, calculated_by="background_worker", operation_key=f"{job_id}:risk:{work_id}")
        if not score:
            continue
        scored += 1
        prefix = f"risk:{score.score_id}"
        if score.risk_tier.value == "red":
            red_alerts += await notifications.create_for_roles(
                roles={"district_authority"}, state_code=str(work.get("state_code") or ""), district_code=str(work.get("district_code") or ""),
                event_type=NotificationEventType.RED_ALERT_ASSIGNED, resource_type="risk_score", resource_id=score.score_id,
                idempotency_prefix=prefix,
            )
        if previous and abs(float(previous.get("composite_score", 0)) - score.composite_score) >= 15:
            material_changes += await notifications.create_for_roles(
                roles={"district_authority", "state_nodal_officer"}, state_code=str(work.get("state_code") or ""), district_code=str(work.get("district_code") or ""),
                event_type=NotificationEventType.MATERIAL_RISK_SCORE_CHANGE, resource_type="risk_score", resource_id=score.score_id,
                idempotency_prefix=f"risk-change:{score.score_id}",
            )
    return {"works_scored": scored, "red_alert_recipients": red_alerts, "material_change_recipients": material_changes}


async def _alert_generation(db: Database, _payload: dict[str, Any], job_id: str) -> dict[str, Any]:
    risk = RiskScoringService(db)
    notifications = NotificationService(db)
    scores, _, _ = await risk.list_latest_scores(tier="red", page=1, page_size=100000)
    created = 0
    works = db.get_collection("works")
    for score in scores:
        work = await works.find_one({"work_id": score["work_id"]}, {"_id": 0, "state_code": 1, "district_code": 1}) or {}
        created += await notifications.create_for_roles(
            roles={"district_authority"}, state_code=str(work.get("state_code") or ""), district_code=str(work.get("district_code") or ""),
            event_type=NotificationEventType.RED_ALERT_ASSIGNED, resource_type="risk_score", resource_id=str(score["score_id"]),
            idempotency_prefix=f"red-alert:{score['score_id']}",
        )
    return {"red_scores_processed": len(scores), "notifications_created": created}


def _due_date(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


async def _sla_monitoring(db: Database, _payload: dict[str, Any], _job_id: str) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    threshold = now + timedelta(hours=settings.CELERY_SLA_WARNING_HOURS)
    notifications = NotificationService(db)
    cases = await db.get_collection("cases").find({}, {"_id": 0}).to_list(length=None)
    approaching = 0
    for case in cases:
        due = _due_date(case.get("due_date"))
        if not due or due < now or due > threshold or case.get("status") in {status.value for status in TERMINAL_STATUSES}:
            continue
        approaching += await notifications.create_for_roles(
            roles={"district_authority"}, state_code=str(case.get("state_code") or ""), district_code=str(case.get("district_code") or ""),
            event_type=NotificationEventType.SLA_BREACH_APPROACHING, resource_type="case", resource_id=str(case.get("case_id", "")),
            idempotency_prefix=f"sla-warning:{case.get('case_id')}:{due.date().isoformat()}",
        )
    return {"cases_approaching_sla": approaching}


async def _auto_escalation(db: Database, _payload: dict[str, Any], _job_id: str) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    service = CaseManagementService(db)
    cases = await db.get_collection("cases").find({}, {"_id": 0}).to_list(length=None)
    escalated = 0
    for doc in cases:
        due = _due_date(doc.get("due_date"))
        if not due or due > now:
            continue
        try:
            case = await service._case(str(doc.get("case_id", "")))  # scoped internally below; worker is a system actor.
        except Exception:
            case = None
        if not case or case.status in TERMINAL_STATUSES:
            continue
        # First overdue SLA goes to State. A still-unresolved state escalation
        # progresses to MoSPI only after one more SLA warning window.
        if case.escalation_level == "state" and case.escalated_at and now - case.escalated_at < timedelta(hours=settings.CELERY_SLA_WARNING_HOURS):
            continue
        updated = await service.escalate(
            case.case_id,
            CaseReasonRequest(reason="SLA deadline elapsed; automatically routed for the next review level."),
            actor="system_sla_monitor",
        )
        if updated:
            escalated += 1
    return {"cases_escalated": escalated, "route": "District Authority → State Nodal Authority → MoSPI / Ministry"}


async def _evidence_refresh(db: Database, payload: dict[str, Any], _job_id: str) -> dict[str, Any]:
    evidence_id = str(payload.get("evidence_id") or "")
    if not evidence_id:
        raise ValueError("evidence_id is required for metadata processing")
    service = EvidenceVerificationService(
        db, gps_tolerance_meters=settings.EVIDENCE_GPS_TOLERANCE_METERS,
        timestamp_tolerance_days=settings.EVIDENCE_TIMESTAMP_TOLERANCE_DAYS,
        phash_distance_threshold=settings.EVIDENCE_PHASH_DISTANCE_THRESHOLD,
    )
    return await service.refresh_local_metadata(evidence_id)


async def _duplicate_scan(db: Database, _payload: dict[str, Any], _job_id: str) -> dict[str, Any]:
    scan = await DuplicateDetectionService(db).scan(created_by="background_worker")
    return {"scan_id": scan.scan_id, "works_evaluated": scan.works_evaluated, "matches_created": scan.matches_created, "clusters_created": scan.clusters_created}


async def _notification_delivery(db: Database, payload: dict[str, Any], _job_id: str) -> dict[str, Any]:
    return await NotificationService(db).deliver_pending(notification_id=payload.get("notification_id"))


async def _report_generation(db: Database, _payload: dict[str, Any], job_id: str) -> dict[str, Any]:
    risk = RiskScoringService(db)
    distribution = await risk.distribution()
    counts = {
        "works": await db.get_collection("works").count_documents({}),
        "cases": await db.get_collection("cases").count_documents({}),
        "citizen_reports": await db.get_collection("citizen_issues").count_documents({}),
        "risk_distribution": distribution.model_dump(),
    }
    report = {"report_id": job_id, "report_type": "operational_summary", "generated_at": datetime.now(timezone.utc), "summary": counts}
    await db.get_collection("generated_reports").insert_one(report)
    return {"report_id": job_id, **counts}


async def _model_monitoring(db: Database, _payload: dict[str, Any], job_id: str) -> dict[str, Any]:
    models = await ModelRegistry(db).list_models()
    predictions = await db.get_collection("model_predictions").find({}, {"_id": 0, "inference_source": 1, "model_version": 1}).to_list(length=None)
    fallback = sum(1 for item in predictions if item.get("inference_source") == "deterministic_heuristic_fallback")
    result = {"model_registry_entries": len(models), "predictions_observed": len(predictions), "fallback_predictions": fallback, "note": "Operational availability monitoring only; this job does not claim model accuracy."}
    await db.get_collection("model_monitoring_reports").insert_one({"monitoring_id": job_id, "created_at": datetime.now(timezone.utc), **result})
    return result


@_task(BackgroundJobType.SCHEDULED_DATA_INGESTION)
def scheduled_data_ingestion(self: Task, job_id: str) -> dict[str, Any]: return asyncio.run(_execute(self, job_id, _scheduled_ingestion))

@_task(BackgroundJobType.BATCH_RISK_SCORING, "scoring")
def batch_risk_scoring(self: Task, job_id: str) -> dict[str, Any]: return asyncio.run(_execute(self, job_id, _batch_risk_scoring))

@_task(BackgroundJobType.ALERT_GENERATION, "scoring")
def alert_generation(self: Task, job_id: str) -> dict[str, Any]: return asyncio.run(_execute(self, job_id, _alert_generation))

@_task(BackgroundJobType.SLA_MONITORING, "escalation")
def sla_monitoring(self: Task, job_id: str) -> dict[str, Any]: return asyncio.run(_execute(self, job_id, _sla_monitoring))

@_task(BackgroundJobType.AUTO_ESCALATION, "escalation")
def auto_escalation(self: Task, job_id: str) -> dict[str, Any]: return asyncio.run(_execute(self, job_id, _auto_escalation))

@_task(BackgroundJobType.EXIF_EXTRACTION, "evidence")
def exif_extraction(self: Task, job_id: str) -> dict[str, Any]: return asyncio.run(_execute(self, job_id, _evidence_refresh))

@_task(BackgroundJobType.PHASH_GENERATION, "evidence")
def phash_generation(self: Task, job_id: str) -> dict[str, Any]: return asyncio.run(_execute(self, job_id, _evidence_refresh))

@_task(BackgroundJobType.DUPLICATE_WORK_SCAN, "scoring")
def duplicate_work_scan(self: Task, job_id: str) -> dict[str, Any]: return asyncio.run(_execute(self, job_id, _duplicate_scan))

@_task(BackgroundJobType.NOTIFICATION_DELIVERY, "notifications")
def notification_delivery(self: Task, job_id: str) -> dict[str, Any]: return asyncio.run(_execute(self, job_id, _notification_delivery))

@_task(BackgroundJobType.REPORT_GENERATION)
def report_generation(self: Task, job_id: str) -> dict[str, Any]: return asyncio.run(_execute(self, job_id, _report_generation))

@_task(BackgroundJobType.MODEL_MONITORING)
def model_monitoring(self: Task, job_id: str) -> dict[str, Any]: return asyncio.run(_execute(self, job_id, _model_monitoring))


JOB_TASKS = {
    BackgroundJobType.SCHEDULED_DATA_INGESTION: scheduled_data_ingestion,
    BackgroundJobType.BATCH_RISK_SCORING: batch_risk_scoring,
    BackgroundJobType.ALERT_GENERATION: alert_generation,
    BackgroundJobType.SLA_MONITORING: sla_monitoring,
    BackgroundJobType.AUTO_ESCALATION: auto_escalation,
    BackgroundJobType.EXIF_EXTRACTION: exif_extraction,
    BackgroundJobType.PHASH_GENERATION: phash_generation,
    BackgroundJobType.DUPLICATE_WORK_SCAN: duplicate_work_scan,
    BackgroundJobType.NOTIFICATION_DELIVERY: notification_delivery,
    BackgroundJobType.REPORT_GENERATION: report_generation,
    BackgroundJobType.MODEL_MONITORING: model_monitoring,
}


@celery_app.task(bind=True, name="samarth.jobs.periodic_dispatch")
def periodic_dispatch(self: Task, job_type_value: str) -> dict[str, Any]:
    job_type = BackgroundJobType(job_type_value)

    async def schedule(db: Database) -> dict[str, Any]:
        now = datetime.now(timezone.utc)
        bucket = now.strftime("%Y%m%d") if job_type in {BackgroundJobType.DUPLICATE_WORK_SCAN, BackgroundJobType.MODEL_MONITORING, BackgroundJobType.REPORT_GENERATION} else now.strftime("%Y%m%d%H")
        job = await BackgroundJobService(db).create_or_get(
            job_type=job_type, idempotency_key=f"periodic:{job_type.value}:{bucket}", requested_by="celery_beat",
            max_retries=settings.CELERY_TASK_MAX_RETRIES,
        )
        if job.status in {BackgroundJobStatus.QUEUED, BackgroundJobStatus.RETRYING}:
            result = JOB_TASKS[job_type].apply_async(args=[job.job_id])
            await BackgroundJobService(db).set_celery_task_id(job.job_id, result.id)
            return {"job_id": job.job_id, "celery_task_id": result.id, "dispatched": True}
        return {"job_id": job.job_id, "status": job.status.value, "dispatched": False}

    return asyncio.run(_with_database(schedule))
