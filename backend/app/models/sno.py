"""State Nodal Officer (SNO) Data Models and Schemas.

Covers:
- Statewide Risk Heatmap & District Matrix
- Bottleneck Escalation & DM Administrative Notices
- Inter-District Allocation & Cross-District Fund Transfers
- Compliance Auditing for Mandatory 10% Annual Physical Inspections
"""

from __future__ import annotations

from typing import List, Optional
from pydantic import BaseModel, Field


class DistrictRiskMetric(BaseModel):
    district_code: str
    district_name: str
    total_works: int
    sanctioned_amount: float
    expenditure_amount: float
    unspent_balance: float
    utilization_rate_pct: float
    delayed_works_count: int
    stalled_works_count: int
    completed_works_count: int
    active_works_count: int
    average_risk_score: float
    risk_tier: str  # "critical" | "high" | "moderate" | "low"
    status_tier: str  # "leading" | "satisfactory" | "lagging"


class StateRiskHeatmapResponse(BaseModel):
    state_code: str
    state_name: str
    total_works: int
    total_sanctioned_cr: float
    total_expenditure_cr: float
    total_unspent_cr: float
    state_utilization_rate_pct: float
    total_districts: int
    lagging_districts_count: int
    critical_risk_districts_count: int
    districts: List[DistrictRiskMetric]


class BottleneckEscalationItem(BaseModel):
    work_id: str
    title: str
    district_code: str
    district_name: str
    constituency: str
    sanctioned_amount: float
    actual_expenditure: float
    physical_progress_pct: float
    financial_utilization_pct: float
    days_delayed: int
    delay_cause: str
    implementing_agency: str
    composite_risk_score: float
    notice_status: str  # "pending" | "notice_issued" | "hearing_scheduled" | "remedied"
    latest_memo_ref: Optional[str] = None
    cure_deadline: Optional[str] = None
    last_escalated_at: Optional[str] = None


class BottleneckEscalationResponse(BaseModel):
    state_code: str
    state_name: str
    total_delayed_works: int
    pending_notices_count: int
    notices_issued_count: int
    bottlenecks: List[BottleneckEscalationItem]


class IssueNoticeRequest(BaseModel):
    statutory_deadline_days: int = Field(default=15, ge=5, le=90)
    custom_remarks: Optional[str] = None
    escalation_reason: Optional[str] = None


class IssueNoticeResponse(BaseModel):
    success: bool
    work_id: str
    memo_reference: str
    district_code: str
    statutory_deadline: str
    issued_to: str
    issued_by: str
    issued_at: str
    message: str


class DistrictTreasuryAllocation(BaseModel):
    district_code: str
    district_name: str
    sanctioned_amount: float
    expenditure_amount: float
    unspent_balance: float
    utilization_rate_pct: float
    absorption_velocity: str  # "high" | "normal" | "stagnant"
    eligible_for_inflow: bool
    eligible_for_outflow: bool


class ReallocationRecord(BaseModel):
    reallocation_id: str
    source_district_code: str
    source_district_name: str
    target_district_code: str
    target_district_name: str
    reallocated_amount: float
    justification: str
    docket_reference: str
    authorized_by: str
    reallocated_at: str


class InterDistrictAllocationResponse(BaseModel):
    state_code: str
    state_name: str
    state_total_sanctioned_cr: float
    state_total_expenditure_cr: float
    state_total_unspent_cr: float
    district_allocations: List[DistrictTreasuryAllocation]
    reallocation_history: List[ReallocationRecord]


class ReallocateFundsRequest(BaseModel):
    source_district_code: str
    target_district_code: str
    amount_to_reallocate: float = Field(..., gt=0)
    justification: str = Field(..., min_length=5)


class ReallocateFundsResponse(BaseModel):
    success: bool
    reallocation_id: str
    docket_reference: str
    source_district: str
    target_district: str
    amount_reallocated: float
    timestamp: str
    message: str


class DistrictInspectionAudit(BaseModel):
    district_code: str
    district_name: str
    total_sanctioned_works: int
    mandatory_quota_10pct: int
    completed_inspections: int
    inspection_rate_pct: float
    quota_status: str  # "compliant" | "deficit"
    deficit_count: int
    last_inspection_date: Optional[str] = None


class InspectionQuotaAuditResponse(BaseModel):
    state_code: str
    state_name: str
    total_state_works: int
    state_mandatory_quota: int
    state_completed_inspections: int
    state_overall_inspection_rate_pct: float
    compliant_districts_count: int
    deficit_districts_count: int
    districts: List[DistrictInspectionAudit]


class IssueInspectionOrderRequest(BaseModel):
    district_code: str
    deadline_days: int = Field(default=30, ge=7, le=90)
    priority_note: Optional[str] = None


class IssueInspectionOrderResponse(BaseModel):
    success: bool
    directive_reference: str
    district_code: str
    target_deficit_inspections: int
    deadline: str
    issued_at: str
    message: str
