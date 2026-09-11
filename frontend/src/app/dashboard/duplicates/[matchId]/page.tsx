"use client";

import { DuplicateLocationMap } from "@/components/duplicates/DuplicateLocationMap";
import { useAuth } from "@/lib/auth";
import {
  DuplicateComparisonResponse,
  DuplicateWorkSummary,
  formatCurrency,
  formatDate,
  formatDateTime,
} from "@/lib/api";
import { useParams, useRouter } from "next/navigation";
import React, { useCallback, useEffect, useState } from "react";

const API_BASE = "/api/v1/duplicates";

export default function DuplicateComparisonPage() {
  const { user, fetchWithAuth, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const matchId = params.matchId as string;
  const [comparison, setComparison] = useState<DuplicateComparisonResponse | null>(null);
  const [notes, setNotes] = useState("");
  const [assignedTo, setAssignedTo] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [action, setAction] = useState<"case" | "not-duplicate" | "field-verification" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canWrite = Boolean(user && ["admin", "district_authority"].includes(user.role));

  const loadComparison = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetchWithAuth(`${API_BASE}/${matchId}`);
      if (response.status === 403) { setError("PERMISSION_DENIED"); return; }
      if (response.status === 404) { setError("NOT_FOUND"); return; }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ detail: "Could not load the comparison." }));
        throw new Error(payload.detail || "Could not load the comparison.");
      }
      setComparison(await response.json());
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not load the comparison.");
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth, matchId]);

  useEffect(() => {
    if (authLoading || !user) return;
    const timer = window.setTimeout(() => { void loadComparison(); }, 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, loadComparison, user]);

  async function submitReview(kind: "case" | "not-duplicate" | "field-verification") {
    setAction(kind);
    setError(null);
    setSuccess(null);
    const path = kind === "case" ? "cases" : kind === "not-duplicate" ? "mark-not-duplicate" : "request-field-verification";
    try {
      const response = await fetchWithAuth(`${API_BASE}/${matchId}/${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(kind === "case" ? { notes, assigned_to: assignedTo } : { notes, assigned_to: assignedTo }),
      });
      if (response.status === 403) { setError("PERMISSION_DENIED"); return; }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ detail: "Could not update this review." }));
        throw new Error(payload.detail || "Could not update this review.");
      }
      setSuccess(kind === "case" ? "Review case created." : kind === "not-duplicate" ? "Marked not duplicate." : "Field verification requested.");
      await loadComparison();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not update this review.");
    } finally {
      setAction(null);
    }
  }

  if (authLoading) return <PageSpinner />;
  if (!user) return <main style={styles.page}><p style={styles.muted}>Not authenticated. Redirecting…</p></main>;
  if (isLoading) return <LoadingPage />;
  if (error === "PERMISSION_DENIED") return <PageState title="Insufficient permissions" detail="Your role does not have access to this comparison." icon="🔒" />;
  if (error === "NOT_FOUND") return <PageState title="Comparison not found" detail="The match may not be available in your jurisdiction or may no longer exist." icon="◌" actionLabel="Back to explorer" onAction={() => router.push("/dashboard/duplicates")} />;
  if (error || !comparison) return <PageState title="Comparison could not load" detail={error || "No comparison data was returned."} icon="⚠" actionLabel="Retry" onAction={() => void loadComparison()} />;

  const { match, left_work: left, right_work: right } = comparison;
  return (
    <main style={styles.page}>
      <div style={styles.container}>
        <header style={styles.header}>
          <div>
            <button onClick={() => router.push("/dashboard/duplicates")} style={styles.back}>← Duplicate explorer</button>
            <p style={styles.eyebrow}>Manual comparison</p>
            <h1 style={styles.title}>Possible duplicate-work comparison</h1>
            <p style={styles.subtitle}>Compare the two work records and their stored similarity signals before deciding the next review action.</p>
          </div>
          <div style={styles.scoreBox}><span style={styles.scoreValue}>{match.similarity_score.toFixed(1)}</span><span style={styles.scoreLabel}>Similarity / 100</span></div>
        </header>

        <section style={styles.notice}><strong>{comparison.notice}</strong> This comparison is decision support and requires a human review.</section>

        {success && <div style={styles.success}>{success}</div>}
        {error && <div style={styles.error}>{error === "PERMISSION_DENIED" ? "Insufficient permissions for this action." : error}</div>}

        <section style={styles.workGrid}>
          <WorkPanel heading="Work A" work={left} color="#60a5fa" />
          <WorkPanel heading="Work B" work={right} color="#f59e0b" />
        </section>

        <section style={styles.signalCard}>
          <h2 style={styles.sectionTitle}>Similarity signals</h2>
          <div style={styles.signalGrid}>
            <Signal label="TF-IDF / cosine" value={`${(match.text_similarity * 100).toFixed(1)}%`} detail={`Threshold ${(match.rule_snapshot.text_similarity_threshold * 100).toFixed(0)}%`} />
            <Signal label="Distance" value={match.distance_meters === null ? "Unavailable" : `${match.distance_meters.toFixed(1)}m`} detail={match.distance_method.replace(/_/g, " ")} />
            <Signal label="Cost comparison" value={match.cost_difference_pct === null ? "Unavailable" : `${match.cost_difference_pct.toFixed(1)}%`} detail={match.comparable_cost_range ? "Comparable cost range" : "Outside cost range"} />
            <Signal label="Timeline" value={match.timeline_overlap ? `${match.timeline_overlap_days ?? 0} days` : match.same_financial_year ? "Same financial year" : "No common period"} detail={match.timeline_overlap ? "Timeline overlap" : "Timeline signal"} />
            <Signal label="Category" value={match.category_relationship} detail={`${(match.category_similarity * 100).toFixed(0)}% category similarity`} />
            <Signal label="Agency / vendor" value={match.agency_vendor_relationship} detail="Relationship signal" />
            <Signal label="Evidence-photo similarity" value={match.evidence_photo_similarity === null ? "Unavailable" : `${(match.evidence_photo_similarity * 100).toFixed(1)}%`} detail={match.evidence_photo_relationship} />
            <Signal label="Review state" value={prettyStatus(match.status)} detail={match.reviewed_at ? `Updated ${formatDateTime(match.reviewed_at)}` : "No review action recorded"} />
          </div>
          <ul style={styles.signalList}>{match.matching_signals.map((signal) => <li key={signal}>{signal}</li>)}</ul>
        </section>

        <DuplicateLocationMap left={{ label: "Work A", latitude: left.location_latitude, longitude: left.location_longitude, address: left.location_address }} right={{ label: "Work B", latitude: right.location_latitude, longitude: right.location_longitude, address: right.location_address }} />

        {canWrite ? (
          <section style={styles.actionCard}>
            <div><h2 style={styles.sectionTitle}>Manual review actions</h2><p style={styles.actionDescription}>Record a short note to preserve the reasoning for the selected action.</p></div>
            <div style={styles.actionInputs}>
              <input value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)} style={styles.input} placeholder="Assign to (optional)" aria-label="Assign review to" />
              <textarea value={notes} onChange={(event) => setNotes(event.target.value)} style={styles.textarea} placeholder="Review notes" aria-label="Review notes" />
            </div>
            <div style={styles.actionButtons}>
              <button onClick={() => void submitReview("case")} disabled={action !== null || Boolean(comparison.case_id)} style={styles.caseButton}>{comparison.case_id ? "Case already created" : action === "case" ? "Creating case…" : "Create case"}</button>
              <button onClick={() => void submitReview("field-verification")} disabled={action !== null} style={styles.verifyButton}>{action === "field-verification" ? "Requesting…" : "Request field verification"}</button>
              <button onClick={() => void submitReview("not-duplicate")} disabled={action !== null} style={styles.dismissButton}>{action === "not-duplicate" ? "Saving…" : "Mark not duplicate"}</button>
            </div>
          </section>
        ) : (
          <section style={{ ...styles.actionCard, gridTemplateColumns: "1fr" }}>
            <div>
              <h2 style={styles.sectionTitle}>Review Status: {prettyStatus(match.status)}</h2>
              <p style={styles.actionDescription}>Read-only candidate view. According to the platform Permission Matrix, only District Authority and System Admin have permission to create investigation cases or update duplicate match decisions.</p>
            </div>
          </section>
        )}
      </div>
      <style>{`@keyframes comparison-spin{to{transform:rotate(360deg)}} @keyframes comparison-shimmer{100%{background-position:-200% 0}} button:hover:not(:disabled){opacity:.86}`}</style>
    </main>
  );
}

function WorkPanel({ heading, work, color }: { heading: string; work: DuplicateWorkSummary; color: string }) {
  const financialProgress = work.sanctioned_amount > 0 ? (work.actual_expenditure / work.sanctioned_amount) * 100 : 0;
  return <article style={{ ...styles.workCard, borderTopColor: color }}>
    <p style={{ ...styles.workHeading, color }}>{heading}</p>
    <h2 style={styles.workTitle}>{work.title}</h2>
    <p style={styles.workId}>{work.work_id}</p>
    {work.description && <p style={styles.description}>{work.description}</p>}
    <div style={styles.fieldGrid}>
      <Field label="Category" value={labelFor(work.category)} />
      <Field label="Status" value={labelFor(work.status)} />
      <Field label="Location" value={[work.district_name, work.state_name].filter(Boolean).join(", ") || "Not recorded"} />
      <Field label="Agency" value={work.implementing_agency || "Not recorded"} />
      <Field label="Vendor / contractor" value={work.vendor_name || "Not recorded"} />
      <Field label="Sanctioned" value={formatCurrency(work.sanctioned_amount)} />
      <Field label="Funds released" value={formatCurrency(work.funds_released)} />
      <Field label="Actual expenditure" value={formatCurrency(work.actual_expenditure)} />
      <Field label="Financial progress" value={`${financialProgress.toFixed(1)}%`} />
      <Field label="Physical progress" value={`${work.physical_progress_pct.toFixed(1)}%`} />
      <Field label="Started" value={formatDate(work.start_date || work.sanctioned_date)} />
      <Field label="Expected completion" value={formatDate(work.expected_completion_date)} />
    </div>
    <div style={{ marginTop: "1rem", paddingTop: "0.75rem", borderTop: "1px solid #f1f5f9", textAlign: "right" }}>
      <a href={`/dashboard/works/${work.work_id}?focus=duplicate`} style={{ fontSize: "0.78rem", fontWeight: 650, color: "#2563eb", textDecoration: "none" }}>
        View & Verify Work Dossier →
      </a>
    </div>
  </article>;
}

function Field({ label, value }: { label: string; value: string }) { return <div><span style={styles.fieldLabel}>{label}</span><span style={styles.fieldValue}>{value}</span></div>; }
function Signal({ label, value, detail }: { label: string; value: string; detail: string }) { return <article style={styles.signal}><span style={styles.signalLabel}>{label}</span><strong style={styles.signalValue}>{value}</strong><span style={styles.signalDetail}>{detail}</span></article>; }
function prettyStatus(status: string): string { return status.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase()); }
function labelFor(value: string): string { return value.replace(/_/g, " ").replace(/\b\w/g, (character) => character.toUpperCase()); }

function PageState({ title, detail, icon, actionLabel, onAction }: { title: string; detail: string; icon: string; actionLabel?: string; onAction?: () => void }) { return <main style={styles.page}><section style={styles.state}><span style={styles.stateIcon}>{icon}</span><h1 style={styles.stateTitle}>{title}</h1><p style={styles.stateDetail}>{detail}</p>{actionLabel && onAction ? <button onClick={onAction} style={styles.caseButton}>{actionLabel}</button> : null}</section></main>; }
function LoadingPage() { return <main style={styles.page}><div style={styles.container}><div style={{ ...styles.skeleton, width: "25%" }} /><div style={{ ...styles.skeleton, width: "55%", height: 32, marginTop: 14 }} /><div style={styles.workGrid}>{[1, 2].map((value) => <div key={value} style={styles.skeletonWork}><div style={{ ...styles.skeleton, width: "45%" }} /><div style={{ ...styles.skeleton, width: "100%", height: 24, marginTop: 14 }} /><div style={{ ...styles.skeleton, width: "100%", height: 200, marginTop: 18 }} /></div>)}</div></div></main>; }
function PageSpinner() { return <main style={styles.page}><div style={styles.spinner} /><style>{`@keyframes comparison-spin{to{transform:rotate(360deg)}}`}</style></main>; }

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", padding: "1.5rem", background: "#ffffff", fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' },
  container: { maxWidth: 1440, margin: "0 auto" },
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", marginBottom: "1rem" },
  back: { padding: 0, border: 0, background: "transparent", color: "#475569", cursor: "pointer", fontSize: ".78rem" },
  eyebrow: { margin: ".8rem 0 .25rem", color: "#2563eb", textTransform: "uppercase" as const, letterSpacing: ".1em", fontSize: ".68rem", fontWeight: 700 },
  title: { margin: 0, color: "#0f172a", letterSpacing: "-.035em", fontSize: "clamp(1.7rem,3vw,2.25rem)", fontWeight: 700 },
  subtitle: { margin: ".45rem 0 0", maxWidth: 760, color: "#64748b", fontSize: ".87rem", lineHeight: 1.5 },
  scoreBox: { minWidth: 105, textAlign: "center" as const, padding: ".75rem", background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 12 },
  scoreValue: { display: "block", color: "#6d28d9", fontSize: "1.45rem", fontWeight: 750 },
  scoreLabel: { display: "block", marginTop: ".2rem", color: "#7c3aed", fontSize: ".65rem", fontWeight: 600 },
  notice: { marginBottom: ".75rem", padding: ".75rem .9rem", background: "#f5f3ff", border: "1px solid #ddd6fe", borderRadius: 10, color: "#5b21b6", fontSize: ".8rem", lineHeight: 1.5 },
  success: { marginBottom: ".75rem", padding: ".65rem .8rem", borderRadius: 8, background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#166534", fontSize: ".78rem" },
  error: { marginBottom: ".75rem", padding: ".65rem .8rem", borderRadius: 8, background: "#fef2f2", border: "1px solid #fecaca", color: "#991b1b", fontSize: ".78rem" },
  workGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(330px,1fr))", gap: ".75rem", marginBottom: ".75rem" },
  workCard: { padding: "1rem", minWidth: 0, background: "#ffffff", border: "1px solid #e2e8f0", borderTopWidth: 3, borderRadius: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" },
  workHeading: { margin: 0, fontSize: ".7rem", fontWeight: 750, textTransform: "uppercase" as const, letterSpacing: ".08em" },
  workTitle: { margin: ".45rem 0 0", color: "#0f172a", fontSize: "1.08rem", lineHeight: 1.35, fontWeight: 700 },
  workId: { margin: ".3rem 0 0", color: "#64748b", fontSize: ".68rem", fontFamily: "monospace" },
  description: { minHeight: 42, margin: ".65rem 0", color: "#475569", fontSize: ".76rem", lineHeight: 1.45 },
  fieldGrid: { display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: ".65rem", marginTop: ".7rem", paddingTop: ".7rem", borderTop: "1px solid #e2e8f0" },
  fieldLabel: { display: "block", color: "#64748b", textTransform: "uppercase" as const, letterSpacing: ".04em", fontSize: ".59rem", fontWeight: 700 },
  fieldValue: { display: "block", marginTop: ".2rem", color: "#0f172a", fontSize: ".74rem", lineHeight: 1.35, overflowWrap: "anywhere", fontWeight: 600 },
  signalCard: { marginBottom: ".75rem", padding: "1rem", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" },
  sectionTitle: { margin: 0, color: "#0f172a", fontSize: ".95rem", fontWeight: 700 },
  signalGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(185px,1fr))", gap: ".55rem", marginTop: ".75rem" },
  signal: { minHeight: 88, padding: ".7rem", borderRadius: 9, border: "1px solid #e2e8f0", background: "#f8fafc" },
  signalLabel: { display: "block", color: "#64748b", fontSize: ".66rem", fontWeight: 700 },
  signalValue: { display: "block", marginTop: ".38rem", color: "#2563eb", fontSize: ".85rem", lineHeight: 1.35, fontWeight: 700 },
  signalDetail: { display: "block", marginTop: ".35rem", color: "#64748b", fontSize: ".65rem", lineHeight: 1.35 },
  signalList: { margin: ".8rem 0 0", paddingLeft: "1.05rem", color: "#334155", fontSize: ".76rem", lineHeight: 1.65 },
  actionCard: { display: "grid", gridTemplateColumns: "minmax(210px,.6fr) minmax(260px,1fr)", gap: "1rem", alignItems: "start", marginTop: ".75rem", padding: "1rem", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" },
  actionDescription: { margin: ".35rem 0 0", color: "#64748b", fontSize: ".74rem", lineHeight: 1.45 },
  actionInputs: { display: "grid", gap: ".55rem" },
  input: { width: "100%", boxSizing: "border-box" as const, padding: ".55rem .65rem", color: "#0f172a", background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 7, fontSize: ".76rem" },
  textarea: { width: "100%", minHeight: 80, boxSizing: "border-box" as const, resize: "vertical" as const, padding: ".55rem .65rem", color: "#0f172a", background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 7, fontFamily: "inherit", fontSize: ".76rem" },
  actionButtons: { gridColumn: "1 / -1", display: "flex", flexWrap: "wrap", gap: ".55rem" },
  caseButton: { padding: ".52rem .7rem", color: "#ffffff", background: "#7c3aed", border: "1px solid #7c3aed", borderRadius: 7, cursor: "pointer", fontSize: ".74rem", fontWeight: 700 },
  verifyButton: { padding: ".52rem .7rem", color: "#92400e", background: "#fef3c7", border: "1px solid #fde68a", borderRadius: 7, cursor: "pointer", fontSize: ".74rem", fontWeight: 700 },
  dismissButton: { padding: ".52rem .7rem", color: "#475569", background: "#f1f5f9", border: "1px solid #cbd5e1", borderRadius: 7, cursor: "pointer", fontSize: ".74rem", fontWeight: 700 },
  state: { minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "1.5rem", textAlign: "center" as const, background: "#ffffff" },
  stateIcon: { color: "#7c3aed", fontSize: "2rem" },
  stateTitle: { margin: ".7rem 0 0", color: "#0f172a", fontSize: "1.15rem", fontWeight: 700 },
  stateDetail: { maxWidth: 470, margin: ".45rem 0 1rem", color: "#64748b", fontSize: ".85rem", lineHeight: 1.5 },
  skeletonWork: { minHeight: 330, padding: "1rem", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 14 },
  skeleton: { height: 12, borderRadius: 6, background: "#f1f5f9" },
  spinner: { width: 34, height: 34, margin: "35vh auto", border: "3px solid rgba(0,0,0,.1)", borderTopColor: "#2563eb", borderRadius: "50%", animation: "comparison-spin .75s linear infinite" },
  muted: { marginTop: "35vh", color: "#64748b", textAlign: "center" as const },
};
