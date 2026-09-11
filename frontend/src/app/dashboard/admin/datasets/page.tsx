"use client";

import React, { useState } from "react";
import { useAuthenticatedQuery } from "@/lib/query";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState, ErrorState, EmptyState } from "@/components/ui/states";
import { AdminNavTabs } from "@/components/admin/admin-nav-tabs";
import { formatDate } from "@/lib/api";
import { Database, FileSpreadsheet, MapPin, Users } from "lucide-react";

type ImportBatch = {
  batch_id: string; filename: string; file_type: string; status: string;
  total_rows: number; valid_rows: number; invalid_rows: number;
  imported_rows: number; skipped_duplicate_rows: number;
  created_at: string; updated_at: string;
};

type CollectionStats = {
  states: number; constituencies: number; mps: number;
  mp_allocations: number; import_batches: number;
};

type Allocation = {
  mp_name: string; state_name: string; constituency_name: string | null;
  house: string; allocated_amount: number | null; allocated_amount_raw: string;
  source_sr_no: string;
};

const statusColors: Record<string, "success" | "warning" | "danger" | "info" | "secondary"> = {
  completed: "success", validated: "info", uploaded: "secondary",
  importing: "info", failed: "danger", partially_completed: "warning",
};

export default function DatasetsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<"batches" | "allocations" | "mps">("batches");
  const [allocPage, setAllocPage] = useState(1);
  const [allocSearch, setAllocSearch] = useState("");
  const [houseFilter, setHouseFilter] = useState("");

  const stats = useAuthenticatedQuery<CollectionStats>(["ingestion-stats"], "/api/v1/ingestion/stats");
  const batches = useAuthenticatedQuery<{ batches: ImportBatch[]; total: number }>(["ingestion-batches"], "/api/v1/ingestion/batches");

  const allocParams = new URLSearchParams({ page: String(allocPage), page_size: "25" });
  if (allocSearch) allocParams.set("search", allocSearch);
  if (houseFilter) allocParams.set("house", houseFilter);
  const allocations = useAuthenticatedQuery<{ allocations: Allocation[]; total: number; page: number; page_size: number }>(
    ["ingestion-allocations", allocPage, allocSearch, houseFilter],
    `/api/v1/ingestion/allocations?${allocParams.toString()}`,
    { enabled: tab === "allocations" }
  );

  const mps = useAuthenticatedQuery<{ mps: Record<string, unknown>[]; total: number }>(
    ["ingestion-mps"], "/api/v1/ingestion/mps?page=1&page_size=100",
    { enabled: tab === "mps" }
  );

  if (user?.role !== "admin") return <ErrorState title="Access denied" description="Admin access required." />;

  const formatAmount = (amount: number | null) => {
    if (amount === null || amount === undefined) return "—";
    return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
  };

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="Administration" title="Dataset imports" description="View imported datasets, import history, and collection statistics." />

      {/* Admin Navigation Tabs */}
      <AdminNavTabs />

      {/* Stats Cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Database} label="Import batches" value={stats.data?.import_batches} />
        <StatCard icon={Users} label="MPs imported" value={stats.data?.mps} />
        <StatCard icon={FileSpreadsheet} label="Allocation records" value={stats.data?.mp_allocations} />
        <StatCard icon={MapPin} label="Constituencies" value={stats.data?.constituencies} />
      </section>

      {/* Tab Selector */}
      <div className="flex gap-1 border-b border-slate-200 mb-6">
        {(["batches", "allocations", "mps"] as const).map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${tab === t ? "border-sky-600 text-sky-700" : "border-transparent text-slate-500 hover:text-slate-700"}`}>
            {t === "batches" ? "Import history" : t === "allocations" ? "Allocation records" : "MP directory"}
          </button>
        ))}
      </div>

      {/* Import History Tab */}
      {tab === "batches" && (
        <Card>
          <CardHeader><CardTitle>Import batch history</CardTitle><CardDescription>All CSV import operations, most recent first.</CardDescription></CardHeader>
          <CardContent className="p-0">
            {batches.isLoading ? <div className="p-8"><LoadingState label="Loading batches…" /></div>
              : batches.error ? <div className="p-8"><ErrorState description="Failed to load batches." onRetry={() => void batches.refetch()} /></div>
              : !batches.data?.batches?.length ? <div className="p-8"><EmptyState title="No imports yet" description="Use the CSV ingestion workflow or run the seed_data script to import datasets." /></div>
              : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-6 py-3">Filename</th>
                        <th className="px-6 py-3">Type</th>
                        <th className="px-6 py-3">Status</th>
                        <th className="px-6 py-3 text-right">Total</th>
                        <th className="px-6 py-3 text-right">Valid</th>
                        <th className="px-6 py-3 text-right">Invalid</th>
                        <th className="px-6 py-3 text-right">Imported</th>
                        <th className="px-6 py-3 text-right">Duplicates</th>
                        <th className="px-6 py-3">Date</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {batches.data.batches.map((b) => (
                        <tr key={b.batch_id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-4 font-medium text-slate-900">{b.filename}</td>
                          <td className="px-6 py-4"><Badge variant="secondary">{b.file_type.replace(/_/g, " ")}</Badge></td>
                          <td className="px-6 py-4"><Badge variant={statusColors[b.status] || "secondary"}>{b.status}</Badge></td>
                          <td className="px-6 py-4 text-right tabular-nums">{b.total_rows}</td>
                          <td className="px-6 py-4 text-right tabular-nums text-emerald-700">{b.valid_rows}</td>
                          <td className="px-6 py-4 text-right tabular-nums text-red-700">{b.invalid_rows}</td>
                          <td className="px-6 py-4 text-right tabular-nums text-blue-700">{b.imported_rows}</td>
                          <td className="px-6 py-4 text-right tabular-nums text-slate-500">{b.skipped_duplicate_rows}</td>
                          <td className="px-6 py-4 text-xs text-slate-500 whitespace-nowrap">{formatDate(b.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </CardContent>
        </Card>
      )}

      {/* Allocations Tab */}
      {tab === "allocations" && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><CardTitle>MP allocation records</CardTitle><CardDescription>Imported from MPLADS allocation CSVs.</CardDescription></div>
              <div className="flex gap-3">
                <Input placeholder="Search MP or state…" value={allocSearch} onChange={(e) => { setAllocSearch(e.target.value); setAllocPage(1); }} className="max-w-xs" />
                <select className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm" value={houseFilter} onChange={(e) => { setHouseFilter(e.target.value); setAllocPage(1); }}>
                  <option value="">All houses</option>
                  <option value="lok_sabha">Lok Sabha</option>
                  <option value="rajya_sabha">Rajya Sabha</option>
                </select>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {allocations.isLoading ? <div className="p-8"><LoadingState label="Loading allocations…" /></div>
              : allocations.error ? <div className="p-8"><ErrorState description="Failed to load." onRetry={() => void allocations.refetch()} /></div>
              : !allocations.data?.allocations?.length ? <div className="p-8"><EmptyState title="No allocations" description="Import a CSV dataset to populate this view." /></div>
              : (
                <>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm text-left">
                      <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-500">
                        <tr>
                          <th className="px-6 py-3">Sr.</th>
                          <th className="px-6 py-3">MP name</th>
                          <th className="px-6 py-3">State</th>
                          <th className="px-6 py-3">Constituency</th>
                          <th className="px-6 py-3">House</th>
                          <th className="px-6 py-3 text-right">Allocated amount</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {allocations.data.allocations.map((a, i) => (
                          <tr key={`${a.mp_name}-${a.state_name}-${i}`} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-3 text-slate-500 tabular-nums">{a.source_sr_no}</td>
                            <td className="px-6 py-3 font-medium text-slate-900">{a.mp_name}</td>
                            <td className="px-6 py-3 text-slate-700">{a.state_name}</td>
                            <td className="px-6 py-3 text-slate-500">{a.constituency_name || "—"}</td>
                            <td className="px-6 py-3"><Badge variant="secondary">{a.house.replace(/_/g, " ")}</Badge></td>
                            <td className="px-6 py-3 text-right tabular-nums font-medium">{formatAmount(a.allocated_amount)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center justify-between border-t border-slate-100 px-6 py-3">
                    <p className="text-xs text-slate-500">Showing {allocations.data.allocations.length} of {allocations.data.total} records</p>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" disabled={allocPage <= 1} onClick={() => setAllocPage((p) => p - 1)}>Previous</Button>
                      <Button variant="outline" size="sm" disabled={allocPage * 25 >= allocations.data.total} onClick={() => setAllocPage((p) => p + 1)}>Next</Button>
                    </div>
                  </div>
                </>
              )}
          </CardContent>
        </Card>
      )}

      {/* MP Directory Tab */}
      {tab === "mps" && (
        <Card>
          <CardHeader><CardTitle>MP directory</CardTitle><CardDescription>Imported and normalized MP reference records.</CardDescription></CardHeader>
          <CardContent className="p-0">
            {mps.isLoading ? <div className="p-8"><LoadingState label="Loading MPs…" /></div>
              : mps.error ? <div className="p-8"><ErrorState description="Failed." onRetry={() => void mps.refetch()} /></div>
              : !mps.data?.mps?.length ? <div className="p-8"><EmptyState title="No MPs imported" description="Import a CSV dataset to populate this view." /></div>
              : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-500">
                      <tr>
                        <th className="px-6 py-3">Name</th>
                        <th className="px-6 py-3">State</th>
                        <th className="px-6 py-3">Constituency</th>
                        <th className="px-6 py-3">House</th>
                        <th className="px-6 py-3">Honorific</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {mps.data.mps.map((mp: Record<string, unknown>, i: number) => (
                        <tr key={`${mp.name}-${i}`} className="hover:bg-slate-50 transition-colors">
                          <td className="px-6 py-3 font-medium text-slate-900">{mp.name as string}</td>
                          <td className="px-6 py-3 text-slate-700">{mp.state_name as string}</td>
                          <td className="px-6 py-3 text-slate-500">{(mp.constituency_name as string) || "—"}</td>
                          <td className="px-6 py-3"><Badge variant="secondary">{((mp.house as string) || "").replace(/_/g, " ")}</Badge></td>
                          <td className="px-6 py-3 text-slate-500">{(mp.honorific as string) || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatCard({ icon: Icon, label, value }: { icon: typeof Database; label: string; value: number | undefined }) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-600">{label}</p>
            <p className="mt-2 text-2xl font-bold tracking-tight text-slate-950">{value !== undefined ? value.toLocaleString("en-IN") : "—"}</p>
          </div>
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-blue-50 text-blue-700">
            <Icon className="h-4 w-4" aria-hidden="true" />
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
