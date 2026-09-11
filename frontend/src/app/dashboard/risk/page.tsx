"use client";

import Link from "next/link";
import { useState } from "react";
import { ArrowRight, RefreshCw, ShieldAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { RiskScore, formatDate } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAuthenticatedQuery } from "@/lib/query";
import { ExportReportButton } from "@/components/reports/export-report-button";
import { PrintableReport } from "@/lib/export-report";

type RiskList = { scores: RiskScore[]; total: number; page: number; total_pages: number };
const tiers = ["all", "red", "amber", "green"] as const;

export default function RiskAlertCenterPage() {
  const { user } = useAuth();
  const canReadRisk = ["admin", "mospi", "state_nodal_officer", "mp"].includes(user?.role || "");

  const [tier, setTier] = useState<(typeof tiers)[number]>("all");
  const endpoint = `/api/v1/risk?page=1&page_size=50${tier === "all" ? "" : `&tier=${tier}`}`;
  const { data, isLoading, isError, error, refetch } = useAuthenticatedQuery<RiskList>(
    ["risk-alerts", tier],
    endpoint,
    { enabled: canReadRisk }
  );

  if (!canReadRisk) {
    return (
      <ErrorState
        title="Access denied"
        description="Your role does not have permission to view risk alerts according to the platform permission matrix."
      />
    );
  }

  if (isLoading) return <LoadingState label="Loading composite risk alerts…" />;
  if (isError) return <ErrorState description={(error as Error).message} onRetry={() => void refetch()} />;
  const alerts = data?.scores || [];

  const getRiskExportData = () => {
    const listToExport = alerts;

    const report: PrintableReport = {
      title: "MPLADS COMPOSITE RISK & ANOMALY ALERT REGISTER",
      subtitle: `Official Risk Assessment & Prioritisation Register (${listToExport.length} flagged projects)`,
      categoryBadge: "AI RISK OVERSIGHT",
      generatedBy: user ? `${user.full_name} (${user.role.replace(/_/g, " ").toUpperCase()})` : "Authorised Official",
      jurisdiction: user?.jurisdiction?.district_code || user?.jurisdiction?.state_code || "National Oversight",
      metadata: [
        { label: "Alerts in View", value: String(listToExport.length) },
        { label: "Selected Tier", value: tier.toUpperCase() },
        { label: "Red Tier (High Risk)", value: String(listToExport.filter((a) => a.risk_tier === "red").length) },
        { label: "Amber Tier (Medium Risk)", value: String(listToExport.filter((a) => a.risk_tier === "amber").length) },
        { label: "Green Tier (Low Risk)", value: String(listToExport.filter((a) => a.risk_tier === "green").length) },
      ],
      sections: [
        {
          title: "Composite Risk Signal Register",
          type: "table",
          headers: ["Work ID", "Project Title", "District / State", "MP Name", "Score", "Tier", "Delay Prob", "Recommended Action"],
          rows: listToExport.map((a) => [
            a.work_id,
            a.work_title || `Work ${a.work_id}`,
            [a.district_name, a.state_name].filter(Boolean).join(", ") || "—",
            a.mp_name || "—",
            `${a.composite_score.toFixed(1)}/100`,
            a.risk_tier.toUpperCase(),
            a.delay_probability !== null ? `${(a.delay_probability * 100).toFixed(0)}%` : "—",
            a.recommended_action || "Routine monitoring",
          ]),
        },
      ],
      disclaimer: "Composite risk scores and anomaly indicators are automated AI decision-support signals designed for prioritisation only, and do not constitute legal or definitive findings of fraud.",
      signOff: {
        designation: "Chief Risk / Nodal Monitoring Officer",
        office: "Ministry of Statistics & Programme Implementation (MoSPI)",
      },
    };

    const csvHeaders = [
      "Work ID",
      "Work Title",
      "District",
      "State",
      "MP Name",
      "Composite Score",
      "Risk Tier",
      "Delay Probability (%)",
      "Calculated At",
      "Recommended Action",
    ];

    const csvRows = listToExport.map((a) => [
      a.work_id,
      a.work_title || "",
      a.district_name || "",
      a.state_name || "",
      a.mp_name || "",
      a.composite_score,
      a.risk_tier,
      a.delay_probability !== null ? (a.delay_probability * 100).toFixed(1) : "",
      a.calculated_at || "",
      a.recommended_action || "",
    ]);

    return {
      report,
      csv: { headers: csvHeaders, rows: csvRows },
      json: listToExport,
    };
  };

  return <>
    <PageHeader
      eyebrow="Decision support"
      title="Risk Alert Center"
      description="Composite risk signals and anomaly flags require verification. AI prioritisation aids — not findings of fraud."
      actions={
        <div className="flex items-center gap-2">
          <ExportReportButton
            label="Export Risk Report"
            filename="MPLADS_Risk_Alert_Register"
            getReportData={getRiskExportData}
          />
          <Button variant="outline" onClick={() => void refetch()}>
            <RefreshCw className="h-4 w-4" />Refresh
          </Button>
        </div>
      }
    />
    <div className="mb-6 flex flex-wrap gap-2" role="group" aria-label="Filter alerts by risk tier">{tiers.map((item) => <Button key={item} size="sm" variant={tier === item ? "default" : "outline"} onClick={() => setTier(item)} className="capitalize">{item === "all" ? "All alerts" : `${item} tier`}</Button>)}</div>
      {!alerts.length ? (
        <EmptyState
          title="No composite risk alerts"
          description="There are no persisted scoring records for this filter in your jurisdiction."
          action={
            <Button asChild>
              <Link href="/dashboard/works">Open work register</Link>
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {alerts.map((alert) => {
            const locationParts = [alert.district_name, alert.state_name].filter(Boolean);
            const locationText = locationParts.join(", ");
            const hasMeta = locationText || alert.mp_name;

            return (
              <Card key={alert.score_id} className="transition-colors hover:border-slate-300">
                <CardHeader className="flex-row items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <p className="text-[11px] font-mono text-slate-500 mb-1">ID: {alert.work_id}</p>
                    <CardTitle className="text-base font-semibold text-slate-900 leading-snug break-words">
                      {alert.work_title || `Work ${alert.work_id}`}
                    </CardTitle>
                    {hasMeta && (
                      <p className="text-xs text-slate-600 font-medium mt-1">
                        {locationText}
                        {alert.mp_name ? `${locationText ? " · " : ""}MP: ${alert.mp_name}` : ""}
                      </p>
                    )}
                    <CardDescription className="text-xs text-slate-500 mt-1">
                      Calculated {formatDate(alert.calculated_at)} · score version {alert.score_version}
                    </CardDescription>
                  </div>
                  <Badge
                    variant={alert.risk_tier === "red" ? "danger" : alert.risk_tier === "amber" ? "warning" : "success"}
                    className="shrink-0 capitalize"
                  >
                    {alert.risk_tier} tier
                  </Badge>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-3 gap-3 rounded-lg bg-slate-50 border border-slate-200 p-3 text-center">
                    <Metric label="Composite" value={`${alert.composite_score}/100`} />
                    <Metric
                      label="Delay"
                      value={alert.delay_probability === null ? "Pending" : `${Math.round(alert.delay_probability * 100)}%`}
                    />
                    <Metric label="Confidence" value={`${Math.round(alert.confidence * 100)}%`} />
                  </div>
                  <div className="mt-4 flex items-start gap-2 text-sm text-slate-700">
                    <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-blue-700" />
                    <span>{alert.recommended_action}</span>
                  </div>
                  <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                    <span className="text-xs text-slate-500">{alert.triggered_rules.length} rules triggered</span>
                    <Button
                      size="sm"
                      className="bg-blue-600 hover:bg-blue-700 text-white text-xs h-8 px-3 font-medium shadow-xs"
                      asChild
                    >
                      <Link href={`/dashboard/works/${alert.work_id}?focus=risk`} className="flex items-center gap-1.5">
                        <span>View Work & Story</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
  </>;
}
function Metric({ label, value }: { label: string; value: string }) { return <div><p className="text-xs text-slate-500">{label}</p><p className="mt-1 text-sm font-bold text-slate-950">{value}</p></div>; }
