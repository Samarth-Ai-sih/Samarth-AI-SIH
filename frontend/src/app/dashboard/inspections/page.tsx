"use client";

import { useAuth } from "@/lib/auth";
import { CaseListResponse, CaseRecord, formatDateTime } from "@/lib/api";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useState } from "react";

const API = "/api/v1/cases";

export default function AssignedInspectionsPage() {
  const { user, fetchWithAuth, isLoading: authLoading } = useAuth(); const router = useRouter();
  const [tasks, setTasks] = useState<CaseRecord[]>([]); const [loading, setLoading] = useState(true); const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => { setLoading(true); setError(null); try { const response = await fetchWithAuth(`${API}/assigned?page=1&page_size=100`); if (response.status === 403) { setError("PERMISSION_DENIED"); return; } if (!response.ok) { const body = await response.json().catch(() => ({ detail: "Could not load assigned inspections." })); throw new Error(body.detail || "Could not load assigned inspections."); } const payload: CaseListResponse = await response.json(); setTasks(payload.cases); } catch (cause: unknown) { setError(cause instanceof Error ? cause.message : "Could not load assigned inspections."); } finally { setLoading(false); } }, [fetchWithAuth]);
  useEffect(() => { if (authLoading || !user) return; const timer = window.setTimeout(() => { void load(); }, 0); return () => window.clearTimeout(timer); }, [authLoading, load, user]);
  if (authLoading) return <Spinner />; if (!user) return <main style={s.page}><p style={s.muted}>Not authenticated. Redirecting…</p></main>;
  return <main style={s.page}><div style={s.container}><header style={s.header}><div><button onClick={() => router.push("/dashboard")} style={s.back}>← Dashboard</button><p style={s.eyebrow}>Phase 13 · Field workflow</p><h1 style={s.title}>Assigned inspections</h1><p style={s.subtitle}>Only cases explicitly assigned to your inspector account are shown here.</p></div><button onClick={() => void load()} style={s.refresh}>Refresh</button></header>
    {error === "PERMISSION_DENIED" ? <State icon="🔒" title="Inspector access required" detail="Only field inspector accounts can open assigned inspection tasks." /> : error ? <State icon="⚠" title="Tasks could not load" detail={error} /> : loading ? <Loading /> : tasks.length === 0 ? <State icon="◌" title="No assigned inspections" detail="New assignments will appear here after the District Authority assigns you to a case." /> : <section style={s.grid}>{tasks.map((task) => <article key={task.case_id} style={s.card}><div style={s.cardTop}><span style={s.status}>{task.status.replaceAll("_", " ")}</span><span style={s.severity}>{task.severity}</span></div><h2 style={s.cardTitle}>{task.title}</h2><p style={s.workId}>Work {task.work_id}</p><p style={s.description}>{task.description || "Field inspection assigned by District Authority."}</p><div style={s.meta}><span>Due: {task.due_date ? formatDateTime(task.due_date) : "Not set"}</span><span>{task.inspection_reports.length} submitted report(s)</span></div><button onClick={() => router.push(`/dashboard/inspections/${task.case_id}`)} style={s.open}>📍 Review Site & Navigate (B-Tree Map)</button></article>)}</section>}
  </div><style>{`@keyframes inspection-spin{to{transform:rotate(360deg)}} @keyframes inspection-shimmer{100%{background-position:-200% 0}} button:hover:not(:disabled){opacity:.86}`}</style></main>;
}

function State({ icon, title, detail }: { icon: string; title: string; detail: string }) { return <section style={s.state}><span style={s.stateIcon}>{icon}</span><h2 style={s.stateTitle}>{title}</h2><p style={s.stateDetail}>{detail}</p></section>; }
function Loading() { return <section style={s.grid}>{Array.from({ length: 4 }).map((_, i) => <div key={i} style={s.skeleton} />)}</section>; }
function Spinner() { return <main style={s.page}><div style={s.spinner} /><style>{`@keyframes inspection-spin{to{transform:rotate(360deg)}}`}</style></main>; }
const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", padding: "1.5rem", background: "#ffffff", fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' },
  container: { maxWidth: 1240, margin: "0 auto" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", marginBottom: "1rem" },
  back: { border: 0, padding: 0, background: "transparent", color: "#475569", cursor: "pointer", fontSize: ".78rem" },
  eyebrow: { margin: ".8rem 0 .25rem", color: "#2563eb", fontSize: ".68rem", letterSpacing: ".1em", fontWeight: 700, textTransform: "uppercase" as const },
  title: { margin: 0, color: "#0f172a", fontSize: "clamp(1.7rem,3vw,2.25rem)", letterSpacing: "-.035em", fontWeight: 700 },
  subtitle: { margin: ".45rem 0 0", color: "#64748b", fontSize: ".86rem", lineHeight: 1.5 },
  refresh: { padding: ".55rem .8rem", borderRadius: 8, border: "1px solid #cbd5e1", color: "#0f172a", background: "#ffffff", cursor: "pointer", fontWeight: 600, fontSize: ".75rem" },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: ".75rem" },
  card: { padding: "1rem", borderRadius: 14, border: "1px solid #e2e8f0", background: "#ffffff", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" },
  cardTop: { display: "flex", justifyContent: "space-between", gap: ".5rem" },
  status: { color: "#2563eb", textTransform: "capitalize" as const, fontSize: ".67rem", fontWeight: 700 },
  severity: { color: "#c2410c", textTransform: "uppercase" as const, fontSize: ".65rem", fontWeight: 750 },
  cardTitle: { margin: ".65rem 0 0", color: "#0f172a", fontSize: "1rem", fontWeight: 700 },
  workId: { margin: ".28rem 0 0", color: "#64748b", fontSize: ".69rem", fontFamily: "monospace" },
  description: { minHeight: 38, color: "#475569", fontSize: ".75rem", lineHeight: 1.45 },
  meta: { display: "grid", gap: ".22rem", color: "#64748b", fontSize: ".68rem" },
  open: { marginTop: ".8rem", border: "1px solid #2563eb", borderRadius: 7, padding: ".48rem .58rem", color: "#ffffff", background: "#2563eb", cursor: "pointer", fontSize: ".72rem", fontWeight: 700 },
  state: { minHeight: 340, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" as const, border: "1px solid #e2e8f0", borderRadius: 14, background: "#ffffff" },
  stateIcon: { fontSize: "2.2rem" },
  stateTitle: { margin: ".75rem 0 0", color: "#0f172a", fontWeight: 700 },
  stateDetail: { maxWidth: 480, color: "#64748b", lineHeight: 1.5, fontSize: ".83rem" },
  skeleton: { height: 230, borderRadius: 14, background: "#f1f5f9" },
  spinner: { width: 34, height: 34, margin: "35vh auto", border: "3px solid rgba(0,0,0,.1)", borderTopColor: "#2563eb", borderRadius: "50%", animation: "inspection-spin .75s linear infinite" },
  muted: { marginTop: "35vh", color: "#64748b", textAlign: "center" as const }
};
