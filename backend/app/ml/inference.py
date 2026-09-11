"""Safe Phase 9 inference with approved-artifact loading and deterministic fallback."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional
from uuid import uuid4

from app.core.database import Database
from app.ml.model_registry import ModelRegistry, PREDICTIONS_COLLECTION, resolve_artifact_path
from app.models.ml import ModelType, PredictionRecord

logger = logging.getLogger("samarth.ml.inference")

WORKS_COLLECTION = "works"
RESULTS_COLLECTION = "compliance_results"
FALLBACK_DELAY_VERSION = "heuristic-delay-v1"
FALLBACK_ANOMALY_VERSION = "heuristic-anomaly-v1"
FALLBACK_SOURCE = "deterministic_heuristic_fallback"


class ModelInferenceService:
    """Creates immutable predictions from approved model artifacts or a safe fallback."""

    def __init__(self, db: Database):
        self._db = db
        self._works = db.get_collection(WORKS_COLLECTION)
        self._results = db.get_collection(RESULTS_COLLECTION)
        self._predictions = db.get_collection(PREDICTIONS_COLLECTION)
        self._registry = ModelRegistry(db)

    async def predict_work(
        self, work_id: str, *, prediction_timestamp: Optional[datetime] = None,
    ) -> Optional[PredictionRecord]:
        """Generate and persist one complete prediction snapshot for a work."""
        work = await self._works.find_one({"work_id": work_id}, {"_id": 0})
        if not work:
            return None
        timestamp = prediction_timestamp or datetime.now(timezone.utc)
        triggered_rule_ids = await self._triggered_rule_ids(work_id)

        # Import the numerical runtime lazily. An unavailable environment still
        # produces a persisted, explicitly labelled deterministic fallback.
        try:
            from app.ml.feature_engineering import feature_frame, feature_schema, feature_vector

            features = feature_frame([work], as_of=timestamp)
            delay, delay_version, delay_source, delay_explanation = await self._delay_signal(features)
            anomaly, anomaly_version, anomaly_source, anomaly_explanation = await self._anomaly_signal(features)
            feature_snapshot = {
                "schema": feature_schema(),
                "values": feature_vector(work, as_of=timestamp),
            }
        except Exception as exc:
            logger.warning("ML feature runtime unavailable; using fallback for work %s: %s", work_id, type(exc).__name__)
            fallback_features = _fallback_features(work, timestamp)
            delay, delay_explanation = _heuristic_delay(fallback_features)
            anomaly, anomaly_explanation = _heuristic_anomaly(fallback_features)
            delay_version = FALLBACK_DELAY_VERSION
            anomaly_version = FALLBACK_ANOMALY_VERSION
            delay_source = anomaly_source = FALLBACK_SOURCE
            feature_snapshot = {"schema": {"version": "heuristic-features-v1"}, "values": fallback_features}

        all_ml = delay_source == "approved_model_artifact" and anomaly_source == "approved_model_artifact"
        model_version = f"delay={delay_version};anomaly={anomaly_version}"
        record = PredictionRecord(
            prediction_id=str(uuid4()),
            work_id=work_id,
            model_version=model_version,
            prediction_timestamp=timestamp,
            delay_probability=round(delay, 6),
            anomaly_score=round(anomaly, 4),
            feature_snapshot=feature_snapshot,
            explanation_snapshot={
                "delay": delay_explanation,
                "anomaly": anomaly_explanation,
                "model_versions": {"delay": delay_version, "anomaly": anomaly_version},
                "inference_sources": {"delay": delay_source, "anomaly": anomaly_source},
                "notice": (
                    "Approved model artifacts were used for both signals."
                    if all_ml
                    else "At least one signal used a deterministic heuristic fallback because an approved artifact was unavailable."
                ),
            },
            triggered_rule_ids=triggered_rule_ids,
            inference_source="approved_model_artifact" if all_ml else FALLBACK_SOURCE,
        )
        await self._predictions.insert_one(record.model_dump(mode="python"))
        return record

    async def get_latest_prediction(self, work_id: str) -> Optional[dict]:
        return await self._predictions.find_one(
            {"work_id": work_id}, {"_id": 0}, sort=[("prediction_timestamp", -1), ("prediction_id", 1)]
        )

    async def _delay_signal(self, features: Any) -> tuple[float, str, str, dict[str, Any]]:
        from app.ml.explainability import delay_prediction_explanation
        from app.ml.feature_engineering import FEATURE_COLUMNS

        entry = await self._registry.get_active(ModelType.DELAY_CLASSIFIER)
        artifact = _load_artifact(entry)
        if not artifact:
            probability, explanation = _heuristic_delay(_frame_row(features))
            return probability, FALLBACK_DELAY_VERSION, FALLBACK_SOURCE, explanation

        model = artifact["model"]
        columns = artifact.get("feature_columns", FEATURE_COLUMNS)
        probability = float(model.predict_proba(features.loc[:, columns])[:, 1][0])
        explanation = delay_prediction_explanation(
            model,
            features,
            columns,
            artifact.get("global_feature_importance", {}),
        )
        explanation["statement"] = "This is a delay-risk probability estimated from the approved synthetic-data model; it requires human review."
        return _clamp(probability, 0.0, 1.0), str(entry["model_version"]), "approved_model_artifact", explanation

    async def _anomaly_signal(self, features: Any) -> tuple[float, str, str, dict[str, Any]]:
        from app.ml.explainability import anomaly_prediction_explanation
        from app.ml.feature_engineering import ANOMALY_FEATURE_COLUMNS

        entry = await self._registry.get_active(ModelType.EXECUTION_ANOMALY_DETECTOR)
        artifact = _load_artifact(entry)
        if not artifact:
            score, explanation = _heuristic_anomaly(_frame_row(features))
            return score, FALLBACK_ANOMALY_VERSION, FALLBACK_SOURCE, explanation

        model = artifact["model"]
        columns = artifact.get("feature_columns", ANOMALY_FEATURE_COLUMNS)
        row = features.loc[:, columns]
        decision = float(model.decision_function(row)[0])
        calibration = artifact.get("decision_score_calibration", {})
        lower = float(calibration.get("p05", -0.1))
        upper = float(calibration.get("p95", 0.1))
        # Isolation Forest returns lower decision values for less typical rows.
        score = 100.0 * (upper - decision) / max(upper - lower, 1e-9)
        explanation = anomaly_prediction_explanation(row, artifact.get("reference_profile", {}))
        explanation["decision_function"] = round(decision, 8)
        explanation["statement"] = "An anomaly score indicates an unusual financial or execution pattern; it is not a fraud label or determination."
        return _clamp(score, 0.0, 100.0), str(entry["model_version"]), "approved_model_artifact", explanation

    async def _triggered_rule_ids(self, work_id: str) -> list[str]:
        documents = await self._results.find(
            {"work_id": work_id, "status": "deviation_detected"}, {"_id": 0, "result_id": 1}
        ).sort([("triggered_at", -1), ("result_id", 1)]).to_list(length=None)
        return sorted({str(document["result_id"]) for document in documents if document.get("result_id")})


def _load_artifact(entry: Optional[dict]) -> Optional[dict[str, Any]]:
    if not entry:
        return None
    try:
        path = resolve_artifact_path(str(entry["artifact_path"]))
        if not path.is_file():
            logger.warning("Approved model %s has no artifact at %s", entry.get("model_version"), path)
            return None
        import joblib

        artifact = joblib.load(path)
        if artifact.get("model_version") != entry.get("model_version"):
            logger.error("Artifact version does not match registry entry: %s", entry.get("model_version"))
            return None
        return artifact
    except Exception as exc:
        logger.warning("Model artifact cannot be loaded: %s", type(exc).__name__)
        return None


def _fallback_features(work: dict[str, Any], timestamp: datetime) -> dict[str, float]:
    sanctioned = _number(work.get("sanctioned_amount"))
    released_pct = 100 * _number(work.get("funds_released")) / sanctioned if sanctioned else 0.0
    expenditure_pct = 100 * _number(work.get("actual_expenditure")) / sanctioned if sanctioned else 0.0
    progress = _clamp(_number(work.get("physical_progress_pct")), 0, 100)
    return {
        "funds_released_pct": _clamp(released_pct, 0, 200),
        "actual_expenditure_pct": _clamp(expenditure_pct, 0, 200),
        "physical_progress_pct": progress,
        "financial_progress_gap_pct": abs(released_pct - progress),
        "funds_excess_pct": max(0.0, released_pct - 100.0),
        "expenditure_release_gap_pct": abs(expenditure_pct - released_pct),
        "is_overdue": float(_is_overdue(work, timestamp)),
        "is_on_hold": float(str(work.get("status", "")) == "on_hold"),
        "days_since_last_progress_update": _days_since_last_update(work, timestamp),
    }


def _heuristic_delay(values: dict[str, float]) -> tuple[float, dict[str, Any]]:
    raw = (
        0.55 * values.get("is_overdue", 0.0)
        + 0.20 * values.get("is_on_hold", 0.0)
        + 0.15 * _clamp(values.get("financial_progress_gap_pct", 0.0) / 100.0, 0, 1)
        + 0.10 * _clamp(values.get("days_since_last_progress_update", 0.0) / 180.0, 0, 1)
    )
    probability = _clamp(raw, 0.0, 0.95)
    return probability, {
        "method": FALLBACK_SOURCE,
        "statement": "No approved delay-model artifact is available. This deterministic prioritisation heuristic is not an ML prediction.",
        "factors": _fallback_factor_list(values),
    }


def _heuristic_anomaly(values: dict[str, float]) -> tuple[float, dict[str, Any]]:
    score = (
        0.50 * _clamp(values.get("financial_progress_gap_pct", 0.0), 0, 100)
        + 0.25 * _clamp(values.get("funds_excess_pct", 0.0), 0, 100)
        + 0.15 * _clamp(values.get("expenditure_release_gap_pct", 0.0), 0, 100)
        + 10.0 * values.get("is_on_hold", 0.0)
    )
    return _clamp(score, 0.0, 100.0), {
        "method": FALLBACK_SOURCE,
        "statement": "No approved anomaly-model artifact is available. This deterministic unusual-pattern signal is not an ML prediction and is not a fraud label.",
        "factors": _fallback_factor_list(values),
    }


def _fallback_factor_list(values: dict[str, float]) -> list[dict[str, Any]]:
    candidates = [
        ("financial_progress_gap_pct", values.get("financial_progress_gap_pct", 0.0)),
        ("funds_excess_pct", values.get("funds_excess_pct", 0.0)),
        ("expenditure_release_gap_pct", values.get("expenditure_release_gap_pct", 0.0)),
        ("days_since_last_progress_update", values.get("days_since_last_progress_update", 0.0)),
        ("is_overdue", values.get("is_overdue", 0.0) * 100),
    ]
    return [
        {"feature": name, "observed_value": round(float(value), 6)}
        for name, value in sorted(candidates, key=lambda item: (-item[1], item[0]))[:5]
    ]


def _frame_row(frame: Any) -> dict[str, float]:
    return {str(column): float(frame.iloc[0][column]) for column in frame.columns}


def _number(value: Any) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, float(value)))


def _date(value: Any) -> Optional[datetime]:
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
        except ValueError:
            return None
    return None


def _is_overdue(work: dict[str, Any], timestamp: datetime) -> bool:
    expected = _date(work.get("expected_completion_date"))
    return bool(expected and timestamp > expected and str(work.get("status", "")) not in {"completed", "cancelled"})


def _days_since_last_update(work: dict[str, Any], timestamp: datetime) -> float:
    dates = [parsed for parsed in (_date(item.get("date")) for item in work.get("progress_updates", [])) if parsed]
    return float(max(0, (timestamp - max(dates)).days) if dates else 0)
