"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  AnomalyCategory,
  AnomalyDiagnosis,
  AuthorityOption,
  AuthorityRole,
  ProjectStoryResponse,
  UnifiedTimelineItem,
  VerificationRequestCreate,
  VerificationRequestResponse,
  formatCurrency,
  formatDate,
  formatDateTime,
} from "@/lib/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  FileCheck,
  FileSearch,
  FileText,
  HelpCircle,
  Info,
  Layers,
  RefreshCw,
  Send,
  ShieldAlert,
  Sliders,
  TrendingDown,
  TrendingUp,
  UserCheck,
  X,
} from "lucide-react";
import { ExportReportButton } from "@/components/reports/export-report-button";
import { PrintableReport, ReportSection } from "@/lib/export-report";

export type FocusPerspective = "all" | "financial" | "compliance" | "risk" | "duplicate";

export interface ProjectStoryDossierProps {
  workId: string;
  initialFocus?: FocusPerspective;
  onOpenCase?: (caseId: string) => void;
}

const CATEGORY_NAMES: Record<AnomalyCategory, string> = {
  cost_overrun: "Cost Overruns & Budget Escalation",
  duplicate_work: "Duplicate Works & Spatial Overlap",
  unusual_payment_timing: "Unusual Payment Timing & Tranches",
  deviation_from_norms: "Deviation from Norms & Guidelines",
  stalled_project: "Stalled Projects & Construction Delays",
  financial_irregularity: "Financial & Ledger Disparities",
};

const CATEGORY_ICONS: Record<AnomalyCategory, string> = {
  cost_overrun: "💰",
  duplicate_work: "🔁",
  unusual_payment_timing: "⏱️",
  deviation_from_norms: "📐",
  stalled_project: "⏸️",
  financial_irregularity: "📊",
};

const SEVERITY_COLORS: Record<string, { bg: string; text: string; border: string; badge: string }> = {
  critical: { bg: "bg-rose-50", text: "text-rose-900", border: "border-rose-200", badge: "bg-rose-100 text-rose-800 border-rose-300" },
  high: { bg: "bg-amber-50", text: "text-amber-900", border: "border-amber-200", badge: "bg-amber-100 text-amber-800 border-amber-300" },
  medium: { bg: "bg-yellow-50", text: "text-yellow-900", border: "border-yellow-200", badge: "bg-yellow-100 text-yellow-800 border-yellow-300" },
  low: { bg: "bg-blue-50", text: "text-blue-900", border: "border-blue-200", badge: "bg-blue-100 text-blue-800 border-blue-300" },
  normal: { bg: "bg-emerald-50/50", text: "text-slate-800", border: "border-slate-200", badge: "bg-emerald-100 text-emerald-800 border-emerald-300" },
};

export function ProjectStoryDossier({ workId, initialFocus = "all", onOpenCase }: ProjectStoryDossierProps) {
  const { user, fetchWithAuth } = useAuth();

  const [dossier, setDossier] = useState<ProjectStoryResponse | null>(null);
  const [authorities, setAuthorities] = useState<AuthorityOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<FocusPerspective>(initialFocus);

  // Synchronize focus if initialFocus changes
  useEffect(() => {
    if (initialFocus) {
      setFocus(initialFocus);
    }
  }, [initialFocus]);

  // Verification Request Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<AnomalyCategory>("cost_overrun");
  const [selectedAuthorityRole, setSelectedAuthorityRole] = useState<AuthorityRole>("finance_officer");
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [reqTitle, setReqTitle] = useState("");
  const [reqDesc, setReqDesc] = useState("");
  const [reqScope, setReqScope] = useState("Financial Ledger & Ground Audit");
  const [reqPriority, setReqPriority] = useState("high");
  const [reqDueDate, setReqDueDate] = useState("");
  const [reqQuestions, setReqQuestions] = useState<string[]>([]);
  const [newQuestionText, setNewQuestionText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const canCreateVerification = Boolean(
    user && ["district_authority", "admin", "state_nodal_officer", "mospi"].includes(user.role)
  );

  const loadDossier = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`/api/v1/anomalies/project-story/${workId}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed to load project story" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data: ProjectStoryResponse = await res.json();
      setDossier(data);

      if (canCreateVerification) {
        const authRes = await fetchWithAuth(`/api/v1/anomalies/authorities/${workId}`);
        if (authRes.ok) {
          setAuthorities(await authRes.json());
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load project story");
    } finally {
      setLoading(false);
    }
  }, [workId, fetchWithAuth, canCreateVerification]);

  useEffect(() => {
    void loadDossier();
  }, [loadDossier]);

  function openVerificationModal(target?: AnomalyDiagnosis | FocusPerspective) {
    setActionSuccess(null);
    setActionError(null);

    const isDiag = Boolean(target && typeof target === "object" && "category" in target);
    const isFocusStr = typeof target === "string";

    if (isDiag) {
      const diag = target as AnomalyDiagnosis;
      setSelectedCategory(diag.category);
      setSelectedAuthorityRole(diag.recommended_authority_role);
      setReqTitle(`Verification Request: ${diag.title} (${dossier?.title.slice(0, 30)}...)`);
      setReqDesc(`Automated anomaly signal: ${diag.finding_summary}\n\nPlease verify whether this represents a procedural deviation or requires corrective escalation.`);
      setReqScope(
        diag.category === "cost_overrun" || diag.category === "unusual_payment_timing"
          ? "Financial Ledger, Tranches & MB Audit"
          : diag.category === "duplicate_work"
          ? "Spatial Proximity & Co-location Verification"
          : "On-Site Physical Inspection & Measurement"
      );
      setReqQuestions(
        diag.suggested_questions.length
          ? [...diag.suggested_questions]
          : [
              "Verify whether physical milestone was achieved prior to fund disbursements.",
              "Check Measurement Book (MB) records against contractor claims.",
            ]
      );
      setReqPriority(diag.severity === "critical" ? "critical" : "high");
    } else if (isFocusStr && target === "financial") {
      setSelectedCategory("cost_overrun");
      setSelectedAuthorityRole("finance_officer");
      setReqTitle(`Financial Audit & Verification: ${dossier?.title.slice(0, 30)}...`);
      setReqDesc("Detailed verification requested for expenditure reconciliation, payment tranche intervals, and voucher auditing.");
      setReqScope("Financial Ledger, Tranches & MB Audit");
      setReqQuestions([
        "Verify whether physical milestone was achieved prior to fund disbursements.",
        "Check Measurement Book (MB) records against contractor claims and bank statements.",
        "Validate whether spend gap exceeds allowable material purchase advances.",
      ]);
      setReqPriority("high");
    } else if (isFocusStr && target === "compliance") {
      setSelectedCategory("deviation_from_norms");
      setSelectedAuthorityRole("technical_examiner");
      setReqTitle(`Compliance & Norm Verification: ${dossier?.title.slice(0, 30)}...`);
      setReqDesc("Procedural verification requested for adherence to MPLADS operational guidelines, eligible works list, and approval procedures.");
      setReqScope("Procedural Guideline Adherence & Technical Scrutiny");
      setReqQuestions([
        "Confirm project falls within eligible works under MPLADS revised guidelines.",
        "Validate administrative sanction and technical sanction validity dates.",
        "Inspect contractor selection process and rate approval records.",
      ]);
      setReqPriority("high");
    } else if (isFocusStr && target === "risk") {
      setSelectedCategory("stalled_project");
      setSelectedAuthorityRole("inspector");
      setReqTitle(`Field Inspection & Stall Verification: ${dossier?.title.slice(0, 30)}...`);
      setReqDesc("On-site physical inspection requested to verify ground progress, evaluate stall causes, and document site conditions.");
      setReqScope("On-Site Physical Inspection & Ground Audit");
      setReqQuestions([
        "Conduct physical on-site survey and record geotagged photographic evidence.",
        "Ascertain reason for construction delay or stalled milestone progress.",
        "Assess estimated timeline and requirements for work resumption.",
      ]);
      setReqPriority("high");
    } else if (isFocusStr && target === "duplicate") {
      setSelectedCategory("duplicate_work");
      setSelectedAuthorityRole("district_authority");
      setReqTitle(`Duplicate Work & Spatial Verification: ${dossier?.title.slice(0, 30)}...`);
      setReqDesc("Verification requested to examine GPS coordinates and potential asset duplication or double-funding with other schemes.");
      setReqScope("Spatial Boundary & Asset Co-location Audit");
      setReqQuestions([
        "Verify whether asset at these GPS coordinates overlaps with an existing asset.",
        "Cross-check state scheme asset registers for identical work orders.",
      ]);
      setReqPriority("high");
    } else {
      setSelectedCategory("cost_overrun");
      setSelectedAuthorityRole("finance_officer");
      setReqTitle(`Verification Request for Work ${dossier?.title.slice(0, 30)}...`);
      setReqDesc("General verification request initiated for financial and physical inspection.");
      setReqScope("Ground and Financial Audit");
      setReqQuestions([
        "Verify physical milestone progress vs released expenditure.",
        "Audit payment vouchers and contractor completion reports.",
      ]);
      setReqPriority("high");
    }

    // Pre-select matching authority
    const targetRole = isDiag
      ? (target as AnomalyDiagnosis).recommended_authority_role
      : isFocusStr && target === "compliance"
      ? "technical_examiner"
      : isFocusStr && target === "risk"
      ? "inspector"
      : isFocusStr && target === "duplicate"
      ? "district_authority"
      : "finance_officer";

    const matchingAuth = authorities.find((a) => a.authority_type === targetRole);
    setSelectedUserId(matchingAuth ? matchingAuth.user_id : authorities[0]?.user_id || "");

    const inTwoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    setReqDueDate(inTwoWeeks);
    setModalOpen(true);
  }

  async function handleCreateVerification(e: React.FormEvent) {
    e.preventDefault();
    if (!reqTitle.trim()) {
      setActionError("Please provide a title for the verification request.");
      return;
    }

    setSubmitting(true);
    setActionError(null);
    setActionSuccess(null);

    const payload: VerificationRequestCreate = {
      work_id: workId,
      anomaly_category: selectedCategory,
      target_authority_role: selectedAuthorityRole,
      target_authority_user_id: selectedUserId || null,
      title: reqTitle.trim(),
      description: reqDesc.trim(),
      verification_scope: reqScope.trim(),
      specific_questions: reqQuestions,
      priority: reqPriority,
      due_date: reqDueDate ? new Date(reqDueDate).toISOString() : null,
    };

    try {
      const res = await fetchWithAuth("/api/v1/anomalies/verification-request", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed to create verification request" }));
        throw new Error(err.detail || "Failed to create verification request");
      }

      const created: VerificationRequestResponse = await res.json();
      setActionSuccess(created.message || "Verification request registered successfully!");
      await loadDossier();
      setTimeout(() => {
        setModalOpen(false);
      }, 1600);
    } catch (err: unknown) {
      setActionError(err instanceof Error ? err.message : "Error creating verification request");
    } finally {
      setSubmitting(false);
    }
  }

  function addQuestion() {
    if (!newQuestionText.trim()) return;
    setReqQuestions((prev) => [...prev, newQuestionText.trim()]);
    setNewQuestionText("");
  }

  function removeQuestion(index: number) {
    setReqQuestions((prev) => prev.filter((_, i) => i !== index));
  }

  // ── Perspective Filtering Logic ─────────────────────────────────

  const visibleDiagnoses = useMemo(() => {
    if (!dossier) return [];
    if (focus === "all") return dossier.anomaly_diagnoses;
    if (focus === "financial") {
      return dossier.anomaly_diagnoses.filter((d) =>
        ["cost_overrun", "unusual_payment_timing", "financial_irregularity"].includes(d.category)
      );
    }
    if (focus === "compliance") {
      return dossier.anomaly_diagnoses.filter((d) => d.category === "deviation_from_norms");
    }
    if (focus === "risk") {
      return dossier.anomaly_diagnoses.filter((d) =>
        ["stalled_project", "cost_overrun"].includes(d.category)
      );
    }
    if (focus === "duplicate") {
      return dossier.anomaly_diagnoses.filter((d) => d.category === "duplicate_work");
    }
    return dossier.anomaly_diagnoses;
  }, [dossier, focus]);

  const visibleCases = useMemo(() => {
    if (!dossier) return [];
    if (focus === "all") return dossier.verification_requests;
    if (focus === "financial") {
      return dossier.verification_requests.filter(
        (c) =>
          ["cost_overrun", "unusual_payment_timing", "financial_irregularity"].includes(c.anomaly_category || "") ||
          c.target_authority_role === "finance_officer" ||
          (c.verification_scope && c.verification_scope.toLowerCase().includes("financial"))
      );
    }
    if (focus === "compliance") {
      return dossier.verification_requests.filter(
        (c) =>
          c.anomaly_category === "deviation_from_norms" ||
          c.target_authority_role === "technical_examiner" ||
          (c.verification_scope && c.verification_scope.toLowerCase().includes("compliance"))
      );
    }
    if (focus === "risk") {
      return dossier.verification_requests.filter(
        (c) =>
          ["stalled_project", "cost_overrun"].includes(c.anomaly_category || "") ||
          c.target_authority_role === "inspector" ||
          (c.verification_scope && c.verification_scope.toLowerCase().includes("physical"))
      );
    }
    if (focus === "duplicate") {
      return dossier.verification_requests.filter(
        (c) =>
          c.anomaly_category === "duplicate_work" ||
          (c.verification_scope && c.verification_scope.toLowerCase().includes("duplicate"))
      );
    }
    return dossier.verification_requests;
  }, [dossier, focus]);

  const visibleTimeline = useMemo(() => {
    if (!dossier) return [];
    if (focus === "all") return dossier.unified_timeline;
    if (focus === "financial") {
      return dossier.unified_timeline.filter(
        (item) =>
          ["payment_tranche", "sanction"].includes(item.event_type) ||
          item.title.toLowerCase().includes("fund") ||
          item.title.toLowerCase().includes("payment") ||
          item.title.toLowerCase().includes("expenditure") ||
          item.title.toLowerCase().includes("financial")
      );
    }
    if (focus === "compliance") {
      return dossier.unified_timeline.filter(
        (item) =>
          ["sanction", "recommendation"].includes(item.event_type) ||
          item.title.toLowerCase().includes("compliance") ||
          item.title.toLowerCase().includes("norm") ||
          item.title.toLowerCase().includes("approval") ||
          item.description.toLowerCase().includes("guideline")
      );
    }
    if (focus === "risk") {
      return dossier.unified_timeline.filter(
        (item) =>
          ["field_inspection", "progress_update"].includes(item.event_type) ||
          item.title.toLowerCase().includes("delay") ||
          item.title.toLowerCase().includes("stall") ||
          item.title.toLowerCase().includes("inspection") ||
          item.description.toLowerCase().includes("physical")
      );
    }
    if (focus === "duplicate") {
      return dossier.unified_timeline.filter(
        (item) =>
          item.title.toLowerCase().includes("duplicate") ||
          item.description.toLowerCase().includes("duplicate") ||
          item.description.toLowerCase().includes("spatial")
      );
    }
    return dossier.unified_timeline;
  }, [dossier, focus]);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
        <RefreshCw className="mx-auto h-7 w-7 animate-spin text-sky-600 mb-3" />
        <p className="text-sm font-medium text-slate-700">Synthesizing project narrative & evaluating anomalies...</p>
        <p className="text-xs text-slate-400 mt-1">Checking cost benchmarks, payment intervals, duplicate overlap, and ground delays.</p>
      </div>
    );
  }

  if (error || !dossier) {
    return (
      <div className="rounded-xl border border-rose-200 bg-rose-50 p-6 text-rose-800">
        <div className="flex items-center gap-2 font-semibold">
          <AlertCircle className="h-5 w-5 text-rose-600" />
          <span>Could not compile project story dossier</span>
        </div>
        <p className="mt-1 text-sm">{error || "Project data unavailable."}</p>
        <Button variant="outline" size="sm" onClick={() => void loadDossier()} className="mt-4 border-rose-300 text-rose-800 hover:bg-rose-100">
          Retry Analysis
        </Button>
      </div>
    );
  }

  const getProjectExportData = () => {
    if (!dossier) throw new Error("No dossier loaded");

    const paymentTranches = dossier.unified_timeline.filter((item) => item.event_type === "payment_tranche");

    const sections: ReportSection[] = [
      {
        title: "Executive Story & Context Narrative",
        type: "text",
        content: dossier.executive_story || "No executive summary available for this work record.",
      },
      {
        title: "Financial & Progress Metrics",
        type: "key-value",
        items: [
          { label: "Sanctioned Amount", value: formatCurrency(dossier.sanctioned_amount) },
          { label: "Funds Released", value: formatCurrency(dossier.funds_released) },
          { label: "Actual Expenditure", value: formatCurrency(dossier.actual_expenditure) },
          { label: "Physical Progress", value: `${dossier.physical_progress_pct.toFixed(1)}%` },
          { label: "Financial Progress", value: `${dossier.financial_progress_pct.toFixed(1)}%` },
          { label: "Spend / Delivery Gap", value: `${dossier.financial_physical_gap_pct > 0 ? "+" : ""}${dossier.financial_physical_gap_pct.toFixed(1)}%` },
          { label: "Implementing Agency", value: dossier.implementing_agency || "Not specified" },
          { label: "Category", value: dossier.category || "General" },
        ],
      },
    ];

    if (dossier.anomaly_diagnoses.length > 0) {
      sections.push({
        title: "5-Point AI Anomaly Diagnostic Evaluation",
        type: "table",
        headers: [
          "Category",
          "Anomaly Flag",
          "Severity",
          "Status",
          "Finding Summary",
          "Target Authority",
          "Verification Status",
        ],
        rows: dossier.anomaly_diagnoses.map((d) => [
          CATEGORY_NAMES[d.category] || d.category,
          d.title,
          d.severity.toUpperCase(),
          d.is_flagged ? "FLAGGED" : "NORMAL",
          d.finding_summary || "—",
          d.recommended_authority_role ? d.recommended_authority_role.replace(/_/g, " ").toUpperCase() : "OFFICER",
          d.verification_status || "Pending",
        ]),
      });
    }

    if (paymentTranches.length > 0) {
      sections.push({
        title: "Financial Tranches & Payment Vouchers",
        type: "table",
        headers: ["Date", "Payment Tranche", "Amount (₹)", "Description / Reference"],
        rows: paymentTranches.map((t) => [
          t.timestamp ? formatDate(t.timestamp) : "—",
          t.title,
          t.metadata?.amount ? formatCurrency(Number(t.metadata.amount)) : "—",
          t.description || "Milestone payment release",
        ]),
      });
    }

    if (dossier.unified_timeline.length > 0) {
      sections.push({
        title: "Unified Project Milestone Timeline",
        type: "table",
        headers: ["Date", "Event Type", "Milestone / Event", "Details / Observations"],
        rows: dossier.unified_timeline.map((u) => [
          u.timestamp ? formatDate(u.timestamp) : "—",
          u.event_type.replace(/_/g, " ").toUpperCase(),
          u.title,
          u.description || "—",
        ]),
      });
    }

    if (dossier.verification_requests.length > 0) {
      sections.push({
        title: "Verification Requests & Ground Audits",
        type: "table",
        headers: ["Case ID", "Title", "Severity", "Status", "Assigned Owner", "Created At"],
        rows: dossier.verification_requests.map((v) => [
          v.case_id.slice(0, 8),
          v.title,
          v.severity.toUpperCase(),
          v.status.replace(/_/g, " ").toUpperCase(),
          v.owner_user_id || "Unassigned",
          v.created_at ? formatDateTime(v.created_at) : "—",
        ]),
      });
    }

    const report: PrintableReport = {
      title: "MPLADS PROJECT 360° STORY DOSSIER",
      subtitle: `${dossier.title} (Work ID: ${dossier.work_id})`,
      categoryBadge: `AI PROJECT DOSSIER · ${dossier.status?.toUpperCase() || "ACTIVE"}`,
      generatedBy: user ? `${user.full_name} (${user.role.replace(/_/g, " ").toUpperCase()})` : "Authorised Official",
      jurisdiction: `${dossier.district_name || ""}, ${dossier.state_name || ""}`.replace(/^, |, $/g, "") || "National Jurisdiction",
      metadata: [
        { label: "Work ID", value: dossier.work_id },
        { label: "State", value: dossier.state_name || "—" },
        { label: "District", value: dossier.district_name || "—" },
        { label: "Sanctioned Amount", value: formatCurrency(dossier.sanctioned_amount) },
        { label: "Expenditure", value: formatCurrency(dossier.actual_expenditure) },
        { label: "Physical Progress", value: `${dossier.physical_progress_pct.toFixed(1)}%` },
        { label: "Spend / Delivery Gap", value: `${dossier.financial_physical_gap_pct > 0 ? "+" : ""}${dossier.financial_physical_gap_pct.toFixed(1)}%` },
        { label: "Flagged Anomalies", value: `${dossier.anomaly_diagnoses.filter((d) => d.is_flagged).length} of ${dossier.anomaly_diagnoses.length}` },
      ],
      sections,
      signOff: {
        designation: "Superintending Officer / District Technical Authority",
        office: "Ministry of Statistics & Programme Implementation (MoSPI)",
      },
    };

    const csvHeaders = ["Category", "Entity Reference", "Item / Indicator", "Value", "Notes"];
    const csvRows: (string | number)[][] = [
      ["Project Info", dossier.work_id, "Title", dossier.title, ""],
      ["Project Info", dossier.work_id, "State", dossier.state_name || "", ""],
      ["Project Info", dossier.work_id, "District", dossier.district_name || "", ""],
      ["Project Info", dossier.work_id, "Agency", dossier.implementing_agency || "", ""],
      ["Project Info", dossier.work_id, "Sanctioned Amount", dossier.sanctioned_amount, ""],
      ["Project Info", dossier.work_id, "Released Amount", dossier.funds_released, ""],
      ["Project Info", dossier.work_id, "Expenditure Amount", dossier.actual_expenditure, ""],
      ["Project Info", dossier.work_id, "Physical Progress (%)", dossier.physical_progress_pct, ""],
      ["Project Info", dossier.work_id, "Financial Progress (%)", dossier.financial_progress_pct, ""],
      ["Project Info", dossier.work_id, "Spend Gap (%)", dossier.financial_physical_gap_pct, ""],
    ];

    dossier.anomaly_diagnoses.forEach((diag) => {
      csvRows.push([
        "Anomaly Diagnosis",
        diag.category,
        diag.title,
        diag.is_flagged ? "FLAGGED" : "OK",
        `Severity: ${diag.severity}, Summary: ${diag.finding_summary}`,
      ]);
    });

    paymentTranches.forEach((t) => {
      csvRows.push([
        "Payment Tranche",
        t.title,
        t.timestamp ? formatDate(t.timestamp) : "",
        t.metadata?.amount ? String(t.metadata.amount) : "",
        t.description || "",
      ]);
    });

    dossier.unified_timeline.forEach((u) => {
      csvRows.push([
        "Project Timeline",
        u.event_type,
        u.title,
        u.timestamp ? formatDate(u.timestamp) : "",
        u.description || "",
      ]);
    });

    return {
      report,
      csv: { headers: csvHeaders, rows: csvRows },
      json: dossier,
    };
  };

  const flaggedCount = dossier.anomaly_diagnoses.filter((d) => d.is_flagged).length;

  return (
    <div className="space-y-6">
      {/* ── Section Header ─────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-xl font-bold text-slate-900 tracking-tight">
              Project Dossier & Anomaly Story
            </h2>
            <Badge variant="outline" className="bg-sky-50 text-sky-800 border-sky-200 text-xs">
              AI Decision Support
            </Badge>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            What happened in this project: explainable history, anomaly diagnosis, and verification routing.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canCreateVerification && (
            <Button
              size="sm"
              onClick={() => openVerificationModal()}
              className="bg-rose-600 hover:bg-rose-700 text-white font-medium shadow-sm text-xs"
            >
              <Send className="mr-1.5 h-3.5 w-3.5" />
              Generate Verification Request
            </Button>
          )}
          <ExportReportButton
            label="Export Project Dossier"
            filename={`Work_${dossier.work_id}_Story_Dossier`}
            getReportData={getProjectExportData}
          />
          <Button variant="outline" size="sm" onClick={() => void loadDossier()} className="text-xs text-slate-700">
            <RefreshCw className="h-3.5 w-3.5 mr-1 text-slate-500" />
            Refresh
          </Button>
        </div>
      </div>

      {/* ── Essential Perspective Switcher ─────────────────────── */}
      <div className="flex flex-wrap items-center gap-2 p-1.5 bg-slate-100/90 rounded-xl border border-slate-200">
        <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider px-2">
          Show Essential:
        </span>
        <button
          type="button"
          onClick={() => setFocus("all")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all ${
            focus === "all"
              ? "bg-white text-slate-900 shadow-xs border border-slate-300 font-semibold ring-1 ring-slate-300"
              : "text-slate-600 hover:text-slate-900 hover:bg-white/60 font-medium"
          }`}
        >
          <span>🌐</span> All Insights
        </button>
        <button
          type="button"
          onClick={() => setFocus("financial")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all ${
            focus === "financial"
              ? "bg-white text-blue-900 shadow-xs border border-blue-400 font-bold ring-2 ring-blue-100"
              : "text-slate-600 hover:text-blue-800 hover:bg-white/60 font-medium"
          }`}
        >
          <span>💰</span> Financial Verification
          {dossier.financial_physical_gap_pct > 15 && (
            <span className="h-2 w-2 rounded-full bg-amber-500 inline-block" title="High financial spend gap" />
          )}
        </button>
        <button
          type="button"
          onClick={() => setFocus("compliance")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all ${
            focus === "compliance"
              ? "bg-white text-purple-900 shadow-xs border border-purple-400 font-bold ring-2 ring-purple-100"
              : "text-slate-600 hover:text-purple-800 hover:bg-white/60 font-medium"
          }`}
        >
          <span>📐</span> Compliance Verification
        </button>
        <button
          type="button"
          onClick={() => setFocus("risk")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all ${
            focus === "risk"
              ? "bg-white text-rose-900 shadow-xs border border-rose-400 font-bold ring-2 ring-rose-100"
              : "text-slate-600 hover:text-rose-800 hover:bg-white/60 font-medium"
          }`}
        >
          <span>⚠️</span> Risk & Delay Verification
        </button>
        <button
          type="button"
          onClick={() => setFocus("duplicate")}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs transition-all ${
            focus === "duplicate"
              ? "bg-white text-indigo-900 shadow-xs border border-indigo-400 font-bold ring-2 ring-indigo-100"
              : "text-slate-600 hover:text-indigo-800 hover:bg-white/60 font-medium"
          }`}
        >
          <span>🔁</span> Duplicate Check
        </button>
      </div>

      {/* ── Perspective-Specific Verification Need Cards ───────── */}

      {/* 1. Financial Verification Need */}
      {focus === "financial" && (
        <Card className="border-blue-200 bg-white shadow-sm overflow-hidden">
          <CardHeader className="p-4 bg-blue-50/70 border-b border-blue-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-100 text-blue-700 font-bold text-base">
                💰
              </span>
              <div>
                <CardTitle className="text-sm font-bold text-slate-900">
                  Financial Verification Need & Fund Scrutiny
                </CardTitle>
                <p className="text-xs text-slate-500 mt-0.5">
                  Essential financial indicators, payment interval anomalies, and spend reconciliation for this work.
                </p>
              </div>
            </div>
            {canCreateVerification && (
              <Button
                size="sm"
                onClick={() => openVerificationModal("financial")}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs"
              >
                <Send className="mr-1.5 h-3.5 w-3.5" />
                Initiate Financial Verification Request
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">Sanctioned</span>
                <strong className="text-sm font-bold text-slate-900 block mt-1">{formatCurrency(dossier.sanctioned_amount)}</strong>
                <span className="text-[10px] text-slate-500 mt-0.5 block">Approved allocation</span>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">Funds Released</span>
                <strong className="text-sm font-bold text-emerald-600 block mt-1">{formatCurrency(dossier.funds_released)}</strong>
                <span className="text-[10px] text-slate-500 mt-0.5 block">
                  {dossier.sanctioned_amount > 0 ? `${((dossier.funds_released / dossier.sanctioned_amount) * 100).toFixed(1)}% of sanctioned` : "N/A"}
                </span>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">Actual Expenditure</span>
                <strong className="text-sm font-bold text-sky-600 block mt-1">{formatCurrency(dossier.actual_expenditure)}</strong>
                <span className="text-[10px] text-slate-500 mt-0.5 block">
                  {dossier.funds_released > 0 ? `${((dossier.actual_expenditure / dossier.funds_released) * 100).toFixed(1)}% of released` : "0%"}
                </span>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">Financial-Physical Gap</span>
                <strong className={`text-sm font-bold block mt-1 ${dossier.financial_physical_gap_pct > 15 ? "text-amber-600" : "text-emerald-600"}`}>
                  {dossier.financial_physical_gap_pct > 0 ? `+${dossier.financial_physical_gap_pct.toFixed(1)}%` : `${dossier.financial_physical_gap_pct.toFixed(1)}%`}
                </strong>
                <span className="text-[10px] text-slate-500 mt-0.5 block">
                  {dossier.financial_physical_gap_pct > 15 ? "Spend significantly leads physical progress" : "Within acceptable milestone range"}
                </span>
              </div>
            </div>

            <div className="rounded-lg border border-blue-100 bg-blue-50/30 p-3.5 space-y-2">
              <h4 className="text-xs font-bold text-blue-900 uppercase tracking-wide">
                Financial Scrutiny & Audit Checklist
              </h4>
              <ul className="text-xs text-slate-700 space-y-1.5 list-disc list-inside">
                <li>
                  <strong>Implementing Agency:</strong> {dossier.implementing_agency || "Not specified"}. Verify contractor bills and Measurement Book (MB) recordings against bank disbursements.
                </li>
                <li>
                  <strong>Disbursement Velocity:</strong> Check that tranches comply with the 75% expenditure utilisation rule before release of subsequent instalments.
                </li>
                <li>
                  <strong>Cost Outlier Assessment:</strong> Cross-examine unit costs against peer district averages for this work category.
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 2. Compliance Verification Need */}
      {focus === "compliance" && (
        <Card className="border-purple-200 bg-white shadow-sm overflow-hidden">
          <CardHeader className="p-4 bg-purple-50/70 border-b border-purple-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 text-purple-700 font-bold text-base">
                📐
              </span>
              <div>
                <CardTitle className="text-sm font-bold text-slate-900">
                  Compliance Verification Need & Norm Adherence
                </CardTitle>
                <p className="text-xs text-slate-500 mt-0.5">
                  Procedural compliance checks against MPLADS statutory guidelines, sector eligibility, and approvals.
                </p>
              </div>
            </div>
            {canCreateVerification && (
              <Button
                size="sm"
                onClick={() => openVerificationModal("compliance")}
                className="bg-purple-600 hover:bg-purple-700 text-white text-xs font-semibold shadow-xs"
              >
                <Send className="mr-1.5 h-3.5 w-3.5" />
                Initiate Compliance Review Request
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">Norm Deviation Status</span>
                <strong className="text-sm font-bold text-slate-900 block mt-1">
                  {dossier.anomaly_diagnoses.find((d) => d.category === "deviation_from_norms")?.is_flagged
                    ? "⚠️ Review Required"
                    : "✓ Conforming to Norms"}
                </strong>
                <span className="text-[10px] text-slate-500 mt-0.5 block">MPLADS Operational Guidelines</span>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">Eligible Works Schedule</span>
                <strong className="text-sm font-bold text-purple-700 block mt-1">Schedule-I Permissible</strong>
                <span className="text-[10px] text-slate-500 mt-0.5 block">Not on Negative / Prohibited list</span>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">Statutory Approvals</span>
                <strong className="text-sm font-bold text-emerald-600 block mt-1">Sanction Verified</strong>
                <span className="text-[10px] text-slate-500 mt-0.5 block">Administrative approval on record</span>
              </div>
            </div>

            <div className="rounded-lg border border-purple-100 bg-purple-50/30 p-3.5 space-y-2">
              <h4 className="text-xs font-bold text-purple-900 uppercase tracking-wide">
                Compliance Directives & Legal Requirements
              </h4>
              <ul className="text-xs text-slate-700 space-y-1.5 list-disc list-inside">
                <li>
                  <strong>Statutory Rule Audit:</strong> Verify that work specifications adhere strictly to permissible limits and standard schedule of rates (SSR).
                </li>
                <li>
                  <strong>Utilisation Certificate (UC):</strong> Ensure UC is uploaded by the implementing agency ({dossier.implementing_agency || "District Nodal Agency"}) before any further tranche approval.
                </li>
                <li>
                  <strong>Contractor Selection:</strong> Audit whether tendering followed state public procurement norms and competitive bidding guidelines.
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 3. Risk & Delay Verification Need */}
      {focus === "risk" && (
        <Card className="border-rose-200 bg-white shadow-sm overflow-hidden">
          <CardHeader className="p-4 bg-rose-50/70 border-b border-rose-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-100 text-rose-700 font-bold text-base">
                ⚠️
              </span>
              <div>
                <CardTitle className="text-sm font-bold text-slate-900">
                  Risk & Delay Verification Need & Ground Inspection
                </CardTitle>
                <p className="text-xs text-slate-500 mt-0.5">
                  Physical progress audit, stall mitigation signals, and on-site inspection requirements.
                </p>
              </div>
            </div>
            {canCreateVerification && (
              <Button
                size="sm"
                onClick={() => openVerificationModal("risk")}
                className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shadow-xs"
              >
                <Send className="mr-1.5 h-3.5 w-3.5" />
                Dispatch Field Inspector / Verification Request
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">Physical Progress</span>
                <strong className="text-sm font-bold text-indigo-600 block mt-1">{dossier.physical_progress_pct.toFixed(1)}%</strong>
                <span className="text-[10px] text-slate-500 mt-0.5 block">Milestone completion</span>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">Stall / Delay Flag</span>
                <strong className="text-sm font-bold text-rose-600 block mt-1">
                  {dossier.anomaly_diagnoses.find((d) => d.category === "stalled_project")?.is_flagged
                    ? "Stalled / Overdue"
                    : "Active Execution"}
                </strong>
                <span className="text-[10px] text-slate-500 mt-0.5 block">Ground status</span>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">Last Field Update</span>
                <strong className="text-sm font-bold text-slate-800 block mt-1">
                  {dossier.anomaly_diagnoses.find((d) => d.category === "stalled_project")?.metrics.days_since_last_update !== undefined
                    ? `${dossier.anomaly_diagnoses.find((d) => d.category === "stalled_project")?.metrics.days_since_last_update} days ago`
                    : "Recent"}
                </strong>
                <span className="text-[10px] text-slate-500 mt-0.5 block">Inspection recency</span>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">Inspection Status</span>
                <strong className="text-sm font-bold text-amber-600 block mt-1">
                  {dossier.verification_requests.some((r) => r.target_authority_role === "inspector")
                    ? "Inspection Active"
                    : "Inspection Required"}
                </strong>
                <span className="text-[10px] text-slate-500 mt-0.5 block">Physical ground audit</span>
              </div>
            </div>

            <div className="rounded-lg border border-rose-100 bg-rose-50/30 p-3.5 space-y-2">
              <h4 className="text-xs font-bold text-rose-900 uppercase tracking-wide">
                Field Inspection & Stall Resolution Protocol
              </h4>
              <ul className="text-xs text-slate-700 space-y-1.5 list-disc list-inside">
                <li>
                  <strong>On-Site Photo Verification:</strong> Field inspector must capture geotagged, timestamped images of the project site to substantiate physical progress claims.
                </li>
                <li>
                  <strong>Measurement Book (MB) Check:</strong> Compare contractor claims against on-site measurements recorded in MB books.
                </li>
                <li>
                  <strong>Dormancy Remediation:</strong> If stalled over 90 days without physical activity, district authority must issue a notice to the implementing agency ({dossier.implementing_agency || "Agency"}).
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {/* 4. Duplicate Verification Need */}
      {focus === "duplicate" && (
        <Card className="border-indigo-200 bg-white shadow-sm overflow-hidden">
          <CardHeader className="p-4 bg-indigo-50/70 border-b border-indigo-100 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 font-bold text-base">
                🔁
              </span>
              <div>
                <CardTitle className="text-sm font-bold text-slate-900">
                  Duplicate Work Verification Need & Spatial Conflict
                </CardTitle>
                <p className="text-xs text-slate-500 mt-0.5">
                  Cross-scheme co-location, spatial proximity, and duplicate candidate verification.
                </p>
              </div>
            </div>
            {canCreateVerification && (
              <Button
                size="sm"
                onClick={() => openVerificationModal("duplicate")}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold shadow-xs"
              >
                <Send className="mr-1.5 h-3.5 w-3.5" />
                Initiate Duplicate Work Inquiry
              </Button>
            )}
          </CardHeader>
          <CardContent className="p-4 space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">Candidate Matches</span>
                <strong className="text-sm font-bold text-slate-900 block mt-1">
                  {dossier.anomaly_diagnoses.find((d) => d.category === "duplicate_work")?.metrics.candidate_matches_count || 0} candidate(s)
                </strong>
                <span className="text-[10px] text-slate-500 mt-0.5 block">Within 500m / category radius</span>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">Highest Match Score</span>
                <strong className="text-sm font-bold text-indigo-700 block mt-1">
                  {(dossier.anomaly_diagnoses.find((d) => d.category === "duplicate_work")?.metrics.highest_similarity_pct || 0).toFixed(0)}% Match
                </strong>
                <span className="text-[10px] text-slate-500 mt-0.5 block">Title & description similarity</span>
              </div>
              <div className="p-3 rounded-lg border border-slate-200 bg-slate-50/50">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-400 block">Spatial Co-location</span>
                <strong className="text-sm font-bold text-emerald-600 block mt-1">GPS Coordinates Audited</strong>
                <span className="text-[10px] text-slate-500 mt-0.5 block">Cross-scheme database scan</span>
              </div>
            </div>

            <div className="rounded-lg border border-indigo-100 bg-indigo-50/30 p-3.5 space-y-2">
              <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-wide">
                Duplicate Detection Protocol & Asset Verification
              </h4>
              <ul className="text-xs text-slate-700 space-y-1.5 list-disc list-inside">
                <li>
                  <strong>Physical Demarcation:</strong> Verify whether this asset is distinct from other state/central scheme assets constructed in the same vicinity.
                </li>
                <li>
                  <strong>Double Funding Prevention:</strong> Validate that no other department (PWD, Panchayat, Municipal Corp) has billed expenditure for identical works at these coordinates.
                </li>
              </ul>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Legal / Analytical Notice ──────────────────────────── */}
      <div className="rounded-lg border border-amber-200 bg-amber-50/80 p-3.5 flex items-start gap-3">
        <Info className="h-4 w-4 text-amber-700 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-900 leading-relaxed">
          <strong>Requires Verification:</strong> All anomaly & fraud detection flags (cost overruns, duplicate candidates,
          unusual payment timing, norm deviations, and stalled delays) are <strong>analytical prioritisation signals</strong>.
          They require verification by competent authorities and are not judicial findings of misconduct or fraud.
        </div>
      </div>

      {/* ── Executive Plain-English Story ──────────────────────── */}
      <Card className="border-sky-100 bg-gradient-to-br from-white via-sky-50/20 to-indigo-50/20 shadow-sm overflow-hidden">
        <CardHeader className="pb-3 border-b border-slate-100 bg-white/70">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-sky-100 text-sky-700 text-xs font-bold">
                📖
              </span>
              <CardTitle className="text-sm font-semibold text-slate-900">
                What Happened in This Project: Executive Narrative
              </CardTitle>
            </div>
            <div className="flex items-center gap-2">
              {flaggedCount > 0 ? (
                <Badge variant="secondary" className="bg-amber-100 text-amber-800 border-amber-300 text-xs font-semibold">
                  ⚠️ {flaggedCount} Anomaly Signal{flaggedCount === 1 ? "" : "s"} Active
                </Badge>
              ) : (
                <Badge variant="secondary" className="bg-emerald-100 text-emerald-800 border-emerald-300 text-xs font-semibold">
                  ✓ Within Normal Bounds
                </Badge>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-5 space-y-4">
          <p className="text-sm text-slate-800 leading-relaxed font-normal bg-white p-4 rounded-lg border border-slate-200/80 shadow-xs">
            {dossier.executive_story}
          </p>

          {/* Key Stat Pills */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5 pt-1">
            <div className="bg-white p-2.5 rounded-lg border border-slate-200 text-center">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Sanctioned</span>
              <strong className="text-xs font-bold text-slate-900 block mt-0.5">{formatCurrency(dossier.sanctioned_amount)}</strong>
            </div>
            <div className="bg-white p-2.5 rounded-lg border border-slate-200 text-center">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Released</span>
              <strong className="text-xs font-bold text-emerald-600 block mt-0.5">{formatCurrency(dossier.funds_released)}</strong>
            </div>
            <div className="bg-white p-2.5 rounded-lg border border-slate-200 text-center">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Expended</span>
              <strong className="text-xs font-bold text-sky-600 block mt-0.5">{formatCurrency(dossier.actual_expenditure)}</strong>
            </div>
            <div className="bg-white p-2.5 rounded-lg border border-slate-200 text-center">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Physical Progress</span>
              <strong className="text-xs font-bold text-indigo-600 block mt-0.5">{dossier.physical_progress_pct.toFixed(1)}%</strong>
            </div>
            <div className="bg-white p-2.5 rounded-lg border border-slate-200 text-center">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Spend Gap</span>
              <strong className={`text-xs font-bold block mt-0.5 ${dossier.financial_physical_gap_pct > 0 ? "text-amber-600" : "text-emerald-600"}`}>
                {dossier.financial_physical_gap_pct > 0 ? `+${dossier.financial_physical_gap_pct.toFixed(1)}%` : `${dossier.financial_physical_gap_pct.toFixed(1)}%`}
              </strong>
            </div>
            <div className="bg-white p-2.5 rounded-lg border border-slate-200 text-center">
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider block">Agency</span>
              <strong className="text-xs font-bold text-slate-800 truncate block mt-0.5" title={dossier.implementing_agency}>
                {dossier.implementing_agency.slice(0, 14)}…
              </strong>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Perspective-Aware Anomaly Diagnoses Grid ───────────── */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
              {focus === "all"
                ? "5-Point Anomaly & Fraud Detection Evaluation"
                : `${focus.charAt(0).toUpperCase() + focus.slice(1)} Anomaly Diagnostics`}
            </h3>
            <p className="text-xs text-slate-500">
              Evaluated against scheme norms, category peer benchmarks, spatial coordinates, and payment records.
            </p>
          </div>
          <span className="text-xs text-slate-400 font-mono">
            {visibleDiagnoses.length} dimension{visibleDiagnoses.length === 1 ? "" : "s"} in view
          </span>
        </div>

        {visibleDiagnoses.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3.5">
            {visibleDiagnoses.map((diag) => {
              const sc = SEVERITY_COLORS[diag.severity] || SEVERITY_COLORS.normal;
              return (
                <Card
                  key={diag.category}
                  className={`border transition-all duration-200 shadow-xs hover:shadow-md flex flex-col justify-between ${
                    diag.is_flagged ? `${sc.bg} ${sc.border}` : "bg-white border-slate-200"
                  }`}
                >
                  <div>
                    <CardHeader className="p-4 pb-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-lg">{CATEGORY_ICONS[diag.category] || "🔍"}</span>
                          <div>
                            <CardTitle className="text-xs font-bold text-slate-900 leading-tight">
                              {diag.title}
                            </CardTitle>
                            <span className="text-[10px] text-slate-500 font-medium">
                              Target: {diag.recommended_authority_role.replace(/_/g, " ").toUpperCase()}
                            </span>
                          </div>
                        </div>
                        <Badge
                          variant="secondary"
                          className={`text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 ${
                            diag.is_flagged ? sc.badge : "bg-slate-100 text-slate-600 border-slate-200"
                          }`}
                        >
                          {diag.is_flagged ? `${diag.severity} signal` : "Clear"}
                        </Badge>
                      </div>
                    </CardHeader>

                    <CardContent className="p-4 pt-1 space-y-3">
                      <p className="text-xs text-slate-700 leading-relaxed font-normal">
                        {diag.finding_summary}
                      </p>

                      {/* Metric Badges */}
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {diag.category === "cost_overrun" && (
                          <>
                            {diag.metrics.cost_overrun_pct > 0 && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-rose-100 text-rose-800">
                                +{diag.metrics.cost_overrun_pct}% Overrun
                              </span>
                            )}
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700">
                              {diag.metrics.peer_median_ratio}x Peer Median
                            </span>
                          </>
                        )}

                        {diag.category === "stalled_project" && (
                          <>
                            {diag.metrics.is_overdue && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-rose-100 text-rose-800">
                                {diag.metrics.overdue_days}d Overdue
                              </span>
                            )}
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700">
                              {diag.metrics.days_since_last_update}d Since Update
                            </span>
                          </>
                        )}

                        {diag.category === "unusual_payment_timing" && (
                          <>
                            {diag.metrics.min_tranche_interval_days !== null && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800">
                                {diag.metrics.min_tranche_interval_days}d Min Interval
                              </span>
                            )}
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700">
                              Gap: {diag.metrics.financial_physical_gap_pct > 0 ? `+${diag.metrics.financial_physical_gap_pct.toFixed(0)}%` : `${diag.metrics.financial_physical_gap_pct.toFixed(0)}%`}
                            </span>
                          </>
                        )}

                        {diag.category === "duplicate_work" && (
                          <>
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700">
                              {diag.metrics.candidate_matches_count} Candidate(s)
                            </span>
                            {diag.metrics.highest_similarity_pct > 0 && (
                              <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-amber-100 text-amber-800">
                                {diag.metrics.highest_similarity_pct.toFixed(0)}% Match
                              </span>
                            )}
                          </>
                        )}

                        {diag.category === "deviation_from_norms" && (
                          <>
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-700">
                              {diag.metrics.triggered_rules_count || 0} Rule Trigger(s)
                            </span>
                          </>
                        )}
                      </div>
                    </CardContent>
                  </div>

                  <div className="p-4 pt-0 border-t border-slate-100/80 mt-2">
                    <div className="flex items-center justify-between pt-3">
                      <span className="text-[11px] text-slate-500 font-medium capitalize">
                        {diag.verification_status.replace(/_/g, " ")}
                      </span>
                      {canCreateVerification && (
                        <Button
                          size="sm"
                          variant={diag.is_flagged ? "default" : "outline"}
                          onClick={() => openVerificationModal(diag)}
                          className={`text-xs h-7 px-2.5 ${
                            diag.is_flagged
                              ? "bg-rose-700 hover:bg-rose-800 text-white"
                              : "text-slate-700 hover:bg-slate-100"
                          }`}
                        >
                          <Send className="mr-1 h-3 w-3" />
                          Verify
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border border-slate-200 bg-white p-6 text-center text-slate-500">
            <CheckCircle2 className="mx-auto h-7 w-7 text-emerald-600 mb-2" />
            <p className="text-xs font-semibold text-slate-800">
              No anomalies flagged for the {focus} perspective.
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Work parameters conform to standard guidelines in this domain.
            </p>
          </div>
        )}
      </div>

      {/* ── Context-Aware Case View ────────────────────────────── */}
      <Card className="border-slate-200 bg-white shadow-sm overflow-hidden">
        <CardHeader className="p-4 border-b border-slate-100 bg-slate-50/70 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            <FileCheck className="h-4 w-4 text-slate-700" />
            <CardTitle className="text-sm font-semibold text-slate-900">
              {focus === "financial"
                ? `Financial Case View & Formal Inquiries (${visibleCases.length})`
                : focus === "compliance"
                ? `Compliance Case View & Formal Inquiries (${visibleCases.length})`
                : focus === "risk"
                ? `Risk & Field Inspection Case View (${visibleCases.length})`
                : focus === "duplicate"
                ? `Duplicate Investigation Case View (${visibleCases.length})`
                : `Case View: Active Verification Requests (${visibleCases.length})`}
            </CardTitle>
          </div>
          {canCreateVerification && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => openVerificationModal(focus === "all" ? undefined : focus)}
              className="text-xs h-7 text-slate-700 border-slate-300 hover:bg-slate-100"
            >
              <Send className="mr-1 h-3 w-3" />
              + New {focus === "all" ? "Verification" : focus.charAt(0).toUpperCase() + focus.slice(1)} Inquiry
            </Button>
          )}
        </CardHeader>
        {visibleCases.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="p-3">Case ID</th>
                  <th className="p-3">Anomaly Category</th>
                  <th className="p-3">Target Authority</th>
                  <th className="p-3">Scope / Questions</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Created</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {visibleCases.map((c) => (
                  <tr key={c.case_id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="p-3 font-mono text-[11px] font-semibold text-slate-800">
                      {c.case_id.slice(0, 8)}…
                    </td>
                    <td className="p-3">
                      <strong className="text-slate-900 block capitalize">
                        {c.anomaly_category ? c.anomaly_category.replace(/_/g, " ") : c.title}
                      </strong>
                      <span className="text-[10px] text-slate-400">{c.severity} priority</span>
                    </td>
                    <td className="p-3">
                      <span className="font-medium text-slate-800 block">
                        {c.target_authority_name || c.assigned_inspector_id || c.owner_user_id || "Unassigned"}
                      </span>
                      <span className="text-[10px] text-slate-400 capitalize">
                        {c.target_authority_role ? c.target_authority_role.replace(/_/g, " ") : "Authority"}
                      </span>
                    </td>
                    <td className="p-3 max-w-[240px]">
                      <p className="truncate text-slate-700 font-medium" title={c.verification_scope || c.description}>
                        {c.verification_scope || c.description || "General verification"}
                      </p>
                      {c.specific_questions && c.specific_questions.length > 0 && (
                        <span className="text-[10px] text-sky-700 block mt-0.5">
                          {c.specific_questions.length} question(s) specified
                        </span>
                      )}
                    </td>
                    <td className="p-3">
                      <Badge variant="outline" className="text-[10px] capitalize bg-white text-slate-800 border-slate-200">
                        {c.status.replace(/_/g, " ")}
                      </Badge>
                    </td>
                    <td className="p-3 text-slate-500 whitespace-nowrap">
                      {formatDate(c.created_at)}
                    </td>
                    <td className="p-3 text-right">
                      {onOpenCase ? (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => onOpenCase(c.case_id)}
                          className="h-6 text-xs text-sky-700 hover:text-sky-900 hover:bg-sky-50"
                        >
                          View Case →
                        </Button>
                      ) : (
                        <a
                          href={`/dashboard/cases/${c.case_id}`}
                          className="text-xs text-sky-700 hover:underline font-medium"
                        >
                          View Case →
                        </a>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-6 text-center text-slate-500">
            <FileText className="mx-auto h-8 w-8 text-slate-300 mb-2" />
            <p className="text-xs font-semibold text-slate-700">
              No active {focus === "all" ? "" : `${focus} `}inquiries recorded for this work.
            </p>
            <p className="text-[11px] text-slate-400 mt-0.5">
              {canCreateVerification
                ? "You can dispatch a formal verification request directly to the assigned official."
                : "Verification inquiries will appear here once registered by authorised officers."}
            </p>
            {canCreateVerification && (
              <Button
                size="sm"
                onClick={() => openVerificationModal(focus === "all" ? undefined : focus)}
                className="mt-3 text-xs bg-slate-900 hover:bg-slate-800 text-white"
              >
                <Send className="mr-1 h-3 w-3" />
                Create {focus === "all" ? "Verification" : focus.charAt(0).toUpperCase() + focus.slice(1)} Inquiry
              </Button>
            )}
          </div>
        )}
      </Card>

      {/* ── Chronological Narrative Timeline ───────────────────── */}
      <Card className="border-slate-200 bg-white shadow-sm">
        <CardHeader className="p-4 border-b border-slate-100 flex flex-row items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-slate-700" />
            <CardTitle className="text-sm font-semibold text-slate-900">
              {focus === "all"
                ? `Chronological Project Lifecycle & Audit Timeline (${visibleTimeline.length} events)`
                : `${focus.charAt(0).toUpperCase() + focus.slice(1)} Audit Timeline (${visibleTimeline.length} events)`}
            </CardTitle>
          </div>
          {focus !== "all" && (
            <button
              type="button"
              onClick={() => setFocus("all")}
              className="text-xs text-sky-700 hover:underline font-medium"
            >
              Show all events ({dossier.unified_timeline.length})
            </button>
          )}
        </CardHeader>
        <CardContent className="p-4">
          {visibleTimeline.length > 0 ? (
            <div className="relative pl-6 border-l-2 border-slate-200 ml-3 space-y-5 my-2">
              {visibleTimeline.map((item) => {
                let dotColor = "bg-slate-400";
                let badgeStyle = "bg-slate-100 text-slate-700";

                if (item.event_type === "payment_tranche") {
                  dotColor = "bg-amber-500";
                  badgeStyle = "bg-amber-100 text-amber-800 border-amber-200";
                } else if (item.event_type === "progress_update" || item.event_type === "field_inspection") {
                  dotColor = "bg-emerald-500";
                  badgeStyle = "bg-emerald-100 text-emerald-800 border-emerald-200";
                } else if (item.event_type === "verification_request" || item.event_type === "anomaly_flag") {
                  dotColor = "bg-rose-500";
                  badgeStyle = "bg-rose-100 text-rose-800 border-rose-200";
                } else if (item.event_type === "citizen_report") {
                  dotColor = "bg-purple-500";
                  badgeStyle = "bg-purple-100 text-purple-800 border-purple-200";
                } else if (item.event_type === "sanction" || item.event_type === "recommendation") {
                  dotColor = "bg-sky-500";
                  badgeStyle = "bg-sky-100 text-sky-800 border-sky-200";
                }

                return (
                  <div key={item.item_id} className="relative group">
                    <span
                      className={`absolute -left-[31px] top-1 h-3.5 w-3.5 rounded-full border-2 border-white shadow-xs ${dotColor}`}
                    />

                    <div className="bg-slate-50/70 p-3 rounded-lg border border-slate-200/70 hover:border-slate-300 transition-colors">
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1 mb-1">
                        <div className="flex items-center gap-2">
                          <strong className="text-xs font-semibold text-slate-900">
                            {item.title}
                          </strong>
                          <Badge variant="outline" className={`text-[9px] uppercase px-1.5 py-0 ${badgeStyle}`}>
                            {item.event_type.replace(/_/g, " ")}
                          </Badge>
                        </div>
                        <span className="text-[11px] text-slate-400 font-mono">
                          {formatDateTime(item.timestamp)}
                        </span>
                      </div>

                      <p className="text-xs text-slate-700 leading-relaxed font-normal">
                        {item.description}
                      </p>

                      {item.actor && (
                        <div className="mt-2 text-[10px] text-slate-400 font-medium">
                          Recorded by: <span className="text-slate-600">{item.actor}</span>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="p-6 text-center text-slate-500">
              <Clock className="mx-auto h-7 w-7 text-slate-300 mb-2" />
              <p className="text-xs font-semibold text-slate-800">
                No specific {focus} events in this project timeline.
              </p>
              <button
                type="button"
                onClick={() => setFocus("all")}
                className="mt-2 text-xs text-sky-700 hover:underline font-medium"
              >
                View all {dossier.unified_timeline.length} timeline events →
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Generate Verification Request Modal ────────────────── */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 backdrop-blur-xs p-4 overflow-y-auto">
          <div className="relative w-full max-w-2xl rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden my-8">
            <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-rose-50/60">
              <div className="flex items-center gap-2">
                <Send className="h-5 w-5 text-rose-700" />
                <h3 className="text-base font-bold text-slate-900">
                  Generate Verification Request
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-200/50 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleCreateVerification} className="p-5 space-y-4 text-xs">
              {actionSuccess && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>{actionSuccess}</span>
                </div>
              )}
              {actionError && (
                <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-lg flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-rose-600 shrink-0" />
                  <span>{actionError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Anomaly Category */}
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    Anomaly Category
                  </label>
                  <select
                    value={selectedCategory}
                    onChange={(e) => setSelectedCategory(e.target.value as AnomalyCategory)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-rose-500 focus:outline-none"
                  >
                    {Object.entries(CATEGORY_NAMES).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Target Authority Role */}
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    Target Authority Role
                  </label>
                  <select
                    value={selectedAuthorityRole}
                    onChange={(e) => {
                      const role = e.target.value as AuthorityRole;
                      setSelectedAuthorityRole(role);
                      const matching = authorities.find((a) => a.authority_type === role);
                      if (matching) setSelectedUserId(matching.user_id);
                    }}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-rose-500 focus:outline-none"
                  >
                    <option value="finance_officer">Finance & Accounts Authority</option>
                    <option value="inspector">Field Inspector (On-Site Physical Audit)</option>
                    <option value="district_authority">District Authority / Planning Branch</option>
                    <option value="state_nodal_officer">State Nodal Officer (State Oversight)</option>
                    <option value="technical_examiner">Technical & Engineering Sanction Authority</option>
                  </select>
                </div>
              </div>

              {/* Specific Official Assignee */}
              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  Assign to Available Official in District/State Scope
                </label>
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-rose-500 focus:outline-none"
                >
                  <option value="">Choose designated official (Optional / Auto-pool)</option>
                  {authorities.map((a) => (
                    <option key={a.user_id} value={a.user_id}>
                      {a.jurisdiction_label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Title */}
              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  Verification Request Title
                </label>
                <input
                  type="text"
                  value={reqTitle}
                  onChange={(e) => setReqTitle(e.target.value)}
                  required
                  placeholder="e.g. Ground Verification for Cost Escalation and Physical Milestone"
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-rose-500 focus:outline-none"
                />
              </div>

              {/* Scope & Priority */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    Verification Scope
                  </label>
                  <input
                    type="text"
                    value={reqScope}
                    onChange={(e) => setReqScope(e.target.value)}
                    placeholder="e.g. Physical Site Survey, Ledger Scrutiny"
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-rose-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-slate-700 font-semibold mb-1">
                    Target Due Date
                  </label>
                  <input
                    type="date"
                    value={reqDueDate}
                    onChange={(e) => setReqDueDate(e.target.value)}
                    className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-rose-500 focus:outline-none"
                  />
                </div>
              </div>

              {/* Description */}
              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  Instructions & Background Details
                </label>
                <textarea
                  value={reqDesc}
                  onChange={(e) => setReqDesc(e.target.value)}
                  rows={2}
                  className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 focus:border-rose-500 focus:outline-none"
                />
              </div>

              {/* Specific Questions for Authority */}
              <div>
                <label className="block text-slate-700 font-semibold mb-1">
                  Specific Questions / Audit Checklist for the Authority
                </label>
                <div className="space-y-1.5 mb-2">
                  {reqQuestions.map((q, idx) => (
                    <div key={idx} className="flex items-center justify-between gap-2 p-2 bg-slate-50 border border-slate-200 rounded-md">
                      <span className="text-slate-800">{idx + 1}. {q}</span>
                      <button
                        type="button"
                        onClick={() => removeQuestion(idx)}
                        className="text-rose-600 hover:text-rose-800 p-1"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newQuestionText}
                    onChange={(e) => setNewQuestionText(e.target.value)}
                    placeholder="Add custom question to verify..."
                    className="flex-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-rose-500 focus:outline-none"
                  />
                  <Button type="button" size="sm" variant="outline" onClick={addQuestion} className="text-xs">
                    Add
                  </Button>
                </div>
              </div>

              <div className="p-3 bg-slate-50 border border-slate-200 rounded-lg text-slate-600 text-[11px] leading-relaxed">
                ℹ️ Submitting this form generates an immutable Case document, attaches a verification marker to the project
                timeline, and notifies the assigned official.
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setModalOpen(false)}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={submitting}
                  className="bg-rose-600 hover:bg-rose-700 text-white font-medium"
                >
                  {submitting ? "Dispatching..." : "Dispatch Verification Request"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
