"use client";

import { useState } from "react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { EmptyState, ErrorState, LoadingState } from "@/components/ui/states";
import { useAuth } from "@/lib/auth";
import { useAuthenticatedQuery } from "@/lib/query";
import {
  WorkListResponse,
  WorkSummary,
  formatCurrency,
  formatDate,
} from "@/lib/api";
import {
  Building2,
  BriefcaseBusiness,
  CheckCircle2,
  Clock,
  ArrowRight,
  TrendingUp,
  FileCheck2,
  Camera,
  Layers,
  WalletCards,
  Search,
  AlertTriangle,
  FileText,
  Plus,
} from "lucide-react";

export default function AgencyWorkspacePage() {
  const { user } = useAuth();
  const [activeFilter, setActiveFilter] = useState<"all" | "in_progress" | "pending_update" | "completed">("all");
  const [searchQuery, setSearchQuery] = useState("");

  // Modals state
  const [selectedWork, setSelectedWork] = useState<WorkSummary | null>(null);
  const [isProgressModalOpen, setIsProgressModalOpen] = useState(false);
  const [isInspectionModalOpen, setIsInspectionModalOpen] = useState(false);

  // Form states for Progress Update
  const [progressPct, setProgressPct] = useState<string>("50");
  const [progressDesc, setProgressDesc] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [actionSuccessMsg, setActionSuccessMsg] = useState<string | null>(null);

  // Form states for Inspection Dispatch
  const [inspectionStage, setInspectionStage] = useState("intermediate_progress");
  const [inspectionInstructions, setInspectionInstructions] = useState("Verify physical civil progress on site against submitted measurement book.");
  const [inspectionPriority, setInspectionPriority] = useState<"routine" | "urgent">("routine");

  const worksQuery = useAuthenticatedQuery<WorkListResponse>(
    ["agency", "works", activeFilter],
    "/api/v1/works?page=1&page_size=100&sort_by=updated_at&sort_order=desc"
  );

  const handleRecordProgress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWork) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/v1/works/${selectedWork.work_id}/progress`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("samarth_access_token")}`,
        },
        body: JSON.stringify({
          physical_progress_pct: parseFloat(progressPct) || 0,
          description: progressDesc || `Civil works progress recorded at ${progressPct}% by ${user?.full_name || "Implementing Agency"}.`,
          date: new Date().toISOString(),
          attachments: [],
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Progress update failed" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }

      setIsProgressModalOpen(false);
      setActionSuccessMsg(`Physical progress updated to ${progressPct}% for ${selectedWork.title}.`);
      void worksQuery.refetch();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to record progress.");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDispatchInspection = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedWork) return;
    setIsSubmitting(true);
    try {
      const res = await fetch(`/api/v1/works/${selectedWork.work_id}/dispatch-inspection`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("samarth_access_token")}`,
        },
        body: JSON.stringify({
          milestone_stage: inspectionStage,
          instructions: inspectionInstructions,
          priority: inspectionPriority,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Inspection dispatch failed" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }

      const data = await res.json();
      setIsInspectionModalOpen(false);
      setActionSuccessMsg(`Field inspection dispatched to ${data.inspector_name || "Technical Inspector"} (Case Ref: ${data.case_id}).`);
      void worksQuery.refetch();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to dispatch inspection.");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (worksQuery.isLoading) return <LoadingState label="Loading Implementing Agency workspace…" />;
  if (worksQuery.isError) return <ErrorState description={(worksQuery.error as Error).message} onRetry={() => void worksQuery.refetch()} />;

  const allWorks = worksQuery.data?.works || [];

  // Filter works
  const filteredWorks = allWorks.filter((w) => {
    const matchesSearch =
      !searchQuery ||
      w.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      w.work_id.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (w.implementing_agency && w.implementing_agency.toLowerCase().includes(searchQuery.toLowerCase())) ||
      (w.mp_name && w.mp_name.toLowerCase().includes(searchQuery.toLowerCase()));

    if (!matchesSearch) return false;

    if (activeFilter === "in_progress") {
      return w.status === "in_progress" || w.status === "sanctioned";
    }
    if (activeFilter === "pending_update") {
      return w.physical_progress_pct < 100 && w.status !== "completed";
    }
    if (activeFilter === "completed") {
      return w.status === "completed";
    }
    return true;
  });

  // Calculate Metrics
  const totalSanctioned = allWorks.reduce((acc, w) => acc + (w.sanctioned_amount || 0), 0);
  const totalDisbursed = allWorks.reduce((acc, w) => acc + (w.funds_released || 0), 0);
  const activeCount = allWorks.filter((w) => w.status === "in_progress" || w.status === "sanctioned").length;
  const avgProgress = allWorks.length
    ? Math.round(allWorks.reduce((acc, w) => acc + (w.physical_progress_pct || 0), 0) / allWorks.length)
    : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Executing Line Agency Workspace"
        title="Civil Works Execution & Measurement Register"
        description="Maintain assigned public infrastructure assets, record site physical milestones, request payment tranches, and dispatch on-site technical inspections."
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/dashboard/works">
                <BriefcaseBusiness className="mr-1.5 h-4 w-4" /> Global Works Register
              </Link>
            </Button>
          </div>
        }
      />

      {/* Success Notification Banner */}
      {actionSuccessMsg && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm text-emerald-900 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
            <span>{actionSuccessMsg}</span>
          </div>
          <button
            onClick={() => setActionSuccessMsg(null)}
            className="text-emerald-700 hover:text-emerald-950 font-bold text-xs"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* ── KPI Telemetry Row ── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card className="border-slate-200 bg-white shadow-xs">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Allocated Works</p>
                <p className="mt-2 text-2xl font-bold text-slate-950">{allWorks.length}</p>
              </div>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-700">
                <Building2 className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">{activeCount} currently under active construction</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-xs">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Sanctioned Outlay</p>
                <p className="mt-2 text-2xl font-bold text-slate-950">{formatCurrency(totalSanctioned)}</p>
              </div>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                <WalletCards className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-2 text-xs text-emerald-700 font-medium">Approved by District Authorities</p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-xs">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Disbursed Funds</p>
                <p className="mt-2 text-2xl font-bold text-slate-950">{formatCurrency(totalDisbursed)}</p>
              </div>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-indigo-50 text-indigo-700">
                <Layers className="h-5 w-5" />
              </span>
            </div>
            <p className="mt-2 text-xs text-slate-500">
              {totalSanctioned > 0 ? Math.round((totalDisbursed / totalSanctioned) * 100) : 0}% draw-down realization
            </p>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-xs">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Avg Physical Progress</p>
                <p className="mt-2 text-2xl font-bold text-slate-950">{avgProgress}%</p>
              </div>
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-700">
                <TrendingUp className="h-5 w-5" />
              </span>
            </div>
            <div className="mt-2.5 w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
              <div className="bg-amber-500 h-1.5 rounded-full" style={{ width: `${avgProgress}%` }}></div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Filter Pills & Search ── */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4">
        <div className="inline-flex rounded-xl border border-slate-200 bg-slate-100/80 p-1">
          {[
            { id: "all", label: "All Works", count: allWorks.length },
            { id: "in_progress", label: "Under Construction", count: activeCount },
            { id: "pending_update", label: "Pending Measurement", count: allWorks.filter((w) => w.physical_progress_pct < 100).length },
            { id: "completed", label: "Completed", count: allWorks.filter((w) => w.status === "completed").length },
          ].map((pill) => (
            <button
              key={pill.id}
              type="button"
              onClick={() => setActiveFilter(pill.id as any)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                activeFilter === pill.id
                  ? "bg-white text-slate-950 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {pill.label} ({pill.count})
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-72">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search by title, ID, MP, agency…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2 text-xs rounded-xl border border-slate-200 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
      </div>

      {/* ── Assigned Works Table ── */}
      <Card className="border-slate-200 shadow-xs overflow-hidden">
        <CardHeader className="bg-slate-50/50 border-b border-slate-200 py-3.5 px-5">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-sm font-bold text-slate-900">
                Assigned Execution Register
              </CardTitle>
              <CardDescription className="text-xs text-slate-500">
                Showing {filteredWorks.length} infrastructure projects assigned to executing agencies.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent className="p-0">
          {filteredWorks.length === 0 ? (
            <div className="py-12 text-center">
              <Building2 className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-700">No matching works found</p>
              <p className="text-xs text-slate-500">Adjust your filter or search query.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50/80 text-slate-600 font-semibold uppercase tracking-wider text-[10px]">
                    <th className="py-3 px-4">Project Details</th>
                    <th className="py-3 px-4">Sanction & Sponsor</th>
                    <th className="py-3 px-4">Civil Agency</th>
                    <th className="py-3 px-4">Physical Progress</th>
                    <th className="py-3 px-4">Financials (₹)</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filteredWorks.map((work) => (
                    <tr key={work.work_id} className="hover:bg-slate-50/60 transition-colors">
                      <td className="py-3.5 px-4 max-w-xs">
                        <Link
                          href={`/dashboard/works/${work.work_id}`}
                          className="font-bold text-slate-950 hover:text-blue-600 line-clamp-1"
                        >
                          {work.title}
                        </Link>
                        <div className="flex items-center gap-2 mt-1 text-[11px] text-slate-500">
                          <span className="font-mono text-[10px]">{work.work_id}</span>
                          <span>·</span>
                          <span>{work.category}</span>
                          <span>·</span>
                          <span>{work.district_name || work.state_name}</span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <p className="font-semibold text-slate-900">{work.mp_name || "Hon. MP"}</p>
                        <p className="text-[11px] text-slate-500 font-mono mt-0.5">
                          {work.sanction_order_ref || "AS Pending"}
                        </p>
                      </td>

                      <td className="py-3.5 px-4">
                        <span className="inline-flex items-center gap-1 font-medium text-slate-800">
                          <Building2 className="h-3 w-3 text-slate-400" />
                          {work.implementing_agency || "Public Works Dept"}
                        </span>
                      </td>

                      <td className="py-3.5 px-4 min-w-[130px]">
                        <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700 mb-1">
                          <span>{work.physical_progress_pct}%</span>
                          <span className="text-[10px] font-normal text-slate-400">
                            {work.status.replace("_", " ")}
                          </span>
                        </div>
                        <div className="w-full bg-slate-100 rounded-full h-1.5 overflow-hidden">
                          <div
                            className={`h-1.5 rounded-full ${
                              work.physical_progress_pct >= 100
                                ? "bg-emerald-600"
                                : work.physical_progress_pct >= 50
                                ? "bg-blue-600"
                                : "bg-amber-500"
                            }`}
                            style={{ width: `${Math.min(100, work.physical_progress_pct)}%` }}
                          ></div>
                        </div>
                      </td>

                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <p className="font-bold text-slate-900">{formatCurrency(work.sanctioned_amount)}</p>
                        <p className="text-[10px] text-emerald-700 mt-0.5">
                          Disbursed: {formatCurrency(work.funds_released)}
                        </p>
                      </td>

                      <td className="py-3.5 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1.5">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedWork(work);
                              setProgressPct(String(work.physical_progress_pct || 50));
                              setProgressDesc("");
                              setIsProgressModalOpen(true);
                            }}
                            className="h-7 px-2 text-[11px] font-semibold text-blue-700 hover:bg-blue-50"
                          >
                            <TrendingUp className="mr-1 h-3 w-3" /> Update %
                          </Button>

                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setSelectedWork(work);
                              setIsInspectionModalOpen(true);
                            }}
                            className="h-7 px-2 text-[11px] font-semibold text-purple-700 hover:bg-purple-50"
                          >
                            <Camera className="mr-1 h-3 w-3" /> Inspect
                          </Button>

                          <Button size="sm" variant="ghost" asChild className="h-7 px-2 text-[11px]">
                            <Link href={`/dashboard/works/${work.work_id}`}>
                              360° <ArrowRight className="ml-1 h-3 w-3" />
                            </Link>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Modal: Record Physical Progress ── */}
      {isProgressModalOpen && selectedWork && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">Record Physical Progress Milestone</h3>
                <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">{selectedWork.title}</p>
              </div>
              <button
                onClick={() => setIsProgressModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleRecordProgress} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Physical Completion Percentage (0 - 100%)
                </label>
                <div className="flex items-center gap-3">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="5"
                    value={progressPct}
                    onChange={(e) => setProgressPct(e.target.value)}
                    className="w-full accent-blue-600"
                  />
                  <span className="w-12 text-sm font-bold text-blue-700 font-mono">{progressPct}%</span>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">
                  Measurement Book (MB) Entry / Civil Notes
                </label>
                <textarea
                  rows={3}
                  value={progressDesc}
                  onChange={(e) => setProgressDesc(e.target.value)}
                  placeholder="e.g. Sub-structure foundation completed, lintel level brickwork underway as per approved engineering drawings."
                  className="w-full rounded-xl border border-slate-300 p-2.5 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div className="rounded-xl bg-blue-50/70 border border-blue-200 p-3 text-[11px] text-blue-900">
                💡 Recording physical progress updates the live Work 360° timeline, notifies the District Authority, and enables payment tranche disbursement.
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsProgressModalOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmitting}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold"
                >
                  {isSubmitting ? "Recording…" : "Save Progress Milestone"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ── Modal: Dispatch Field Inspection ── */}
      {isInspectionModalOpen && selectedWork && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-xs p-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-xl space-y-4">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900">Dispatch Field Technical Inspection</h3>
                <p className="text-xs text-slate-500 line-clamp-1 mt-0.5">{selectedWork.title}</p>
              </div>
              <button
                onClick={() => setIsInspectionModalOpen(false)}
                className="text-slate-400 hover:text-slate-700 text-lg leading-none"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleDispatchInspection} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 mb-1">Inspection Milestone Stage</label>
                <select
                  value={inspectionStage}
                  onChange={(e) => setInspectionStage(e.target.value)}
                  className="w-full rounded-xl border border-slate-300 p-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                >
                  <option value="site_clearance">Pre-commencement Site Clearance</option>
                  <option value="intermediate_progress">Intermediate Milestone Verification</option>
                  <option value="pre_final_completion">Pre-Final Quality Inspection</option>
                  <option value="final_completion">Final Completion & Asset Handover</option>
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Priority Tier</label>
                <div className="flex items-center gap-4">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="priority"
                      value="routine"
                      checked={inspectionPriority === "routine"}
                      onChange={() => setInspectionPriority("routine")}
                      className="accent-blue-600"
                    />
                    <span>Routine Audit (7 days SLA)</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="priority"
                      value="urgent"
                      checked={inspectionPriority === "urgent"}
                      onChange={() => setInspectionPriority("urgent")}
                      className="accent-rose-600"
                    />
                    <span className="font-semibold text-rose-700">Urgent Milestone (48 hrs)</span>
                  </label>
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 mb-1">Field Inspection Checklist & Instructions</label>
                <textarea
                  rows={3}
                  value={inspectionInstructions}
                  onChange={(e) => setInspectionInstructions(e.target.value)}
                  placeholder="Specific quality instructions for the field engineer (e.g. verify compressive concrete strength, check GPS boundary points)."
                  className="w-full rounded-xl border border-slate-300 p-2.5 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none"
                />
              </div>

              <div className="rounded-xl bg-purple-50/70 border border-purple-200 p-3 text-[11px] text-purple-900">
                📸 Dispatches an on-site inspection task to the designated Technical Field Inspector with mobile geotagged photo capture and GPS proximity verification.
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setIsInspectionModalOpen(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isSubmitting}
                  className="bg-purple-700 hover:bg-purple-800 text-white font-semibold"
                >
                  {isSubmitting ? "Dispatching…" : "Dispatch Inspector"}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
