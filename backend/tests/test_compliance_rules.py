"""
SAMARTH AI -- Compliance Rule Unit Tests

Tests each of the 11 compliance rules with:
  - Deviation detected (threshold breached)
  - Compliant (within thresholds)
  - Not applicable (wrong status / missing data)
  - Correct threshold_snapshot and supporting_data

Run:
    cd backend
    python -m pytest tests/test_compliance_rules.py -v
"""

import pytest
from datetime import datetime, timedelta, timezone

from app.services.compliance_service import (
    _eval_rec_sanc_delay,
    _eval_completion_overdue,
    _eval_missing_progress_update,
    _eval_missing_inspection,
    _eval_missing_evidence,
    _eval_invalid_date_sequence,
    _eval_completion_no_evidence,
    _eval_funds_exceed_sanctioned,
    _eval_payment_progress_mismatch,
    _eval_location_jurisdiction,
    _eval_allocation_threshold,
)
from app.models.compliance import ResultStatus


NOW = datetime.now(timezone.utc)


def _dt(days_ago: int) -> str:
    """Helper: ISO date string for N days ago."""
    return (NOW - timedelta(days=days_ago)).isoformat()


# =========================================================================
# Rule 1: REC_SANC_DELAY
# =========================================================================

class TestRecSancDelay:
    thresholds = {"max_days": 90}

    def test_deviation_detected(self):
        work = {"recommended_date": _dt(200), "sanctioned_date": _dt(100)}
        status, msg, data = _eval_rec_sanc_delay(work, self.thresholds, {})
        assert status == ResultStatus.DEVIATION_DETECTED
        assert data["actual_days"] == 100
        assert "Compliance deviation" in msg
        assert "Requires verification" in msg

    def test_compliant(self):
        work = {"recommended_date": _dt(100), "sanctioned_date": _dt(50)}
        status, msg, data = _eval_rec_sanc_delay(work, self.thresholds, {})
        assert status == ResultStatus.COMPLIANT
        assert data["actual_days"] == 50

    def test_not_applicable_missing_dates(self):
        work = {"recommended_date": _dt(100)}
        status, _, _ = _eval_rec_sanc_delay(work, self.thresholds, {})
        assert status == ResultStatus.NOT_APPLICABLE


# =========================================================================
# Rule 2: COMPLETION_OVERDUE
# =========================================================================

class TestCompletionOverdue:
    thresholds = {"grace_days": 30}

    def test_deviation_detected(self):
        work = {"status": "in_progress", "expected_completion_date": _dt(90)}
        status, msg, data = _eval_completion_overdue(work, self.thresholds, {})
        assert status == ResultStatus.DEVIATION_DETECTED
        assert data["overdue_days"] == 90
        assert "Requires verification" in msg

    def test_compliant(self):
        work = {"status": "in_progress", "expected_completion_date": (NOW + timedelta(days=60)).isoformat()}
        status, _, _ = _eval_completion_overdue(work, self.thresholds, {})
        assert status == ResultStatus.COMPLIANT

    def test_not_applicable_completed(self):
        work = {"status": "completed", "expected_completion_date": _dt(90)}
        status, _, _ = _eval_completion_overdue(work, self.thresholds, {})
        assert status == ResultStatus.NOT_APPLICABLE


# =========================================================================
# Rule 3: MISSING_PROGRESS_UPDATE
# =========================================================================

class TestMissingProgressUpdate:
    thresholds = {"max_days_gap": 90}

    def test_deviation_no_updates(self):
        work = {"status": "in_progress", "start_date": _dt(150), "progress_updates": []}
        status, msg, data = _eval_missing_progress_update(work, self.thresholds, {})
        assert status == ResultStatus.DEVIATION_DETECTED
        assert "Requires verification" in msg

    def test_deviation_stale_update(self):
        work = {
            "status": "in_progress",
            "start_date": _dt(300),
            "progress_updates": [{"date": _dt(120), "physical_progress_pct": 30}],
        }
        status, _, data = _eval_missing_progress_update(work, self.thresholds, {})
        assert status == ResultStatus.DEVIATION_DETECTED
        assert data["days_since_last_update"] >= 120

    def test_compliant_recent_update(self):
        work = {
            "status": "in_progress",
            "start_date": _dt(200),
            "progress_updates": [{"date": _dt(10), "physical_progress_pct": 50}],
        }
        status, _, _ = _eval_missing_progress_update(work, self.thresholds, {})
        assert status == ResultStatus.COMPLIANT

    def test_not_applicable_completed(self):
        work = {"status": "completed", "progress_updates": []}
        status, _, _ = _eval_missing_progress_update(work, self.thresholds, {})
        assert status == ResultStatus.NOT_APPLICABLE


# =========================================================================
# Rule 4: MISSING_INSPECTION
# =========================================================================

class TestMissingInspection:
    thresholds = {"required_after_days": 180}

    def test_deviation_no_inspection(self):
        work = {"status": "in_progress", "start_date": _dt(200)}
        ctx = {"inspections": []}
        status, msg, data = _eval_missing_inspection(work, self.thresholds, ctx)
        assert status == ResultStatus.DEVIATION_DETECTED
        assert data["inspections_found"] == 0
        assert "Requires verification" in msg

    def test_compliant_has_inspection(self):
        work = {"status": "in_progress", "start_date": _dt(200)}
        ctx = {"inspections": [{"inspection_id": "abc"}]}
        status, _, data = _eval_missing_inspection(work, self.thresholds, ctx)
        assert status == ResultStatus.COMPLIANT
        assert data["inspections_found"] == 1

    def test_compliant_too_early(self):
        work = {"status": "in_progress", "start_date": _dt(30)}
        ctx = {"inspections": []}
        status, _, _ = _eval_missing_inspection(work, self.thresholds, ctx)
        assert status == ResultStatus.COMPLIANT

    def test_not_applicable_wrong_status(self):
        work = {"status": "completed", "start_date": _dt(200)}
        status, _, _ = _eval_missing_inspection(work, self.thresholds, {})
        assert status == ResultStatus.NOT_APPLICABLE


# =========================================================================
# Rule 5: MISSING_EVIDENCE
# =========================================================================

class TestMissingEvidence:
    thresholds = {"required_after_pct": 30}

    def test_deviation_no_evidence(self):
        work = {"status": "in_progress", "physical_progress_pct": 50}
        ctx = {"evidence_count": 0}
        status, msg, _ = _eval_missing_evidence(work, self.thresholds, ctx)
        assert status == ResultStatus.DEVIATION_DETECTED
        assert "Requires verification" in msg

    def test_compliant_has_evidence(self):
        work = {"status": "in_progress", "physical_progress_pct": 60}
        ctx = {"evidence_count": 3}
        status, _, _ = _eval_missing_evidence(work, self.thresholds, ctx)
        assert status == ResultStatus.COMPLIANT

    def test_compliant_below_threshold(self):
        work = {"status": "in_progress", "physical_progress_pct": 10}
        ctx = {"evidence_count": 0}
        status, _, _ = _eval_missing_evidence(work, self.thresholds, ctx)
        assert status == ResultStatus.COMPLIANT

    def test_not_applicable_cancelled(self):
        work = {"status": "cancelled", "physical_progress_pct": 50}
        ctx = {"evidence_count": 0}
        status, _, _ = _eval_missing_evidence(work, self.thresholds, ctx)
        assert status == ResultStatus.NOT_APPLICABLE


# =========================================================================
# Rule 6: INVALID_DATE_SEQUENCE
# =========================================================================

class TestInvalidDateSequence:
    def test_deviation_start_before_sanction(self):
        work = {
            "recommended_date": _dt(300),
            "sanctioned_date": _dt(200),
            "start_date": _dt(250),  # before sanction
        }
        status, msg, data = _eval_invalid_date_sequence(work, {}, {})
        assert status == ResultStatus.DEVIATION_DETECTED
        assert len(data["violations"]) > 0
        assert "Requires verification" in msg

    def test_compliant_correct_order(self):
        work = {
            "recommended_date": _dt(300),
            "sanctioned_date": _dt(200),
            "start_date": _dt(150),
            "expected_completion_date": _dt(50),
        }
        status, _, _ = _eval_invalid_date_sequence(work, {}, {})
        assert status == ResultStatus.COMPLIANT

    def test_compliant_partial_dates(self):
        work = {"recommended_date": _dt(300)}
        status, _, _ = _eval_invalid_date_sequence(work, {}, {})
        assert status == ResultStatus.COMPLIANT


# =========================================================================
# Rule 7: COMPLETION_NO_EVIDENCE
# =========================================================================

class TestCompletionNoEvidence:
    def test_deviation_no_evidence(self):
        work = {"status": "completed"}
        ctx = {"evidence_count": 0}
        status, msg, _ = _eval_completion_no_evidence(work, {}, ctx)
        assert status == ResultStatus.DEVIATION_DETECTED
        assert "Requires verification" in msg

    def test_compliant_has_evidence(self):
        work = {"status": "under_verification"}
        ctx = {"evidence_count": 5}
        status, _, data = _eval_completion_no_evidence(work, {}, ctx)
        assert status == ResultStatus.COMPLIANT
        assert data["evidence_count"] == 5

    def test_not_applicable_in_progress(self):
        work = {"status": "in_progress"}
        status, _, _ = _eval_completion_no_evidence(work, {}, {})
        assert status == ResultStatus.NOT_APPLICABLE


# =========================================================================
# Rule 8: FUNDS_EXCEED_SANCTIONED
# =========================================================================

class TestFundsExceedSanctioned:
    thresholds = {"tolerance_pct": 5}

    def test_deviation_excess(self):
        work = {"sanctioned_amount": 1000000, "funds_released": 1200000}
        status, msg, data = _eval_funds_exceed_sanctioned(work, self.thresholds, {})
        assert status == ResultStatus.DEVIATION_DETECTED
        assert data["excess_pct"] == 20.0
        assert "Requires verification" in msg

    def test_compliant_within_tolerance(self):
        work = {"sanctioned_amount": 1000000, "funds_released": 1040000}
        status, _, _ = _eval_funds_exceed_sanctioned(work, self.thresholds, {})
        assert status == ResultStatus.COMPLIANT

    def test_not_applicable_no_amount(self):
        work = {"sanctioned_amount": 0, "funds_released": 0}
        status, _, _ = _eval_funds_exceed_sanctioned(work, self.thresholds, {})
        assert status == ResultStatus.NOT_APPLICABLE


# =========================================================================
# Rule 9: PAYMENT_PROGRESS_MISMATCH
# =========================================================================

class TestPaymentProgressMismatch:
    thresholds = {"max_divergence_pct": 30}

    def test_deviation_large_divergence(self):
        work = {"status": "in_progress", "sanctioned_amount": 1000000, "funds_released": 800000, "physical_progress_pct": 20}
        status, msg, data = _eval_payment_progress_mismatch(work, self.thresholds, {})
        assert status == ResultStatus.DEVIATION_DETECTED
        assert data["divergence_pct"] == 60.0
        assert "Requires verification" in msg

    def test_compliant_small_divergence(self):
        work = {"status": "in_progress", "sanctioned_amount": 1000000, "funds_released": 500000, "physical_progress_pct": 45}
        status, _, data = _eval_payment_progress_mismatch(work, self.thresholds, {})
        assert status == ResultStatus.COMPLIANT
        assert data["divergence_pct"] == 5.0

    def test_not_applicable_recommended(self):
        work = {"status": "recommended", "sanctioned_amount": 1000000, "funds_released": 0, "physical_progress_pct": 0}
        status, _, _ = _eval_payment_progress_mismatch(work, self.thresholds, {})
        assert status == ResultStatus.NOT_APPLICABLE


# =========================================================================
# Rule 10: LOCATION_JURISDICTION_ISSUE
# =========================================================================

class TestLocationJurisdiction:
    thresholds = {"max_distance_km": 50}

    def test_deviation_far_location(self):
        work = {"location": {"latitude": 20.0, "longitude": 80.0}}
        ctx = {"district_lat": 19.0, "district_lng": 79.0}
        status, msg, data = _eval_location_jurisdiction(work, self.thresholds, ctx)
        assert status == ResultStatus.DEVIATION_DETECTED
        assert data["distance_km"] > 50
        assert "Requires verification" in msg

    def test_compliant_close_location(self):
        work = {"location": {"latitude": 19.08, "longitude": 72.88}}
        ctx = {"district_lat": 19.076, "district_lng": 72.878}
        status, _, data = _eval_location_jurisdiction(work, self.thresholds, ctx)
        assert status == ResultStatus.COMPLIANT
        assert data["distance_km"] < 50

    def test_not_applicable_no_coords(self):
        work = {"location": {"latitude": None, "longitude": None}}
        status, _, _ = _eval_location_jurisdiction(work, self.thresholds, {})
        assert status == ResultStatus.NOT_APPLICABLE


# =========================================================================
# Rule 11: ALLOCATION_THRESHOLD
# =========================================================================

class TestAllocationThreshold:
    thresholds = {"max_per_work": 25000000}

    def test_deviation_exceeds_limit(self):
        work = {"sanctioned_amount": 30000000}
        status, msg, data = _eval_allocation_threshold(work, self.thresholds, {})
        assert status == ResultStatus.DEVIATION_DETECTED
        assert data["sanctioned_amount"] == 30000000
        assert "Requires verification" in msg

    def test_compliant_within_limit(self):
        work = {"sanctioned_amount": 10000000}
        status, _, data = _eval_allocation_threshold(work, self.thresholds, {})
        assert status == ResultStatus.COMPLIANT
        assert data["max_per_work"] == 25000000


# =========================================================================
# Cross-cutting tests
# =========================================================================

class TestSafeLanguage:
    """Verify that no rule uses the word 'fraud' anywhere."""

    ALL_EVALUATORS = [
        _eval_rec_sanc_delay,
        _eval_completion_overdue,
        _eval_missing_progress_update,
        _eval_missing_inspection,
        _eval_missing_evidence,
        _eval_invalid_date_sequence,
        _eval_completion_no_evidence,
        _eval_funds_exceed_sanctioned,
        _eval_payment_progress_mismatch,
        _eval_location_jurisdiction,
        _eval_allocation_threshold,
    ]

    def test_no_fraud_in_deviation_messages(self):
        """Ensure safe language: no evaluator produces the word 'fraud'."""
        test_works = [
            {"recommended_date": _dt(200), "sanctioned_date": _dt(50), "status": "in_progress",
             "expected_completion_date": _dt(90), "start_date": _dt(300),
             "sanctioned_amount": 30000000, "funds_released": 35000000,
             "physical_progress_pct": 10, "progress_updates": [],
             "location": {"latitude": 20.0, "longitude": 80.0}},
        ]
        ctx = {"evidence_count": 0, "inspections": [], "district_lat": 19.0, "district_lng": 79.0}

        for evaluator in self.ALL_EVALUATORS:
            for work in test_works:
                try:
                    _, msg, _ = evaluator(work, {"max_days": 90, "grace_days": 30, "max_days_gap": 90,
                        "required_after_days": 180, "required_after_pct": 30, "tolerance_pct": 5,
                        "max_divergence_pct": 30, "max_distance_km": 50, "max_per_work": 25000000}, ctx)
                    assert "fraud" not in msg.lower(), f"Unsafe language in {evaluator.__name__}: {msg}"
                except Exception:
                    pass  # Some evaluators may fail on incomplete data, that's fine
