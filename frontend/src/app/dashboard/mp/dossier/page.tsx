"use client";

import { useAuth } from "@/lib/auth";
import { formatCurrency, formatDate, STATUS_CONFIG, CATEGORY_LABELS } from "@/lib/api";
import {
  FileCheck,
  Printer,
  Download,
  Landmark,
  CheckCircle2,
  Calendar,
  Building2,
  ShieldCheck,
  Users,
  Award,
  Sparkles,
  Layers,
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

interface WorkItem {
  work_id: string;
  title: string;
  status: string;
  category: string;
  sub_category?: string;
  sanctioned_amount: number;
  funds_released: number;
  actual_expenditure: number;
  physical_progress_pct: number;
  implementing_agency?: string;
  sanction_order_ref?: string;
  sanctioned_date?: string;
  sc_st_quota_type?: string;
  pincode?: string;
}

export default function MPDeliveryDossierPage() {
  const { user, fetchWithAuth } = useAuth();

  const [entitlement, setEntitlement] = useState<MPEntitlementSummary | null>(null);
  const [works, setWorks] = useState<WorkItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const loadDossierData = useCallback(async () => {
    setIsLoading(true);
    try {
      const [entRes, worksRes] = await Promise.all([
        fetchWithAuth("/api/v1/works/mp/entitlement-summary"),
        fetchWithAuth("/api/v1/works?page=1&page_size=100&sort_by=sanctioned_amount&sort_order=desc"),
      ]);
      if (entRes.ok) setEntitlement(await entRes.json());
      if (worksRes.ok) {
        const d = await worksRes.json();
        setWorks(d.works || []);
      }
    } catch (err) {
      console.error("Failed to load dossier data:", err);
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void loadDossierData();
  }, [loadDossierData]);

  const handleExportCSV = () => {
    if (!works.length) return;
    const headers = ["Work ID", "Title", "Category", "Sanction Order Ref", "Outlay (INR)", "Disbursed (INR)", "Progress %", "Agency", "Status", "Quota"];
    const rows = works.map((w) => [
      w.work_id,
      `"${w.title.replace(/"/g, '""')}"`,
      w.category,
      `"${w.sanction_order_ref || ""}"`,
      w.sanctioned_amount,
      w.funds_released,
      w.physical_progress_pct,
      `"${(w.implementing_agency || "").replace(/"/g, '""')}"`,
      w.status,
      w.sc_st_quota_type || "general",
    ]);

    const csvContent = "data:text/csv;charset=utf-8," + [headers.join(","), ...rows.map((e) => e.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `MPLADS_Delivery_Dossier_${entitlement?.constituency || "Varanasi"}_2026.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (isLoading) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-3 border-emerald-600 border-t-transparent" />
        <p className="text-sm font-medium text-slate-500">Generating Parliamentary Delivery Dossier…</p>
      </div>
    );
  }

  const constituencyName = entitlement?.constituency || user?.jurisdiction.constituency || "Varanasi Urban";
  const mpName = entitlement?.mp_name || user?.full_name || "Hon. Member of Parliament";
  const completedWorks = works.filter((w) => w.status === "completed");
  const inProgressWorks = works.filter((w) => w.status === "in_progress" || w.status === "sanctioned");

  return (
    <div className="space-y-6 pb-12">
      {/* ── Action Header (Hidden in Print) ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-5 print:hidden">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700">
            <FileCheck className="h-3.5 w-3.5" />
            Public Accountability & Civic Reporting
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 mt-1">
            Parliamentary Constituency Delivery Dossier
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Published for citizen town halls, press release, and MoSPI statutory oversight.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleExportCSV}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 shadow-2xs hover:bg-slate-50"
          >
            <Download className="h-4 w-4" />
            Export CSV
          </button>
          <button
            onClick={() => window.print()}
            className="inline-flex items-center gap-2 rounded-xl bg-emerald-700 px-4 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-800"
          >
            <Printer className="h-4 w-4" />
            Print Dossier Report
          </button>
        </div>
      </div>

      {/* ── Official Printable Document Container ── */}
      <div className="rounded-3xl border border-slate-200 bg-white p-8 sm:p-12 shadow-sm space-y-8 print:border-none print:shadow-none print:p-0">
        {/* Document Crest & Header */}
        <div className="border-b-2 border-slate-900 pb-6 text-center space-y-2">
          <div className="flex justify-center">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-emerald-900 text-emerald-300">
              <Landmark className="h-7 w-7" />
            </div>
          </div>
          <h2 className="text-xs font-black uppercase tracking-widest text-slate-500">
            GOVERNMENT OF INDIA • MPLADS SCHEME
          </h2>
          <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-slate-950 uppercase">
            PARLIAMENTARY DELIVERY & CIVIC ACCOUNTABILITY DOSSIER
          </h1>
          <p className="text-sm font-semibold text-slate-700">
            Parliamentary Constituency: <span className="text-emerald-800 font-bold">{constituencyName}</span> • Representative: <span className="text-slate-900 font-bold">{mpName}</span>
          </p>
          <p className="text-xs text-slate-500">
            Reporting Period: Financial Year 2025–26 • Generated via SAMARTH AI National Platform
          </p>
        </div>

        {/* Executive Summary Cards */}
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-1">
            <span className="text-[11px] font-bold text-slate-500 uppercase">Total Community Assets</span>
            <p className="text-2xl font-black text-slate-900">{works.length} Projects</p>
            <p className="text-xs text-slate-500">{completedWorks.length} delivered to public</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-1">
            <span className="text-[11px] font-bold text-slate-500 uppercase">Total Outlay Appropriated</span>
            <p className="text-2xl font-black text-emerald-800">{formatCurrency(entitlement?.sanctioned_amount || 0)}</p>
            <p className="text-xs text-slate-500">Sanctioned by District Magistrate</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-1">
            <span className="text-[11px] font-bold text-slate-500 uppercase">Disbursed Ground Funds</span>
            <p className="text-2xl font-black text-slate-900">{formatCurrency(entitlement?.disbursed_amount || 0)}</p>
            <p className="text-xs text-slate-500">Released to executing agencies</p>
          </div>

          <div className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4 space-y-1">
            <span className="text-[11px] font-bold text-slate-500 uppercase">SC / ST Quota Mandate</span>
            <p className="text-2xl font-black text-indigo-900">{formatCurrency(entitlement?.sc_committed_amount || 0)}</p>
            <p className="text-xs text-slate-500">{entitlement?.sc_quota_achieved_pct}% of statutory target met</p>
          </div>
        </div>

        {/* Legislative Message / Statement */}
        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-5 space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-emerald-900 flex items-center gap-2">
            <Award className="h-4 w-4 text-emerald-700" />
            Statement of Community Commitment
          </h3>
          <p className="text-xs leading-relaxed text-emerald-950 font-medium">
            This dossier reflects the formal public infrastructure delivered through the Member of Parliament Local Area Development Scheme (MPLADS) in {constituencyName}.
            Every project has undergone automated GPS spatial feasibility check to eliminate duplicate public expenditure, received administrative sanction from the District Magistrate, and is monitored through geotagged photographic evidence.
          </p>
        </div>

        {/* Itemized Project Annexure Table */}
        <div className="space-y-3">
          <div className="flex items-center justify-between border-b border-slate-200 pb-2">
            <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
              Annexure I: Itemized Schedule of Public Utility Works
            </h3>
            <span className="text-xs text-slate-500">{works.length} Authorized Records</span>
          </div>

          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-200 bg-slate-100/80 text-slate-600 font-bold uppercase">
              <tr>
                <th className="py-2.5 px-3">#</th>
                <th className="py-2.5 px-3">Project Title</th>
                <th className="py-2.5 px-3">Sector</th>
                <th className="py-2.5 px-3">Sanction Order Ref</th>
                <th className="py-2.5 px-3 text-right">Sanctioned (INR)</th>
                <th className="py-2.5 px-3 text-center">Progress</th>
                <th className="py-2.5 px-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {works.map((work, index) => (
                <tr key={work.work_id} className="hover:bg-slate-50">
                  <td className="py-2.5 px-3 text-slate-400 font-mono text-[11px]">{index + 1}</td>
                  <td className="py-2.5 px-3 font-bold text-slate-900">{work.title}</td>
                  <td className="py-2.5 px-3 text-slate-600 capitalize">{work.category.replace("_", " ")}</td>
                  <td className="py-2.5 px-3 font-mono text-[11px] text-slate-700">{work.sanction_order_ref || "—"}</td>
                  <td className="py-2.5 px-3 text-right font-bold text-slate-900">{formatCurrency(work.sanctioned_amount)}</td>
                  <td className="py-2.5 px-3 text-center font-bold text-slate-700">{work.physical_progress_pct}%</td>
                  <td className="py-2.5 px-3">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-bold uppercase text-slate-700">
                      {work.status.replace("_", " ")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Formal Sign-off footer */}
        <div className="pt-8 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-6 text-xs text-slate-500">
          <div className="space-y-1 text-center sm:text-left">
            <p className="font-semibold text-slate-800">Official Dossier of Record</p>
            <p>Certified by District Administration & MoSPI SNA Integration</p>
          </div>
          <div className="text-center sm:text-right space-y-1">
            <div className="h-10 border-b border-slate-400 w-48 mx-auto sm:ml-auto" />
            <p className="font-bold text-slate-900">{mpName}</p>
            <p className="text-[11px]">Member of Parliament, Lok Sabha / Rajya Sabha</p>
          </div>
        </div>
      </div>
    </div>
  );
}
