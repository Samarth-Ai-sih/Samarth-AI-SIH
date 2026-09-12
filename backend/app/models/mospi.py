"""Pydantic schemas for MoSPI Executive Command Center features."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional
from pydantic import BaseModel, Field


class SectorDistributionItem(BaseModel):
    sector: str
    amount: float
    works_count: int
    pct_of_total: float


class MacroTelemetryResponse(BaseModel):
    total_national_outlay: float = 40000000000.0  # ₹4,000 Cr baseline
    total_sanctioned_amount: float
    total_expenditure_amount: float
    unspent_treasury_balance: float
    utilization_rate_pct: float
    stagnant_funds_amount: float
    total_works_count: int
    completed_works_count: int
    in_progress_works_count: int
    stalled_works_count: int
    at_risk_works_count: int
    sector_distribution: list[SectorDistributionItem] = Field(default_factory=list)
    fiscal_year: str = "2025-26"
    telemetry_as_of: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class StateBenchmarkItem(BaseModel):
    state_code: str
    state_name: str
    total_works: int
    sanctioned_amount: float
    expenditure_amount: float
    utilization_rate_pct: float
    stagnant_works_count: int
    delay_rate_pct: float
    efficiency_score: float
    rank: int
    status_tier: str  # "leading" | "satisfactory" | "lagging"


class InterStateBenchmarkingResponse(BaseModel):
    states: list[StateBenchmarkItem]
    national_avg_utilization: float
    national_avg_delay_rate: float
    total_states_benchmarked: int
    generated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class StatutoryQuotaItem(BaseModel):
    state_code: str
    state_name: str
    total_sanctioned: float
    sc_allocated_amount: float
    sc_allocated_pct: float
    st_allocated_amount: float
    st_allocated_pct: float
    sc_compliant: bool
    st_compliant: bool
    sc_shortfall_amount: float
    st_shortfall_amount: float


class ShortfallAlert(BaseModel):
    entity_id: str
    entity_name: str
    entity_type: str  # "state" | "constituency"
    sc_shortfall: float
    st_shortfall: float
    recommended_action: str


class StatutoryQuotaResponse(BaseModel):
    target_sc_pct: float = 15.0
    target_st_pct: float = 7.5
    national_sc_allocated_pct: float
    national_st_allocated_pct: float
    total_sc_allocated_amount: float
    total_st_allocated_amount: float
    total_sc_shortfall_amount: float
    total_st_shortfall_amount: float
    compliant_states_count: int
    non_compliant_states_count: int
    state_quotas: list[StatutoryQuotaItem]
    shortfall_alerts: list[ShortfallAlert] = Field(default_factory=list)
    evaluated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class TreasuryReleaseItem(BaseModel):
    release_id: str
    constituency: str
    mp_name: str
    district_name: str
    state_name: str
    installment_tranche: str  # e.g., "Tranche 2 (₹2.50 Cr)"
    requested_amount: float = 25000000.0  # ₹2.50 Cr
    financial_year: str = "2025-26"
    utilization_certificate_status: str  # "verified" | "pending_audit" | "discrepancy"
    uc_submission_date: Optional[str] = None
    physical_progress_avg: float
    status: str  # "pending" | "authorized" | "on_hold" | "rejected"
    authorized_by: Optional[str] = None
    authorized_at: Optional[str] = None
    pfms_transaction_ref: Optional[str] = None
    remarks: Optional[str] = None


class TreasuryReleasesResponse(BaseModel):
    releases: list[TreasuryReleaseItem]
    total_pending_amount: float
    total_authorized_amount: float
    pending_count: int
    authorized_count: int


class TreasuryAuthorizeRequest(BaseModel):
    remarks: Optional[str] = "Approved subsequent ₹2.5 Cr central installment based on verified digital Utilization Certificate."


class TreasuryAuthorizeResponse(BaseModel):
    release_id: str
    status: str
    pfms_transaction_ref: str
    authorized_at: str
    message: str


class PortalSyncRequest(BaseModel):
    target_portal: str = "all"  # "pfms" | "esakshi" | "all"


class PortalSyncResponse(BaseModel):
    target_portal: str
    status: str
    synced_records_count: int
    sync_timestamp: str
    sync_reference_id: str
    message: str
