"use client";

import { useMemo } from "react";
import type { ReactNode } from "react";
import type { EChartsOption } from "echarts";
import { BarChart3, Download, LineChart, PieChart } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { FinancialChart } from "@/components/financial/FinancialChart";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { FinancialDashboardResponse, RiskDistribution, formatCurrency } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAuthenticatedQuery } from "@/lib/query";
import { ExportReportButton } from "@/components/reports/export-report-button";
import { PrintableReport } from "@/lib/export-report";

export default function AnalyticsReportsPage() {
  const { user } = useAuth();
  const role = user?.role || "";
  const canReadRisk = ["admin", "mospi", "state_nodal_officer", "mp"].includes(role);
  const canReadFinance = ["admin", "mospi", "state_nodal_officer", "district_authority", "mp"].includes(role);

  if (!canReadRisk && !canReadFinance) {
    return <ErrorState title="Access denied" description="Your role does not have permission to view analytics reports according to the platform permission matrix." />;
  }

  const finance = useAuthenticatedQuery<FinancialDashboardResponse>(["analytics", "financial"], "/api/v1/financial-intelligence/dashboard", { enabled: canReadFinance });
  const risk = useAuthenticatedQuery<RiskDistribution>(["analytics", "risk"], "/api/v1/risk/distribution", { enabled: canReadRisk });
  const hasData = Boolean(finance.data || risk.data);
  const spendOption = useMemo<EChartsOption>(() => ({ tooltip: { trigger: "axis" }, grid: { left: 55, right: 18, top: 32, bottom: 36 }, xAxis: { type: "category", data: finance.data?.amount_at_risk_trend.map((item) => item.period) || [], axisLabel: { color: "#64748b" } }, yAxis: { type: "value", axisLabel: { color: "#64748b" } }, series: [{ name: "Amount at review priority", type: "line", smooth: true, data: finance.data?.amount_at_risk_trend.map((item) => item.amount_at_risk) || [], itemStyle: { color: "#0284c7" }, areaStyle: { color: "rgba(14, 165, 233, .15)" } }] }), [finance.data]);
  const riskOption = useMemo<EChartsOption>(() => ({ tooltip: { trigger: "item" }, series: [{ type: "pie", radius: ["45%", "72%"], label: { color: "#334155" }, data: [{ value: risk.data?.green || 0, name: "Green", itemStyle: { color: "#16a34a" } }, { value: risk.data?.amber || 0, name: "Amber", itemStyle: { color: "#d97706" } }, { value: risk.data?.red || 0, name: "Red", itemStyle: { color: "#dc2626" } }] }] }), [risk.data]);
  if ((canReadFinance && finance.isLoading) || (canReadRisk && risk.isLoading)) return <LoadingState label="Preparing programme analytics…" />;
  if (!hasData && ((canReadFinance && finance.isError) || (canReadRisk && risk.isError))) return <ErrorState description={((finance.error || risk.error) as Error)?.message || "Analytics could not be loaded."} onRetry={() => { if (canReadFinance) void finance.refetch(); if (canReadRisk) void risk.refetch(); }} />;
  if (!hasData) return <EmptyState title="No analytics are available yet" description="Analytics appear after accessible work records, payments, and risk calculations have been created." />;
  const getExportData = () => {
    const workCount = finance.data?.summary.work_count ?? risk.data?.total ?? 0;
    const finProg = finance.data ? `${finance.data.summary.financial_progress_pct.toFixed(1)}%` : "N/A";
    const amtRisk = finance.data ? formatCurrency(finance.data.summary.amount_at_risk) : "N/A";

    const report: PrintableReport = {
      title: "MPLADS PROGRAMME ANALYTICS & EXECUTIVE REPORT",
      subtitle: "Executive Governance & Operational Performance Summary",
      generatedBy: user ? `${user.full_name} (${user.role.replace(/_/g, " ").toUpperCase()})` : "Authorised Official",
      jurisdiction: user?.jurisdiction?.district_code || user?.jurisdiction?.state_code || "National Oversight",
      metadata: [
        { label: "Works Analysed", value: String(workCount) },
        { label: "Financial Progress", value: finProg },
        { label: "Amount at Priority", value: amtRisk },
        { label: "Red Tier (Critical)", value: String(risk.data?.red ?? 0) },
        { label: "Amber Tier (Medium)", value: String(risk.data?.amber ?? 0) },
        { label: "Green Tier (Normal)", value: String(risk.data?.green ?? 0) },
      ],
      sections: [
        {
          title: "Programme Performance Overview",
          type: "key-value",
          items: [
            { label: "Total Accessible Works", value: String(workCount) },
            { label: "Overall Financial Progress", value: finProg },
            { label: "Review Priority Expenditure", value: amtRisk },
            { label: "Total High-Risk (Red Tier) Works", value: String(risk.data?.red ?? 0) },
            { label: "Works Under Observation (Amber Tier)", value: String(risk.data?.amber ?? 0) },
            { label: "Works On Track (Green Tier)", value: String(risk.data?.green ?? 0) },
          ],
        },
        {
          title: "Risk Distribution Ledger",
          type: "table",
          headers: ["Risk Tier", "Work Count", "Classification", "Prescribed Action"],
          rows: [
            ["Red Tier", risk.data?.red ?? 0, "High / Critical Delay or Overrun", "Immediate physical inspection & explanation call"],
            ["Amber Tier", risk.data?.amber ?? 0, "Moderate Deviation / Milestone Lag", "Fortnightly progress monitoring & audit scrutiny"],
            ["Green Tier", risk.data?.green ?? 0, "Satisfactory Milestone Execution", "Standard milestone reporting"],
          ],
        },
        ...(finance.data?.amount_at_risk_trend?.length
          ? [
              {
                title: "Expenditure at Review Priority Trend",
                type: "table" as const,
                headers: ["Reporting Period", "Amount at Priority (₹)"],
                rows: finance.data.amount_at_risk_trend.map((t) => [t.period, formatCurrency(t.amount_at_risk)]),
              },
            ]
          : []),
      ],
      signOff: {
        designation: user?.role.replace(/_/g, " ").toUpperCase() || "Nodal Authority",
        office: "MPLADS Monitoring & Evaluation Division",
      },
    };

    const csvHeaders = ["Category / Period", "Metric Name", "Value"];
    const csvRows: (string | number)[][] = [
      ["Overview", "Works Analysed", workCount],
      ["Overview", "Financial Progress %", finProg],
      ["Overview", "Amount at Review Priority", amtRisk],
      ["Risk", "Red Tier Count", risk.data?.red ?? 0],
      ["Risk", "Amber Tier Count", risk.data?.amber ?? 0],
      ["Risk", "Green Tier Count", risk.data?.green ?? 0],
      ...(finance.data?.amount_at_risk_trend || []).map((t) => ["Spend Trend", t.period, t.amount_at_risk]),
    ];

    return {
      report,
      csv: { headers: csvHeaders, rows: csvRows },
      json: {
        generated_at: new Date().toISOString(),
        summary: finance.data?.summary,
        risk: risk.data,
        trend: finance.data?.amount_at_risk_trend,
      },
    };
  };

  return <>
    <PageHeader
      eyebrow="Decision-ready reporting"
      title="Analytics & Reports"
      description="Live operational analytics generated from the work, payment, and risk records available to your role."
      actions={
        <ExportReportButton
          label="Export Report"
          filename="MPLADS_Programme_Analytics_Report"
          getReportData={getExportData}
        />
      }
    />
    <section className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      <Tile icon={<BarChart3 className="h-5 w-5" />} label="Works analysed" value={String(finance.data?.summary.work_count ?? risk.data?.total ?? "—")} />
      {canReadFinance && <Tile icon={<LineChart className="h-5 w-5" />} label="Financial progress" value={finance.data ? `${finance.data.summary.financial_progress_pct.toFixed(1)}%` : "—"} />}
      {canReadRisk && <Tile icon={<PieChart className="h-5 w-5" />} label="Red risk tier" value={String(risk.data?.red ?? "—")} />}
      {canReadFinance && <Tile icon={<BarChart3 className="h-5 w-5" />} label="Amount at priority" value={finance.data ? formatCurrency(finance.data.summary.amount_at_risk) : "—"} />}
    </section>
    <section className={`grid gap-6 ${canReadFinance && canReadRisk ? "xl:grid-cols-2" : "grid-cols-1"}`}>
      {canReadFinance && <FinancialChart title="Amount at review priority" description="Trend derived from accessible MongoDB work records." option={spendOption} isEmpty={!finance.data?.amount_at_risk_trend.length} />}
      {canReadRisk && <FinancialChart title="Composite risk distribution" description="Latest persisted composite score for each accessible work." option={riskOption} isEmpty={!risk.data?.total} />}
    </section>
  </>;
}
function Tile({ icon, label, value }: { icon: ReactNode; label: string; value: string }) { return <Card><CardContent className="flex gap-3 p-5"><span className="rounded-lg bg-sky-100 p-2 text-sky-800">{icon}</span><div><p className="text-xl font-bold text-slate-950">{value}</p><p className="mt-1 text-xs text-slate-500">{label}</p></div></CardContent></Card>; }
