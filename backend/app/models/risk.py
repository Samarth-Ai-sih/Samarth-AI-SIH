"""
SAMARTH AI -- Risk Scoring Models

Pydantic models for the composite risk scoring engine:
- RiskScore: full scoring output with sub-scores, explanations, and metadata
- RiskTier: Green/Amber/Red classification
- Request/response schemas

Every alert carries:
  "AI signal — requires human review."
"""

from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional

from pydantic import BaseModel, Field


# -- Enums ----------------------------------------------------------------


class RiskTier(str, Enum):
    """Risk classification tier."""
    GREEN = "green"
    AMBER = "amber"
    RED = "red"


# -- Sub-Score Model ------------------------------------------------------


class SubScore(BaseModel):
    """A single dimension's risk sub-score."""
    dimension: str                          # e.g. "time_risk"
    label: str                              # e.g. "Time Risk"
    raw_score: float = Field(ge=0, le=100)  # 0-100
    weight: float = Field(ge=0, le=1)       # 0.0-1.0
    weighted_score: float = Field(ge=0, le=100)
    factors: list[str] = Field(default_factory=list)  # Human-readable factors


class TriggeredRule(BaseModel):
    """A compliance rule that contributed to the risk score."""
    rule_code: str
    rule_name: str
    severity: str
    contribution: float                     # Points added to relevant sub-score


class ExplanationEntry(BaseModel):
    """A single explanation factor for the risk score."""
    rank: int
    factor: str                             # Human-readable explanation
    dimension: str
    impact: str                             # "high", "medium", "low"


class ExplanationSnapshot(BaseModel):
    """Immutable, human-readable explanation captured with a score."""
    summary: str
    top_factors: list[ExplanationEntry] = Field(default_factory=list)
    scoring_policy: dict[str, Any] = Field(default_factory=dict)


# -- Main Risk Score Document ---------------------------------------------


class RiskScore(BaseModel):
    """
    Complete risk score document stored in the `risk_scores` collection.

    Every score includes:
      "AI signal — requires human review."
    """
    score_id: str
    work_id: str

    # Core score
    composite_score: float = Field(ge=0, le=100)    # 0-100
    risk_tier: RiskTier
    confidence: float = Field(ge=0, le=1)           # 0.0-1.0

    # Sub-scores
    sub_scores: list[SubScore] = Field(default_factory=list)

    # Placeholders
    delay_probability: Optional[float] = None       # Placeholder for ML model
    anomaly_score: Optional[float] = None           # Placeholder for ML model

    # Rules and explanations
    triggered_rules: list[TriggeredRule] = Field(default_factory=list)
    top_factors: list[ExplanationEntry] = Field(default_factory=list)
    explanation_snapshot: ExplanationSnapshot

    # Recommended action
    recommended_action: str = ""

    # Feature snapshot (frozen input features used for scoring)
    feature_snapshot: dict[str, Any] = Field(default_factory=dict)

    # Versioning and metadata
    model_version: str = "deterministic-rules-v1.0.0"
    score_version: int = 1
    calculated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # AI disclaimer
    ai_disclaimer: str = "AI signal — requires human review."

    # Supporting data references
    supporting_data: dict[str, Any] = Field(default_factory=dict)


# -- Request / Response Schemas -------------------------------------------


class ScoreWorkRequest(BaseModel):
    """Request to score a specific work."""
    work_id: str


class BatchScoreRequest(BaseModel):
    """Request to score multiple works."""
    work_ids: Optional[list[str]] = None    # None = all works in jurisdiction


class RiskScoreResponse(BaseModel):
    """Public API representation of a risk score."""
    score_id: str
    work_id: str
    work_title: Optional[str] = None
    district_name: Optional[str] = None
    state_name: Optional[str] = None
    mp_name: Optional[str] = None
    composite_score: float
    risk_tier: RiskTier
    confidence: float
    sub_scores: list[SubScore]
    delay_probability: Optional[float]
    anomaly_score: Optional[float]
    triggered_rules: list[TriggeredRule]
    top_factors: list[ExplanationEntry]
    explanation_snapshot: ExplanationSnapshot
    recommended_action: str
    feature_snapshot: dict[str, Any]
    model_version: str
    score_version: int
    calculated_at: datetime
    ai_disclaimer: str
    supporting_data: dict[str, Any]


class RiskScoreListResponse(BaseModel):
    """Paginated list of risk scores."""
    scores: list[RiskScoreResponse]
    total: int
    page: int
    page_size: int
    total_pages: int


class BatchScoreResponse(BaseModel):
    """Response from batch scoring."""
    works_scored: int
    green: int
    amber: int
    red: int
    avg_score: float
    duration_ms: int


class RiskDistribution(BaseModel):
    """Risk tier distribution summary."""
    green: int = 0
    amber: int = 0
    red: int = 0
    total: int = 0
    avg_composite_score: float = 0.0
