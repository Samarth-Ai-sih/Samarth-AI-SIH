"""End-to-end service workflow: district review, field inspection, and social audit."""

import re
from datetime import datetime, timezone

import pytest

from app.models.case_management import (
    CaseAssignmentRequest,
    CaseCreateRequest,
    CaseReasonRequest,
    CaseSeverity,
    CaseStatus,
    InspectionChecklist,
    InspectionReportCreateRequest,
)
from app.models.citizen_portal import (
    CitizenIssueCreateRequest,
    CitizenIssueModerationUpdate,
    CitizenIssueStatus,
    CitizenIssueType,
)
from app.services.case_management_service import CaseManagementService
from app.services.citizen_portal_service import CitizenPortalService
from tests.test_case_management import _users, _work
from tests.test_risk_scoring import MemoryDatabase


@pytest.mark.asyncio
async def test_district_to_inspector_to_district_and_citizen_moderation_e2e():
    """Exercise the production services without external MongoDB or browser state."""
    work = {
        **_work(),
        "category": "healthcare",
        "pincode": "226001",
        # Deliberately private fields: public projection must drop them.
        "composite_risk_score": 92,
        "risk_tier": "red",
        "actual_expenditure": 800_000,
        "implementing_agency": "Restricted agency data",
    }
    db = MemoryDatabase({
        "works": [work],
        "users": _users() + [
            {"user_id": "state-1", "full_name": "State Nodal", "role": "state_nodal_officer", "is_active": True, "jurisdiction": {"state_code": "UP", "district_code": "", "assigned_task_ids": []}},
        ],
        "evidence_metadata": [{"evidence_id": "private-evidence-1", "work_id": work["work_id"], "verification_schema_version": 1}],
        "compliance_results": [],
        "compliance_rules": [],
    })
    cases = CaseManagementService(db)

    # 1–3. District opens the high-priority work and assigns an inspector.
    case = await cases.create_case(
        CaseCreateRequest(work_id=work["work_id"], title="Verify high-priority delivery signal", severity=CaseSeverity.HIGH),
        created_by="district-1",
        jurisdiction_filter={"state_code": "UP", "district_code": "LKO"},
    )
    assert case
    await cases.acknowledge(case.case_id, actor="district-1")
    await cases.begin_review(case.case_id, actor="district-1")
    assigned = await cases.assign_inspector(
        case.case_id,
        CaseAssignmentRequest(user_id="inspector-1", reason="Verify physical progress."),
        actor="district-1",
    )
    assert assigned and assigned.status == CaseStatus.INSPECTION_ASSIGNED

    # 4. Inspector submits one idempotent, geotagged field report.
    submission = await cases.submit_inspection_report(
        case.case_id,
        InspectionReportCreateRequest(
            checklist=InspectionChecklist(
                asset_found=True,
                work_active=True,
                verified_physical_progress_pct=48,
                quality_concern=False,
                work_delayed=True,
                cause_of_delay="Monsoon access constraints.",
            ),
            gps_latitude=26.8468,
            gps_longitude=80.9463,
            gps_timestamp=datetime(2026, 9, 9, tzinfo=timezone.utc),
            evidence_ids=["private-evidence-1"],
            offline_client_id="phase17-e2e-report",
        ),
        inspector_user_id="inspector-1",
        assigned_task_ids=[case.case_id],
    )
    assert submission and submission.case.status == CaseStatus.EVIDENCE_SUBMITTED

    # 5. District authority escalates with a required audit reason.
    escalated = await cases.escalate(
        case.case_id,
        CaseReasonRequest(reason="State-level clarification is required."),
        actor="district-1",
    )
    assert escalated and escalated.status == CaseStatus.ESCALATED
    assert escalated.escalation_level == "state"

    # 6–7. A citizen submits an anonymous report and the moderator assigns inspection.
    public = CitizenPortalService(db)
    challenge = await public.create_verification_challenge()
    answer = str(sum(int(value) for value in re.findall(r"\d+", challenge.prompt)))
    receipt = await public.create_issue(CitizenIssueCreateRequest(
        work_id=work["work_id"],
        issue_type=CitizenIssueType.WORK_APPEARS_STOPPED,
        description="The site appears inactive during a daytime visit.",
        verification_id=challenge.verification_id,
        verification_answer=answer,
    ))
    assert receipt
    reviewed = await public.moderate_issue(
        receipt.reference_id,
        CitizenIssueModerationUpdate(status=CitizenIssueStatus.UNDER_REVIEW, public_status_message="Review started."),
        allowed_work_ids={work["work_id"]},
        moderator_user_id="district-1",
    )
    assigned_report = await public.moderate_issue(
        receipt.reference_id,
        CitizenIssueModerationUpdate(
            status=CitizenIssueStatus.INSPECTION_ASSIGNED,
            assigned_inspector_id="inspector-1",
            public_status_message="Field verification has been assigned.",
        ),
        allowed_work_ids={work["work_id"]},
        moderator_user_id="district-1",
    )
    assert reviewed and assigned_report and assigned_report.status == CitizenIssueStatus.INSPECTION_ASSIGNED

    # 8. The citizen-facing projection remains free of internal risk, financial, and agency data.
    public_work = await public.get_public_work(work["work_id"])
    tracking = await public.track_issue(receipt.reference_id)
    assert public_work and tracking
    assert {"composite_risk_score", "risk_tier", "actual_expenditure", "implementing_agency"}.isdisjoint(public_work.model_dump())
    assert {"description", "moderation_reason", "assigned_inspector_id"}.isdisjoint(tracking.model_dump())
