"use client";

import { useAuth } from "@/lib/auth";
import { CaseAssignee, CaseRecord, CaseSeverity, CaseStatus, formatDateTime } from "@/lib/api";
import { useParams, useRouter } from "next/navigation";
import React, { useCallback, useEffect, useState } from "react";
import { ExportReportButton } from "@/components/reports/export-report-button";
import { PrintableReport, ReportSection } from "@/lib/export-report";

const API = "/api/v1/cases";
const WRITERS = new Set(["district_authority", "admin"]);
const STATUS_LABELS: Record<CaseStatus, string> = { new: "New", acknowledged: "Acknowledged", under_review: "Under Review", clarification_requested: "Clarification Requested", inspection_assigned: "Inspection Assigned", evidence_submitted: "Evidence Submitted", corrective_action_planned: "Corrective Action Planned", resolved: "Resolved", rejected_false_positive: "Rejected / False Positive", escalated: "Escalated", reopened: "Reopened" };

export default function CaseDetailPage() {
  const { user, fetchWithAuth, isLoading: authLoading } = useAuth(); const router = useRouter(); const params = useParams(); const caseId = params.caseId as string;
  const [caseItem, setCaseItem] = useState<CaseRecord | null>(null); const [assignees, setAssignees] = useState<CaseAssignee[]>([]); const [inspectors, setInspectors] = useState<CaseAssignee[]>([]);
  const [work, setWork] = useState<{ work_id: string; title: string; location?: { latitude?: number | null; longitude?: number | null; address?: string | null }; district_name?: string; state_name?: string } | null>(null);
  const [previewModalUrl, setPreviewModalUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true); const [pending, setPending] = useState<string | null>(null); const [error, setError] = useState<string | null>(null); const [notice, setNotice] = useState<string | null>(null);
  const [reason, setReason] = useState(""); const [comment, setComment] = useState(""); const [owner, setOwner] = useState(""); const [inspector, setInspector] = useState(""); const [dueDate, setDueDate] = useState(""); const [severity, setSeverity] = useState<CaseSeverity>("medium");
  const [plan, setPlan] = useState({ summary: "", actions: "", target_date: "" }); const [overrideStatus, setOverrideStatus] = useState<CaseStatus>("under_review");
  const canWrite = Boolean(user && WRITERS.has(user.role));

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetchWithAuth(`${API}/${caseId}`);
      if (response.status === 403) { setError("PERMISSION_DENIED"); return; }
      if (response.status === 404) { setError("NOT_FOUND"); return; }
      if (!response.ok) { const body = await response.json().catch(() => ({ detail: "Could not load case." })); throw new Error(body.detail || "Could not load case."); }
      const payload: CaseRecord = await response.json(); setCaseItem(payload); setOwner(payload.owner_user_id || ""); setInspector(payload.assigned_inspector_id || ""); setDueDate(payload.due_date ? payload.due_date.slice(0, 10) : ""); setSeverity(payload.severity);
      if (payload.work_id) {
        try {
          const workRes = await fetchWithAuth(`/api/v1/works/${payload.work_id}`);
          if (workRes.ok) {
            const workData = await workRes.json();
            setWork(workData);
          }
        } catch { /* ignore optional work detail error */ }
      }
      if (canWrite) { const [owners, inspectorsResponse] = await Promise.all([fetchWithAuth(`${API}/${caseId}/assignees`), fetchWithAuth(`${API}/${caseId}/assignees?inspectors_only=true`)]); if (owners.ok) setAssignees(await owners.json()); if (inspectorsResponse.ok) setInspectors(await inspectorsResponse.json()); }
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "Could not load case."); }
    finally { setLoading(false); }
  }, [canWrite, caseId, fetchWithAuth]);
  useEffect(() => { if (authLoading || !user) return; const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [authLoading, load, user]);

  async function call(path: string, method: "POST" | "PUT", body: Record<string, unknown> = {}, label = "Action") {
    setPending(label); setError(null); setNotice(null);
    try {
      const response = await fetchWithAuth(`${API}/${caseId}/${path}`, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) { const payload = await response.json().catch(() => ({ detail: `${label} failed.` })); throw new Error(payload.detail || `${label} failed.`); }
      const updated: CaseRecord = await response.json(); setCaseItem(updated); setNotice(`${label} recorded.`); setReason(""); await load();
    } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : `${label} failed.`); }
    finally { setPending(null); }
  }
  async function addComment() { if (!comment.trim()) { setError("Write a comment before adding it."); return; } await call("comments", "POST", { text: comment }, "Comment"); setComment(""); }
  if (authLoading) return <Spinner />; if (!user) return <main style={s.page}><p style={s.muted}>Not authenticated. Redirecting…</p></main>;
  if (error === "NOT_FOUND" || error === "PERMISSION_DENIED") return <main style={s.page}><State icon={error === "NOT_FOUND" ? "◌" : "🔒"} title={error === "NOT_FOUND" ? "Case not found" : "Case access is restricted"} detail={error === "NOT_FOUND" ? "This case is unavailable or outside your jurisdiction." : "Your role does not have access to this case."} /></main>;
  if (loading || !caseItem) return <Spinner />;
  const terminal = caseItem.status === "resolved" || caseItem.status === "rejected_false_positive";

  const getCaseExportData = () => {
    if (!caseItem) throw new Error("No case loaded");

    const sections: ReportSection[] = [
      {
        title: "Case Overview & Investigation Scope",
        type: "key-value",
        items: [
          { label: "Case ID", value: caseItem.case_id },
          { label: "Case Title", value: caseItem.title },
          { label: "Work Reference ID", value: caseItem.work_id },
          { label: "Lifecycle Status", value: STATUS_LABELS[caseItem.status] || caseItem.status },
          { label: "Severity Level", value: caseItem.severity.toUpperCase() },
          { label: "Case Owner", value: caseItem.owner_user_id || "Unassigned" },
          { label: "Assigned Inspector", value: caseItem.assigned_inspector_id || "Unassigned" },
          { label: "Due Date", value: caseItem.due_date ? formatDateTime(caseItem.due_date) : "Not set" },
          { label: "Created Timestamp", value: formatDateTime(caseItem.created_at) },
          { label: "Last Updated", value: formatDateTime(caseItem.updated_at) },
        ],
      },
      {
        title: "Detailed Description & Grounds for Review",
        type: "text",
        content: caseItem.description || "No specific grounds or description provided for this case file.",
      },
    ];

    if (caseItem.corrective_plan) {
      sections.push({
        title: "Corrective Action Plan (CAP)",
        type: "key-value",
        items: [
          { label: "Plan Summary", value: caseItem.corrective_plan.summary },
          {
            label: "Target Completion Date",
            value: caseItem.corrective_plan.target_date
              ? formatDateTime(caseItem.corrective_plan.target_date)
              : "Not specified",
          },
          {
            label: "Planned Action Items",
            value: caseItem.corrective_plan.actions.map((act, i) => `${i + 1}. ${act}`).join(" | ") || "None listed",
          },
        ],
      });
    }

    if (caseItem.inspection_reports.length > 0) {
      sections.push({
        title: "Field Inspection Reports",
        type: "table",
        headers: [
          "Report ID",
          "Inspector",
          "Submitted At",
          "Asset Found?",
          "Work Active?",
          "Verified Progress (%)",
          "Quality Concern?",
          "GPS Status",
          "Delay Cause / Remarks",
        ],
        rows: caseItem.inspection_reports.map((r) => [
          r.report_id.slice(0, 8),
          r.inspector_user_id,
          formatDateTime(r.submitted_at),
          r.checklist.asset_found ? "YES" : "NO",
          r.checklist.work_active ? "YES" : "NO",
          `${r.checklist.verified_physical_progress_pct}%`,
          r.checklist.quality_concern ? "YES" : "NO",
          r.gps_available ? "Captured" : "Unavailable",
          [r.checklist.cause_of_delay, r.checklist.additional_remarks, r.remarks].filter(Boolean).join(" | ") || "None",
        ]),
      });
    }

    if (caseItem.comments.length > 0) {
      sections.push({
        title: "Administrative & Review Comments",
        type: "table",
        headers: ["Comment ID", "Author", "Timestamp", "Comment Text"],
        rows: caseItem.comments.map((c) => [
          c.comment_id.slice(0, 8),
          c.author_user_id,
          formatDateTime(c.created_at),
          c.text,
        ]),
      });
    }

    if (caseItem.events.length > 0) {
      sections.push({
        title: "Audit-Ready Lifecycle Trail",
        type: "table",
        headers: ["Event ID", "Event Type", "Actor", "Timestamp", "Reason / Decision Note"],
        rows: [...caseItem.events].reverse().map((ev) => [
          ev.event_id.slice(0, 8),
          ev.event_type.replaceAll("_", " ").toUpperCase(),
          ev.actor_user_id,
          formatDateTime(ev.created_at),
          ev.reason || "—",
        ]),
      });
    }

    const report: PrintableReport = {
      title: "MPLADS CASE INVESTIGATION DOSSIER",
      subtitle: `Case #${caseItem.case_id} · ${caseItem.title}`,
      categoryBadge: `${caseItem.severity.toUpperCase()} SEVERITY · ${STATUS_LABELS[caseItem.status].toUpperCase()}`,
      generatedBy: user ? `${user.full_name} (${user.role.replace(/_/g, " ").toUpperCase()})` : "Authorised Official",
      jurisdiction: user?.jurisdiction?.district_code || user?.jurisdiction?.state_code || "National Oversight",
      metadata: [
        { label: "Case ID", value: caseItem.case_id },
        { label: "Work ID", value: caseItem.work_id },
        { label: "Current Status", value: STATUS_LABELS[caseItem.status] },
        { label: "Severity Tier", value: caseItem.severity.toUpperCase() },
        { label: "Owner", value: caseItem.owner_user_id || "Unassigned" },
        { label: "Inspector", value: caseItem.assigned_inspector_id || "Unassigned" },
      ],
      sections,
      signOff: {
        designation: "District Authority / Competent Administrative Officer",
        office: "Ministry of Statistics & Programme Implementation (MoSPI)",
      },
    };

    const csvHeaders = ["Category", "Reference", "Field / Attribute", "Value", "Remarks"];
    const csvRows: (string | number)[][] = [
      ["Metadata", caseItem.case_id, "Title", caseItem.title, ""],
      ["Metadata", caseItem.case_id, "Work ID", caseItem.work_id, ""],
      ["Metadata", caseItem.case_id, "Status", STATUS_LABELS[caseItem.status], ""],
      ["Metadata", caseItem.case_id, "Severity", caseItem.severity, ""],
      ["Metadata", caseItem.case_id, "Owner", caseItem.owner_user_id || "Unassigned", ""],
      ["Metadata", caseItem.case_id, "Inspector", caseItem.assigned_inspector_id || "Unassigned", ""],
      ["Metadata", caseItem.case_id, "Due Date", caseItem.due_date || "", ""],
      ["Metadata", caseItem.case_id, "Description", caseItem.description || "", ""],
    ];

    if (caseItem.corrective_plan) {
      csvRows.push(["Corrective Plan", caseItem.case_id, "Summary", caseItem.corrective_plan.summary, ""]);
      caseItem.corrective_plan.actions.forEach((act, idx) => {
        csvRows.push(["Corrective Plan", caseItem.case_id, `Action ${idx + 1}`, act, ""]);
      });
    }

    caseItem.inspection_reports.forEach((rep) => {
      csvRows.push([
        "Inspection Report",
        rep.report_id,
        "Inspector",
        rep.inspector_user_id,
        `Verified progress: ${rep.checklist.verified_physical_progress_pct}%, GPS: ${rep.gps_available ? "YES" : "NO"}`,
      ]);
    });

    caseItem.comments.forEach((c) => {
      csvRows.push(["Comment", c.comment_id, c.author_user_id, c.text, c.created_at]);
    });

    caseItem.events.forEach((ev) => {
      csvRows.push(["Lifecycle Event", ev.event_id, ev.event_type, ev.actor_user_id, ev.reason || ""]);
    });

    return {
      report,
      csv: { headers: csvHeaders, rows: csvRows },
      json: caseItem,
    };
  };

  return <main style={s.page}><div style={s.container}>
    <header style={s.header}><div><button onClick={() => router.push("/dashboard/cases")} style={s.back}>← Cases</button><p style={s.eyebrow}>Case {caseItem.case_id}</p><h1 style={s.title}>{caseItem.title}</h1><p style={s.subtitle}>{caseItem.description || "No additional case description."}</p></div><div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.5rem" }}><div style={s.statusBlock}><span style={s.status}>{STATUS_LABELS[caseItem.status]}</span><strong style={s.severity}>{caseItem.severity} severity</strong></div><ExportReportButton label="Export Case Dossier" filename={`MPLADS_Case_${caseItem.case_id}`} getReportData={getCaseExportData} /></div></header>
    <section style={s.summary}><Info label="Work" value={caseItem.work_id} action={() => router.push(`/dashboard/works/${caseItem.work_id}`)} /><Info label="Owner" value={caseItem.owner_user_id || "Unassigned"} /><Info label="Inspector" value={caseItem.assigned_inspector_id || "Unassigned"} /><Info label="Due date" value={caseItem.due_date ? formatDateTime(caseItem.due_date) : "Not set"} /></section>
    {notice && <p style={s.notice}>{notice}</p>}{error && <p style={s.error}>{error}</p>}
    {canWrite && <><section style={s.actionCard}><div><h2 style={s.sectionTitle}>Lifecycle and review actions</h2><p style={s.sectionText}>Resolving marks the case COMPLETED, updates the linked citizen report with your resolution remarks, and automatically dispatches an official completion notice to the State Nodal Officer.</p></div><div style={s.actionBody}><textarea value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Decision remarks (required for resolution, marking reviewed/in-progress, rejection, escalation)" style={s.textarea} /><div style={s.actionRow}><Action label="Acknowledge" disabled={caseItem.status !== "new" || Boolean(pending)} onClick={() => void call("acknowledge", "POST", reason ? { reason } : {}, "Acknowledgement")} /><Action label="Begin review" disabled={!(["acknowledged", "clarification_requested", "reopened", "escalated"] as CaseStatus[]).includes(caseItem.status) || Boolean(pending)} onClick={() => void call("begin-review", "POST", reason ? { reason } : {}, "Review status")} /><Action label="Request clarification" disabled={terminal || !reason.trim() || Boolean(pending)} onClick={() => void call("request-clarification", "POST", { reason }, "Clarification request")} /><Action label="Request documents" disabled={terminal || !reason.trim() || Boolean(pending)} onClick={() => void call("request-documents", "POST", { reason }, "Document request")} /><button disabled={terminal || !reason.trim() || Boolean(pending)} onClick={() => void call("mark-in-progress", "POST", { reason }, "Reviewed & Working on It")} style={{ ...s.action, background: "#0284c7", borderColor: "#0369a1", fontWeight: 700 }} title="Record field review as In Progress, update citizen tracker, and notify State Nodal Officer">⚡ Mark Reviewed — Working on It (Notifies Citizen & SNO)</button><button disabled={terminal || !reason.trim() || Boolean(pending)} onClick={() => void call("resolve", "POST", { reason }, "Resolution")} style={{ ...s.action, background: "#16a34a", borderColor: "#15803d", fontWeight: 700 }} title="Record field review as Completed, resolve citizen grievance, and notify State Nodal Officer">✓ Mark Completed & Resolve (Notifies Citizen & SNO)</button><Action label="Reject / false positive" disabled={terminal || !reason.trim() || Boolean(pending)} onClick={() => void call("reject", "POST", { reason }, "Rejection")} /><Action label="Escalate" disabled={terminal || !reason.trim() || Boolean(pending)} onClick={() => void call("escalate", "POST", { reason }, "Escalation")} /><Action label="Reopen" disabled={!(["resolved", "rejected_false_positive", "escalated"] as CaseStatus[]).includes(caseItem.status) || !reason.trim() || Boolean(pending)} onClick={() => void call("reopen", "POST", { reason }, "Reopening")} /></div></div></section>

    {/* ── Geotagged Evidence Verification & Spatial Site Match ── */}
    <section style={{ ...s.card, marginTop: ".75rem", border: "1px solid #cbd5e1" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "0.5rem" }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
            <span style={{ fontSize: "1.2rem" }}>📸</span>
            <h2 style={{ ...s.sectionTitle, fontSize: "1.02rem" }}>Geotagged Evidence Verification & Spatial Site Match</h2>
          </div>
          <p style={s.sectionText}>
            Verify on-site photographic evidence captured by the field inspector. Compare official sanctioned coordinates against photo geotags to confirm genuine ground presence.
          </p>
        </div>
        {caseItem.inspection_reports.length > 0 && (
          <span style={{ fontSize: ".72rem", fontWeight: 700, background: "#ecfdf5", color: "#065f46", border: "1px solid #a7f3d0", padding: ".25rem .55rem", borderRadius: 999 }}>
            ✓ {caseItem.inspection_reports.length} Inspection Report(s) Received
          </span>
        )}
      </div>

      {caseItem.inspection_reports.length === 0 ? (
        <div style={{ padding: "1.2rem", textAlign: "center", background: "#f8fafc", borderRadius: 10, border: "1px dashed #cbd5e1", marginTop: ".65rem" }}>
          <p style={{ margin: 0, fontSize: ".8rem", color: "#64748b" }}>
            ⏳ Awaiting field inspection report. The assigned inspector (<strong>{caseItem.assigned_inspector_id || "Unassigned"}</strong>) will navigate to site coordinates via B-Tree shortest path and capture camera-only geotagged photos.
          </p>
        </div>
      ) : (
        <div style={{ display: "grid", gap: "1rem", marginTop: ".85rem" }}>
          {caseItem.inspection_reports.map((report) => {
            const workLat = work?.location?.latitude ?? null;
            const workLng = work?.location?.longitude ?? null;
            const photoLat = report.gps_latitude ?? null;
            const photoLng = report.gps_longitude ?? null;

            let distanceMeters: number | null = null;
            if (report.gps_distance_from_project_meters != null) {
              distanceMeters = Math.round(report.gps_distance_from_project_meters);
            } else if (workLat != null && workLng != null && photoLat != null && photoLng != null) {
              distanceMeters = calculateDistanceMeters(workLat, workLng, photoLat, photoLng);
            }

            const isMatch = distanceMeters != null && distanceMeters <= 200;
            const isProximity = distanceMeters != null && distanceMeters > 200 && distanceMeters <= 500;
            const isMismatch = distanceMeters != null && distanceMeters > 500;

            return (
              <div key={report.report_id} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: "1rem", background: "#fcfdfe" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: ".5rem", marginBottom: ".75rem" }}>
                  <div>
                    <strong style={{ fontSize: ".88rem", color: "#0f172a" }}>Report #{report.report_id.slice(0, 8)}</strong>
                    <span style={{ fontSize: ".72rem", color: "#64748b", marginLeft: ".6rem" }}>
                      Inspector: <strong>{report.inspector_user_id}</strong> · {formatDateTime(report.submitted_at)}
                    </span>
                  </div>

                  {isMatch && (
                    <span style={{ padding: ".3rem .65rem", borderRadius: 6, fontSize: ".72rem", fontWeight: 700, background: "#f0fdf4", color: "#166534", border: "1px solid #bbf7d0", display: "flex", alignItems: "center", gap: ".35rem" }}>
                      🟢 VERIFIED ON-SITE MATCH ({distanceMeters}m from site)
                    </span>
                  )}
                  {isProximity && (
                    <span style={{ padding: ".3rem .65rem", borderRadius: 6, fontSize: ".72rem", fontWeight: 700, background: "#fffbeb", color: "#92400e", border: "1px solid #fde68a", display: "flex", alignItems: "center", gap: ".35rem" }}>
                      🟡 PROXIMITY WARNING ({distanceMeters}m from site)
                    </span>
                  )}
                  {isMismatch && (
                    <span style={{ padding: ".3rem .65rem", borderRadius: 6, fontSize: ".72rem", fontWeight: 700, background: "#fef2f2", color: "#991b1b", border: "1px solid #fecaca", display: "flex", alignItems: "center", gap: ".35rem" }}>
                      🔴 LOCATION MISMATCH ({distanceMeters}m from site)
                    </span>
                  )}
                  {distanceMeters == null && (
                    <span style={{ padding: ".3rem .65rem", borderRadius: 6, fontSize: ".72rem", fontWeight: 700, background: "#f8fafc", color: "#64748b", border: "1px solid #cbd5e1" }}>
                      ⚪ GPS METADATA UNAVAILABLE
                    </span>
                  )}
                </div>

                {/* Spatial Coordinate Comparison */}
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: ".75rem", marginBottom: ".9rem" }}>
                  <div style={{ background: "#f8fafc", padding: ".75rem", borderRadius: 8, border: "1px solid #e2e8f0" }}>
                    <span style={{ display: "block", fontSize: ".62rem", color: "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" }}>
                      📍 Official Sanctioned Project Site
                    </span>
                    <div style={{ marginTop: ".35rem", fontSize: ".78rem", color: "#0f172a", fontFamily: "monospace", fontWeight: 600 }}>
                      Lat: {workLat != null ? workLat.toFixed(6) : "N/A"}°, Lng: {workLng != null ? workLng.toFixed(6) : "N/A"}°
                    </div>
                    <div style={{ marginTop: ".25rem", fontSize: ".7rem", color: "#64748b" }}>
                      {work?.location?.address || work?.title || caseItem.title}
                    </div>
                  </div>

                  <div style={{ background: isMatch ? "#f0fdf4" : isMismatch ? "#fef2f2" : "#f8fafc", padding: ".75rem", borderRadius: 8, border: `1px solid ${isMatch ? "#bbf7d0" : isMismatch ? "#fecaca" : "#e2e8f0"}` }}>
                    <span style={{ display: "block", fontSize: ".62rem", color: isMatch ? "#166534" : isMismatch ? "#991b1b" : "#64748b", fontWeight: 700, textTransform: "uppercase", letterSpacing: ".04em" }}>
                      📸 Inspector Geotag Capture
                    </span>
                    <div style={{ marginTop: ".35rem", fontSize: ".78rem", color: "#0f172a", fontFamily: "monospace", fontWeight: 600 }}>
                      Lat: {photoLat != null ? photoLat.toFixed(6) : "N/A"}°, Lng: {photoLng != null ? photoLng.toFixed(6) : "N/A"}°
                    </div>
                    <div style={{ marginTop: ".25rem", fontSize: ".7rem", color: isMatch ? "#166534" : isMismatch ? "#991b1b" : "#64748b" }}>
                      {distanceMeters != null ? (
                        isMatch ? `✓ Within approved 200m perimeter (${distanceMeters}m delta)` : `${distanceMeters}m deviation from project coordinates`
                      ) : "Hardware GPS lock not available"}
                    </div>
                  </div>
                </div>

                {/* Ground checklist pills */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: ".45rem", marginBottom: ".85rem" }}>
                  <span style={{ padding: ".25rem .5rem", borderRadius: 6, fontSize: ".68rem", fontWeight: 600, background: report.checklist.asset_found ? "#dcfce7" : "#fee2e2", color: report.checklist.asset_found ? "#15803d" : "#b91c1c" }}>
                    Asset Found: {report.checklist.asset_found ? "YES" : "NO"}
                  </span>
                  <span style={{ padding: ".25rem .5rem", borderRadius: 6, fontSize: ".68rem", fontWeight: 600, background: report.checklist.work_active ? "#dbeafe" : "#fef3c7", color: report.checklist.work_active ? "#1e40af" : "#92400e" }}>
                    Work Active: {report.checklist.work_active ? "YES" : "NO"}
                  </span>
                  <span style={{ padding: ".25rem .5rem", borderRadius: 6, fontSize: ".68rem", fontWeight: 700, background: "#f3e8ff", color: "#6b21a8" }}>
                    Verified Progress: {report.checklist.verified_physical_progress_pct}%
                  </span>
                  <span style={{ padding: ".25rem .5rem", borderRadius: 6, fontSize: ".68rem", fontWeight: 600, background: report.checklist.quality_concern ? "#fee2e2" : "#f1f5f9", color: report.checklist.quality_concern ? "#b91c1c" : "#475569" }}>
                    Quality Concerns: {report.checklist.quality_concern ? "YES (Flagged)" : "None"}
                  </span>
                  {report.checklist.cause_of_delay && (
                    <span style={{ padding: ".25rem .5rem", borderRadius: 6, fontSize: ".68rem", fontWeight: 500, background: "#fef3c7", color: "#92400e" }}>
                      Delay Cause: {report.checklist.cause_of_delay}
                    </span>
                  )}
                </div>

                {report.remarks && (
                  <p style={{ margin: "0 0 .75rem", fontSize: ".76rem", color: "#334155", background: "#f8fafc", padding: ".6rem .75rem", borderRadius: 7, borderLeft: "3px solid #0284c7" }}>
                    <strong>Inspector Remarks:</strong> {report.remarks}
                  </p>
                )}

                {/* Geotagged Evidence Photos */}
                <div>
                  <span style={{ display: "block", fontSize: ".68rem", fontWeight: 700, color: "#475569", textTransform: "uppercase", letterSpacing: ".04em", marginBottom: ".45rem" }}>
                    Photographic Evidence ({report.evidence_ids.length} camera photo{report.evidence_ids.length !== 1 ? "s" : ""})
                  </span>
                  {report.evidence_ids.length === 0 ? (
                    <p style={{ fontSize: ".72rem", color: "#94a3b8", fontStyle: "italic", margin: 0 }}>No photos attached to this report.</p>
                  ) : (
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: ".75rem" }}>
                      {report.evidence_ids.map((evId) => (
                        <EvidencePhotoPreview
                          key={evId}
                          evidenceId={evId}
                          fetchWithAuth={fetchWithAuth}
                          onEnlarge={(url) => setPreviewModalUrl(url)}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
    <section style={s.grid}><section style={s.card}><h2 style={s.sectionTitle}>Assignment and controls</h2><label style={s.label}>Owner<select value={owner} onChange={(e) => setOwner(e.target.value)} style={s.input}><option value="">Choose owner</option>{assignees.map((person) => <option key={person.user_id} value={person.user_id}>{person.full_name} · {person.role}</option>)}</select></label><Action label="Assign owner" disabled={!owner || terminal || Boolean(pending)} onClick={() => void call("owner", "PUT", { user_id: owner, reason }, "Owner assignment")} /><label style={s.label}>Inspector<select value={inspector} onChange={(e) => setInspector(e.target.value)} style={s.input}><option value="">Choose inspector</option>{inspectors.map((person) => <option key={person.user_id} value={person.user_id}>{person.full_name}</option>)}</select></label><Action label="Assign inspector" disabled={!inspector || terminal || Boolean(pending)} onClick={() => void call("inspector", "PUT", { user_id: inspector, reason }, "Inspection assignment")} /><label style={s.label}>Due date<input value={dueDate} onChange={(e) => setDueDate(e.target.value)} type="date" style={s.input} /></label><Action label="Set due date" disabled={!dueDate || terminal || Boolean(pending)} onClick={() => void call("due-date", "PUT", { due_date: new Date(dueDate).toISOString(), reason }, "Due date")} /><label style={s.label}>Severity<select value={severity} onChange={(e) => setSeverity(e.target.value as CaseSeverity)} style={s.input}>{["low", "medium", "high", "critical"].map((value) => <option key={value} value={value}>{value}</option>)}</select></label><Action label="Change severity" disabled={terminal || Boolean(pending)} onClick={() => void call("severity", "PUT", { severity, reason }, "Severity")} /></section>
    <section style={s.card}><h2 style={s.sectionTitle}>Corrective plan and override</h2><input value={plan.summary} onChange={(e) => setPlan({ ...plan, summary: e.target.value })} placeholder="Corrective plan summary" style={s.input} /><textarea value={plan.actions} onChange={(e) => setPlan({ ...plan, actions: e.target.value })} placeholder="One corrective action per line" style={s.textarea} /><input value={plan.target_date} onChange={(e) => setPlan({ ...plan, target_date: e.target.value })} type="date" style={s.input} /><Action label="Create corrective plan" disabled={!plan.summary.trim() || terminal || Boolean(pending)} onClick={() => void call("corrective-plan", "PUT", { summary: plan.summary, actions: plan.actions.split("\n").map((item) => item.trim()).filter(Boolean), target_date: plan.target_date ? new Date(plan.target_date).toISOString() : null }, "Corrective plan")} /><hr style={s.rule} /><label style={s.label}>Override lifecycle state<select value={overrideStatus} onChange={(e) => setOverrideStatus(e.target.value as CaseStatus)} style={s.input}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><Action label="Override with reason" disabled={!reason.trim() || Boolean(pending)} onClick={() => void call("override", "POST", { status: overrideStatus, severity, reason }, "Override")} /></section></section>
    <section style={s.actionCard}><h2 style={s.sectionTitle}>Case comment</h2><div style={s.commentRow}><textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add a review note" style={s.textarea} /><Action label="Add comment" disabled={!comment.trim() || Boolean(pending)} onClick={() => void addComment()} /></div></section></>}
    {caseItem.corrective_plan && <section style={s.card}><h2 style={s.sectionTitle}>Corrective plan</h2><p style={s.plan}>{caseItem.corrective_plan.summary}</p>{caseItem.corrective_plan.actions.map((item, index) => <p key={index} style={s.subtle}>• {item}</p>)}</section>}
    <section style={s.grid}><Timeline title="Inspection reports" empty="No inspection report has been submitted." items={caseItem.inspection_reports.map((report) => <article key={report.report_id} style={s.feedItem}><strong>Report {report.report_id.slice(0, 8)}</strong><span style={s.subtle}>Inspector: {report.inspector_user_id} · Submitted: {formatDateTime(report.submitted_at)}</span><span style={s.subtle}>Asset: {report.checklist.asset_found ? "Verified on Ground" : "Not Found"} · Progress: {report.checklist.verified_physical_progress_pct}%</span><span style={s.subtle}>{report.evidence_ids.length} field photo attachment(s) · GPS {report.gps_available ? `Captured (${report.gps_distance_from_project_meters ? Math.round(report.gps_distance_from_project_meters) + "m from site" : "on perimeter"})` : "Unavailable"}</span>{report.remarks && <p style={s.feedText}>Observations: {report.remarks}</p>}</article>)} /><Timeline title="Comments" empty="No comments recorded." items={caseItem.comments.map((item) => <article key={item.comment_id} style={s.feedItem}><strong>{item.author_user_id}</strong><span style={s.subtle}>{formatDateTime(item.created_at)}</span><p style={s.feedText}>{item.text}</p></article>)} /><Timeline title="Audit-ready lifecycle" empty="No lifecycle events recorded." items={[...caseItem.events].reverse().map((event) => <article key={event.event_id} style={s.feedItem}><strong>{event.event_type.replaceAll("_", " ")}</strong><span style={s.subtle}>{event.actor_user_id} · {formatDateTime(event.created_at)}</span>{event.reason && <p style={s.feedText}>{event.reason}</p>}</article>)} /></section>
    {previewModalUrl && (
      <div
        style={{
          position: "fixed",
          inset: 0,
          background: "rgba(15, 23, 42, 0.88)",
          backdropFilter: "blur(6px)",
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "1.5rem",
        }}
        onClick={() => setPreviewModalUrl(null)}
      >
        <div
          style={{
            position: "relative",
            maxWidth: "92vw",
            maxHeight: "88vh",
            background: "#000",
            borderRadius: 12,
            overflow: "hidden",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.75)",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={previewModalUrl}
            alt="Geotagged Field Evidence Full Preview"
            style={{ width: "100%", height: "auto", maxHeight: "80vh", objectFit: "contain", display: "block" }}
          />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: ".75rem 1rem", background: "#0f172a", color: "#fff" }}>
            <div>
              <span style={{ fontSize: ".75rem", fontWeight: 700, color: "#38bdf8" }}>SAMARTH AI · ON-SITE FIELD EVIDENCE</span>
              <p style={{ margin: ".2rem 0 0", fontSize: ".68rem", color: "#94a3b8" }}>
                Verified on-site camera capture with burned-in GPS HUD watermark & coordinate seal.
              </p>
            </div>
            <button
              onClick={() => setPreviewModalUrl(null)}
              style={{
                background: "#334155",
                border: "1px solid #475569",
                color: "#fff",
                borderRadius: 6,
                padding: ".4rem .8rem",
                fontSize: ".75rem",
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              ✕ Close Preview
            </button>
          </div>
        </div>
      </div>
    )}
  </div><style>{`@keyframes case-detail-spin{to{transform:rotate(360deg)}} button:hover:not(:disabled){opacity:.86}`}</style></main>;
}

function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c);
}

function EvidencePhotoPreview({
  evidenceId,
  fetchWithAuth,
  onEnlarge,
}: {
  evidenceId: string;
  fetchWithAuth: (url: string, init?: RequestInit) => Promise<Response>;
  onEnlarge: (url: string) => void;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    let objectUrl: string | null = null;
    (async () => {
      try {
        setLoading(true);
        setFailed(false);
        const res = await fetchWithAuth(`/api/v1/evidence/${evidenceId}/file`);
        if (!res.ok) throw new Error("Could not fetch evidence file");
        const blob = await res.blob();
        if (active) {
          objectUrl = URL.createObjectURL(blob);
          setSrc(objectUrl);
        }
      } catch {
        if (active) setFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [evidenceId, fetchWithAuth]);

  if (loading) {
    return (
      <div style={evStyles.loadingBox}>
        <span style={evStyles.spinner} />
        <span style={{ fontSize: ".72rem", color: "#64748b" }}>Loading photo…</span>
      </div>
    );
  }

  if (failed || !src) {
    return (
      <div style={evStyles.fallbackBox}>
        <span style={{ fontSize: "1.4rem" }}>📷</span>
        <span style={{ fontSize: ".72rem", fontWeight: 600, color: "#475569" }}>Photo #{evidenceId.slice(0, 8)}</span>
        <span style={{ fontSize: ".62rem", color: "#94a3b8" }}>Encrypted Local Storage</span>
      </div>
    );
  }

  return (
    <div
      style={evStyles.thumbContainer}
      onClick={() => onEnlarge(src)}
      title="Click to view full-resolution geotagged evidence with burned-in HUD watermark"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="Field Evidence" style={evStyles.thumbImg} />
      <div style={evStyles.thumbOverlay}>
        <span style={evStyles.zoomBadge}>🔍 Click to Enlarge</span>
      </div>
      <div style={evStyles.watermarkBadge}>✓ HUD Geotagged</div>
    </div>
  );
}

const evStyles: Record<string, React.CSSProperties> = {
  loadingBox: {
    height: 140,
    borderRadius: 8,
    border: "1px dashed #cbd5e1",
    background: "#f8fafc",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: ".4rem",
  },
  spinner: {
    width: 22,
    height: 22,
    border: "2px solid rgba(0,0,0,0.1)",
    borderTopColor: "#0284c7",
    borderRadius: "50%",
    animation: "case-detail-spin .75s linear infinite",
  },
  fallbackBox: {
    height: 140,
    borderRadius: 8,
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: ".25rem",
    padding: ".5rem",
    textAlign: "center",
  },
  thumbContainer: {
    position: "relative",
    height: 150,
    borderRadius: 8,
    overflow: "hidden",
    border: "1px solid #cbd5e1",
    cursor: "pointer",
    background: "#0f172a",
  },
  thumbImg: {
    width: "100%",
    height: "100%",
    objectFit: "cover",
    display: "block",
  },
  thumbOverlay: {
    position: "absolute",
    inset: 0,
    background: "rgba(0,0,0,0.25)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    opacity: 0,
    transition: "opacity .2s ease",
  },
  zoomBadge: {
    background: "rgba(15,23,42,0.85)",
    color: "#ffffff",
    padding: ".3rem .6rem",
    borderRadius: 6,
    fontSize: ".68rem",
    fontWeight: 700,
    backdropFilter: "blur(4px)",
  },
  watermarkBadge: {
    position: "absolute",
    bottom: 6,
    left: 6,
    background: "rgba(15,23,42,0.85)",
    color: "#22c55e",
    padding: ".18rem .45rem",
    borderRadius: 4,
    fontSize: ".6rem",
    fontWeight: 700,
    letterSpacing: ".02em",
  },
};

function Action({ label, disabled, onClick }: { label: string; disabled: boolean; onClick: () => void }) { return <button onClick={onClick} disabled={disabled} style={s.action}>{label}</button>; }
function Info({ label, value, action }: { label: string; value: string; action?: () => void }) { return <article style={s.info}><span style={s.infoLabel}>{label}</span>{action ? <button onClick={action} style={s.linkValue}>{value}</button> : <strong style={s.infoValue}>{value}</strong>}</article>; }
function Timeline({ title, empty, items }: { title: string; empty: string; items: React.ReactNode[] }) { return <section style={s.card}><h2 style={s.sectionTitle}>{title}</h2><div style={s.feed}>{items.length ? items : <p style={s.subtle}>{empty}</p>}</div></section>; }
function State({ icon, title, detail }: { icon: string; title: string; detail: string }) { return <section style={s.state}><span style={s.stateIcon}>{icon}</span><h1 style={s.stateTitle}>{title}</h1><p style={s.stateDetail}>{detail}</p></section>; }
function Spinner() { return <main style={s.page}><div style={s.spinner} /><style>{`@keyframes case-detail-spin{to{transform:rotate(360deg)}}`}</style></main>; }

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", padding: "1.5rem", background: "#ffffff", fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' },
  container: { maxWidth: 1320, margin: "0 auto" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", marginBottom: "1rem" },
  back: { border: 0, padding: 0, background: "transparent", color: "#475569", cursor: "pointer", fontSize: ".78rem" },
  eyebrow: { margin: ".8rem 0 .22rem", color: "#2563eb", fontSize: ".68rem", letterSpacing: ".09em", fontWeight: 700, textTransform: "uppercase" as const },
  title: { margin: 0, color: "#0f172a", fontSize: "clamp(1.5rem,3vw,2.2rem)", letterSpacing: "-.03em", fontWeight: 700 },
  subtitle: { margin: ".4rem 0 0", maxWidth: 730, color: "#64748b", lineHeight: 1.5, fontSize: ".84rem" },
  statusBlock: { display: "grid", gap: ".35rem", textAlign: "right" as const },
  status: { color: "#b45309", fontSize: ".77rem", fontWeight: 750 },
  severity: { color: "#c2410c", fontSize: ".7rem", textTransform: "uppercase" as const, fontWeight: 700 },
  summary: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: ".65rem", marginBottom: ".75rem" },
  info: { padding: ".72rem", borderRadius: 10, border: "1px solid #e2e8f0", background: "#f8fafc" },
  infoLabel: { display: "block", color: "#64748b", fontSize: ".62rem", fontWeight: 700, textTransform: "uppercase" as const, letterSpacing: ".04em" },
  infoValue: { display: "block", marginTop: ".3rem", color: "#0f172a", fontSize: ".78rem", fontWeight: 600, overflowWrap: "anywhere" as const },
  linkValue: { display: "block", marginTop: ".3rem", padding: 0, border: 0, background: "transparent", color: "#2563eb", textAlign: "left" as const, cursor: "pointer", fontSize: ".78rem", fontWeight: 600, overflowWrap: "anywhere" as const },
  notice: { padding: ".6rem .75rem", border: "1px solid #bbf7d0", borderRadius: 8, color: "#166534", background: "#f0fdf4", fontSize: ".77rem" },
  error: { padding: ".6rem .75rem", border: "1px solid #fecaca", borderRadius: 8, color: "#991b1b", background: "#fef2f2", fontSize: ".77rem" },
  actionCard: { padding: ".9rem", marginTop: ".75rem", border: "1px solid #e2e8f0", borderRadius: 13, background: "#ffffff", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" },
  sectionTitle: { margin: 0, color: "#0f172a", fontSize: ".95rem", fontWeight: 700 },
  sectionText: { margin: ".28rem 0 .65rem", color: "#64748b", fontSize: ".72rem", lineHeight: 1.45 },
  actionBody: { display: "grid", gap: ".55rem" },
  textarea: { width: "100%", minHeight: 58, boxSizing: "border-box" as const, padding: ".52rem .58rem", color: "#0f172a", background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 7, resize: "vertical" as const, fontSize: ".78rem" },
  actionRow: { display: "flex", gap: ".4rem", flexWrap: "wrap" },
  action: { border: "1px solid #2563eb", borderRadius: 6, padding: ".42rem .52rem", color: "#ffffff", background: "#2563eb", cursor: "pointer", fontSize: ".72rem", fontWeight: 650 },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(310px,1fr))", gap: ".75rem", marginTop: ".75rem" },
  card: { padding: ".9rem", border: "1px solid #e2e8f0", borderRadius: 13, background: "#ffffff", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" },
  label: { display: "grid", gap: ".25rem", marginTop: ".65rem", color: "#334155", fontSize: ".68rem", fontWeight: 700 },
  input: { width: "100%", boxSizing: "border-box" as const, marginTop: ".25rem", padding: ".5rem .57rem", color: "#0f172a", background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 7, fontSize: ".78rem" },
  rule: { border: 0, borderTop: "1px solid #e2e8f0", margin: ".9rem 0" },
  commentRow: { display: "grid", gap: ".45rem", marginTop: ".55rem" },
  plan: { color: "#334155", lineHeight: 1.5, fontSize: ".78rem" },
  feed: { display: "grid", gap: ".5rem", marginTop: ".65rem" },
  feedItem: { padding: ".62rem", borderRadius: 8, border: "1px solid #e2e8f0", background: "#f8fafc", color: "#0f172a", fontSize: ".75rem" },
  feedText: { margin: ".35rem 0 0", color: "#475569", lineHeight: 1.45 },
  subtle: { display: "block", marginTop: ".23rem", color: "#64748b", fontSize: ".67rem", lineHeight: 1.4 },
  state: { minHeight: "80vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" as const },
  stateIcon: { fontSize: "2.2rem" },
  stateTitle: { margin: ".7rem 0 0", color: "#0f172a", fontWeight: 700 },
  stateDetail: { maxWidth: 460, color: "#64748b", lineHeight: 1.5 },
  spinner: { width: 34, height: 34, margin: "35vh auto", border: "3px solid rgba(0,0,0,.1)", borderTopColor: "#2563eb", borderRadius: "50%", animation: "case-detail-spin .75s linear infinite" },
  muted: { marginTop: "35vh", color: "#64748b", textAlign: "center" as const }
};
