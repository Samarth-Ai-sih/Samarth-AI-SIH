"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useAuthenticatedQuery } from "@/lib/query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState, ErrorState } from "@/components/ui/states";
import { formatCurrency } from "@/lib/api";
import {
  TrendingUp,
  Search,
  Filter,
  ArrowLeft,
  RefreshCw,
  Trophy,
  AlertTriangle,
  Building2,
  ArrowUpDown,
  Download,
} from "lucide-react";

interface StateBenchmarkItem {
  state_code: string;
  state_name: string;
  total_works: number;
  sanctioned_amount: number;
  expenditure_amount: number;
  utilization_rate_pct: number;
  stagnant_works_count: number;
  delay_rate_pct: number;
  efficiency_score: number;
  rank: number;
  status_tier: "leading" | "satisfactory" | "lagging";
}

interface BenchmarkingResponse {
  states: StateBenchmarkItem[];
  national_avg_utilization: number;
  national_avg_delay_rate: number;
  total_states_benchmarked: number;
}

export default function InterStateBenchmarkingPage() {
  const { user } = useAuth();
  const canAccess = user?.role === "mospi" || user?.role === "admin";

  const [search, setSearch] = useState("");
  const [tierFilter, setTierFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"rank" | "utilization" | "sanctioned" | "delay">("rank");

  const { data, isLoading, isError, error, refetch } = useAuthenticatedQuery<BenchmarkingResponse>(
    ["mospi-benchmarking"],
    "/api/v1/mospi/benchmarking",
    { enabled: canAccess }
  );

  const filteredStates = useMemo(() => {
    if (!data?.states) return [];
    return data.states
      .filter((s) => {
        const matchesSearch = s.state_name.toLowerCase().includes(search.toLowerCase()) || s.state_code.toLowerCase().includes(search.toLowerCase());
        const matchesTier = tierFilter === "all" || s.status_tier === tierFilter;
        return matchesSearch && matchesTier;
      })
      .sort((a, b) => {
        if (sortBy === "rank") return a.rank - b.rank;
        if (sortBy === "utilization") return b.utilization_rate_pct - a.utilization_rate_pct;
        if (sortBy === "sanctioned") return b.sanctioned_amount - a.sanctioned_amount;
        if (sortBy === "delay") return b.delay_rate_pct - a.delay_rate_pct;
        return 0;
      });
  }, [data, search, tierFilter, sortBy]);

  if (!canAccess) {
    return (
      <ErrorState
        title="Restricted Access"
        description="State Benchmarking is restricted to MoSPI Central Ministry and Administrators."
      />
    );
  }

  if (isLoading) return <LoadingState label="Computing inter-state performance benchmarks across 22 states…" />;
  if (isError) return <ErrorState description={(error as Error).message} onRetry={() => void refetch()} />;

  const b = data!;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Link href="/dashboard/mospi" className="hover:text-blue-600 flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> MoSPI Command Center
        </Link>
        <span>/</span>
        <span className="text-slate-900 font-medium">Inter-State Benchmarking</span>
      </div>

      <PageHeader
        eyebrow="Comparative State Governance Analytics"
        title="Inter-State Performance Benchmarking Leaderboard"
        description="Evaluates all 22 States across expenditure velocity, timely milestone completion, and stagnant district bank accounts to determine the national efficiency ranking."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5 text-slate-600" />
              Recalculate Rankings
            </Button>
            <Button size="sm" asChild>
              <Link href="/dashboard/mospi/quotas">
                Check SC/ST Quotas
              </Link>
            </Button>
          </div>
        }
      />

      {/* Summary Stat Strip */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Total States Benchmarked</p>
          <p className="text-2xl font-black text-slate-900 mt-1">{b.total_states_benchmarked} States</p>
          <p className="text-xs text-slate-500 mt-1">Real-time telemetry across all operational regions</p>
        </Card>

        <Card className="border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">National Average Utilization</p>
          <p className="text-2xl font-black text-emerald-700 mt-1">{b.national_avg_utilization}%</p>
          <p className="text-xs text-emerald-600 mt-1">Expenditure against sanctioned allocations</p>
        </Card>

        <Card className="border-slate-200 bg-white p-4 shadow-xs">
          <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">National Average Delay Rate</p>
          <p className="text-2xl font-black text-amber-700 mt-1">{b.national_avg_delay_rate}%</p>
          <p className="text-xs text-amber-700 mt-1">Projects exceeding planned milestones</p>
        </Card>
      </div>

      {/* Search & Filter Controls */}
      <Card className="border-slate-200">
        <CardContent className="p-4 flex flex-col sm:flex-row gap-3 items-center justify-between">
          <div className="relative w-full sm:w-80">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <Input
              placeholder="Search by state name or code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9 text-xs"
            />
          </div>

          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-1 text-xs font-medium">
              {(["all", "leading", "satisfactory", "lagging"] as const).map((tier) => (
                <button
                  key={tier}
                  onClick={() => setTierFilter(tier)}
                  className={`px-3 py-1 rounded-md capitalize transition-all ${
                    tierFilter === tier
                      ? "bg-white text-slate-900 font-bold shadow-2xs"
                      : "text-slate-600 hover:text-slate-900"
                  }`}
                >
                  {tier}
                </button>
              ))}
            </div>

            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-700 font-medium"
            >
              <option value="rank">Sort: Efficiency Rank</option>
              <option value="utilization">Sort: Utilization %</option>
              <option value="sanctioned">Sort: Sanctioned Budget</option>
              <option value="delay">Sort: Delay Rate</option>
            </select>
          </div>
        </CardContent>
      </Card>

      {/* States Leaderboard Table */}
      <Card className="border-slate-200 shadow-xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-4 py-3.5 w-16">Rank</th>
                <th className="px-4 py-3.5">State Jurisdiction</th>
                <th className="px-4 py-3.5 text-right">Monitored Works</th>
                <th className="px-4 py-3.5 text-right">Sanctioned Outlay</th>
                <th className="px-4 py-3.5 text-right">Expenditure</th>
                <th className="px-4 py-3.5 text-center">Utilization</th>
                <th className="px-4 py-3.5 text-center">Delay Rate</th>
                <th className="px-4 py-3.5 text-center">Stagnant Accounts</th>
                <th className="px-4 py-3.5 text-right">Efficiency Index</th>
                <th className="px-4 py-3.5 text-center">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filteredStates.map((state) => (
                <tr key={state.state_code} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-4 py-3.5 font-bold text-slate-900">
                    <span className={`grid h-6 w-6 place-items-center rounded-full text-xs ${
                      state.rank === 1 ? "bg-amber-100 text-amber-800 font-black border border-amber-300" :
                      state.rank <= 3 ? "bg-blue-100 text-blue-800 font-bold border border-blue-200" :
                      "bg-slate-100 text-slate-600"
                    }`}>
                      {state.rank}
                    </span>
                  </td>
                  <td className="px-4 py-3.5 font-semibold text-slate-900">
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-slate-400" />
                      <div>
                        <span>{state.state_name}</span>
                        <span className="text-[10px] text-slate-400 ml-1.5 font-mono">({state.state_code})</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-right font-medium text-slate-800">
                    {state.total_works.toLocaleString("en-IN")}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono font-medium text-slate-800">
                    {formatCurrency(state.sanctioned_amount)}
                  </td>
                  <td className="px-4 py-3.5 text-right font-mono font-medium text-emerald-700">
                    {formatCurrency(state.expenditure_amount)}
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <div className="flex items-center justify-center gap-1.5">
                      <span className="font-bold text-slate-900">{state.utilization_rate_pct}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <span className={`font-semibold ${state.delay_rate_pct > 25 ? "text-rose-600" : "text-slate-700"}`}>
                      {state.delay_rate_pct}%
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                      state.stagnant_works_count > 5 ? "bg-rose-50 text-rose-800 border border-rose-200" : "bg-slate-50 text-slate-600"
                    }`}>
                      {state.stagnant_works_count} works
                    </span>
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    <span className="text-sm font-black text-slate-900">{state.efficiency_score}</span>
                    <span className="text-[10px] text-slate-400">/100</span>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <Badge
                      variant={
                        state.status_tier === "leading" ? "success" :
                        state.status_tier === "satisfactory" ? "warning" : "danger"
                      }
                      className="capitalize text-[11px]"
                    >
                      {state.status_tier}
                    </Badge>
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
