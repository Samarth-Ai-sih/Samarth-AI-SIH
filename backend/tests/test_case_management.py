"""Phase 13 tests for the persisted District Authority → Inspector workflow."""

from datetime import datetime, timedelta, timezone

import pytest

from app.models.case_management import (
    CaseAssignmentRequest,
    CaseCommentRequest,
    CaseCreateRequest,
    CaseReasonRequest,
    CaseSeverity,
    CaseSeverityRequest,
    CaseStatus,
    InspectionChecklist,
    InspectionReportCreateRequest,
)
from app.services.case_management_service import CaseManagementService
from tests.test_risk_scoring import MemoryDatabase


NOW = datetime(2026, 9, 9, tzinfo=timezone.utc)


def _work() -> dict:
    return {
        "work_id": "work-case-1", "title": "Community health centre upgrade",
        "description": "Upgrade work for inspection", "status": "in_progress",
        "state_code": "UP", "district_code": "LKO", "state_name": "Uttar Pradesh", "district_name": "Lucknow",
        "sanctioned_amount": 1_000_000, "funds_released": 700_000, "actual_expenditure": 550_000,
        "physical_progress_pct": 45, "recommended_date": datetime(2026, 1, 1, tzinfo=timezone.utc),
        "sanctioned_date": datetime(2026, 2, 1, tzinfo=timezone.utc),
        "start_date": datetime(2026, 3, 1, tzinfo=timezone.utc),
        "expected_completion_date": datetime(2027, 2, 1, tzinfo=timezone.utc),
        "location": {"latitude": 26.8467, "longitude": 80.9462, "address": "Ward Seven"},
    }


def _users() -> list[dict]:
    return [
        {"user_id": "district-1", "full_name": "District Authority", "role": "district_authority", "is_active": True, "jurisdiction": {"state_code": "UP", "district_code": "LKO", "assigned_task_ids": []}},
        {"user_id": "inspector-1", "full_name": "Field Inspector", "role": "inspector", "is_active": True, "jurisdiction": {"state_code": "UP", "district_code": "LKO", "assigned_task_ids": []}},
        {"user_id": "owner-1", "full_name": "Case Owner", "role": "district_authority", "is_active": True, "jurisdiction": {"state_code": "UP", "district_code": "LKO", "assigned_task_ids": []}},
    ]


@pytest.mark.asyncio
async def test_district_to_inspector_to_district_workflow_persists_reports_evidence_risk_and_notification():
    db = MemoryDatabase({
        "works": [_work()],
        "users": _users(),
        "evidence_metadata": [{"evidence_id": "evidence-1", "work_id": "work-case-1", "verification_schema_version": 1}],
        "compliance_results": [], "compliance_rules": [],
    })
    service = CaseManagementService(db)
    created = await service.create_case(
        CaseCreateRequest(work_id="work-case-1", title="Inspect progress and evidence", severity=CaseSeverity.HIGH),
        created_by="district-1", jurisdiction_filter={"state_code": "UP"},
    )
    assert created and created.status == CaseStatus.NEW

    acknowledged = await service.acknowledge(created.case_id, actor="district-1")
    under_review = await service.begin_review(created.case_id, actor="district-1")
    assert acknowledged and under_review and under_review.status == CaseStatus.UNDER_REVIEW

    with_comment = await service.add_comment(created.case_id, CaseCommentRequest(text="Assign a site visit."), actor="district-1")
    with_owner = await service.assign_owner(created.case_id, CaseAssignmentRequest(user_id="owner-1"), actor="district-1")
    assert with_comment and len(with_comment.comments) == 1
    assert with_owner and with_owner.owner_user_id == "owner-1"

    assigned = await service.assign_inspector(
        created.case_id, CaseAssignmentRequest(user_id="inspector-1", reason="Verify the reported progress."), actor="district-1",
    )
    assert assigned and assigned.status == CaseStatus.INSPECTION_ASSIGNED
    inspector_doc = await db.get_collection("users").find_one({"user_id": "inspector-1"})
    assert created.case_id in inspector_doc["jurisdiction"]["assigned_task_ids"]

    task = await service.get_inspection_task(
        created.case_id, inspector_user_id="inspector-1", assigned_task_ids=[created.case_id],
    )
    assert task and task.work.title == "Community health centre upgrade"

    submitted = await service.submit_inspection_report(
        created.case_id,
        InspectionReportCreateRequest(
            checklist=InspectionChecklist(
                asset_found=True, work_active=True, verified_physical_progress_pct=52,
                quality_concern=False, work_delayed=True, cause_of_delay="Rain-related access interruption.",
                additional_remarks="Site team was present.",
            ),
            gps_latitude=26.8468, gps_longitude=80.9463, gps_timestamp=NOW,
            evidence_ids=["evidence-1"], remarks="Photo attached after private verification.", offline_client_id="offline-report-1",
        ),
        inspector_user_id="inspector-1", assigned_task_ids=[created.case_id],
    )
    assert submitted and submitted.case.status == CaseStatus.EVIDENCE_SUBMITTED
    assert submitted.report.gps_available is True
    assert submitted.report.evidence_ids == ["evidence-1"]
    assert submitted.risk_recalculated is True
    assert len(db.get_collection("inspection_reports").documents) == 1
    assert len(db.get_collection("risk_scores").documents) == 1
    assert len(db.get_collection("case_notifications").documents) == 2

    idempotent = await service.submit_inspection_report(
        created.case_id,
        InspectionReportCreateRequest(
            checklist=InspectionChecklist(asset_found=True, work_active=True, verified_physical_progress_pct=52, quality_concern=False, work_delayed=False),
            offline_client_id="offline-report-1",
        ),
        inspector_user_id="inspector-1", assigned_task_ids=[created.case_id],
    )
    assert idempotent and idempotent.risk_recalculated is False
    assert len(db.get_collection("inspection_reports").documents) == 1

    notifications = await service.list_notifications(recipient_user_id="district-1")
    assert len(notifications) == 1 and notifications[0].case_id == created.case_id
    audit_events = [entry["event_type"] for entry in db.get_collection("audit_logs").documents]
    assert "inspection_report_submitted" in audit_events
    assert "district_authority_notified" in audit_events


@pytest.mark.asyncio
async def test_reason_is_required_for_downgrade_and_terminal_decisions_can_reopen():
    db = MemoryDatabase({"works": [_work()], "users": _users(), "evidence_metadata": []})
    service = CaseManagementService(db)
    created = await service.create_case(
        CaseCreateRequest(work_id="work-case-1", title="Review case", severity=CaseSeverity.HIGH),
        created_by="district-1", jurisdiction_filter={"state_code": "UP"},
    )
    assert created
    with pytest.raises(ValueError, match="lowering case severity"):
        await service.change_severity(created.case_id, CaseSeverityRequest(severity=CaseSeverity.LOW), actor="district-1")

    rejected = await service.reject(created.case_id, CaseReasonRequest(reason="Records confirm the alert does not apply."), actor="district-1")
    assert rejected and rejected.status == CaseStatus.REJECTED_FALSE_POSITIVE
    reopened = await service.reopen(created.case_id, CaseReasonRequest(reason="New records require another review."), actor="district-1")
    assert reopened and reopened.status == CaseStatus.REOPENED


@pytest.mark.asyncio
async def test_inspector_cannot_access_or_submit_an_unassigned_case():
    db = MemoryDatabase({"works": [_work()], "users": _users(), "evidence_metadata": []})
    service = CaseManagementService(db)
    created = await service.create_case(
        CaseCreateRequest(work_id="work-case-1", title="Restricted inspection"),
        created_by="district-1", jurisdiction_filter={"state_code": "UP"},
    )
    assert created
    assert await service.get_case_for_inspector(created.case_id, inspector_user_id="inspector-1", assigned_task_ids=[]) is None
    assert await service.submit_inspection_report(
        created.case_id,
        InspectionReportCreateRequest(checklist=InspectionChecklist(asset_found=True, work_active=True, verified_physical_progress_pct=20, quality_concern=False, work_delayed=False)),
        inspector_user_id="inspector-1", assigned_task_ids=[],
    ) is None
