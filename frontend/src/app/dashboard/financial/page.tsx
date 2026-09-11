"use client";

import type { EChartsOption } from "echarts";
import Link from "next/link";
import { FinancialChart } from "@/components/financial/FinancialChart";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import {
  FinancialDashboardResponse,
  FinancialFilterOption,
  FinancialFilterOptions,
  formatCurrency,
} from "@/lib/api";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ExportReportButton } from "@/components/reports/export-report-button";
import { PrintableReport, ReportSection } from "@/lib/export-report";

const API_BASE = "/api/v1/financial-intelligence";

type Filters = {
  status: string;
  category: string;
  state_code: string;
  district_code: string;
  implementing_agency: string;
};

const EMPTY_FILTERS: Filters = {
  status: "",
  category: "",
  state_code: "",
  district_code: "",
  implementing_agency: "",
};

export default function FinancialIntelligencePage() {
  const { user, fetchWithAuth, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const [dashboard, setDashboard] = useState<FinancialDashboardResponse | null>(null);
  const [options, setOptions] = useState<FinancialFilterOptions | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedScatterWork, setSelectedScatterWork] = useState<{
    work_id: string;
    name: string;
    agency?: string;
    review?: string | null;
    sanctioned_amount?: number;
    physical_progress_pct?: number;
    financial_progress_pct?: number;
  } | null>(null);

  const loadDashboard = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });

    try {
      const [dashboardResponse, filtersResponse] = await Promise.all([
        fetchWithAuth(`${API_BASE}/dashboard?${params.toString()}`),
        fetchWithAuth(`${API_BASE}/filters`),
      ]);
      if (dashboardResponse.status === 403 || filtersResponse.status === 403) {
        setError("PERMISSION_DENIED");
        return;
      }
      if (!dashboardResponse.ok) {
        const payload = await dashboardResponse.json().catch(() => ({ detail: "Could not load financial intelligence." }));
        throw new Error(payload.detail || "Could not load financial intelligence.");
      }
      setDashboard(await dashboardResponse.json());
      if (filtersResponse.ok) {
        setOptions(await filtersResponse.json());
      }
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not load financial intelligence.");
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth, filters]);

  useEffect(() => {
    if (authLoading || !user) return;
    const timer = window.setTimeout(() => { void loadDashboard(); }, 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, loadDashboard, user]);

  const scatterOption = useMemo<EChartsOption>(() => ({
    backgroundColor: "transparent",
    grid: { left: 48, right: 24, top: 20, bottom: 42 },
    tooltip: {
      trigger: "item",
      backgroundColor: "#ffffff",
      borderColor: "#e2e8f0",
      borderWidth: 1,
      extraCssText: "box-shadow: 0 4px 12px rgba(0,0,0,0.08); border-radius: 8px;",
      textStyle: { color: "#0f172a" },
      formatter: (params: unknown) => {
        const item = params as {
          data?: {
            work_id?: string;
            name: string;
            value: [number, number];
            agency?: string;
            review?: string | null;
            sanctioned_amount?: number;
          };
        };
        const data = item.data;
        if (!data) return "";
        return `
          <div style="font-family: system-ui, sans-serif; padding: 2px 4px; max-width: 260px;">
            <div style="display: flex; align-items: center; gap: 4px; margin-bottom: 4px;">
              <span style="font-size: 10px; font-family: monospace; font-weight: 600; color: #dc2626; background: #fef2f2; border: 1px solid #fecaca; border-radius: 4px; padding: 1px 5px;">
                ID: ${escapeHtml(data.work_id || "N/A")}
              </span>
            </div>
            <div style="font-size: 13px; font-weight: 700; color: #0f172a; line-height: 1.35;">
              ${escapeHtml(data.name)}
            </div>
            <div style="margin-top: 6px; font-size: 11px; color: #475569; display: grid; gap: 2px;">
              <div>Physical: <strong>${data.value[0].toFixed(1)}%</strong> | Financial: <strong>${data.value[1].toFixed(1)}%</strong></div>
              ${data.agency ? `<div>Agency: ${escapeHtml(data.agency)}</div>` : ""}
              ${data.sanctioned_amount ? `<div>Sanctioned: ${formatCurrency(data.sanctioned_amount)}</div>` : ""}
            </div>
            <div style="margin-top: 6px; padding-top: 4px; border-top: 1px solid #e2e8f0; font-size: 11px; color: #2563eb; font-weight: 600;">
              👉 Click dot to inspect work
            </div>
          </div>
        `;
      },
    },
    xAxis: {
      type: "value",
      min: 0,
      max: 100,
      name: "Physical progress (%)",
      nameLocation: "middle",
      nameGap: 30,
      axisLabel: { color: "#64748b" },
      nameTextStyle: { color: "#64748b" },
      splitLine: { lineStyle: { color: "rgba(148,163,184,0.15)" } },
    },
    yAxis: {
      type: "value",
      min: 0,
      name: "Financial progress (%)",
      nameLocation: "middle",
      nameGap: 38,
      axisLabel: { color: "#64748b", formatter: "{value}%" },
      nameTextStyle: { color: "#64748b" },
      splitLine: { lineStyle: { color: "rgba(148,163,184,0.15)" } },
    },
    series: [{
      type: "scatter",
      symbol: "circle",
      symbolSize: 8,
      itemStyle: {
        color: "#dc2626",
        borderColor: "#b91c1c",
        borderWidth: 1,
        opacity: 0.95,
      },
      emphasis: {
        scale: 1.8,
        itemStyle: {
          color: "#ef4444",
          borderColor: "#991b1b",
          borderWidth: 2,
        },
      },
      data: (dashboard?.financial_physical_scatter ?? []).map((point) => ({
        work_id: point.work_id,
        name: point.title,
        agency: point.implementing_agency,
        review: point.review_label,
        sanctioned_amount: point.sanctioned_amount,
        physical_progress_pct: point.physical_progress_pct,
        financial_progress_pct: point.financial_progress_pct,
        value: [point.physical_progress_pct, point.financial_progress_pct],
      })),
    }],
  }), [dashboard]);

  const paymentOption = useMemo<EChartsOption>(() => ({
    backgroundColor: "transparent",
    color: ["#34d399", "#a78bfa"],
    tooltip: {
      trigger: "axis",
      backgroundColor: "#0f172a",
      borderColor: "#334155",
      textStyle: { color: "#e2e8f0" },
    },
    legend: { data: ["Released amount", "Tranches"], textStyle: { color: "#94a3b8" }, top: 0 },
    grid: { left: 52, right: 48, top: 36, bottom: 42 },
    xAxis: {
      type: "category",
      data: (dashboard?.payment_timeline ?? []).map((point) => point.period),
      axisLabel: { color: "#94a3b8" },
      axisLine: { lineStyle: { color: "#334155" } },
    },
    yAxis: [
      { type: "value", axisLabel: { color: "#94a3b8", formatter: compactAmount }, splitLine: { lineStyle: { color: "rgba(148,163,184,0.12)" } } },
      { type: "value", minInterval: 1, axisLabel: { color: "#94a3b8" }, splitLine: { show: false } },
    ],
    series: [
      { name: "Released amount", type: "bar", data: (dashboard?.payment_timeline ?? []).map((point) => point.released_amount), barMaxWidth: 32, borderRadius: [5, 5, 0, 0] },
      { name: "Tranches", type: "line", yAxisIndex: 1, data: (dashboard?.payment_timeline ?? []).map((point) => point.tranche_count), smooth: true, symbolSize: 7 },
    ],
  }), [dashboard]);

  const benchmarkOption = useMemo<EChartsOption>(() => ({
    backgroundColor: "transparent",
    color: ["#60a5fa", "#fbbf24"],
    tooltip: {
      trigger: "axis",
      backgroundColor: "#0f172a",
      borderColor: "#334155",
      textStyle: { color: "#e2e8f0" },
    },
    legend: { data: ["Average sanctioned", "Peer median"], textStyle: { color: "#94a3b8" }, top: 0 },
    grid: { left: 58, right: 18, top: 36, bottom: 64 },
    xAxis: {
      type: "category",
      data: (dashboard?.cost_benchmarks ?? []).map((point) => shortLabel(point.category)),
      axisLabel: { color: "#94a3b8", rotate: 26 },
      axisLine: { lineStyle: { color: "#334155" } },
    },
    yAxis: { type: "value", axisLabel: { color: "#94a3b8", formatter: compactAmount }, splitLine: { lineStyle: { color: "rgba(148,163,184,0.12)" } } },
    series: [
      { name: "Average sanctioned", type: "bar", data: (dashboard?.cost_benchmarks ?? []).map((point) => point.average_sanctioned_amount), barMaxWidth: 28, borderRadius: [4, 4, 0, 0] },
      { name: "Peer median", type: "bar", data: (dashboard?.cost_benchmarks ?? []).map((point) => point.median_sanctioned_amount), barMaxWidth: 28, borderRadius: [4, 4, 0, 0] },
    ],
  }), [dashboard]);

  const amountAtRiskOption = useMemo<EChartsOption>(() => ({
    backgroundColor: "transparent",
    color: ["#fb7185"],
    tooltip: { trigger: "axis", backgroundColor: "#0f172a", borderColor: "#334155", textStyle: { color: "#e2e8f0" } },
    grid: { left: 58, right: 18, top: 20, bottom: 42 },
    xAxis: {
      type: "category",
      data: (dashboard?.amount_at_risk_trend ?? []).map((point) => point.period),
      axisLabel: { color: "#94a3b8" },
      axisLine: { lineStyle: { color: "#334155" } },
    },
    yAxis: { type: "value", axisLabel: { color: "#94a3b8", formatter: compactAmount }, splitLine: { lineStyle: { color: "rgba(148,163,184,0.12)" } } },
    series: [{
      name: "Amount at risk",
      type: "line",
      smooth: true,
      areaStyle: { color: "rgba(251,113,133,0.18)" },
      data: (dashboard?.amount_at_risk_trend ?? []).map((point) => point.amount_at_risk),
      symbolSize: 7,
    }],
  }), [dashboard]);

  if (authLoading) return <PageSpinner />;
  if (!user) return <div style={styles.fullPage}><p style={styles.muted}>Not authenticated. Redirecting…</p></div>;

  const getFinancialExportData = () => {
    if (!dashboard) throw new Error("Financial dashboard data not loaded");

    const sections: ReportSection[] = [
      {
        title: "Portfolio Financial Summary",
        type: "key-value",
        items: [
          { label: "Total Works Analysed", value: String(dashboard.summary.work_count) },
          { label: "Total Sanctioned Amount", value: formatCurrency(dashboard.summary.total_sanctioned_amount) },
          { label: "Total Funds Released", value: `${formatCurrency(dashboard.summary.total_funds_released)} (${dashboard.summary.funds_released_vs_sanctioned_pct.toFixed(1)}%)` },
          { label: "Actual Total Expenditure", value: `${formatCurrency(dashboard.summary.total_actual_expenditure)} (${dashboard.summary.actual_expenditure_vs_sanctioned_pct.toFixed(1)}%)` },
          { label: "Financial Progress", value: `${dashboard.summary.financial_progress_pct.toFixed(1)}%` },
          { label: "Sanction-Weighted Physical Progress", value: `${dashboard.summary.physical_progress_pct.toFixed(1)}%` },
          { label: "Spend / Delivery Gap", value: signedPercent(dashboard.summary.financial_physical_gap_pct) },
          { label: "Amount at Review Priority", value: formatCurrency(dashboard.summary.amount_at_risk) },
          { label: "Works Requiring Verification", value: String(dashboard.summary.works_requiring_verification) },
        ],
      },
    ];

    if (dashboard.cost_outliers.length > 0) {
      sections.push({
        title: "Cost Outlier & High-Variance Works",
        type: "table",
        headers: ["Work ID", "Title", "Agency", "Sanctioned (₹)", "Cost Ratio vs Peer Median", "Peer Median (₹)", "Status"],
        rows: dashboard.cost_outliers.map((w) => [
          w.work_id,
          w.title,
          w.implementing_agency || "—",
          formatCurrency(w.sanctioned_amount),
          `${w.cost_ratio_to_peer_median.toFixed(2)}x`,
          formatCurrency(w.peer_median_sanctioned_amount),
          w.label,
        ]),
      });
    }

    if (dashboard.high_spend_low_progress.length > 0) {
      sections.push({
        title: "High Spend / Low Delivery Works (Priority Verification)",
        type: "table",
        headers: ["Work ID", "Title", "Agency", "Physical %", "Financial %", "Gap %", "Review Reason"],
        rows: dashboard.high_spend_low_progress.map((w) => [
          w.work_id,
          w.title,
          w.implementing_agency || "—",
          `${w.physical_progress_pct.toFixed(1)}%`,
          `${w.financial_progress_pct.toFixed(1)}%`,
          `+${w.financial_physical_gap_pct.toFixed(1)}%`,
          w.label || "Expenditure heavily exceeds reported physical milestone",
        ]),
      });
    }

    if (dashboard.agency_anomaly_ranking.length > 0) {
      sections.push({
        title: "Implementing Agency Financial Performance & Risk",
        type: "table",
        headers: ["Rank", "Agency Name", "Total Works", "Priority Count", "Avg Gap (%)", "Amount at Priority"],
        rows: dashboard.agency_anomaly_ranking.map((a) => [
          String(a.rank),
          a.implementing_agency,
          String(a.work_count),
          String(a.works_requiring_verification),
          `${a.average_financial_physical_gap_pct.toFixed(1)}%`,
          formatCurrency(a.amount_at_risk),
        ]),
      });
    }

    const report: PrintableReport = {
      title: "MPLADS FINANCIAL INTELLIGENCE & EXPENDITURE AUDIT REPORT",
      subtitle: "Capital Outlay, Disbursement Velocity, Delivery Gaps & Cost Benchmarks",
      categoryBadge: "FINANCIAL OVERSIGHT",
      generatedBy: user ? `${user.full_name} (${user.role.replace(/_/g, " ").toUpperCase()})` : "Authorised Official",
      jurisdiction: user?.jurisdiction?.district_code || user?.jurisdiction?.state_code || "National Oversight",
      metadata: [
        { label: "Portfolio Works", value: String(dashboard.summary.work_count) },
        { label: "Total Sanctioned", value: formatCurrency(dashboard.summary.total_sanctioned_amount) },
        { label: "Total Expenditure", value: formatCurrency(dashboard.summary.total_actual_expenditure) },
        { label: "Financial Progress", value: `${dashboard.summary.financial_progress_pct.toFixed(1)}%` },
        { label: "Physical Progress", value: `${dashboard.summary.physical_progress_pct.toFixed(1)}%` },
        { label: "Amount at Priority", value: formatCurrency(dashboard.summary.amount_at_risk) },
      ],
      sections,
      signOff: {
        designation: "Finance Officer / Chief Controller of Accounts",
        office: "Ministry of Statistics & Programme Implementation (MoSPI)",
      },
    };

    const csvHeaders = ["Section", "Work / Entity", "Attribute / Metric", "Value", "Notes"];
    const csvRows: (string | number)[][] = [
      ["Summary", "Portfolio", "Total Works", dashboard.summary.work_count, ""],
      ["Summary", "Portfolio", "Sanctioned Amount", dashboard.summary.total_sanctioned_amount, ""],
      ["Summary", "Portfolio", "Funds Released", dashboard.summary.total_funds_released, ""],
      ["Summary", "Portfolio", "Actual Expenditure", dashboard.summary.total_actual_expenditure, ""],
      ["Summary", "Portfolio", "Financial Progress (%)", dashboard.summary.financial_progress_pct, ""],
      ["Summary", "Portfolio", "Physical Progress (%)", dashboard.summary.physical_progress_pct, ""],
      ["Summary", "Portfolio", "Financial/Physical Gap (%)", dashboard.summary.financial_physical_gap_pct, ""],
      ["Summary", "Portfolio", "Amount at Priority", dashboard.summary.amount_at_risk, ""],
      ["Summary", "Portfolio", "Works Requiring Verification", dashboard.summary.works_requiring_verification, ""],
    ];

    dashboard.high_spend_low_progress.forEach((w) => {
      csvRows.push([
        "High Spend Low Delivery",
        w.work_id,
        w.title,
        `Physical: ${w.physical_progress_pct}%, Financial: ${w.financial_progress_pct}%`,
        w.label || "",
      ]);
    });

    dashboard.agency_anomaly_ranking.forEach((a) => {
      csvRows.push([
        "Agency Performance",
        a.implementing_agency,
        `Works: ${a.work_count}`,
        `Gap: ${a.average_financial_physical_gap_pct.toFixed(1)}%`,
        `Amount at Risk: ${a.amount_at_risk}`,
      ]);
    });

    return {
      report,
      csv: { headers: csvHeaders, rows: csvRows },
      json: dashboard,
    };
  };

  return (
    <main style={styles.fullPage}>
      <div style={styles.container}>
        <header style={styles.header}>
          <div>
            <button onClick={() => router.push("/dashboard")} style={styles.backButton}>← Dashboard</button>
            <p style={styles.eyebrow}>Phase 10 · Financial intelligence</p>
            <h1 style={styles.title}>Financial oversight</h1>
            <p style={styles.subtitle}>Sanction, release, expenditure, and physical delivery signals from MongoDB work records.</p>
          </div>
          <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
            <ExportReportButton
              label="Export Financial Report"
              filename="MPLADS_Financial_Intelligence_Report"
              getReportData={getFinancialExportData}
            />
            <button onClick={() => void loadDashboard()} style={styles.refreshButton} disabled={isLoading}>↻ Refresh</button>
          </div>
        </header>

        <div style={styles.notice}>
          <strong>Possible financial irregularity</strong> signals are prioritisation aids only. <strong>Requires verification.</strong>
        </div>

        <FilterBar
          filters={filters}
          options={options}
          disabled={isLoading}
          onChange={(field, value) => setFilters((current) => ({ ...current, [field]: value }))}
          onClear={() => setFilters(EMPTY_FILTERS)}
        />

        {error === "PERMISSION_DENIED" ? (
          <StatePanel title="Insufficient permissions" detail="Your role does not have access to the financial intelligence view." icon="🔒" />
        ) : error ? (
          <StatePanel title="Financial intelligence could not be loaded" detail={error} icon="⚠" actionLabel="Retry" onAction={() => void loadDashboard()} />
        ) : isLoading ? (
          <LoadingDashboard />
        ) : !dashboard || dashboard.summary.work_count === 0 ? (
          <StatePanel title="No financial records match these filters" detail="Try clearing one or more filters, or add financial data to works in your jurisdiction." icon="◌" actionLabel="Clear filters" onAction={() => setFilters(EMPTY_FILTERS)} />
        ) : (
          <>
            <section style={styles.metricGrid} aria-label="Financial summary">
              <MetricCard label="Funds released" value={formatCurrency(dashboard.summary.total_funds_released)} detail={`${dashboard.summary.funds_released_vs_sanctioned_pct.toFixed(1)}% of ${formatCurrency(dashboard.summary.total_sanctioned_amount)}`} color="#34d399" />
              <MetricCard label="Actual expenditure" value={formatCurrency(dashboard.summary.total_actual_expenditure)} detail={`${dashboard.summary.actual_expenditure_vs_sanctioned_pct.toFixed(1)}% of sanctioned`} color="#60a5fa" />
              <MetricCard label="Financial progress" value={`${dashboard.summary.financial_progress_pct.toFixed(1)}%`} detail="Actual expenditure ÷ sanctioned" color="#a78bfa" />
              <MetricCard label="Physical progress" value={`${dashboard.summary.physical_progress_pct.toFixed(1)}%`} detail="Sanction-weighted portfolio progress" color="#38bdf8" />
              <MetricCard label="Financial / physical gap" value={`${signedPercent(dashboard.summary.financial_physical_gap_pct)}`} detail="Positive means spend is ahead of delivery" color={dashboard.summary.financial_physical_gap_pct >= 0 ? "#fbbf24" : "#34d399"} />
              <MetricCard label="Amount at risk" value={formatCurrency(dashboard.summary.amount_at_risk)} detail={`${dashboard.summary.works_requiring_verification} work(s) require verification`} color="#fb7185" />
            </section>

            <p style={styles.calculationNote}>{dashboard.summary.calculation_note}</p>

            <section style={styles.chartGrid}>
              <FinancialChart
                title="Financial versus physical progress"
                description="Each red dot represents a work project. Click any dot to view its Work ID, Name, and project details."
                option={scatterOption}
                isEmpty={dashboard.financial_physical_scatter.length === 0}
                onPointClick={(data) => {
                  if (data) {
                    setSelectedScatterWork({
                      work_id: data.work_id || "",
                      name: data.name || "",
                      agency: data.agency || "",
                      review: data.review || null,
                      sanctioned_amount: data.sanctioned_amount,
                      physical_progress_pct: data.physical_progress_pct ?? data.value?.[0],
                      financial_progress_pct: data.financial_progress_pct ?? data.value?.[1],
                    });
                  }
                }}
              />
              <FinancialChart
                title="Payment-tranche timeline"
                description="Monthly payment releases and the number of recorded tranches."
                option={paymentOption}
                isEmpty={dashboard.payment_timeline.length === 0}
                emptyMessage="No payment tranches are recorded for the selected works."
              />
              <FinancialChart
                title="Peer cost benchmark comparison"
                description="Average and median sanctioned amounts by category in the selected portfolio."
                option={benchmarkOption}
                isEmpty={dashboard.cost_benchmarks.length === 0}
              />
              <FinancialChart
                title="Amount-at-risk trend"
                description="A review-priority amount derived from expenditure and the excess financial-progress gap; not an estimate of loss."
                option={amountAtRiskOption}
                isEmpty={dashboard.amount_at_risk_trend.length === 0}
              />
            </section>

            <section style={styles.tableGrid}>
              <IntelligenceTable
                title="Cost outliers"
                description="A work appears when its sanctioned amount is at least 1.5× its category peer median, with at least five peers."
                emptyMessage="No cost outliers were found for the selected portfolio."
                rows={dashboard.cost_outliers.map((item) => [
                  <button key={item.work_id} onClick={() => router.push(`/dashboard/works/${item.work_id}?focus=financial`)} style={{ background: "transparent", border: 0, color: "#2563eb", textAlign: "left", cursor: "pointer", fontWeight: 600, fontSize: "0.78rem" }}>
                    {item.title}
                  </button>,
                  labelFor(item.category),
                  formatCurrency(item.sanctioned_amount),
                  `${item.cost_ratio_to_peer_median.toFixed(2)}× median`,
                  `${item.label} · ${item.verification_status}`,
                  <button key={`verify-${item.work_id}`} onClick={() => router.push(`/dashboard/works/${item.work_id}?focus=financial`)} style={{ border: "1px solid #fecdd3", background: "#fff1f2", color: "#e11d48", padding: "0.25rem 0.6rem", borderRadius: "6px", fontSize: "0.72rem", cursor: "pointer", fontWeight: 600 }}>
                    Verify & Story →
                  </button>
                ])}
                headers={["Work", "Category", "Sanctioned", "Peer comparison", "Status", "Action"]}
              />
              <IntelligenceTable
                title="High spend / low progress"
                description="Financial progress of at least 70% alongside physical progress of at most 35%."
                emptyMessage="No high-spend / low-progress works were found for the selected portfolio."
                rows={dashboard.high_spend_low_progress.map((item) => [
                  <button key={item.work_id} onClick={() => router.push(`/dashboard/works/${item.work_id}?focus=financial`)} style={{ background: "transparent", border: 0, color: "#2563eb", textAlign: "left", cursor: "pointer", fontWeight: 600, fontSize: "0.78rem" }}>
                    {item.title}
                  </button>,
                  `${item.financial_progress_pct.toFixed(1)}%`,
                  `${item.physical_progress_pct.toFixed(1)}%`,
                  formatCurrency(item.amount_at_risk),
                  `${item.label} · ${item.verification_status}`,
                  <button key={`verify-${item.work_id}`} onClick={() => router.push(`/dashboard/works/${item.work_id}?focus=financial`)} style={{ border: "1px solid #fecdd3", background: "#fff1f2", color: "#e11d48", padding: "0.25rem 0.6rem", borderRadius: "6px", fontSize: "0.72rem", cursor: "pointer", fontWeight: 600 }}>
                    Verify & Story →
                  </button>
                ])}
                headers={["Work", "Financial", "Physical", "Review amount", "Status", "Action"]}
              />
            </section>

            <IntelligenceTable
              title="Agency anomaly ranking"
              description="Agencies are ranked by review-priority amount, then number of works requiring verification."
              emptyMessage="No agency review signals were found for the selected portfolio."
              rows={dashboard.agency_anomaly_ranking.map((item) => [`#${item.rank}`, item.implementing_agency, String(item.work_count), String(item.works_requiring_verification), signedPercent(item.average_financial_physical_gap_pct), formatCurrency(item.amount_at_risk), item.label])}
              headers={["Rank", "Implementing agency", "Works", "Requires review", "Average gap", "Review amount", "Status"]}
            />

            <p style={styles.footerNotice}>{dashboard.review_notice}</p>
          </>
        )}

        {selectedScatterWork && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-xs"
            onClick={() => setSelectedScatterWork(null)}
            role="dialog"
            aria-modal="true"
          >
            <Card
              className="w-full max-w-md shadow-2xl border-slate-200 bg-white"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <div className="flex items-center justify-between border-b border-slate-100 pb-3 mb-4">
                  <div className="flex items-center gap-2">
                    <span className="h-3 w-3 rounded-full bg-red-600 inline-block shrink-0" />
                    <span className="font-mono text-xs font-semibold text-red-700 bg-red-50 border border-red-200 px-2 py-0.5 rounded">
                      Work ID: {selectedScatterWork.work_id}
                    </span>
                  </div>
                  <button
                    onClick={() => setSelectedScatterWork(null)}
                    className="text-slate-400 hover:text-slate-600 rounded-lg p-1 text-sm font-medium"
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>

                <div className="space-y-4">
                  <div>
                    <span className="text-xs text-slate-500 font-medium block">Project Name</span>
                    <h3 className="text-base font-bold text-slate-900 leading-snug mt-0.5">
                      {selectedScatterWork.name}
                    </h3>
                  </div>

                  <div className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 border border-slate-200 text-center">
                    <div>
                      <span className="text-xs text-slate-500 block">Physical Progress</span>
                      <span className="text-sm font-bold text-slate-900">
                        {selectedScatterWork.physical_progress_pct !== undefined ? `${selectedScatterWork.physical_progress_pct.toFixed(1)}%` : "N/A"}
                      </span>
                    </div>
                    <div>
                      <span className="text-xs text-slate-500 block">Financial Progress</span>
                      <span className="text-sm font-bold text-slate-900">
                        {selectedScatterWork.financial_progress_pct !== undefined ? `${selectedScatterWork.financial_progress_pct.toFixed(1)}%` : "N/A"}
                      </span>
                    </div>
                  </div>

                  {selectedScatterWork.sanctioned_amount && (
                    <div className="text-xs text-slate-600 flex justify-between border-b border-slate-100 pb-2">
                      <span className="text-slate-500">Sanctioned Amount:</span>
                      <span className="font-semibold text-slate-900">
                        {formatCurrency(selectedScatterWork.sanctioned_amount)}
                      </span>
                    </div>
                  )}

                  {selectedScatterWork.agency && (
                    <div className="text-xs text-slate-600 flex justify-between">
                      <span className="text-slate-500">Implementing Agency:</span>
                      <span className="font-medium text-slate-800 text-right">
                        {selectedScatterWork.agency}
                      </span>
                    </div>
                  )}
                </div>

                <div className="mt-6 flex items-center justify-between border-t border-slate-100 pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSelectedScatterWork(null)}
                  >
                    Close
                  </Button>
                  <Button
                    size="sm"
                    className="bg-blue-600 hover:bg-blue-700 text-white font-medium"
                    asChild
                  >
                    <Link href={`/dashboard/works/${selectedScatterWork.work_id}?focus=financial`}>
                      View & Verify Work →
                    </Link>
                  </Button>
                </div>
              </div>
            </Card>
          </div>
        )}
      </div>
    </main>
  );
}

function FilterBar({
  filters,
  options,
  disabled,
  onChange,
  onClear,
}: {
  filters: Filters;
  options: FinancialFilterOptions | null;
  disabled: boolean;
  onChange: (field: keyof Filters, value: string) => void;
  onClear: () => void;
}) {
  const hasFilters = Object.values(filters).some(Boolean);
  return (
    <section style={styles.filterBar} aria-label="Financial intelligence filters">
      <span style={styles.filterLabel}>Filters</span>
      <FilterSelect label="State" value={filters.state_code} options={options?.states ?? []} disabled={disabled} onChange={(value) => onChange("state_code", value)} />
      <FilterSelect label="District" value={filters.district_code} options={options?.districts ?? []} disabled={disabled} onChange={(value) => onChange("district_code", value)} />
      <FilterSelect label="Category" value={filters.category} options={options?.categories ?? []} disabled={disabled} onChange={(value) => onChange("category", value)} />
      <FilterSelect label="Status" value={filters.status} options={options?.statuses ?? []} disabled={disabled} onChange={(value) => onChange("status", value)} />
      <FilterSelect label="Agency" value={filters.implementing_agency} options={options?.agencies ?? []} disabled={disabled} onChange={(value) => onChange("implementing_agency", value)} />
      {hasFilters && <button onClick={onClear} style={styles.clearButton} disabled={disabled}>Clear filters</button>}
    </section>
  );
}

function FilterSelect({ label, value, options, disabled, onChange }: {
  label: string;
  value: string;
  options: FinancialFilterOption[];
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label style={styles.filterSelectLabel}>
      <select aria-label={label} value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} style={styles.select}>
        <option value="">All {label}s</option>
        {options.map((option) => <option key={option.value} value={option.value}>{labelFor(option.label)}</option>)}
      </select>
    </label>
  );
}

function MetricCard({ label, value, detail, color }: { label: string; value: string; detail: string; color: string }) {
  return (
    <article style={{ ...styles.metricCard, borderTopColor: color }}>
      <p style={styles.metricLabel}>{label}</p>
      <p style={{ ...styles.metricValue, color }}>{value}</p>
      <p style={styles.metricDetail}>{detail}</p>
    </article>
  );
}

function IntelligenceTable({ title, description, headers, rows, emptyMessage }: {
  title: string;
  description: string;
  headers: string[];
  rows: (string | React.ReactNode)[][];
  emptyMessage: string;
}) {
  return (
    <section style={styles.tableCard}>
      <h2 style={styles.tableTitle}>{title}</h2>
      <p style={styles.tableDescription}>{description}</p>
      {rows.length === 0 ? (
        <p style={styles.tableEmpty}>{emptyMessage}</p>
      ) : (
        <div style={styles.tableWrap}>
          <table style={styles.table}>
            <thead><tr>{headers.map((header) => <th key={header} style={styles.th}>{header}</th>)}</tr></thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} style={styles.tr}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={cellIndex}
                      style={
                        typeof cell === "string" && (cell.includes("verification") || cell.includes("irregularity"))
                          ? styles.statusTd
                          : styles.td
                      }
                    >
                      {cell}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function StatePanel({ title, detail, icon, actionLabel, onAction }: { title: string; detail: string; icon: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <section style={styles.statePanel}>
      <div style={styles.stateIcon}>{icon}</div>
      <h2 style={styles.stateTitle}>{title}</h2>
      <p style={styles.stateDetail}>{detail}</p>
      {actionLabel && onAction && <button onClick={onAction} style={styles.refreshButton}>{actionLabel}</button>}
    </section>
  );
}

function LoadingDashboard() {
  return (
    <div style={styles.loadingArea} aria-label="Loading financial intelligence">
      <div style={styles.metricGrid}>{Array.from({ length: 6 }).map((_, index) => <div key={index} style={styles.skeletonMetric}><div style={{ ...styles.skeleton, width: "48%" }} /><div style={{ ...styles.skeleton, width: "78%", height: 26, marginTop: 12 }} /><div style={{ ...styles.skeleton, width: "92%", marginTop: 12 }} /></div>)}</div>
      <div style={styles.chartGrid}>{Array.from({ length: 4 }).map((_, index) => <div key={index} style={styles.skeletonChart}><div style={{ ...styles.skeleton, width: "38%" }} /><div style={{ ...styles.skeleton, width: "100%", height: 220, marginTop: 18 }} /></div>)}</div>
    </div>
  );
}

function PageSpinner() {
  return <div style={styles.fullPage}><div style={styles.spinner} /><style>{`@keyframes financial-spin { to { transform: rotate(360deg); } } @keyframes financial-shimmer { 100% { background-position: -200% 0; } }`}</style></div>;
}

function labelFor(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function shortLabel(value: string): string {
  const label = labelFor(value);
  return label.length > 18 ? `${label.slice(0, 17)}…` : label;
}

function signedPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} pp`;
}

function compactAmount(value: number): string {
  if (value >= 10_000_000) return `₹${(value / 10_000_000).toFixed(1)}Cr`;
  if (value >= 100_000) return `₹${(value / 100_000).toFixed(1)}L`;
  return `₹${value.toLocaleString("en-IN")}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character] ?? character);
}

const styles: Record<string, React.CSSProperties> = {
  fullPage: { minHeight: "100vh", background: "#ffffff", padding: "1.5rem", fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' },
  container: { width: "100%", maxWidth: 1440, margin: "0 auto" },
  header: { display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: "1rem", marginBottom: "1rem" },
  backButton: { border: 0, color: "#475569", background: "transparent", padding: 0, cursor: "pointer", fontSize: "0.8rem" },
  eyebrow: { margin: "0.8rem 0 0.25rem", color: "#2563eb", textTransform: "uppercase", letterSpacing: "0.09em", fontSize: "0.68rem", fontWeight: 700 },
  title: { margin: 0, color: "#0f172a", fontSize: "clamp(1.7rem, 3vw, 2.25rem)", letterSpacing: "-0.035em", fontWeight: 700 },
  subtitle: { maxWidth: 720, margin: "0.45rem 0 0", color: "#64748b", fontSize: "0.9rem", lineHeight: 1.55 },
  refreshButton: { flexShrink: 0, border: "1px solid #cbd5e1", borderRadius: 8, background: "#ffffff", color: "#0f172a", padding: "0.55rem 0.8rem", cursor: "pointer", fontWeight: 600, fontSize: "0.78rem" },
  notice: { marginBottom: "1rem", borderRadius: 10, padding: "0.75rem 0.9rem", background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", fontSize: "0.8rem", lineHeight: 1.5 },
  filterBar: { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "0.55rem", marginBottom: "1rem", padding: "0.7rem", background: "#f8fafc", border: "1px solid #e2e8f0", borderRadius: 12 },
  filterLabel: { color: "#334155", fontSize: "0.77rem", fontWeight: 700, marginRight: "0.2rem" },
  filterSelectLabel: { display: "contents" },
  select: { maxWidth: 190, color: "#0f172a", background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 7, padding: "0.48rem 0.55rem", fontSize: "0.76rem", outline: "none" },
  clearButton: { color: "#2563eb", background: "transparent", border: 0, cursor: "pointer", padding: "0.45rem", fontSize: "0.76rem" },
  metricGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "0.75rem", marginBottom: "0.75rem" },
  metricCard: { minHeight: 118, padding: "0.85rem", background: "#ffffff", border: "1px solid #e2e8f0", borderTopWidth: 3, borderRadius: 12, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" },
  metricLabel: { margin: 0, color: "#64748b", fontWeight: 650, fontSize: "0.74rem" },
  metricValue: { margin: "0.55rem 0 0", fontSize: "1.3rem", fontWeight: 750, letterSpacing: "-0.025em", color: "#0f172a" },
  metricDetail: { margin: "0.5rem 0 0", color: "#64748b", fontSize: "0.7rem", lineHeight: 1.35 },
  calculationNote: { margin: "0 0 0.9rem", color: "#64748b", fontSize: "0.72rem", lineHeight: 1.5 },
  chartGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(390px, 1fr))", gap: "0.75rem", marginBottom: "0.75rem" },
  tableGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(420px, 1fr))", gap: "0.75rem", marginBottom: "0.75rem" },
  tableCard: { marginBottom: "0.75rem", padding: "1rem", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 14, minWidth: 0, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" },
  tableTitle: { margin: 0, color: "#0f172a", fontSize: "0.95rem", fontWeight: 700 },
  tableDescription: { margin: "0.3rem 0 0.85rem", color: "#64748b", fontSize: "0.73rem", lineHeight: 1.45 },
  tableWrap: { overflowX: "auto" },
  table: { width: "100%", borderCollapse: "collapse", minWidth: 560, fontSize: "0.74rem" },
  th: { textAlign: "left", color: "#475569", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", fontSize: "0.64rem", padding: "0.5rem 0.55rem", borderBottom: "1px solid #e2e8f0", background: "#f8fafc", whiteSpace: "nowrap" },
  tr: { borderBottom: "1px solid #e2e8f0" },
  td: { color: "#0f172a", padding: "0.62rem 0.55rem", verticalAlign: "top", lineHeight: 1.35 },
  statusTd: { color: "#b45309", padding: "0.62rem 0.55rem", verticalAlign: "top", lineHeight: 1.35, fontWeight: 650 },
  tableEmpty: { margin: 0, color: "#64748b", fontSize: "0.8rem", padding: "1.25rem 0", textAlign: "center" },
  footerNotice: { margin: "0.2rem 0 1rem", color: "#64748b", fontSize: "0.72rem", lineHeight: 1.5 },
  statePanel: { minHeight: 340, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "2rem", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 14 },
  stateIcon: { color: "#f59e0b", fontSize: "2rem" },
  stateTitle: { color: "#0f172a", fontSize: "1.1rem", margin: "0.75rem 0 0", fontWeight: 700 },
  stateDetail: { maxWidth: 480, color: "#64748b", fontSize: "0.85rem", lineHeight: 1.5, margin: "0.45rem 0 1rem" },
  loadingArea: { width: "100%" },
  skeletonMetric: { minHeight: 118, padding: "0.85rem", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 12 },
  skeletonChart: { minHeight: 300, padding: "1rem", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 14 },
  skeleton: { height: 12, borderRadius: 6, background: "#f1f5f9", backgroundSize: "200% 100%" },
  spinner: { width: 34, height: 34, margin: "35vh auto", border: "3px solid rgba(0,0,0,0.1)", borderTopColor: "#2563eb", borderRadius: "50%", animation: "financial-spin 0.75s linear infinite" },
  muted: { color: "#64748b", textAlign: "center", marginTop: "35vh" },
};
