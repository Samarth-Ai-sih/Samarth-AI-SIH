"use client";

import { useAuth } from "@/lib/auth";
import { formatCurrency, formatDate, STATUS_CONFIG, CATEGORY_LABELS, WorkStatus } from "@/lib/api";
import {
  Landmark,
  WalletCards,
  BriefcaseBusiness,
  TrendingUp,
  MapPin,
  FileCheck,
  CheckCircle2,
  Clock,
  AlertCircle,
  Plus,
  ArrowRight,
  ShieldAlert,
  Search,
  ExternalLink,
  BarChart3,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
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

interface WorkItem {
  work_id: string;
  title: string;
  status: string;
  category: string;
  sanctioned_amount: number;
  funds_released: number;
  physical_progress_pct: number;
  implementing_agency: string;
  recommended_date?: string;
  sanctioned_date?: string;
  sc_st_quota_type?: string;
  sanction_order_ref?: string;
}

export default function MPCommandCenterPage() {
  const { user, fetchWithAuth, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const [entitlement, setEntitlement] = useState<MPEntitlementSummary | null>(null);
  const [works, setWorks] = useState<WorkItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedStatus, setSelectedStatus] = useState<string>("all");

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      // 1. Fetch Entitlement Summary
      const entRes = await fetchWithAuth("/api/v1/works/mp/entitlement-summary");
      if (entRes.ok) {
        const entData = await entRes.json();
        setEntitlement(entData);
      }

      // 2. Fetch Works in Constituency
      const worksRes = await fetchWithAuth("/api/v1/works?page=1&page_size=50&sort_by=created_at&sort_order=desc");
      if (worksRes.ok) {
        const worksData = await worksRes.json();
        setWorks(worksData.works || []);
      }
    } catch (err) {
      console.error("Failed to load MP Command Center data:", err);
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    if (!authLoading && user) {
      void loadData();
    }
  }, [authLoading, user, loadData]);

  if (authLoading || isLoading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-3 border-emerald-600 border-t-transparent" />
        <p className="text-sm font-medium text-slate-500">Loading MP Constituency Command Center…</p>
      </div>
    );
  }

  const constituencyName = entitlement?.constituency || user?.jurisdiction.constituency || "Varanasi Urban";
  const stateCode = entitlement?.state_code || user?.jurisdiction.state_code || "UP";
  const mpName = entitlement?.mp_name || user?.full_name || "Hon. Member of Parliament";

  const totalEntitlement = entitlement?.total_annual_entitlement || 50000000;
  const sanctionedOutlay = entitlement?.sanctioned_amount || 0;
  const recommendedOutlay = entitlement?.recommended_amount || 0;
  const availableBal = entitlement?.available_balance ?? 50000000;
  const scPct = entitlement?.sc_quota_achieved_pct || 0;
  const stPct = entitlement?.st_quota_achieved_pct || 0;

  const filteredWorks = works.filter((w) => {
    const matchesSearch =
      w.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      w.work_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (w.implementing_agency && w.implementing_agency.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesStatus = selectedStatus === "all" || w.status === selectedStatus;
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-6 pb-12">
      {/* ── Top Hero Header ── */}
      <div className="rounded-2xl border border-emerald-200/80 bg-gradient-to-br from-emerald-900 via-teal-950 to-slate-900 p-6 text-white shadow-lg sm:p-8">
        <div className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-2">
            <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-emerald-300">
              <Landmark className="h-3.5 w-3.5" />
              Parliamentary Constituency Command Center
            </div>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl text-white">
              {constituencyName}
            </h1>
            <p className="text-sm text-emerald-200/90 font-medium">
              Represented by <span className="font-semibold text-white">{mpName}</span> • State of {stateCode} • FY 2025–26 MPLADS Allocation
            </p>
          </div>

          {/* Action CTAs */}
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/dashboard/mp/recommendations"
              className="inline-flex items-center gap-2 rounded-xl bg-emerald-500 px-4 py-2.5 text-sm font-bold text-slate-950 shadow-sm transition hover:bg-emerald-400 hover:shadow-md"
            >
              <Plus className="h-4 w-4" />
              Recommend New Work
            </Link>
            <Link
              href="/dashboard/mp/ledger"
              className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-white/10 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/20"
            >
              <WalletCards className="h-4 w-4" />
              Entitlement Ledger
            </Link>
            <Link
              href="/dashboard/mp/dossier"
              className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/5 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10"
            >
              <FileCheck className="h-4 w-4" />
              Civic Dossier
            </Link>
          </div>
        </div>

        {/* ── Key Financial Telemetry Bars ── */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4 border-t border-emerald-800/60 pt-6">
          <div className="space-y-1">
            <p className="text-xs font-medium text-emerald-300/80 uppercase">Annual Entitlement</p>
            <p className="text-xl sm:text-2xl font-black tracking-tight text-white">
              {formatCurrency(totalEntitlement)}
            </p>
            <p className="text-[11px] text-emerald-200/70">Statutory ₹5.00 Cr / Fiscal Year</p>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-emerald-300/80 uppercase">Sanctioned Outlay</p>
            <p className="text-xl sm:text-2xl font-black tracking-tight text-emerald-400">
              {formatCurrency(sanctionedOutlay)}
            </p>
            <p className="text-[11px] text-emerald-200/70">
              {entitlement?.works_count?.sanctioned || 0} projects officially sanctioned
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-emerald-300/80 uppercase">Pending DA Sanction</p>
            <p className="text-xl sm:text-2xl font-black tracking-tight text-amber-300">
              {formatCurrency(recommendedOutlay)}
            </p>
            <p className="text-[11px] text-emerald-200/70">
              {entitlement?.works_count?.recommended || 0} proposals with District Authority
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs font-medium text-emerald-300/80 uppercase">Available Balance</p>
            <p className="text-xl sm:text-2xl font-black tracking-tight text-white">
              {formatCurrency(availableBal)}
            </p>
            <p className="text-[11px] text-emerald-200/70">Uncommitted entitlement headroom</p>
          </div>
        </div>
      </div>

      {/* ── Statutory Quota Meters (SC 15% & ST 7.5%) ── */}
      <div className="grid gap-4 md:grid-cols-2">
        {/* SC Quota */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-slate-300">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="flex h-2.5 w-2.5 rounded-full bg-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900">Scheduled Caste (SC) Quota</h3>
              </div>
              <p className="text-xs text-slate-500">Statutory 15% mandate for SC-inhabited areas (Min ₹75.00 Lakhs)</p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                scPct >= 100
                  ? "bg-emerald-100 text-emerald-800"
                  : scPct >= 50
                  ? "bg-blue-100 text-blue-800"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {scPct >= 100 ? "✓ Quota Met" : `${scPct}% Achieved`}
            </span>
          </div>

          <div className="mt-4 space-y-2">
            <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-indigo-700 transition-all duration-500"
                style={{ width: `${Math.min(100, scPct)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-slate-600 font-medium">
              <span>Committed: {formatCurrency(entitlement?.sc_committed_amount || 0)}</span>
              <span>Target: ₹75.00 Lakhs</span>
            </div>
          </div>
        </div>

        {/* ST Quota */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-slate-300">
          <div className="flex items-center justify-between gap-3">
            <div className="space-y-0.5">
              <div className="flex items-center gap-2">
                <span className="flex h-2.5 w-2.5 rounded-full bg-teal-600" />
                <h3 className="text-sm font-bold text-slate-900">Scheduled Tribe (ST) Quota</h3>
              </div>
              <p className="text-xs text-slate-500">Statutory 7.5% mandate for ST-inhabited areas (Min ₹37.50 Lakhs)</p>
            </div>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-bold ${
                stPct >= 100
                  ? "bg-emerald-100 text-emerald-800"
                  : stPct >= 50
                  ? "bg-teal-100 text-teal-800"
                  : "bg-amber-100 text-amber-800"
              }`}
            >
              {stPct >= 100 ? "✓ Quota Met" : `${stPct}% Achieved`}
            </span>
          </div>

          <div className="mt-4 space-y-2">
            <div className="h-3 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-gradient-to-r from-teal-500 to-teal-700 transition-all duration-500"
                style={{ width: `${Math.min(100, stPct)}%` }}
              />
            </div>
            <div className="flex items-center justify-between text-xs text-slate-600 font-medium">
              <span>Committed: {formatCurrency(entitlement?.st_committed_amount || 0)}</span>
              <span>Target: ₹37.50 Lakhs</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Quick Navigation Portal Cards ── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/dashboard/mp/recommendations"
          className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-emerald-500 hover:shadow-md"
        >
          <div className="flex items-center justify-between">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white transition">
              <BriefcaseBusiness className="h-5 w-5" />
            </div>
            <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-emerald-600 group-hover:translate-x-1 transition" />
          </div>
          <h4 className="mt-4 text-sm font-bold text-slate-900">Recommendation Portal</h4>
          <p className="mt-1 text-xs text-slate-500">Propose community assets with automated &le;50m duplicate detection.</p>
        </Link>

        <Link
          href="/dashboard/mp/ledger"
          className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-blue-500 hover:shadow-md"
        >
          <div className="flex items-center justify-between">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-700 group-hover:bg-blue-600 group-hover:text-white transition">
              <WalletCards className="h-5 w-5" />
            </div>
            <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-blue-600 group-hover:translate-x-1 transition" />
          </div>
          <h4 className="mt-4 text-sm font-bold text-slate-900">₹5.00 Cr Fiscal Ledger</h4>
          <p className="mt-1 text-xs text-slate-500">Track tranche release criteria, committed outlays, and uncommitted balance.</p>
        </Link>

        <Link
          href="/dashboard/mp/map"
          className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-purple-500 hover:shadow-md"
        >
          <div className="flex items-center justify-between">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-purple-50 text-purple-700 group-hover:bg-purple-600 group-hover:text-white transition">
              <MapPin className="h-5 w-5" />
            </div>
            <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-purple-600 group-hover:translate-x-1 transition" />
          </div>
          <h4 className="mt-4 text-sm font-bold text-slate-900">Constituency GIS Map</h4>
          <p className="mt-1 text-xs text-slate-500">Interactive spatial view of all completed and active community assets.</p>
        </Link>

        <Link
          href="/dashboard/mp/dossier"
          className="group rounded-2xl border border-slate-200 bg-white p-5 shadow-xs transition hover:border-amber-500 hover:shadow-md"
        >
          <div className="flex items-center justify-between">
            <div className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-700 group-hover:bg-amber-600 group-hover:text-white transition">
              <FileCheck className="h-5 w-5" />
            </div>
            <ArrowRight className="h-4 w-4 text-slate-400 group-hover:text-amber-600 group-hover:translate-x-1 transition" />
          </div>
          <h4 className="mt-4 text-sm font-bold text-slate-900">Civic Delivery Dossier</h4>
          <p className="mt-1 text-xs text-slate-500">1-click parliamentary accountability report for citizens and town halls.</p>
        </Link>
      </div>

      {/* ── Active Constituency Works Register ── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="border-b border-slate-100 p-5 sm:flex sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-base font-bold text-slate-900">Constituency Development Works</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Showing {filteredWorks.length} projects in {constituencyName}
            </p>
          </div>

          <div className="mt-4 sm:mt-0 flex flex-wrap items-center gap-3">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search works, ID, agency…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-9 w-60 rounded-xl border border-slate-200 bg-slate-50/50 pl-9 pr-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:outline-hidden"
              />
            </div>

            {/* Status Filter */}
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
              className="h-9 rounded-xl border border-slate-200 bg-slate-50/50 px-3 text-xs font-semibold text-slate-700 focus:border-emerald-500 focus:bg-white focus:outline-hidden"
            >
              <option value="all">All Statuses</option>
              <option value="recommended">Pending Sanction</option>
              <option value="sanctioned">Sanctioned</option>
              <option value="in_progress">In Progress</option>
              <option value="completed">Completed</option>
              <option value="on_hold">On Hold</option>
            </select>
          </div>
        </div>

        {/* Works Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-100 bg-slate-50/60 text-slate-500 uppercase font-semibold">
              <tr>
                <th className="px-5 py-3">Work Title & Sector</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Sanction / AS Ref</th>
                <th className="px-4 py-3">Outlay (INR)</th>
                <th className="px-4 py-3">Progress</th>
                <th className="px-4 py-3">Line Agency</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {filteredWorks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-12 text-center text-slate-400">
                    No development works match the selected filters.
                  </td>
                </tr>
              ) : (
                filteredWorks.map((work) => {
                  const sc = STATUS_CONFIG[work.status as WorkStatus] || {
                    label: work.status,
                    color: "#475569",
                    bg: "#f1f5f9",
                    border: "#cbd5e1",
                  };
                  return (
                    <tr key={work.work_id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="space-y-0.5">
                          <Link
                            href={`/dashboard/works/${work.work_id}`}
                            className="font-bold text-slate-900 hover:text-emerald-700 line-clamp-1"
                          >
                            {work.title}
                          </Link>
                          <div className="flex items-center gap-2 text-[11px] text-slate-500">
                            <span>{CATEGORY_LABELS[work.category as keyof typeof CATEGORY_LABELS] || work.category}</span>
                            {work.sc_st_quota_type && work.sc_st_quota_type !== "general" && (
                              <span className="rounded bg-indigo-50 px-1.5 py-0.2 text-[10px] font-bold text-indigo-700 uppercase">
                                {work.sc_st_quota_type} Quota
                              </span>
                            )}
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3.5">
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                          style={{ color: sc.color, backgroundColor: sc.bg }}
                        >
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: sc.color }} />
                          {sc.label}
                        </span>
                      </td>

                      <td className="px-4 py-3.5 text-slate-600">
                        {work.sanction_order_ref ? (
                          <span className="font-mono text-[11px] font-semibold text-slate-800">
                            {work.sanction_order_ref}
                          </span>
                        ) : work.status === "recommended" ? (
                          <span className="text-[11px] text-amber-600 font-semibold italic">
                            Awaiting DM Sanction
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>

                      <td className="px-4 py-3.5 font-bold text-slate-900">
                        {formatCurrency(work.sanctioned_amount)}
                      </td>

                      <td className="px-4 py-3.5">
                        <div className="w-24 space-y-1">
                          <div className="flex justify-between text-[10px] text-slate-500">
                            <span>{work.physical_progress_pct}%</span>
                          </div>
                          <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                            <div
                              className="h-full rounded-full bg-emerald-600"
                              style={{ width: `${Math.min(100, work.physical_progress_pct)}%` }}
                            />
                          </div>
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-slate-600 text-[11px] max-w-40 truncate">
                        {work.implementing_agency || "To be assigned"}
                      </td>

                      <td className="px-5 py-3.5 text-right">
                        <Link
                          href={`/dashboard/works/${work.work_id}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-emerald-700"
                        >
                          360° View
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
