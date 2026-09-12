"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useAuthenticatedQuery } from "@/lib/query";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ArrowLeftRight,
  TrendingDown,
  TrendingUp,
  Clock,
  Landmark,
  Building2,
  CheckCircle2,
  History,
  X,
  FileCheck2,
  Sparkles,
  ArrowRight,
} from "lucide-react";

interface DistrictTreasuryAllocation {
  district_code: string;
  district_name: string;
  sanctioned_amount: number;
  expenditure_amount: number;
  unspent_balance: number;
  utilization_rate_pct: number;
  absorption_velocity: "high" | "normal" | "stagnant";
  eligible_for_inflow: boolean;
  eligible_for_outflow: boolean;
}

interface ReallocationRecord {
  reallocation_id: string;
  source_district_code: string;
  source_district_name: string;
  target_district_code: string;
  target_district_name: string;
  reallocated_amount: number;
  justification: string;
  docket_reference: string;
  authorized_by: string;
  reallocated_at: string;
}

interface AllocationsResponse {
  state_code: string;
  state_name: string;
  state_total_sanctioned_cr: number;
  state_total_expenditure_cr: number;
  state_total_unspent_cr: number;
  district_allocations: DistrictTreasuryAllocation[];
  reallocation_history: ReallocationRecord[];
}

function parseApiError(detail: any, fallback: string): string {
  if (!detail) return fallback;
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) {
    return detail.map((d: any) => d.msg || d.message || JSON.stringify(d)).join("; ");
  }
  if (typeof detail === "object") {
    return detail.msg || detail.message || JSON.stringify(detail);
  }
  return String(detail);
}

export default function InterDistrictAllocationPage() {
  const { user, fetchWithAuth } = useAuth();
  const stateCode = user?.jurisdiction?.state_code || "UP";
  const queryClient = useQueryClient();

  const [modalOpen, setModalOpen] = useState(false);
  const [sourceDistrict, setSourceDistrict] = useState("");
  const [targetDistrict, setTargetDistrict] = useState("");
  const [reallocAmountCr, setReallocAmountCr] = useState<number>(1.0);
  const [justification, setJustification] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [successResult, setSuccessResult] = useState<string | null>(null);
  const [errorResult, setErrorResult] = useState<string | null>(null);

  const { data, isLoading } = useAuthenticatedQuery<AllocationsResponse>(
    ["sno-allocations", stateCode],
    `/api/v1/sno/allocations?state_code=${stateCode}`,
    { staleTime: 30_000 }
  );

  const districts = data?.district_allocations || [];
  const history = data?.reallocation_history || [];

  async function handleReallocate(e: React.FormEvent) {
    e.preventDefault();
    if (!sourceDistrict || !targetDistrict || sourceDistrict === targetDistrict) {
      setErrorResult("Please select different source and destination districts.");
      return;
    }
    setSubmitting(true);
    setSuccessResult(null);
    setErrorResult(null);

    try {
      const res = await fetchWithAuth("/api/v1/sno/allocations/reallocate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source_district_code: sourceDistrict,
          target_district_code: targetDistrict,
          amount_to_reallocate: reallocAmountCr * 10000000.0,
          justification: justification || "Inter-district fund reallocation to prevent year-end fund surrender.",
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errText = parseApiError(body.detail, "Failed to execute reallocation.");
        throw new Error(errText);
      }

      setSuccessResult(body.message);
      void queryClient.invalidateQueries({ queryKey: ["sno-allocations"] });
      void queryClient.invalidateQueries({ queryKey: ["sno-heatmap"] });
      setTimeout(() => {
        setModalOpen(false);
        setSuccessResult(null);
        setErrorResult(null);
        setJustification("");
      }, 2200);
    } catch (err: any) {
      setErrorResult(err.message || "Failed to reallocate funds.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <Badge className="bg-amber-100 text-amber-800 border-amber-200 text-xs">
              State Treasury Oversight · {data?.state_name || stateCode}
            </Badge>
            <span className="text-xs text-slate-500 font-medium">· Section 7.2 Fund Velocity Engine</span>
          </div>
          <h1 className="text-2xl font-black text-slate-950 mt-1 flex items-center gap-2">
            <ArrowLeftRight className="h-6 w-6 text-amber-600" />
            Inter-District Allocation & Reallocation Engine
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 max-w-2xl mt-0.5">
            Monitor unspent balances in district nodal bank accounts and authorize cross-district fund transfers from stagnant districts to high-velocity capital projects.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            onClick={() => {
              if (districts.length >= 2) {
                setSourceDistrict(districts[0].district_code);
                setTargetDistrict(districts[1].district_code);
              }
              setModalOpen(true);
            }}
            className="bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold shadow-md flex items-center gap-1.5"
          >
            <ArrowLeftRight className="h-3.5 w-3.5" />
            New Fund Reallocation
          </Button>
        </div>
      </div>

      {/* Top Stat Cards */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-slate-200/80 shadow-2xs">
          <CardHeader className="pb-1.5 pt-4">
            <CardDescription className="text-xs font-bold text-slate-500 uppercase">
              Statewide Outlay
            </CardDescription>
            <CardTitle className="text-2xl font-black text-slate-900">
              ₹{data ? data.state_total_sanctioned_cr.toLocaleString() : "—"} Cr
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4 text-xs text-slate-600">
            Total capital sanctioned across all districts
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-2xs">
          <CardHeader className="pb-1.5 pt-4">
            <CardDescription className="text-xs font-bold text-slate-500 uppercase">
              Actual Expenditure
            </CardDescription>
            <CardTitle className="text-2xl font-black text-blue-600">
              ₹{data ? data.state_total_expenditure_cr.toLocaleString() : "—"} Cr
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4 text-xs text-slate-600">
            Utilized against physical delivery milestones
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-2xs">
          <CardHeader className="pb-1.5 pt-4">
            <CardDescription className="text-xs font-bold text-slate-500 uppercase">
              Total Unspent District Balance
            </CardDescription>
            <CardTitle className="text-2xl font-black text-amber-700">
              ₹{data ? data.state_total_unspent_cr.toLocaleString() : "—"} Cr
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4 text-xs text-slate-600">
            Pool available for inter-district reallocation
          </CardContent>
        </Card>
      </div>

      {/* District Treasury Ledger Table */}
      <Card className="border-slate-200 shadow-2xs overflow-hidden">
        <CardHeader className="bg-slate-50/70 border-b border-slate-200 pb-3">
          <CardTitle className="text-sm font-bold text-slate-900">
            District Treasury Nodal Accounts
          </CardTitle>
          <CardDescription className="text-xs text-slate-500">
            Current absorption velocity and reallocation eligibility per district
          </CardDescription>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/40 font-bold text-slate-700 uppercase tracking-wider">
                <th className="px-4 py-3">District</th>
                <th className="px-4 py-3 text-right">Sanctioned (₹ Cr)</th>
                <th className="px-4 py-3 text-right">Expenditure (₹ Cr)</th>
                <th className="px-4 py-3 text-right">Unspent Balance (₹ Cr)</th>
                <th className="px-4 py-3">Absorption Velocity</th>
                <th className="px-4 py-3">Transfer Status</th>
                <th className="px-4 py-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                    Loading district treasury accounts...
                  </td>
                </tr>
              ) : districts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                    No district treasury records available.
                  </td>
                </tr>
              ) : (
                districts.map((d) => (
                  <tr key={d.district_code} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 font-semibold text-slate-900">
                      <div>{d.district_name}</div>
                      <span className="text-[10px] text-slate-400 font-mono">{d.district_code}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-900">
                      ₹{(d.sanctioned_amount / 1e7).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-900">
                      ₹{(d.expenditure_amount / 1e7).toFixed(2)}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-amber-700">
                      ₹{(d.unspent_balance / 1e7).toFixed(2)}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                          d.absorption_velocity === "high"
                            ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                            : d.absorption_velocity === "stagnant"
                            ? "bg-rose-50 text-rose-700 border border-rose-200"
                            : "bg-slate-100 text-slate-700 border border-slate-200"
                        }`}
                      >
                        {d.absorption_velocity === "high" && <TrendingUp className="h-3 w-3" />}
                        {d.absorption_velocity === "stagnant" && <TrendingDown className="h-3 w-3" />}
                        {d.absorption_velocity} velocity
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {d.eligible_for_outflow ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                          Surplus Pool (Outflow)
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                          High Need (Inflow)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs font-semibold text-amber-700 hover:bg-amber-50"
                        onClick={() => {
                          setSourceDistrict(d.district_code);
                          const other = districts.find((od) => od.district_code !== d.district_code);
                          if (other) setTargetDistrict(other.district_code);
                          setModalOpen(true);
                        }}
                      >
                        Reallocate →
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Historical Inter-District Reallocations Ledger */}
      <Card className="border-slate-200 shadow-2xs overflow-hidden">
        <CardHeader className="bg-slate-50/70 border-b border-slate-200 pb-3">
          <div className="flex items-center gap-2">
            <History className="h-4 w-4 text-slate-600" />
            <CardTitle className="text-sm font-bold text-slate-900">
              Inter-District Reallocation Dockets Ledger
            </CardTitle>
          </div>
          <CardDescription className="text-xs text-slate-500">
            Immutable log of state-approved fund transfers under Rule 7.2
          </CardDescription>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/40 font-bold text-slate-700 uppercase tracking-wider">
                <th className="px-4 py-3">Docket Reference</th>
                <th className="px-4 py-3">Source District (Outflow)</th>
                <th className="px-4 py-3">Destination District (Inflow)</th>
                <th className="px-4 py-3 text-right">Amount (₹ Cr)</th>
                <th className="px-4 py-3">Statutory Justification</th>
                <th className="px-4 py-3">Authorized By</th>
                <th className="px-4 py-3 text-right">Date</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {history.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No fund reallocations recorded yet.
                  </td>
                </tr>
              ) : (
                history.map((h) => (
                  <tr key={h.reallocation_id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 font-mono font-bold text-slate-900">
                      {h.docket_reference}
                    </td>
                    <td className="px-4 py-3 font-semibold text-rose-700">
                      {h.source_district_name}
                    </td>
                    <td className="px-4 py-3 font-semibold text-emerald-700">
                      {h.target_district_name}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-slate-950">
                      ₹{(h.reallocated_amount / 1e7).toFixed(2)} Cr
                    </td>
                    <td className="px-4 py-3 text-slate-600 max-w-[240px] truncate" title={h.justification}>
                      {h.justification}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{h.authorized_by}</td>
                    <td className="px-4 py-3 text-right text-slate-500 font-mono">
                      {new Date(h.reallocated_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Reallocation Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-xs p-4 animate-in fade-in-50">
          <div className="relative w-full max-w-lg rounded-2xl bg-white border border-slate-200 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-amber-50 text-amber-600">
                  <ArrowLeftRight className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-slate-900">Authorize Inter-District Reallocation</h3>
                  <p className="text-xs text-slate-500">Official State Treasury Transfer Docket</p>
                </div>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleReallocate} className="space-y-4 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">Source District (Outflow)</label>
                  <select
                    value={sourceDistrict}
                    onChange={(e) => setSourceDistrict(e.target.value)}
                    className="w-full h-9 rounded-lg border border-slate-200 px-3 bg-white text-xs font-medium text-slate-900 focus:outline-blue-600"
                    required
                  >
                    {districts.map((d) => (
                      <option key={d.district_code} value={d.district_code}>
                        {d.district_name} (₹{(d.unspent_balance / 1e7).toFixed(2)} Cr unspent)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">Destination District (Inflow)</label>
                  <select
                    value={targetDistrict}
                    onChange={(e) => setTargetDistrict(e.target.value)}
                    className="w-full h-9 rounded-lg border border-slate-200 px-3 bg-white text-xs font-medium text-slate-900 focus:outline-blue-600"
                    required
                  >
                    {districts.map((d) => (
                      <option key={d.district_code} value={d.district_code}>
                        {d.district_name} ({d.absorption_velocity} velocity)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Reallocation Amount (₹ Crores)
                </label>
                <Input
                  type="number"
                  step="0.25"
                  min="0.25"
                  max="50"
                  value={reallocAmountCr}
                  onChange={(e) => setReallocAmountCr(Number(e.target.value))}
                  className="h-9 text-xs font-bold text-slate-900"
                  required
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 mb-1">
                  Statutory Justification & Docket Notes
                </label>
                <textarea
                  rows={3}
                  placeholder="Enter policy justification for cross-district reallocation..."
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  className="w-full rounded-lg border border-slate-200 p-2.5 bg-white text-xs text-slate-900 focus:outline-blue-600"
                  required
                />
              </div>

              {errorResult && (
                <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-rose-800 font-semibold flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-rose-600 shrink-0" />
                  <span>{errorResult}</span>
                </div>
              )}

              {successResult ? (
                <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-emerald-800 font-semibold flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                  <span>{successResult}</span>
                </div>
              ) : (
                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setModalOpen(false);
                      setErrorResult(null);
                      setSuccessResult(null);
                    }}
                    disabled={submitting}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    size="sm"
                    className="bg-amber-600 hover:bg-amber-500 text-white font-bold"
                    disabled={submitting}
                  >
                    {submitting ? "Authorizing Reallocation..." : "Authorize Reallocation"}
                  </Button>
                </div>
              )}
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
