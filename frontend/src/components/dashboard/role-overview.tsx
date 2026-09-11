"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { PageHeader } from "@/components/ui/page-header";
import { ApiError, useAuthenticatedQuery } from "@/lib/query";
import { useAuth } from "@/lib/auth";
import { CaseListResponse, FinancialDashboardResponse, RiskDistribution, WorkListResponse, formatCurrency, formatDate } from "@/lib/api";
import { AlertTriangle, ArrowRight, ClipboardCheck, FileWarning, MapPin, ShieldAlert, WalletCards } from "lucide-react";
import Link from "next/link";

type RoleCopy = { eyebrow: string; title: string; description: string; queueLabel: string; queueHref: string; };
const roleCopy: Record<string, RoleCopy> = {
  admin: { eyebrow: "System administration", title: "Programme operations overview", description: "Monitor delivery, review queues, and access workflow tools across the platform.", queueLabel: "Open case management", queueHref: "/dashboard/cases" },
  mospi: { eyebrow: "MoSPI dashboard", title: "National programme oversight", description: "Review the current portfolio, delivery signals, and escalation queues across assigned jurisdictions.", queueLabel: "Open risk alert center", queueHref: "/dashboard/risk" },
  state_nodal_officer: { eyebrow: "State dashboard", title: "State delivery overview", description: "Review programme progress and queues for your state jurisdiction.", queueLabel: "Open compliance center", queueHref: "/dashboard/compliance" },
  district_authority: { eyebrow: "District dashboard", title: "District delivery and review", description: "Prioritise local work queues, field findings, cases, and citizen social-audit reports.", queueLabel: "Open case management", queueHref: "/dashboard/cases" },
  mp: { eyebrow: "MP dashboard", title: "Constituency works overview", description: "Review public work delivery, milestones, and decision-support alerts for your constituency.", queueLabel: "Open work register", queueHref: "/dashboard/works" },
  agency: { eyebrow: "Agency workspace", title: "Implementing agency workspace", description: "Use the work register to keep assigned delivery records current and respond to workflow requests.", queueLabel: "Open work register", queueHref: "/dashboard/works" },
  inspector: { eyebrow: "Inspector workspace", title: "Field inspection queue", description: "Open assigned tasks, capture field evidence safely, and submit inspection reports from any device.", queueLabel: "Open assigned inspections", queueHref: "/dashboard/inspections" },
};
const workRoles = new Set(["admin", "mospi", "state_nodal_officer", "district_authority", "mp", "agency"]);
const riskRoles = new Set(["admin", "mospi", "state_nodal_officer", "mp"]);
const financeRoles = new Set(["admin", "mospi", "state_nodal_officer", "district_authority", "mp"]);
const managerRoles = new Set(["admin", "mospi", "state_nodal_officer", "district_authority"]);

export function RoleOverview() {
  const { user } = useAuth();
  const role = user?.role || "agency"; const copy = roleCopy[role] || roleCopy.agency;
  const works = useAuthenticatedQuery<WorkListResponse>(["overview", "works", role], "/api/v1/works?page=1&page_size=5&sort_by=updated_at&sort_order=desc", { enabled: workRoles.has(role) });
  const risks = useAuthenticatedQuery<RiskDistribution>(["overview", "risk", role], "/api/v1/risk/distribution", { enabled: riskRoles.has(role) });
  const finance = useAuthenticatedQuery<FinancialDashboardResponse>(["overview", "finance", role], "/api/v1/financial-intelligence/dashboard", { enabled: financeRoles.has(role) });
  const cases = useAuthenticatedQuery<CaseListResponse>(["overview", "cases", role], role === "inspector" ? "/api/v1/cases/assigned?page=1&page_size=5" : "/api/v1/cases?page=1&page_size=5", { enabled: role === "inspector" || managerRoles.has(role) });
  const primary = role === "inspector" ? cases : works;
  const queryErrors = [works, risks, finance, cases].filter((query) => query.isError && !(query.error instanceof ApiError && query.error.status === 403));
  if (primary.isLoading) return <LoadingState label="Loading your assigned workspace…" />;
  if (queryErrors.length && !primary.data) return <ErrorState description={(queryErrors[0].error as Error).message} onRetry={() => void primary.refetch()} />;
  const workList = works.data?.works || [];
  const caseCount = cases.data?.total;
  return <>
    <PageHeader eyebrow={copy.eyebrow} title={copy.title} description={copy.description} actions={<Button asChild><Link href={copy.queueHref}>{copy.queueLabel}<ArrowRight className="h-4 w-4" /></Link></Button>} />
    {user?.must_change_password && <div role="alert" className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950"><strong>Account action required.</strong> Change your temporary password in Settings before continuing with sensitive approvals.</div>}
    <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-label="Portfolio summary">
      {role === "inspector" ? (
        <Metric icon={ClipboardCheck} label="Assigned inspections" value={valueOrDash(caseCount)} detail="Tasks awaiting your field update" tone="sky" />
      ) : (
        <Metric icon={ClipboardCheck} label="Works in scope" value={valueOrDash(works.data?.total)} detail="Current accessible work records" tone="sky" />
      )}
      {riskRoles.has(role) && (
        <Metric icon={ShieldAlert} label="Red risk alerts" value={valueOrDash(risks.data?.red)} detail={risks.data ? `${risks.data.total} scored work records` : "Active priority alerts"} tone="red" />
      )}
      {(managerRoles.has(role) || role === "inspector") && (
        <Metric icon={FileWarning} label={role === "inspector" ? "Active tasks" : "Open review cases"} value={valueOrDash(caseCount)} detail="Current lifecycle queue" tone="amber" />
      )}
      {financeRoles.has(role) && (
        <Metric icon={WalletCards} label="Amount at review priority" value={finance.data ? formatCurrency(finance.data.summary.amount_at_risk) : "—"} detail={finance.data ? "Decision-support amount, not loss" : "Fiscal intelligence monitor"} tone="green" />
      )}
    </section>
    <section className="mt-6 grid gap-6 xl:grid-cols-[1.45fr_.9fr]">
      <Card><CardHeader className="flex-row items-start justify-between gap-4"><div><CardTitle>{role === "inspector" ? "Assigned task queue" : "Recently updated work records"}</CardTitle><CardDescription>{role === "inspector" ? "Open a task to capture checklist, GPS, and private evidence." : "Search-first register with current delivery information."}</CardDescription></div><Button variant="outline" size="sm" asChild><Link href={role === "inspector" ? "/dashboard/inspections" : "/dashboard/works"}>View all</Link></Button></CardHeader><CardContent>{role === "inspector" ? <CaseQueue data={cases.data} /> : <WorkQueue data={workList} />}</CardContent></Card>
      <Card><CardHeader><CardTitle>Next actions</CardTitle><CardDescription>Suggested routes use your currently available queues; no synthetic assignments are shown.</CardDescription></CardHeader><CardContent className="space-y-3"><Action href={copy.queueHref} icon={role === "inspector" ? MapPin : ClipboardCheck} title={copy.queueLabel} description={role === "inspector" ? "Complete field updates from a mobile-friendly workflow." : "Review your status-based queue and record the next decision."} /><Action href="/dashboard/works" icon={ClipboardCheck} title="Search work records" description="Find a work by title, ID, MP, agency, or category." visible={workRoles.has(role)} /><Action href="/dashboard/citizen-reports" icon={AlertTriangle} title="Review citizen reports" description="Moderate public ground issues using restricted internal records." visible={managerRoles.has(role)} /></CardContent></Card>
    </section>
    {role !== "inspector" && workList.length === 0 && works.data && <div className="mt-6"><EmptyState title="No work records in this view" description="Adjust jurisdiction assignments or add an authorised work record to begin managing delivery." action={<Button asChild><Link href="/dashboard/works">Open work register</Link></Button>} /></div>}
  </>;
}

function valueOrDash(value: number | undefined) { return value === undefined ? "—" : value.toLocaleString("en-IN"); }
function Metric({ icon: Icon, label, value, detail, tone }: { icon: typeof ClipboardCheck; label: string; value: string; detail: string; tone: "sky" | "red" | "amber" | "green" }) { const colors = { sky: "bg-blue-50 text-blue-700", red: "bg-red-50 text-red-700", amber: "bg-amber-50 text-amber-700", green: "bg-emerald-50 text-emerald-700" }; return <Card className="border-slate-200 bg-white shadow-xs"><CardContent className="p-5"><div className="flex items-start justify-between gap-3"><div><p className="text-sm font-medium text-slate-600">{label}</p><p className="mt-2 text-2xl font-bold tracking-tight text-slate-950">{value}</p></div><span className={`grid h-9 w-9 place-items-center rounded-lg ${colors[tone]}`}><Icon className="h-4 w-4" aria-hidden="true" /></span></div><p className="mt-2 text-xs leading-5 text-slate-500">{detail}</p></CardContent></Card>; }
function WorkQueue({ data }: { data: WorkListResponse["works"] }) { if (!data.length) return <p className="py-8 text-sm text-slate-500">No recently updated work records are available in this scope.</p>; return <div className="divide-y divide-slate-100">{data.map((work) => <Link key={work.work_id} href={`/dashboard/works/${work.work_id}`} className="flex items-center justify-between gap-4 py-3 first:pt-0 hover:text-blue-700"><div className="min-w-0"><p className="truncate text-sm font-semibold text-slate-900">{work.title}</p><p className="mt-1 text-xs text-slate-500">{work.work_id} · {work.district_name || work.state_name || "Location unavailable"}</p></div><div className="shrink-0 text-right"><Badge variant={work.risk_tier === "red" ? "danger" : work.risk_tier === "amber" ? "warning" : "success"}>{work.status.replaceAll("_", " ")}</Badge><p className="mt-1 text-xs text-slate-500">{work.physical_progress_pct}% physical</p></div></Link>)}</div>; }
function CaseQueue({ data }: { data?: CaseListResponse }) { if (!data?.cases.length) return <p className="py-8 text-sm text-slate-500">No assigned inspection tasks are currently available.</p>; return <div className="divide-y divide-slate-100">{data.cases.map((item) => <Link key={item.case_id} href={`/dashboard/inspections/${item.case_id}`} className="flex items-center justify-between gap-4 py-3 first:pt-0 hover:text-blue-700"><div><p className="text-sm font-semibold text-slate-900">{item.title}</p><p className="mt-1 text-xs text-slate-500">{item.work_id} · Due {formatDate(item.due_date)}</p></div><Badge variant={item.severity === "critical" ? "danger" : item.severity === "high" ? "warning" : "info"}>{item.status.replaceAll("_", " ")}</Badge></Link>)}</div>; }
function Action({ href, icon: Icon, title, description, visible = true }: { href: string; icon: typeof ClipboardCheck; title: string; description: string; visible?: boolean }) { if (!visible) return null; return <Link href={href} className="flex gap-3 rounded-lg border border-slate-200 bg-white p-3 hover:border-slate-300 hover:bg-slate-50 shadow-2xs transition-colors"><span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700"><Icon className="h-4 w-4" /></span><span><strong className="text-sm text-slate-900">{title}</strong><span className="mt-0.5 block text-xs leading-5 text-slate-500">{description}</span></span></Link>; }
