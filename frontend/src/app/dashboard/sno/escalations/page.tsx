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
  Send,
  AlertTriangle,
  Clock,
  CheckCircle2,
  Building2,
  FileText,
  Search,
  Filter,
  ArrowRight,
  ShieldAlert,
  X,
  Sparkles,
} from "lucide-react";

interface BottleneckItem {
  work_id: string;
  title: string;
  district_code: string;
  district_name: string;
  constituency: string;
  sanctioned_amount: number;
  actual_expenditure: number;
  physical_progress_pct: number;
  financial_utilization_pct: number;
  days_delayed: number;
  delay_cause: string;
  implementing_agency: string;
  composite_risk_score: number;
  notice_status: "pending" | "notice_issued" | "hearing_scheduled" | "remedied";
  latest_memo_ref: string | null;
  cure_deadline: string | null;
  last_escalated_at: string | null;
}

interface BottlenecksResponse {
  state_code: string;
  state_name: string;
  total_delayed_works: number;
  pending_notices_count: number;
  notices_issued_count: number;
  bottlenecks: BottleneckItem[];
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

export default function BottleneckEscalationPage() {
  const { user, fetchWithAuth } = useAuth();
  const stateCode = user?.jurisdiction?.state_code || "UP";
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const [selectedWork, setSelectedWork] = useState<BottleneckItem | null>(null);
  const [modalMode, setModalMode] = useState<"issue" | "view">("issue");
  const [deadlineDays, setDeadlineDays] = useState<number>(15);
  const [remarks, setRemarks] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { data, isLoading } = useAuthenticatedQuery<BottlenecksResponse>(
    ["sno-bottlenecks", stateCode],
    `/api/v1/sno/bottlenecks?state_code=${stateCode}`,
    { staleTime: 30_000 }
  );

  const bottlenecks = data?.bottlenecks || [];

  const filtered = bottlenecks.filter((b) => {
    const matchesSearch =
      b.title.toLowerCase().includes(search.toLowerCase()) ||
      b.district_name.toLowerCase().includes(search.toLowerCase()) ||
      b.work_id.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = statusFilter === "all" || b.notice_status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  async function handleIssueNotice(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedWork) return;
    setSubmitting(true);
    setSuccessMessage(null);
    setErrorMessage(null);

    try {
      const res = await fetchWithAuth(`/api/v1/sno/bottlenecks/${selectedWork.work_id}/issue-notice`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          statutory_deadline_days: deadlineDays,
          custom_remarks: remarks || "Formal administrative notice issued to District Magistrate under MPLADS Rule 8.4.",
          escalation_reason: selectedWork.delay_cause,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errorText = parseApiError(body.detail, "Failed to issue notice.");
        throw new Error(errorText);
      }

      setSuccessMessage(`Official Memo ${body.memo_reference} successfully dispatched to District Magistrate.`);
      void queryClient.invalidateQueries({ queryKey: ["sno-bottlenecks"] });
      void queryClient.invalidateQueries({ queryKey: ["sno-heatmap"] });
      setTimeout(() => {
        setSelectedWork(null);
        setSuccessMessage(null);
        setErrorMessage(null);
      }, 2000);
    } catch (err: any) {
      setErrorMessage(err.message || "Failed to issue notice.");
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
            <Badge className="bg-rose-100 text-rose-800 border-rose-200 text-xs">
              State Nodal Office · {data?.state_name || stateCode}
            </Badge>
            <span className="text-xs text-slate-500 font-medium">· Rule 8.4 Show-Cause Directives</span>
          </div>
          <h1 className="text-2xl font-black text-slate-950 mt-1 flex items-center gap-2">
            <Send className="h-6 w-6 text-rose-600" />
            Bottleneck Escalation to District Magistrates
          </h1>
          <p className="text-xs sm:text-sm text-slate-600 max-w-2xl mt-0.5">
            Issue formal administrative notices to District Magistrates / Collectors when projects exceed statutory delay thresholds, requiring time-bound compliance reports.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href="/dashboard/sno/heatmap">
            <Button size="sm" variant="outline" className="text-xs font-semibold">
              ← Risk Heatmap
            </Button>
          </Link>
          <Link href="/dashboard/sno/allocations">
            <Button size="sm" className="bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold">
              Reallocate Funds →
            </Button>
          </Link>
        </div>
      </div>

      {/* Stats Ribbon */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-slate-200/80 shadow-2xs">
          <CardHeader className="pb-1.5 pt-4">
            <CardDescription className="text-xs font-bold text-slate-500 uppercase">
              Total Project Bottlenecks
            </CardDescription>
            <CardTitle className="text-2xl font-black text-slate-900">
              {data ? data.total_delayed_works : "—"} Works
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4 text-xs text-slate-600">
            Projects exceeding statutory completion schedules
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-2xs">
          <CardHeader className="pb-1.5 pt-4">
            <CardDescription className="text-xs font-bold text-slate-500 uppercase">
              Pending Administrative Notices
            </CardDescription>
            <CardTitle className="text-2xl font-black text-rose-600">
              {data ? data.pending_notices_count : "—"} Pending
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4 text-xs text-slate-600">
            Requires formal SNO show-cause issuance
          </CardContent>
        </Card>

        <Card className="border-slate-200/80 shadow-2xs">
          <CardHeader className="pb-1.5 pt-4">
            <CardDescription className="text-xs font-bold text-slate-500 uppercase">
              Memos Dispatched
            </CardDescription>
            <CardTitle className="text-2xl font-black text-emerald-600">
              {data ? data.notices_issued_count : "—"} Dispatched
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-4 text-xs text-slate-600">
            District Magistrates notified with cure deadlines
          </CardContent>
        </Card>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white p-3.5 rounded-xl border border-slate-200 shadow-2xs">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
          <Input
            placeholder="Search work title, district, ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-9 text-xs"
          />
        </div>

        <div className="flex items-center rounded-lg border border-slate-200 bg-slate-50 p-0.5 text-xs">
          {[
            { id: "all", label: "All Bottlenecks" },
            { id: "pending", label: "Pending Notice" },
            { id: "notice_issued", label: "Notice Dispatched" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1 rounded-md font-semibold transition-colors cursor-pointer ${
                statusFilter === tab.id
                  ? "bg-white text-slate-900 shadow-xs"
                  : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Bottlenecks Queue Table */}
      <Card className="border-slate-200 shadow-2xs overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs border-collapse">
            <thead>
              <tr className="border-b border-slate-200 bg-slate-50/80 font-bold text-slate-700 uppercase tracking-wider">
                <th className="px-4 py-3">Work Project</th>
                <th className="px-4 py-3">District & Constituency</th>
                <th className="px-4 py-3">Implementing Agency</th>
                <th className="px-4 py-3 text-right">Outlay & Spent</th>
                <th className="px-4 py-3 text-center">Days Delayed</th>
                <th className="px-4 py-3">Primary Delay Cause</th>
                <th className="px-4 py-3 text-center">Notice Status</th>
                <th className="px-4 py-3 text-right">Administrative Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                    Loading project bottleneck queue...
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-slate-500">
                    No bottleneck projects found matching current criteria.
                  </td>
                </tr>
              ) : (
                filtered.map((b) => (
                  <tr key={b.work_id} className="hover:bg-slate-50/60 transition-colors">
                    <td className="px-4 py-3 max-w-[220px]">
                      <p className="font-bold text-slate-900 truncate" title={b.title}>
                        {b.title}
                      </p>
                      <p className="text-[10px] text-slate-400 font-mono truncate">{b.work_id}</p>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-slate-800">{b.district_name}</p>
                      <p className="text-[10px] text-slate-500">{b.constituency}</p>
                    </td>
                    <td className="px-4 py-3 text-slate-600 max-w-[150px] truncate" title={b.implementing_agency}>
                      {b.implementing_agency}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">
                      <div className="text-slate-900 font-bold">₹{(b.sanctioned_amount / 1e7).toFixed(2)} Cr</div>
                      <div className="text-[10px] text-slate-500">
                        ₹{(b.actual_expenditure / 1e7).toFixed(2)} Cr ({b.financial_utilization_pct}%)
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge variant="outline" className="bg-rose-50 text-rose-700 border-rose-200 text-xs font-bold">
                        +{b.days_delayed} days
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-600 max-w-[200px] truncate text-[11px]" title={b.delay_cause}>
                      {b.delay_cause}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {b.notice_status === "notice_issued" ? (
                        <div>
                          <Badge className="bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px] font-bold">
                            Memo Dispatched
                          </Badge>
                          {b.latest_memo_ref && (
                            <p className="text-[10px] font-mono text-slate-500 mt-0.5">{b.latest_memo_ref}</p>
                          )}
                        </div>
                      ) : (
                        <Badge variant="outline" className="bg-amber-50 text-amber-800 border-amber-200 text-[10px] font-semibold">
                          Pending Notice
                        </Badge>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {b.notice_status === "notice_issued" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                          onClick={() => {
                            setSelectedWork(b);
                            setModalMode("view");
                          }}
                        >
                          View Memo
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          className="h-7 text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white shadow-xs"
                          onClick={() => {
                            setSelectedWork(b);
                            setModalMode("issue");
                            setDeadlineDays(15);
                            setRemarks("");
                          }}
                        >
                          Issue Notice →
                        </Button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Notice Issuance & Memo Preview Modal */}
      {selectedWork && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 backdrop-blur-xs p-4 animate-in fade-in-50">
          <div className="relative w-full max-w-lg rounded-2xl bg-white border border-slate-200 p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <span className="p-1.5 rounded-lg bg-rose-50 text-rose-600">
                  <Send className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    {modalMode === "issue" ? "Issue Administrative Notice to DM" : "Dispatched Notice Memo"}
                  </h3>
                  <p className="text-xs text-slate-500">
                    MPLADS Statutory Show-Cause Directive under Section 8.4
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSelectedWork(null)}
                className="text-slate-400 hover:text-slate-600 p-1 rounded-lg"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Target Details */}
            <div className="rounded-xl bg-slate-50 p-3.5 border border-slate-200 text-xs space-y-2">
              <div className="flex justify-between">
                <span className="text-slate-500">Project Title:</span>
                <strong className="text-slate-900 truncate max-w-[280px]">{selectedWork.title}</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">District Magistrate:</span>
                <strong className="text-slate-900">Collector & DM ({selectedWork.district_name})</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Schedule Overshoot:</span>
                <strong className="text-rose-600">+{selectedWork.days_delayed} days delayed</strong>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Sanctioned Budget:</span>
                <strong className="text-slate-900">₹{(selectedWork.sanctioned_amount / 1e7).toFixed(2)} Cr</strong>
              </div>
            </div>

            {modalMode === "issue" ? (
              <form onSubmit={handleIssueNotice} className="space-y-4 text-xs">
                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Statutory Cure Deadline (Days)
                  </label>
                  <select
                    value={deadlineDays}
                    onChange={(e) => setDeadlineDays(Number(e.target.value))}
                    className="w-full h-9 rounded-lg border border-slate-200 px-3 bg-white text-xs font-medium text-slate-900 focus:outline-blue-600"
                  >
                    <option value={7}>7 Days (Immediate Emergency Inquiry)</option>
                    <option value={15}>15 Days (Standard Show-Cause Directive)</option>
                    <option value={30}>30 Days (Comprehensive Site Remediation)</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 mb-1">
                    Executive Directives & Specific Observations
                  </label>
                  <textarea
                    rows={3}
                    placeholder="Enter specific instructions to the District Magistrate regarding contractor replacement, site inspection, or administrative recovery..."
                    value={remarks}
                    onChange={(e) => setRemarks(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 p-2.5 bg-white text-xs text-slate-900 focus:outline-blue-600"
                  />
                </div>

                 {errorMessage && (
                  <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-rose-800 font-semibold flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                {successMessage ? (
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 p-3 text-emerald-800 font-semibold flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                    <span>{successMessage}</span>
                  </div>
                ) : (
                  <div className="flex items-center justify-end gap-2 pt-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setSelectedWork(null);
                        setErrorMessage(null);
                        setSuccessMessage(null);
                      }}
                      disabled={submitting}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      size="sm"
                      className="bg-rose-600 hover:bg-rose-500 text-white font-bold"
                      disabled={submitting}
                    >
                      {submitting ? "Dispatching Memo..." : "Dispatch Official Notice"}
                    </Button>
                  </div>
                )}
              </form>
            ) : (
              /* View Memo Details */
              <div className="space-y-3 text-xs">
                <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-200 text-blue-900 space-y-1.5">
                  <div className="flex justify-between">
                    <span className="font-semibold text-blue-700">Official Memo Reference:</span>
                    <strong className="font-mono">{selectedWork.latest_memo_ref}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-semibold text-blue-700">Statutory Remedy Deadline:</span>
                    <strong>{selectedWork.cure_deadline ? new Date(selectedWork.cure_deadline).toLocaleDateString() : "Active"}</strong>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-semibold text-blue-700">Dispatched On:</span>
                    <span>{selectedWork.last_escalated_at ? new Date(selectedWork.last_escalated_at).toLocaleString() : "Recently"}</span>
                  </div>
                </div>

                <div className="flex justify-end pt-2">
                  <Button size="sm" onClick={() => setSelectedWork(null)}>
                    Close
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
