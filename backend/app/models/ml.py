"""Schemas for versioned ML artifacts and persisted prediction snapshots."""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


class ModelType(str, Enum):
    DELAY_CLASSIFIER = "delay_classifier"
    EXECUTION_ANOMALY_DETECTOR = "execution_anomaly_detector"


class ApprovalStatus(str, Enum):
    PENDING_APPROVAL = "pending_approval"
    APPROVED = "approved"
    REJECTED = "rejected"
    RETIRED = "retired"


class ModelRegistryEntry(BaseModel):
    """Versioned model metadata persisted in the ``model_registry`` collection."""
    model_id: str
    model_version: str
    model_type: ModelType
    artifact_path: str
    feature_schema: dict[str, Any]
    dataset_version: str
    training_date: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    training_metrics: dict[str, Any] = Field(default_factory=dict)
    approval_status: ApprovalStatus = ApprovalStatus.PENDING_APPROVAL
    rollback_state: str = "active"
    created_by: str = "training_pipeline"
    approved_by: Optional[str] = None
    approved_at: Optional[datetime] = None


class PredictionRecord(BaseModel):
    """Immutable live-inference record stored in ``model_predictions``."""
    prediction_id: str
    work_id: str
    model_version: str
    prediction_timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    delay_probability: float = Field(ge=0, le=1)
    anomaly_score: float = Field(ge=0, le=100)
    feature_snapshot: dict[str, Any] = Field(default_factory=dict)
    explanation_snapshot: dict[str, Any] = Field(default_factory=dict)
    triggered_rule_ids: list[str] = Field(default_factory=list)
    inference_source: str
    ai_disclaimer: str = "AI signal — requires human review."


class PredictionResponse(PredictionRecord):
    """Public API representation of a prediction snapshot."""


class ModelRegistryListResponse(BaseModel):
    models: list[ModelRegistryEntry]
    total: int
