"use client";

import React from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useAuthenticatedQuery } from "@/lib/query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ShieldAlert,
  Flame,
  AlertTriangle,
  ArrowRight,
  TrendingUp,
  Landmark,
  Building2,
  FileWarning,
  Send,
  ArrowLeftRight,
  ClipboardCheck,
  CheckCircle2,
  Clock,
  Sparkles,
  MapPin,
} from "lucide-react";

interface DistrictRiskMetric {
  district_code: string;
  district_name: string;
  total_works: number;
  sanctioned_amount: number;
  expenditure_amount: number;
  unspent_balance: number;
  utilization_rate_pct: number;
  delayed_works_count: number;
  stalled_works_count: number;
  average_risk_score: number;
  risk_tier: string;
  status_tier: string;
}

interface HeatmapResponse {
  state_code: string;
  state_name: string;
  total_works: number;
  total_sanctioned_cr: number;
  total_expenditure_cr: number;
  total_unspent_cr: number;
  state_utilization_rate_pct: number;
  total_districts: number;
  lagging_districts_count: number;
  critical_risk_districts_count: number;
  districts: DistrictRiskMetric[];
}

interface BottlenecksResponse {
  total_delayed_works: number;
  pending_notices_count: number;
  notices_issued_count: number;
}

interface InspectionsResponse {
  state_mandatory_quota: number;
  state_completed_inspections: number;
  state_overall_inspection_rate_pct: number;
  compliant_districts_count: number;
  deficit_districts_count: number;
}

export default function SNOExecutiveDashboard() {
  const { user } = useAuth();
  const stateCode = user?.jurisdiction?.state_code || "UP";

  const heatmap = useAuthenticatedQuery<HeatmapResponse>(
    ["sno-heatmap", stateCode],
    `/api/v1/sno/heatmap?state_code=${stateCode}`,
    { staleTime: 30_000 }
  );

  const bottlenecks = useAuthenticatedQuery<BottlenecksResponse>(
    ["sno-bottlenecks", stateCode],
    `/api/v1/sno/bottlenecks?state_code=${stateCode}`,
    { staleTime: 30_000 }
  );

  const inspections = useAuthenticatedQuery<InspectionsResponse>(
    ["sno-inspections", stateCode],
    `/api/v1/sno/inspections-audit?state_code=${stateCode}`,
    { staleTime: 30_000 }
  );

  const hData = heatmap.data;
  const bData = bottlenecks.data;
  const iData = inspections.data;

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="rounded-2xl border border-blue-200/80 bg-gradient-to-r from-blue-900 via-indigo-900 to-slate-900 p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 -mt-8 -mr-8 w-64 h-64 rounded-full bg-blue-500/10 blur-3xl pointer-events-none" />
        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 border-blue-400/30 text-xs">
                State Nodal Office · {hData?.state_name || stateCode}
              </Badge>
              <Badge variant="outline" className="text-xs text-blue-200/70 border-white/20">
                MPLADS State Statutory Oversight
              </Badge>
            </div>
            <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
              State Nodal Officer Command Center
            </h1>
            <p className="text-sm text-blue-100/80 max-w-2xl leading-relaxed">
              Real-time district performance telemetry, automated show-cause notices to District Magistrates, cross-district fund reallocations, and mandatory 10% annual physical inspection audits.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <Link href="/dashboard/sno/escalations">
              <Button className="bg-blue-600 hover:bg-blue-500 text-white font-semibold text-xs shadow-lg shadow-blue-600/30 flex items-center gap-1.5">
                <Send className="h-3.5 w-3.5" />
                Issue Notice to DM
              </Button>
            </Link>
            <Link href="/dashboard/sno/allocations">
              <Button variant="outline" className="bg-white/10 hover:bg-white/20 text-white border-white/20 text-xs font-semibold flex items-center gap-1.5">
                <ArrowLeftRight className="h-3.5 w-3.5" />
                Reallocate Funds
              </Button>
            </Link>
          </div>
        </div>
      </div>

      {/* 4 Key Executive KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* KPI 1: State Outlay & Absorption */}
        <Card className="border-slate-200/80 shadow-2xs hover:shadow-md transition-all">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription className="text-xs font-bold uppercase tracking-wider text-slate-500">
                State Sanctioned Outlay
              </CardDescription>
              <span className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
                <Landmark className="h-4 w-4" />
              </span>
            </div>
            <CardTitle className="text-2xl font-black text-slate-900">
              ₹{hData ? hData.total_sanctioned_cr.toLocaleString() : "—"} Cr
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-slate-600 flex items-center justify-between">
              <span>Actual Expenditure:</span>
              <strong className="text-slate-900">₹{hData ? hData.total_expenditure_cr.toLocaleString() : "—"} Cr</strong>
            </div>
            <div className="mt-2 w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-blue-600 h-full rounded-full transition-all duration-500"
                style={{ width: `${Math.min(100, hData?.state_utilization_rate_pct || 0)}%` }}
              />
            </div>
            <p className="mt-1 text-[11px] text-slate-400 text-right">
              {hData?.state_utilization_rate_pct}% Absorption Rate
            </p>
          </CardContent>
        </Card>

        {/* KPI 2: Unspent District Balances */}
        <Card className="border-slate-200/80 shadow-2xs hover:shadow-md transition-all">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Unspent District Treasuries
              </CardDescription>
              <span className="p-1.5 rounded-lg bg-amber-50 text-amber-600">
                <Clock className="h-4 w-4" />
              </span>
            </div>
            <CardTitle className="text-2xl font-black text-amber-700">
              ₹{hData ? hData.total_unspent_cr.toLocaleString() : "—"} Cr
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-slate-600 flex items-center justify-between">
              <span>Districts Tracked:</span>
              <strong className="text-slate-900">{hData?.total_districts || "—"} Districts</strong>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              Surplus can be reallocated to high-absorption districts.
            </p>
          </CardContent>
        </Card>

        {/* KPI 3: Delayed Project Bottlenecks */}
        <Card className="border-slate-200/80 shadow-2xs hover:shadow-md transition-all">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Bottleneck Projects
              </CardDescription>
              <span className="p-1.5 rounded-lg bg-rose-50 text-rose-600">
                <AlertTriangle className="h-4 w-4" />
              </span>
            </div>
            <CardTitle className="text-2xl font-black text-rose-600">
              {bData ? bData.total_delayed_works : "—"} Works
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-slate-600 flex items-center justify-between">
              <span>Pending DM Notices:</span>
              <strong className="text-rose-700 font-bold">{bData?.pending_notices_count || 0}</strong>
            </div>
            <div className="text-xs text-slate-600 flex items-center justify-between mt-1">
              <span>Notices Dispatched:</span>
              <strong className="text-emerald-700">{bData?.notices_issued_count || 0}</strong>
            </div>
          </CardContent>
        </Card>

        {/* KPI 4: Mandatory 10% Inspection Quota */}
        <Card className="border-slate-200/80 shadow-2xs hover:shadow-md transition-all">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription className="text-xs font-bold uppercase tracking-wider text-slate-500">
                10% Inspection Quota
              </CardDescription>
              <span className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
                <ClipboardCheck className="h-4 w-4" />
              </span>
            </div>
            <CardTitle className="text-2xl font-black text-slate-900">
              {iData ? `${iData.state_overall_inspection_rate_pct}%` : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-slate-600 flex items-center justify-between">
              <span>Statutory Quota:</span>
              <strong className="text-slate-900">{iData?.state_mandatory_quota || 0} Works</strong>
            </div>
            <div className="text-xs text-slate-600 flex items-center justify-between mt-1">
              <span>Deficit Districts:</span>
              <strong className="text-rose-600 font-semibold">{iData?.deficit_districts_count || 0}</strong>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 4 Dedicated Core Module Launchpads */}
      <div>
        <h2 className="text-base font-bold text-slate-950 uppercase tracking-wider mb-4 flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-blue-600" />
          SNO Operational Command Modules
        </h2>

        <div className="grid gap-4 md:grid-cols-2">
          {/* Launchpad 1: Statewide Risk Heatmap */}
          <Card className="border-slate-200/80 shadow-2xs hover:border-blue-300 hover:shadow-md transition-all group">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-700 border border-blue-200 group-hover:bg-blue-600 group-hover:text-white transition-colors">
                    <Flame className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold text-slate-900">
                      Statewide Risk Heatmap
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-500">
                      District performance matrix & lagging district index
                    </CardDescription>
                  </div>
                </div>
                <Badge variant="outline" className="text-[11px] font-semibold bg-blue-50 text-blue-700 border-blue-200">
                  {hData?.total_districts || 0} Districts
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-600 leading-relaxed">
                Evaluates district-by-district composite risk scores, expenditure velocity, and stalled works. Identifies districts requiring executive intervention.
              </p>
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">
                  {hData?.lagging_districts_count || 0} Lagging Districts Flagged
                </span>
                <Link
                  href="/dashboard/sno/heatmap"
                  className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-700 group-hover:translate-x-0.5 transition-transform"
                >
                  Open Heatmap <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Launchpad 2: Bottleneck Escalations */}
          <Card className="border-slate-200/80 shadow-2xs hover:border-rose-300 hover:shadow-md transition-all group">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-rose-50 text-rose-700 border border-rose-200 group-hover:bg-rose-600 group-hover:text-white transition-colors">
                    <Send className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold text-slate-900">
                      Bottleneck Escalation to DMs
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-500">
                      Formal administrative notices & show-cause orders
                    </CardDescription>
                  </div>
                </div>
                <Badge variant="outline" className="text-[11px] font-semibold bg-rose-50 text-rose-700 border-rose-200">
                  {bData?.pending_notices_count || 0} Pending
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-600 leading-relaxed">
                Issues official administrative memos to District Magistrates when projects overshoot statutory delay thresholds, establishing mandatory cure periods.
              </p>
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">
                  {bData?.notices_issued_count || 0} Memos Dispatched
                </span>
                <Link
                  href="/dashboard/sno/escalations"
                  className="inline-flex items-center gap-1 text-xs font-bold text-rose-600 hover:text-rose-700 group-hover:translate-x-0.5 transition-transform"
                >
                  View Escalation Queue <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Launchpad 3: Inter-District Allocation */}
          <Card className="border-slate-200/80 shadow-2xs hover:border-amber-300 hover:shadow-md transition-all group">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-700 border border-amber-200 group-hover:bg-amber-600 group-hover:text-white transition-colors">
                    <ArrowLeftRight className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold text-slate-900">
                      Inter-District Allocation Engine
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-500">
                      Cross-district fund transfers & treasury balances
                    </CardDescription>
                  </div>
                </div>
                <Badge variant="outline" className="text-[11px] font-semibold bg-amber-50 text-amber-700 border-amber-200">
                  ₹{hData ? hData.total_unspent_cr : "—"} Cr Unspent
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-600 leading-relaxed">
                Monitors district treasury nodal bank accounts and authorizes cross-district fund reallocations from stagnant district pools to high-velocity projects.
              </p>
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">
                  Automated Docket Reference Generation
                </span>
                <Link
                  href="/dashboard/sno/allocations"
                  className="inline-flex items-center gap-1 text-xs font-bold text-amber-700 hover:text-amber-800 group-hover:translate-x-0.5 transition-transform"
                >
                  Manage Allocations <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </CardContent>
          </Card>

          {/* Launchpad 4: 10% Inspection Quota Audit */}
          <Card className="border-slate-200/80 shadow-2xs hover:border-emerald-300 hover:shadow-md transition-all group">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-200 group-hover:bg-emerald-600 group-hover:text-white transition-colors">
                    <ClipboardCheck className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-bold text-slate-900">
                      10% Physical Inspection Quota
                    </CardTitle>
                    <CardDescription className="text-xs text-slate-500">
                      Statutory field verification compliance tracking
                    </CardDescription>
                  </div>
                </div>
                <Badge variant="outline" className="text-[11px] font-semibold bg-emerald-50 text-emerald-700 border-emerald-200">
                  Target: 10% Annual
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-slate-600 leading-relaxed">
                Audits district compliance against MoSPI’s mandatory 10% annual physical inspection quota. Dispatches formal inspection drive directives to deficit districts.
              </p>
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-500">
                  {iData?.compliant_districts_count || 0} of {hData?.total_districts || 0} Districts Compliant
                </span>
                <Link
                  href="/dashboard/sno/inspections-audit"
                  className="inline-flex items-center gap-1 text-xs font-bold text-emerald-700 hover:text-emerald-800 group-hover:translate-x-0.5 transition-transform"
                >
                  Review Quota Audit <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
