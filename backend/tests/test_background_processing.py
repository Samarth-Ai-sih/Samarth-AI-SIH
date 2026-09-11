"""Phase 16 tests for durable job tracking and privacy-safe notifications."""

import pytest

from app.models.background import (
    BackgroundJobStatus,
    BackgroundJobType,
    NotificationEventType,
    NotificationPreferenceUpdate,
)
from app.services.background_job_service import BackgroundJobService
from app.services.notification_service import NotificationService
from app.models.case_management import CaseCreateRequest, CaseReasonRequest
from app.services.case_management_service import CaseManagementService
from tests.test_risk_scoring import MemoryDatabase


@pytest.mark.asyncio
async def test_job_tracking_is_idempotent_and_persists_completion():
    db = MemoryDatabase({})
    service = BackgroundJobService(db)
    first = await service.create_or_get(
        job_type=BackgroundJobType.BATCH_RISK_SCORING,
        idempotency_key="risk-batch:20260909-12",
        payload={"work_ids": ["work-1"]},
    )
    repeated = await service.create_or_get(
        job_type=BackgroundJobType.BATCH_RISK_SCORING,
        idempotency_key="risk-batch:20260909-12",
        payload={"work_ids": ["work-1"]},
    )
    assert first.job_id == repeated.job_id
    assert len(db.get_collection("background_jobs").documents) == 1

    running = await service.start(first.job_id, celery_task_id="celery-1")
    assert running and running.status == BackgroundJobStatus.RUNNING and running.attempt_count == 1
    completed = await service.complete(first.job_id, {"works_scored": 1})
    assert completed and completed.status == BackgroundJobStatus.COMPLETED
    assert completed.result == {"works_scored": 1}


@pytest.mark.asyncio
async def test_notifications_are_idempotent_private_and_track_external_adapter_state():
    db = MemoryDatabase({
        "users": [{
            "user_id": "district-1", "email": "district@example.test", "role": "district_authority",
            "is_active": True, "jurisdiction": {"state_code": "UP", "district_code": "LKO"},
        }],
    })
    service = NotificationService(db)
    preferences = await service.update_preferences("district-1", NotificationPreferenceUpdate(email_enabled=True))
    assert preferences.in_app_enabled and preferences.email_enabled

    first = await service.create_event(
        recipient_user_id="district-1", event_type=NotificationEventType.RED_ALERT_ASSIGNED,
        resource_type="risk_score", resource_id="score-1", idempotency_key="red-score-1:district-1",
    )
    repeated = await service.create_event(
        recipient_user_id="district-1", event_type=NotificationEventType.RED_ALERT_ASSIGNED,
        resource_type="risk_score", resource_id="score-1", idempotency_key="red-score-1:district-1",
    )
    assert first.notification_id == repeated.notification_id
    assert len(db.get_collection("notifications").documents) == 1
    assert "score-1" not in first.message  # no sensitive work or case context in transport text

    notifications, unread = await service.list_in_app("district-1")
    assert len(notifications) == 1 and unread == 1
    read = await service.mark_read(first.notification_id, recipient_user_id="district-1")
    assert read and read.read_at is not None

    result = await service.deliver_pending(notification_id=first.notification_id)
    assert result["skipped"] == 1  # no real email provider is configured in test/demo mode
    delivery = db.get_collection("notification_deliveries").documents[-1]
    assert delivery["status"] == "skipped"


@pytest.mark.asyncio
async def test_escalation_progresses_district_to_state_to_mospi_with_safe_notifications():
    db = MemoryDatabase({
        "works": [{"work_id": "work-1", "title": "Scoped work", "state_code": "UP", "district_code": "LKO"}],
        "users": [
            {"user_id": "district", "role": "district_authority", "is_active": True, "jurisdiction": {"state_code": "UP", "district_code": "LKO"}},
            {"user_id": "state", "role": "state_nodal_officer", "is_active": True, "jurisdiction": {"state_code": "UP"}},
            {"user_id": "mospi", "role": "mospi", "is_active": True, "jurisdiction": {}},
        ],
    })
    service = CaseManagementService(db)
    case = await service.create_case(CaseCreateRequest(work_id="work-1", title="Escalation test"), created_by="district", jurisdiction_filter={"state_code": "UP"})
    assert case
    state = await service.escalate(case.case_id, CaseReasonRequest(reason="District SLA elapsed."), actor="district")
    mospi = await service.escalate(case.case_id, CaseReasonRequest(reason="State SLA elapsed."), actor="system_sla_monitor")
    assert state and state.escalation_level == "state"
    assert mospi and mospi.escalation_level == "mospi"
    notifications = db.get_collection("notifications").documents
    assert {item["recipient_user_id"] for item in notifications} == {"state", "mospi"}
    assert all("SLA elapsed" not in item["message"] for item in notifications)
