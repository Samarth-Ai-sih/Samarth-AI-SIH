"""
SAMARTH AI — Celery Application

Celery worker configuration for background tasks:
- Batch risk scoring
- SLA escalation
- Notification dispatch
- Scheduled data processing
"""

import logging

from celery import Celery

from app.core.config import get_settings

logger = logging.getLogger("samarth.celery")

settings = get_settings()

celery_app = Celery(
    "samarth_ai",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    include=["app.tasks.background_tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="Asia/Kolkata",
    enable_utc=True,
    task_track_started=True,
    task_time_limit=600,  # 10 minutes hard limit
    task_soft_time_limit=540,  # 9 minutes soft limit
    worker_prefetch_multiplier=1,
    worker_max_tasks_per_child=100,
    result_expires=3600,  # 1 hour
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    task_default_queue="default",
    task_routes={
        "samarth.jobs.batch_risk_scoring": {"queue": "scoring"},
        "samarth.jobs.alert_generation": {"queue": "scoring"},
        "samarth.jobs.exif_extraction": {"queue": "evidence"},
        "samarth.jobs.phash_generation": {"queue": "evidence"},
        "samarth.jobs.duplicate_work_scan": {"queue": "scoring"},
        "samarth.jobs.notification_delivery": {"queue": "notifications"},
        "samarth.jobs.sla_monitoring": {"queue": "escalation"},
        "samarth.jobs.auto_escalation": {"queue": "escalation"},
    },
    beat_schedule={
        "samarth-risk-scoring-every-4-hours": {
            "task": "samarth.jobs.periodic_dispatch", "schedule": 4 * 60 * 60,
            "args": ["batch_risk_scoring"],
        },
        "samarth-alert-generation-every-4-hours": {
            "task": "samarth.jobs.periodic_dispatch", "schedule": 4 * 60 * 60,
            "args": ["alert_generation"],
        },
        "samarth-sla-monitoring-hourly": {
            "task": "samarth.jobs.periodic_dispatch", "schedule": 60 * 60,
            "args": ["sla_monitoring"],
        },
        "samarth-auto-escalation-hourly": {
            "task": "samarth.jobs.periodic_dispatch", "schedule": 60 * 60,
            "args": ["auto_escalation"],
        },
        "samarth-notifications-every-5-minutes": {
            "task": "samarth.jobs.periodic_dispatch", "schedule": 5 * 60,
            "args": ["notification_delivery"],
        },
        "samarth-duplicate-scan-nightly": {
            "task": "samarth.jobs.periodic_dispatch", "schedule": 24 * 60 * 60,
            "args": ["duplicate_work_scan"],
        },
        "samarth-model-monitoring-nightly": {
            "task": "samarth.jobs.periodic_dispatch", "schedule": 24 * 60 * 60,
            "args": ["model_monitoring"],
        },
        "samarth-report-generation-nightly": {
            "task": "samarth.jobs.periodic_dispatch", "schedule": 24 * 60 * 60,
            "args": ["report_generation"],
        },
        "samarth-scheduled-ingestion-every-6-hours": {
            "task": "samarth.jobs.periodic_dispatch", "schedule": 6 * 60 * 60,
            "args": ["scheduled_data_ingestion"],
        },
    },
)

# Auto-discover the durable Phase 16 job catalogue.
celery_app.autodiscover_tasks(["app.tasks"], force=True)


@celery_app.task(bind=True, name="samarth.health_check")
def celery_health_check(self):
    """Simple task to verify Celery is working."""
    return {"status": "ok", "worker": self.request.hostname}
