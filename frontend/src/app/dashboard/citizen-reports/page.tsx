"use client";

import { useAuth } from "@/lib/auth";
import {
  CitizenIssueStatus,
  CitizenModerationList,
  CitizenModerationReport,
  CitizenEvidenceItem,
  formatDateTime,
} from "@/lib/api";
import { ExportReportButton, ExportDataPayload } from "@/components/reports/export-report-button";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useState } from "react";
import {
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Camera,
  CheckCircle2,
  ExternalLink,
  Eye,
  FileText,
  Lock,
  UserCheck,
  X,
  Maximize2,
  Building2,
  MapPin,
  Clock,
  Send,
  Zap,
} from "lucide-react";

const API = "/api/v1/citizen-reports";
const WRITERS = new Set(["district_authority", "admin"]);
const AUTHORIZED_ROLES = new Set(["district_authority", "state_nodal_officer", "inspector", "admin", "mospi"]);

const NEXT: Record<CitizenIssueStatus, CitizenIssueStatus[]> = {
  received: ["under_review", "closed"],
  under_review: ["inspection_assigned", "resolved", "closed"],
  inspection_assigned: ["under_review", "resolved", "closed"],
  resolved: [],
  closed: [],
};

interface InspectorOption {
  user_id: string;
  full_name: string;
  username: string;
  email: string;
  district_code?: string;
  state_code?: string;
}

// Protected Image component for District Authority
function ProtectedCitizenImage({
  url,
  alt,
  onClick,
}: {
  url: string;
  alt: string;
  onClick?: () => void;
}) {
  const { fetchWithAuth } = useAuth();
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    async function load() {
      try {
        setLoading(true);
        const res = await fetchWithAuth(url);
        if (!res.ok) throw new Error("Failed to load photo");
        const blob = await res.blob();
        if (active) {
          objectUrl = URL.createObjectURL(blob);
          setSrc(objectUrl);
        }
      } catch {
        if (active) setErr(true);
      } finally {
        if (active) setLoading(false);
      }
    }
    void load();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, fetchWithAuth]);

  if (loading) {
    return (
      <div style={s.photoPlaceholder}>
        <div style={s.spinnerSm} />
        <span style={{ fontSize: ".7rem", color: "#64748b" }}>Loading secure evidence…</span>
      </div>
    );
  }

  if (err || !src) {
    return (
      <div style={s.photoError}>
        <AlertTriangle size={16} color="#ef4444" />
        <span style={{ fontSize: ".7rem", color: "#991b1b" }}>Evidence unavailable or restricted</span>
      </div>
    );
  }

  return (
    <div style={s.photoWrapper} onClick={onClick}>
      <img src={src} alt={alt} style={s.photoThumb} />
      <div style={s.photoOverlay}>
        <Maximize2 size={16} color="#ffffff" />
        <span style={{ color: "#ffffff", fontSize: ".68rem", fontWeight: 600 }}>Enlarge</span>
      </div>
    </div>
  );
}

export default function CitizenReportsPage() {
  const { user, fetchWithAuth, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const [reports, setReports] = useState<CitizenModerationReport[]>([]);
  const [selected, setSelected] = useState<CitizenModerationReport | null>(null);
  const [filter, setFilter] = useState<"" | CitizenIssueStatus>("");

  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Moderation state
  const [status, setStatus] = useState<CitizenIssueStatus>("under_review");
  const [publicMessage, setPublicMessage] = useState("");
  const [reason, setReason] = useState("");
  const [inspector, setInspector] = useState("");

  // Available inspectors list for district assignment
  const [inspectors, setInspectors] = useState<InspectorOption[]>([]);
  const [loadingInspectors, setLoadingInspectors] = useState(false);

  // Lightbox modal for photo viewing
  const [lightboxPhoto, setLightboxPhoto] = useState<{ url: string; item: CitizenEvidenceItem } | null>(null);

  // Escalate to Case modal state
  const [showEscalateModal, setShowEscalateModal] = useState(false);
  const [caseTitle, setCaseTitle] = useState("");
  const [caseSeverity, setCaseSeverity] = useState<"low" | "medium" | "high" | "critical">("medium");
  const [caseInspector, setCaseInspector] = useState("");
  const [caseNotes, setCaseNotes] = useState("");
  const [escalating, setEscalating] = useState(false);

  const isAdmin = user?.role === "admin";
  const isDistrictAuthority = user?.role === "district_authority";
  const isStateNodalOfficer = user?.role === "state_nodal_officer";
  const isInspector = user?.role === "inspector";
  const isMospi = user?.role === "mospi";
  const canWrite = Boolean(user && WRITERS.has(user.role));
  const isAuthorized = Boolean(user && AUTHORIZED_ROLES.has(user.role));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetchWithAuth(
        `${API}?page=1&page_size=100${filter ? `&status=${filter}` : ""}`
      );
      if (response.status === 403) {
        setError("PERMISSION_DENIED");
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({
          detail: "Could not load citizen reports.",
        }));
        throw new Error(body.detail || "Could not load citizen reports.");
      }
      const payload: CitizenModerationList = await response.json();
      setReports(payload.reports);
      setSelected((current) =>
        current
          ? payload.reports.find(
              (report) => report.reference_id === current.reference_id
            ) || payload.reports[0] || null
          : payload.reports[0] || null
      );
    } catch (cause: unknown) {
      setError(
        cause instanceof Error ? cause.message : "Could not load citizen reports."
      );
    } finally {
      setLoading(false);
    }
  }, [fetchWithAuth, filter]);

  // Fetch available district inspectors
  const loadInspectors = useCallback(async () => {
    setLoadingInspectors(true);
    try {
      const res = await fetchWithAuth(`${API}/inspectors`);
      if (res.ok) {
        const data: InspectorOption[] = await res.json();
        setInspectors(data || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingInspectors(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    if (authLoading || !user) return;
    const timer = window.setTimeout(() => {
      void load();
      if (canWrite) {
        void loadInspectors();
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, canWrite, load, loadInspectors, user]);

  function choose(report: CitizenModerationReport) {
    setSelected(report);
    const availableNext = NEXT[report.status];
    if (availableNext && availableNext.length > 0) {
      setStatus(availableNext[0]);
    }
    setPublicMessage("");
    setReason("");
    setInspector(report.assigned_inspector_id || "");
    setNotice(null);
  }

  async function moderate() {
    if (!selected) return;
    setPending(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetchWithAuth(
        `${API}/${encodeURIComponent(selected.reference_id)}/status`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            status,
            public_status_message: publicMessage,
            reason,
            assigned_inspector_id: status === "inspection_assigned" ? inspector : null,
          }),
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({
          detail: "Could not update report moderation.",
        }));
        throw new Error(body.detail || "Could not update report moderation.");
      }
      const updated: CitizenModerationReport = await response.json();
      setSelected(updated);
      setNotice("Report status and moderation updated successfully.");
      await load();
    } catch (cause: unknown) {
      setError(
        cause instanceof Error ? cause.message : "Could not update report moderation."
      );
    } finally {
      setPending(false);
    }
  }

  function openEscalateModal() {
    if (!selected) return;
    setCaseTitle(`Field Investigation: ${selected.work_title} (${selected.issue_type.replaceAll("_", " ")})`);
    setCaseSeverity("medium");
    setCaseInspector(selected.assigned_inspector_id || "");
    setCaseNotes(`Citizen complaint regarding ${selected.issue_type.replaceAll("_", " ")}. Description: ${selected.description}`);
    setShowEscalateModal(true);
  }

  async function handleEscalateToCase() {
    if (!selected) return;
    setEscalating(true);
    setError(null);
    try {
      const response = await fetchWithAuth(
        `${API}/${encodeURIComponent(selected.reference_id)}/create-case`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: caseTitle,
            severity: caseSeverity,
            assigned_inspector_id: caseInspector || null,
            case_notes: caseNotes,
          }),
        }
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({
          detail: "Could not escalate citizen report to official case.",
        }));
        throw new Error(body.detail || "Could not escalate citizen report to official case.");
      }
      const resData = await response.json();
      setShowEscalateModal(false);
      setNotice(`Successfully escalated to official Case (${resData.case_id.slice(0, 8)}).`);
      await load();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Escalation failed");
    } finally {
      setEscalating(false);
    }
  }

  // Generate data for ExportReportButton
  const getExportData = (): ExportDataPayload => {
    return {
      report: {
        title: "Citizen Social-Audit Moderation Queue",
        subtitle: `Authorized Scope: ${user?.full_name || user?.username} (${user?.role}) · ${reports.length} report(s) in jurisdiction`,
        metadata: [
          { label: "Authorized User", value: user?.full_name || user?.username || "Official" },
          { label: "Role", value: user?.role || "Unknown" },
          { label: "Generated On", value: new Date().toLocaleString("en-IN") },
          { label: "Total Reports", value: String(reports.length) },
        ],
        sections: [
          {
            title: "Citizen Raised Grievances & Moderation Audit",
            type: "table",
            headers: [
              "Reference ID",
              "Work ID",
              "Work Title",
              "Issue Type",
              "Status",
              "Photos",
              "GPS Consent",
              "Assigned Inspector",
              "Last Updated",
            ],
            rows: reports.map((r) => [
              r.reference_id,
              r.work_id,
              r.work_title,
              r.issue_type.replaceAll("_", " "),
              r.status.replaceAll("_", " "),
              r.evidence_count,
              r.location_consent && r.latitude !== null
                ? `${r.latitude.toFixed(4)}, ${r.longitude?.toFixed(4)}`
                : "No",
              r.assigned_inspector_id || "Unassigned",
              formatDateTime(r.updated_at),
            ]),
          },
        ],
      },
      csv: {
        headers: [
          "Reference ID",
          "Work ID",
          "Work Title",
          "Issue Type",
          "Status",
          "Evidence Count",
          "Location Consent",
          "Latitude",
          "Longitude",
          "Assigned Inspector",
          "Public Message",
          "Moderation Reason",
          "Linked Case ID",
          "Updated At",
        ],
        rows: reports.map((r) => [
          r.reference_id,
          r.work_id,
          r.work_title,
          r.issue_type,
          r.status,
          r.evidence_count,
          r.location_consent ? "Yes" : "No",
          r.latitude || "",
          r.longitude || "",
          r.assigned_inspector_id || "",
          r.public_status_message || "",
          r.moderation_reason || "",
          r.linked_case_id || "",
          r.updated_at,
        ]),
      },
      json: reports,
    };
  };

  if (authLoading || loading) {
    return (
      <main style={s.page}>
        <div style={s.spinner} />
        <style>{`@keyframes citizen-moderation-spin{to{transform:rotate(360deg)}}`}</style>
      </main>
    );
  }

  if (!user || !isAuthorized || error === "PERMISSION_DENIED") {
    return (
      <main style={s.page}>
        <div style={s.container}>
          <button onClick={() => router.push("/dashboard")} style={s.back}>
            ← Back to Dashboard
          </button>
          <div style={s.accessDeniedCard}>
            <ShieldAlert size={48} color="#dc2626" style={{ margin: "0 auto .8rem" }} />
            <h2 style={{ margin: 0, color: "#991b1b", fontSize: "1.2rem", fontWeight: 700 }}>
              Access Restricted: Dignified Authorities Only
            </h2>
            <p style={{ margin: ".6rem 0", color: "#64748b", fontSize: ".82rem", lineHeight: 1.5 }}>
              Citizen social-audit grievances are protected under MoSPI citizen safeguards.
              Access to moderation queues is strictly limited to:
            </p>
            <div style={s.roleList}>
              <div style={s.roleItem}>🏛️ <strong>State Nodal Officers:</strong> State-wide grievance oversight</div>
              <div style={s.roleItem}>📍 <strong>District Authorities:</strong> District moderation & photo access</div>
              <div style={s.roleItem}>🔍 <strong>Field Inspectors:</strong> Only reports specifically assigned to you</div>
            </div>
            <p style={{ margin: ".8rem 0 0", color: "#94a3b8", fontSize: ".75rem" }}>
              Your current role: <strong>{user?.role || "Unauthenticated"}</strong>
            </p>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main style={s.page}>
      <div style={s.container}>
        {/* Top Header */}
        <header style={s.header}>
          <div>
            <button onClick={() => router.push("/dashboard")} style={s.back}>
              ← Back to Dashboard
            </button>
            <p style={s.eyebrow}>MoSPI Citizen Grievance & Social-Audit System</p>
            <h1 style={s.title}>Citizen Moderation Queue</h1>
            <p style={s.subtitle}>
              Review citizen ground concerns, verify site progress defects, and dispatch district field inspectors.
            </p>
          </div>
          <div style={{ display: "flex", gap: ".6rem", alignItems: "center" }}>
            <ExportReportButton
              label="Export Report"
              filename="citizen_moderation_queue"
              getReportData={getExportData}
              variant="outline"
              size="sm"
            />
            <button onClick={() => void load()} style={s.refresh}>
              Refresh Queue
            </button>
          </div>
        </header>

        {/* Dignified Authority Role Scoping Banners */}
        {isStateNodalOfficer && (
          <div style={s.snoBanner}>
            <div style={{ display: "flex", alignItems: "center", gap: ".45rem" }}>
              <Building2 size={18} color="#1d4ed8" />
              <div style={s.badgeLabel}>STATE NODAL OFFICER · STATE-WIDE OVERSIGHT MODE</div>
            </div>
            <p style={s.bannerText}>
              You have jurisdiction-wide oversight across <strong>{user.jurisdiction.state_code || "State Scope"}</strong>.
              Under MoSPI citizen privacy rules, <strong>citizen-uploaded photo evidence is confidential and redacted</strong>.
              Defect moderation and inspector dispatch are managed by the respective District Authority.
            </p>
          </div>
        )}

        {isDistrictAuthority && (
          <div style={s.daBanner}>
            <div style={{ display: "flex", alignItems: "center", gap: ".45rem" }}>
              <ShieldCheck size={18} color="#15803d" />
              <div style={s.badgeLabelGreen}>DISTRICT AUTHORITY · FULL MODERATION, EVIDENCE & CASE DISPATCH</div>
            </div>
            <p style={s.bannerTextGreen}>
              District Jurisdiction: <strong>{user.jurisdiction.district_code || "All Districts"}</strong>.
              You have senior clearance to review raw citizen grievance descriptions, <strong>inspect uploaded photo evidence</strong>,
              dispatch field inspectors, and escalate complaints to official Case Management.
            </p>
          </div>
        )}

        {isAdmin && (
          <div style={{ ...s.daBanner, borderColor: "#cbd5e1", background: "#f8fafc" }}>
            <div style={{ display: "flex", alignItems: "center", gap: ".45rem" }}>
              <ShieldCheck size={18} color="#0f172a" />
              <div style={{ ...s.badgeLabel, color: "#0f172a" }}>SYSTEM ADMINISTRATION · FULL MODERATION & DISPATCH CLEARANCE</div>
            </div>
            <p style={{ ...s.bannerText, color: "#334155" }}>
              You have senior administrative clearance across all jurisdictions. You can review citizen grievances, inspect uploaded evidence photos, moderate statuses, dispatch field inspectors, and escalate complaints to official cases.
            </p>
          </div>
        )}

        {isMospi && (
          <div style={{ ...s.snoBanner, borderColor: "#cbd5e1", background: "#f8fafc" }}>
            <div style={{ display: "flex", alignItems: "center", gap: ".45rem" }}>
              <Building2 size={18} color="#1d4ed8" />
              <div style={s.badgeLabel}>MOSPI · NATIONAL PROGRAMME OVERSIGHT</div>
            </div>
            <p style={s.bannerText}>
              You have national-level oversight of citizen social-audit trends across all states. Under MoSPI safeguards, raw citizen-uploaded photos are confidential.
            </p>
          </div>
        )}

        {isInspector && (
          <div style={s.inspBanner}>
            <div style={{ display: "flex", alignItems: "center", gap: ".45rem" }}>
              <UserCheck size={18} color="#b45309" />
              <div style={s.badgeLabelAmber}>FIELD INSPECTOR · ASSIGNED VERIFICATION WORKFLOW</div>
            </div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: ".5rem" }}>
              <p style={s.bannerTextAmber}>
                You are viewing citizen grievances <strong>specifically assigned to you</strong> for site inspection.
                Raw citizen images are held by the District Authority under whistleblower privacy safeguards.
              </p>
              <button
                onClick={() => router.push("/dashboard/field-inspections")}
                style={s.inspectorActionBtn}
              >
                Go to Field Inspections Survey →
              </button>
            </div>
          </div>
        )}

        {notice && (
          <div style={s.notice}>
            <CheckCircle2 size={16} color="#166534" />
            <span>{notice}</span>
          </div>
        )}
        {error && (
          <div style={s.error}>
            <AlertTriangle size={16} color="#991b1b" />
            <span>{error}</span>
          </div>
        )}

        {/* Filter bar */}
        <section style={s.filter}>
          <label style={{ display: "flex", alignItems: "center", gap: ".5rem" }}>
            <span style={{ fontWeight: 600 }}>Filter Status:</span>
            <select
              value={filter}
              onChange={(event) =>
                setFilter(event.target.value as "" | CitizenIssueStatus)
              }
              style={s.select}
            >
              <option value="">All statuses ({reports.length})</option>
              {[
                "received",
                "under_review",
                "inspection_assigned",
                "resolved",
                "closed",
              ].map((item) => (
                <option key={item} value={item}>
                  {item.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <div style={{ display: "flex", gap: ".5rem", alignItems: "center" }}>
            <span style={s.countPill}>
              {reports.length} report(s) in your authorized scope
            </span>
          </div>
        </section>

        {/* Grid: List + Detail */}
        <section style={s.grid}>
          {/* Left Column: List */}
          <section style={s.list}>
            {reports.length ? (
              reports.map((report) => {
                const isSelected = selected?.reference_id === report.reference_id;
                return (
                  <button
                    key={report.reference_id}
                    onClick={() => choose(report)}
                    style={{
                      ...s.report,
                      ...(isSelected ? s.selected : {}),
                    }}
                  >
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span
                        style={{
                          ...s.statusBadge,
                          backgroundColor:
                            report.status === "resolved"
                              ? "#ecfdf5"
                              : report.status === "inspection_assigned"
                              ? "#eff6ff"
                              : report.status === "under_review"
                              ? "#fef3c7"
                              : "#f1f5f9",
                          color:
                            report.status === "resolved"
                              ? "#15803d"
                              : report.status === "inspection_assigned"
                              ? "#1d4ed8"
                              : report.status === "under_review"
                              ? "#b45309"
                              : "#475569",
                          border:
                            report.status === "resolved"
                              ? "1px solid #bbf7d0"
                              : report.status === "inspection_assigned"
                              ? "1px solid #bfdbfe"
                              : report.status === "under_review"
                              ? "1px solid #fde68a"
                              : "1px solid #cbd5e1",
                        }}
                      >
                        {report.status.replaceAll("_", " ")}
                      </span>
                      <span style={{ fontSize: ".65rem", color: "#64748b" }}>
                        {formatDateTime(report.updated_at)}
                      </span>
                    </div>
                    <strong style={s.reportWorkTitle}>{report.work_title}</strong>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ color: "#64748b", fontSize: ".7rem" }}>
                        Ref: <span style={{ fontFamily: "monospace", color: "#0f172a", fontWeight: 600 }}>{report.reference_id}</span>
                      </span>
                      <div style={{ display: "flex", gap: ".35rem" }}>
                        {report.evidence_count > 0 && (
                          <span style={s.pillPhoto}>
                            📷 {report.evidence_count}
                          </span>
                        )}
                        {report.linked_case_id && (
                          <span style={s.pillCase}>
                            ⚡ Case
                          </span>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })
            ) : (
              <State
                title="No citizen reports found"
                detail="No citizen social-audit submissions match your jurisdiction or filter criteria."
              />
            )}
          </section>

          {/* Right Column: Detail & Moderation */}
          <aside style={s.detail}>
            {selected ? (
              <>
                {/* Detail Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: ".8rem" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: ".45rem" }}>
                      <h2 style={s.sectionTitle}>{selected.reference_id}</h2>
                      <span style={s.tagBadge}>MoSPI Citizen Grievance</span>
                    </div>
                    <p style={{ margin: ".2rem 0 0", color: "#16a34a", fontSize: ".74rem", fontWeight: 600 }}>
                      Current Status: {selected.status.replaceAll("_", " ").toUpperCase()}
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: ".4rem", alignItems: "center" }}>
                    {/* Escalate to Case button for District Authority */}
                    {canWrite && !selected.linked_case_id && (
                      <button onClick={openEscalateModal} style={s.escalateBtn}>
                        <Zap size={13} />
                        <span>Escalate to Case</span>
                      </button>
                    )}
                    {selected.linked_case_id && (
                      <button
                        onClick={() => router.push("/dashboard/cases")}
                        style={s.linkedCaseBtn}
                      >
                        <ExternalLink size={13} />
                        <span>Case {selected.linked_case_id.slice(0, 8)}</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Citizen Description Card */}
                <div style={s.detailSection}>
                  <strong style={s.detailLabel}>Citizen Ground Complaint & Description</strong>
                  <div style={s.reportDescription}>
                    <p style={{ margin: 0, fontSize: ".82rem", lineHeight: 1.5 }}>
                      {selected.description}
                    </p>
                  </div>
                </div>

                {/* Project & Location Metadata */}
                <div style={s.metaGrid}>
                  <div>
                    <strong style={s.detailLabel}>Work Project</strong>
                    <p style={s.metaValue}>
                      <strong>{selected.work_title}</strong>
                      <br />
                      <span style={{ fontSize: ".7rem", color: "#64748b" }}>ID: {selected.work_id}</span>
                    </p>
                  </div>
                  <div>
                    <strong style={s.detailLabel}>Consented GPS Location</strong>
                    <p style={s.metaValue}>
                      {selected.location_consent && selected.latitude !== null
                        ? `📍 ${selected.latitude.toFixed(5)}, ${selected.longitude?.toFixed(5)}`
                        : "Location consent not provided"}
                    </p>
                  </div>
                  <div>
                    <strong style={s.detailLabel}>Assigned Field Inspector</strong>
                    <p style={s.metaValue}>
                      {selected.assigned_inspector_id ? (
                        <span style={{ color: "#1d4ed8", fontWeight: 600 }}>
                          👤 {inspectors.find((i) => i.user_id === selected.assigned_inspector_id)?.full_name ||
                            selected.assigned_inspector_id}
                        </span>
                      ) : (
                        <span style={{ color: "#94a3b8" }}>No inspector assigned</span>
                      )}
                    </p>
                  </div>
                  <div>
                    <strong style={s.detailLabel}>Public Status Notice</strong>
                    <p style={s.metaValue}>{selected.public_status_message || "Standard tracking message"}</p>
                  </div>
                </div>

                {/* Citizen Photo Evidence Section (District Authority vs State Nodal vs Inspector) */}
                <div style={s.evidenceContainer}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: ".45rem" }}>
                    <strong style={s.detailLabel}>Citizen Uploaded Photo Evidence</strong>
                    <span style={s.evidenceCountBadge}>
                      {selected.evidence_count} Attachment(s)
                    </span>
                  </div>

                  {/* Case 1: District Authority can see photos */}
                  {selected.can_view_images ? (
                    selected.evidence_items && selected.evidence_items.length > 0 ? (
                      <div>
                        <div style={s.photoSecurityNotice}>
                          <ShieldCheck size={14} color="#15803d" />
                          <span>Official District Authority Clearance: Ground evidence decrypted.</span>
                        </div>
                        <div style={s.photoGrid}>
                          {selected.evidence_items.map((item, idx) => (
                            <div key={item.evidence_id || idx} style={s.photoCard}>
                              {item.url ? (
                                <ProtectedCitizenImage
                                  url={item.url}
                                  alt={`Citizen ground photo ${idx + 1}`}
                                  onClick={() => setLightboxPhoto({ url: item.url!, item })}
                                />
                              ) : (
                                <div style={s.photoError}>
                                  <span>Image URL missing</span>
                                </div>
                              )}
                              <div style={s.photoMeta}>
                                <span>Photo #{idx + 1} · {(item.file_size_bytes / 1024).toFixed(1)} KB</span>
                                <span>{formatDateTime(item.received_at)}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <div style={s.emptyPhotosBox}>
                        <Camera size={20} color="#94a3b8" />
                        <span style={{ fontSize: ".75rem", color: "#64748b" }}>
                          No evidence photos were uploaded by the citizen for this report.
                        </span>
                      </div>
                    )
                  ) : (
                    /* Case 2: State Nodal Officer / Inspector - STRICT PRIVACY REDACTION */
                    <div style={s.privacyRedactionBox}>
                      <div style={{ display: "flex", gap: ".6rem", alignItems: "flex-start" }}>
                        <div style={s.lockIconWrapper}>
                          <Lock size={18} color="#b45309" />
                        </div>
                        <div>
                          <strong style={{ color: "#92400e", fontSize: ".78rem" }}>
                            🔒 Confidential Citizen Evidence Redacted ({selected.evidence_count} file(s))
                          </strong>
                          <p style={{ margin: ".25rem 0 0", color: "#b45309", fontSize: ".73rem", lineHeight: 1.45 }}>
                            Under MoSPI Citizen Grievance & Whistleblower Protection Safeguards,
                            citizen-uploaded photos and raw binaries are <strong>restricted exclusively to the District Authority</strong>.
                            Thumbnails and download streams are encrypted and masked for oversight roles.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Resolution Remarks if present */}
                {selected.moderation_reason && (
                  <div style={s.remarksSection}>
                    <strong style={s.detailLabel}>Senior Resolution Remarks</strong>
                    <p style={s.remarksText}>
                      "{selected.moderation_reason}"
                    </p>
                  </div>
                )}

                {/* District Authority Moderation Form */}
                {canWrite ? (
                  NEXT[selected.status].length > 0 ? (
                    <div style={s.form}>
                      <h3 style={{ margin: "0.2rem 0 0", color: "#0f172a", fontSize: ".85rem", fontWeight: 700 }}>
                        {isDistrictAuthority ? "District Moderation & Action" : "Administrative Moderation & Action"}
                      </h3>

                      <label style={s.label}>
                        Next Status:
                        <select
                          value={status}
                          onChange={(event) =>
                            setStatus(event.target.value as CitizenIssueStatus)
                          }
                          style={s.selectFull}
                        >
                          {NEXT[selected.status].map((value) => (
                            <option key={value} value={value}>
                              {value.replaceAll("_", " ")}
                            </option>
                          ))}
                        </select>
                      </label>

                      {/* District Inspector Dropdown */}
                      {status === "inspection_assigned" && (
                        <label style={s.label}>
                          <span style={{ display: "flex", justifyContent: "space-between" }}>
                            <span>Assign Field Inspector (Required):</span>
                            {loadingInspectors && <span style={{ color: "#64748b" }}>Loading inspectors…</span>}
                          </span>
                          <select
                            value={inspector}
                            onChange={(event) => setInspector(event.target.value)}
                            style={s.selectFull}
                          >
                            <option value="">
                              -- Select Field Inspector ({inspectors.length} available) --
                            </option>
                            {inspectors.map((insp) => (
                              <option key={insp.user_id} value={insp.user_id}>
                                {insp.full_name} ({insp.username}) — {insp.district_code || insp.state_code || "District"}
                              </option>
                            ))}
                          </select>
                        </label>
                      )}

                      <label style={s.label}>
                        Public Status Message (visible to citizens tracking reference):
                        <input
                          value={publicMessage}
                          onChange={(event) => setPublicMessage(event.target.value)}
                          placeholder="e.g. Field inspection scheduled for Friday."
                          style={s.input}
                        />
                      </label>

                      <label style={s.label}>
                        Moderation Reason / Senior Remarks{" "}
                        {status === "resolved" || status === "closed" ? "(Required for completion)" : "(Optional)"}:
                        <textarea
                          value={reason}
                          onChange={(event) => setReason(event.target.value)}
                          style={s.textarea}
                          placeholder="Describe changes done, field inspection verdict, or rectification actions..."
                        />
                      </label>

                      <button
                        onClick={() => void moderate()}
                        disabled={
                          pending ||
                          (status === "inspection_assigned" && !inspector.trim()) ||
                          ((status === "resolved" || status === "closed") && !reason.trim())
                        }
                        style={{
                          ...s.primary,
                          opacity:
                            pending ||
                            (status === "inspection_assigned" && !inspector.trim()) ||
                            ((status === "resolved" || status === "closed") && !reason.trim())
                              ? 0.5
                              : 1,
                        }}
                      >
                        {pending ? "Updating Moderation…" : "Save Moderation & Dispatch"}
                      </button>
                    </div>
                  ) : (
                    <div style={s.terminalBox}>
                      <p style={{ margin: 0, color: "#15803d", fontSize: ".76rem", fontWeight: 600 }}>
                        ✓ This citizen report is in a terminal state ({selected.status.replaceAll("_", " ")}).
                      </p>
                    </div>
                  )
                ) : (
                  <div style={s.readOnlyBox}>
                    <p style={{ margin: 0, color: "#1e40af", fontSize: ".74rem" }}>
                      ℹ️ You are viewing in <strong>Read-Only Mode</strong>. Only the District Authority and authorized administrators have permission to alter status, record resolution remarks, and assign inspectors.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <State
                title="Select a citizen report"
                detail="Choose a citizen report from the queue on the left to view complaint description, check photo evidence, and manage field assignments."
              />
            )}
          </aside>
        </section>
      </div>

      {/* Photo Lightbox Modal for District Authority */}
      {lightboxPhoto && (
        <div style={s.lightboxOverlay} onClick={() => setLightboxPhoto(null)}>
          <div style={s.lightboxContent} onClick={(e) => e.stopPropagation()}>
            <div style={s.lightboxHeader}>
              <div>
                <strong style={{ color: "#0f172a", fontSize: ".9rem" }}>
                  Citizen Evidence Photo (Official Inspection View)
                </strong>
                <p style={{ margin: ".2rem 0 0", color: "#64748b", fontSize: ".72rem" }}>
                  ID: {lightboxPhoto.item.evidence_id} · Received: {formatDateTime(lightboxPhoto.item.received_at)}
                </p>
              </div>
              <button onClick={() => setLightboxPhoto(null)} style={s.closeBtn}>
                <X size={18} />
              </button>
            </div>
            <div style={s.lightboxBody}>
              <ProtectedCitizenImage
                url={lightboxPhoto.url}
                alt="Enlarged citizen evidence photo"
              />
            </div>
            <div style={s.lightboxFooter}>
              <span style={{ fontSize: ".7rem", color: "#15803d", fontWeight: 600 }}>
                🔒 Official District Authority Evidence Record · Tamper Evident
              </span>
              <button onClick={() => setLightboxPhoto(null)} style={s.dismissBtn}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Escalate to Case Modal */}
      {showEscalateModal && selected && (
        <div style={s.lightboxOverlay} onClick={() => setShowEscalateModal(false)}>
          <div style={s.modalContent} onClick={(e) => e.stopPropagation()}>
            <div style={s.lightboxHeader}>
              <div>
                <strong style={{ color: "#0f172a", fontSize: "1rem" }}>
                  ⚡ Escalate to Official Investigation Case
                </strong>
                <p style={{ margin: ".2rem 0 0", color: "#64748b", fontSize: ".75rem" }}>
                  Report Ref: {selected.reference_id} · Work: {selected.work_title}
                </p>
              </div>
              <button onClick={() => setShowEscalateModal(false)} style={s.closeBtn}>
                <X size={18} />
              </button>
            </div>

            <div style={s.modalBody}>
              <label style={s.label}>
                Case Title:
                <input
                  value={caseTitle}
                  onChange={(e) => setCaseTitle(e.target.value)}
                  style={s.input}
                />
              </label>

              <label style={s.label}>
                Investigation Severity:
                <select
                  value={caseSeverity}
                  onChange={(e) => setCaseSeverity(e.target.value as any)}
                  style={s.selectFull}
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </label>

              <label style={s.label}>
                Assign Field Inspector:
                <select
                  value={caseInspector}
                  onChange={(e) => setCaseInspector(e.target.value)}
                  style={s.selectFull}
                >
                  <option value="">-- Select Field Inspector (Optional) --</option>
                  {inspectors.map((insp) => (
                    <option key={insp.user_id} value={insp.user_id}>
                      {insp.full_name} ({insp.username})
                    </option>
                  ))}
                </select>
              </label>

              <label style={s.label}>
                District Authority Case Notes:
                <textarea
                  value={caseNotes}
                  onChange={(e) => setCaseNotes(e.target.value)}
                  style={s.textarea}
                  rows={4}
                />
              </label>
            </div>

            <div style={s.modalFooter}>
              <button
                onClick={() => setShowEscalateModal(false)}
                style={s.dismissBtn}
              >
                Cancel
              </button>
              <button
                onClick={handleEscalateToCase}
                disabled={escalating || !caseTitle.trim()}
                style={{ ...s.primary, opacity: escalating || !caseTitle.trim() ? 0.6 : 1 }}
              >
                {escalating ? "Creating Case…" : "Confirm & Escalate to Case"}
              </button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes citizen-moderation-spin{to{transform:rotate(360deg)}}
        button:hover:not(:disabled){opacity:.88}
      `}</style>
    </main>
  );
}

function State({ title, detail }: { title: string; detail: string }) {
  return (
    <div style={s.state}>
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: "100vh",
    padding: "1.5rem",
    background: "#ffffff",
    fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif',
  },
  container: { maxWidth: 1280, margin: "0 auto" },
  header: {
    display: "flex",
    justifyContent: "space-between",
    gap: "1rem",
    alignItems: "flex-start",
    marginBottom: ".85rem",
  },
  back: {
    border: 0,
    padding: 0,
    color: "#475569",
    background: "transparent",
    cursor: "pointer",
    fontSize: ".75rem",
  },
  eyebrow: {
    margin: ".7rem 0 .2rem",
    color: "#2563eb",
    fontSize: ".68rem",
    letterSpacing: ".09em",
    fontWeight: 700,
    textTransform: "uppercase" as const,
  },
  title: { margin: 0, color: "#0f172a", fontSize: "clamp(1.5rem,3vw,2.2rem)", fontWeight: 700 },
  subtitle: { margin: ".35rem 0 0", color: "#64748b", fontSize: ".82rem" },
  refresh: {
    border: "1px solid #cbd5e1",
    borderRadius: 7,
    padding: ".5rem .75rem",
    color: "#0f172a",
    background: "#ffffff",
    cursor: "pointer",
    fontSize: ".75rem",
    fontWeight: 600,
  },
  snoBanner: {
    margin: ".65rem 0",
    padding: ".75rem .9rem",
    border: "1px solid #bfdbfe",
    borderRadius: 8,
    background: "#eff6ff",
  },
  daBanner: {
    margin: ".65rem 0",
    padding: ".75rem .9rem",
    border: "1px solid #bbf7d0",
    borderRadius: 8,
    background: "#f0fdf4",
  },
  inspBanner: {
    margin: ".65rem 0",
    padding: ".75rem .9rem",
    border: "1px solid #fde68a",
    borderRadius: 8,
    background: "#fffbeb",
  },
  badgeLabel: {
    fontSize: ".68rem",
    fontWeight: 800,
    letterSpacing: ".06em",
    color: "#1d4ed8",
  },
  badgeLabelGreen: {
    fontSize: ".68rem",
    fontWeight: 800,
    letterSpacing: ".06em",
    color: "#15803d",
  },
  badgeLabelAmber: {
    fontSize: ".68rem",
    fontWeight: 800,
    letterSpacing: ".06em",
    color: "#b45309",
  },
  bannerText: {
    margin: ".3rem 0 0",
    fontSize: ".78rem",
    lineHeight: 1.5,
    color: "#1e3a8a",
  },
  bannerTextGreen: {
    margin: ".3rem 0 0",
    fontSize: ".78rem",
    lineHeight: 1.5,
    color: "#14532d",
  },
  bannerTextAmber: {
    margin: ".3rem 0 0",
    fontSize: ".78rem",
    lineHeight: 1.5,
    color: "#78350f",
  },
  inspectorActionBtn: {
    border: "1px solid #d97706",
    borderRadius: 6,
    padding: ".4rem .7rem",
    background: "#f59e0b",
    color: "#ffffff",
    fontSize: ".72rem",
    fontWeight: 700,
    cursor: "pointer",
  },
  notice: {
    display: "flex",
    alignItems: "center",
    gap: ".5rem",
    padding: ".55rem .7rem",
    border: "1px solid #bbf7d0",
    borderRadius: 8,
    color: "#166534",
    background: "#f0fdf4",
    fontSize: ".78rem",
    margin: ".5rem 0",
  },
  error: {
    display: "flex",
    alignItems: "center",
    gap: ".5rem",
    padding: ".55rem .7rem",
    border: "1px solid #fecaca",
    borderRadius: 8,
    color: "#991b1b",
    background: "#fef2f2",
    fontSize: ".78rem",
    margin: ".5rem 0",
  },
  filter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    flexWrap: "wrap",
    gap: ".7rem",
    margin: ".75rem 0",
    padding: ".6rem .8rem",
    color: "#334155",
    border: "1px solid #e2e8f0",
    borderRadius: 9,
    background: "#f8fafc",
    fontSize: ".75rem",
  },
  select: {
    padding: ".35rem .5rem",
    color: "#0f172a",
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    background: "#ffffff",
    fontSize: ".75rem",
  },
  countPill: {
    padding: ".25rem .55rem",
    borderRadius: 6,
    background: "#e2e8f0",
    color: "#334155",
    fontSize: ".7rem",
    fontWeight: 600,
  },
  grid: {
    display: "grid",
    gridTemplateColumns: "minmax(0,1fr) minmax(420px,1.35fr)",
    gap: ".85rem",
    alignItems: "start",
  },
  list: { display: "grid", gap: ".5rem" },
  report: {
    display: "grid",
    gap: ".35rem",
    padding: ".75rem",
    border: "1px solid #e2e8f0",
    borderRadius: 9,
    color: "#64748b",
    textAlign: "left" as const,
    background: "#ffffff",
    cursor: "pointer",
    fontSize: ".72rem",
    boxShadow: "0 1px 2px rgba(0,0,0,0.04)",
    transition: "all 0.15s ease",
  },
  selected: {
    border: "1px solid #2563eb",
    background: "#f8faff",
  },
  statusBadge: {
    padding: ".2rem .45rem",
    borderRadius: 5,
    fontSize: ".65rem",
    fontWeight: 750,
    textTransform: "capitalize" as const,
  },
  reportWorkTitle: {
    color: "#0f172a",
    fontSize: ".85rem",
    fontWeight: 600,
    lineHeight: 1.35,
  },
  pillPhoto: {
    fontSize: ".65rem",
    fontWeight: 600,
    color: "#0369a1",
    background: "#e0f2fe",
    padding: ".15rem .4rem",
    borderRadius: 4,
  },
  pillCase: {
    fontSize: ".65rem",
    fontWeight: 700,
    color: "#9333ea",
    background: "#f3e8ff",
    padding: ".15rem .4rem",
    borderRadius: 4,
  },
  detail: {
    minHeight: 350,
    padding: "1.2rem",
    border: "1px solid #e2e8f0",
    borderRadius: 10,
    color: "#334155",
    background: "#ffffff",
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  },
  sectionTitle: { margin: 0, color: "#0f172a", fontSize: "1.1rem", fontWeight: 700 },
  tagBadge: {
    fontSize: ".65rem",
    fontWeight: 700,
    padding: ".2rem .45rem",
    borderRadius: 4,
    background: "#e0e7ff",
    color: "#3730a3",
  },
  escalateBtn: {
    display: "flex",
    alignItems: "center",
    gap: ".35rem",
    border: "1px solid #a855f7",
    borderRadius: 6,
    padding: ".35rem .65rem",
    background: "#f3e8ff",
    color: "#7e22ce",
    fontSize: ".72rem",
    fontWeight: 700,
    cursor: "pointer",
  },
  linkedCaseBtn: {
    display: "flex",
    alignItems: "center",
    gap: ".35rem",
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    padding: ".35rem .65rem",
    background: "#f8fafc",
    color: "#334155",
    fontSize: ".72rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  detailSection: {
    margin: ".6rem 0",
  },
  detailLabel: {
    display: "block",
    fontSize: ".65rem",
    color: "#64748b",
    textTransform: "uppercase" as const,
    letterSpacing: ".05em",
    fontWeight: 700,
    marginBottom: ".2rem",
  },
  reportDescription: {
    color: "#0f172a",
    fontSize: ".82rem",
    lineHeight: 1.5,
    margin: 0,
    background: "#f8fafc",
    padding: ".75rem",
    borderRadius: 6,
    border: "1px solid #e2e8f0",
  },
  metaGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: ".6rem",
    margin: ".65rem 0",
    background: "#f8fafc",
    padding: ".75rem",
    borderRadius: 8,
    border: "1px solid #e2e8f0",
  },
  metaValue: {
    margin: 0,
    color: "#0f172a",
    fontSize: ".75rem",
    lineHeight: 1.4,
  },
  evidenceContainer: {
    margin: ".85rem 0",
    padding: ".75rem",
    border: "1px solid #e2e8f0",
    borderRadius: 8,
    background: "#ffffff",
  },
  evidenceCountBadge: {
    fontSize: ".68rem",
    fontWeight: 700,
    padding: ".2rem .5rem",
    borderRadius: 5,
    background: "#f1f5f9",
    color: "#475569",
    border: "1px solid #e2e8f0",
  },
  photoSecurityNotice: {
    display: "flex",
    alignItems: "center",
    gap: ".4rem",
    padding: ".35rem .6rem",
    borderRadius: 6,
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
    color: "#15803d",
    fontSize: ".7rem",
    fontWeight: 600,
    marginBottom: ".65rem",
  },
  photoGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
    gap: ".65rem",
  },
  photoCard: {
    border: "1px solid #e2e8f0",
    borderRadius: 6,
    overflow: "hidden",
    background: "#f8fafc",
  },
  photoWrapper: {
    position: "relative",
    width: "100%",
    height: 110,
    cursor: "pointer",
    background: "#000000",
  },
  photoThumb: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  photoOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    background: "rgba(0,0,0,0.35)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: ".3rem",
    opacity: 0,
    transition: "opacity .15s ease",
  },
  photoMeta: {
    padding: ".35rem .45rem",
    display: "flex",
    flexDirection: "column",
    gap: ".15rem",
    fontSize: ".63rem",
    color: "#64748b",
    borderTop: "1px solid #e2e8f0",
    background: "#ffffff",
  },
  emptyPhotosBox: {
    display: "flex",
    alignItems: "center",
    gap: ".5rem",
    padding: ".75rem",
    background: "#f8fafc",
    borderRadius: 6,
    border: "1px dashed #cbd5e1",
  },
  photoPlaceholder: {
    height: 110,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: ".3rem",
    background: "#f1f5f9",
  },
  photoError: {
    height: 110,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: ".3rem",
    background: "#fef2f2",
    padding: ".4rem",
    textAlign: "center",
  },
  privacyRedactionBox: {
    padding: ".85rem",
    borderRadius: 8,
    background: "#fffbeb",
    border: "1px solid #fde68a",
  },
  lockIconWrapper: {
    padding: ".45rem",
    background: "#fef3c7",
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  },
  remarksSection: {
    margin: ".65rem 0",
    padding: ".75rem",
    borderRadius: 8,
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
  },
  remarksText: {
    margin: ".25rem 0 0",
    color: "#166534",
    fontSize: ".78rem",
    lineHeight: 1.45,
    fontStyle: "italic",
  },
  form: {
    display: "grid",
    gap: ".6rem",
    marginTop: ".85rem",
    paddingTop: ".85rem",
    borderTop: "1px solid #e2e8f0",
  },
  label: {
    display: "grid",
    gap: ".3rem",
    color: "#334155",
    fontSize: ".72rem",
    fontWeight: 700,
  },
  input: {
    width: "100%",
    boxSizing: "border-box" as const,
    padding: ".5rem",
    color: "#0f172a",
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    background: "#ffffff",
    fontSize: ".78rem",
  },
  selectFull: {
    width: "100%",
    boxSizing: "border-box" as const,
    padding: ".5rem",
    color: "#0f172a",
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    background: "#ffffff",
    fontSize: ".78rem",
  },
  textarea: {
    width: "100%",
    minHeight: 65,
    boxSizing: "border-box" as const,
    padding: ".5rem",
    color: "#0f172a",
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    background: "#ffffff",
    resize: "vertical" as const,
    fontSize: ".78rem",
  },
  primary: {
    border: "1px solid #2563eb",
    borderRadius: 7,
    padding: ".6rem",
    color: "#ffffff",
    background: "#2563eb",
    cursor: "pointer",
    fontWeight: 700,
    fontSize: ".78rem",
    marginTop: ".3rem",
  },
  terminalBox: {
    marginTop: ".85rem",
    padding: ".7rem",
    borderRadius: 8,
    background: "#f0fdf4",
    border: "1px solid #bbf7d0",
  },
  readOnlyBox: {
    marginTop: ".85rem",
    padding: ".7rem",
    borderRadius: 8,
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
  },
  accessDeniedCard: {
    maxWidth: 520,
    margin: "12vh auto",
    padding: "2rem",
    background: "#ffffff",
    border: "1px solid #fecaca",
    borderRadius: 12,
    textAlign: "center" as const,
    boxShadow: "0 4px 12px rgba(0,0,0,0.06)",
  },
  roleList: {
    textAlign: "left" as const,
    display: "grid",
    gap: ".4rem",
    margin: "1rem 0",
    padding: ".85rem",
    background: "#f8fafc",
    borderRadius: 8,
    border: "1px solid #e2e8f0",
  },
  roleItem: {
    fontSize: ".75rem",
    color: "#334155",
  },
  state: {
    display: "grid",
    gap: ".4rem",
    minHeight: 140,
    placeContent: "center",
    textAlign: "center" as const,
    color: "#64748b",
    fontSize: ".76rem",
  },
  spinner: {
    width: 34,
    height: 34,
    margin: "35vh auto",
    border: "3px solid rgba(0,0,0,.1)",
    borderTopColor: "#2563eb",
    borderRadius: "50%",
    animation: "citizen-moderation-spin .75s linear infinite",
  },
  spinnerSm: {
    width: 20,
    height: 20,
    border: "2px solid rgba(0,0,0,.1)",
    borderTopColor: "#2563eb",
    borderRadius: "50%",
    animation: "citizen-moderation-spin .75s linear infinite",
  },
  lightboxOverlay: {
    position: "fixed" as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(15, 23, 42, 0.75)",
    backdropFilter: "blur(4px)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
    padding: "1rem",
  },
  lightboxContent: {
    background: "#ffffff",
    borderRadius: 12,
    maxWidth: 720,
    width: "100%",
    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
    overflow: "hidden",
  },
  lightboxHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    padding: "1rem 1.25rem",
    borderBottom: "1px solid #e2e8f0",
  },
  closeBtn: {
    background: "transparent",
    border: 0,
    color: "#64748b",
    cursor: "pointer",
    padding: ".25rem",
  },
  lightboxBody: {
    padding: "1.25rem",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    maxHeight: "65vh",
    overflow: "auto",
    background: "#f8fafc",
  },
  lightboxFooter: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "center",
    padding: ".75rem 1.25rem",
    borderTop: "1px solid #e2e8f0",
    background: "#ffffff",
  },
  dismissBtn: {
    border: "1px solid #cbd5e1",
    borderRadius: 6,
    padding: ".45rem .85rem",
    background: "#ffffff",
    color: "#334155",
    fontSize: ".76rem",
    fontWeight: 600,
    cursor: "pointer",
  },
  modalContent: {
    background: "#ffffff",
    borderRadius: 12,
    maxWidth: 580,
    width: "100%",
    boxShadow: "0 20px 25px -5px rgba(0, 0, 0, 0.2)",
    overflow: "hidden",
  },
  modalBody: {
    padding: "1.25rem",
    display: "grid",
    gap: ".75rem",
  },
  modalFooter: {
    display: "flex",
    justifyContent: "flex-end",
    gap: ".65rem",
    padding: ".85rem 1.25rem",
    borderTop: "1px solid #e2e8f0",
    background: "#f8fafc",
  },
};

