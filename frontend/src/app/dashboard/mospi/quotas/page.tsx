"use client";

import React, { useState } from "react";
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
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
  ArrowLeft,
  RefreshCw,
  Building2,
  CheckCircle2,
  XCircle,
  Sparkles,
  Info,
} from "lucide-react";

interface StatutoryQuotaItem {
  state_code: string;
  state_name: string;
  total_sanctioned: number;
  sc_allocated_amount: number;
  sc_allocated_pct: number;
  st_allocated_amount: number;
  st_allocated_pct: number;
  sc_compliant: boolean;
  st_compliant: boolean;
  sc_shortfall_amount: number;
  st_shortfall_amount: number;
}

interface ShortfallAlert {
  entity_id: string;
  entity_name: string;
  entity_type: string;
  sc_shortfall: number;
  st_shortfall: number;
  recommended_action: string;
}

interface StatutoryQuotaResponse {
  target_sc_pct: number;
  target_st_pct: number;
  national_sc_allocated_pct: number;
  national_st_allocated_pct: number;
  total_sc_allocated_amount: number;
  total_st_allocated_amount: number;
  total_sc_shortfall_amount: number;
  total_st_shortfall_amount: number;
  compliant_states_count: number;
  non_compliant_states_count: number;
  state_quotas: StatutoryQuotaItem[];
  shortfall_alerts: ShortfallAlert[];
}

export default function StatutoryQuotasPage() {
  const { user } = useAuth();
  const canAccess = user?.role === "mospi" || user?.role === "admin";

  const { data, isLoading, isError, error, refetch } = useAuthenticatedQuery<StatutoryQuotaResponse>(
    ["mospi-statutory-quotas"],
    "/api/v1/mospi/statutory-quotas",
    { enabled: canAccess }
  );

  if (!canAccess) {
    return (
      <ErrorState
        title="Restricted Access"
        description="Statutory Quota Oversight is restricted to MoSPI Central Ministry and Administrators."
      />
    );
  }

  if (isLoading) return <LoadingState label="Auditing nationwide SC/ST statutory quota compliance from MongoDB…" />;
  if (isError) return <ErrorState description={(error as Error).message} onRetry={() => void refetch()} />;

  const q = data!;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Link href="/dashboard/mospi" className="hover:text-blue-600 flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> MoSPI Command Center
        </Link>
        <span>/</span>
        <span className="text-slate-900 font-medium">Statutory Quota Oversight</span>
      </div>

      <PageHeader
        eyebrow="Mandatory Social Justice Compliance Engine"
        title="Statutory SC/ST Capital Allocation Quotas"
        description="Enforces mandatory constitutional allocation under MoSPI MPLADS Guidelines: at least 15% of annual funds must be directed to Scheduled Caste (SC) areas and 7.5% to Scheduled Tribe (ST) areas."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5 text-slate-600" />
              Re-evaluate Ledgers
            </Button>
            <Button size="sm" asChild>
              <Link href="/dashboard/mospi/releases">
                Central Releases Queue
              </Link>
            </Button>
          </div>
        }
      />

      {/* Target Progress Cards */}
      <div className="grid gap-5 md:grid-cols-2">
        {/* Scheduled Caste (SC) Target Card */}
        <Card className="border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                Statutory Mandate: 15.0% Minimum
              </span>
              <h3 className="text-lg font-bold text-slate-900 mt-2">Scheduled Caste (SC) Areas</h3>
              <p className="text-xs text-slate-500">Mandatory allocation for SC inhabited hamlets & colonies</p>
            </div>
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-blue-50 text-blue-700 text-lg font-black">
              15%
            </span>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-semibold text-slate-700">National Achieved Level</span>
              <span className="font-black text-slate-900">{q.national_sc_allocated_pct}% of Outlay</span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  q.national_sc_allocated_pct >= 15.0 ? "bg-emerald-600" : "bg-amber-500"
                }`}
                style={{ width: `${Math.min(100, (q.national_sc_allocated_pct / 15.0) * 100)}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
              <span>Allocated: {formatCurrency(q.total_sc_allocated_amount)}</span>
              {q.total_sc_shortfall_amount > 0 && (
                <span className="text-rose-600 font-semibold">
                  National Shortfall: {formatCurrency(q.total_sc_shortfall_amount)}
                </span>
              )}
            </div>
          </div>
        </Card>

        {/* Scheduled Tribe (ST) Target Card */}
        <Card className="border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                Statutory Mandate: 7.5% Minimum
              </span>
              <h3 className="text-lg font-bold text-slate-900 mt-2">Scheduled Tribe (ST) Areas</h3>
              <p className="text-xs text-slate-500">Mandatory allocation for tribal hamlets & forest regions</p>
            </div>
            <span className="grid h-12 w-12 place-items-center rounded-xl bg-emerald-50 text-emerald-700 text-lg font-black">
              7.5%
            </span>
          </div>

          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="flex items-center justify-between text-xs mb-1">
              <span className="font-semibold text-slate-700">National Achieved Level</span>
              <span className="font-black text-slate-900">{q.national_st_allocated_pct}% of Outlay</span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${
                  q.national_st_allocated_pct >= 7.5 ? "bg-emerald-600" : "bg-amber-500"
                }`}
                style={{ width: `${Math.min(100, (q.national_st_allocated_pct / 7.5) * 100)}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
              <span>Allocated: {formatCurrency(q.total_st_allocated_amount)}</span>
              {q.national_st_allocated_pct >= 7.5 ? (
                <span className="text-emerald-700 font-semibold">Target Exceeded (+{(q.national_st_allocated_pct - 7.5).toFixed(1)}%)</span>
              ) : (
                <span className="text-rose-600 font-semibold">Shortfall: {formatCurrency(q.total_st_shortfall_amount)}</span>
              )}
            </div>
          </div>
        </Card>
      </div>

      {/* Shortfall Alerts Section */}
      {q.shortfall_alerts.length > 0 && (
        <Card className="border-rose-200 bg-rose-50/50">
          <CardHeader className="p-5 pb-3">
            <CardTitle className="text-base font-bold text-rose-950 flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-rose-600" />
              Statutory Non-Compliance Alerts ({q.shortfall_alerts.length} Regions Flagged)
            </CardTitle>
            <CardDescription className="text-xs text-rose-800">
              States and parliamentary constituencies below the mandatory 15% SC or 7.5% ST threshold cannot receive central release tranches without corrective reallocation.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5 pt-0">
            <div className="grid gap-3 sm:grid-cols-2">
              {q.shortfall_alerts.slice(0, 4).map((alt) => (
                <div key={alt.entity_id} className="rounded-lg border border-rose-200 bg-white p-3.5 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-900">{alt.entity_name}</span>
                    <Badge variant="danger" className="text-[10px]">Shortfall Action Required</Badge>
                  </div>
                  <p className="mt-2 text-xs text-slate-600 font-medium">
                    {alt.recommended_action}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* State-by-State Quota Compliance Table */}
      <Card className="border-slate-200 shadow-xs overflow-hidden">
        <CardHeader className="p-5 pb-3 border-b border-slate-100">
          <CardTitle className="text-base font-bold">State-Level Statutory Allocation Register</CardTitle>
          <CardDescription className="text-xs">
            Complete breakdown across all benchmarked states against mandatory SC (15%) and ST (7.5%) quotas
          </CardDescription>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-4 py-3.5">State Jurisdiction</th>
                <th className="px-4 py-3.5 text-right">Total Sanctioned</th>
                <th className="px-4 py-3.5 text-right">SC Allocated</th>
                <th className="px-4 py-3.5 text-center">SC Share (Min 15%)</th>
                <th className="px-4 py-3.5 text-right">ST Allocated</th>
                <th className="px-4 py-3.5 text-center">ST Share (Min 7.5%)</th>
                <th className="px-4 py-3.5 text-center">Compliance Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {q.state_quotas.map((s) => (
                <tr key={s.state_code} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-4 py-3.5 font-bold text-slate-900">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-slate-400" />
                      <span>{s.state_name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono font-medium text-slate-800">
                    {formatCurrency(s.total_sanctioned)}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono font-medium text-slate-800">
                    {formatCurrency(s.sc_allocated_amount)}
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <span className={`font-bold ${s.sc_compliant ? "text-emerald-700" : "text-rose-600"}`}>
                      {s.sc_allocated_pct}% {s.sc_compliant ? "✓" : "✕"}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono font-medium text-slate-800">
                    {formatCurrency(s.st_allocated_amount)}
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <span className={`font-bold ${s.st_compliant ? "text-emerald-700" : "text-rose-600"}`}>
                      {s.st_allocated_pct}% {s.st_compliant ? "✓" : "✕"}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    {s.sc_compliant && s.st_compliant ? (
                      <Badge variant="success" className="text-[11px]">Fully Compliant</Badge>
                    ) : (
                      <Badge variant="danger" className="text-[11px]">Shortfall Flagged</Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
