"use client";

import React, { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { CaseListResponse, CaseNotification, CaseRecord, CaseSeverity, CaseStatus, formatDateTime } from "@/lib/api";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState, ErrorState, EmptyState } from "@/components/ui/states";
import { AlertCircle, CheckCircle2, ChevronRight, FileWarning, Plus, RefreshCw, Search } from "lucide-react";
import { ExportReportButton } from "@/components/reports/export-report-button";
import { PrintableReport } from "@/lib/export-report";

const API = "/api/v1/cases";
const WRITERS = new Set(["district_authority", "admin"]);

const STATUS_LABELS: Record<CaseStatus, string> = {
  new: "New",
  acknowledged: "Acknowledged",
  under_review: "Under Review",
  clarification_requested: "Clarification Requested",
  inspection_assigned: "Inspection Assigned",
  evidence_submitted: "Evidence Submitted",
  corrective_action_planned: "Corrective Action Planned",
  resolved: "Resolved",
  rejected_false_positive: "Rejected / False Positive",
  escalated: "Escalated",
  reopened: "Reopened",
};

interface WorkOption {
  work_id: string;
  title: string;
  district_name?: string;
  state_name?: string;
}

export default function CasesPage() {
  const { user, fetchWithAuth, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const [cases, setCases] = useState<CaseRecord[]>([]);
  const [works, setWorks] = useState<WorkOption[]>([]);
  const [notifications, setNotifications] = useState<CaseNotification[]>([]);
  const [status, setStatus] = useState<"" | CaseStatus>("");
  const [severity, setSeverity] = useState<"" | CaseSeverity>("");
  const [searchQuery, setSearchQuery] = useState("");

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createSuccess, setCreateSuccess] = useState<string | null>(null);

  const [form, setForm] = useState({
    work_id: "",
    title: "",
    description: "",
    severity: "medium" as CaseSeverity,
    due_date: "",
  });

  const canWrite = Boolean(user && WRITERS.has(user.role));

  // Pre-fill from URL query parameters if present
  useEffect(() => {
    if (typeof window !== "undefined") {
      const sp = new URLSearchParams(window.location.search);
      const qWorkId = sp.get("work_id");
      const qTitle = sp.get("title");
      if (qWorkId) {
        setForm((prev) => ({
          ...prev,
          work_id: qWorkId,
          title: qTitle || prev.title || ("Investigation: Work " + qWorkId.slice(0, 8)),
        }));
      }
    }
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setPageError(null);
    const params = new URLSearchParams({ page: "1", page_size: "100" });
    if (status) params.set("status", status);
    if (severity) params.set("severity", severity);

    try {
      const response = await fetchWithAuth(API + "?" + params.toString());
      if (response.status === 403) {
        setPageError("PERMISSION_DENIED");
        return;
      }
      if (!response.ok) {
        const body = await response.json().catch(() => ({ detail: "Could not load cases." }));
        throw new Error(body.detail || "Could not load cases.");
      }
      const payload: CaseListResponse = await response.json();
      setCases(payload.cases || []);

      // Load available works for dropdown autocomplete
      const worksRes = await fetchWithAuth("/api/v1/works?page=1&page_size=100");
      if (worksRes.ok) {
        const worksData = await worksRes.json();
        setWorks(worksData.works || []);
      }

      if (canWrite) {
        const alertResponse = await fetchWithAuth(API + "/notifications");
        if (alertResponse.ok) {
          const alerts = (await alertResponse.json()) as { notifications: CaseNotification[] };
          setNotifications(alerts.notifications || []);
        }
      }
    } catch (cause: unknown) {
      setPageError(cause instanceof Error ? cause.message : "Could not load cases.");
    } finally {
      setLoading(false);
    }
  }, [canWrite, fetchWithAuth, severity, status]);

  useEffect(() => {
    if (authLoading || !user) return;
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, load, user]);

  async function handleCreateCase(e: React.FormEvent) {
    e.preventDefault();
    if (!form.work_id.trim() || !form.title.trim()) {
      setCreateError("Please provide both a Work ID (or select a project) and a Case Title.");
      return;
    }

    setCreating(true);
    setCreateError(null);
    setCreateSuccess(null);

    let parsedDueDate: string | null = null;
    if (form.due_date) {
      try {
        parsedDueDate = new Date(form.due_date).toISOString();
      } catch {
        parsedDueDate = null;
      }
    }

    try {
      const response = await fetchWithAuth(API, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          work_id: form.work_id.trim(),
          title: form.title.trim(),
          description: form.description.trim(),
          severity: form.severity,
          due_date: parsedDueDate,
        }),
      });

      if (!response.ok) {
        const body = await response.json().catch(() => ({ detail: "Could not create case." }));
        throw new Error(body.detail || "Could not create case.");
      }

      const created: CaseRecord = await response.json();
      setCreateSuccess("Case created successfully! Reference: " + created.case_id.slice(0, 8));
      setForm({ work_id: "", title: "", description: "", severity: "medium", due_date: "" });
      await load();
      router.push("/dashboard/cases/" + created.case_id);
    } catch (cause: unknown) {
      setCreateError(cause instanceof Error ? cause.message : "Failed to create case. Please verify the Work ID.");
    } finally {
      setCreating(false);
    }
  }

  // Find work label if selected
  const selectedWork = works.find((w) => w.work_id.toLowerCase() === form.work_id.trim().toLowerCase());

  // Filter cases by search query
  const filteredCases = cases.filter((c) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      c.title.toLowerCase().includes(q) ||
      c.case_id.toLowerCase().includes(q) ||
      c.work_id.toLowerCase().includes(q) ||
      (c.description && c.description.toLowerCase().includes(q))
    );
  });

  if (authLoading) return <LoadingState label="Loading case management..." />;
  if (!user) return null;

  if (pageError === "PERMISSION_DENIED") {
    return (
      <div className="space-y-6">
        <PageHeader title="Case Management" description="Review investigations, field audits, and corrective action workflows." />
        <ErrorState title="Access Restricted" description="Your role does not have access to case management." onRetry={() => void load()} />
      </div>
    );
  }

  if (pageError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Case Management" description="Review investigations, field audits, and corrective action workflows." />
        <ErrorState title="Error Loading Cases" description={pageError} onRetry={() => void load()} />
      </div>
    );
  }

  const getCasesExportData = () => {
    const listToExport = filteredCases;

    const report: PrintableReport = {
      title: "MPLADS CASES & INVESTIGATION REGISTER",
      subtitle: `Official Register of Cases and Corrective Actions (${listToExport.length} records)`,
      categoryBadge: "GOVERNANCE & INVESTIGATION",
      generatedBy: user ? `${user.full_name} (${user.role.replace(/_/g, " ").toUpperCase()})` : "Authorised Official",
      jurisdiction: user?.jurisdiction?.district_code || user?.jurisdiction?.state_code || "National Oversight",
      metadata: [
        { label: "Total Cases Listed", value: String(listToExport.length) },
        { label: "Status Filter", value: status ? (STATUS_LABELS[status] || status) : "All Statuses" },
        { label: "Severity Filter", value: severity ? severity.toUpperCase() : "All Severities" },
        { label: "Critical Cases", value: String(listToExport.filter((c) => c.severity === "critical").length) },
        { label: "High Cases", value: String(listToExport.filter((c) => c.severity === "high").length) },
        { label: "Resolved", value: String(listToExport.filter((c) => c.status === "resolved").length) },
      ],
      sections: [
        {
          title: "Investigation & Review Case Queue",
          type: "table",
          headers: ["Case ID", "Work ID", "Title", "Status", "Severity", "Owner", "Inspector", "Due Date"],
          rows: listToExport.map((c) => [
            c.case_id.slice(0, 8),
            c.work_id,
            c.title,
            STATUS_LABELS[c.status] || c.status,
            c.severity.toUpperCase(),
            c.owner_user_id || "Unassigned",
            c.assigned_inspector_id || "Unassigned",
            c.due_date ? formatDateTime(c.due_date) : "—",
          ]),
        },
      ],
      signOff: {
        designation: "District Magistrate / Competent Nodal Authority",
        office: "Ministry of Statistics & Programme Implementation (MoSPI)",
      },
    };

    const csvHeaders = [
      "Case ID",
      "Work ID",
      "Case Title",
      "Status",
      "Severity",
      "Owner",
      "Inspector",
      "Due Date",
      "Created At",
      "Description",
    ];

    const csvRows = listToExport.map((c) => [
      c.case_id,
      c.work_id,
      c.title,
      STATUS_LABELS[c.status] || c.status,
      c.severity,
      c.owner_user_id || "",
      c.assigned_inspector_id || "",
      c.due_date || "",
      c.created_at || "",
      c.description || "",
    ]);

    return {
      report,
      csv: { headers: csvHeaders, rows: csvRows },
      json: listToExport,
    };
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Case Management"
        description="District authority and administrative review, inspector assignment, field verification, and documented resolution."
        actions={
          <div className="flex items-center gap-2">
            <ExportReportButton
              label="Export Cases Report"
              filename="MPLADS_Cases_Register"
              getReportData={getCasesExportData}
            />
            <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={"mr-2 h-4 w-4 " + (loading ? "animate-spin" : "")} />
              Refresh
            </Button>
          </div>
        }
      />

      {/* SNO Administrative Directives Urgent Banner */}
      {(() => {
        const snoDirectives = cases.filter(
          (c) =>
            c.status === "escalated" ||
            (c.source_id && c.source_id.startsWith("SNO/")) ||
            (c.case_id && c.case_id.startsWith("CASE-SNO")) ||
            c.anomaly_category === "statutory_delay_escalation"
        );
        if (snoDirectives.length === 0) return null;

        return (
          <div className="rounded-xl border-2 border-rose-400 bg-gradient-to-r from-rose-50 via-rose-100/60 to-amber-50 p-5 shadow-sm">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-rose-200">
              <div className="flex items-center gap-2">
                <span className="flex h-3 w-3 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-rose-600"></span>
                </span>
                <span className="text-sm font-bold text-rose-900 tracking-wide uppercase">
                  🚨 State Nodal Officer (SNO) Directives & Show-Cause Notices ({snoDirectives.length} Active)
                </span>
              </div>
              <Badge className="bg-rose-700 hover:bg-rose-800 text-white text-xs px-2.5 py-0.5 w-fit">
                Statutory Action Required under Section 8.4
              </Badge>
            </div>
            <p className="mt-2 text-xs text-rose-800 leading-relaxed">
              The State Government has dispatched formal administrative show-cause memos requiring the District Authority to submit a verified physical remediation schedule and statutory compliance report.
            </p>
            <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
              {snoDirectives.map((item) => (
                <div
                  key={item.case_id}
                  className="flex items-start justify-between gap-3 rounded-lg border border-rose-200 bg-white/90 p-3 shadow-xs hover:border-rose-400 transition-all"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span className="font-mono text-[11px] font-bold text-rose-700 bg-rose-50 border border-rose-200 px-1.5 py-0.5 rounded">
                        {item.source_id || item.case_id}
                      </span>
                      {item.district_code && (
                        <Badge variant="outline" className="text-[10px] text-slate-600 border-slate-300">
                          {item.district_code}
                        </Badge>
                      )}
                      <Badge className="bg-rose-100 text-rose-800 border-rose-200 text-[10px]">
                        CRITICAL ESCALATION
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs font-semibold text-slate-900 truncate">
                      {item.title}
                    </div>
                    {item.due_date && (
                      <div className="mt-0.5 text-[11px] text-amber-700 font-medium">
                        ⏱️ Statutory Cure Deadline: {formatDateTime(item.due_date)}
                      </div>
                    )}
                  </div>
                  <Button
                    size="sm"
                    onClick={() => router.push(`/dashboard/cases/${item.case_id}`)}
                    className="bg-rose-600 hover:bg-rose-700 text-white text-xs font-semibold shrink-0 shadow-xs"
                  >
                    Respond →
                  </Button>
                </div>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Notifications Alert */}
      {notifications.length > 0 && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-blue-900">
              {notifications.length} Field Inspection Update{notifications.length === 1 ? "" : "s"}
            </span>
          </div>
          <div className="mt-2 space-y-1">
            {notifications.slice(0, 3).map((item) => (
              <button
                key={item.notification_id}
                onClick={() => router.push("/dashboard/cases/" + item.case_id)}
                className="block text-left text-xs text-blue-700 hover:underline"
              >
                • {item.message}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Case Creation Section (Admin & District Authority) */}
      {canWrite && (
        <Card className="border-sky-100 bg-white shadow-sm">
          <CardContent className="p-6">
            <div className="mb-4">
              <h2 className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <FileWarning className="h-5 w-5 text-amber-600" />
                Open a New Case
              </h2>
              <p className="text-xs text-slate-500">
                Initiate a field inspection or compliance inquiry. Select a work from the suggestions or paste a Work ID.
              </p>
            </div>

            {createSuccess && (
              <div className="mb-4 flex items-center gap-2 rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-xs text-emerald-800">
                <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                <span>{createSuccess}</span>
              </div>
            )}

            {createError && (
              <div className="mb-4 flex items-center justify-between rounded-lg bg-rose-50 border border-rose-200 px-3 py-2 text-xs text-rose-800">
                <div className="flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-rose-600 flex-shrink-0" />
                  <span>{createError}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setCreateError(null)}
                  className="text-xs font-semibold text-rose-600 hover:text-rose-900 ml-2"
                >
                  Dismiss
                </button>
              </div>
            )}

            <form onSubmit={handleCreateCase} className="space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                {/* Work ID / Picker */}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Work Project <span className="text-rose-500">*</span>
                  </label>
                  <Input
                    list="works-autocomplete"
                    value={form.work_id}
                    onChange={(e) => {
                      const val = e.target.value;
                      setForm((prev) => {
                        const matched = works.find((w) => w.work_id === val);
                        return {
                          ...prev,
                          work_id: val,
                          title: matched && !prev.title ? ("Review: " + matched.title) : prev.title,
                        };
                      });
                    }}
                    placeholder="Search work title or enter Work ID / UUID"
                    required
                  />
                  <datalist id="works-autocomplete">
                    {works.map((w) => (
                      <option key={w.work_id} value={w.work_id}>
                        {w.title} ({w.district_name || w.state_name})
                      </option>
                    ))}
                  </datalist>
                  {selectedWork ? (
                    <p className="mt-1 text-[11px] text-emerald-700">
                      ✓ Selected: {selectedWork.title} ({selectedWork.district_name || selectedWork.state_name})
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-slate-400">
                      Enter project UUID, prefix (e.g. 8 chars), or choose from dropdown suggestions.
                    </p>
                  )}
                </div>

                {/* Case Title */}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">
                    Case Title <span className="text-rose-500">*</span>
                  </label>
                  <Input
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    placeholder="e.g. Physical Progress Verification / Cost Anomaly"
                    required
                  />
                </div>

                {/* Severity */}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Severity Tier</label>
                  <select
                    value={form.severity}
                    onChange={(e) => setForm({ ...form, severity: e.target.value as CaseSeverity })}
                    className="h-9 w-full rounded-md border border-slate-300 bg-white px-3 py-1 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500"
                  >
                    <option value="low">Low Severity</option>
                    <option value="medium">Medium Severity</option>
                    <option value="high">High Severity</option>
                    <option value="critical">Critical Severity</option>
                  </select>
                </div>

                {/* Due Date */}
                <div>
                  <label className="block text-xs font-medium text-slate-700 mb-1">Target Due Date</label>
                  <Input
                    type="date"
                    value={form.due_date}
                    onChange={(e) => setForm({ ...form, due_date: e.target.value })}
                  />
                </div>

                {/* Description */}
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-700 mb-1">Reason for Review / Context</label>
                  <textarea
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    placeholder="Describe specific grounds for inquiry (e.g. disparity between funds released and physical progress, community grievance, ML delay anomaly)..."
                    className="w-full rounded-md border border-slate-300 bg-white p-2 text-sm shadow-sm focus:border-sky-500 focus:outline-none focus:ring-1 focus:ring-sky-500 min-h-[64px]"
                  />
                </div>
              </div>

              <div className="flex justify-end">
                <Button type="submit" disabled={creating} className="bg-amber-600 hover:bg-amber-700 text-white">
                  <Plus className="mr-1 h-4 w-4" />
                  {creating ? "Opening Case..." : "Create Case"}
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Filters & Search */}
      <Card className="border-sky-100 bg-white shadow-sm">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row gap-3 items-center justify-between">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search cases by title, ID, work ID..."
                className="pl-9 h-9"
              />
            </div>

            <div className="flex flex-wrap items-center gap-3 w-full sm:w-auto">
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as "" | CaseStatus)}
                className="h-9 rounded-md border border-slate-300 bg-white px-3 py-1 text-xs shadow-sm focus:border-sky-500 focus:outline-none"
              >
                <option value="">All Statuses</option>
                {Object.entries(STATUS_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>
                    {label}
                  </option>
                ))}
              </select>

              <select
                value={severity}
                onChange={(e) => setSeverity(e.target.value as "" | CaseSeverity)}
                className="h-9 rounded-md border border-slate-300 bg-white px-3 py-1 text-xs shadow-sm focus:border-sky-500 focus:outline-none"
              >
                <option value="">All Severities</option>
                <option value="low">Low Severity</option>
                <option value="medium">Medium Severity</option>
                <option value="high">High Severity</option>
                <option value="critical">Critical Severity</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Cases Table */}
      {loading ? (
        <LoadingState label="Loading case records..." />
      ) : filteredCases.length === 0 ? (
        <EmptyState
          title="No cases match your filters"
          description="Try modifying search terms or create a new case above."
        />
      ) : (
        <Card className="border-sky-100 bg-white shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="p-3">Case Title & Reference</th>
                  <th className="p-3">Work Project</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Severity</th>
                  <th className="p-3">Assigned Inspector</th>
                  <th className="p-3">Updated</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCases.map((item) => {
                  const isSno =
                    (item.source_id && item.source_id.startsWith("SNO/")) ||
                    item.case_id.startsWith("CASE-SNO") ||
                    item.anomaly_category === "statutory_delay_escalation";

                  return (
                    <tr
                      key={item.case_id}
                      className={`hover:bg-slate-50 transition-colors ${
                        isSno ? "bg-rose-50/30" : ""
                      }`}
                    >
                      <td className="p-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <strong className="text-slate-900 text-sm font-semibold">{item.title}</strong>
                          {isSno && (
                            <Badge className="bg-rose-600 hover:bg-rose-700 text-white text-[10px] font-bold py-0">
                              🚨 SNO DIRECTIVE
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[11px] font-mono text-slate-400">ID: {item.case_id}</span>
                          {item.district_code && (
                            <span className="text-[10px] font-semibold text-slate-600 bg-slate-100 border border-slate-200 px-1.5 rounded">
                              {item.district_code}
                            </span>
                          )}
                          {isSno && item.source_id && (
                            <span className="text-[10px] font-mono font-bold text-rose-700 bg-rose-100/70 border border-rose-200 px-1.5 rounded">
                              Memo: {item.source_id}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3">
                        <span className="font-mono text-slate-600 block">{item.work_id.slice(0, 12)}…</span>
                        <span className="text-[11px] text-slate-400">
                          Source: {item.source_type}
                        </span>
                      </td>
                      <td className="p-3">
                        <Badge
                          variant="outline"
                          className={
                            item.status === "escalated"
                              ? "bg-rose-100 text-rose-800 border-rose-300 font-bold"
                              : "bg-blue-50 text-blue-800 border-blue-200"
                          }
                        >
                          {STATUS_LABELS[item.status] || item.status}
                        </Badge>
                        {item.inspection_reports && item.inspection_reports.length > 0 && (
                          <span className="block mt-1 text-[11px] text-slate-500">
                            {item.inspection_reports.length} report(s)
                          </span>
                        )}
                      </td>
                      <td className="p-3">
                        <Badge
                          variant="secondary"
                          className={
                            item.severity === "critical"
                              ? "bg-rose-100 text-rose-800 border-rose-200 font-semibold"
                              : item.severity === "high"
                              ? "bg-amber-100 text-amber-800 border-amber-200"
                              : item.severity === "medium"
                              ? "bg-yellow-100 text-yellow-800 border-yellow-200"
                              : "bg-emerald-100 text-emerald-800 border-emerald-200"
                          }
                        >
                          {item.severity}
                        </Badge>
                      </td>
                      <td className="p-3 text-slate-600">
                        {item.assigned_inspector_id ? (
                          <span className="font-medium text-slate-800">{item.assigned_inspector_id}</span>
                        ) : (
                          <span className="text-slate-400 italic">Unassigned</span>
                        )}
                      </td>
                      <td className="p-3 text-slate-500">
                        <div>{formatDateTime(item.updated_at)}</div>
                        {item.due_date && (
                          <div className={`text-[11px] ${isSno ? "text-rose-700 font-semibold" : "text-amber-700"}`}>
                            Due: {formatDateTime(item.due_date)}
                          </div>
                        )}
                      </td>
                      <td className="p-3 text-right">
                        <Button
                          variant={isSno ? "default" : "outline"}
                          size="sm"
                          onClick={() => router.push("/dashboard/cases/" + item.case_id)}
                          className={`text-xs ${
                            isSno
                              ? "bg-rose-600 hover:bg-rose-700 text-white font-semibold"
                              : ""
                          }`}
                        >
                          {isSno ? "Respond →" : "View"}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
