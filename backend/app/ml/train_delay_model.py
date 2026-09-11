"""Reproducible XGBoost delay-model training for the synthetic MPLADS dataset."""

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
from sklearn.metrics import confusion_matrix, f1_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import train_test_split
from xgboost import XGBClassifier

from app.core.config import get_settings
from app.core.database import Database
from app.ml.explainability import feature_importance_from_model, shap_summary
from app.ml.feature_engineering import FEATURE_COLUMNS, build_training_frame, dataset_version, feature_schema, training_as_of
from app.ml.model_registry import ModelRegistry, artifact_path_for, relative_artifact_path
from app.models.ml import ApprovalStatus, ModelRegistryEntry, ModelType

RANDOM_STATE = 42
TEST_SIZE = 0.20
TRAINING_CONFIG = {
    "n_estimators": 240,
    "max_depth": 4,
    "learning_rate": 0.05,
    "subsample": 0.90,
    "colsample_bytree": 0.90,
    "random_state": RANDOM_STATE,
    "n_jobs": 1,
    "eval_metric": "logloss",
    "tree_method": "hist",
}


def train_delay_model(
    works: Iterable[dict[str, Any]], *, approval_status: ApprovalStatus = ApprovalStatus.PENDING_APPROVAL,
) -> tuple[ModelRegistryEntry, dict[str, Any]]:
    """Train, evaluate, and serialize a delay classifier from synthetic work records."""
    works_list = sorted(list(works), key=lambda work: str(work.get("work_id", "")))
    if len(works_list) < 20:
        raise ValueError("At least 20 synthetic works are required to train the delay model.")

    as_of = training_as_of(works_list)
    features, labels, _ = build_training_frame(works_list, as_of=as_of)
    label_counts = np.bincount(labels, minlength=2)
    if len(np.unique(labels)) < 2 or int(label_counts.min()) < 2:
        raise ValueError("The synthetic dataset must contain both delayed and non-delayed works.")

    X_train, X_test, y_train, y_test = train_test_split(
        features,
        labels,
        test_size=TEST_SIZE,
        random_state=RANDOM_STATE,
        stratify=labels,
    )
    model = XGBClassifier(**TRAINING_CONFIG)
    model.fit(X_train, y_train)
    probability = model.predict_proba(X_test)[:, 1]
    predicted = (probability >= 0.50).astype(int)

    metrics = {
        "evaluation_split": {"test_size": TEST_SIZE, "random_state": RANDOM_STATE, "stratified": True},
        "test_records": int(len(y_test)),
        "positive_test_records": int(y_test.sum()),
        "precision": round(float(precision_score(y_test, predicted, zero_division=0)), 6),
        "recall": round(float(recall_score(y_test, predicted, zero_division=0)), 6),
        "f1": round(float(f1_score(y_test, predicted, zero_division=0)), 6),
        "roc_auc": round(float(roc_auc_score(y_test, probability)), 6),
        "confusion_matrix": confusion_matrix(y_test, predicted, labels=[0, 1]).tolist(),
        "feature_importance": feature_importance_from_model(model, FEATURE_COLUMNS),
        "shap": shap_summary(model, X_test, FEATURE_COLUMNS),
        "metric_notice": "Metrics are measured on this reproducible synthetic holdout only; they are not a claim about operational performance.",
    }
    version = _model_version("delay-xgb", dataset_version(works_list), TRAINING_CONFIG)
    artifact_path = artifact_path_for(version)
    artifact_path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "artifact_format_version": 1,
        "model": model,
        "model_type": ModelType.DELAY_CLASSIFIER.value,
        "model_version": version,
        "feature_columns": FEATURE_COLUMNS,
        "feature_schema": feature_schema(),
        "dataset_version": dataset_version(works_list),
        "training_as_of": as_of.isoformat(),
        "training_metrics": metrics,
        "global_feature_importance": metrics["feature_importance"],
    }
    joblib.dump(payload, artifact_path)

    entry = ModelRegistryEntry(
        model_id=str(uuid4()),
        model_version=version,
        model_type=ModelType.DELAY_CLASSIFIER,
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
    settings = get_settings()
    db = Database(settings)
    await db.connect()
    try:
        works = await db.get_collection("works").find({"_anomaly_tags": {"$exists": True}}, {"_id": 0}).to_list(length=None)
        entry, _ = train_delay_model(
            works,
            approval_status=ApprovalStatus.APPROVED if args.approve else ApprovalStatus.PENDING_APPROVAL,
        )
        registry = ModelRegistry(db)
        await registry.register(entry)
        print(json.dumps({
            "model_version": entry.model_version,
            "artifact_path": entry.artifact_path,
            "approval_status": entry.approval_status.value,
            "training_metrics": entry.training_metrics,
        }, default=str, indent=2))
    finally:
        await db.disconnect()


def main() -> None:
    parser = argparse.ArgumentParser(description="Train the synthetic MPLADS XGBoost delay model.")
    parser.add_argument("--approve", action="store_true", help="Explicitly mark this local training run approved for inference.")
    asyncio.run(_run(parser.parse_args()))


def _model_version(prefix: str, dataset: str, config: dict[str, Any]) -> str:
    digest = hashlib.sha256(json.dumps(config, sort_keys=True).encode("utf-8")).hexdigest()[:8]
    return f"{prefix}-{dataset.rsplit('-', 1)[-1]}-{digest}"


if __name__ == "__main__":
    main()
