"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { ErrorState } from "@/components/ui/states";
import {
  Database,
  RefreshCw,
  CheckCircle2,
  ArrowLeft,
  Building2,
  Landmark,
  Upload,
  FileSpreadsheet,
  Layers,
  Sparkles,
  ShieldCheck,
} from "lucide-react";

interface SyncResult {
  portal: string;
  count: number;
  refId: string;
  time: string;
  message: string;
}

export default function NationalDataIngestionPage() {
  const { user, fetchWithAuth } = useAuth();
  const canAccess = user?.role === "mospi" || user?.role === "admin";

  const [syncing, setSyncing] = useState<string | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function triggerSync(portal: "pfms" | "esakshi" | "all") {
    setSyncing(portal);
    setError(null);
    try {
      const res = await fetchWithAuth("/api/v1/mospi/sync-portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ target_portal: portal }),
      });

      if (!res.ok) {
        throw new Error(`Sync failed with HTTP ${res.status}`);
      }

      const data = await res.json();
      setSyncResult({
        portal: portal.toUpperCase(),
        count: data.synced_records_count,
        refId: data.sync_reference_id,
        time: data.sync_timestamp,
        message: data.message,
      });
    } catch (err: any) {
      setError(err.message || "Failed to synchronize with gateway");
    } finally {
      setSyncing(null);
    }
  }

  if (!canAccess) {
    return (
      <ErrorState
        title="Restricted Access"
        description="National Ingestion is restricted to MoSPI Central Ministry and Administrators."
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2 text-xs text-slate-500">
        <Link href="/dashboard/mospi" className="hover:text-blue-600 flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> MoSPI Command Center
        </Link>
        <span>/</span>
        <span className="text-slate-900 font-medium">Bulk Data Ingestion</span>
      </div>

      <PageHeader
        eyebrow="National Infrastructure Gateway Synchronization"
        title="Bulk Data Ingestion & Portal Synchronization"
        description="Secure interoperability gateways synchronizing master allocation records, expenditure vouchers, and parliamentary works between SAMARTH AI and Government of India systems (PFMS & eSAKSHI)."
        actions={
          <div className="flex gap-2">
            <Button size="sm" asChild>
              <Link href="/dashboard/admin/datasets">
                <FileSpreadsheet className="mr-1.5 h-3.5 w-3.5" />
                Open Batch CSV Manager
              </Link>
            </Button>
          </div>
        }
      />

      {/* Sync Success Receipt */}
      {syncResult && (
        <Card className="border-emerald-200 bg-emerald-50/70 p-5 animate-in fade-in">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-emerald-100 text-emerald-800">
                <CheckCircle2 className="h-5 w-5" />
              </span>
              <div>
                <h4 className="text-sm font-bold text-emerald-950">
                  {syncResult.portal} Central Gateway Synchronized Successfully
                </h4>
                <p className="text-xs text-emerald-800 mt-0.5">{syncResult.message}</p>
                <div className="flex flex-wrap gap-4 mt-2 text-[11px] text-emerald-900 font-medium">
                  <span><strong>Records In Scope:</strong> {syncResult.count.toLocaleString("en-IN")} works</span>
                  <span><strong>Audit Ref ID:</strong> <code className="font-mono bg-emerald-100/80 px-1 py-0.5 rounded">{syncResult.refId}</code></span>
                  <span><strong>Synced At:</strong> {new Date(syncResult.time).toLocaleTimeString()}</span>
                </div>
              </div>
            </div>
            <button
              onClick={() => setSyncResult(null)}
              className="text-emerald-700 hover:text-emerald-950 text-xs font-bold"
            >
              Dismiss
            </button>
          </div>
        </Card>
      )}

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-xs text-rose-900 flex items-center justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="font-bold">✕</button>
        </div>
      )}

      {/* Two Main National Gateways */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* PFMS Gateway */}
        <Card className="border-slate-200 hover:border-blue-300 transition-all shadow-xs">
          <CardHeader className="p-5 pb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-blue-50 text-blue-700 border border-blue-200">
                <Landmark className="h-6 w-6" />
              </span>
              <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-800 border-emerald-200">
                Live Gateway Ready
              </Badge>
            </div>
            <CardTitle className="text-base font-bold">PFMS (Public Financial Management System)</CardTitle>
            <CardDescription className="text-xs leading-relaxed">
              Ministry of Finance central accounting gateway. Synchronizes treasury voucher numbers, tranche drawdowns, and bank reconciliation statements.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5 pt-0 space-y-4">
            <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-xs text-slate-600 space-y-1">
              <p>• <strong>Frequency:</strong> Real-time REST webhook + Daily batch settlement</p>
              <p>• <strong>Payloads:</strong> Installment releases, payment vouchers, bank ledgers</p>
            </div>

            <Button
              className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs"
              disabled={syncing !== null}
              onClick={() => void triggerSync("pfms")}
            >
              {syncing === "pfms" ? (
                <>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Synchronizing with PFMS…
                </>
              ) : (
                <>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Trigger Live PFMS Gateway Sync
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* eSAKSHI Gateway */}
        <Card className="border-slate-200 hover:border-purple-300 transition-all shadow-xs">
          <CardHeader className="p-5 pb-3">
            <div className="flex items-center justify-between mb-2">
              <span className="grid h-11 w-11 place-items-center rounded-xl bg-purple-50 text-purple-700 border border-purple-200">
                <Building2 className="h-6 w-6" />
              </span>
              <Badge variant="outline" className="text-xs bg-emerald-50 text-emerald-800 border-emerald-200">
                Live Gateway Ready
              </Badge>
            </div>
            <CardTitle className="text-base font-bold">eSAKSHI (MoSPI Scheme Portal)</CardTitle>
            <CardDescription className="text-xs leading-relaxed">
              Official MoSPI web portal for MPLADS project tracking. Synchronizes parliamentary proposals, administrative sanctions, and implementing agencies.
            </CardDescription>
          </CardHeader>
          <CardContent className="p-5 pt-0 space-y-4">
            <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-xs text-slate-600 space-y-1">
              <p>• <strong>Frequency:</strong> Scheduled nightly synchronization + Manual on-demand pull</p>
              <p>• <strong>Payloads:</strong> MP recommendations, sanction orders, agency assignments</p>
            </div>

            <Button
              className="w-full bg-purple-600 hover:bg-purple-700 text-white text-xs"
              disabled={syncing !== null}
              onClick={() => void triggerSync("esakshi")}
            >
              {syncing === "esakshi" ? (
                <>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Synchronizing with eSAKSHI…
                </>
              ) : (
                <>
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Trigger Live eSAKSHI Portal Sync
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* CSV Batch Upload Fallback Section */}
      <Card className="border-slate-200 bg-white shadow-xs">
        <CardHeader className="p-5 pb-3">
          <CardTitle className="text-base font-bold flex items-center gap-2">
            <Upload className="h-4 w-4 text-blue-600" />
            Batch CSV Ingestion & Historical Master Upload
          </CardTitle>
          <CardDescription className="text-xs">
            For districts with legacy records or offline reporting, upload master CSV exports for automated schema validation and deduplication.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-5 pt-0">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 p-4 rounded-xl border border-dashed border-slate-300 bg-slate-50/60">
            <div className="flex items-center gap-3">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-white border border-slate-200 text-slate-600 shadow-2xs">
                <FileSpreadsheet className="h-5 w-5" />
              </span>
              <div>
                <p className="text-xs font-bold text-slate-900">Standard MPLADS Allocation CSV Format</p>
                <p className="text-[11px] text-slate-500">Supports Lok Sabha 16th/17th master ledgers, multi-year tranches, and GeoJSON coordinates</p>
              </div>
            </div>
            <Button asChild size="sm" variant="outline" className="shrink-0 text-xs">
              <Link href="/dashboard/admin/datasets">
                Open Full Ingestion Studio
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
