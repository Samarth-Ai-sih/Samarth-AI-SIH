"""Deterministic feature engineering for synthetic MPLADS-style work data.

The functions in this module deliberately exclude ``_anomaly_tags`` from
inference features. Those tags are controlled synthetic ground truth used
only while training or evaluating models.
"""

from __future__ import annotations

import hashlib
import json
import math
from datetime import datetime, timezone
from typing import Any, Iterable, Optional

import numpy as np
import pandas as pd

FEATURE_SCHEMA_VERSION = "mplads-work-features-v1"
DATASET_SCHEMA_VERSION = "synthetic-mplads-v1"

FEATURE_COLUMNS = [
    "sanctioned_amount_log",
    "funds_released_pct",
    "actual_expenditure_pct",
    "physical_progress_pct",
    "financial_progress_gap_pct",
    "funds_excess_pct",
    "expenditure_release_gap_pct",
    "days_recommendation_to_sanction",
    "days_since_start",
    "planned_duration_days",
    "schedule_elapsed_pct",
    "progress_delay_pct",
    "is_overdue",
    "progress_update_count",
    "days_since_last_progress_update",
    "is_on_hold",
    "is_in_progress",
    "is_completed_or_verification",
]

ANOMALY_FEATURE_COLUMNS = [
    "funds_released_pct",
    "actual_expenditure_pct",
    "physical_progress_pct",
    "financial_progress_gap_pct",
    "funds_excess_pct",
    "expenditure_release_gap_pct",
    "schedule_elapsed_pct",
    "progress_delay_pct",
    "days_since_last_progress_update",
]

DELAY_TAGS = {"overdue", "dormant", "red:stalled", "amber:moderate_delay", "amber:slow_progress"}
EXECUTION_ANOMALY_PREFIXES = ("red:", "financial_mismatch", "dormant", "overdue", "amber:")


def feature_schema() -> dict[str, Any]:
    """Return a JSON-serialisable, versioned schema stored with artifacts."""
    return {
        "version": FEATURE_SCHEMA_VERSION,
        "columns": list(FEATURE_COLUMNS),
        "anomaly_columns": list(ANOMALY_FEATURE_COLUMNS),
        "missing_value_policy": "numeric values are deterministically imputed to zero",
        "target_policy": "synthetic _anomaly_tags are used only for offline training/evaluation",
    }


def feature_vector(work: dict[str, Any], *, as_of: Optional[datetime] = None) -> dict[str, float]:
    """Create one deterministic numeric feature row from a work document."""
    as_of = _as_utc(as_of) or datetime.now(timezone.utc)
    sanctioned = _number(work.get("sanctioned_amount"))
    released = _number(work.get("funds_released"))
    expenditure = _number(work.get("actual_expenditure"))
    progress = _clamp(_number(work.get("physical_progress_pct")))

    recommended = _as_utc(work.get("recommended_date"))
    sanctioned_date = _as_utc(work.get("sanctioned_date"))
    start = _as_utc(work.get("start_date"))
    expected = _as_utc(work.get("expected_completion_date"))
    updates = list(work.get("progress_updates") or [])
    update_dates = [
        parsed for parsed in (_as_utc(update.get("date")) for update in updates)
        if parsed is not None
    ]
    latest_update = max(update_dates, default=None)

    released_pct = _percentage(released, sanctioned)
    expenditure_pct = _percentage(expenditure, sanctioned)
    elapsed_pct = _percentage((as_of - start).days, (expected - start).days) if start and expected else 0.0
    progress_delay = max(0.0, elapsed_pct - progress)
    financial_progress_gap = abs(released_pct - progress)

    return {
        "sanctioned_amount_log": round(math.log1p(max(0.0, sanctioned)), 6),
        "funds_released_pct": round(_clamp(released_pct), 6),
        "actual_expenditure_pct": round(_clamp(expenditure_pct), 6),
        "physical_progress_pct": round(progress, 6),
        "financial_progress_gap_pct": round(_clamp(financial_progress_gap), 6),
        "funds_excess_pct": round(_clamp(max(0.0, released_pct - 100.0)), 6),
        "expenditure_release_gap_pct": round(_clamp(abs(expenditure_pct - released_pct)), 6),
        "days_recommendation_to_sanction": float(_days_between(recommended, sanctioned_date)),
        "days_since_start": float(max(0, (as_of - start).days) if start else 0),
        "planned_duration_days": float(max(0, _days_between(start, expected))),
        "schedule_elapsed_pct": round(_clamp(elapsed_pct), 6),
        "progress_delay_pct": round(_clamp(progress_delay), 6),
        "is_overdue": float(bool(expected and as_of > expected and str(work.get("status", "")) not in {"completed", "cancelled"})),
        "progress_update_count": float(len(updates)),
        "days_since_last_progress_update": float(max(0, (as_of - latest_update).days) if latest_update else 0),
        "is_on_hold": float(str(work.get("status", "")) == "on_hold"),
        "is_in_progress": float(str(work.get("status", "")) == "in_progress"),
        "is_completed_or_verification": float(str(work.get("status", "")) in {"completed", "under_verification"}),
    }


def feature_frame(works: Iterable[dict[str, Any]], *, as_of: Optional[datetime] = None) -> pd.DataFrame:
    """Build a column-stable DataFrame suitable for both training and inference."""
    rows = [feature_vector(work, as_of=as_of) for work in works]
    frame = pd.DataFrame(rows, columns=FEATURE_COLUMNS)
    return frame.fillna(0.0).astype(float)


def delay_target(work: dict[str, Any]) -> int:
    """Offline synthetic target: delayed lifecycle scenarios, never an inference input."""
    tags = {str(tag).lower() for tag in work.get("_anomaly_tags", [])}
    return int(bool(tags & DELAY_TAGS))


def execution_anomaly_reference_label(work: dict[str, Any]) -> int:
    """Synthetic evaluation reference only; it is not a fraud label."""
    tags = [str(tag).lower() for tag in work.get("_anomaly_tags", [])]
    return int(any(tag.startswith(EXECUTION_ANOMALY_PREFIXES) for tag in tags))


def build_training_frame(
    works: Iterable[dict[str, Any]], *, as_of: Optional[datetime] = None,
) -> tuple[pd.DataFrame, np.ndarray, np.ndarray]:
    """Return features plus synthetic delay and anomaly-reference labels."""
    works_list = list(works)
    return (
        feature_frame(works_list, as_of=as_of),
        np.asarray([delay_target(work) for work in works_list], dtype=int),
        np.asarray([execution_anomaly_reference_label(work) for work in works_list], dtype=int),
    )


def dataset_version(works: Iterable[dict[str, Any]]) -> str:
    """Derive a stable version from the synthetic documents used in a run."""
    canonical = []
    for work in sorted(works, key=lambda item: str(item.get("work_id", ""))):
        canonical.append({
            "work_id": str(work.get("work_id", "")),
            "status": str(work.get("status", "")),
            "sanctioned_amount": _number(work.get("sanctioned_amount")),
            "funds_released": _number(work.get("funds_released")),
            "actual_expenditure": _number(work.get("actual_expenditure")),
            "physical_progress_pct": _number(work.get("physical_progress_pct")),
            "recommended_date": str(work.get("recommended_date", "")),
            "sanctioned_date": str(work.get("sanctioned_date", "")),
            "start_date": str(work.get("start_date", "")),
            "expected_completion_date": str(work.get("expected_completion_date", "")),
            "progress_update_dates": sorted(
                str(item.get("date", "")) for item in (work.get("progress_updates") or [])
            ),
            "created_at": str(work.get("created_at", "")),
            "updated_at": str(work.get("updated_at", "")),
            "anomaly_tags": sorted(str(tag) for tag in work.get("_anomaly_tags", [])),
        })
    payload = json.dumps(canonical, sort_keys=True, separators=(",", ":"), default=str).encode("utf-8")
    return f"{DATASET_SCHEMA_VERSION}-{hashlib.sha256(payload).hexdigest()[:12]}"


def training_as_of(works: Iterable[dict[str, Any]]) -> datetime:
    """Choose a reproducible reference time embedded in the generated dataset.

    Training features must not use the wall clock, otherwise the same dataset
    can produce different splits of feature values on different days.
    """
    timestamps = []
    for work in works:
        for field in ("updated_at", "created_at"):
            parsed = _as_utc(work.get(field))
            if parsed:
                timestamps.append(parsed)
    return max(timestamps) if timestamps else datetime(2026, 1, 1, tzinfo=timezone.utc)


def _number(value: Any) -> float:
    try:
        return float(value or 0.0)
    except (TypeError, ValueError):
        return 0.0


def _percentage(numerator: float, denominator: float) -> float:
    return (numerator / denominator) * 100.0 if denominator > 0 else 0.0


def _clamp(value: float, low: float = 0.0, high: float = 100.0) -> float:
    return max(low, min(high, value))


def _days_between(start: Optional[datetime], end: Optional[datetime]) -> int:
    return max(0, (end - start).days) if start and end else 0


def _as_utc(value: Any) -> Optional[datetime]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    if isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
        except ValueError:
            return None
    return None
