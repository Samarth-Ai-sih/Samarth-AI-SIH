"""Phase 14 public-safety and social-audit persistence tests."""

import re
from datetime import datetime, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.cases import router as case_router
from app.api.v1.risk import router as risk_router
from app.api.v1.works import router as works_router
from app.core.database import get_database
from app.core.dependencies import get_current_user
from app.core.permissions import Permission, has_permission
from app.models.citizen_portal import (
    CitizenIssueCreateRequest,
    CitizenIssueModerationUpdate,
    CitizenIssueStatus,
    CitizenIssueType,
)
from app.models.user import JurisdictionScope, UserInDB, UserRole
from app.services.citizen_portal_service import CitizenPortalService
from tests.test_risk_scoring import MemoryDatabase


NOW = datetime(2026, 9, 9, tzinfo=timezone.utc)
PUBLIC_WORK = {
    "work_id": "public-work-1", "title": "Village water tank restoration", "description": "Restore the public water tank.",
    "status": "in_progress", "category": "drinking_water", "sub_category": "water storage",
    "state_name": "Uttar Pradesh", "state_code": "UP", "district_name": "Lucknow", "district_code": "LKO",
    "constituency": "Lucknow Central", "mp_name": "Example MP", "pincode": "226001",
    "physical_progress_pct": 45, "location": {"address": "Ward Seven public site", "latitude": 26.8467, "longitude": 80.9462},
    "expected_completion_date": NOW, "updated_at": NOW,
    # Fields that must never appear in a public response.
    "implementing_agency": "Sensitive agency contract record", "sanctioned_amount": 10_000_000,
    "funds_released": 8_000_000, "actual_expenditure": 6_500_000,
    "composite_risk_score": 91, "risk_tier": "red", "payment_tranches": [{"amount": 1}],
    "progress_updates": [], "timeline": [],
}


@pytest.mark.asyncio
async def test_public_work_search_and_qr_lookup_are_allow_listed():
    service = CitizenPortalService(MemoryDatabase({"works": [PUBLIC_WORK]}))

    result = await service.search_public_works(pincode="226001", mp_name="example", page=1, page_size=20)
    assert result.total == 1
    payload = result.works[0].model_dump()
    assert payload["work_id"] == "public-work-1"
    assert payload["qr_payload"] == "SAMARTH:public-work-1"
    assert {"implementing_agency", "sanctioned_amount", "funds_released", "actual_expenditure", "composite_risk_score", "risk_tier"}.isdisjoint(payload)

    looked_up = await service.lookup_qr("https://portal.example/public/works/public-work-1?qr=SAMARTH%3Apublic-work-1")
    assert looked_up and looked_up.work_id == "public-work-1"
    assert "Sensitive agency" not in looked_up.model_dump_json()


@pytest.mark.asyncio
async def test_anonymous_issue_tracks_public_status_but_not_consented_location_or_internal_reason():
    db = MemoryDatabase({"works": [PUBLIC_WORK]})
    service = CitizenPortalService(db)
    challenge = await service.create_verification_challenge()
    answer = str(sum(int(value) for value in re.findall(r"\d+", challenge.prompt)))
    receipt = await service.create_issue(
        CitizenIssueCreateRequest(
            work_id="public-work-1", issue_type=CitizenIssueType.WORK_APPEARS_STOPPED,
            description="The public work appears stopped and no team is visible at the site.",
            location_consent=True, latitude=26.8468, longitude=80.9463,
            verification_id=challenge.verification_id, verification_answer=answer,
        ),
    )
    assert receipt and receipt.reference_id.startswith("SA-") and receipt.photo_upload_token
    stored = db.get_collection("citizen_issues").documents[0]
    assert stored["latitude"] == 26.8468
    assert "photo_upload_token" not in stored

    tracked = await service.track_issue(receipt.reference_id)
    assert tracked and tracked.status == CitizenIssueStatus.RECEIVED
    tracking_payload = tracked.model_dump()
    assert {"latitude", "longitude", "description", "moderation_reason", "photo_upload_token"}.isdisjoint(tracking_payload)

    reviewed = await service.moderate_issue(
        receipt.reference_id,
        CitizenIssueModerationUpdate(status=CitizenIssueStatus.UNDER_REVIEW, public_status_message="Review started."),
        allowed_work_ids={"public-work-1"}, moderator_user_id="district-1",
    )
    assert reviewed and reviewed.status == CitizenIssueStatus.UNDER_REVIEW
    internal = reviewed.model_dump()
    assert internal["latitude"] == 26.8468
    assert (await service.track_issue(receipt.reference_id)).status_message == "Review started."


def test_citizen_cannot_access_internal_case_or_risk_data():
    """Citizen gets explicit 403 responses from the guarded Phase 8 and 13 routers."""
    assert not has_permission(UserRole.CITIZEN, Permission.READ_RISK)
    assert not has_permission(UserRole.CITIZEN, Permission.WRITE_RISK)
    assert not has_permission(UserRole.CITIZEN, Permission.READ_INVESTIGATIONS)
    assert not has_permission(UserRole.CITIZEN, Permission.WRITE_INVESTIGATIONS)

    citizen = UserInDB(
        user_id="citizen-1", email="citizen@example.test", username="citizen", full_name="Citizen",
        hashed_password="not-used", role=UserRole.CITIZEN, jurisdiction=JurisdictionScope(),
    )
    app = FastAPI()
    app.include_router(case_router)
    app.include_router(risk_router)
    app.include_router(works_router)
    app.dependency_overrides[get_current_user] = lambda: citizen
    app.dependency_overrides[get_database] = lambda: MemoryDatabase({})
    with TestClient(app) as client:
        assert client.get("/api/v1/cases/internal-case-id").status_code == 403
        assert client.get("/api/v1/risk/distribution").status_code == 403
        assert client.get("/api/v1/works/public-work-1").status_code == 403


@pytest.mark.asyncio
async def test_citizen_moderation_privacy_and_inspector_assignment():
    from app.api.v1.citizen_reports import router as citizen_reports_router

    work = dict(PUBLIC_WORK)
    issue_assigned = {
        "reference_id": "SA-20260911-ASSIGNED",
        "work_id": "public-work-1",
        "work_title": "Village water tank restoration",
        "issue_type": "quality_concern",
        "description": "Poor concrete foundation poured.",
        "status": "inspection_assigned",
        "public_status_message": "Assigned to inspector.",
        "location_consent": False,
        "evidence": [
            {
                "evidence_id": "ev-1",
                "content_type": "image/jpeg",
                "file_size_bytes": 1024,
                "received_at": NOW,
                "storage_reference": "/tmp/dummy.jpg",
            }
        ],
        "assigned_inspector_id": "insp-assigned",
        "submitted_at": NOW,
        "updated_at": NOW,
        "moderation_reason": "Inspection required",
    }
    issue_unassigned = {
        "reference_id": "SA-20260911-UNASSIGNED",
        "work_id": "public-work-1",
        "work_title": "Village water tank restoration",
        "issue_type": "work_appears_stopped",
        "description": "Work stopped for two weeks.",
        "status": "under_review",
        "public_status_message": "Under review.",
        "location_consent": False,
        "evidence": [
            {
                "evidence_id": "ev-2",
                "content_type": "image/jpeg",
                "file_size_bytes": 2048,
                "received_at": NOW,
                "storage_reference": "/tmp/dummy2.jpg",
            }
        ],
        "assigned_inspector_id": None,
        "submitted_at": NOW,
        "updated_at": NOW,
        "moderation_reason": "",
    }

    db = MemoryDatabase({
        "works": [work],
        "citizen_issues": [issue_assigned, issue_unassigned],
        "users": [
            {"user_id": "insp-assigned", "role": "inspector", "full_name": "Inspector Assigned", "username": "insp_assigned", "email": "ia@gov.in", "is_active": True, "jurisdiction": {"district_code": "LKO", "state_code": "UP"}},
            {"user_id": "insp-other", "role": "inspector", "full_name": "Inspector Other", "username": "insp_other", "email": "io@gov.in", "is_active": True, "jurisdiction": {"district_code": "LKO", "state_code": "UP"}},
        ],
        "cases": [],
    })

    # Test 1: District Authority sees both, can_view_images is True, urls present
    service = CitizenPortalService(db)
    da_list = await service.list_for_moderation(allowed_work_ids={"public-work-1"}, viewer_role="district_authority")
    assert da_list.total == 2
    assert da_list.reports[0].can_view_images is True
    assert da_list.reports[0].evidence_items[0].url is not None
    assert da_list.reports[0].evidence_items[0].restricted is False

    # Test 2: State Nodal Officer sees reports, but can_view_images is False, url is None, restricted is True
    sno_list = await service.list_for_moderation(allowed_work_ids={"public-work-1"}, viewer_role="state_nodal_officer")
    assert sno_list.total == 2
    assert sno_list.reports[0].can_view_images is False
    assert sno_list.reports[0].evidence_items[0].url is None
    assert sno_list.reports[0].evidence_items[0].restricted is True

    # Test 3: Assigned Inspector sees ONLY assigned report, can_view_images is False
    insp_list = await service.list_for_moderation(
        allowed_work_ids={"public-work-1"},
        assigned_inspector_id="insp-assigned",
        viewer_role="inspector",
    )
    assert insp_list.total == 1
    assert insp_list.reports[0].reference_id == "SA-20260911-ASSIGNED"
    assert insp_list.reports[0].can_view_images is False
    assert insp_list.reports[0].evidence_items[0].restricted is True

    # Test 4: Unassigned Inspector sees 0 reports
    other_insp_list = await service.list_for_moderation(
        allowed_work_ids={"public-work-1"},
        assigned_inspector_id="insp-other",
        viewer_role="inspector",
    )
    assert other_insp_list.total == 0

    # Test 5: Escalate citizen report to official Case
    from app.models.citizen_portal import CitizenIssueCreateCaseRequest
    escalation = await service.escalate_to_case(
        reference_id="SA-20260911-UNASSIGNED",
        request=CitizenIssueCreateCaseRequest(
            title="Investigate stopped work at water tank site",
            severity="high",
            assigned_inspector_id="insp-assigned",
            case_notes="Dispatched inspector due to 2 week stoppage.",
        ),
        allowed_work_ids={"public-work-1"},
        moderator_user_id="da-1",
    )
    assert escalation["case_id"]
    assert escalation["status"] == "inspection_assigned"
    
    # Verify linked case in issue
    mod_doc = await service.get_for_moderation("SA-20260911-UNASSIGNED", allowed_work_ids={"public-work-1"}, viewer_role="district_authority")
    assert mod_doc and mod_doc.linked_case_id == escalation["case_id"]
    assert mod_doc.assigned_inspector_id == "insp-assigned"

