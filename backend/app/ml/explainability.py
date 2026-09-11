"""Bounded, human-readable explanations for Phase 9 model signals."""

from __future__ import annotations

from typing import Any, Optional

import numpy as np
import pandas as pd


def feature_importance_from_model(model: Any, feature_names: list[str]) -> dict[str, float]:
    """Return sorted global feature importances where the model exposes them."""
    values = getattr(model, "feature_importances_", None)
    if values is None:
        return {}
    ranked = sorted(
        ((name, float(value)) for name, value in zip(feature_names, values)),
        key=lambda item: (-item[1], item[0]),
    )
    return {name: round(value, 8) for name, value in ranked}


def shap_summary(
    model: Any, features: pd.DataFrame, feature_names: list[str], *, max_samples: int = 200,
) -> dict[str, Any]:
    """Compute aggregate SHAP values, returning an explicit unavailable state on failure."""
    if features.empty:
        return {"status": "unavailable", "reason": "No evaluation rows supplied."}
    try:
        import shap  # Imported lazily so inference can fall back if unavailable.

        sample = features.loc[:, feature_names].head(max_samples)
        values = shap.TreeExplainer(model).shap_values(sample)
        values_array = np.asarray(values)
        if values_array.ndim == 3:
            values_array = values_array[:, :, -1]
        mean_abs = np.abs(values_array).mean(axis=0)
        ranked = sorted(zip(feature_names, mean_abs), key=lambda item: (-float(item[1]), item[0]))
        return {
            "status": "available",
            "sample_size": int(len(sample)),
            "mean_absolute_shap": {name: round(float(value), 8) for name, value in ranked},
        }
    except Exception as exc:
        return {
            "status": "unavailable",
            "reason": f"SHAP could not be computed: {type(exc).__name__}",
        }


def delay_prediction_explanation(
    model: Any,
    row: pd.DataFrame,
    feature_names: list[str],
    global_importance: dict[str, float],
) -> dict[str, Any]:
    """Return up to five prediction-level SHAP contributors, without inventing values."""
    try:
        import shap

        values = np.asarray(shap.TreeExplainer(model).shap_values(row.loc[:, feature_names]))
        if values.ndim == 3:
            values = values[:, :, -1]
        contributions = values[0]
        ranked = sorted(
            zip(feature_names, contributions), key=lambda item: (-abs(float(item[1])), item[0])
        )[:5]
        return {
            "method": "shap_tree_explainer",
            "factors": [
                {"feature": name, "shap_value": round(float(value), 6), "direction": "increases" if value >= 0 else "decreases"}
                for name, value in ranked
            ],
        }
    except Exception as exc:
        ranked = sorted(global_importance.items(), key=lambda item: (-item[1], item[0]))[:5]
        return {
            "method": "global_feature_importance_fallback",
            "reason": f"Prediction-level SHAP unavailable: {type(exc).__name__}",
            "factors": [
                {"feature": name, "importance": round(float(value), 6), "observed_value": round(float(row.iloc[0][name]), 6)}
                for name, value in ranked
            ],
        }


def anomaly_prediction_explanation(
    row: pd.DataFrame,
    reference_profile: dict[str, dict[str, float]],
    *,
    max_factors: int = 5,
) -> dict[str, Any]:
    """Explain deviation from the training distribution, never a fraud assertion."""
    deviations = []
    for feature in row.columns:
        observed = float(row.iloc[0][feature])
        reference = reference_profile.get(feature, {})
        median = float(reference.get("median", 0.0))
        iqr = max(float(reference.get("iqr", 0.0)), 1e-6)
        robust_distance = abs(observed - median) / iqr
        deviations.append((feature, observed, median, robust_distance))
    ranked = sorted(deviations, key=lambda item: (-item[3], item[0]))[:max_factors]
    return {
        "method": "training_distribution_deviation",
        "statement": "These are unusual execution or financial patterns relative to the training data; they are not a fraud determination.",
        "factors": [
            {
                "feature": name,
                "observed_value": round(observed, 6),
                "training_median": round(median, 6),
                "robust_distance": round(distance, 6),
            }
            for name, observed, median, distance in ranked
        ],
    }
