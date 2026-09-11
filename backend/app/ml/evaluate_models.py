"""Evaluate registered Phase 9 models on the reproducible synthetic dataset."""

from __future__ import annotations

import argparse
import asyncio
import json
from typing import Any, Iterable

import joblib
import numpy as np
from sklearn.metrics import confusion_matrix, f1_score, precision_score, recall_score, roc_auc_score
from sklearn.model_selection import train_test_split

from app.core.config import get_settings
from app.core.database import Database
from app.ml.feature_engineering import ANOMALY_FEATURE_COLUMNS, FEATURE_COLUMNS, build_training_frame, training_as_of
from app.ml.model_registry import ModelRegistry, resolve_artifact_path
from app.models.ml import ModelType
from app.ml.train_delay_model import RANDOM_STATE, TEST_SIZE


def evaluate_delay_artifact(artifact: dict[str, Any], works: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Measure a delay artifact on the same documented deterministic holdout rule."""
    works_list = sorted(list(works), key=lambda work: str(work.get("work_id", "")))
    features, labels, _ = build_training_frame(works_list, as_of=training_as_of(works_list))
    _, X_test, _, y_test = train_test_split(
        features, labels, test_size=TEST_SIZE, random_state=RANDOM_STATE, stratify=labels,
    )
    probability = artifact["model"].predict_proba(X_test.loc[:, artifact.get("feature_columns", FEATURE_COLUMNS)])[:, 1]
    predicted = (probability >= 0.5).astype(int)
    return {
        "precision": round(float(precision_score(y_test, predicted, zero_division=0)), 6),
        "recall": round(float(recall_score(y_test, predicted, zero_division=0)), 6),
        "f1": round(float(f1_score(y_test, predicted, zero_division=0)), 6),
        "roc_auc": round(float(roc_auc_score(y_test, probability)), 6),
        "confusion_matrix": confusion_matrix(y_test, predicted, labels=[0, 1]).tolist(),
        "evaluation_notice": "Measured on deterministic synthetic holdout data only; not an operational accuracy claim.",
    }


def evaluate_anomaly_artifact(artifact: dict[str, Any], works: Iterable[dict[str, Any]]) -> dict[str, Any]:
    """Report detector behaviour against synthetic scenario tags as a diagnostic."""
    works_list = sorted(list(works), key=lambda work: str(work.get("work_id", "")))
    features, _, synthetic_reference = build_training_frame(works_list, as_of=training_as_of(works_list))
    flags = (artifact["model"].predict(features.loc[:, artifact.get("feature_columns", ANOMALY_FEATURE_COLUMNS)]) == -1).astype(int)
    return {
        "detector_flag_rate": round(float(flags.mean()), 6),
        "synthetic_reference_alignment": {
            "precision": round(float(precision_score(synthetic_reference, flags, zero_division=0)), 6),
            "recall": round(float(recall_score(synthetic_reference, flags, zero_division=0)), 6),
            "f1": round(float(f1_score(synthetic_reference, flags, zero_division=0)), 6),
            "confusion_matrix": confusion_matrix(synthetic_reference, flags, labels=[0, 1]).tolist(),
        },
        "evaluation_notice": "This unsupervised detector diagnostic compares flags with synthetic scenarios only. It is not a fraud metric or operational accuracy claim.",
    }


async def _run(args: argparse.Namespace) -> None:
    db = Database(get_settings())
    await db.connect()
    try:
        registry = ModelRegistry(db)
        model_type = ModelType(args.model_type)
        entry = await registry.get_by_version(args.model_version) if args.model_version else await registry.get_active(model_type)
        if not entry:
            raise SystemExit("No matching model registry entry was found.")
        if entry["model_type"] != model_type.value:
            raise SystemExit("The selected model does not match --model-type.")
        artifact = joblib.load(resolve_artifact_path(entry["artifact_path"]))
        works = await db.get_collection("works").find({"_anomaly_tags": {"$exists": True}}, {"_id": 0}).to_list(length=None)
        metrics = evaluate_delay_artifact(artifact, works) if model_type == ModelType.DELAY_CLASSIFIER else evaluate_anomaly_artifact(artifact, works)
        print(json.dumps({"model_version": entry["model_version"], "metrics": metrics}, indent=2))
    finally:
        await db.disconnect()


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate a registered Phase 9 model against the synthetic dataset.")
    parser.add_argument("--model-type", required=True, choices=[item.value for item in ModelType])
    parser.add_argument("--model-version")
    asyncio.run(_run(parser.parse_args()))


if __name__ == "__main__":
    main()
