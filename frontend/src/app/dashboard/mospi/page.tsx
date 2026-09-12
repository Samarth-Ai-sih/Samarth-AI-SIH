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
import {
  Landmark,
  TrendingUp,
  BarChart3,
  ShieldCheck,
  WalletCards,
  Database,
  ArrowRight,
  ShieldAlert,
  Building2,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Sparkles,
  ExternalLink,
} from "lucide-react";

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
  fiscal_year: string;
}

interface QuotaData {
  target_sc_pct: number;
  target_st_pct: number;
  national_sc_allocated_pct: number;
  national_st_allocated_pct: number;
  compliant_states_count: number;
  non_compliant_states_count: number;
}

interface ReleasesData {
  pending_count: number;
  authorized_count: number;
  total_pending_amount: number;
}

export default function MoSPICommandCenterPage() {
  const { user } = useAuth();
  const canAccess = user?.role === "mospi" || user?.role === "admin";

  const telemetry = useAuthenticatedQuery<TelemetryData>(["mospi-telemetry"], "/api/v1/mospi/telemetry", {
    enabled: canAccess,
  });
  const quotas = useAuthenticatedQuery<QuotaData>(["mospi-quotas"], "/api/v1/mospi/statutory-quotas", {
    enabled: canAccess,
  });
  const releases = useAuthenticatedQuery<ReleasesData>(["mospi-releases"], "/api/v1/mospi/treasury-releases", {
    enabled: canAccess,
  });

  if (!canAccess) {
    return (
      <ErrorState
        title="Restricted Ministerial Access"
        description="This section is exclusively available to authorized MoSPI Central Ministry officers and Administrators."
      />
    );
  }

  if (telemetry.isLoading) return <LoadingState label="Connecting to MoSPI National Telemetry Engine…" />;
  if (telemetry.isError) return <ErrorState description={(telemetry.error as Error).message} onRetry={() => void telemetry.refetch()} />;

  const t = telemetry.data!;
  const q = quotas.data;
  const r = releases.data;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Government of India · Ministry of Statistics & Programme Implementation"
        title="MoSPI National Command Center"
        description="Apex oversight of nationwide MPLADS expenditure, inter-state benchmark rankings, statutory SC/ST quotas, and central treasury releases."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/mospi/ingestion">
                <Database className="mr-1.5 h-3.5 w-3.5 text-blue-600" />
                PFMS / eSAKSHI Sync
              </Link>
            </Button>
            <Button size="sm" asChild>
              <Link href="/dashboard/mospi/releases">
                <WalletCards className="mr-1.5 h-3.5 w-3.5" />
                Review Pending Releases ({r?.pending_count || 0})
              </Link>
            </Button>
          </div>
        }
      />

      {/* Top 4 National Metric Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-slate-200 bg-white shadow-xs">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Annual National Outlay</p>
                <p className="mt-1.5 text-2xl font-black text-slate-900">₹4,000.00 Cr</p>
              </div>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-700">
                <Landmark className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">Fixed statutory budget for 543 parliamentary constituencies</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-xs">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Portfolio Expenditure</p>
                <p className="mt-1.5 text-2xl font-black text-emerald-700">
                  ₹{(t.total_expenditure_amount / 10000000).toFixed(2)} Cr
                </p>
              </div>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                <TrendingUp className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-2 text-xs text-emerald-600 font-medium">
              {t.utilization_rate_pct}% national utilization velocity
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-xs">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Unspent District Funds</p>
                <p className="mt-1.5 text-2xl font-black text-amber-700">
                  ₹{(t.unspent_treasury_balance / 10000000).toFixed(2)} Cr
                </p>
              </div>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-700">
                <Clock className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-2 text-xs text-amber-700 font-medium">
              ₹{(t.stagnant_funds_amount / 10000000).toFixed(2)} Cr stagnant (&gt;180 days idle)
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-xs">
          <CardContent className="p-5">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Pending Releases</p>
                <p className="mt-1.5 text-2xl font-black text-indigo-700">
                  {r?.pending_count ?? 0} Tranches
                </p>
              </div>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-indigo-700">
                <WalletCards className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              ₹{((r?.total_pending_amount || 0) / 10000000).toFixed(2)} Cr awaiting central sign-off
            </p>
          </CardContent>
        </Card>
      </div>

      {/* 5 Core Feature Launchpads */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <h3 className="text-base font-bold text-slate-900">MoSPI National Operational Modules</h3>
            <p className="text-xs text-slate-500">Execute mandated statutory powers and financial management workflows</p>
          </div>
        </div>

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {/* Module 1: Telemetry */}
          <Card className="border-slate-200 hover:border-blue-300 hover:shadow-md transition-all">
            <CardHeader className="p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-600">
                  <BarChart3 className="h-5 w-5" />
                </span>
                <Badge variant="outline" className="text-xs bg-blue-50 text-blue-800 border-blue-200">
                  Telemetry Engine
                </Badge>
              </div>
              <CardTitle className="text-base font-bold">1. Macro Fund Telemetry</CardTitle>
              <CardDescription className="text-xs leading-relaxed">
                Continuous real-time audit of nationwide fund drawdown, active vs completed projects, and sector-wise distribution.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-5 pt-0">
              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700 mb-4 border border-slate-100 space-y-1">
                <p>• <strong>{t.total_works_count.toLocaleString("en-IN")}</strong> total monitored public works</p>
                <p>• <strong>{t.completed_works_count.toLocaleString("en-IN")}</strong> completed, <strong>{t.at_risk_works_count}</strong> flagged high-risk</p>
              </div>
              <Button asChild className="w-full text-xs" variant="outline">
                <Link href="/dashboard/mospi/telemetry">
                  Open Macro Telemetry <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          {/* Module 2: Benchmarking */}
          <Card className="border-slate-200 hover:border-purple-300 hover:shadow-md transition-all">
            <CardHeader className="p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-purple-50 text-purple-600">
                  <TrendingUp className="h-5 w-5" />
                </span>
                <Badge variant="outline" className="text-xs bg-purple-50 text-purple-800 border-purple-200">
                  22 States
                </Badge>
              </div>
              <CardTitle className="text-base font-bold">2. Inter-State Benchmarking</CardTitle>
              <CardDescription className="text-xs leading-relaxed">
                Comparative state rankings evaluating fund utilization velocity, delay rates, and dormant district treasury accounts.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-5 pt-0">
              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700 mb-4 border border-slate-100 space-y-1">
                <p>• Automated efficiency score (0–100) per State</p>
                <p>• Identify lagging states for central escalation notices</p>
              </div>
              <Button asChild className="w-full text-xs" variant="outline">
                <Link href="/dashboard/mospi/benchmarking">
                  View State Leaderboard <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          {/* Module 3: Statutory Quotas */}
          <Card className="border-slate-200 hover:border-emerald-300 hover:shadow-md transition-all">
            <CardHeader className="p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-600">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-800 border-emerald-200">
                  15% SC / 7.5% ST
                </Badge>
              </div>
              <CardTitle className="text-base font-bold">3. Statutory Quota Oversight</CardTitle>
              <CardDescription className="text-xs leading-relaxed">
                Enforces nationwide compliance with mandatory social capital allocation rules under MoSPI MPLADS Guidelines.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-5 pt-0">
              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700 mb-4 border border-slate-100 space-y-1">
                <p>• National SC: <strong>{q?.national_sc_allocated_pct ?? 0}%</strong> (Target: 15%)</p>
                <p>• National ST: <strong>{q?.national_st_allocated_pct ?? 0}%</strong> (Target: 7.5%)</p>
              </div>
              <Button asChild className="w-full text-xs" variant="outline">
                <Link href="/dashboard/mospi/quotas">
                  Inspect Quota Compliance <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          {/* Module 4: Treasury Releases */}
          <Card className="border-slate-200 hover:border-indigo-300 hover:shadow-md transition-all">
            <CardHeader className="p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-indigo-600">
                  <WalletCards className="h-5 w-5" />
                </span>
                <Badge variant="outline" className="text-xs bg-indigo-50 text-indigo-800 border-indigo-200">
                  ₹2.5 Cr Tranches
                </Badge>
              </div>
              <CardTitle className="text-base font-bold">4. Central Treasury Releases</CardTitle>
              <CardDescription className="text-xs leading-relaxed">
                Review and authorize subsequent ₹2.5 Cr installment releases based on verified digital Utilization Certificates (UCs).
              </CardDescription>
            </CardHeader>
            <CardContent className="p-5 pt-0">
              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700 mb-4 border border-slate-100 space-y-1">
                <p>• <strong>{r?.pending_count ?? 0}</strong> tranches awaiting central clearance</p>
                <p>• Generates official PFMS transaction voucher references</p>
              </div>
              <Button asChild className="w-full text-xs" variant="outline">
                <Link href="/dashboard/mospi/releases">
                  Authorize Releases <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          {/* Module 5: Bulk Ingestion */}
          <Card className="border-slate-200 hover:border-amber-300 hover:shadow-md transition-all">
            <CardHeader className="p-5">
              <div className="flex items-center justify-between mb-2">
                <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-600">
                  <Database className="h-5 w-5" />
                </span>
                <Badge variant="outline" className="text-xs bg-amber-50 text-amber-800 border-amber-200">
                  PFMS & eSAKSHI
                </Badge>
              </div>
              <CardTitle className="text-base font-bold">5. Bulk Data Ingestion</CardTitle>
              <CardDescription className="text-xs leading-relaxed">
                1-click live synchronization with national financial gateways and batch CSV allocation upload engine.
              </CardDescription>
            </CardHeader>
            <CardContent className="p-5 pt-0">
              <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700 mb-4 border border-slate-100 space-y-1">
                <p>• Live sync simulation with national gateways</p>
                <p>• Column mapping, preview, and deduplication</p>
              </div>
              <Button asChild className="w-full text-xs" variant="outline">
                <Link href="/dashboard/mospi/ingestion">
                  Sync & Ingest Data <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            </CardContent>
          </Card>

          {/* Regulatory Quick-Ref */}
          <Card className="border-blue-200 bg-blue-50/50 p-5 flex flex-col justify-between">
            <div>
              <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-blue-900 mb-2">
                <Sparkles className="h-4 w-4 text-blue-600" />
                Constitutional Mandate
              </span>
              <h4 className="text-sm font-bold text-slate-900">MoSPI Apex Authority</h4>
              <p className="mt-2 text-xs text-slate-600 leading-relaxed">
                As per Chapter 2 of the Revised MPLADS Guidelines 2023, MoSPI is solely authorized to allocate annual funds, approve subsequent installments upon submission of physical progress UCs, and mandate nationwide policy safeguards.
              </p>
            </div>
            <div className="pt-4 border-t border-blue-200/60 mt-4 flex items-center justify-between text-xs text-blue-800 font-medium">
              <span>PFMS & GFR 2017 Compliant</span>
              <span>Central Desk Active</span>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
