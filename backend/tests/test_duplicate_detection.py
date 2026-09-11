"""Phase 11 tests for explainable possible duplicate-work detection and review."""

from datetime import datetime, timezone

import pytest

pytest.importorskip("sklearn")

from app.models.duplicate import (
    DuplicateCaseCreateRequest,
    DuplicateDetectionRule,
    DuplicateMatchStatus,
    DuplicateReviewRequest,
)
from app.services.duplicate_detection_service import DuplicateDetectionService
from tests.test_risk_scoring import MemoryDatabase


START = datetime(2026, 5, 1, tzinfo=timezone.utc)
END = datetime(2027, 3, 31, tzinfo=timezone.utc)


def _work(
    work_id: str,
    *,
    latitude: float,
    longitude: float,
    sanctioned_amount: float,
    title: str = "Construction of a community health centre at Ward Seven",
    agency: str = "District Works Agency",
) -> dict:
    return {
        "work_id": work_id,
        "title": title,
        "description": "Construction of a community health centre with outpatient facilities.",
        "category": "healthcare",
        "sub_category": "community health centre",
        "status": "in_progress",
        "state_code": "UP",
        "state_name": "Uttar Pradesh",
        "district_code": "LKO",
        "district_name": "Lucknow",
        "implementing_agency": agency,
        "sanctioned_amount": sanctioned_amount,
        "funds_released": sanctioned_amount * 0.6,
        "actual_expenditure": sanctioned_amount * 0.45,
        "physical_progress_pct": 40,
        "start_date": START,
        "expected_completion_date": END,
        "location": {"latitude": latitude, "longitude": longitude, "address": "Ward Seven"},
    }


@pytest.mark.asyncio
async def test_scan_persists_explainable_match_cluster_and_manual_review_workflow():
    left = _work("duplicate-work-a", latitude=26.8467, longitude=80.9462, sanctioned_amount=1_000_000)
    right = _work("duplicate-work-b", latitude=26.8474, longitude=80.9462, sanctioned_amount=1_100_000)
    far = _work("not-a-candidate", latitude=26.9000, longitude=80.9462, sanctioned_amount=1_050_000)
    db = MemoryDatabase({
        "works": [left, right, far],
        "evidence_metadata": [
            {"work_id": left["work_id"], "evidence_type": "site_photo", "file_hash": "shared-photo"},
            {"work_id": right["work_id"], "evidence_type": "site_photo", "file_hash": "shared-photo"},
        ],
    })
    service = DuplicateDetectionService(db)
    scan = await service.scan(
        jurisdiction_filter={"state_code": "UP"},
        rule=DuplicateDetectionRule(),
        created_by="reviewer-1",
    )

    assert scan.works_evaluated == 3
    assert scan.pairs_evaluated == 3
    assert scan.matches_created == 1
    assert scan.clusters_created == 1

    matches, total, _, latest_scan = await service.list_matches(
        jurisdiction_filter={"state_code": "UP"},
    )
    assert total == 1
    assert latest_scan and latest_scan["scan_id"] == scan.scan_id
    match = matches[0]
    assert match["text_similarity"] >= 0.82
    assert match["distance_meters"] <= 300
    assert match["distance_method"] == "haversine_fallback"
    assert match["comparable_cost_range"] is True
    assert match["timeline_overlap"] is True
    assert match["agency_vendor_relationship"] == "Same implementing agency"
    assert match["evidence_photo_similarity"] == 1.0
    assert match["status"] == DuplicateMatchStatus.PENDING_REVIEW

    comparison = await service.get_comparison(match["match_id"], jurisdiction_filter={"state_code": "UP"})
    assert comparison is not None
    assert comparison.left_work.work_id == left["work_id"]
    assert comparison.right_work.work_id == right["work_id"]
    assert comparison.notice == "Possible Duplicate Work — Manual Verification Required."

    case = await service.create_case(
        match["match_id"], DuplicateCaseCreateRequest(notes="Review the site records."), created_by="reviewer-1",
    )
    assert case is not None and case.status == "open"

    field_request = await service.request_field_verification(
        match["match_id"],
        DuplicateReviewRequest(notes="Please verify both sites.", assigned_to="field-team-1"),
        requested_by="reviewer-2",
    )
    assert field_request is not None
    assert field_request["status"] == DuplicateMatchStatus.FIELD_VERIFICATION_REQUESTED.value
    assert field_request["assigned_to"] == "field-team-1"

    not_duplicate = await service.mark_not_duplicate(
        match["match_id"], DuplicateReviewRequest(notes="Separate facilities confirmed."), reviewed_by="reviewer-3",
    )
    assert not_duplicate is not None
    assert not_duplicate["status"] == DuplicateMatchStatus.MARKED_NOT_DUPLICATE.value


@pytest.mark.asyncio
async def test_scan_requires_default_distance_and_cost_conditions_before_creating_a_candidate():
    left = _work("near-a", latitude=26.8467, longitude=80.9462, sanctioned_amount=1_000_000)
    far = _work("far-b", latitude=26.9000, longitude=80.9462, sanctioned_amount=1_000_000)
    expensive = _work("expensive-c", latitude=26.8474, longitude=80.9462, sanctioned_amount=1_600_000)
    db = MemoryDatabase({"works": [left, far, expensive], "evidence_metadata": []})

    scan = await DuplicateDetectionService(db).scan(jurisdiction_filter={"state_code": "UP"})

    assert scan.matches_created == 0
    assert db.get_collection("duplicate_work_matches").documents == []
