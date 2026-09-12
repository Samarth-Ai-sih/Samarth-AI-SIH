"use client";

import React from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useAuthenticatedQuery } from "@/lib/query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState, ErrorState } from "@/components/ui/states";
import { formatCurrency } from "@/lib/api";
import {
  BarChart3,
  Landmark,
  TrendingUp,
  Clock,
  AlertTriangle,
  CheckCircle2,
  PieChart,
  ArrowLeft,
  ArrowUpRight,
  RefreshCw,
  FileSpreadsheet,
} from "lucide-react";

interface SectorItem {
  sector: string;
  amount: number;
  works_count: number;
  pct_of_total: number;
}

interface TelemetryData {
  total_national_outlay: number;
  total_sanctioned_amount: number;
  total_expenditure_amount: number;
  unspent_treasury_balance: number;
  utilization_rate_pct: number;
  stagnant_funds_amount: number;
  total_works_count: number;
  completed_works_count: number;
  in_progress_works_count: number;
  stalled_works_count: number;
  at_risk_works_count: number;
  sector_distribution: SectorItem[];
  fiscal_year: string;
  telemetry_as_of: string;
}

export default function MacroTelemetryPage() {
  const { user } = useAuth();
  const canAccess = user?.role === "mospi" || user?.role === "admin";

  const { data, isLoading, isError, error, refetch } = useAuthenticatedQuery<TelemetryData>(
    ["mospi-macro-telemetry"],
    "/api/v1/mospi/telemetry",
    { enabled: canAccess }
  );

  if (!canAccess) {
    return (
      <ErrorState
        title="Restricted Access"
        description="National Telemetry is restricted to MoSPI Central Ministry and Administrators."
      />
    );
  }

  if (isLoading) return <LoadingState label="Computing nationwide macro fund telemetry from MongoDB…" />;
  if (isError) return <ErrorState description={(error as Error).message} onRetry={() => void refetch()} />;

  const t = data!;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Link href="/dashboard/mospi" className="hover:text-blue-600 flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> MoSPI Command Center
        </Link>
        <span>/</span>
        <span className="text-slate-900 font-medium">Macro Fund Telemetry</span>
      </div>

      <PageHeader
        eyebrow="National Financial Telemetry Engine"
        title="Macro Fund Telemetry & Cash-Flow Oversight"
        description="Real-time macro monitoring across the ₹4,000+ Crore annual national MPLADS outlay, tracking central disbursements, unspent district treasury balances, and physical completion velocity."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5 text-slate-600" />
              Refresh Telemetry
            </Button>
            <Button size="sm" asChild>
              <Link href="/dashboard/mospi/releases">
                Authorize ₹2.5 Cr Tranches
              </Link>
            </Button>
          </div>
        }
      />

      {/* Hero Financial Outlay Breakdown */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-slate-200 bg-white shadow-xs">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Annual National Outlay</p>
                <p className="mt-1 text-2xl font-black text-slate-900">₹4,000.00 Cr</p>
              </div>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-700">
                <Landmark className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">₹5.00 Cr statutory entitlement per Member of Parliament</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-xs">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Sanctioned Portfolio</p>
                <p className="mt-1 text-2xl font-black text-blue-700">
                  {formatCurrency(t.total_sanctioned_amount)}
                </p>
              </div>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-700">
                <BarChart3 className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-2 text-xs text-blue-700 font-medium">
              Across {t.total_works_count.toLocaleString("en-IN")} cumulative public works
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-xs">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total Expenditure Disbursed</p>
                <p className="mt-1 text-2xl font-black text-emerald-700">
                  {formatCurrency(t.total_expenditure_amount)}
                </p>
              </div>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                <TrendingUp className="h-5 w-5" />
              </span>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <div className="h-2 flex-1 rounded-full bg-slate-100 overflow-hidden">
                <div className="h-full bg-emerald-600 rounded-full" style={{ width: `${Math.min(100, t.utilization_rate_pct)}%` }} />
              </div>
              <span className="text-xs font-bold text-emerald-700">{t.utilization_rate_pct}%</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-xs">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Unspent In District Treasuries</p>
                <p className="mt-1 text-2xl font-black text-amber-700">
                  {formatCurrency(t.unspent_treasury_balance)}
                </p>
              </div>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-700">
                <Clock className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-2 text-xs text-amber-800 font-medium">
              ₹{(t.stagnant_funds_amount / 10000000).toFixed(2)} Cr idle in stagnant accounts
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Delivery Health & Stagnancy Breakdown */}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="border-slate-200 lg:col-span-2">
          <CardHeader className="p-5 pb-3">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <PieChart className="h-4 w-4 text-blue-600" />
              Sectoral Capital Allocation Distribution
            </CardTitle>
            <CardDescription className="text-xs">
              Expenditure split across infrastructure, public health, water, education, and utilities
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            <div className="space-y-3.5 mt-3">
              {t.sector_distribution.map((sec, i) => (
                <div key={i} className="rounded-lg border border-slate-100 p-3 bg-slate-50/50">
                  <div className="flex items-center justify-between text-xs font-semibold mb-1.5">
                    <span className="text-slate-900 flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-blue-600" />
                      {sec.sector}
                    </span>
                    <span className="text-slate-700 font-bold">
                      {formatCurrency(sec.amount)} ({sec.pct_of_total}%)
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                    <div
                      className="h-full bg-blue-600 rounded-full transition-all"
                      style={{ width: `${Math.min(100, sec.pct_of_total)}%` }}
                    />
                  </div>
                  <p className="mt-1 text-[11px] text-slate-500">
                    {sec.works_count.toLocaleString("en-IN")} individual project assets funded
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Physical Project Status Pipeline */}
        <Card className="border-slate-200">
          <CardHeader className="p-5 pb-3">
            <CardTitle className="text-base font-bold flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Physical Delivery Pipeline
            </CardTitle>
            <CardDescription className="text-xs">
              Live status breakdown of all {t.total_works_count.toLocaleString("en-IN")} monitored works
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5 pt-0 space-y-4">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-emerald-950">Completed Assets</span>
                <span className="text-lg font-black text-emerald-800">
                  {t.completed_works_count.toLocaleString("en-IN")}
                </span>
              </div>
              <p className="text-[11px] text-emerald-700 mt-0.5">Physical completion confirmed on ground</p>
            </div>

            <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-blue-950">In-Progress Construction</span>
                <span className="text-lg font-black text-blue-800">
                  {t.in_progress_works_count.toLocaleString("en-IN")}
                </span>
              </div>
              <p className="text-[11px] text-blue-700 mt-0.5">Active civil milestones underway</p>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-amber-950">Stalled / Delayed</span>
                <span className="text-lg font-black text-amber-800">
                  {t.stalled_works_count.toLocaleString("en-IN")}
                </span>
              </div>
              <p className="text-[11px] text-amber-700 mt-0.5">No physical milestone progress for &gt;90 days</p>
            </div>

            <div className="rounded-lg border border-rose-200 bg-rose-50/60 p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-rose-950">Flagged High-Risk (Red Tier)</span>
                <span className="text-lg font-black text-rose-800">
                  {t.at_risk_works_count.toLocaleString("en-IN")}
                </span>
              </div>
              <p className="text-[11px] text-rose-700 mt-0.5">Predicted high probability of severe delay/cost overrun</p>
            </div>

            <div className="pt-2">
              <Button asChild variant="outline" className="w-full text-xs">
                <Link href="/dashboard/mospi/benchmarking">
                  Inspect State-by-State Breakdown <ArrowUpRight className="ml-1 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
