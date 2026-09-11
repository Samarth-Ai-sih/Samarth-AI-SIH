"use client";

import { useAuth } from "@/lib/auth";
import {
  CrossProjectDuplicateScan,
  EvidenceListResponse,
  EvidenceUploadSignature,
  EvidenceVerification,
  EvidenceVerificationLabel,
  formatDateTime,
} from "@/lib/api";
import { useRouter } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

const API_BASE = "/api/v1/evidence";
const WRITER_ROLES = new Set(["admin", "inspector"]);

const LABEL_COLOURS: Record<EvidenceVerificationLabel, { color: string; background: string; border: string }> = {
  "Verified metadata available": { color: "#15803d", background: "#f0fdf4", border: "#bbf7d0" },
  "Metadata unavailable — manual verification required": { color: "#b45309", background: "#fffbeb", border: "#fde68a" },
  "GPS mismatch — verification recommended": { color: "#c2410c", background: "#fff7ed", border: "#fed7aa" },
  "Timestamp inconsistency — verification recommended": { color: "#be185d", background: "#fdf2f8", border: "#fbcfe8" },
  "Possible reused evidence — manual verification required": { color: "#6d28d9", background: "#f5f3ff", border: "#ddd6fe" },
};

export default function EvidenceVerificationPage() {
  const { user, fetchWithAuth, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [records, setRecords] = useState<EvidenceVerification[]>([]);
  const [privacyNotice, setPrivacyNotice] = useState("");
  const [labelFilter, setLabelFilter] = useState<"" | EvidenceVerificationLabel>("");
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [workId, setWorkId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const canWrite = Boolean(user && WRITER_ROLES.has(user.role));

  const loadEvidence = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetchWithAuth(`${API_BASE}?page=1&page_size=100`);
      if (response.status === 403) {
        setError("PERMISSION_DENIED");
        return;
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ detail: "Could not load evidence verification." }));
        throw new Error(payload.detail || "Could not load evidence verification.");
      }
      const payload: EvidenceListResponse = await response.json();
      setRecords(payload.evidence);
      setPrivacyNotice(payload.privacy_notice);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not load evidence verification.");
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    if (authLoading || !user) return;
    const timer = window.setTimeout(() => { void loadEvidence(); }, 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, loadEvidence, user]);

  const filteredRecords = useMemo(
    () => labelFilter ? records.filter((record) => record.verification_labels.includes(labelFilter)) : records,
    [labelFilter, records],
  );

  async function submitUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file || !workId.trim()) {
      setError("Enter a work ID and choose an image before uploading.");
      return;
    }
    setIsUploading(true);
    setError(null);
    setMessage(null);
    try {
      const signatureResponse = await fetchWithAuth(`${API_BASE}/upload-signature`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ work_id: workId.trim(), filename: file.name, content_type: file.type || "image/jpeg" }),
      });
      if (!signatureResponse.ok) {
        const payload = await signatureResponse.json().catch(() => ({ detail: "Could not prepare the upload." }));
        throw new Error(payload.detail || "Could not prepare the upload.");
      }
      const ticket: EvidenceUploadSignature = await signatureResponse.json();
      if (ticket.storage_mode === "local_demo") {
        const body = new FormData();
        body.set("work_id", workId.trim());
        body.set("file", file);
        const localResponse = await fetchWithAuth(ticket.local_upload_endpoint || `${API_BASE}/local-upload`, { method: "POST", body });
        if (!localResponse.ok) {
          const payload = await localResponse.json().catch(() => ({ detail: "Could not upload local demo evidence." }));
          throw new Error(payload.detail || "Could not upload local demo evidence.");
        }
      } else {
        if (!ticket.upload_url || !ticket.api_key || !ticket.signature || !ticket.timestamp || !ticket.public_id) {
          throw new Error("The private upload signature is incomplete.");
        }
        const cloudinaryBody = new FormData();
        cloudinaryBody.set("file", file);
        cloudinaryBody.set("api_key", ticket.api_key);
        cloudinaryBody.set("timestamp", String(ticket.timestamp));
        cloudinaryBody.set("signature", ticket.signature);
        cloudinaryBody.set("public_id", ticket.public_id);
        cloudinaryBody.set("type", ticket.upload_type || "authenticated");
        const cloudinaryResponse = await fetch(ticket.upload_url, { method: "POST", body: cloudinaryBody });
        if (!cloudinaryResponse.ok) throw new Error("The private upload provider rejected the image.");
        const cloudinaryAsset = await cloudinaryResponse.json() as { public_id?: string };
        const completeResponse = await fetchWithAuth(ticket.completion_endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            work_id: workId.trim(), evidence_id: ticket.evidence_id,
            public_id: cloudinaryAsset.public_id || ticket.public_id,
            filename: file.name, content_type: file.type || "image/jpeg",
          }),
        });
        if (!completeResponse.ok) {
          const payload = await completeResponse.json().catch(() => ({ detail: "Could not complete evidence verification." }));
          throw new Error(payload.detail || "Could not complete evidence verification.");
        }
      }
      setMessage("Evidence verification completed. Private image data was not displayed.");
      setWorkId("");
      if (fileRef.current) fileRef.current.value = "";
      await loadEvidence();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Evidence upload failed.");
    } finally {
      setIsUploading(false);
    }
  }

  async function runScan() {
    setIsScanning(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetchWithAuth(`${API_BASE}/scan/cross-project`, { method: "POST" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({ detail: "Could not scan evidence." }));
        throw new Error(payload.detail || "Could not scan evidence.");
      }
      const result: CrossProjectDuplicateScan = await response.json();
      setMessage(`${result.records_scanned} evidence record(s) scanned; ${result.cross_project_matches} cross-project similarity signal(s) found.`);
      await loadEvidence();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not scan evidence.");
    } finally {
      setIsScanning(false);
    }
  }

  if (authLoading) return <PageSpinner />;
  if (!user) return <main style={styles.page}><p style={styles.muted}>Not authenticated. Redirecting…</p></main>;

  return <main style={styles.page}>
    <div style={styles.container}>
      <header style={styles.header}>
        <div>
          <button onClick={() => router.push("/dashboard")} style={styles.back}>← Dashboard</button>
          <p style={styles.eyebrow}>Phase 12 · Private review</p>
          <h1 style={styles.title}>Evidence verification</h1>
          <p style={styles.subtitle}>Server-side SHA-256, perceptual hash, EXIF, GPS, timestamp, project-distance, and cross-project image-reuse checks.</p>
        </div>
        <button style={styles.refresh} onClick={() => void loadEvidence()} disabled={isLoading}>Refresh</button>
      </header>

      <section style={styles.privacy}><strong>Private evidence boundary.</strong> {privacyNotice || "Evidence files and private metadata are never exposed in this view."}</section>

      {error === "PERMISSION_DENIED" ? <StatePanel icon="🔒" title="Evidence access is restricted" detail="Your role does not have permission to view private evidence or its verification metadata." /> : <>
        {canWrite && <section style={styles.uploadCard}>
          <div><h2 style={styles.sectionTitle}>Submit private evidence</h2><p style={styles.sectionDescription}>Cloudinary authenticated signed upload is used when configured; otherwise the controlled local demo store is used.</p></div>
          <div style={styles.uploadControls}>
            <input value={workId} onChange={(event) => setWorkId(event.target.value)} placeholder="Work ID" aria-label="Work ID" style={styles.input} />
            <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,image/tiff" aria-label="Evidence image" style={styles.fileInput} />
            <button onClick={() => void submitUpload()} disabled={isUploading} style={styles.primary}>{isUploading ? "Verifying…" : "Upload & verify"}</button>
            <button onClick={() => void runScan()} disabled={isScanning} style={styles.secondary}>{isScanning ? "Scanning…" : "Scan image reuse"}</button>
          </div>
        </section>}

        {message && <div style={styles.message}>{message}</div>}
        {error && <div style={styles.error}><span>{error}</span><button onClick={() => void loadEvidence()} style={styles.inlineButton}>Retry</button></div>}

        <section style={styles.filterRow}>
          <label style={styles.filterLabel}>Verification label
            <select value={labelFilter} onChange={(event) => setLabelFilter(event.target.value as "" | EvidenceVerificationLabel)} style={styles.select}>
              <option value="">All verification outcomes</option>
              {Object.keys(LABEL_COLOURS).map((label) => <option key={label} value={label}>{label}</option>)}
            </select>
          </label>
          <span style={styles.resultCount}>{filteredRecords.length} of {records.length} private verification record(s)</span>
        </section>

        {isLoading ? <LoadingRows /> : filteredRecords.length === 0 ? <StatePanel icon="◌" title="No evidence verification records" detail="Seed demo evidence with python -m scripts.seed_evidence, or upload a permitted image from this private review workspace." /> : <section style={styles.tableCard}>
          <div style={styles.tableWrap}><table style={styles.table}><thead><tr><th style={styles.th}>Work / evidence</th><th style={styles.th}>Verification</th><th style={styles.th}>Metadata</th><th style={styles.th}>GPS / time</th><th style={styles.th}>Traceability</th></tr></thead><tbody>{filteredRecords.map((record) => <EvidenceRow key={record.evidence_id} record={record} />)}</tbody></table></div>
        </section>}
      </>}
    </div>
    <style>{`@keyframes evidence-spin{to{transform:rotate(360deg)}} @keyframes evidence-shimmer{100%{background-position:-200% 0}} button:hover:not(:disabled){opacity:.86}`}</style>
  </main>;
}

function EvidenceRow({ record }: { record: EvidenceVerification }) {
  return <tr style={styles.tr}>
    <td style={styles.td}><strong>{record.work_id}</strong><span style={styles.id}>{record.evidence_id}</span><span style={styles.subtle}>{record.storage_mode === "cloudinary" ? "Authenticated provider" : "Local demo fallback"}</span></td>
    <td style={styles.td}><div style={styles.labels}>{record.verification_labels.map((label) => <span key={label} style={{ ...styles.label, ...LABEL_COLOURS[label] }}>{label}</span>)}</div>{record.possible_reused_evidence_count > 0 && <span style={styles.subtle}>{record.possible_reused_evidence_count} cross-project match signal(s)</span>}</td>
    <td style={styles.td}><strong>{record.metadata_available ? "Available" : "Unavailable"}</strong><span style={styles.subtle}>{record.exif_fields.length ? record.exif_fields.join(", ") : "No EXIF fields extracted"}</span></td>
    <td style={styles.td}><span>{record.gps_available ? (record.distance_from_project_meters === null ? "GPS extracted" : `${Math.round(record.distance_from_project_meters)}m from project`) : "GPS unavailable"}</span><span style={styles.subtle}>{record.captured_at ? `${record.timestamp_consistent === false ? "Inconsistent" : "Captured"}: ${formatDateTime(record.captured_at)}` : "Timestamp unavailable"}</span></td>
    <td style={styles.td}><span style={styles.hash}>{record.sha256_hash ? `SHA-256 ${record.sha256_hash.slice(0, 16)}…` : "SHA-256 unavailable"}</span><span style={styles.subtle}>{record.perceptual_hash ? `pHash ${record.perceptual_hash}` : "pHash unavailable"}</span><span style={styles.subtle}>Verified {formatDateTime(record.verified_at)}</span></td>
  </tr>;
}

function StatePanel({ icon, title, detail }: { icon: string; title: string; detail: string }) {
  return <section style={styles.panel}><span style={styles.panelIcon}>{icon}</span><h2 style={styles.panelTitle}>{title}</h2><p style={styles.panelDetail}>{detail}</p></section>;
}

function LoadingRows() { return <section style={styles.loadingCard}>{Array.from({ length: 6 }).map((_, index) => <div key={index} style={{ ...styles.skeleton, width: "100%" }} />)}</section>; }
function PageSpinner() { return <main style={styles.page}><div style={styles.spinner} /><style>{`@keyframes evidence-spin{to{transform:rotate(360deg)}}`}</style></main>; }

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", background: "#ffffff", padding: "1.5rem", fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' },
  container: { maxWidth: 1440, margin: "0 auto" },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", marginBottom: "1rem" },
  back: { padding: 0, border: 0, background: "transparent", color: "#475569", cursor: "pointer", fontSize: ".78rem" },
  eyebrow: { margin: ".8rem 0 .25rem", color: "#2563eb", fontSize: ".68rem", fontWeight: 700, letterSpacing: ".1em", textTransform: "uppercase" as const },
  title: { margin: 0, color: "#0f172a", fontSize: "clamp(1.7rem,3vw,2.25rem)", letterSpacing: "-.035em", fontWeight: 700 },
  subtitle: { maxWidth: 760, margin: ".45rem 0 0", color: "#64748b", lineHeight: 1.5, fontSize: ".86rem" },
  refresh: { border: "1px solid #cbd5e1", borderRadius: 8, background: "#ffffff", color: "#0f172a", cursor: "pointer", padding: ".55rem .8rem", fontSize: ".76rem", fontWeight: 600 },
  privacy: { padding: ".75rem .9rem", marginBottom: ".8rem", border: "1px solid #bfdbfe", borderRadius: 10, background: "#eff6ff", color: "#1e3a8a", fontSize: ".78rem", lineHeight: 1.5 },
  uploadCard: { display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "1rem", padding: ".9rem", marginBottom: ".75rem", border: "1px solid #e2e8f0", borderRadius: 12, background: "#f8fafc" },
  sectionTitle: { margin: 0, color: "#0f172a", fontSize: ".94rem", fontWeight: 700 },
  sectionDescription: { maxWidth: 590, margin: ".32rem 0 0", color: "#64748b", lineHeight: 1.45, fontSize: ".72rem" },
  uploadControls: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: ".45rem" },
  input: { width: 150, padding: ".5rem .58rem", color: "#0f172a", background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 7, fontSize: ".78rem" },
  fileInput: { maxWidth: 205, color: "#475569", fontSize: ".7rem" },
  primary: { border: "1px solid #2563eb", borderRadius: 7, padding: ".5rem .65rem", background: "#2563eb", color: "#ffffff", cursor: "pointer", fontSize: ".75rem", fontWeight: 700 },
  secondary: { border: "1px solid #cbd5e1", borderRadius: 7, padding: ".5rem .65rem", background: "#ffffff", color: "#0f172a", cursor: "pointer", fontSize: ".75rem", fontWeight: 600 },
  message: { marginBottom: ".75rem", padding: ".65rem .8rem", border: "1px solid #bbf7d0", borderRadius: 9, color: "#166534", background: "#f0fdf4", fontSize: ".78rem" },
  error: { display: "flex", justifyContent: "space-between", gap: ".75rem", marginBottom: ".75rem", padding: ".65rem .8rem", border: "1px solid #fecaca", borderRadius: 9, color: "#991b1b", background: "#fef2f2", fontSize: ".78rem" },
  inlineButton: { border: 0, background: "transparent", color: "#991b1b", cursor: "pointer", textDecoration: "underline" },
  filterRow: { display: "flex", alignItems: "end", justifyContent: "space-between", flexWrap: "wrap", gap: ".75rem", padding: ".68rem .78rem", marginBottom: ".75rem", border: "1px solid #e2e8f0", borderRadius: 11, background: "#f8fafc" },
  filterLabel: { display: "grid", gap: ".25rem", color: "#334155", fontSize: ".68rem", fontWeight: 700 },
  select: { minWidth: 275, padding: ".45rem .55rem", color: "#0f172a", background: "#ffffff", border: "1px solid #cbd5e1", borderRadius: 7, fontSize: ".75rem" },
  resultCount: { color: "#64748b", fontSize: ".72rem" },
  tableCard: { padding: ".9rem", border: "1px solid #e2e8f0", borderRadius: 14, background: "#ffffff", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" },
  tableWrap: { overflowX: "auto" }, table: { width: "100%", minWidth: 1100, borderCollapse: "collapse", fontSize: ".73rem" },
  th: { padding: ".5rem", textAlign: "left", color: "#475569", borderBottom: "1px solid #e2e8f0", background: "#f8fafc", fontSize: ".65rem", fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase" as const },
  tr: { borderBottom: "1px solid #e2e8f0" }, td: { padding: ".67rem .5rem", verticalAlign: "top", color: "#0f172a", lineHeight: 1.4 },
  id: { display: "block", marginTop: ".2rem", color: "#64748b", fontFamily: "monospace", fontSize: ".64rem" },
  subtle: { display: "block", marginTop: ".25rem", color: "#64748b", fontSize: ".67rem" },
  labels: { display: "flex", flexDirection: "column", alignItems: "flex-start", gap: ".28rem" },
  label: { display: "inline-block", padding: ".22rem .35rem", borderRadius: 5, border: "1px solid #e2e8f0", fontSize: ".65rem", fontWeight: 650 },
  hash: { display: "block", color: "#2563eb", fontFamily: "monospace", fontSize: ".66rem" },
  panel: { minHeight: 310, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "2rem", textAlign: "center" as const, border: "1px solid #e2e8f0", borderRadius: 14, background: "#ffffff" },
  panelIcon: { fontSize: "2rem" }, panelTitle: { margin: ".75rem 0 0", color: "#0f172a", fontSize: "1.1rem", fontWeight: 700 }, panelDetail: { maxWidth: 510, margin: ".4rem 0 0", color: "#64748b", lineHeight: 1.5, fontSize: ".83rem" },
  loadingCard: { display: "grid", gap: ".65rem", padding: ".9rem", border: "1px solid #e2e8f0", borderRadius: 14, background: "#ffffff" },
  skeleton: { height: 52, borderRadius: 8, background: "#f1f5f9" },
  spinner: { width: 34, height: 34, margin: "35vh auto", border: "3px solid rgba(0,0,0,.1)", borderTopColor: "#2563eb", borderRadius: "50%", animation: "evidence-spin .75s linear infinite" }, muted: { marginTop: "35vh", color: "#64748b", textAlign: "center" as const },
};
