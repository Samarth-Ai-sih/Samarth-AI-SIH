"""
Unit tests for SAMARTH AI Work Routing Stage Resolution.

Verifies:
1. Civil Execution (Step 3) marks Completed when physical progress reaches 100% and inspection is dispatched.
2. Workflow routes to Field Inspector (Step 4) as the active custodian (Action Required).
3. Agency is relieved of action once progress is 100% and inspection is dispatched.
"""

from datetime import datetime, timezone
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.models.work import WorkInDB, WorkLocation, WorkStatus
from app.services.work_service import WorkService


@pytest.mark.asyncio
async def test_agency_100_percent_and_dispatched_marks_step3_completed():
    """Verify that when progress is 100% and inspection is dispatched, Step 3 is completed and Step 4 is active."""
    mock_db = MagicMock()
    mock_works_col = MagicMock()
    mock_users_col = MagicMock()
    mock_cases_col = MagicMock()

    mock_db.get_collection.side_effect = lambda name: {
        "works": mock_works_col,
        "users": mock_users_col,
        "cases": mock_cases_col,
        "notifications": MagicMock(),
        "audit_logs": MagicMock(),
    }.get(name, MagicMock())

    now = datetime.now(timezone.utc)
    test_work = WorkInDB(
        work_id="work-test-100-insp",
        title="Test Drinking Water Kiosk Sarnath",
        description="Installation of drinking water kiosk",
        status=WorkStatus.SANCTIONED,
        category="drinking_water",
        state_code="UP",
        district_code="VNS",
        constituency="Varanasi",
        physical_progress_pct=100.0,
        sanctioned_amount=500000.0,
        sanction_order_ref="AS-VNS-2026-001",
        sanctioned_date=now,
        implementing_agency="UP Jal Nigam",
        active_case_id="CASE-INSP-TEST01",
        created_at=now,
        updated_at=now,
        location=WorkLocation(latitude=25.3176, longitude=82.9739, address="Sarnath, Varanasi"),
    )

    svc = WorkService(mock_db)
    svc.get_work = AsyncMock(return_value=test_work)

    # Mock DB collections for user lookup & case lookup
    inspector_doc = {
        "user_id": "insp-001",
        "role": "inspector",
        "full_name": "Er. Rajesh Sharma",
        "email": "rajesh.inspector@samarth.gov.in",
        "is_active": True,
        "jurisdiction": {"district_code": "VNS"},
    }
    case_doc = {
        "case_id": "CASE-INSP-TEST01",
        "work_id": "work-test-100-insp",
        "status": "inspection_assigned",
        "assigned_inspector_id": "insp-001",
        "created_at": now,
    }

    mock_cases_col.find_one = AsyncMock(return_value=case_doc)
    mock_users_col.find_one = AsyncMock(return_value=inspector_doc)

    routing = await svc.get_work_routing("work-test-100-insp")
    assert routing is not None

    # Step 3 must be completed, NOT in_progress / Action Required
    s3 = next(s for s in routing.stages if s.stage_id == "agency_execution")
    assert s3.status == "completed"
    assert s3.is_current_stage is False
    assert "100% completed" in s3.action_required

    # Step 4 must be in_progress (Action Required), routed to Field Inspector
    s4 = next(s for s in routing.stages if s.stage_id == "field_inspection")
    assert s4.status == "in_progress"
    assert s4.is_current_stage is True
    assert s4.action_ref == "CASE-INSP-TEST01"

    # Top banner current custodian must be the Field Inspector
    assert routing.current_stage_id == "field_inspection"
    assert routing.current_custodian.role == "inspector"
    assert "Rajesh Sharma" in routing.current_custodian.name


@pytest.mark.asyncio
async def test_agency_partial_progress_keeps_step3_in_progress():
    """Verify that when progress is < 100%, Step 3 remains in_progress (Action Required) for Agency."""
    mock_db = MagicMock()
    mock_works_col = MagicMock()
    mock_users_col = MagicMock()
    mock_cases_col = MagicMock()

    mock_db.get_collection.side_effect = lambda name: {
        "works": mock_works_col,
        "users": mock_users_col,
        "cases": mock_cases_col,
        "notifications": MagicMock(),
        "audit_logs": MagicMock(),
    }.get(name, MagicMock())

    now = datetime.now(timezone.utc)
    test_work = WorkInDB(
        work_id="work-test-partial",
        title="Test Drinking Water Kiosk Sarnath",
        description="Installation of drinking water kiosk",
        status=WorkStatus.IN_PROGRESS,
        category="drinking_water",
        state_code="UP",
        district_code="VNS",
        constituency="Varanasi",
        physical_progress_pct=60.0,
        sanctioned_amount=500000.0,
        sanction_order_ref="AS-VNS-2026-001",
        sanctioned_date=now,
        implementing_agency="UP Jal Nigam",
        created_at=now,
        updated_at=now,
        location=WorkLocation(latitude=25.3176, longitude=82.9739, address="Sarnath, Varanasi"),
    )

    svc = WorkService(mock_db)
    svc.get_work = AsyncMock(return_value=test_work)
    mock_cases_col.find_one = AsyncMock(return_value=None)
    mock_users_col.find_one = AsyncMock(return_value=None)

    routing = await svc.get_work_routing("work-test-partial")
    assert routing is not None

    # Step 3 must be in_progress
    s3 = next(s for s in routing.stages if s.stage_id == "agency_execution")
    assert s3.status == "in_progress"
    assert s3.is_current_stage is True

    # Current custodian is the agency
    assert routing.current_stage_id == "agency_execution"
    assert routing.current_custodian.role == "agency"
