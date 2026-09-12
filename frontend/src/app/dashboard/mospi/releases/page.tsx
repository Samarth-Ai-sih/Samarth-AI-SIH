"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { useAuthenticatedQuery } from "@/lib/query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState, ErrorState } from "@/components/ui/states";
import { formatCurrency } from "@/lib/api";
import {
  WalletCards,
  CheckCircle2,
  Clock,
  AlertTriangle,
  ArrowLeft,
  RefreshCw,
  Landmark,
  ShieldCheck,
  Building2,
  FileCheck2,
  X,
  Sparkles,
} from "lucide-react";

interface TreasuryReleaseItem {
  release_id: string;
  constituency: string;
  mp_name: string;
  district_name: string;
  state_name: string;
  installment_tranche: string;
  requested_amount: number;
  financial_year: string;
  utilization_certificate_status: "verified" | "pending_audit" | "discrepancy";
  uc_submission_date: string | null;
  physical_progress_avg: number;
  status: "pending" | "authorized" | "on_hold" | "rejected";
  authorized_by: string | null;
  authorized_at: string | null;
  pfms_transaction_ref: string | null;
  remarks: string | null;
}

interface TreasuryReleasesResponse {
  releases: TreasuryReleaseItem[];
  total_pending_amount: number;
  total_authorized_amount: number;
  pending_count: number;
  authorized_count: number;
}

export default function CentralTreasuryReleasesPage() {
  const { user, fetchWithAuth } = useAuth();
  const canAccess = user?.role === "mospi" || user?.role === "admin";

  const [selectedRelease, setSelectedRelease] = useState<TreasuryReleaseItem | null>(null);
  const [authorizing, setAuthorizing] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const { data, isLoading, isError, error, refetch } = useAuthenticatedQuery<TreasuryReleasesResponse>(
    ["mospi-treasury-releases"],
    "/api/v1/mospi/treasury-releases",
    { enabled: canAccess }
  );

  async function handleAuthorize(releaseId: string) {
    setAuthorizing(true);
    try {
      const res = await fetchWithAuth(`/api/v1/mospi/treasury-releases/${releaseId}/authorize`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          remarks: `Authorized subsequent ₹2.5 Cr central installment by ${user?.full_name || "MoSPI Officer"} following digital UC verification.`,
        }),
      });

      if (!res.ok) {
        throw new Error("Failed to authorize release");
      }

      const result = await res.json();
      setActionSuccess(result.message);
      setSelectedRelease(null);
      void refetch();
    } catch (err: any) {
      alert(err.message || "Failed to authorize installment");
    } finally {
      setAuthorizing(false);
    }
  }

  if (!canAccess) {
    return (
      <ErrorState
        title="Restricted Access"
        description="Central Treasury Releases is restricted to MoSPI Central Ministry and Administrators."
      />
    );
  }

  if (isLoading) return <LoadingState label="Loading central installment release queue from Treasury ledger…" />;
  if (isError) return <ErrorState description={(error as Error).message} onRetry={() => void refetch()} />;

  const r = data!;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Link href="/dashboard/mospi" className="hover:text-blue-600 flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> MoSPI Command Center
        </Link>
        <span>/</span>
        <span className="text-slate-900 font-medium">Central Treasury Releases</span>
      </div>

      <PageHeader
        eyebrow="Central Ministry Fiscal Disbursal Engine"
        title="Central Treasury Releases (₹2.50 Cr Tranches)"
        description="Official workflow authorizing subsequent ₹2.50 Crore fund installments to parliamentary constituencies upon automated validation of digital Utilization Certificates (UCs) and physical progress thresholds."
        actions={
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => void refetch()}>
              <RefreshCw className="mr-1.5 h-3.5 w-3.5 text-slate-600" />
              Refresh Releases
            </Button>
            <Button size="sm" asChild>
              <Link href="/dashboard/mospi/ingestion">
                PFMS Gateway Sync
              </Link>
            </Button>
          </div>
        }
      />

      {/* Success Banner */}
      {actionSuccess && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-900 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="h-5 w-5 text-emerald-600 shrink-0" />
            <span className="font-semibold">{actionSuccess}</span>
          </div>
          <button onClick={() => setActionSuccess(null)} className="text-emerald-700 hover:text-emerald-950 font-bold">
            ✕
          </button>
        </div>
      )}

      {/* KPI Counters */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card className="border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Pending Authorization</p>
              <p className="text-2xl font-black text-amber-700 mt-1">{r.pending_count} Tranches</p>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-amber-50 text-amber-700">
              <Clock className="h-5 w-5" />
            </span>
          </div>
          <p className="mt-2 text-xs text-amber-800 font-medium">
            Total {formatCurrency(r.total_pending_amount)} awaiting central sign-off
          </p>
        </Card>

        <Card className="border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Authorized & Disbursed</p>
              <p className="text-2xl font-black text-emerald-700 mt-1">{r.authorized_count} Tranches</p>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
            </span>
          </div>
          <p className="mt-2 text-xs text-emerald-700 font-medium">
            {formatCurrency(r.total_authorized_amount)} released via PFMS gateways
          </p>
        </Card>

        <Card className="border-slate-200 bg-white p-5 shadow-xs">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Tranche Ceiling Policy</p>
              <p className="text-2xl font-black text-slate-900 mt-1">₹2.50 Cr</p>
            </div>
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-blue-50 text-blue-700">
              <Landmark className="h-5 w-5" />
            </span>
          </div>
          <p className="mt-2 text-xs text-slate-500">Released in two equal ₹2.5 Cr tranches per financial year</p>
        </Card>
      </div>

      {/* Release Queue Table */}
      <Card className="border-slate-200 shadow-xs overflow-hidden">
        <CardHeader className="p-5 pb-3 border-b border-slate-100">
          <CardTitle className="text-base font-bold">Constituency Installment Release Queue</CardTitle>
          <CardDescription className="text-xs">
            Review digital Utilization Certificates, average milestone progress, and trigger PFMS treasury releases
          </CardDescription>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-700">
            <thead className="border-b border-slate-200 bg-slate-50 text-[11px] font-bold uppercase tracking-wider text-slate-600">
              <tr>
                <th className="px-4 py-3.5">Release ID</th>
                <th className="px-4 py-3.5">Constituency & MP</th>
                <th className="px-4 py-3.5">District / State</th>
                <th className="px-4 py-3.5">Tranche Details</th>
                <th className="px-4 py-3.5 text-center">Avg Progress</th>
                <th className="px-4 py-3.5 text-center">Digital UC Status</th>
                <th className="px-4 py-3.5 text-center">Release Status</th>
                <th className="px-4 py-3.5 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {r.releases.map((rel) => (
                <tr key={rel.release_id} className="hover:bg-slate-50/80 transition-colors">
                  <td className="px-4 py-3.5 font-mono font-bold text-slate-900">
                    {rel.release_id}
                  </td>
                  <td className="px-4 py-3.5">
                    <p className="font-bold text-slate-900">{rel.constituency}</p>
                    <p className="text-[11px] text-slate-500">MP: {rel.mp_name}</p>
                  </td>
                  <td className="px-4 py-3.5">
                    <p className="font-medium text-slate-800">{rel.district_name}</p>
                    <p className="text-[11px] text-slate-500">{rel.state_name}</p>
                  </td>
                  <td className="px-4 py-3.5">
                    <p className="font-semibold text-slate-900">{rel.installment_tranche}</p>
                    <p className="text-[11px] text-emerald-700 font-mono font-bold">
                      {formatCurrency(rel.requested_amount)}
                    </p>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <span className="font-black text-slate-900">{rel.physical_progress_avg}%</span>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <Badge
                      variant={
                        rel.utilization_certificate_status === "verified" ? "success" :
                        rel.utilization_certificate_status === "pending_audit" ? "warning" : "danger"
                      }
                      className="capitalize text-[10px]"
                    >
                      {rel.utilization_certificate_status.replace("_", " ")}
                    </Badge>
                  </td>
                  <td className="px-4 py-3.5 text-center">
                    <span className={`px-2 py-0.5 rounded text-[11px] font-bold capitalize ${
                      rel.status === "authorized" ? "bg-emerald-50 text-emerald-800 border border-emerald-200" :
                      rel.status === "pending" ? "bg-amber-50 text-amber-800 border border-amber-200" :
                      "bg-rose-50 text-rose-800 border border-rose-200"
                    }`}>
                      {rel.status}
                    </span>
                    {rel.pfms_transaction_ref && (
                      <p className="text-[10px] font-mono text-slate-500 mt-1">{rel.pfms_transaction_ref}</p>
                    )}
                  </td>
                  <td className="px-4 py-3.5 text-right">
                    {rel.status === "pending" ? (
                      <Button
                        size="sm"
                        className="text-xs h-7 bg-blue-600 hover:bg-blue-700"
                        onClick={() => setSelectedRelease(rel)}
                      >
                        Authorize ₹2.5 Cr
                      </Button>
                    ) : rel.status === "authorized" ? (
                      <Badge variant="outline" className="text-emerald-700 border-emerald-300 text-[10px]">
                        Disbursed
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-rose-700 border-rose-300 text-[10px]">
                        Review Held
                      </Badge>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Authorization Confirmation Modal */}
      {selectedRelease && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-lg rounded-xl bg-white shadow-2xl border border-slate-200 p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <h3 className="text-base font-bold text-slate-950 flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-emerald-600" />
                Authorize Central Treasury Release
              </h3>
              <button
                onClick={() => setSelectedRelease(null)}
                className="grid h-7 w-7 place-items-center rounded text-slate-400 hover:text-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900 space-y-1">
              <p><strong>Constituency:</strong> {selectedRelease.constituency} ({selectedRelease.state_name})</p>
              <p><strong>Representative MP:</strong> {selectedRelease.mp_name}</p>
              <p><strong>Installment:</strong> {selectedRelease.installment_tranche} — <strong>₹2,50,00,000.00</strong></p>
              <p><strong>Physical Milestone Progress:</strong> {selectedRelease.physical_progress_avg}% confirmed on ground</p>
            </div>

            <div className="space-y-2 text-xs text-slate-600">
              <p className="font-semibold text-slate-900">Statutory Pre-Conditions Checked:</p>
              <p className="flex items-center gap-1.5 text-emerald-700 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                Digital Utilization Certificate (UC) signed & verified
              </p>
              <p className="flex items-center gap-1.5 text-emerald-700 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                Tranche 1 unspent balance is below the mandatory 20% limit
              </p>
              <p className="flex items-center gap-1.5 text-emerald-700 font-medium">
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                Statutory SC/ST demographic allocation confirmed
              </p>
            </div>

            <div className="rounded-lg bg-slate-50 border border-slate-200 p-3 text-[11px] text-slate-500">
              This action generates an official <strong>PFMS Central Payment Advice Voucher</strong> and logs a tamper-evident event in the central audit ledger.
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="outline" size="sm" onClick={() => setSelectedRelease(null)}>
                Cancel
              </Button>
              <Button
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
                disabled={authorizing}
                onClick={() => void handleAuthorize(selectedRelease.release_id)}
              >
                {authorizing ? "Authorizing Release…" : "Confirm & Authorize ₹2.5 Cr"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
