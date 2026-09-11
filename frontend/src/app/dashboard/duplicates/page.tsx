"use client";

import { useAuth } from "@/lib/auth";
import {
  DuplicateClusterListResponse,
  DuplicateMatch,
  DuplicateMatchListResponse,
  DuplicateMatchStatus,
  formatDateTime,
} from "@/lib/api";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState, ErrorState, EmptyState } from "@/components/ui/states";
import { AlertCircle, CheckCircle2, ChevronRight, Copy, RefreshCw, Sparkles } from "lucide-react";

const API_BASE = "/api/v1/duplicates";

const STATUS_LABELS: Record<DuplicateMatchStatus, string> = {
  pending_review: "Pending Review",
  case_created: "Case Created",
  marked_not_duplicate: "Marked Not Duplicate",
  field_verification_requested: "Field Verification Requested",
};

export default function DuplicateExplorerPage() {
  const { user, fetchWithAuth, isLoading: authLoading } = useAuth();
  const router = useRouter();

  const [matches, setMatches] = useState<DuplicateMatch[]>([]);
  const [clusters, setClusters] = useState<DuplicateClusterListResponse | null>(null);
  const [scan, setScan] = useState<DuplicateMatchListResponse["scan"]>(null);
  const [status, setStatus] = useState<"" | DuplicateMatchStatus>("");
  const [minimumScore, setMinimumScore] = useState("0");

  const [isLoading, setIsLoading] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanSuccess, setScanSuccess] = useState<string | null>(null);

  const canWrite = Boolean(user && ["admin", "district_authority"].includes(user.role));

  const loadExplorer = useCallback(async () => {
    setIsLoading(true);
    setPageError(null);
    const params = new URLSearchParams({ page: "1", page_size: "100", min_similarity_score: minimumScore || "0" });
    if (status) params.set("status", status);

    try {
      const [matchesResponse, clustersResponse] = await Promise.all([
        fetchWithAuth(`${API_BASE}?${params.toString()}`),
        fetchWithAuth(`${API_BASE}/clusters`),
      ]);

      if (matchesResponse.status === 403 || clustersResponse.status === 403) {
        setPageError("PERMISSION_DENIED");
        return;
      }

      if (!matchesResponse.ok) {
        const data = await matchesResponse.json().catch(() => ({ detail: "Could not load possible duplicate works." }));
        throw new Error(data.detail || "Could not load possible duplicate works.");
      }

      const payload: DuplicateMatchListResponse = await matchesResponse.json();
      setMatches(payload.matches || []);
      setScan(payload.scan);

      if (clustersResponse.ok) {
        setClusters(await clustersResponse.json());
      }
    } catch (cause: unknown) {
      setPageError(cause instanceof Error ? cause.message : "Could not load possible duplicate works.");
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth, minimumScore, status]);

  useEffect(() => {
    if (authLoading || !user) return;
    const timer = window.setTimeout(() => { void loadExplorer(); }, 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, loadExplorer, user]);

  async function runScan() {
    setIsScanning(true);
    setScanError(null);
    setScanSuccess(null);

    try {
      const response = await fetchWithAuth(`${API_BASE}/scan`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });

      if (response.status === 403) {
        setScanError("Your role does not have permission to run duplicate detection.");
        return;
      }

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ detail: "Could not run detection scan." }));
        throw new Error(payload.detail || "Could not run detection scan.");
      }

      const scanResult = await response.json();
      setScanSuccess(`Scan completed successfully! ${scanResult.matches_created || 0} candidate matches identified across ${scanResult.works_evaluated || 0} evaluated works.`);
      await loadExplorer();
    } catch (cause: unknown) {
      setScanError(cause instanceof Error ? cause.message : "Could not run detection scan.");
    } finally {
      setIsScanning(false);
    }
  }

  if (authLoading) return <LoadingState label="Loading duplicate work explorer..." />;
  if (!user) return null;

  if (pageError === "PERMISSION_DENIED") {
    return (
      <div className="space-y-6">
        <PageHeader title="Possible Duplicate Works" description="Investigate spatial, textual, and contractor similarities." />
        <ErrorState title="Access Restricted" description="Your role does not have access to duplicate work investigations." />
      </div>
    );
  }

  if (pageError) {
    return (
      <div className="space-y-6">
        <PageHeader title="Possible Duplicate Works" description="Investigate spatial, textual, and contractor similarities." />
        <ErrorState title="Error Loading Duplicate Explorer" description={pageError} onRetry={() => void loadExplorer()} />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="Possible Duplicate Works"
        description="Explainable TF-IDF text similarity, Haversine geospatial proximity, and vendor relationship matching from scoped MongoDB records."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => void loadExplorer()} disabled={isLoading || isScanning}>
              <RefreshCw className={"mr-2 h-4 w-4 " + (isLoading ? "animate-spin" : "")} />
              Refresh
            </Button>
            {canWrite && (
              <Button size="sm" onClick={() => void runScan()} disabled={isScanning} className="bg-sky-700 hover:bg-sky-800 text-white">
                <Sparkles className={"mr-2 h-4 w-4 " + (isScanning ? "animate-spin" : "")} />
                {isScanning ? "Running Detection..." : "Run Detection Scan"}
              </Button>
            )}
          </div>
        }
      />

      {/* Dismissible Scan Alert Banners */}
      {scanError && (
        <div className="flex items-center justify-between rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <div className="flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" />
            <span>{scanError}</span>
          </div>
          <button onClick={() => setScanError(null)} className="text-xs font-semibold hover:underline">Dismiss</button>
        </div>
      )}

      {scanSuccess && (
        <div className="flex items-center justify-between rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
            <span>{scanSuccess}</span>
          </div>
          <button onClick={() => setScanSuccess(null)} className="text-xs font-semibold hover:underline">Dismiss</button>
        </div>
      )}

      {/* Advisory Banner */}
      <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 text-xs text-blue-950 leading-relaxed">
        <strong>Advisory: Possible Duplicate Work — Manual Verification Required.</strong> AI and heuristic detection is a prioritisation aid; compare the underlying records, expenditure vouchers, and geo-tagged photos before initiating formal disciplinary review.
      </div>

      {/* Scan Summary Cards */}
      {scan && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Card className="border-slate-200 bg-white shadow-xs p-4">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Works Evaluated</span>
            <div className="mt-1 text-2xl font-bold text-slate-900">{scan.works_evaluated.toLocaleString()}</div>
          </Card>
          <Card className="border-slate-200 bg-white shadow-xs p-4">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Possible Matches</span>
            <div className="mt-1 text-2xl font-bold text-amber-600">{scan.matches_created.toLocaleString()}</div>
          </Card>
          <Card className="border-slate-200 bg-white shadow-xs p-4">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Clusters Identified</span>
            <div className="mt-1 text-2xl font-bold text-indigo-600">{scan.clusters_created.toLocaleString()}</div>
          </Card>
          <Card className="border-slate-200 bg-white shadow-xs p-4">
            <span className="text-xs font-medium text-slate-500 uppercase tracking-wider">Last Scan Executed</span>
            <div className="mt-1 text-sm font-semibold text-slate-700">{formatDateTime(scan.created_at)}</div>
          </Card>
        </div>
      )}

      {/* Clusters Card */}
      {clusters && clusters.clusters && clusters.clusters.length > 0 && (
        <Card className="border-slate-200 bg-white shadow-xs">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-900 flex items-center gap-2">
              <Copy className="h-4 w-4 text-blue-600" />
              Detected Project Clusters ({clusters.clusters.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {clusters.clusters.slice(0, 10).map((cluster, idx) => (
                <Badge key={cluster.cluster_id} variant="secondary" className="bg-blue-50 text-blue-800 border-blue-200 py-1 px-2.5">
                  Cluster {idx + 1}: {cluster.work_ids.length} works · {cluster.cluster_similarity_score.toFixed(1)}% score
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Filters Card */}
      <Card className="border-slate-200 bg-white shadow-xs p-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-600">Review Status:</label>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as "" | DuplicateMatchStatus)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-sky-500 focus:outline-none"
            >
              <option value="">All Review States</option>
              {Object.entries(STATUS_LABELS).map(([val, lbl]) => (
                <option key={val} value={val}>{lbl}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-600">Min Similarity Score:</label>
            <select
              value={minimumScore}
              onChange={(e) => setMinimumScore(e.target.value)}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs text-slate-800 focus:border-sky-500 focus:outline-none"
            >
              <option value="0">All Scores (0+)</option>
              <option value="60">60% and above</option>
              <option value="80">80% and above</option>
              <option value="90">90% and above</option>
            </select>
          </div>
        </div>
      </Card>

      {/* Matches Explorer Table */}
      {isLoading ? (
        <LoadingState label="Loading possible duplicate works..." />
      ) : matches.length === 0 ? (
        <EmptyState
          title="No possible duplicates found"
          description={!scan ? "No scan has been run yet. Click 'Run Detection Scan' above to evaluate projects in your jurisdiction." : "No duplicate candidates match your selected filters."}
          action={
            !scan ? (
              <Button size="sm" onClick={() => void runScan()} disabled={isScanning} className="bg-sky-700 text-white">
                <Sparkles className="mr-2 h-4 w-4" />
                Run Detection Scan
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="border-sky-100 bg-white shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-900">
              Candidate Explorer ({matches.length} matches found)
            </h2>
            <span className="text-xs text-slate-500">Sorted by similarity score</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="border-b border-slate-100 bg-slate-50/80 text-slate-600 font-semibold uppercase tracking-wider text-[11px]">
                  <th className="p-3">Work Project A</th>
                  <th className="p-3">Work Project B</th>
                  <th className="p-3">Similarity Score</th>
                  <th className="p-3">Distance</th>
                  <th className="p-3">Cost Diff</th>
                  <th className="p-3">Timeline</th>
                  <th className="p-3">Review Status</th>
                  <th className="p-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {matches.map((item) => (
                  <tr key={item.match_id} className="hover:bg-slate-50 transition-colors">
                    <td className="p-3 max-w-[200px]">
                      <strong className="block text-slate-900 text-xs truncate" title={item.left_work_title}>
                        {item.left_work_title || item.left_work_id}
                      </strong>
                      <span className="font-mono text-[10px] text-slate-400">{item.left_work_id.slice(0, 10)}…</span>
                    </td>
                    <td className="p-3 max-w-[200px]">
                      <strong className="block text-slate-900 text-xs truncate" title={item.right_work_title}>
                        {item.right_work_title || item.right_work_id}
                      </strong>
                      <span className="font-mono text-[10px] text-slate-400">{item.right_work_id.slice(0, 10)}…</span>
                    </td>
                    <td className="p-3">
                      <div className="flex items-center gap-1.5">
                        <Badge
                          variant="secondary"
                          className={
                            item.similarity_score >= 80
                              ? "bg-rose-100 text-rose-800 border-rose-200"
                              : item.similarity_score >= 60
                              ? "bg-amber-100 text-amber-800 border-amber-200"
                              : "bg-blue-100 text-blue-800 border-blue-200"
                          }
                        >
                          {item.similarity_score.toFixed(1)}%
                        </Badge>
                      </div>
                      <span className="text-[10px] text-slate-400 block mt-0.5">
                        {(item.text_similarity * 100).toFixed(0)}% text match
                      </span>
                    </td>
                    <td className="p-3 text-slate-600">
                      {item.distance_meters === null ? (
                        <span className="text-slate-400">N/A</span>
                      ) : (
                        <span>{item.distance_meters.toFixed(0)}m</span>
                      )}
                    </td>
                    <td className="p-3 text-slate-600">
                      {item.cost_difference_pct === null ? (
                        <span className="text-slate-400">N/A</span>
                      ) : (
                        <span>{item.cost_difference_pct.toFixed(1)}%</span>
                      )}
                    </td>
                    <td className="p-3 text-slate-600">
                      {item.timeline_overlap ? (
                        <span className="text-amber-700">{item.timeline_overlap_days ?? 0}d overlap</span>
                      ) : item.same_financial_year ? (
                        <span>Same FY</span>
                      ) : (
                        <span className="text-slate-400">Separate</span>
                      )}
                    </td>
                    <td className="p-3">
                      <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200 text-[11px]">
                        {STATUS_LABELS[item.status] || item.status}
                      </Badge>
                    </td>
                    <td className="p-3 text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => router.push(`/dashboard/duplicates/${item.match_id}`)}
                        className="text-xs"
                      >
                        Compare
                        <ChevronRight className="ml-1 h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
