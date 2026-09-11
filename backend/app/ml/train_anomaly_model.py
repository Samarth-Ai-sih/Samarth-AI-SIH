"""Reproducible Isolation Forest training for financial/execution anomaly signals."""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Iterable
from uuid import uuid4

import joblib
import numpy as np
from sklearn.ensemble import IsolationForest

from app.core.config import get_settings
from app.core.database import Database
from app.ml.feature_engineering import ANOMALY_FEATURE_COLUMNS, build_training_frame, dataset_version, feature_schema, training_as_of
from app.ml.model_registry import ModelRegistry, artifact_path_for, relative_artifact_path
from app.models.ml import ApprovalStatus, ModelRegistryEntry, ModelType

RANDOM_STATE = 42
TRAINING_CONFIG = {"n_estimators": 240, "contamination": 0.12, "random_state": RANDOM_STATE, "n_jobs": 1}


def train_anomaly_model(
    works: Iterable[dict[str, Any]], *, approval_status: ApprovalStatus = ApprovalStatus.PENDING_APPROVAL,
) -> tuple[ModelRegistryEntry, dict[str, Any]]:
    """Train and serialize an unsupervised detector for unusual execution patterns."""
    works_list = sorted(list(works), key=lambda work: str(work.get("work_id", "")))
    if len(works_list) < 20:
        raise ValueError("At least 20 synthetic works are required to train the anomaly model.")

    features, _, reference_labels = build_training_frame(works_list, as_of=training_as_of(works_list))
    anomaly_features = features.loc[:, ANOMALY_FEATURE_COLUMNS]
    model = IsolationForest(**TRAINING_CONFIG)
    model.fit(anomaly_features)
    decisions = model.decision_function(anomaly_features)
    model_flags = (model.predict(anomaly_features) == -1).astype(int)

    reference_profile = {
        column: {
            "median": round(float(anomaly_features[column].median()), 8),
            "iqr": round(float(anomaly_features[column].quantile(0.75) - anomaly_features[column].quantile(0.25)), 8),
        }
        for column in ANOMALY_FEATURE_COLUMNS
    }
    metrics = {
        "training_records": int(len(anomaly_features)),
        "detector_flag_rate": round(float(model_flags.mean()), 6),
        "decision_score_quantiles": {"p05": round(float(np.quantile(decisions, 0.05)), 8), "p95": round(float(np.quantile(decisions, 0.95)), 8)},
        "synthetic_reference_anomaly_rate": round(float(reference_labels.mean()), 6),
        "metric_notice": "Isolation Forest is unsupervised. These are detector distribution statistics, not accuracy or fraud metrics.",
    }
    version = _model_version("anomaly-iforest", dataset_version(works_list), TRAINING_CONFIG)
    artifact_path = artifact_path_for(version)
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "artifact_format_version": 1,
        "model": model,
        "model_type": ModelType.EXECUTION_ANOMALY_DETECTOR.value,
        "model_version": version,
        "feature_columns": ANOMALY_FEATURE_COLUMNS,
        "feature_schema": feature_schema(),
        "dataset_version": dataset_version(works_list),
        "training_metrics": metrics,
        "reference_profile": reference_profile,
        "decision_score_calibration": metrics["decision_score_quantiles"],
    }
    joblib.dump(payload, artifact_path)
    entry = ModelRegistryEntry(
        model_id=str(uuid4()),
        model_version=version,
        model_type=ModelType.EXECUTION_ANOMALY_DETECTOR,
        artifact_path=relative_artifact_path(artifact_path),
        feature_schema=feature_schema(),
        dataset_version=payload["dataset_version"],
        training_date=datetime.now(timezone.utc),
        training_metrics=metrics,
        approval_status=approval_status,
        rollback_state="active",
    )
    return entry, payload


async def _run(args: argparse.Namespace) -> None:
    db = Database(get_settings())
    await db.connect()
    try:
        works = await db.get_collection("works").find({"_anomaly_tags": {"$exists": True}}, {"_id": 0}).to_list(length=None)
        entry, _ = train_anomaly_model(
            works,
            approval_status=ApprovalStatus.APPROVED if args.approve else ApprovalStatus.PENDING_APPROVAL,
        )
        await ModelRegistry(db).register(entry)
        print(json.dumps({
            "model_version": entry.model_version,
            "artifact_path": entry.artifact_path,
            "approval_status": entry.approval_status.value,
            "training_metrics": entry.training_metrics,
        }, default=str, indent=2))
    finally:
        await db.disconnect()


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the synthetic MPLADS Isolation Forest anomaly detector.")
    parser.add_argument("--approve", action="store_true", help="Explicitly mark this local training run approved for inference.")
    asyncio.run(_run(parser.parse_args()))


def _model_version(prefix: str, dataset: str, config: dict[str, Any]) -> str:
    digest = hashlib.sha256(json.dumps(config, sort_keys=True).encode("utf-8")).hexdigest()[:8]
    return f"{prefix}-{dataset.rsplit('-', 1)[-1]}-{digest}"


if __name__ == "__main__":
    main()
