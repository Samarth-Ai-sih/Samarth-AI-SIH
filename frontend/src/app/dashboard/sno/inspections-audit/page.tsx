"use client";

import React, { useState, useMemo } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useAuthenticatedQuery } from "@/lib/query";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  ClipboardCheck,
  CheckCircle2,
  AlertTriangle,
  Search,
  Building2,
  ShieldCheck,
  Clock,
  Send,
  FileCheck2,
  Sparkles,
  X,
  FileText,
  Calendar,
  AlertOctagon,
  Eye,
  ChevronRight,
  Info,
} from "lucide-react";

interface DistrictInspectionAudit {
  district_code: string;
  district_name: string;
  total_sanctioned_works: number;
  mandatory_quota_10pct: number;
  completed_inspections: number;
  inspection_rate_pct: number;
  quota_status: "compliant" | "deficit";
  deficit_count: number;
  last_inspection_date: string | null;
}

interface InspectionQuotaAuditResponse {
  state_code: string;
  state_name: string;
  total_state_works: number;
  state_mandatory_quota: number;
  state_completed_inspections: number;
  state_overall_inspection_rate_pct: number;
  compliant_districts_count: number;
  deficit_districts_count: number;
  districts: DistrictInspectionAudit[];
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

export default function SNOInspectionAuditPage() {
  const { user, fetchWithAuth } = useAuth();
  const stateCode = user?.jurisdiction?.state_code || "UP";
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState("");
  const [filterStatus, setFilterStatus] = useState<"all" | "compliant" | "deficit">("all");
  const [selectedDistrict, setSelectedDistrict] = useState<DistrictInspectionAudit | null>(null);

  // Directive Modal State
  const [deadlineDays, setDeadlineDays] = useState<number>(30);
  const [priorityNote, setPriorityNote] = useState<string>("");
  const [submitting, setSubmitting] = useState(false);
  const [successDirective, setSuccessDirective] = useState<{
    reference: string;
    message: string;
    deadline: string;
  } | null>(null);
  const [errorDirective, setErrorDirective] = useState<string | null>(null);

  const { data, isLoading, refetch } = useAuthenticatedQuery<InspectionQuotaAuditResponse>(
    ["sno-inspections-audit", stateCode],
    `/api/v1/sno/inspections-audit?state_code=${stateCode}`,
    { staleTime: 30_000 }
  );

  const districts = useMemo(() => data?.districts || [], [data]);

  const filteredDistricts = useMemo(() => {
    return districts.filter((d) => {
      const matchesSearch =
        d.district_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        d.district_code.toLowerCase().includes(searchQuery.toLowerCase());
      const matchesStatus =
        filterStatus === "all" ? true : d.quota_status === filterStatus;
      return matchesSearch && matchesStatus;
    });
  }, [districts, searchQuery, filterStatus]);

  const openDirectiveModal = (district: DistrictInspectionAudit) => {
    setSelectedDistrict(district);
    setDeadlineDays(30);
    setPriorityNote(
      district.deficit_count > 0
        ? `Special Drive Order: Accelerate field verification drive in ${district.district_name} to remediate current deficit of ${district.deficit_count} works and fulfill mandatory 10% statutory quota.`
        : `Statutory Vigilance Order: Maintain high-velocity physical inspection standards across high-value works in ${district.district_name}.`
    );
    setSuccessDirective(null);
    setErrorDirective(null);
  };

  const handleIssueDirective = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDistrict) return;

    setSubmitting(true);
    setErrorDirective(null);
    try {
      const res = await fetchWithAuth("/api/v1/sno/inspections-audit/directive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          district_code: selectedDistrict.district_code,
          deadline_days: deadlineDays,
          priority_note: priorityNote,
        }),
      });

      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const errText = parseApiError(body.detail, "Failed to issue directive");
        throw new Error(errText);
      }

      setSuccessDirective({
        reference: body.directive_reference,
        message: body.message,
        deadline: body.deadline,
      });

      // Invalidate queries to refresh numbers
      queryClient.invalidateQueries({ queryKey: ["sno-inspections-audit"] });
      queryClient.invalidateQueries({ queryKey: ["sno-inspections"] });
    } catch (err: any) {
      setErrorDirective(err.message || "Failed to issue directive");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="rounded-2xl border border-emerald-200/80 bg-gradient-to-r from-emerald-950 via-teal-950 to-slate-900 p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="absolute right-0 top-0 translate-x-12 -translate-y-12 w-96 h-96 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative z-10">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-2">
                <Link
                  href="/dashboard/sno"
                  className="text-xs font-semibold text-emerald-300 hover:text-white transition-colors flex items-center gap-1"
                >
                  <Building2 className="h-3.5 w-3.5" />
                  SNO Command Center
                </Link>
                <span className="text-xs text-slate-500">/</span>
                <span className="text-xs text-emerald-200">Compliance Auditing</span>
              </div>
              <div className="flex items-center gap-3">
                <div className="p-2.5 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-400/30">
                  <ClipboardCheck className="h-6 w-6" />
                </div>
                <div>
                  <h1 className="text-2xl sm:text-3xl font-black tracking-tight text-white">
                    Mandatory 10% Inspection Quota Audit
                  </h1>
                  <p className="text-sm text-emerald-100/90 mt-1 max-w-2xl">
                    MoSPI Statutory Compliance Monitor: Enforces the mandatory 10% annual physical on-site
                    inspection quota across all district authorities in{" "}
                    <span className="font-bold text-white">{data?.state_name || stateCode}</span>.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <Badge className="bg-emerald-500/20 text-emerald-200 border-emerald-400/30 px-3 py-1 font-mono text-xs">
                State: {data?.state_name || stateCode} ({stateCode})
              </Badge>
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetch()}
                className="border-emerald-400/40 text-emerald-200 hover:bg-emerald-800/40 hover:text-white"
              >
                Refresh Audit
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {/* Card 1: Total Sanctioned Works */}
        <Card className="border-slate-200/80 shadow-2xs hover:shadow-md transition-all">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription className="text-xs font-bold uppercase tracking-wider text-slate-500">
                State Sanctioned Works
              </CardDescription>
              <span className="p-1.5 rounded-lg bg-blue-50 text-blue-600">
                <Building2 className="h-4 w-4" />
              </span>
            </div>
            <CardTitle className="text-2xl font-black text-slate-900">
              {data?.total_state_works ?? "—"} Works
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-slate-600 flex items-center justify-between">
              <span>Mandatory 10% Quota:</span>
              <strong className="text-slate-900 font-bold">{data?.state_mandatory_quota ?? 0} Works</strong>
            </div>
            <div className="text-xs text-slate-500 mt-1">Base pool eligible for statutory audit</div>
          </CardContent>
        </Card>

        {/* Card 2: Completed Inspections */}
        <Card className="border-slate-200/80 shadow-2xs hover:shadow-md transition-all">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Physical Inspections Done
              </CardDescription>
              <span className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
                <ShieldCheck className="h-4 w-4" />
              </span>
            </div>
            <CardTitle className="text-2xl font-black text-emerald-700">
              {data?.state_completed_inspections ?? "—"} Works
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-slate-600 flex items-center justify-between">
              <span>Overall State Rate:</span>
              <strong className="text-emerald-700 font-bold">
                {data?.state_overall_inspection_rate_pct ?? 0}%
              </strong>
            </div>
            <div className="text-xs text-emerald-600 mt-1 flex items-center gap-1 font-medium">
              <CheckCircle2 className="h-3 w-3" />
              Surpasses 10.0% statutory minimum
            </div>
          </CardContent>
        </Card>

        {/* Card 3: Compliant Districts */}
        <Card className="border-slate-200/80 shadow-2xs hover:shadow-md transition-all">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Compliant Districts
              </CardDescription>
              <span className="p-1.5 rounded-lg bg-emerald-50 text-emerald-600">
                <CheckCircle2 className="h-4 w-4" />
              </span>
            </div>
            <CardTitle className="text-2xl font-black text-emerald-700">
              {data?.compliant_districts_count ?? "—"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-slate-600 flex items-center justify-between">
              <span>Inspection Compliance:</span>
              <strong className="text-emerald-700">
                {districts.length > 0
                  ? Math.round(((data?.compliant_districts_count || 0) / districts.length) * 100)
                  : 0}
                % of Districts
              </strong>
            </div>
            <div className="text-xs text-slate-500 mt-1">Met or exceeded 10% quota</div>
          </CardContent>
        </Card>

        {/* Card 4: Quota Deficit Districts */}
        <Card className="border-slate-200/80 shadow-2xs hover:shadow-md transition-all">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardDescription className="text-xs font-bold uppercase tracking-wider text-slate-500">
                Quota Deficit Districts
              </CardDescription>
              <span className="p-1.5 rounded-lg bg-rose-50 text-rose-600">
                <AlertOctagon className="h-4 w-4" />
              </span>
            </div>
            <CardTitle className="text-2xl font-black text-rose-600">
              {data?.deficit_districts_count ?? 0}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-xs text-slate-600 flex items-center justify-between">
              <span>Directives Required:</span>
              <strong className={data?.deficit_districts_count ? "text-rose-600 font-bold" : "text-emerald-700"}>
                {data?.deficit_districts_count ? `${data.deficit_districts_count} Immediate Orders` : "Nil (Clean Audit)"}
              </strong>
            </div>
            <div className="text-xs text-slate-500 mt-1">Immediate special drives mandated</div>
          </CardContent>
        </Card>
      </div>

      {/* Statutory Guidelines Rule Callout */}
      <div className="rounded-xl border border-indigo-200 bg-indigo-50/60 p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-slate-800">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-lg bg-indigo-100 text-indigo-700 shrink-0 mt-0.5 sm:mt-0">
            <Info className="h-4 w-4" />
          </div>
          <div>
            <h4 className="text-xs font-bold text-indigo-950 uppercase tracking-wider">
              Statutory Quota Mandate — MoSPI MPLADS Guidelines 2023, Para 6.2
            </h4>
            <p className="text-xs text-slate-700 mt-0.5 leading-relaxed">
              District Authorities are legally required to carry out physical inspections of at least <strong>10%</strong> of all sanctioned projects annually. SNO has the administrative power to issue <strong>time-bound Special Directives</strong> to District Magistrates failing to meet this threshold.
            </p>
          </div>
        </div>
        <Badge className="bg-indigo-600 text-white font-semibold text-[11px] shrink-0">
          Rule 6.2 Binding
        </Badge>
      </div>

      {/* Filter and Search Bar */}
      <Card className="border-slate-200/80 shadow-2xs">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search district name or district code..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 bg-slate-50/50"
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Filter:</span>
              <Button
                variant={filterStatus === "all" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterStatus("all")}
                className={filterStatus === "all" ? "bg-slate-900 text-white" : "text-slate-700"}
              >
                All ({districts.length})
              </Button>
              <Button
                variant={filterStatus === "compliant" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterStatus("compliant")}
                className={filterStatus === "compliant" ? "bg-emerald-600 text-white" : "text-emerald-700 border-emerald-200 hover:bg-emerald-50"}
              >
                Compliant ({data?.compliant_districts_count || 0})
              </Button>
              <Button
                variant={filterStatus === "deficit" ? "default" : "outline"}
                size="sm"
                onClick={() => setFilterStatus("deficit")}
                className={filterStatus === "deficit" ? "bg-rose-600 text-white" : "text-rose-700 border-rose-200 hover:bg-rose-50"}
              >
                Deficit ({data?.deficit_districts_count || 0})
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* District Quota Audit Grid */}
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {isLoading ? (
          <div className="col-span-full py-16 text-center text-slate-400">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-slate-200 border-t-emerald-600 mb-3" />
            <p className="text-sm font-medium">Computing district physical inspection quotas...</p>
          </div>
        ) : filteredDistricts.length === 0 ? (
          <div className="col-span-full py-16 text-center text-slate-500 bg-white rounded-2xl border border-slate-200">
            <ClipboardCheck className="h-10 w-10 text-slate-300 mx-auto mb-2" />
            <p className="font-semibold">No districts match the selected criteria</p>
            <p className="text-xs text-slate-400 mt-1">Try modifying your search or quota filter</p>
          </div>
        ) : (
          filteredDistricts.map((d) => {
            const isCompliant = d.quota_status === "compliant";
            const progressPct = Math.min(100, Math.round((d.completed_inspections / Math.max(1, d.mandatory_quota_10pct)) * 100));

            return (
              <Card
                key={d.district_code}
                className={`border transition-all hover:shadow-md ${
                  isCompliant
                    ? "border-slate-200/90 hover:border-emerald-300"
                    : "border-rose-200 bg-rose-50/20 hover:border-rose-400"
                }`}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="font-bold text-slate-900 text-base">{d.district_name}</h3>
                        <Badge variant="outline" className="text-[10px] font-mono text-slate-500">
                          {d.district_code}
                        </Badge>
                      </div>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {d.total_sanctioned_works} Total Sanctioned Works
                      </p>
                    </div>

                    <Badge
                      className={
                        isCompliant
                          ? "bg-emerald-100 text-emerald-800 border-emerald-300 font-bold"
                          : "bg-rose-100 text-rose-800 border-rose-300 font-bold animate-pulse"
                      }
                    >
                      {isCompliant ? "COMPLIANT" : "QUOTA DEFICIT"}
                    </Badge>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4">
                  {/* Quota Progress Bar */}
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1.5">
                      <span className="text-slate-600 font-medium">10% Statutory Target Progress:</span>
                      <span className={`font-bold ${isCompliant ? "text-emerald-700" : "text-rose-700"}`}>
                        {d.completed_inspections} / {d.mandatory_quota_10pct} Works ({d.inspection_rate_pct}%)
                      </span>
                    </div>
                    <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          isCompliant ? "bg-emerald-600" : "bg-rose-600"
                        }`}
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                  </div>

                  {/* Stat Grid */}
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-100 text-xs">
                    <div className="p-2 rounded-lg bg-slate-50">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Mandatory 10%</span>
                      <strong className="text-slate-900 text-sm">{d.mandatory_quota_10pct} Works</strong>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-50">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Inspections Done</span>
                      <strong className="text-emerald-700 text-sm">{d.completed_inspections} Done</strong>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-50">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Deficit Gap</span>
                      <strong className={d.deficit_count > 0 ? "text-rose-600 text-sm font-bold" : "text-slate-700 text-sm"}>
                        {d.deficit_count > 0 ? `${d.deficit_count} Works Pending` : "0 (Fulfilled)"}
                      </strong>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-50">
                      <span className="text-[10px] uppercase font-bold text-slate-400 block">Last Verified</span>
                      <span className="text-slate-700 text-xs">
                        {d.last_inspection_date
                          ? new Date(d.last_inspection_date).toLocaleDateString("en-IN", {
                              day: "numeric",
                              month: "short",
                            })
                          : "None"}
                      </span>
                    </div>
                  </div>

                  {/* Action Button */}
                  <div className="pt-2">
                    <Button
                      variant={d.deficit_count > 0 ? "default" : "outline"}
                      size="sm"
                      onClick={() => openDirectiveModal(d)}
                      className={`w-full text-xs font-semibold gap-1.5 ${
                        d.deficit_count > 0
                          ? "bg-rose-600 hover:bg-rose-700 text-white shadow-sm"
                          : "border-slate-300 text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <Send className="h-3.5 w-3.5" />
                      {d.deficit_count > 0
                        ? `Issue Quota Directive (${d.deficit_count} Deficit)`
                        : "Issue Vigilance Drive Order"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {/* Comprehensive District Ledger Table */}
      <Card className="border-slate-200/80 shadow-2xs">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-bold text-slate-900">
                Statewide Physical Inspection Compliance Registry
              </CardTitle>
              <CardDescription className="text-xs text-slate-500 mt-0.5">
                Consolidated statutory inspection metrics across all districts in {data?.state_name || stateCode}
              </CardDescription>
            </div>
            <Badge variant="outline" className="text-xs font-mono">
              Para 6.2 Audit
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-y border-slate-200 bg-slate-50/80 font-bold uppercase tracking-wider text-slate-600">
                  <th className="px-4 py-3">District</th>
                  <th className="px-4 py-3 text-right">Total Works</th>
                  <th className="px-4 py-3 text-right">10% Mandatory Quota</th>
                  <th className="px-4 py-3 text-right">Completed Inspections</th>
                  <th className="px-4 py-3 text-right">Quota Rate %</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-right">Deficit Works</th>
                  <th className="px-4 py-3 text-right">Last Verified</th>
                  <th className="px-4 py-3 text-center">Statutory Order</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {districts.map((d) => (
                  <tr key={d.district_code} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-900">{d.district_name}</div>
                      <div className="text-[10px] font-mono text-slate-400">{d.district_code}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-700">
                      {d.total_sanctioned_works}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-slate-900">
                      {d.mandatory_quota_10pct}
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-emerald-700">
                      {d.completed_inspections}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`font-bold ${
                          d.quota_status === "compliant" ? "text-emerald-700" : "text-rose-700"
                        }`}
                      >
                        {d.inspection_rate_pct}%
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Badge
                        className={
                          d.quota_status === "compliant"
                            ? "bg-emerald-100 text-emerald-800 border-emerald-200 text-[10px]"
                            : "bg-rose-100 text-rose-800 border-rose-200 text-[10px]"
                        }
                      >
                        {d.quota_status === "compliant" ? "COMPLIANT" : "DEFICIT"}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {d.deficit_count > 0 ? (
                        <span className="font-bold text-rose-600">+{d.deficit_count} works</span>
                      ) : (
                        <span className="text-slate-400 font-medium">0</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-500">
                      {d.last_inspection_date
                        ? new Date(d.last_inspection_date).toLocaleDateString("en-IN", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openDirectiveModal(d)}
                        className="text-xs text-blue-700 hover:text-blue-900 hover:bg-blue-50 font-medium"
                      >
                        Issue Directive
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Directive Order Modal */}
      {selectedDistrict && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-xs p-4">
          <div className="w-full max-w-xl rounded-2xl bg-white p-6 shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-4 border-b border-slate-100">
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-lg bg-emerald-50 text-emerald-700">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900">
                    Issue Statutory Inspection Directive
                  </h3>
                  <p className="text-xs text-slate-500">
                    State Nodal Office &bull; {selectedDistrict.district_name} ({selectedDistrict.district_code})
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedDistrict(null)}
                className="p-1 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {successDirective ? (
              <div className="py-6 space-y-4">
                <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-4 text-emerald-900">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
                    <h4 className="font-bold text-sm">Directive Order Successfully Dispatched!</h4>
                  </div>
                  <p className="text-xs text-emerald-800 leading-relaxed mt-1">
                    {successDirective.message}
                  </p>
                  <div className="mt-3 pt-3 border-t border-emerald-200/60 text-xs font-mono space-y-1">
                    <div>
                      <span className="text-emerald-700">Docket Ref:</span>{" "}
                      <strong>{successDirective.reference}</strong>
                    </div>
                    <div>
                      <span className="text-emerald-700">Compliance Deadline:</span>{" "}
                      <strong>
                        {new Date(successDirective.deadline).toLocaleDateString("en-IN", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </strong>
                    </div>
                  </div>
                </div>

                <p className="text-xs text-slate-500">
                  This directive has been transmitted directly to the District Magistrate / DC Office via the SAMARTH AI official notification bus and recorded in the State Administrative Audit Registry.
                </p>

                <Button
                  onClick={() => setSelectedDistrict(null)}
                  className="w-full bg-slate-900 hover:bg-slate-800 text-white"
                >
                  Close & Return to Audit
                </Button>
              </div>
            ) : (
              <form onSubmit={handleIssueDirective} className="space-y-4 pt-4">
                {/* District Overview Box */}
                <div className="rounded-xl bg-slate-50 p-3.5 border border-slate-200 text-xs space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Target District:</span>
                    <strong className="text-slate-900 font-bold">
                      {selectedDistrict.district_name} ({selectedDistrict.district_code})
                    </strong>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Statutory Quota (10%):</span>
                    <strong className="text-slate-900 font-semibold">
                      {selectedDistrict.mandatory_quota_10pct} Works
                    </strong>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Inspections Completed:</span>
                    <span className="font-bold text-emerald-700">
                      {selectedDistrict.completed_inspections} Works ({selectedDistrict.inspection_rate_pct}%)
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-slate-500">Current Deficit:</span>
                    <span
                      className={`font-bold ${
                        selectedDistrict.deficit_count > 0 ? "text-rose-600" : "text-emerald-700"
                      }`}
                    >
                      {selectedDistrict.deficit_count > 0
                        ? `${selectedDistrict.deficit_count} Works Pending`
                        : "0 Works (Quota Achieved)"}
                    </span>
                  </div>
                </div>

                {/* Directive Parameters */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Statutory Compliance Deadline (Days)
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {[15, 30, 45, 60].map((days) => (
                      <button
                        key={days}
                        type="button"
                        onClick={() => setDeadlineDays(days)}
                        className={`py-2 text-xs font-bold rounded-lg border transition-all ${
                          deadlineDays === days
                            ? "bg-emerald-600 text-white border-emerald-600 shadow-xs"
                            : "bg-white text-slate-700 border-slate-200 hover:bg-slate-50"
                        }`}
                      >
                        {days} Days
                      </button>
                    ))}
                  </div>
                </div>

                {/* Priority Note & Order Instructions */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1.5">
                    Directive Instructions & Priority Mandate
                  </label>
                  <textarea
                    rows={4}
                    value={priorityNote}
                    onChange={(e) => setPriorityNote(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 p-3 text-xs text-slate-800 focus:outline-hidden focus:ring-2 focus:ring-emerald-500 font-sans"
                    placeholder="Provide official directives, required coverage sectors, and compliance instructions..."
                    required
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Pursuant to MoSPI MPLADS Guidelines 2023, Para 6.2 & SNO Administrative Rules.
                  </p>
                </div>

                {/* Legal Certification Warning */}
                <div className="rounded-lg bg-amber-50 border border-amber-200/80 p-3 text-[11px] text-amber-800 leading-relaxed">
                  <strong>Administrative Notice:</strong> Dispatching this directive initiates a formal compliance tracking ticket for the District Magistrate / DC office. Failure to resolve the deficit by the deadline will trigger automatic escalation to the Central Ministry (MoSPI).
                </div>

                {errorDirective && (
                  <div className="rounded-lg bg-rose-50 border border-rose-200 p-3 text-rose-800 font-semibold flex items-center gap-2 text-xs">
                    <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" />
                    <span>{errorDirective}</span>
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setSelectedDistrict(null);
                      setErrorDirective(null);
                    }}
                    disabled={submitting}
                    className="text-xs"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={submitting}
                    className="bg-emerald-700 hover:bg-emerald-800 text-white text-xs font-bold gap-2"
                  >
                    {submitting ? (
                      <>
                        <div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                        Authorizing Directive...
                      </>
                    ) : (
                      <>
                        <Send className="h-3.5 w-3.5" />
                        Dispatch Statutory Directive Order
                      </>
                    )}
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
