"""Phase 9 tests for leakage-safe features and persisted fallback inference."""

import os
from datetime import datetime, timezone
from uuid import uuid4

import pytest

pytest.importorskip("numpy")
pytest.importorskip("pandas")

from app.ml.feature_engineering import FEATURE_COLUMNS, feature_vector
from app.ml.inference import FALLBACK_SOURCE, ModelInferenceService
from tests.test_risk_scoring import MemoryDatabase


AS_OF = datetime(2026, 9, 8, 12, 0, tzinfo=timezone.utc)
WORK = {
    "work_id": "ml-work-001",
    "title": "Synthetic health work",
    "status": "in_progress",
    "sanctioned_amount": 1_000_000,
    "funds_released": 800_000,
    "actual_expenditure": 650_000,
    "physical_progress_pct": 20,
    "recommended_date": "2025-01-01T00:00:00+00:00",
    "sanctioned_date": "2025-03-01T00:00:00+00:00",
    "start_date": "2025-04-01T00:00:00+00:00",
    "expected_completion_date": "2026-01-01T00:00:00+00:00",
    "progress_updates": [{"date": "2025-08-01T00:00:00+00:00", "physical_progress_pct": 20}],
    # Synthetic labels must never enter live inference features.
    "_anomaly_tags": ["red:financial_drain", "overdue"],
}


def test_feature_engineering_is_deterministic_and_excludes_synthetic_labels():
    first = feature_vector(WORK, as_of=AS_OF)
    second = feature_vector(WORK, as_of=AS_OF)

    assert first == second
    assert list(first) == FEATURE_COLUMNS
    assert "_anomaly_tags" not in first
    assert first["funds_released_pct"] == 80.0
    assert first["financial_progress_gap_pct"] == 60.0
    assert first["is_overdue"] == 1.0


@pytest.mark.asyncio
async def test_unavailable_artifacts_use_a_labelled_deterministic_fallback_and_persist():
    db = MemoryDatabase(
        {
            "works": [WORK],
            "compliance_results": [{
                "result_id": "rule-result-001",
                "work_id": WORK["work_id"],
                "status": "deviation_detected",
                "triggered_at": AS_OF,
            }],
        }
    )

    first = await ModelInferenceService(db).predict_work(WORK["work_id"], prediction_timestamp=AS_OF)
    second = await ModelInferenceService(db).predict_work(WORK["work_id"], prediction_timestamp=AS_OF)

    assert first is not None and second is not None
    assert first.model_dump(exclude={"prediction_id"}) == second.model_dump(exclude={"prediction_id"})
    assert first.inference_source == FALLBACK_SOURCE
    assert "heuristic-delay-v1" in first.model_version
    assert "heuristic-anomaly-v1" in first.model_version
    assert first.triggered_rule_ids == ["rule-result-001"]
    assert "not an ML prediction" in first.explanation_snapshot["delay"]["statement"]
    assert "not a fraud label" in first.explanation_snapshot["anomaly"]["statement"]

    stored = db.get_collection("model_predictions").documents
    assert len(stored) == 2
    assert stored[0]["work_id"] == WORK["work_id"]
    assert stored[0]["model_version"] == first.model_version
    assert stored[0]["prediction_timestamp"] == AS_OF
    assert "feature_snapshot" in stored[0]
    assert "explanation_snapshot" in stored[0]
    assert stored[0]["triggered_rule_ids"] == ["rule-result-001"]


@pytest.mark.asyncio
@pytest.mark.skipif(
    os.getenv("RUN_MONGODB_INTEGRATION_TESTS") != "1",
    reason="Set RUN_MONGODB_INTEGRATION_TESTS=1 to run against an isolated MongoDB test database.",
)
async def test_prediction_snapshot_is_persisted_in_real_mongodb():
    """Exercise the actual MongoDB path only against an explicitly named test DB."""
    from app.core.config import get_settings
    from app.core.database import Database

    settings = get_settings()
    if not settings.MONGODB_DB_NAME.endswith("_test"):
        pytest.skip("MongoDB integration tests require a database name ending in '_test'.")

    db = Database(settings)
    run_id = str(uuid4())
    work_id = f"ml-integration-{run_id}"
    prediction_id = None
    try:
        await db.connect()
        await db.get_collection("works").insert_one({**WORK, "work_id": work_id})
        await db.get_collection("compliance_results").insert_one({
            "result_id": f"rule-result-{run_id}",
            "work_id": work_id,
            "status": "deviation_detected",
            "triggered_at": AS_OF,
        })

        prediction = await ModelInferenceService(db).predict_work(
            work_id, prediction_timestamp=AS_OF,
        )
        assert prediction is not None
        prediction_id = prediction.prediction_id

        stored = await db.get_collection("model_predictions").find_one(
            {"prediction_id": prediction_id}, {"_id": 0},
        )
        assert stored is not None
        assert stored["work_id"] == work_id
        assert stored["model_version"] == prediction.model_version
        assert stored["feature_snapshot"]
        assert stored["explanation_snapshot"]
        assert stored["triggered_rule_ids"] == [f"rule-result-{run_id}"]
    finally:
        if getattr(db, "_client", None):
            if prediction_id:
                await db.get_collection("model_predictions").delete_many({"prediction_id": prediction_id})
            await db.get_collection("compliance_results").delete_many({"work_id": work_id})
            await db.get_collection("works").delete_many({"work_id": work_id})
            await db.disconnect()
