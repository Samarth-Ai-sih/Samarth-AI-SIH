/**
 * SAMARTH AI — API Utility & Type Definitions
 *
 * Shared types matching the backend Pydantic schemas,
 * plus helper functions for authenticated API calls.
 */

// ── Types ───────────────────────────────────────────────────────

export type WorkStatus =
  | "recommended"
  | "under_review"
  | "sanctioned"
  | "in_progress"
  | "on_hold"
  | "completed"
  | "under_verification"
  | "cancelled";

export type WorkCategory =
  | "education"
  | "healthcare"
  | "drinking_water"
  | "roads_and_bridges"
  | "sanitation"
  | "community_infrastructure"
  | "sports"
  | "electricity"
  | "irrigation"
  | "other";

export interface WorkLocation {
  latitude: number | null;
  longitude: number | null;
  address: string | null;
}

export interface PaymentTranche {
  tranche_id: string;
  tranche_number: number;
  amount: number;
  released_date: string;
  purpose: string;
  released_by: string;
  created_at: string;
}

export interface ProgressUpdate {
  update_id: string;
  date: string;
  physical_progress_pct: number;
  description: string;
  updated_by: string;
  attachments: string[];
  created_at: string;
}

export interface TimelineEvent {
  event_id: string;
  timestamp: string;
  event_type: string;
  title: string;
  description: string;
  actor: string;
}

export interface WorkSummary {
  work_id: string;
  title: string;
  status: WorkStatus;
  category: WorkCategory;
  state_name: string;
  district_name: string;
  constituency: string;
  pincode: string;
  mp_name: string;
  implementing_agency: string;
  sanctioned_amount: number;
  funds_released: number;
  actual_expenditure: number;
  physical_progress_pct: number;
  composite_risk_score: number | null;
  risk_tier: string | null;
  recommended_date: string | null;
  sanctioned_date: string | null;
  expected_completion_date: string | null;
  created_at: string;
}

export interface WorkDetail extends WorkSummary {
  description: string;
  sub_category: string;
  state_code: string;
  district_code: string;
  mp_id: string | null;
  start_date: string | null;
  actual_completion_date: string | null;
  location: WorkLocation;
  payment_tranches: PaymentTranche[];
  progress_updates: ProgressUpdate[];
  timeline: TimelineEvent[];
  created_by: string;
  updated_at: string;
}

export interface WorkListResponse {
  works: WorkSummary[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

/** A bounded, internal map marker returned by /api/v1/works/map. */
export interface MapWorkMarker {
  work_id: string;
  title: string;
  status: WorkStatus;
  category: WorkCategory;
  state_code: string;
  state_name: string;
  district_code: string;
  district_name: string;
  constituency: string;
  mp_name: string;
  implementing_agency: string;
  physical_progress_pct: number;
  // The map API excludes records without a complete, validated coordinate pair.
  location: { latitude: number; longitude: number; address: string | null };
  last_updated_at: string;
  sanctioned_amount: number | null;
  funds_released: number | null;
  actual_expenditure: number | null;
  composite_risk_score: number | null;
  risk_tier: "green" | "amber" | "red" | null;
  location_notice: string;
}

export interface WorkMapResponse {
  markers: MapWorkMarker[];
  total_matching_works: number;
  works_with_valid_coordinates: number;
  works_without_valid_coordinates: number;
  page: number;
  page_size: number;
  total_pages: number;
  bounding_box_applied: boolean;
  data_notice: string;
}

export interface AuditEntry {
  log_id: string;
  event_type: string;
  user_id: string | null;
  email: string | null;
  ip_address: string;
  resource_type: string | null;
  resource_id: string | null;
  details: Record<string, unknown>;
  timestamp: string;
}

export interface RiskSubScore {
  dimension: string;
  label: string;
  raw_score: number;
  weight: number;
  weighted_score: number;
  factors: string[];
}

export interface TriggeredRiskRule {
  rule_code: string;
  rule_name: string;
  severity: string;
  contribution: number;
}

export interface RiskExplanationEntry {
  rank: number;
  factor: string;
  dimension: string;
  impact: "high" | "medium" | "low";
}

export interface RiskExplanationSnapshot {
  summary: string;
  top_factors: RiskExplanationEntry[];
  scoring_policy: Record<string, unknown>;
}

export interface RiskScore {
  score_id: string;
  work_id: string;
  work_title?: string;
  district_name?: string;
  state_name?: string;
  mp_name?: string;
  composite_score: number;
  risk_tier: "green" | "amber" | "red";
  confidence: number;
  sub_scores: RiskSubScore[];
  delay_probability: number | null;
  anomaly_score: number | null;
  triggered_rules: TriggeredRiskRule[];
  top_factors: RiskExplanationEntry[];
  explanation_snapshot: RiskExplanationSnapshot;
  recommended_action: string;
  feature_snapshot: Record<string, unknown>;
  model_version: string;
  score_version: number;
  calculated_at: string;
  ai_disclaimer: string;
  supporting_data: Record<string, unknown>;
}

export interface RiskDistribution { green: number; amber: number; red: number; total: number; avg_composite_score: number; }

export interface ComplianceResult {
  result_id: string; rule_id: string; rule_code: string; work_id: string; severity: "advisory" | "warning" | "critical";
  status: string; message: string; threshold_snapshot: Record<string, unknown>; triggered_at: string;
  supporting_data: Record<string, unknown>; review_status: string; reviewed_by: string | null; reviewed_at: string | null; review_notes: string;
}
export interface ComplianceResultList { results: ComplianceResult[]; total: number; page: number; page_size: number; total_pages: number; }
export interface ComplianceRule { rule_id: string; rule_code: string; version: number; name: string; description: string; severity: "advisory" | "warning" | "critical"; category: string; enabled: boolean; thresholds: Record<string, unknown>; created_by: string; created_at: string; updated_at: string; }
export interface ComplianceRuleList { rules: ComplianceRule[]; total: number; }

// ── Phase 16 background processing and notifications ──────────
export interface NotificationPreference {
  user_id: string;
  in_app_enabled: boolean;
  email_enabled: boolean;
  sms_enabled: boolean;
  whatsapp_enabled: boolean;
  event_overrides: Record<string, boolean>;
  updated_at: string;
}

// ── Financial intelligence (Phase 10) ──────────────────────────

export interface FinancialFilterOption {
  value: string;
  label: string;
}

export interface FinancialFilterOptions {
  states: FinancialFilterOption[];
  districts: FinancialFilterOption[];
  categories: FinancialFilterOption[];
  statuses: FinancialFilterOption[];
  agencies: FinancialFilterOption[];
}

export interface FinancialSummary {
  work_count: number;
  total_sanctioned_amount: number;
  total_funds_released: number;
  total_actual_expenditure: number;
  funds_released_vs_sanctioned_pct: number;
  actual_expenditure_vs_sanctioned_pct: number;
  financial_progress_pct: number;
  physical_progress_pct: number;
  financial_physical_gap_pct: number;
  amount_at_risk: number;
  works_requiring_verification: number;
  calculation_note: string;
}

export interface FinancialScatterPoint {
  work_id: string;
  title: string;
  category: string;
  implementing_agency: string;
  sanctioned_amount: number;
  funds_released: number;
  actual_expenditure: number;
  financial_progress_pct: number;
  physical_progress_pct: number;
  financial_physical_gap_pct: number;
  review_label: string | null;
}

export interface PaymentTimelinePoint {
  period: string;
  released_amount: number;
  tranche_count: number;
}

export interface CostBenchmark {
  category: string;
  peer_count: number;
  average_sanctioned_amount: number;
  median_sanctioned_amount: number;
}

export interface CostOutlier {
  work_id: string;
  title: string;
  category: string;
  implementing_agency: string;
  sanctioned_amount: number;
  peer_count: number;
  peer_median_sanctioned_amount: number;
  cost_ratio_to_peer_median: number;
  label: string;
  verification_status: string;
}

export interface HighSpendLowProgress {
  work_id: string;
  title: string;
  category: string;
  implementing_agency: string;
  sanctioned_amount: number;
  actual_expenditure: number;
  financial_progress_pct: number;
  physical_progress_pct: number;
  financial_physical_gap_pct: number;
  amount_at_risk: number;
  label: string;
  verification_status: string;
}

export interface AgencyAnomalyRanking {
  rank: number;
  implementing_agency: string;
  work_count: number;
  works_requiring_verification: number;
  average_financial_physical_gap_pct: number;
  amount_at_risk: number;
  label: string;
}

export interface AmountAtRiskTrendPoint {
  period: string;
  amount_at_risk: number;
  work_count: number;
}

export interface FinancialDashboardResponse {
  summary: FinancialSummary;
  financial_physical_scatter: FinancialScatterPoint[];
  payment_timeline: PaymentTimelinePoint[];
  cost_benchmarks: CostBenchmark[];
  cost_outliers: CostOutlier[];
  high_spend_low_progress: HighSpendLowProgress[];
  agency_anomaly_ranking: AgencyAnomalyRanking[];
  amount_at_risk_trend: AmountAtRiskTrendPoint[];
  review_notice: string;
}

// ── Possible duplicate-work detection (Phase 11) ───────────────

export type DuplicateMatchStatus =
  | "pending_review"
  | "case_created"
  | "marked_not_duplicate"
  | "field_verification_requested";

export interface DuplicateDetectionRule {
  text_similarity_threshold: number;
  distance_threshold_meters: number;
  comparable_cost_range_pct: number;
  require_same_or_similar_category: boolean;
  require_timeline_overlap_or_same_financial_year: boolean;
  rule_version: string;
}

export interface DuplicateDetectionScan {
  scan_id: string;
  rule_snapshot: DuplicateDetectionRule;
  works_evaluated: number;
  pairs_evaluated: number;
  matches_created: number;
  clusters_created: number;
  created_at: string;
  created_by: string;
}

export interface DuplicateMatch {
  match_id: string;
  scan_id: string;
  left_work_id: string;
  right_work_id: string;
  left_work_title: string;
  right_work_title: string;
  similarity_score: number;
  text_similarity: number;
  distance_meters: number | null;
  distance_method: string;
  category_similarity: number;
  category_relationship: string;
  cost_difference_pct: number | null;
  comparable_cost_range: boolean;
  timeline_overlap: boolean;
  timeline_overlap_days: number | null;
  same_financial_year: boolean;
  agency_vendor_relationship: string;
  evidence_photo_similarity: number | null;
  evidence_photo_relationship: string;
  matching_signals: string[];
  rule_snapshot: DuplicateDetectionRule;
  status: DuplicateMatchStatus;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string;
  assigned_to: string;
}

export interface DuplicateCluster {
  cluster_id: string;
  scan_id: string;
  work_ids: string[];
  match_ids: string[];
  cluster_similarity_score: number;
  created_at: string;
}

export interface DuplicateMatchListResponse {
  matches: DuplicateMatch[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  scan: DuplicateDetectionScan | null;
}

export interface DuplicateClusterListResponse {
  clusters: DuplicateCluster[];
  total: number;
  scan: DuplicateDetectionScan | null;
}

export interface DuplicateWorkSummary {
  work_id: string;
  title: string;
  description: string;
  category: string;
  sub_category: string;
  status: string;
  state_name: string;
  district_name: string;
  implementing_agency: string;
  vendor_name: string;
  sanctioned_amount: number;
  funds_released: number;
  actual_expenditure: number;
  physical_progress_pct: number;
  recommended_date: string | null;
  sanctioned_date: string | null;
  start_date: string | null;
  expected_completion_date: string | null;
  location_latitude: number | null;
  location_longitude: number | null;
  location_address: string;
}

export interface DuplicateComparisonResponse {
  match: DuplicateMatch;
  left_work: DuplicateWorkSummary;
  right_work: DuplicateWorkSummary;
  case_id: string | null;
  notice: string;
}

export interface DuplicateCaseResponse {
  case_id: string;
  match_id: string;
  work_ids: string[];
  status: string;
  notes: string;
  assigned_to: string;
  created_by: string;
  created_at: string;
}

// ── Evidence verification (Phase 12) ──────────────────────────

export type EvidenceStorageMode = "cloudinary" | "local_demo";

export type EvidenceVerificationLabel =
  | "Verified metadata available"
  | "Metadata unavailable — manual verification required"
  | "GPS mismatch — verification recommended"
  | "Timestamp inconsistency — verification recommended"
  | "Possible reused evidence — manual verification required";

export interface EvidenceVerification {
  evidence_id: string;
  work_id: string;
  evidence_type: string;
  storage_mode: EvidenceStorageMode;
  media_type: string;
  file_size_bytes: number;
  sha256_hash: string | null;
  perceptual_hash: string | null;
  exif_fields: string[];
  metadata_available: boolean;
  metadata_source: string;
  gps_available: boolean;
  distance_from_project_meters: number | null;
  captured_at: string | null;
  timestamp_consistent: boolean | null;
  verification_labels: EvidenceVerificationLabel[];
  possible_reused_evidence_count: number;
  created_at: string;
  verified_at: string;
}

export interface EvidenceListResponse {
  evidence: EvidenceVerification[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
  privacy_notice: string;
}

export interface EvidenceUploadSignature {
  evidence_id: string;
  storage_mode: EvidenceStorageMode;
  upload_url: string | null;
  api_key: string | null;
  timestamp: number | null;
  signature: string | null;
  folder: string | null;
  public_id: string | null;
  upload_type: string | null;
  local_upload_endpoint: string | null;
  completion_endpoint: string;
  expires_at: string;
}

export interface CrossProjectDuplicateScan {
  records_scanned: number;
  cross_project_matches: number;
  perceptual_hash_distance_threshold: number;
  completed_at: string;
  notice: string;
}

// ── Case management and field inspection (Phase 13) ───────────

export type CaseStatus =
  | "new"
  | "acknowledged"
  | "under_review"
  | "clarification_requested"
  | "inspection_assigned"
  | "evidence_submitted"
  | "corrective_action_planned"
  | "resolved"
  | "rejected_false_positive"
  | "escalated"
  | "reopened";

export type CaseSeverity = "low" | "medium" | "high" | "critical";
export type CaseSourceType = "manual" | "risk_alert" | "duplicate_work" | "evidence_signal" | "financial_signal";

export interface CaseComment { comment_id: string; author_user_id: string; text: string; created_at: string; }
export interface CaseRequest { request_id: string; request_type: string; requested_by: string; reason: string; status: string; created_at: string; }
export interface CaseEvent { event_id: string; event_type: string; actor_user_id: string; reason: string; details: Record<string, string>; created_at: string; }
export interface CorrectivePlan { plan_id: string; summary: string; actions: string[]; owner_user_id: string | null; target_date: string | null; created_by: string; created_at: string; }
export interface InspectionChecklist {
  asset_found: boolean; work_active: boolean; verified_physical_progress_pct: number;
  quality_concern: boolean; work_delayed: boolean; cause_of_delay: string; additional_remarks: string;
}
export interface InspectionReport {
  report_id: string; case_id: string; work_id: string; inspector_user_id: string; checklist: InspectionChecklist;
  gps_available: boolean; gps_timestamp: string | null; gps_distance_from_project_meters: number | null;
  evidence_ids: string[]; remarks: string; submitted_at: string;
}
export interface CaseRecord {
  case_id: string; work_id: string; source_type: CaseSourceType; source_id: string | null;
  title: string; description: string; status: CaseStatus; severity: CaseSeverity;
  owner_user_id: string | null; assigned_inspector_id: string | null; due_date: string | null;
  corrective_plan: CorrectivePlan | null; clarification_requests: CaseRequest[]; document_requests: CaseRequest[];
  comments: CaseComment[]; inspection_reports: InspectionReport[]; events: CaseEvent[];
  created_by: string; created_at: string; updated_at: string; resolved_at: string | null;
  rejection_reason: string; closure_reason: string; escalation_reason: string;
  anomaly_category?: string | null;
  target_authority_role?: string | null;
  target_authority_name?: string | null;
  verification_scope?: string | null;
  specific_questions?: string[];
  anomaly_metrics?: Record<string, any>;
  verification_finding?: string | null;
}
export interface CaseListResponse { cases: CaseRecord[]; total: number; page: number; page_size: number; total_pages: number; }
export interface CaseAssignee { user_id: string; full_name: string; role: string; state_code: string | null; district_code: string | null; }
export interface InspectionWorkSummary {
  work_id: string; title: string; description: string; status: string; physical_progress_pct: number;
  state_name: string; district_name: string; implementing_agency: string;
  location_latitude: number | null; location_longitude: number | null; location_address: string;
}
export interface InspectionTask { case: CaseRecord; work: InspectionWorkSummary; }
export interface InspectionSubmission {
  case: CaseRecord; report: InspectionReport; risk_recalculated: boolean; risk_score_id: string | null; district_authorities_notified: number;
}
export interface CaseNotification { notification_id: string; case_id: string; work_id: string; title: string; message: string; read_at: string | null; created_at: string; }

// ── Citizen portal and social audit (Phase 14) ──────────────────

export type CitizenIssueType = "work_not_started" | "work_appears_stopped" | "asset_not_visible" | "quality_concern" | "incorrect_information" | "other";
export type CitizenIssueStatus = "received" | "under_review" | "inspection_assigned" | "resolved" | "closed";

export interface PublicWorkSummary {
  work_id: string; title: string; category: WorkCategory; status: WorkStatus;
  state_name: string; district_name: string; constituency: string; mp_name: string; pincode: string;
  physical_progress_pct: number; location_address: string; expected_completion_date: string | null; qr_payload: string;
}
export interface PublicWorkDetail extends PublicWorkSummary {
  description: string; sub_category: string; start_date: string | null; actual_completion_date: string | null;
  last_updated_at: string | null; public_notice: string;
}
export interface PublicWorkListResponse { works: PublicWorkSummary[]; total: number; page: number; page_size: number; total_pages: number; public_notice: string; }
export interface CitizenVerificationChallenge { verification_id: string; prompt: string; expires_at: string; notice: string; }
export interface CitizenIssueReceipt { reference_id: string; status: CitizenIssueStatus; submitted_at: string; photo_upload_token: string; photo_upload_expires_at: string; message: string; }
export interface CitizenIssueTracking { reference_id: string; work_id: string; work_title: string; issue_type: CitizenIssueType; status: CitizenIssueStatus; status_message: string; submitted_at: string; updated_at: string; evidence_received: boolean; public_notice: string; }
export interface CitizenEvidenceItem {
  evidence_id: string;
  content_type: string;
  file_size_bytes: number;
  received_at: string;
  url: string | null;
  restricted: boolean;
  restriction_message: string | null;
}

export interface CitizenIssueCreateCaseRequest {
  title: string;
  severity: "low" | "medium" | "high" | "critical";
  due_date?: string | null;
  assigned_inspector_id?: string | null;
  case_notes?: string;
}

export interface CitizenModerationReport {
  reference_id: string;
  work_id: string;
  work_title: string;
  issue_type: CitizenIssueType;
  description: string;
  status: CitizenIssueStatus;
  public_status_message: string;
  location_consent: boolean;
  latitude: number | null;
  longitude: number | null;
  evidence_count: number;
  assigned_inspector_id: string | null;
  submitted_at: string;
  updated_at: string;
  moderation_reason: string;
  evidence_items?: CitizenEvidenceItem[];
  can_view_images?: boolean;
  linked_case_id?: string | null;
}
export interface CitizenModerationList { reports: CitizenModerationReport[]; total: number; page: number; page_size: number; total_pages: number; }

export interface CitizenReportPublicSummary {
  reference_id: string;
  work_title: string;
  district_name: string;
  state_name: string;
  category: string;
  issue_type: string;
  status: string;
  status_message: string;
  changes_done: string;
  submitted_at: string;
  updated_at: string;
}

export interface CitizenRecentUpdatesResponse {
  reports: CitizenReportPublicSummary[];
  total: number;
}

export interface CitizenCommunityIssueItem {
  reference_id: string;
  work_id: string;
  work_title: string;
  district_name: string;
  state_name: string;
  category: string;
  issue_type: string;
  description: string;
  status: string;
  status_message: string;
  changes_done: string;
  evidence_received: boolean;
  evidence_count: number;
  submitted_at: string;
  updated_at: string;
}

export interface CitizenCommunityIssueListResponse {
  issues: CitizenCommunityIssueItem[];
  total: number;
  page: number;
  page_size: number;
  total_pages: number;
}

export interface CitizenPersonalIssueItem {
  reference_id: string;
  work_id: string;
  work_title: string;
  district_name: string;
  state_name: string;
  category: string;
  issue_type: string;
  description: string;
  status: string;
  status_message: string;
  moderation_reason: string;
  assigned_inspector_name: string | null;
  evidence_received: boolean;
  evidence_count: number;
  location_consent: boolean;
  latitude: number | null;
  longitude: number | null;
  submitted_at: string;
  updated_at: string;
}

// ── Status display config ───────────────────────────────────────

export const STATUS_CONFIG: Record<
  WorkStatus,
  { label: string; color: string; bg: string; border: string }
> = {
  recommended: {
    label: "Recommended",
    color: "#7c3aed",
    bg: "#f5f3ff",
    border: "#ddd6fe",
  },
  under_review: {
    label: "Under Review",
    color: "#4f46e5",
    bg: "#eef2ff",
    border: "#c7d2fe",
  },
  sanctioned: {
    label: "Sanctioned",
    color: "#2563eb",
    bg: "#eff6ff",
    border: "#bfdbfe",
  },
  in_progress: {
    label: "In Progress",
    color: "#059669",
    bg: "#ecfdf5",
    border: "#a7f3d0",
  },
  on_hold: {
    label: "On Hold",
    color: "#d97706",
    bg: "#fffbeb",
    border: "#fde68a",
  },
  completed: {
    label: "Completed",
    color: "#16a34a",
    bg: "#f0fdf4",
    border: "#bbf7d0",
  },
  under_verification: {
    label: "Under Verification",
    color: "#db2777",
    bg: "#fdf2f8",
    border: "#fbcfe8",
  },
  cancelled: {
    label: "Cancelled",
    color: "#dc2626",
    bg: "#fef2f2",
    border: "#fecaca",
  },
};

export const CATEGORY_LABELS: Record<WorkCategory, string> = {
  education: "Education",
  healthcare: "Healthcare",
  drinking_water: "Drinking Water",
  roads_and_bridges: "Roads & Bridges",
  sanitation: "Sanitation",
  community_infrastructure: "Community Infrastructure",
  sports: "Sports",
  electricity: "Electricity",
  irrigation: "Irrigation",
  other: "Other",
};

// ── Formatting helpers ──────────────────────────────────────────

export function formatCurrency(amount: number): string {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2)} Cr`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(2)} L`;
  return `₹${amount.toLocaleString("en-IN")}`;
}

export function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleDateString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function formatDateTime(dateStr: string | null | undefined): string {
  if (!dateStr) return "—";
  return new Date(dateStr).toLocaleString("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Robust API error extractor that handles strings, Pydantic 422 error arrays,
 * and JSON error objects without producing [object Object].
 */
export function formatApiError(detail: unknown, fallback: string = "An unexpected error occurred"): string {
  if (!detail) return fallback;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object") {
          const loc = Array.isArray((item as Record<string, unknown>).loc)
            ? ((item as Record<string, unknown>).loc as unknown[]).slice(1).join(".")
            : "";
          const msg = String((item as Record<string, unknown>).msg || JSON.stringify(item));
          return loc ? `${loc}: ${msg}` : msg;
        }
        return String(item);
      })
      .join("; ");
  }
  if (typeof detail === "object") {
    const obj = detail as Record<string, unknown>;
    if (typeof obj.message === "string") return obj.message;
    if (typeof obj.msg === "string") return obj.msg;
    if (typeof obj.detail === "string") return obj.detail;
    return JSON.stringify(detail);
  }
  return String(detail);
}

// ── Anomaly & Verification Intelligence ───────────────────────

export type AnomalyCategory =
  | "cost_overrun"
  | "duplicate_work"
  | "unusual_payment_timing"
  | "deviation_from_norms"
  | "stalled_project"
  | "financial_irregularity";

export type AnomalySeverity = "normal" | "low" | "medium" | "high" | "critical";

export type AuthorityRole =
  | "finance_officer"
  | "inspector"
  | "district_authority"
  | "state_nodal_officer"
  | "technical_examiner";

export interface AnomalyDiagnosis {
  category: AnomalyCategory;
  title: string;
  is_flagged: boolean;
  severity: AnomalySeverity;
  finding_summary: string;
  metrics: Record<string, any>;
  recommended_authority_role: AuthorityRole;
  suggested_questions: string[];
  verification_status: string;
}

export interface UnifiedTimelineItem {
  item_id: string;
  timestamp: string;
  event_type: string;
  title: string;
  description: string;
  actor: string;
  badge_color: string;
  metadata: Record<string, any>;
}

export interface AuthorityOption {
  user_id: string;
  full_name: string;
  role: string;
  authority_type: AuthorityRole;
  jurisdiction_label: string;
}

export interface ProjectStoryResponse {
  work_id: string;
  title: string;
  category: string;
  status: string;
  state_code: string;
  state_name: string;
  district_code: string;
  district_name: string;
  constituency: string;
  mp_name: string;
  implementing_agency: string;
  sanctioned_amount: number;
  funds_released: number;
  actual_expenditure: number;
  physical_progress_pct: number;
  financial_progress_pct: number;
  financial_physical_gap_pct: number;
  sanctioned_date?: string | null;
  start_date?: string | null;
  expected_completion_date?: string | null;
  actual_completion_date?: string | null;
  last_updated_at?: string | null;
  executive_story: string;
  anomaly_diagnoses: AnomalyDiagnosis[];
  unified_timeline: UnifiedTimelineItem[];
  verification_requests: CaseRecord[];
  citizen_reports: any[];
  legal_disclaimer: string;
}

export interface VerificationRequestCreate {
  work_id: string;
  anomaly_category: AnomalyCategory;
  target_authority_role: AuthorityRole;
  target_authority_user_id?: string | null;
  title: string;
  description: string;
  verification_scope: string;
  specific_questions: string[];
  priority: string;
  due_date?: string | null;
}

export interface VerificationRequestResponse {
  case_id: string;
  work_id: string;
  title: string;
  status: string;
  anomaly_category: string;
  target_authority_role: string;
  assigned_to?: string | null;
  assigned_name?: string | null;
  message: string;
}


