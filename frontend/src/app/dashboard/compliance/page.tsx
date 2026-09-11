"use client";

import Link from "next/link";
import { useState } from "react";
import type { ReactNode } from "react";
import { CheckCircle2, FileSearch, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { ComplianceResultList, ComplianceRuleList, formatDate } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAuthenticatedQuery } from "@/lib/query";
import { ExportReportButton } from "@/components/reports/export-report-button";
import { PrintableReport, ReportSection } from "@/lib/export-report";

export default function ComplianceCenterPage() {
  const { user } = useAuth();
  const canReadCompliance = ["admin", "mospi", "state_nodal_officer", "district_authority"].includes(user?.role || "");

  const [severity, setSeverity] = useState("all");
  const resultUrl = `/api/v1/compliance/results?page=1&page_size=50${severity === "all" ? "" : `&severity=${severity}`}`;
  const results = useAuthenticatedQuery<ComplianceResultList>(
    ["compliance-results", severity],
    resultUrl,
    { enabled: canReadCompliance }
  );
  const rules = useAuthenticatedQuery<ComplianceRuleList>(
    ["compliance-rules"],
    "/api/v1/compliance/rules",
    { enabled: canReadCompliance }
  );

  if (!canReadCompliance) {
    return (
      <ErrorState
        title="Access denied"
        description="Your role does not have permission to view compliance records according to the platform permission matrix."
      />
    );
  }

  if (results.isLoading || rules.isLoading) return <LoadingState label="Loading compliance signals…" />;
  if (results.isError) return <ErrorState description={(results.error as Error).message} onRetry={() => void results.refetch()} />;
  const items = results.data?.results || [];

  const getComplianceExportData = () => {
    const listToExport = items;
    const activeRules = rules.data?.rules || [];

    const sections: ReportSection[] = [
      {
        title: "Compliance Outcomes & Review Queue",
        type: "table",
        headers: ["Rule Code", "Work ID", "Severity", "Detected Date", "Review Status", "Violation / Advisory Message"],
        rows: listToExport.map((item) => [
          item.rule_code,
          item.work_id,
          item.severity.toUpperCase(),
          item.triggered_at ? formatDate(item.triggered_at) : "—",
          item.review_status.replaceAll("_", " ").toUpperCase(),
          item.message,
        ]),
      },
    ];

    if (activeRules.length > 0) {
      sections.push({
        title: "Active Statutory & Guidelines Rules Register",
        type: "table",
        headers: ["Rule Code", "Rule Name", "Category", "Severity", "Status", "Description"],
        rows: activeRules.map((r) => [
          r.rule_code,
          r.name,
          r.category,
          r.severity.toUpperCase(),
          r.enabled ? "ACTIVE" : "DISABLED",
          r.description,
        ]),
      });
    }

    const report: PrintableReport = {
      title: "MPLADS COMPLIANCE & STATUTORY RULES AUDIT REPORT",
      subtitle: `Statutory Guidelines & Norms Deviation Register (${listToExport.length} outcomes recorded)`,
      categoryBadge: "REGULATORY COMPLIANCE",
      generatedBy: user ? `${user.full_name} (${user.role.replace(/_/g, " ").toUpperCase()})` : "Authorised Official",
      jurisdiction: user?.jurisdiction?.district_code || user?.jurisdiction?.state_code || "National Oversight",
      metadata: [
        { label: "Active Rules Configured", value: String(activeRules.filter((r) => r.enabled).length) },
        { label: "Outcomes in View", value: String(listToExport.length) },
        { label: "Pending Review", value: String(listToExport.filter((i) => i.review_status === "pending_review").length) },
        { label: "Critical Severity", value: String(listToExport.filter((i) => i.severity === "critical").length) },
        { label: "Warning Severity", value: String(listToExport.filter((i) => i.severity === "warning").length) },
        { label: "Active Severity Filter", value: severity.toUpperCase() },
      ],
      sections,
      signOff: {
        designation: "Technical Examiner / Compliance Inspection Officer",
        office: "Ministry of Statistics & Programme Implementation (MoSPI)",
      },
    };

    const csvHeaders = [
      "Record Type",
      "Rule Code",
      "Work ID / Rule Name",
      "Severity",
      "Status",
      "Date",
      "Message / Description",
    ];

    const csvRows: (string | number)[][] = listToExport.map((i) => [
      "Outcome",
      i.rule_code,
      i.work_id,
      i.severity,
      i.review_status,
      i.triggered_at || "",
      i.message,
    ]);

    activeRules.forEach((r) => {
      csvRows.push([
        "Rule Definition",
        r.rule_code,
        r.name,
        r.severity,
        r.enabled ? "Active" : "Disabled",
        r.created_at || "",
        r.description,
      ]);
    });

    return {
      report,
      csv: { headers: csvHeaders, rows: csvRows },
      json: { outcomes: listToExport, rules: activeRules },
    };
  };

  return <>
    <PageHeader
      eyebrow="Controls and review"
      title="Compliance Center"
      description="Review rules and their persisted outcome records. A deviation is a workflow signal and requires verification."
      actions={
        <div className="flex items-center gap-2">
          <ExportReportButton
            label="Export Compliance Report"
            filename="MPLADS_Compliance_Audit_Report"
            getReportData={getComplianceExportData}
          />
          <Button variant="outline" onClick={() => { void results.refetch(); void rules.refetch(); }}>
            <RefreshCw className="h-4 w-4" />Refresh
          </Button>
        </div>
      }
    />
    <section className="mb-6 grid gap-4 sm:grid-cols-3" aria-label="Compliance summary"><Summary label="Active rules" value={String(rules.data?.rules.filter((rule) => rule.enabled).length ?? "—")} icon={<CheckCircle2 className="h-5 w-5" />} /><Summary label="Results in view" value={String(results.data?.total ?? "—")} icon={<FileSearch className="h-5 w-5" />} /><Summary label="Pending review" value={String(items.filter((result) => result.review_status === "pending_review").length)} icon={<FileSearch className="h-5 w-5" />} /></section>
    <div className="mb-5 flex flex-wrap gap-2" role="group" aria-label="Filter by severity">{["all", "critical", "warning", "advisory"].map((item) => <Button key={item} size="sm" variant={item === severity ? "default" : "outline"} className="capitalize" onClick={() => setSeverity(item)}>{item === "all" ? "All outcomes" : item}</Button>)}</div>
    {!items.length ? <EmptyState title="No compliance outcomes in this view" description="Run authorised compliance checks on work records to populate a review queue." action={<Button asChild><Link href="/dashboard/works">Open work register</Link></Button>} /> : <Card><CardHeader><CardTitle>Review queue</CardTitle><CardDescription>Each result retains its source data and review status.</CardDescription></CardHeader><CardContent className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="border-b border-sky-100 text-xs uppercase tracking-wide text-slate-500"><tr><th className="pb-3 font-semibold">Rule / work</th><th className="pb-3 font-semibold">Signal</th><th className="pb-3 font-semibold">Review</th><th className="pb-3 font-semibold">Detected</th><th className="pb-3 text-right font-semibold">Action</th></tr></thead><tbody>{items.map((item) => <tr key={item.result_id} className="border-b border-slate-100 last:border-0"><td className="py-4"><p className="font-semibold text-slate-900">{item.rule_code}</p><p className="mt-1 text-xs text-slate-500">{item.work_id}</p></td><td className="py-4"><Badge variant={item.severity === "critical" ? "danger" : item.severity === "warning" ? "warning" : "info"}>{item.severity}</Badge><p className="mt-1 max-w-sm text-xs text-slate-600">{item.message}</p></td><td className="py-4 capitalize text-slate-700">{item.review_status.replaceAll("_", " ")}</td><td className="py-4 text-slate-600">{formatDate(item.triggered_at)}</td><td className="py-4 text-right"><Button size="sm" variant="ghost" asChild><Link href={`/dashboard/works/${item.work_id}?focus=compliance`}>Open & verify</Link></Button></td></tr>)}</tbody></table></CardContent></Card>}
  </>;
}
function Summary({ label, value, icon }: { label: string; value: string; icon: ReactNode }) { return <Card><CardContent className="flex items-center gap-3 p-4"><span className="rounded-lg bg-sky-100 p-2 text-sky-800">{icon}</span><div><p className="text-xl font-bold text-slate-950">{value}</p><p className="text-xs text-slate-500">{label}</p></div></CardContent></Card>; }
