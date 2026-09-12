"use client";

import { useAuth } from "@/lib/auth";
import {
  WorkDetail,
  STATUS_CONFIG,
  CATEGORY_LABELS,
  formatCurrency,
  formatDate,
  formatDateTime,
  RiskScore,
} from "@/lib/api";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import React, { useCallback, useEffect, useState } from "react";
import { WorkLocationMap } from "@/components/maps/work-location-map";
import { ProjectStoryDossier } from "@/components/works/project-story-dossier";
import { WorkRoutingTracker } from "@/components/works/work-routing-tracker";

// ── Component ───────────────────────────────────────────────────

export default function Work360Page() {
  const { user, fetchWithAuth, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const searchParams = useSearchParams();
  const workId = params.workId as string;
  const focusParam = (searchParams.get("focus") || searchParams.get("context") || "all") as "all" | "financial" | "compliance" | "risk" | "duplicate";

  const [work, setWork] = useState<WorkDetail | null>(null);
  const [riskScore, setRiskScore] = useState<RiskScore | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"story" | "records">("story");

  // MP Recommendation & DA Sanction state
  const [isSanctionModalOpen, setIsSanctionModalOpen] = useState(false);
  const [isRejectModalOpen, setIsRejectModalOpen] = useState(false);
  const [sanctionAgency, setSanctionAgency] = useState("");
  const [sanctionOrderRef, setSanctionOrderRef] = useState("");
  const [sanctionAmount, setSanctionAmount] = useState("");
  const [sanctionRemarks, setSanctionRemarks] = useState("");
  const [rejectionReason, setRejectionReason] = useState("");
  const [isActionSubmitting, setIsActionSubmitting] = useState(false);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);

  // Physical Progress Modal State
  const [isProgressModalOpen, setIsProgressModalOpen] = useState(false);
  const [progressPct, setProgressPct] = useState("");
  const [progressDesc, setProgressDesc] = useState("");

  // Payment Tranche Modal State
  const [isPaymentModalOpen, setIsPaymentModalOpen] = useState(false);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentPurpose, setPaymentPurpose] = useState("");

  // Field Inspection Modal State
  const [isInspectionModalOpen, setIsInspectionModalOpen] = useState(false);
  const [inspectionStage, setInspectionStage] = useState("intermediate_progress");
  const [inspectionInstructions, setInspectionInstructions] = useState("Verify physical progress and capture on-site geotagged photos.");
  const [inspectionPriority, setInspectionPriority] = useState<"routine" | "urgent">("routine");

  const fetchWork = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetchWithAuth(`/api/v1/works/${workId}/360`);
      if (res.status === 403) {
        setError("PERMISSION_DENIED");
        return;
      }
      if (res.status === 404) {
        setError("NOT_FOUND");
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed to load work" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data: WorkDetail = await res.json();
      setWork(data);

      // Risk is permission-scoped independently from works. A missing score or
      // unavailable risk permission must not prevent the work view from loading.
      try {
        const riskRes = await fetchWithAuth(`/api/v1/risk/${workId}`);
        if (riskRes.ok) {
          setRiskScore(await riskRes.json());
        } else {
          setRiskScore(null);
        }
      } catch {
        setRiskScore(null);
      }

      // Fetch audit events (non-blocking)
      try {
        const auditRes = await fetchWithAuth(`/api/v1/works/${workId}/timeline`);
        if (auditRes.ok) {
          // We use timeline from 360 data, audit from audit_logs is separate
        }
      } catch {
        // Non-critical
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load work");
    } finally {
      setIsLoading(false);
    }
  }, [workId, fetchWithAuth]);

  const handleOpenSanctionModal = () => {
    if (!work) return;
    setSanctionAmount(work.sanctioned_amount ? String(work.sanctioned_amount) : "");
    setSanctionOrderRef(`DM-${work.district_code || "VNS"}/MPLADS/${new Date().getFullYear()}/AS-${Math.floor(100 + Math.random() * 900)}`);
    setSanctionAgency(work.implementing_agency || "Public Works Department (PWD)");
    setSanctionRemarks("Technical scrutiny completed and approved. Project fulfills MPLADS Chapter 2 guidelines.");
    setIsSanctionModalOpen(true);
  };

  const handleGrantSanction = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsActionSubmitting(true);
    try {
      const res = await fetchWithAuth(`/api/v1/works/${workId}/sanction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sanctioned_amount: parseFloat(sanctionAmount) || (work?.sanctioned_amount || 0),
          implementing_agency: sanctionAgency,
          sanction_order_ref: sanctionOrderRef,
          remarks: sanctionRemarks,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Sanction failed" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      setIsSanctionModalOpen(false);
      setActionSuccessMsg(`Administrative Sanction granted successfully vide Order Ref: ${sanctionOrderRef}. Assigned to ${sanctionAgency}.`);
      await fetchWork();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to accord Administrative Sanction.");
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const handleRejectRecommendation = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsActionSubmitting(true);
    try {
      const res = await fetchWithAuth(`/api/v1/works/${workId}/reject-recommendation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rejection_reason: rejectionReason,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Rejection failed" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      setIsRejectModalOpen(false);
      setActionSuccessMsg(`Work proposal returned / rejected with official statutory notice.`);
      await fetchWork();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to return recommendation.");
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const handleRecordProgress = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsActionSubmitting(true);
    try {
      const pct = parseFloat(progressPct);
      if (isNaN(pct) || pct < 0 || pct > 100) {
        throw new Error("Physical progress percentage must be between 0 and 100");
      }
      const res = await fetchWithAuth(`/api/v1/works/${workId}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          physical_progress_pct: pct,
          description: progressDesc,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed to record progress" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      setIsProgressModalOpen(false);
      setProgressDesc("");
      setActionSuccessMsg(`Physical progress updated to ${pct.toFixed(0)}% successfully.`);
      await fetchWork();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to record physical progress.");
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const handleReleasePayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsActionSubmitting(true);
    try {
      const amt = parseFloat(paymentAmount);
      if (isNaN(amt) || amt <= 0) {
        throw new Error("Payment amount must be greater than zero");
      }
      const res = await fetchWithAuth(`/api/v1/works/${workId}/payments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amount: amt,
          purpose: paymentPurpose,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed to disburse payment" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      setIsPaymentModalOpen(false);
      setPaymentAmount("");
      setPaymentPurpose("");
      setActionSuccessMsg(`Payment tranche of ₹${amt.toLocaleString("en-IN")} released successfully.`);
      await fetchWork();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to release payment tranche.");
    } finally {
      setIsActionSubmitting(false);
    }
  };

  const handleDispatchInspection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!work) return;
    setIsActionSubmitting(true);
    try {
      const res = await fetchWithAuth(`/api/v1/works/${workId}/dispatch-inspection`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          milestone_stage: inspectionStage,
          instructions: inspectionInstructions,
          priority: inspectionPriority,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Inspection dispatch failed" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data = await res.json();
      setIsInspectionModalOpen(false);
      setActionSuccessMsg(`Field inspection successfully dispatched to ${data.inspector_name || "Technical Inspector"} (Case Ref: ${data.case_id}).`);
      await fetchWork();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to dispatch field inspection.");
    } finally {
      setIsActionSubmitting(false);
    }
  };

  useEffect(() => {
    if (authLoading || !user) return;
    const timer = window.setTimeout(() => { void fetchWork(); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchWork, authLoading, user]);

  // ── Auth loading ──────────────────────────────────────────
  if (authLoading) {
    return (
      <div style={s.pageWrap}>
        <div style={s.spinner} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={s.pageWrap}>
        <p style={{ color: "#64748b" }}>Not authenticated. Redirecting…</p>
      </div>
    );
  }

  // ── Permission denied ─────────────────────────────────────
  if (error === "PERMISSION_DENIED") {
    return (
      <div style={s.pageWrap}>
        <div style={s.centerCard}>
          <BackButton onClick={() => router.push("/dashboard/works")} />
          <div style={s.stateBox}>
            <div style={s.stateIcon}>🔒</div>
            <h2 style={s.stateTitle}>Insufficient Permissions</h2>
            <p style={s.stateDesc}>
              Your role does not have permission to view this work.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Not found ─────────────────────────────────────────────
  if (error === "NOT_FOUND") {
    return (
      <div style={s.pageWrap}>
        <div style={s.centerCard}>
          <BackButton onClick={() => router.push("/dashboard/works")} />
          <div style={s.stateBox}>
            <div style={s.stateIcon}>🔍</div>
            <h2 style={s.stateTitle}>Work Not Found</h2>
            <p style={s.stateDesc}>
              The work you are looking for does not exist or has been removed.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────
  if (error) {
    return (
      <div style={s.pageWrap}>
        <div style={s.centerCard}>
          <BackButton onClick={() => router.push("/dashboard/works")} />
          <div style={{ ...s.stateBox, borderColor: "#fca5a5" }}>
            <div style={s.stateIcon}>⚠️</div>
            <h2 style={s.stateTitle}>Error Loading Work</h2>
            <p style={s.stateDesc}>{error}</p>
            <button onClick={fetchWork} style={s.retryBtn}>Retry</button>
          </div>
        </div>
      </div>
    );
  }

  // ── Loading skeleton ──────────────────────────────────────
  if (isLoading || !work) {
    return (
      <div style={s.pageWrap}>
        <div style={s.content}>
          <div style={s.skeletonHeader}>
            <div style={{ ...s.skBar, width: "40%", height: 24 }} />
            <div style={{ ...s.skBar, width: "20%", height: 16, marginTop: 8 }} />
          </div>
          <div style={s.metricsRow}>
            {[1, 2, 3, 4].map((i) => (
              <div key={i} style={s.metricCardSk}>
                <div style={{ ...s.skBar, width: "60%", height: 12 }} />
                <div style={{ ...s.skBar, width: "40%", height: 20, marginTop: 8 }} />
              </div>
            ))}
          </div>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ ...s.card, marginBottom: "1rem" }}>
              <div style={{ ...s.skBar, width: "30%", height: 14 }} />
              <div style={{ ...s.skBar, width: "80%", height: 12, marginTop: 12 }} />
              <div style={{ ...s.skBar, width: "60%", height: 12, marginTop: 8 }} />
            </div>
          ))}
        </div>
        <style>{`
          @keyframes spin{to{transform:rotate(360deg)}}
          @keyframes shimmer{0%{background-position:-200px 0}100%{background-position:200px 0}}
        `}</style>
      </div>
    );
  }

  // ── Data loaded ───────────────────────────────────────────
  const sc = STATUS_CONFIG[work.status];
  const fundsPct = work.sanctioned_amount > 0
    ? Math.min(100, (work.funds_released / work.sanctioned_amount) * 100)
    : 0;
  const spentPct = work.sanctioned_amount > 0
    ? Math.min(100, (work.actual_expenditure / work.sanctioned_amount) * 100)
    : 0;

  return (
    <div style={s.pageWrap}>
      <div style={s.content}>
        {/* ── Header ─────────────────────────────────────── */}
        <div style={s.headerRow}>
          <BackButton onClick={() => router.push("/dashboard/works")} />
          <div style={{ flex: 1 }}>
            <div style={s.headerTop}>
              <h1 style={s.title}>{work.title}</h1>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                <span style={{ ...s.statusBadge, color: sc.color, background: sc.bg, borderColor: sc.border }}>
                  {sc.label}
                </span>
                {(user?.role === "admin" || user?.role === "district_authority") && (
                  <button
                    onClick={() => router.push(`/dashboard/cases?work_id=${encodeURIComponent(work.work_id)}&title=${encodeURIComponent("Case: " + work.title)}`)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: "0.35rem",
                      padding: "0.35rem 0.75rem",
                      borderRadius: "6px",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      color: "#b91c1c",
                      backgroundColor: "#fef2f2",
                      border: "1px solid #fecaca",
                      cursor: "pointer",
                    }}
                  >
                    ⚖️ Open Case
                  </button>
                )}
              </div>
            </div>
            <div style={s.headerMeta}>
              <span style={s.workIdLabel}>ID: {work.work_id.slice(0, 8)}…</span>
              <span style={s.metaSep}>•</span>
              <span>{CATEGORY_LABELS[work.category]}</span>
              {work.sub_category && (
                <>
                  <span style={s.metaSep}>•</span>
                  <span>{work.sub_category}</span>
                </>
              )}
            </div>
          </div>
        </div>

        <RiskAlert score={riskScore} />

        {work.sno_notice_issued && (
          <div
            style={{
              marginTop: "1rem",
              padding: "1rem 1.25rem",
              borderRadius: "8px",
              backgroundColor: "#fff1f2",
              border: "2px solid #fda4af",
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: "1rem",
            }}
          >
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                <span style={{ fontSize: "1.1rem" }}>🚨</span>
                <strong style={{ fontSize: "0.875rem", color: "#9f1239" }}>
                  Active State Nodal Officer (SNO) Show-Cause Directive: {work.latest_memo_ref || "Formal Administrative Memo"}
                </strong>
                <span
                  style={{
                    fontSize: "0.7rem",
                    fontWeight: 700,
                    padding: "0.15rem 0.5rem",
                    borderRadius: "9999px",
                    backgroundColor: "#e11d48",
                    color: "#ffffff",
                    letterSpacing: "0.025em",
                  }}
                >
                  STATUTORY ESCALATION
                </span>
              </div>
              <p style={{ margin: "0.35rem 0 0", fontSize: "0.8rem", color: "#881337", lineHeight: 1.4 }}>
                A formal administrative notice was issued under MPLADS Guidelines Section 8.4 due to delay thresholds overshoot.
                {work.cure_deadline && ` Mandatory physical compliance remediation due by ${formatDate(work.cure_deadline)}.`}
              </p>
            </div>
            {work.active_case_id && (
              <button
                type="button"
                onClick={() => router.push(`/dashboard/cases/${work.active_case_id}`)}
                style={{
                  padding: "0.45rem 0.85rem",
                  fontSize: "0.75rem",
                  fontWeight: 600,
                  backgroundColor: "#e11d48",
                  color: "#ffffff",
                  borderRadius: "6px",
                  border: "none",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                }}
              >
                View Case Dossier →
              </button>
            )}
          </div>
        )}

        {/* ── Multi-Stakeholder Request Routing & Custodian Stepper ── */}
        <WorkRoutingTracker
          workId={workId}
          onOpenSanctionModal={handleOpenSanctionModal}
          onOpenInspectionModal={() => setIsInspectionModalOpen(true)}
          onOpenProgressModal={() => {
            setProgressPct(String(work.physical_progress_pct || 50));
            setProgressDesc("");
            setIsProgressModalOpen(true);
          }}
        />

        {/* ── MP Recommendation & District Authority Sanctioning Banner ── */}
        {(work.status === "recommended" || work.status === "under_review") && (
          <div
            style={{
              marginTop: "1rem",
              padding: "1.25rem",
              borderRadius: "12px",
              backgroundColor: "#f0fdf4",
              border: "2px solid #86efac",
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
            }}
          >
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem" }}>
              <div style={{ maxWidth: "680px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                  <span style={{ fontSize: "1.25rem" }}>📋</span>
                  <strong style={{ fontSize: "0.95rem", color: "#14532d" }}>
                    Hon&apos;ble MP Project Recommendation Awaiting Administrative Sanction (AS)
                  </strong>
                  <span
                    style={{
                      fontSize: "0.7rem",
                      fontWeight: 700,
                      padding: "0.15rem 0.55rem",
                      borderRadius: "9999px",
                      backgroundColor: "#16a34a",
                      color: "#ffffff",
                    }}
                  >
                    PENDING DA ACTION
                  </span>
                  {work.sc_st_quota_type && work.sc_st_quota_type !== "general" && (
                    <span
                      style={{
                        fontSize: "0.7rem",
                        fontWeight: 700,
                        padding: "0.15rem 0.55rem",
                        borderRadius: "9999px",
                        backgroundColor: "#e0e7ff",
                        color: "#3730a3",
                        textTransform: "uppercase",
                      }}
                    >
                      {work.sc_st_quota_type} Quota Asset
                    </span>
                  )}
                </div>

                <div style={{ marginTop: "0.6rem", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "0.5rem", fontSize: "0.78rem", color: "#166534" }}>
                  <div>
                    <span style={{ opacity: 0.75 }}>Recommended by:</span>{" "}
                    <strong>{work.mp_name || "Hon. Member of Parliament"}</strong>
                  </div>
                  <div>
                    <span style={{ opacity: 0.75 }}>Constituency:</span>{" "}
                    <strong>{work.constituency || work.district_name}</strong>
                  </div>
                  <div>
                    <span style={{ opacity: 0.75 }}>Proposed Outlay:</span>{" "}
                    <strong style={{ fontSize: "0.85rem" }}>{formatCurrency(work.sanctioned_amount)}</strong>
                  </div>
                  <div>
                    <span style={{ opacity: 0.75 }}>Recommendation Date:</span>{" "}
                    <strong>{work.recommended_date ? formatDate(work.recommended_date) : "Recent"}</strong>
                  </div>
                </div>

                {work.description && (
                  <p style={{ margin: "0.75rem 0 0", fontSize: "0.8rem", color: "#14532d", lineHeight: 1.4, backgroundColor: "rgba(255,255,255,0.6)", padding: "0.5rem 0.75rem", borderRadius: "6px", border: "1px solid #bbf7d0" }}>
                    <strong>Public Utility Need:</strong> {work.description}
                  </p>
                )}
              </div>

              {/* Action buttons for DA and Admin */}
              {(user?.role === "district_authority" || user?.role === "admin" || user?.role === "mospi") && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.5rem", minWidth: "200px" }}>
                  <button
                    type="button"
                    onClick={handleOpenSanctionModal}
                    style={{
                      padding: "0.6rem 1rem",
                      fontSize: "0.8rem",
                      fontWeight: 700,
                      backgroundColor: "#15803d",
                      color: "#ffffff",
                      borderRadius: "8px",
                      border: "none",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "0.35rem",
                      boxShadow: "0 1px 2px rgba(0,0,0,0.1)",
                    }}
                  >
                    ✓ Grant Administrative Sanction
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setRejectionReason("Proposal requires revised cost estimate / site clearance from municipal authorities.");
                      setIsRejectModalOpen(true);
                    }}
                    style={{
                      padding: "0.45rem 1rem",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      backgroundColor: "#ffffff",
                      color: "#b91c1c",
                      borderRadius: "8px",
                      border: "1px solid #fca5a5",
                      cursor: "pointer",
                      textAlign: "center",
                    }}
                  >
                    ✕ Return / Request Clarification
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {actionSuccessMsg && (
          <div
            style={{
              marginTop: "0.75rem",
              padding: "0.75rem 1rem",
              borderRadius: "8px",
              backgroundColor: "#ecfdf5",
              border: "1px solid #6ee7b7",
              color: "#065f46",
              fontSize: "0.8rem",
              fontWeight: 600,
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
            }}
          >
            <span>✓ {actionSuccessMsg}</span>
            <button
              onClick={() => setActionSuccessMsg(null)}
              style={{ background: "none", border: "none", cursor: "pointer", fontWeight: 700 }}
            >
              ×
            </button>
          </div>
        )}

        {/* ── View Mode Selector ─────────────────────────── */}
        <div style={{ display: "flex", gap: "0.5rem", marginTop: "1.25rem", marginBottom: "1.5rem", borderBottom: "1px solid #e2e8f0", paddingBottom: "0.75rem" }}>
          <button
            type="button"
            onClick={() => setActiveTab("story")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              padding: "0.5rem 1rem",
              borderRadius: "8px",
              fontSize: "0.85rem",
              fontWeight: 650,
              cursor: "pointer",
              border: activeTab === "story" ? "1px solid #e11d48" : "1px solid #cbd5e1",
              background: activeTab === "story" ? "#ffe4e6" : "#ffffff",
              color: activeTab === "story" ? "#9f1239" : "#475569",
            }}
          >
            📖 Project Story & Anomaly Dossier (What Happened)
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("records")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              padding: "0.5rem 1rem",
              borderRadius: "8px",
              fontSize: "0.85rem",
              fontWeight: 650,
              cursor: "pointer",
              border: activeTab === "records" ? "1px solid #2563eb" : "1px solid #cbd5e1",
              background: activeTab === "records" ? "#eff6ff" : "#ffffff",
              color: activeTab === "records" ? "#1e40af" : "#475569",
            }}
          >
            📊 Detailed Work 360 Ledgers & Data
          </button>
        </div>

        {activeTab === "story" ? (
          <ProjectStoryDossier
            workId={work.work_id}
            initialFocus={focusParam}
            onOpenCase={(caseId) => router.push(`/dashboard/cases/${caseId}`)}
          />
        ) : (
          <>
            {/* ── Key Metrics ────────────────────────────────── */}
            <div style={s.metricsRow}>
          <MetricCard
            label="Sanctioned Amount"
            value={formatCurrency(work.sanctioned_amount)}
            color="#60a5fa"
          />
          <MetricCard
            label="Funds Released"
            value={formatCurrency(work.funds_released)}
            sub={`${fundsPct.toFixed(0)}% of sanctioned`}
            color="#34d399"
          />
          <MetricCard
            label="Actual Expenditure"
            value={formatCurrency(work.actual_expenditure)}
            sub={`${spentPct.toFixed(0)}% of sanctioned`}
            color="#fbbf24"
          />
          <MetricCard
            label="Physical Progress"
            value={`${work.physical_progress_pct.toFixed(0)}%`}
            color={work.physical_progress_pct >= 75 ? "#22c55e" : work.physical_progress_pct >= 40 ? "#fbbf24" : "#f87171"}
            isProgress
            pct={work.physical_progress_pct}
          />
        </div>

        {/* ── Two-column grid ────────────────────────────── */}
        <div style={s.grid2}>
          {/* Overview Card */}
          <div style={s.card}>
            <h3 style={s.cardTitle}>Overview</h3>
            {work.description && (
              <p style={s.descText}>{work.description}</p>
            )}
            <div style={s.fieldGrid}>
              <Field label="State" value={work.state_name || work.state_code} />
              <Field label="District" value={work.district_name || work.district_code} />
              <Field label="Constituency" value={work.constituency} />
              <Field label="MP" value={work.mp_name} />
              <Field label="Implementing Agency" value={work.implementing_agency} />
              <Field label="Category" value={CATEGORY_LABELS[work.category]} />
            </div>
          </div>

          {/* Dates Card */}
          <div style={s.card}>
            <h3 style={s.cardTitle}>Key Dates</h3>
            <div style={s.fieldGrid}>
              <Field label="Recommended" value={formatDate(work.recommended_date)} />
              <Field label="Sanctioned" value={formatDate(work.sanctioned_date)} />
              <Field label="Started" value={formatDate(work.start_date)} />
              <Field label="Expected Completion" value={formatDate(work.expected_completion_date)} />
              <Field label="Actual Completion" value={formatDate(work.actual_completion_date)} />
              <Field label="Last Updated" value={formatDateTime(work.updated_at)} />
            </div>
          </div>
        </div>

        {/* ── Financial Breakdown ─────────────────────────── */}
        <div style={s.card}>
          <h3 style={s.cardTitle}>Financial Summary</h3>
          <div style={s.finBarWrap}>
            <FinBar label="Sanctioned" amount={work.sanctioned_amount} pct={100} color="#60a5fa" />
            <FinBar label="Released" amount={work.funds_released} pct={fundsPct} color="#34d399" />
            <FinBar label="Spent" amount={work.actual_expenditure} pct={spentPct} color="#fbbf24" />
          </div>
        </div>

        {/* ── Map Location ───────────────────────────────── */}
        <WorkLocationMap location={work.location} title="Project location" />

        {/* ── Payment Tranches ────────────────────────────── */}
        <div style={s.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h3 style={{ ...s.cardTitle, margin: 0 }}>
              Payment Tranches
              <span style={s.countBadge}>{work.payment_tranches.length}</span>
            </h3>
            {(user?.role === "district_authority" || user?.role === "admin") && (
              <button
                type="button"
                onClick={() => {
                  setPaymentAmount("");
                  setPaymentPurpose(`Tranche #${work.payment_tranches.length + 1} disbursement for civil milestone`);
                  setIsPaymentModalOpen(true);
                }}
                style={{
                  padding: "0.4rem 0.85rem",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  backgroundColor: "#0284c7",
                  color: "#ffffff",
                  borderRadius: "6px",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                }}
              >
                + Disburse Payment Tranche
              </button>
            )}
          </div>
          {work.payment_tranches.length === 0 ? (
            <p style={s.emptyText}>No payment tranches recorded yet</p>
          ) : (
            <div style={s.tableWrap}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <th style={s.th}>#</th>
                    <th style={s.th}>Amount</th>
                    <th style={s.th}>Date</th>
                    <th style={s.th}>Purpose</th>
                    <th style={s.th}>Released By</th>
                  </tr>
                </thead>
                <tbody>
                  {work.payment_tranches.map((t) => (
                    <tr key={t.tranche_id} style={s.tRow}>
                      <td style={s.td}>{t.tranche_number}</td>
                      <td style={{ ...s.td, fontWeight: 600, color: "#16a34a" }}>
                        {formatCurrency(t.amount)}
                      </td>
                      <td style={s.td}>{formatDate(t.released_date)}</td>
                      <td style={s.td}>{t.purpose || "—"}</td>
                      <td style={s.td}>{t.released_by || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ── Progress Updates ────────────────────────────── */}
        <div style={s.card}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "1rem" }}>
            <h3 style={{ ...s.cardTitle, margin: 0 }}>
              Progress Updates
              <span style={s.countBadge}>{work.progress_updates.length}</span>
            </h3>
            {(user?.role === "agency" || user?.role === "district_authority" || user?.role === "admin") && (
              <button
                type="button"
                onClick={() => {
                  setProgressPct(String(work.physical_progress_pct));
                  setProgressDesc("");
                  setIsProgressModalOpen(true);
                }}
                style={{
                  padding: "0.4rem 0.85rem",
                  fontSize: "0.75rem",
                  fontWeight: 700,
                  backgroundColor: "#16a34a",
                  color: "#ffffff",
                  borderRadius: "6px",
                  border: "none",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: "0.35rem",
                  boxShadow: "0 1px 2px rgba(0,0,0,0.05)",
                }}
              >
                + Record Physical Progress
              </button>
            )}
          </div>
          {work.progress_updates.length === 0 ? (
            <p style={s.emptyText}>No progress updates recorded yet</p>
          ) : (
            <div style={s.timelineList}>
              {work.progress_updates.map((u) => {
                const pColor = u.physical_progress_pct >= 75 ? "#22c55e" : u.physical_progress_pct >= 40 ? "#fbbf24" : "#f87171";
                return (
                  <div key={u.update_id} style={s.timelineItem}>
                    <div style={s.tlDot}>
                      <div style={{ ...s.tlDotInner, background: pColor }} />
                    </div>
                    <div style={s.tlContent}>
                      <div style={s.tlHeader}>
                        <span style={{ ...s.tlProgress, color: pColor }}>
                          {u.physical_progress_pct.toFixed(0)}%
                        </span>
                        <span style={s.tlDate}>{formatDate(u.date)}</span>
                      </div>
                      <p style={s.tlDesc}>{u.description || "Progress update recorded"}</p>
                      <div style={s.tlMeta}>
                        Updated by: {u.updated_by || "—"}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Work Timeline ──────────────────────────────── */}
        <div style={s.card}>
          <h3 style={s.cardTitle}>
            Lifecycle Timeline
            <span style={s.countBadge}>{work.timeline.length}</span>
          </h3>
          {work.timeline.length === 0 ? (
            <p style={s.emptyText}>No timeline events</p>
          ) : (
            <div style={s.timelineList}>
              {work.timeline.map((ev) => {
                const evColor = getEventColor(ev.event_type);
                return (
                  <div key={ev.event_id} style={s.timelineItem}>
                    <div style={s.tlDot}>
                      <div style={{ ...s.tlDotInner, background: evColor }} />
                    </div>
                    <div style={s.tlContent}>
                      <div style={s.tlHeader}>
                        <span style={{ fontWeight: 600, color: "#0f172a", fontSize: "0.85rem" }}>
                          {ev.title}
                        </span>
                        <span style={s.tlDate}>{formatDateTime(ev.timestamp)}</span>
                      </div>
                      {ev.description && (
                        <p style={s.tlDesc}>{ev.description}</p>
                      )}
                      {ev.actor && (
                        <div style={s.tlMeta}>By: {ev.actor}</div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* ── Review sections ─────────────────────────────── */}
        <div style={s.grid2}>
          {["admin", "mospi", "state_nodal_officer", "district_authority", "inspector"].includes(user.role) ? (
            <button onClick={() => router.push("/dashboard/evidence")} style={s.evidenceCard}>
              <div style={s.phIcon}>⌁</div>
              <h3 style={s.phTitle}>Evidence verification</h3>
              <p style={s.phDesc}>Review server-side file hash, EXIF, GPS, timestamp, distance, and image-reuse signals. Private files are not shown here.</p>
              <span style={s.evidenceBadge}>Open private review</span>
            </button>
          ) : (
            <div style={s.placeholderCard}>
              <div style={s.phIcon}>🔒</div>
              <h3 style={s.phTitle}>Evidence verification</h3>
              <p style={s.phDesc}>Private evidence files and verification metadata are available only to authorized review roles (Admin, MoSPI, SNO, District Authority, Inspector).</p>
            </div>
          )}
          <PlaceholderSection
            icon="📁"
            title="Case Section"
            description="Investigation cases and field inspection reports will be linked here."
          />
        </div>

        {/* ── Audit Timeline ─────────────────────────────── */}
        <div style={s.card}>
          <h3 style={s.cardTitle}>Audit Trail</h3>
          {work.timeline.length === 0 ? (
            <p style={s.emptyText}>No audit events recorded</p>
          ) : (
            <div style={s.auditList}>
              {work.timeline.slice(0, 10).map((ev) => (
                <div key={ev.event_id} style={s.auditRow}>
                  <span style={s.auditType}>{ev.event_type}</span>
                  <span style={s.auditTitle}>{ev.title}</span>
                  <span style={s.auditActor}>{ev.actor || "System"}</span>
                  <span style={s.auditTime}>{formatDateTime(ev.timestamp)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
          </>
        )}

        {/* ── Administrative Sanction Modal ── */}
        {isSanctionModalOpen && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(15, 23, 42, 0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
              padding: "1rem",
              backdropFilter: "blur(2px)",
            }}
          >
            <div
              style={{
                backgroundColor: "#ffffff",
                borderRadius: "14px",
                width: "100%",
                maxWidth: "560px",
                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
                border: "1px solid #e2e8f0",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid #e2e8f0", backgroundColor: "#f8fafc", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: "#0f172a" }}>
                    Grant Administrative Sanction (AS)
                  </h3>
                  <p style={{ margin: "0.2rem 0 0", fontSize: "0.75rem", color: "#64748b" }}>
                    Accord statutory sanction order and allocate implementing agency under MPLADS guidelines.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsSanctionModalOpen(false)}
                  style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer", color: "#64748b" }}
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleGrantSanction} style={{ padding: "1.5rem" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#334155", marginBottom: "0.35rem" }}>
                      Sanction Order Reference *
                    </label>
                    <input
                      type="text"
                      required
                      value={sanctionOrderRef}
                      onChange={(e) => setSanctionOrderRef(e.target.value)}
                      placeholder="e.g. DM-VNS/MPLADS/2026/AS-101"
                      style={{
                        width: "100%",
                        padding: "0.55rem 0.75rem",
                        borderRadius: "8px",
                        border: "1px solid #cbd5e1",
                        fontSize: "0.85rem",
                        fontFamily: "monospace",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#334155", marginBottom: "0.35rem" }}>
                      Implementing Agency *
                    </label>
                    <input
                      type="text"
                      required
                      value={sanctionAgency}
                      onChange={(e) => setSanctionAgency(e.target.value)}
                      placeholder="e.g. Public Works Department (PWD)"
                      style={{
                        width: "100%",
                        padding: "0.55rem 0.75rem",
                        borderRadius: "8px",
                        border: "1px solid #cbd5e1",
                        fontSize: "0.85rem",
                        boxSizing: "border-box",
                        marginBottom: "0.4rem",
                      }}
                    />
                    <div style={{ display: "flex", flexWrap: "wrap", gap: "0.35rem" }}>
                      {["PWD", "UP Jal Nigam", "Rural Engineering Services (RES)", "CPWD", "Municipal Corporation"].map((agency) => (
                        <button
                          key={agency}
                          type="button"
                          onClick={() => setSanctionAgency(agency)}
                          style={{
                            padding: "0.2rem 0.5rem",
                            fontSize: "0.68rem",
                            borderRadius: "4px",
                            backgroundColor: sanctionAgency === agency ? "#dbeafe" : "#f1f5f9",
                            color: sanctionAgency === agency ? "#1e40af" : "#475569",
                            border: "1px solid",
                            borderColor: sanctionAgency === agency ? "#93c5fd" : "#e2e8f0",
                            cursor: "pointer",
                          }}
                        >
                          {agency}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#334155", marginBottom: "0.35rem" }}>
                      Sanctioned Outlay (₹) *
                    </label>
                    <input
                      type="number"
                      step="any"
                      required
                      value={sanctionAmount}
                      onChange={(e) => setSanctionAmount(e.target.value)}
                      placeholder="Amount in Rupees"
                      style={{
                        width: "100%",
                        padding: "0.55rem 0.75rem",
                        borderRadius: "8px",
                        border: "1px solid #cbd5e1",
                        fontSize: "0.85rem",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#334155", marginBottom: "0.35rem" }}>
                      Scrutiny & Technical Sanction Remarks
                    </label>
                    <textarea
                      rows={3}
                      value={sanctionRemarks}
                      onChange={(e) => setSanctionRemarks(e.target.value)}
                      placeholder="Enter technical scrutiny details or committee notes..."
                      style={{
                        width: "100%",
                        padding: "0.55rem 0.75rem",
                        borderRadius: "8px",
                        border: "1px solid #cbd5e1",
                        fontSize: "0.82rem",
                        boxSizing: "border-box",
                        resize: "vertical",
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1.5rem" }}>
                  <button
                    type="button"
                    onClick={() => setIsSanctionModalOpen(false)}
                    style={{
                      padding: "0.5rem 1rem",
                      borderRadius: "8px",
                      border: "1px solid #cbd5e1",
                      backgroundColor: "#ffffff",
                      color: "#475569",
                      fontSize: "0.82rem",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isActionSubmitting}
                    style={{
                      padding: "0.5rem 1.25rem",
                      borderRadius: "8px",
                      border: "none",
                      backgroundColor: isActionSubmitting ? "#94a3b8" : "#16a34a",
                      color: "#ffffff",
                      fontSize: "0.82rem",
                      fontWeight: 700,
                      cursor: isActionSubmitting ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.4rem",
                    }}
                  >
                    {isActionSubmitting ? "Issuing AS Order..." : "✓ Confirm & Issue AS Order"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── Rejection / Clarification Modal ── */}
        {isRejectModalOpen && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(15, 23, 42, 0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
              padding: "1rem",
              backdropFilter: "blur(2px)",
            }}
          >
            <div
              style={{
                backgroundColor: "#ffffff",
                borderRadius: "14px",
                width: "100%",
                maxWidth: "540px",
                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
                border: "1px solid #e2e8f0",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid #e2e8f0", backgroundColor: "#fff1f2", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: "#9f1239" }}>
                    Return / Reject Recommendation
                  </h3>
                  <p style={{ margin: "0.2rem 0 0", fontSize: "0.75rem", color: "#881337" }}>
                    Provide statutory justification for returning this recommendation to the Hon&apos;ble MP.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsRejectModalOpen(false)}
                  style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer", color: "#64748b" }}
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleRejectRecommendation} style={{ padding: "1.5rem" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#334155", marginBottom: "0.35rem" }}>
                      Select Preset Rationale
                    </label>
                    <div style={{ display: "flex", flexDirection: "column", gap: "0.35rem" }}>
                      {[
                        "Proposal requires revised cost estimate / detailed technical DPR from municipal engineer.",
                        "Proposed asset location conflicts with existing Master Plan / NHAI road widening.",
                        "Asset does not fall within eligible MPLADS Chapter 5 permissible work schedules.",
                        "Proposed site is private / disputed property and lacks title deed clearance.",
                      ].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setRejectionReason(preset)}
                          style={{
                            textAlign: "left",
                            padding: "0.35rem 0.6rem",
                            fontSize: "0.72rem",
                            borderRadius: "6px",
                            backgroundColor: rejectionReason === preset ? "#fee2e2" : "#f8fafc",
                            color: rejectionReason === preset ? "#991b1b" : "#475569",
                            border: "1px solid",
                            borderColor: rejectionReason === preset ? "#fca5a5" : "#e2e8f0",
                            cursor: "pointer",
                          }}
                        >
                          • {preset}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#334155", marginBottom: "0.35rem" }}>
                      Statutory Rejection Rationale *
                    </label>
                    <textarea
                      rows={4}
                      required
                      value={rejectionReason}
                      onChange={(e) => setRejectionReason(e.target.value)}
                      placeholder="State the formal reasons citing relevant MPLADS operational guidelines..."
                      style={{
                        width: "100%",
                        padding: "0.55rem 0.75rem",
                        borderRadius: "8px",
                        border: "1px solid #cbd5e1",
                        fontSize: "0.82rem",
                        boxSizing: "border-box",
                        resize: "vertical",
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1.5rem" }}>
                  <button
                    type="button"
                    onClick={() => setIsRejectModalOpen(false)}
                    style={{
                      padding: "0.5rem 1rem",
                      borderRadius: "8px",
                      border: "1px solid #cbd5e1",
                      backgroundColor: "#ffffff",
                      color: "#475569",
                      fontSize: "0.82rem",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isActionSubmitting || !rejectionReason.trim()}
                    style={{
                      padding: "0.5rem 1.25rem",
                      borderRadius: "8px",
                      border: "none",
                      backgroundColor: isActionSubmitting || !rejectionReason.trim() ? "#94a3b8" : "#dc2626",
                      color: "#ffffff",
                      fontSize: "0.82rem",
                      fontWeight: 700,
                      cursor: isActionSubmitting || !rejectionReason.trim() ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.4rem",
                    }}
                  >
                    {isActionSubmitting ? "Returning..." : "✕ Confirm Rejection / Return"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── Record Physical Progress Modal ── */}
        {isProgressModalOpen && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(15, 23, 42, 0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
              padding: "1rem",
              backdropFilter: "blur(2px)",
            }}
          >
            <div
              style={{
                backgroundColor: "#ffffff",
                borderRadius: "14px",
                width: "100%",
                maxWidth: "520px",
                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
                border: "1px solid #e2e8f0",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid #e2e8f0", backgroundColor: "#f0fdf4", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: "#166534" }}>
                    Record Physical Progress Update
                  </h3>
                  <p style={{ margin: "0.2rem 0 0", fontSize: "0.75rem", color: "#15803d" }}>
                    Update the executing civil milestone for {work.title}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsProgressModalOpen(false)}
                  style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer", color: "#64748b" }}
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleRecordProgress} style={{ padding: "1.5rem" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#334155", marginBottom: "0.35rem" }}>
                      Cumulative Physical Progress Percentage (%) *
                    </label>
                    <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                      <input
                        type="range"
                        min="0"
                        max="100"
                        step="1"
                        value={progressPct}
                        onChange={(e) => setProgressPct(e.target.value)}
                        style={{ flex: 1 }}
                      />
                      <div style={{ display: "flex", alignItems: "center", gap: "0.25rem" }}>
                        <input
                          type="number"
                          min="0"
                          max="100"
                          step="0.1"
                          required
                          value={progressPct}
                          onChange={(e) => setProgressPct(e.target.value)}
                          style={{
                            width: "70px",
                            padding: "0.45rem",
                            borderRadius: "6px",
                            border: "1px solid #cbd5e1",
                            fontSize: "0.9rem",
                            fontWeight: 700,
                            textAlign: "center",
                          }}
                        />
                        <span style={{ fontSize: "0.85rem", fontWeight: 700, color: "#64748b" }}>%</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#334155", marginBottom: "0.35rem" }}>
                      Milestone / Execution Description *
                    </label>
                    <textarea
                      rows={4}
                      required
                      value={progressDesc}
                      onChange={(e) => setProgressDesc(e.target.value)}
                      placeholder="Describe work completed at this milestone (e.g. Earthwork and foundation completed; masonry in progress)..."
                      style={{
                        width: "100%",
                        padding: "0.55rem 0.75rem",
                        borderRadius: "8px",
                        border: "1px solid #cbd5e1",
                        fontSize: "0.82rem",
                        boxSizing: "border-box",
                        resize: "vertical",
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1.5rem" }}>
                  <button
                    type="button"
                    onClick={() => setIsProgressModalOpen(false)}
                    style={{
                      padding: "0.5rem 1rem",
                      borderRadius: "8px",
                      border: "1px solid #cbd5e1",
                      backgroundColor: "#ffffff",
                      color: "#475569",
                      fontSize: "0.82rem",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isActionSubmitting || !progressDesc.trim()}
                    style={{
                      padding: "0.5rem 1.25rem",
                      borderRadius: "8px",
                      border: "none",
                      backgroundColor: isActionSubmitting || !progressDesc.trim() ? "#94a3b8" : "#16a34a",
                      color: "#ffffff",
                      fontSize: "0.82rem",
                      fontWeight: 700,
                      cursor: isActionSubmitting || !progressDesc.trim() ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.4rem",
                    }}
                  >
                    {isActionSubmitting ? "Recording..." : "✓ Submit Progress Update"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── Disburse Payment Tranche Modal ── */}
        {isPaymentModalOpen && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(15, 23, 42, 0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
              padding: "1rem",
              backdropFilter: "blur(2px)",
            }}
          >
            <div
              style={{
                backgroundColor: "#ffffff",
                borderRadius: "14px",
                width: "100%",
                maxWidth: "520px",
                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
                border: "1px solid #e2e8f0",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid #e2e8f0", backgroundColor: "#f0f9ff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: "#0369a1" }}>
                    Disburse Payment Tranche
                  </h3>
                  <p style={{ margin: "0.2rem 0 0", fontSize: "0.75rem", color: "#0284c7" }}>
                    Release funds to {work.implementing_agency || "executing agency"} under sanctioned outlay
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsPaymentModalOpen(false)}
                  style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer", color: "#64748b" }}
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleReleasePayment} style={{ padding: "1.5rem" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <div style={{ backgroundColor: "#f8fafc", padding: "0.75rem 1rem", borderRadius: "8px", border: "1px solid #e2e8f0", fontSize: "0.75rem", display: "flex", justifyContent: "space-between" }}>
                    <div>
                      <span style={{ color: "#64748b" }}>Sanctioned Outlay:</span>{" "}
                      <strong>{formatCurrency(work.sanctioned_amount)}</strong>
                    </div>
                    <div>
                      <span style={{ color: "#64748b" }}>Already Released:</span>{" "}
                      <strong style={{ color: "#16a34a" }}>{formatCurrency(work.funds_released)}</strong>
                    </div>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#334155", marginBottom: "0.35rem" }}>
                      Tranche Amount (₹) *
                    </label>
                    <input
                      type="number"
                      step="any"
                      min="1"
                      required
                      value={paymentAmount}
                      onChange={(e) => setPaymentAmount(e.target.value)}
                      placeholder="e.g. 500000"
                      style={{
                        width: "100%",
                        padding: "0.55rem 0.75rem",
                        borderRadius: "8px",
                        border: "1px solid #cbd5e1",
                        fontSize: "0.85rem",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#334155", marginBottom: "0.35rem" }}>
                      Purpose / Milestone Reference *
                    </label>
                    <input
                      type="text"
                      required
                      value={paymentPurpose}
                      onChange={(e) => setPaymentPurpose(e.target.value)}
                      placeholder="e.g. Tranche 2: Civil structural framework verification"
                      style={{
                        width: "100%",
                        padding: "0.55rem 0.75rem",
                        borderRadius: "8px",
                        border: "1px solid #cbd5e1",
                        fontSize: "0.85rem",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>
                </div>

                <div style={{ display: "flex", justifyContent: "flex-end", gap: "0.75rem", marginTop: "1.5rem" }}>
                  <button
                    type="button"
                    onClick={() => setIsPaymentModalOpen(false)}
                    style={{
                      padding: "0.5rem 1rem",
                      borderRadius: "8px",
                      border: "1px solid #cbd5e1",
                      backgroundColor: "#ffffff",
                      color: "#475569",
                      fontSize: "0.82rem",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isActionSubmitting || !paymentAmount}
                    style={{
                      padding: "0.5rem 1.25rem",
                      borderRadius: "8px",
                      border: "none",
                      backgroundColor: isActionSubmitting || !paymentAmount ? "#94a3b8" : "#0284c7",
                      color: "#ffffff",
                      fontSize: "0.82rem",
                      fontWeight: 700,
                      cursor: isActionSubmitting || !paymentAmount ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.4rem",
                    }}
                  >
                    {isActionSubmitting ? "Processing..." : "✓ Confirm Tranche Disbursement"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* ── Dispatch Field Inspection Modal ── */}
        {isInspectionModalOpen && (
          <div
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(15, 23, 42, 0.6)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              zIndex: 1000,
              padding: "1rem",
              backdropFilter: "blur(2px)",
            }}
          >
            <div
              style={{
                backgroundColor: "#ffffff",
                borderRadius: "14px",
                width: "100%",
                maxWidth: "520px",
                boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)",
                border: "1px solid #e2e8f0",
                overflow: "hidden",
              }}
            >
              <div style={{ padding: "1.25rem 1.5rem", borderBottom: "1px solid #e2e8f0", backgroundColor: "#faf5ff", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div>
                  <h3 style={{ margin: 0, fontSize: "1.05rem", fontWeight: 700, color: "#6b21a8" }}>
                    Dispatch Technical Field Inspection
                  </h3>
                  <p style={{ margin: "0.2rem 0 0", fontSize: "0.75rem", color: "#7e22ce" }}>
                    Assign on-site GPS geotagged photo inspection task to Field Inspector
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsInspectionModalOpen(false)}
                  style={{ background: "none", border: "none", fontSize: "1.2rem", cursor: "pointer", color: "#64748b" }}
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleDispatchInspection} style={{ padding: "1.5rem" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#334155", marginBottom: "0.35rem" }}>
                      Milestone Inspection Stage
                    </label>
                    <select
                      value={inspectionStage}
                      onChange={(e) => setInspectionStage(e.target.value)}
                      style={{
                        width: "100%",
                        padding: "0.5rem 0.75rem",
                        borderRadius: "8px",
                        border: "1px solid #cbd5e1",
                        fontSize: "0.85rem",
                        boxSizing: "border-box",
                      }}
                    >
                      <option value="site_clearance">Pre-commencement Site Clearance</option>
                      <option value="intermediate_progress">Intermediate Milestone Verification</option>
                      <option value="pre_final_completion">Pre-Final Quality Inspection</option>
                      <option value="final_completion">Final Completion & Handover Audit</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#334155", marginBottom: "0.35rem" }}>
                      Priority Level
                    </label>
                    <div style={{ display: "flex", gap: "1.5rem" }}>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", cursor: "pointer" }}>
                        <input
                          type="radio"
                          name="insp_priority"
                          value="routine"
                          checked={inspectionPriority === "routine"}
                          onChange={() => setInspectionPriority("routine")}
                        />
                        <span>Routine Audit (7 days SLA)</span>
                      </label>
                      <label style={{ display: "inline-flex", alignItems: "center", gap: "0.4rem", fontSize: "0.8rem", cursor: "pointer", color: "#b91c1c", fontWeight: 600 }}>
                        <input
                          type="radio"
                          name="insp_priority"
                          value="urgent"
                          checked={inspectionPriority === "urgent"}
                          onChange={() => setInspectionPriority("urgent")}
                        />
                        <span>Urgent Verification (48 hrs SLA)</span>
                      </label>
                    </div>
                  </div>

                  <div>
                    <label style={{ display: "block", fontSize: "0.75rem", fontWeight: 700, color: "#334155", marginBottom: "0.35rem" }}>
                      Technical Instructions & Field Checklist *
                    </label>
                    <textarea
                      rows={3}
                      required
                      value={inspectionInstructions}
                      onChange={(e) => setInspectionInstructions(e.target.value)}
                      placeholder="e.g. Verify quality of civil construction, take mandatory 4-angle geotagged photos, check boundary compliance."
                      style={{
                        width: "100%",
                        padding: "0.55rem 0.75rem",
                        borderRadius: "8px",
                        border: "1px solid #cbd5e1",
                        fontSize: "0.85rem",
                        boxSizing: "border-box",
                      }}
                    />
                  </div>

                  <div style={{ padding: "0.6rem 0.8rem", borderRadius: "8px", backgroundColor: "#faf5ff", border: "1px solid #e9d5ff", fontSize: "0.75rem", color: "#6b21a8" }}>
                    📸 The designated Field Inspector for this jurisdiction will receive an immediate real-time notification with mobile-friendly GPS evidence upload tasks.
                  </div>
                </div>

                <div style={{ marginTop: "1.25rem", display: "flex", justifyContent: "flex-end", gap: "0.5rem" }}>
                  <button
                    type="button"
                    onClick={() => setIsInspectionModalOpen(false)}
                    style={{
                      padding: "0.5rem 1rem",
                      borderRadius: "8px",
                      border: "1px solid #cbd5e1",
                      backgroundColor: "#ffffff",
                      color: "#475569",
                      fontSize: "0.82rem",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isActionSubmitting}
                    style={{
                      padding: "0.5rem 1.25rem",
                      borderRadius: "8px",
                      border: "none",
                      backgroundColor: isActionSubmitting ? "#94a3b8" : "#7e22ce",
                      color: "#ffffff",
                      fontSize: "0.82rem",
                      fontWeight: 700,
                      cursor: isActionSubmitting ? "not-allowed" : "pointer",
                      display: "flex",
                      alignItems: "center",
                      gap: "0.4rem",
                    }}
                  >
                    {isActionSubmitting ? "Dispatching..." : "✓ Dispatch Field Inspector"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        <div style={{ height: "3rem" }} />
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes shimmer { 0% { background-position: -200px 0; } 100% { background-position: 200px 0; } }
        button:hover { opacity: 0.85; }
      `}</style>
    </div>
  );
}

// ── Sub-Components ──────────────────────────────────────────────

function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} style={s.backBtn} title="Back to Works">
      ← Back
    </button>
  );
}

function RiskAlert({ score }: { score: RiskScore | null }) {
  if (!score) {
    return (
      <div style={s.riskEmpty}>
        No composite risk snapshot is available yet. Run the Phase 8 scoring workflow to create an explainable alert.
      </div>
    );
  }

  const tier = {
    green: { label: "Green", color: "#16a34a", bg: "#f0fdf4", border: "#bbf7d0" },
    amber: { label: "Amber", color: "#d97706", bg: "#fffbeb", border: "#fde68a" },
    red: { label: "Red", color: "#dc2626", bg: "#fef2f2", border: "#fecaca" },
  }[score.risk_tier];
  const factors = score.explanation_snapshot?.top_factors?.slice(0, 5) || score.top_factors.slice(0, 5);
  const references = supportingReferences(score.supporting_data);
  const predictionSource = predictionInferenceSource(score.supporting_data);

  return (
    <section style={{ ...s.riskAlert, borderColor: tier.border }} aria-label="Composite risk alert">
      <div style={s.riskAlertHeader}>
        <div>
          <div style={s.riskEyebrow}>Composite Risk Alert</div>
          <div style={s.riskScoreLine}>
            <span style={{ ...s.riskScoreNumber, color: tier.color }}>{score.composite_score.toFixed(1)}</span>
            <span style={s.riskScoreScale}>/ 100</span>
            <span style={{ ...s.riskTierBadge, color: tier.color, background: tier.bg, borderColor: tier.border }}>{tier.label}</span>
          </div>
        </div>
        <div style={s.riskMeta}>
          <span>Confidence {(score.confidence * 100).toFixed(0)}%</span>
          <span>Calculated {formatDateTime(score.calculated_at)}</span>
        </div>
      </div>

      <div style={s.riskMetricGrid}>
        <RiskMetric label="Delay probability" value={formatProbability(score.delay_probability)} />
        <RiskMetric label="Anomaly score" value={formatAnomalyScore(score.anomaly_score)} />
        <RiskMetric label="Rules triggered" value={String(score.triggered_rules.length)} />
        <RiskMetric label="Score version" value={`v${score.score_version}`} />
      </div>

      {predictionSource === "deterministic_heuristic_fallback" && (
        <p style={s.fallbackNotice}>
          Deterministic heuristic fallback in use — an approved ML artifact was unavailable for one or more signals.
        </p>
      )}

      <div style={s.riskDetailGrid}>
        <div>
          <h3 style={s.riskSectionTitle}>Top factors</h3>
          <ol style={s.factorList}>
            {factors.map((factor) => (
              <li key={`${factor.rank}-${factor.dimension}`} style={s.factorItem}>
                <span style={s.factorRank}>{factor.rank}</span>
                <span>{factor.factor}</span>
              </li>
            ))}
          </ol>
        </div>
        <div>
          <h3 style={s.riskSectionTitle}>Triggered rules</h3>
          {score.triggered_rules.length === 0 ? (
            <p style={s.riskMuted}>No compliance deviations were included in this snapshot.</p>
          ) : (
            <ul style={s.ruleList}>
              {score.triggered_rules.map((rule) => (
                <li key={rule.rule_code} style={s.ruleItem}>
                  <span style={s.ruleCode}>{rule.rule_code}</span>
                  <span>{rule.rule_name}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div style={s.actionBox}>
        <span style={s.actionLabel}>Recommended action</span>
        <span style={s.actionText}>{score.recommended_action}</span>
      </div>
      <div style={s.supportingData}>
        <span style={s.supportingLabel}>Supporting data references</span>
        <span>{references.join(" · ") || "No supporting data references recorded."}</span>
      </div>
      <p style={s.aiDisclaimer}>{score.ai_disclaimer}</p>
    </section>
  );
}

function RiskMetric({ label, value }: { label: string; value: string }) {
  return (
    <div style={s.riskMetric}>
      <span style={s.riskMetricLabel}>{label}</span>
      <span style={s.riskMetricValue}>{value}</span>
    </div>
  );
}

function formatProbability(value: number | null): string {
  return value === null ? "Placeholder — not available" : `${(value * 100).toFixed(1)}%`;
}

function formatAnomalyScore(value: number | null): string {
  return value === null ? "Placeholder — not available" : `${value.toFixed(1)} / 100`;
}

function predictionInferenceSource(data: Record<string, unknown>): string | null {
  const prediction = data.model_prediction as Record<string, unknown> | undefined;
  return typeof prediction?.inference_source === "string" ? prediction.inference_source : null;
}

function supportingReferences(data: Record<string, unknown>): string[] {
  const references: string[] = [];
  const work = data.work as Record<string, unknown> | undefined;
  if (work?.work_id) references.push(`Work: ${String(work.work_id)}`);

  const results = data.compliance_results;
  if (Array.isArray(results) && results.length) references.push(`${results.length} compliance result(s)`);

  const evidence = data.evidence as Record<string, unknown> | undefined;
  if (typeof evidence?.count === "number") references.push(`${evidence.count} evidence record(s)`);

  const duplicates = data.duplicate_candidates;
  if (Array.isArray(duplicates) && duplicates.length) references.push(`${duplicates.length} duplicate candidate(s)`);
  return references;
}

function MetricCard({
  label, value, sub, color, isProgress, pct,
}: {
  label: string; value: string; sub?: string; color: string; isProgress?: boolean; pct?: number;
}) {
  return (
    <div style={s.metricCard}>
      <div style={s.metricLabel}>{label}</div>
      <div style={{ ...s.metricValue, color }}>{value}</div>
      {isProgress && pct !== undefined && (
        <div style={s.metricProgressTrack}>
          <div style={{ ...s.metricProgressFill, width: `${Math.min(100, pct)}%`, background: color }} />
        </div>
      )}
      {sub && <div style={s.metricSub}>{sub}</div>}
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={s.fieldItem}>
      <div style={s.fieldLabel}>{label}</div>
      <div style={s.fieldValue}>{value || "—"}</div>
    </div>
  );
}

function FinBar({ label, amount, pct, color }: { label: string; amount: number; pct: number; color: string }) {
  return (
    <div style={s.finBarRow}>
      <div style={s.finBarLabel}>
        <span style={{ color }}>{label}</span>
        <span style={s.finBarAmount}>{formatCurrency(amount)}</span>
      </div>
      <div style={s.finBarTrack}>
        <div style={{ ...s.finBarFill, width: `${Math.min(100, pct)}%`, background: color }} />
      </div>
    </div>
  );
}

function PlaceholderSection({ icon, title, description }: { icon: string; title: string; description: string }) {
  return (
    <div style={s.placeholderCard}>
      <div style={s.phIcon}>{icon}</div>
      <h3 style={s.phTitle}>{title}</h3>
      <p style={s.phDesc}>{description}</p>
      <span style={s.phBadge}>Coming Soon</span>
    </div>
  );
}

function getEventColor(eventType: string): string {
  const colors: Record<string, string> = {
    status_change: "#6366f1",
    work_recommended: "#8b5cf6",
    work_updated: "#2563eb",
    payment_released: "#16a34a",
    progress_update: "#d97706",
    work_deleted: "#dc2626",
  };
  return colors[eventType] || "#64748b";
}

// ── Styles ──────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  pageWrap: {
    minHeight: "100vh",
    background: "#ffffff",
    padding: "1.5rem",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    display: "flex",
    justifyContent: "center",
  },
  content: {
    width: "100%",
    maxWidth: 1100,
  },
  centerCard: {
    width: "100%",
    maxWidth: 600,
    margin: "0 auto",
  },
  spinner: {
    width: 32,
    height: 32,
    border: "3px solid #e2e8f0",
    borderTopColor: "#2563eb",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
    margin: "40vh auto",
  },

  // Header
  headerRow: {
    display: "flex",
    alignItems: "flex-start",
    gap: "0.75rem",
    marginBottom: "1.25rem",
  },
  headerTop: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    flexWrap: "wrap" as const,
  },
  title: {
    margin: 0,
    fontSize: "1.35rem",
    fontWeight: 700,
    color: "#0f172a",
    lineHeight: 1.3,
  },
  statusBadge: {
    display: "inline-block",
    padding: "4px 12px",
    borderRadius: 20,
    fontSize: "0.75rem",
    fontWeight: 600,
    border: "1px solid",
    whiteSpace: "nowrap" as const,
  },
  headerMeta: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
    flexWrap: "wrap" as const,
    marginTop: "0.35rem",
    fontSize: "0.8rem",
    color: "#64748b",
  },
  workIdLabel: {
    fontFamily: "monospace",
    fontSize: "0.75rem",
    color: "#2563eb",
    fontWeight: 650,
  },
  metaSep: {
    color: "#94a3b8",
  },
  backBtn: {
    padding: "0.4rem 0.75rem",
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    background: "#f8fafc",
    color: "#334155",
    fontSize: "0.8rem",
    cursor: "pointer",
    transition: "all 0.2s",
    whiteSpace: "nowrap" as const,
    fontWeight: 600,
    marginTop: 2,
  },

  // Risk alert
  riskAlert: {
    marginBottom: "1.25rem",
    padding: "1.1rem",
    background: "#ffffff",
    border: "1px solid",
    borderRadius: 14,
    boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
  },
  riskEmpty: {
    marginBottom: "1.25rem",
    padding: "0.85rem 1rem",
    color: "#64748b",
    fontSize: "0.8rem",
    lineHeight: 1.5,
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
  },
  riskAlertHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "1rem",
    flexWrap: "wrap" as const,
  },
  riskEyebrow: {
    color: "#64748b",
    fontSize: "0.65rem",
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.07em",
    marginBottom: "0.2rem",
  },
  riskScoreLine: {
    display: "flex",
    alignItems: "baseline",
    gap: "0.4rem",
  },
  riskScoreNumber: {
    fontSize: "2rem",
    fontWeight: 800,
    fontVariantNumeric: "tabular-nums",
  },
  riskScoreScale: {
    color: "#64748b",
    fontSize: "0.85rem",
  },
  riskTierBadge: {
    marginLeft: "0.35rem",
    padding: "3px 10px",
    border: "1px solid",
    borderRadius: 20,
    fontSize: "0.7rem",
    fontWeight: 700,
    textTransform: "uppercase" as const,
  },
  riskMeta: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.25rem",
    color: "#64748b",
    fontSize: "0.7rem",
    textAlign: "right" as const,
  },
  riskMetricGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
    gap: "0.6rem",
    margin: "1rem 0",
  },
  riskMetric: {
    padding: "0.65rem 0.75rem",
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
  },
  riskMetricLabel: {
    display: "block",
    color: "#64748b",
    fontSize: "0.6rem",
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    marginBottom: "0.2rem",
  },
  riskMetricValue: {
    color: "#0f172a",
    fontSize: "0.8rem",
    fontWeight: 700,
  },
  riskDetailGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
    gap: "1rem",
    paddingTop: "0.25rem",
  },
  riskSectionTitle: {
    margin: "0 0 0.5rem",
    color: "#334155",
    fontSize: "0.75rem",
    fontWeight: 700,
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
  },
  factorList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.4rem",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  factorItem: {
    display: "flex",
    gap: "0.5rem",
    alignItems: "flex-start",
    color: "#334155",
    fontSize: "0.76rem",
    lineHeight: 1.45,
  },
  factorRank: {
    flex: "0 0 18px",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 18,
    borderRadius: "50%",
    color: "#2563eb",
    background: "#eff6ff",
    fontSize: "0.62rem",
    fontWeight: 700,
  },
  ruleList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.35rem",
    margin: 0,
    padding: 0,
    listStyle: "none",
  },
  ruleItem: {
    display: "flex",
    alignItems: "baseline",
    gap: "0.45rem",
    flexWrap: "wrap" as const,
    color: "#334155",
    fontSize: "0.76rem",
  },
  ruleCode: {
    color: "#b45309",
    fontFamily: "monospace",
    fontSize: "0.68rem",
    fontWeight: 600,
  },
  riskMuted: {
    margin: 0,
    color: "#64748b",
    fontSize: "0.76rem",
    fontStyle: "italic",
  },
  actionBox: {
    display: "flex",
    gap: "0.6rem",
    flexWrap: "wrap" as const,
    marginTop: "1rem",
    padding: "0.7rem 0.8rem",
    borderRadius: 8,
    color: "#1e3a8a",
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    fontSize: "0.76rem",
    lineHeight: 1.45,
  },
  actionLabel: {
    color: "#1d4ed8",
    fontWeight: 700,
  },
  actionText: {
    flex: 1,
  },
  supportingData: {
    display: "flex",
    gap: "0.45rem",
    flexWrap: "wrap" as const,
    marginTop: "0.7rem",
    color: "#64748b",
    fontSize: "0.7rem",
    lineHeight: 1.4,
  },
  supportingLabel: {
    color: "#475569",
    fontWeight: 700,
  },
  aiDisclaimer: {
    margin: "0.75rem 0 0",
    color: "#b45309",
    fontSize: "0.72rem",
    fontWeight: 600,
  },
  fallbackNotice: {
    margin: "0 0 0.85rem",
    padding: "0.55rem 0.65rem",
    color: "#92400e",
    background: "#fffbeb",
    border: "1px solid #fde68a",
    borderRadius: 7,
    fontSize: "0.72rem",
    lineHeight: 1.4,
  },

  // Metrics
  metricsRow: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))",
    gap: "0.75rem",
    marginBottom: "1.25rem",
  },
  metricCard: {
    padding: "1rem 1.15rem",
    background: "#ffffff",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
  },
  metricCardSk: {
    padding: "1rem 1.15rem",
    background: "#ffffff",
    borderRadius: 12,
    border: "1px solid #e2e8f0",
  },
  metricLabel: {
    fontSize: "0.7rem",
    fontWeight: 600,
    color: "#64748b",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    marginBottom: "0.35rem",
  },
  metricValue: {
    fontSize: "1.35rem",
    fontWeight: 700,
  },
  metricSub: {
    fontSize: "0.7rem",
    color: "#64748b",
    marginTop: "0.25rem",
  },
  metricProgressTrack: {
    height: 5,
    borderRadius: 3,
    background: "#e2e8f0",
    overflow: "hidden",
    marginTop: "0.5rem",
  },
  metricProgressFill: {
    height: "100%",
    borderRadius: 3,
    transition: "width 0.5s ease",
  },

  // Cards
  card: {
    background: "#ffffff",
    borderRadius: 14,
    border: "1px solid #e2e8f0",
    padding: "1.25rem",
    marginBottom: "1rem",
    boxShadow: "0 1px 3px rgba(0,0,0,0.03)",
  },
  cardTitle: {
    margin: "0 0 1rem",
    fontSize: "0.95rem",
    fontWeight: 700,
    color: "#0f172a",
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  countBadge: {
    fontSize: "0.65rem",
    fontWeight: 600,
    color: "#2563eb",
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    padding: "1px 8px",
    borderRadius: 10,
  },
  descText: {
    fontSize: "0.85rem",
    color: "#334155",
    lineHeight: 1.6,
    marginBottom: "1rem",
    margin: "0 0 1rem",
  },

  // Grid
  grid2: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
    gap: "1rem",
    marginBottom: "1rem",
  },
  evidenceCard: {
    width: "100%",
    padding: "1.25rem",
    textAlign: "left" as const,
    cursor: "pointer",
    background: "#f0fdfa",
    border: "1px solid #99f6e4",
    borderRadius: 10,
  },
  evidenceBadge: {
    display: "inline-block",
    marginTop: "0.35rem",
    padding: "0.22rem 0.5rem",
    borderRadius: 5,
    color: "#0f766e",
    background: "#ccfbf1",
    fontSize: "0.67rem",
    fontWeight: 700,
  },

  // Field grid
  fieldGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "0.75rem",
  },
  fieldItem: {},
  fieldLabel: {
    fontSize: "0.65rem",
    fontWeight: 600,
    color: "#64748b",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    marginBottom: "0.15rem",
  },
  fieldValue: {
    fontSize: "0.85rem",
    color: "#0f172a",
    fontWeight: 500,
  },

  // Financial bars
  finBarWrap: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "1rem",
  },
  finBarRow: {},
  finBarLabel: {
    display: "flex",
    justifyContent: "space-between",
    marginBottom: "0.35rem",
    fontSize: "0.8rem",
    fontWeight: 600,
  },
  finBarAmount: {
    color: "#475569",
    fontWeight: 500,
    fontVariantNumeric: "tabular-nums",
  },
  finBarTrack: {
    height: 10,
    borderRadius: 5,
    background: "#f1f5f9",
    overflow: "hidden",
  },
  finBarFill: {
    height: "100%",
    borderRadius: 5,
    transition: "width 0.6s ease",
  },

  // Map
  mapArea: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "1rem",
    background: "#f8fafc",
    borderRadius: 10,
    border: "1px solid #e2e8f0",
  },
  mapPin: {
    fontSize: "1.5rem",
  },
  mapCoords: {
    fontSize: "0.9rem",
    fontWeight: 600,
    color: "#0f172a",
    fontFamily: "monospace",
  },
  mapAddr: {
    fontSize: "0.8rem",
    color: "#64748b",
    marginTop: "0.15rem",
  },

  // Table (payment tranches)
  tableWrap: {
    overflowX: "auto" as const,
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
  },
  th: {
    padding: "0.6rem 0.75rem",
    textAlign: "left" as const,
    fontSize: "0.65rem",
    fontWeight: 600,
    color: "#475569",
    textTransform: "uppercase" as const,
    letterSpacing: "0.04em",
    borderBottom: "1px solid #e2e8f0",
    background: "#f8fafc",
  },
  tRow: {
    borderBottom: "1px solid #e2e8f0",
  },
  td: {
    padding: "0.6rem 0.75rem",
    fontSize: "0.8rem",
    color: "#1e293b",
    verticalAlign: "middle" as const,
  },

  // Timeline
  timelineList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0",
    position: "relative" as const,
  },
  timelineItem: {
    display: "flex",
    gap: "0.75rem",
    paddingBottom: "1.25rem",
    position: "relative" as const,
  },
  tlDot: {
    width: 24,
    minWidth: 24,
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    paddingTop: 3,
  },
  tlDotInner: {
    width: 10,
    height: 10,
    borderRadius: "50%",
    boxShadow: "0 0 4px rgba(0,0,0,0.1)",
  },
  tlContent: {
    flex: 1,
    paddingBottom: "0.25rem",
    borderLeft: "2px solid #e2e8f0",
    paddingLeft: "0.75rem",
    marginLeft: -12,
  },
  tlHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    gap: "0.5rem",
    flexWrap: "wrap" as const,
    marginBottom: "0.25rem",
  },
  tlProgress: {
    fontSize: "1rem",
    fontWeight: 700,
  },
  tlDate: {
    fontSize: "0.7rem",
    color: "#64748b",
  },
  tlDesc: {
    fontSize: "0.8rem",
    color: "#334155",
    margin: "0 0 0.2rem",
    lineHeight: 1.5,
  },
  tlMeta: {
    fontSize: "0.7rem",
    color: "#64748b",
  },

  // Audit list
  auditList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.5rem",
  },
  auditRow: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
    padding: "0.5rem 0.75rem",
    borderRadius: 8,
    background: "#f8fafc",
    border: "1px solid #e2e8f0",
    flexWrap: "wrap" as const,
  },
  auditType: {
    fontSize: "0.65rem",
    fontWeight: 600,
    color: "#2563eb",
    background: "#eff6ff",
    padding: "2px 8px",
    borderRadius: 4,
    textTransform: "uppercase" as const,
    whiteSpace: "nowrap" as const,
  },
  auditTitle: {
    flex: 1,
    fontSize: "0.8rem",
    color: "#1e293b",
    minWidth: 120,
    fontWeight: 500,
  },
  auditActor: {
    fontSize: "0.75rem",
    color: "#64748b",
  },
  auditTime: {
    fontSize: "0.7rem",
    color: "#94a3b8",
    whiteSpace: "nowrap" as const,
  },

  // Placeholder sections
  placeholderCard: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    justifyContent: "center",
    padding: "2rem 1.5rem",
    background: "#f8fafc",
    borderRadius: 14,
    border: "1px dashed #cbd5e1",
    textAlign: "center" as const,
  },
  phIcon: {
    fontSize: "2rem",
    marginBottom: "0.5rem",
  },
  phTitle: {
    margin: "0 0 0.4rem",
    fontSize: "0.95rem",
    fontWeight: 700,
    color: "#334155",
  },
  phDesc: {
    margin: 0,
    fontSize: "0.8rem",
    color: "#64748b",
    lineHeight: 1.5,
    maxWidth: 280,
  },
  phBadge: {
    marginTop: "0.75rem",
    fontSize: "0.65rem",
    fontWeight: 600,
    color: "#2563eb",
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    padding: "2px 10px",
    borderRadius: 10,
    textTransform: "uppercase" as const,
  },

  // States
  stateBox: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    padding: "4rem 2rem",
    background: "#ffffff",
    borderRadius: 16,
    border: "1px solid #e2e8f0",
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
    marginTop: "1rem",
  },
  stateIcon: {
    fontSize: "2.5rem",
    marginBottom: "1rem",
  },
  stateTitle: {
    fontSize: "1.15rem",
    fontWeight: 700,
    color: "#0f172a",
    margin: "0 0 0.5rem",
  },
  stateDesc: {
    fontSize: "0.85rem",
    color: "#64748b",
    textAlign: "center" as const,
    maxWidth: 400,
    lineHeight: 1.5,
    margin: 0,
  },
  retryBtn: {
    marginTop: "1rem",
    padding: "0.6rem 1.5rem",
    background: "#2563eb",
    border: "1px solid #2563eb",
    borderRadius: 8,
    color: "#ffffff",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s",
  },
  emptyText: {
    fontSize: "0.8rem",
    color: "#64748b",
    fontStyle: "italic",
    margin: 0,
  },

  // Skeleton
  skeletonHeader: {
    marginBottom: "1.5rem",
  },
  skBar: {
    height: 14,
    borderRadius: 4,
    background: "linear-gradient(90deg, #f1f5f9 0%, #e2e8f0 50%, #f1f5f9 100%)",
    backgroundSize: "400px 100%",
    animation: "shimmer 1.5s infinite",
  },
};
