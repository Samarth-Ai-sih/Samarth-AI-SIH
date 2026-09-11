"""Schemas for Phase 10 financial intelligence dashboard responses."""

from typing import Optional

from pydantic import BaseModel, Field


class FinancialFilterOption(BaseModel):
    """A selectable, jurisdiction-scoped filter value."""

    value: str
    label: str


class FinancialFilterOptions(BaseModel):
    """Filter values derived from MongoDB works in the caller's scope."""

    states: list[FinancialFilterOption] = Field(default_factory=list)
    districts: list[FinancialFilterOption] = Field(default_factory=list)
    categories: list[FinancialFilterOption] = Field(default_factory=list)
    statuses: list[FinancialFilterOption] = Field(default_factory=list)
    agencies: list[FinancialFilterOption] = Field(default_factory=list)


class FinancialSummary(BaseModel):
    """Portfolio-level financial and physical progress totals."""

    work_count: int
    total_sanctioned_amount: float
    total_funds_released: float
    total_actual_expenditure: float
    funds_released_vs_sanctioned_pct: float
    actual_expenditure_vs_sanctioned_pct: float
    financial_progress_pct: float
    physical_progress_pct: float
    financial_physical_gap_pct: float
    amount_at_risk: float
    works_requiring_verification: int
    calculation_note: str


class FinancialScatterPoint(BaseModel):
    """One work represented in the financial-versus-physical scatter plot."""

    work_id: str
    title: str
    category: str
    implementing_agency: str
    sanctioned_amount: float
    funds_released: float
    actual_expenditure: float
    financial_progress_pct: float
    physical_progress_pct: float
    financial_physical_gap_pct: float
    review_label: Optional[str] = None


class PaymentTimelinePoint(BaseModel):
    """Monthly payment-tranche release totals."""

    period: str
    released_amount: float
    tranche_count: int


class CostBenchmark(BaseModel):
    """Category peer-cost benchmark calculated from visible works."""

    category: str
    peer_count: int
    average_sanctioned_amount: float
    median_sanctioned_amount: float


class CostOutlier(BaseModel):
    """High cost relative to category peers; always a review signal, not a finding."""

    work_id: str
    title: str
    category: str
    implementing_agency: str
    sanctioned_amount: float
    peer_count: int
    peer_median_sanctioned_amount: float
    cost_ratio_to_peer_median: float
    label: str = "Possible financial irregularity"
    verification_status: str = "Requires verification"


class HighSpendLowProgress(BaseModel):
    """Spend/progress divergence that requires a human review."""

    work_id: str
    title: str
    category: str
    implementing_agency: str
    sanctioned_amount: float
    actual_expenditure: float
    financial_progress_pct: float
    physical_progress_pct: float
    financial_physical_gap_pct: float
    amount_at_risk: float
    label: str = "Possible financial irregularity"
    verification_status: str = "Requires verification"


class AgencyAnomalyRanking(BaseModel):
    """Agency-level review prioritisation, not a compliance determination."""

    rank: int
    implementing_agency: str
    work_count: int
    works_requiring_verification: int
    average_financial_physical_gap_pct: float
    amount_at_risk: float
    label: str = "Requires verification"


class AmountAtRiskTrendPoint(BaseModel):
    """Monthly review-priority amount based on the excess financial-progress gap."""

    period: str
    amount_at_risk: float
    work_count: int


class FinancialDashboardResponse(BaseModel):
    """Complete FastAPI response used by the Phase 10 financial dashboard."""

    summary: FinancialSummary
    financial_physical_scatter: list[FinancialScatterPoint] = Field(default_factory=list)
    payment_timeline: list[PaymentTimelinePoint] = Field(default_factory=list)
    cost_benchmarks: list[CostBenchmark] = Field(default_factory=list)
    cost_outliers: list[CostOutlier] = Field(default_factory=list)
    high_spend_low_progress: list[HighSpendLowProgress] = Field(default_factory=list)
    agency_anomaly_ranking: list[AgencyAnomalyRanking] = Field(default_factory=list)
    amount_at_risk_trend: list[AmountAtRiskTrendPoint] = Field(default_factory=list)
    review_notice: str = (
        "Possible financial irregularity signals are prioritisation aids only. "
        "They require verification and are not findings of fraud or misconduct."
    )
