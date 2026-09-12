"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useAuthenticatedQuery } from "@/lib/query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Flame,
  Search,
  Filter,
  ArrowRight,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  Building2,
  Landmark,
  ShieldAlert,
  ArrowUpDown,
  FileWarning,
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
  completed_works_count: number;
  active_works_count: number;
  average_risk_score: number;
  risk_tier: "critical" | "high" | "moderate" | "low";
  status_tier: "leading" | "satisfactory" | "lagging";
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

export default function StatewideRiskHeatmapPage() {
  const { user } = useAuth();
  const stateCode = user?.jurisdiction?.state_code || "UP";

  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [viewMode, setViewMode] = useState<"table" | "grid">("table");

  const { data, isLoading } = useAuthenticatedQuery<HeatmapResponse>(
    ["sno-heatmap", stateCode],
    `/api/v1/sno/heatmap?state_code=${stateCode}`,
    { staleTime: 30_000 }
  );

  const districts = data?.districts || [];

  const filteredDistricts = districts.filter((d) => {
    const matchesSearch =
      d.district_name.toLowerCase().includes(search.toLowerCase()) ||
      d.district_code.toLowerCase().includes(search.toLowerCase());
    const matchesTier = tierFilter === "all" || d.status_tier === tierFilter;
    return matchesSearch && matchesTier;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 pb-5">
        <div>
          <div className="flex items-center gap-2">
            <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-xs">
              State Scope · {data?.state_name || stateCode}
            </Badge>
            <span className="text-xs text-slate-500 font-medium">· District Risk Matrix</span>
          </div>
          <h1 className="text-2xl font-black text-slate-950 mt-1 flex items-center gap-2">
            <Flame className="h-6 w-6 text-blue-600" />
            Statewide Risk Heatmap & District Matrix
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 max-w-2xl mt-0.5">
            District-by-district performance tracking, identifying lagging district authorities, high delay velocities, and unspent treasury bottlenecks.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/dashboard/sno/escalations">
            <Button size="sm" variant="outline" className="text-xs font-semibold">
              Bottleneck Notices →
            </Button>
          </Link>
          <Link href="/dashboard/sno/allocations">
            <Button size="sm" className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold">
              Reallocate Funds →
            </Button>
          </Link>
        </div>
      </div>

      {/* Top Stat Ribbon */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-slate-200/80 shadow-2xs">
          <CardHeader className="pb-1.5 pt-4">
            <CardDescription className="text-xs font-bold text-slate-500 uppercase">
              Total State Outlay
            </CardDescription>
            <CardTitle className="text-xl font-black text-slate-900">
              ₹{data ? data.total_sanctioned_cr.toLocaleString() : "—"} Cr
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4 text-xs text-slate-600">
            Across {data?.total_works || 0} sanctioned public works
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-2xs">
          <CardHeader className="pb-1.5 pt-4">
            <CardDescription className="text-xs font-bold text-slate-500 uppercase">
              State Utilization
            </CardDescription>
            <CardTitle className="text-xl font-black text-blue-600">
              {data ? `${data.state_utilization_rate_pct}%` : "—"}
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4 text-xs text-slate-600">
            Expenditure: ₹{data ? data.total_expenditure_cr.toLocaleString() : "—"} Cr
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-2xs">
          <CardHeader className="pb-1.5 pt-4">
            <CardDescription className="text-xs font-bold text-slate-500 uppercase">
              Unspent In District Treasuries
            </CardDescription>
            <CardTitle className="text-xl font-black text-amber-600">
              ₹{data ? data.total_unspent_cr.toLocaleString() : "—"} Cr
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4 text-xs text-slate-600">
            Available for inter-district reallocation
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-2xs">
          <CardHeader className="pb-1.5 pt-4">
            <CardDescription className="text-xs font-bold text-slate-500 uppercase">
              Lagging Districts
            </CardDescription>
            <CardTitle className="text-xl font-black text-rose-600">
              {data ? data.lagging_districts_count : "—"} Districts
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4 text-xs text-slate-600">
            Requires immediate executive review
          </CardContent>
        </Card>
      </div>

      {/* Filter and View Mode Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search district name or code..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-xs"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto">
          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
            {["all", "lagging", "satisfactory", "leading"].map((tier) => (
              <button
                key={tier}
                onClick={() => setTierFilter(tier)}
                className={`px-3 py-1 rounded-md font-semibold capitalize transition-colors cursor-pointer ${
                  tierFilter === tier
                    ? "bg-white text-slate-900 shadow-xs"
                    : "text-slate-600 hover:text-slate-900"
                }`}
              >
                {tier}
              </button>
            ))}
          </div>

          <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
            <button
              onClick={() => setViewMode("table")}
              className={`px-3 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                viewMode === "table"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Table View
            </button>
            <button
              onClick={() => setViewMode("grid")}
              className={`px-3 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                viewMode === "grid"
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              Heatmap Cards
            </button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {viewMode === "table" ? (
        <Card className="border-slate-200 shadow-2xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/80 font-bold text-slate-700 uppercase tracking-wider">
                  <th className="px-4 py-3">District</th>
                  <th className="px-4 py-3">Total Works</th>
                  <th className="px-4 py-3 text-right">Sanctioned (₹ Cr)</th>
                  <th className="px-4 py-3 text-right">Expenditure (₹ Cr)</th>
                  <th className="px-4 py-3 text-right">Unspent (₹ Cr)</th>
                  <th className="px-4 py-3">Utilization Rate</th>
                  <th className="px-4 py-3 text-center">Delayed</th>
                  <th className="px-4 py-3 text-center">Composite Risk</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {isLoading ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center text-slate-500">
                      Loading statewide district performance telemetry...
                    </td>
                  </tr>
                ) : filteredDistricts.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-12 text-center text-slate-500">
                      No districts matched the filter criteria.
                    </td>
                  </tr>
                ) : (
                  filteredDistricts.map((d) => (
                    <tr key={d.district_code} className="hover:bg-slate-50/60 transition-colors">
                      <td className="px-4 py-3 font-semibold text-slate-900">
                        <div>{d.district_name}</div>
                        <span className="text-[10px] text-slate-400 font-mono">{d.district_code}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-700 font-medium">
                        {d.total_works} works
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-900">
                        ₹{(d.sanctioned_amount / 10000000).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-slate-900">
                        ₹{(d.expenditure_amount / 10000000).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-amber-700">
                        ₹{(d.unspent_balance / 10000000).toFixed(2)}
                      </td>
                      <td className="px-4 py-3 min-w-[140px]">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-800 w-10 text-right">
                            {d.utilization_rate_pct}%
                          </span>
                          <div className="flex-1 bg-slate-100 rounded-full h-1.5 overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                d.utilization_rate_pct >= 70
                                  ? "bg-emerald-500"
                                  : d.utilization_rate_pct >= 45
                                  ? "bg-blue-500"
                                  : "bg-rose-500"
                              }`}
                              style={{ width: `${Math.min(100, d.utilization_rate_pct)}%` }}
                            />
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {d.delayed_works_count > 0 ? (
                          <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 text-[11px] font-bold">
                            {d.delayed_works_count} delayed
                          </Badge>
                        ) : (
                          <span className="text-slate-400 font-mono">0</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold ${
                            d.average_risk_score >= 60
                              ? "bg-rose-100 text-rose-800"
                              : d.average_risk_score >= 40
                              ? "bg-amber-100 text-amber-800"
                              : "bg-emerald-100 text-emerald-800"
                          }`}
                        >
                          {d.average_risk_score}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide ${
                            d.status_tier === "leading"
                              ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
                              : d.status_tier === "lagging"
                              ? "bg-rose-50 text-rose-700 border border-rose-200"
                              : "bg-slate-100 text-slate-700 border border-slate-200"
                          }`}
                        >
                          {d.status_tier}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link href={`/dashboard/sno/escalations?district=${d.district_code}`}>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-xs font-bold text-blue-600 hover:text-blue-700">
                            Examine →
                          </Button>
                        </Link>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        /* Heatmap Grid View */
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredDistricts.map((d) => (
            <Card
              key={d.district_code}
              className={`border transition-all shadow-2xs hover:shadow-md ${
                d.status_tier === "lagging"
                  ? "border-rose-200 bg-gradient-to-br from-white to-rose-50/20"
                  : d.status_tier === "leading"
                  ? "border-emerald-200 bg-gradient-to-br from-white to-emerald-50/20"
                  : "border-slate-200"
              }`}
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-base font-bold text-slate-950">{d.district_name}</CardTitle>
                    <CardDescription className="text-xs font-mono text-slate-500">{d.district_code}</CardDescription>
                  </div>
                  <Badge
                    variant="outline"
                    className={`text-[10px] font-bold uppercase ${
                      d.status_tier === "leading"
                        ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                        : d.status_tier === "lagging"
                        ? "bg-rose-50 text-rose-700 border-rose-200"
                        : "bg-slate-100 text-slate-700 border-slate-200"
                    }`}
                  >
                    {d.status_tier}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div>
                  <div className="flex justify-between text-xs text-slate-600 mb-1">
                    <span>Fund Absorption</span>
                    <strong className="text-slate-900">{d.utilization_rate_pct}%</strong>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        d.utilization_rate_pct >= 70
                          ? "bg-emerald-500"
                          : d.utilization_rate_pct >= 45
                          ? "bg-blue-500"
                          : "bg-rose-500"
                      }`}
                      style={{ width: `${Math.min(100, d.utilization_rate_pct)}%` }}
                    />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-xs">
                  <div>
                    <span className="text-[11px] text-slate-400 block">Sanctioned</span>
                    <strong className="text-slate-900">₹{(d.sanctioned_amount / 1e7).toFixed(2)} Cr</strong>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 block">Unspent Balance</span>
                    <strong className="text-amber-700">₹{(d.unspent_balance / 1e7).toFixed(2)} Cr</strong>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 block">Delayed Works</span>
                    <strong className={d.delayed_works_count > 0 ? "text-rose-600" : "text-slate-600"}>
                      {d.delayed_works_count}
                    </strong>
                  </div>
                  <div>
                    <span className="text-[11px] text-slate-400 block">Composite Risk</span>
                    <strong className="text-slate-900">{d.average_risk_score}</strong>
                  </div>
                </div>

                <div className="pt-2 flex justify-end">
                  <Link href={`/dashboard/sno/escalations?district=${d.district_code}`}>
                    <Button size="sm" variant="outline" className="text-xs h-8 font-semibold text-blue-600">
                      Examine Bottlenecks →
                    </Button>
                  </Link>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
