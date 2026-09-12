"use client";

import { useAuth } from "@/lib/auth";
import { formatCurrency, formatDate, STATUS_CONFIG, CATEGORY_LABELS, WorkStatus } from "@/lib/api";
import {
  WalletCards,
  TrendingUp,
  ArrowDownRight,
  ArrowUpRight,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Landmark,
  Building2,
  Calendar,
  AlertTriangle,
  FileCheck,
  Download,
} from "lucide-react";
import Link from "next/link";
import React, { useCallback, useEffect, useState } from "react";

interface MPEntitlementSummary {
  total_annual_entitlement: number;
  tranche_1_allocation: number;
  tranche_2_allocation: number;
  recommended_amount: number;
  sanctioned_amount: number;
  disbursed_amount: number;
  actual_expenditure: number;
  total_committed: number;
  available_balance: number;
  utilization_pct: number;
  sc_allocation_target: number;
  sc_committed_amount: number;
  sc_quota_achieved_pct: number;
  st_allocation_target: number;
  st_committed_amount: number;
  st_quota_achieved_pct: number;
  works_count: Record<string, number>;
  mp_name: string;
  constituency: string;
  state_code: string;
}

interface WorkCommitment {
  work_id: string;
  title: string;
  status: string;
  category: string;
  sanctioned_amount: number;
  funds_released: number;
  actual_expenditure: number;
  sanction_order_ref?: string;
  sanctioned_date?: string;
  implementing_agency?: string;
  sc_st_quota_type?: string;
}

export default function MPLedgerPage() {
  const { user, fetchWithAuth } = useAuth();

  const [entitlement, setEntitlement] = useState<MPEntitlementSummary | null>(null);
  const [works, setWorks] = useState<WorkCommitment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadLedgerData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [entRes, worksRes] = await Promise.all([
        fetchWithAuth("/api/v1/works/mp/entitlement-summary"),
        fetchWithAuth("/api/v1/works?page=1&page_size=100&sort_by=sanctioned_amount&sort_order=desc"),
      ]);

      if (entRes.ok) {
        setEntitlement(await entRes.json());
      }
      if (worksRes.ok) {
        const worksData = await worksRes.json();
        setWorks(worksData.works || []);
      }
    } catch (err) {
      console.error("Failed to load MP ledger data:", err);
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void loadLedgerData();
  }, [loadLedgerData]);

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-3 border-emerald-600 border-t-transparent" />
        <p className="text-sm font-medium text-slate-500">Loading Statutory Entitlement Ledger…</p>
      </div>
    );
  }

  const totalEntitlement = entitlement?.total_annual_entitlement || 50000000;
  const tranche1 = entitlement?.tranche_1_allocation || 25000000;
  const tranche2 = entitlement?.tranche_2_allocation || 25000000;
  const sanctionedAmount = entitlement?.sanctioned_amount || 0;
  const disbursedAmount = entitlement?.disbursed_amount || 0;
  const recommendedAmount = entitlement?.recommended_amount || 0;
  const availableBalance = entitlement?.available_balance ?? 50000000;

  // Tranche 2 eligibility calculation (requires 80% expenditure of Tranche 1 = ₹2.00 Cr)
  const tranche1Threshold = tranche1 * 0.8;
  const isTranche2Eligible = disbursedAmount >= tranche1Threshold;

  // Sector breakdown aggregation
  const sectorMap: Record<string, number> = {};
  works.forEach((w) => {
    const cat = w.category || "other";
    sectorMap[cat] = (sectorMap[cat] || 0) + (w.sanctioned_amount || 0);
  });
  const sectorList = Object.entries(sectorMap).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-6 pb-12">
      {/* ── Page Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-5">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700">
            <WalletCards className="h-3.5 w-3.5" />
            MPLADS Statutory Fiscal Ledger
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 mt-1">
            ₹5.00 Crore Entitlement & Tranche Ledger
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Constituency of {entitlement?.constituency || user?.jurisdiction.constituency || "Varanasi Urban"} • FY 2025–26 Tranche Allocation
          </p>
        </div>

        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-50"
        >
          <Download className="h-4 w-4" />
          Print / Export Ledger
        </button>
      </div>

      {/* ── Visual Waterfall Progression ── */}
      <div className="rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-900 to-slate-950 p-6 text-white shadow-md">
        <h3 className="text-sm font-bold uppercase tracking-wider text-emerald-400 mb-5">
          Statutory Capital Waterfall Progression (FY 2025–26)
        </h3>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {/* Step 1: Entitlement */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold uppercase">
              <span>Step 1: Allocation</span>
              <Landmark className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <p className="text-lg font-black text-white">{formatCurrency(totalEntitlement)}</p>
            <p className="text-[10px] text-slate-400">Total Statutory Annual Entitlement</p>
          </div>

          {/* Step 2: Tranche 1 */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold uppercase">
              <span>Tranche 1 (Released)</span>
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <p className="text-lg font-black text-emerald-300">{formatCurrency(tranche1)}</p>
            <p className="text-[10px] text-emerald-200/70">Credited to District SNA Account</p>
          </div>

          {/* Step 3: Tranche 2 */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold uppercase">
              <span>Tranche 2 (Installment)</span>
              {isTranche2Eligible ? (
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <Clock className="h-3.5 w-3.5 text-amber-400" />
              )}
            </div>
            <p className="text-lg font-black text-white">{formatCurrency(tranche2)}</p>
            <p className="text-[10px] text-slate-400">
              {isTranche2Eligible ? "✓ Eligible for MoSPI Release" : "Requires 80% Tranche 1 Exp."}
            </p>
          </div>

          {/* Step 4: Sanctioned Outlay */}
          <div className="rounded-xl border border-white/10 bg-white/5 p-4 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold uppercase">
              <span>Sanctioned Outlay</span>
              <FileCheck className="h-3.5 w-3.5 text-blue-400" />
            </div>
            <p className="text-lg font-black text-blue-300">{formatCurrency(sanctionedAmount)}</p>
            <p className="text-[10px] text-slate-400">Committed via official AS Orders</p>
          </div>

          {/* Step 5: Uncommitted Balance */}
          <div className="rounded-xl border border-emerald-500/40 bg-emerald-950/40 p-4 space-y-1">
            <div className="flex items-center justify-between text-[11px] text-emerald-400 font-semibold uppercase">
              <span>Uncommitted Room</span>
              <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <p className="text-lg font-black text-emerald-400">{formatCurrency(availableBalance)}</p>
            <p className="text-[10px] text-emerald-200/70">Remaining for new proposals</p>
          </div>
        </div>
      </div>

      {/* ── Tranche 2 Unlock Criteria Tracker ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900">MoSPI Tranche 2 Release Compliance Status</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Under MoSPI MPLADS Guidelines Section 3.2, second tranche of ₹2.50 Cr requires minimum 80% utilization of Installment 1 (₹200.00 Lakhs).
            </p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-bold shrink-0 ${
              isTranche2Eligible
                ? "bg-emerald-100 text-emerald-800"
                : "bg-amber-100 text-amber-800"
            }`}
          >
            {isTranche2Eligible ? "✓ Eligible for Release" : "⏳ Utilization in Progress"}
          </span>
        </div>

        <div className="mt-4 space-y-2">
          <div className="flex justify-between text-xs font-semibold text-slate-700">
            <span>Ground Funds Disbursed: {formatCurrency(disbursedAmount)}</span>
            <span>Target Threshold: {formatCurrency(tranche1Threshold)} (80%)</span>
          </div>
          <div className="h-3 w-full rounded-full bg-slate-100 overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                isTranche2Eligible ? "bg-emerald-600" : "bg-amber-500"
              }`}
              style={{ width: `${Math.min(100, (disbursedAmount / tranche1Threshold) * 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* ── Sector-Wise Capital Allocation ── */}
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs">
        <h3 className="text-sm font-bold text-slate-900 mb-4">Sectoral Outlay Allocation</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {sectorList.map(([cat, amt]) => {
            const pct = totalEntitlement > 0 ? (amt / totalEntitlement) * 100 : 0;
            return (
              <div key={cat} className="rounded-xl border border-slate-100 bg-slate-50/50 p-3 space-y-1.5">
                <div className="flex justify-between items-center text-xs">
                  <span className="font-bold text-slate-800">
                    {CATEGORY_LABELS[cat as keyof typeof CATEGORY_LABELS] || cat}
                  </span>
                  <span className="font-semibold text-slate-500">{pct.toFixed(1)}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-600" style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
                <p className="text-xs font-black text-slate-900">{formatCurrency(amt)}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Itemized Project Financial Commitments ── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="border-b border-slate-100 p-5 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-slate-900">Project Financial Commitments Ledger</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Audited listing of all capital appropriations sanctioned by District Authority
            </p>
          </div>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {works.length} Works Recorded
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-100 bg-slate-50/60 text-slate-500 uppercase font-semibold">
              <tr>
                <th className="px-5 py-3">Work Title & AS Ref</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Sanctioned Outlay</th>
                <th className="px-4 py-3">Disbursed Funds</th>
                <th className="px-4 py-3">Actual Expenditure</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-5 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {works.map((w) => {
                const sc = STATUS_CONFIG[w.status as WorkStatus] || {
                  label: w.status,
                  color: "#475569",
                  bg: "#f1f5f9",
                  border: "#cbd5e1",
                };
                return (
                  <tr key={w.work_id} className="hover:bg-slate-50/80 transition-colors">
                    <td className="px-5 py-3.5">
                      <Link
                        href={`/dashboard/works/${w.work_id}`}
                        className="font-bold text-slate-900 hover:text-emerald-700 line-clamp-1"
                      >
                        {w.title}
                      </Link>
                      <span className="font-mono text-[10px] text-slate-500 block mt-0.5">
                        {w.sanction_order_ref || `ID: ${w.work_id.slice(0, 8)}…`}
                      </span>
                    </td>

                    <td className="px-4 py-3.5 text-slate-600">
                      {CATEGORY_LABELS[w.category as keyof typeof CATEGORY_LABELS] || w.category}
                    </td>

                    <td className="px-4 py-3.5 font-bold text-slate-900">
                      {formatCurrency(w.sanctioned_amount)}
                    </td>

                    <td className="px-4 py-3.5 font-semibold text-emerald-700">
                      {formatCurrency(w.funds_released)}
                    </td>

                    <td className="px-4 py-3.5 font-semibold text-slate-700">
                      {formatCurrency(w.actual_expenditure)}
                    </td>

                    <td className="px-4 py-3.5">
                      <span
                        className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold"
                        style={{ color: sc.color, backgroundColor: sc.bg }}
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: sc.color }} />
                        {sc.label}
                      </span>
                    </td>

                    <td className="px-5 py-3.5 text-right">
                      <Link
                        href={`/dashboard/works/${w.work_id}`}
                        className="text-xs font-semibold text-emerald-700 hover:text-emerald-800"
                      >
                        Inspect &rarr;
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
