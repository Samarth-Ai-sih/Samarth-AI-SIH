"use client";

import { InspectionLocationMap } from "@/components/inspections/InspectionLocationMap";
import { useAuth } from "@/lib/auth";
import {
  EvidenceUploadSignature,
  EvidenceVerification,
  InspectionChecklist,
  InspectionSubmission,
  InspectionTask,
  formatDateTime,
} from "@/lib/api";
import { useParams, useRouter } from "next/navigation";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { ExportReportButton } from "@/components/reports/export-report-button";
import { PrintableReport, ReportSection } from "@/lib/export-report";

const CASE_API = "/api/v1/cases";
const EVIDENCE_API = "/api/v1/evidence";

type InspectionReportPayload = {
  checklist: InspectionChecklist;
  gps_latitude: number | null;
  gps_longitude: number | null;
  gps_timestamp: string | null;
  evidence_ids: string[];
  remarks: string;
  offline_client_id: string;
};

type QueuedReport = { version: 1; queued_at: string; payload: InspectionReportPayload };
type DeviceLocation = { latitude: number; longitude: number; timestamp: string; accuracy: number | null };

const initialChecklist: InspectionChecklist = {
  asset_found: false,
  work_active: false,
  verified_physical_progress_pct: 0,
  quality_concern: false,
  work_delayed: false,
  cause_of_delay: "",
  additional_remarks: "",
};

function newOfflineClientId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return `inspection-${crypto.randomUUID()}`;
  return `inspection-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function queueKey(caseId: string) { return `samarth-inspection-queue-${caseId}`; }

function parseQueue(value: string | null): QueuedReport | null {
  if (!value) return null;
  try {
    const queue = JSON.parse(value) as QueuedReport;
    return queue?.version === 1 && queue.payload?.offline_client_id ? queue : null;
  } catch { return null; }
}

export default function InspectionTaskPage() {
  const { user, fetchWithAuth, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const params = useParams();
  const caseId = String(params.caseId || "");
  const fileRef = useRef<HTMLInputElement>(null);
  const [task, setTask] = useState<InspectionTask | null>(null);
  const [checklist, setChecklist] = useState<InspectionChecklist>(initialChecklist);
  const [remarks, setRemarks] = useState("");
  const [deviceLocation, setDeviceLocation] = useState<DeviceLocation | null>(null);
  const [evidence, setEvidence] = useState<EvidenceVerification[]>([]);
  const [queued, setQueued] = useState<QueuedReport | null>(() => typeof window === "undefined" ? null : parseQueue(window.localStorage.getItem(queueKey(caseId))));
  const [online, setOnline] = useState(() => typeof navigator === "undefined" ? true : navigator.onLine);
  const [loading, setLoading] = useState(true);
  const [capturingGps, setCapturingGps] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    return () => {
      if (mediaStreamRef.current) {
        mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  const setVideoRef = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (node && mediaStreamRef.current) {
      node.srcObject = mediaStreamRef.current;
      node.onloadedmetadata = () => {
        void node.play().catch((err) => console.warn("Video play error:", err));
      };
    }
  }, []);

  useEffect(() => {
    if (cameraActive && mediaStreamRef.current && videoRef.current) {
      const vid = videoRef.current;
      vid.srcObject = mediaStreamRef.current;
      vid.onloadedmetadata = () => {
        void vid.play().catch((err) => console.warn("Video play error:", err));
      };
    }
  }, [cameraActive]);

  async function startCamera() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setError("Live camera is not supported in this browser.");
      return;
    }
    setError(null);
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 } },
        audio: false,
      });
    } catch {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch {
        setError("Could not access camera. Check device camera permissions.");
        setCameraActive(false);
        return;
      }
    }

    mediaStreamRef.current = stream;
    setCameraActive(true);

    if (videoRef.current) {
      videoRef.current.srcObject = stream;
      videoRef.current.onloadedmetadata = () => {
        void videoRef.current?.play().catch((err) => console.warn("Video play:", err));
      };
    }
  }

  function stopCamera() {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    setCameraActive(false);
  }

  async function snapPhoto() {
    if (!videoRef.current) return;
    const canvas = document.createElement("canvas");
    canvas.width = videoRef.current.videoWidth || 640;
    canvas.height = videoRef.current.videoHeight || 480;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const file = new File([blob], `field-inspection-${Date.now()}.jpg`, { type: "image/jpeg" });
        stopCamera();
        void uploadPhoto(file);
      },
      "image/jpeg",
      0.88
    );
  }

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const response = await fetchWithAuth(`${CASE_API}/assigned/${caseId}/task`);
      if (response.status === 403) { setError("PERMISSION_DENIED"); return; }
      if (response.status === 404) { setError("NOT_FOUND"); return; }
      if (!response.ok) {
        const body = await response.json().catch(() => ({ detail: "Could not load inspection task." }));
        throw new Error(body.detail || "Could not load inspection task.");
      }
      const payload: InspectionTask = await response.json();
      setTask(payload);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not load inspection task.");
    } finally { setLoading(false); }
  }, [caseId, fetchWithAuth]);

  useEffect(() => {
    if (authLoading || !user) return;
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [authLoading, load, user]);

  useEffect(() => {
    const refreshNetwork = () => setOnline(navigator.onLine);
    window.addEventListener("online", refreshNetwork);
    window.addEventListener("offline", refreshNetwork);
    return () => { window.removeEventListener("online", refreshNetwork); window.removeEventListener("offline", refreshNetwork); };
  }, []);

  const setBoolean = (key: "asset_found" | "work_active" | "quality_concern" | "work_delayed", value: boolean) => {
    setChecklist((current) => ({ ...current, [key]: value }));
  };

  function createPayload(clientId = newOfflineClientId()): InspectionReportPayload | null {
    if (checklist.work_delayed && !checklist.cause_of_delay.trim()) {
      setError("Add the cause of delay before submitting a delayed-work report.");
      return null;
    }
    return {
      checklist: { ...checklist, verified_physical_progress_pct: Number(checklist.verified_physical_progress_pct) },
      gps_latitude: deviceLocation?.latitude ?? null,
      gps_longitude: deviceLocation?.longitude ?? null,
      gps_timestamp: deviceLocation?.timestamp ?? null,
      evidence_ids: evidence.map((item) => item.evidence_id),
      remarks: remarks.trim(),
      offline_client_id: clientId,
    };
  }

  async function submitPayload(payload: InspectionReportPayload): Promise<InspectionSubmission> {
    const response = await fetchWithAuth(`${CASE_API}/assigned/${caseId}/report`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({ detail: "Could not submit the inspection report." }));
      throw new Error(body.detail || "Could not submit the inspection report.");
    }
    return response.json();
  }

  function saveOffline(payload: InspectionReportPayload) {
    const queue: QueuedReport = { version: 1, queued_at: new Date().toISOString(), payload };
    window.localStorage.setItem(queueKey(caseId), JSON.stringify(queue));
    setQueued(queue);
    setNotice("Report saved on this device. Reconnect and use Sync queued report to submit it.");
  }

  async function submitReport() {
    setError(null); setNotice(null);
    const payload = createPayload();
    if (!payload) return;
    if (!online) { saveOffline(payload); return; }
    setSubmitting(true);
    try {
      const result = await submitPayload(payload);
      setTask((current) => current ? { ...current, case: result.case } : current);
      setNotice(`Inspection report submitted. ${result.district_authorities_notified} District Authority account(s) notified; risk recalculation ${result.risk_recalculated ? "completed" : "is unavailable"}.`);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not submit inspection report.");
    } finally { setSubmitting(false); }
  }

  async function syncQueuedReport() {
    if (!queued) return;
    if (!online) { setError("This device is offline. Reconnect before syncing the queued report."); return; }
    setSubmitting(true); setError(null); setNotice(null);
    try {
      const result = await submitPayload(queued.payload);
      window.localStorage.removeItem(queueKey(caseId)); setQueued(null);
      setTask((current) => current ? { ...current, case: result.case } : current);
      setNotice(`Queued report synced. ${result.district_authorities_notified} District Authority account(s) notified.`);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Could not sync queued inspection report.");
    } finally { setSubmitting(false); }
  }

  function captureGps() {
    setError(null);
    if (!navigator.geolocation) { setError("GPS is unavailable in this browser. You can still submit a report without a location capture."); return; }
    setCapturingGps(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setDeviceLocation({ latitude: position.coords.latitude, longitude: position.coords.longitude, timestamp: new Date(position.timestamp).toISOString(), accuracy: Number.isFinite(position.coords.accuracy) ? position.coords.accuracy : null });
        setCapturingGps(false); setNotice("GPS location and timestamp captured for this private inspection report.");
      },
      (locationError) => { setCapturingGps(false); setError(`GPS capture failed: ${locationError.message}`); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  async function uploadPhoto(fileParam?: File) {
    const file = fileParam || fileRef.current?.files?.[0];
    if (!file || !task) { setError("Choose a photo before uploading."); return; }
    if (!online) { setError("Photo uploads require a connection. Queue the report without this photo, then upload it once online before submitting."); return; }
    setUploading(true); setError(null); setNotice(null);
    try {
      const signatureResponse = await fetchWithAuth(`${EVIDENCE_API}/upload-signature`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ work_id: task.work.work_id, filename: file.name, content_type: file.type || "image/jpeg" }),
      });
      if (!signatureResponse.ok) {
        const body = await signatureResponse.json().catch(() => ({ detail: "Could not prepare the private upload." }));
        throw new Error(body.detail || "Could not prepare the private upload.");
      }
      const ticket: EvidenceUploadSignature = await signatureResponse.json();
      let verified: EvidenceVerification;
      if (ticket.storage_mode === "local_demo") {
        const form = new FormData(); form.set("work_id", task.work.work_id); form.set("file", file);
        const response = await fetchWithAuth(ticket.local_upload_endpoint || `${EVIDENCE_API}/local-upload`, { method: "POST", body: form });
        if (!response.ok) {
          const body = await response.json().catch(() => ({ detail: "Could not upload local demo evidence." }));
          throw new Error(body.detail || "Could not upload local demo evidence.");
        }
        verified = await response.json();
      } else {
        if (!ticket.upload_url || !ticket.api_key || !ticket.signature || !ticket.timestamp || !ticket.public_id) throw new Error("The signed private upload request is incomplete.");
        const form = new FormData();
        form.set("file", file); form.set("api_key", ticket.api_key); form.set("timestamp", String(ticket.timestamp));
        form.set("signature", ticket.signature); form.set("public_id", ticket.public_id); form.set("type", ticket.upload_type || "authenticated");
        const uploadResponse = await fetch(ticket.upload_url, { method: "POST", body: form });
        if (!uploadResponse.ok) throw new Error("The private upload provider rejected the photo.");
        const asset = await uploadResponse.json() as { public_id?: string };
        const completion = await fetchWithAuth(ticket.completion_endpoint, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ work_id: task.work.work_id, evidence_id: ticket.evidence_id, public_id: asset.public_id || ticket.public_id, filename: file.name, content_type: file.type || "image/jpeg" }),
        });
        if (!completion.ok) {
          const body = await completion.json().catch(() => ({ detail: "Could not complete evidence verification." }));
          throw new Error(body.detail || "Could not complete evidence verification.");
        }
        verified = await completion.json();
      }
      setEvidence((current) => current.some((item) => item.evidence_id === verified.evidence_id) ? current : [...current, verified]);
      if (fileRef.current) fileRef.current.value = "";
      setNotice("Photo uploaded and verified. Only its secure verification reference is attached to the report.");
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : "Photo upload failed.");
    } finally { setUploading(false); }
  }

  if (authLoading) return <Spinner />;
  if (!user) return <main style={s.page}><p style={s.muted}>Not authenticated. Redirecting…</p></main>;
  if (error === "PERMISSION_DENIED" || error === "NOT_FOUND") return <main style={s.page}><State icon={error === "PERMISSION_DENIED" ? "🔒" : "◌"} title={error === "PERMISSION_DENIED" ? "Inspector access required" : "Inspection task not found"} detail={error === "PERMISSION_DENIED" ? "Only the assigned inspector can access this private field task." : "This task was not assigned to your inspector account, or it is no longer available."} /></main>;
  if (loading || !task) return <Spinner />;

  const isSubmitted = task.case.inspection_reports.some((report) => report.inspector_user_id === user.user_id);
  const project = { label: "Work location", latitude: task.work.location_latitude, longitude: task.work.location_longitude, address: task.work.location_address, color: "#60a5fa" };
  const device = deviceLocation ? { label: "Device GPS", latitude: deviceLocation.latitude, longitude: deviceLocation.longitude, address: `Captured ${formatDateTime(deviceLocation.timestamp)}`, color: "#fbbf24" } : undefined;
  const navigationUrl = task.work.location_latitude !== null && task.work.location_longitude !== null ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${task.work.location_latitude},${task.work.location_longitude}`)}` : null;

  const getInspectionExportData = () => {
    if (!task) throw new Error("Inspection task not loaded");

    const sections: ReportSection[] = [
      {
        title: "Work Reference & Task Scope",
        type: "key-value",
        items: [
          { label: "Case ID", value: task.case.case_id },
          { label: "Case Title", value: task.case.title },
          { label: "Work ID", value: task.work.work_id },
          { label: "Work Title", value: task.work.title },
          { label: "Implementing Agency", value: task.work.implementing_agency || "—" },
          { label: "State & District", value: `${task.work.state_name}, ${task.work.district_name || ""}` },
          { label: "Recorded Progress", value: `${task.work.physical_progress_pct}%` },
        ],
      },
      {
        title: "Ground Observation & Checklist Findings",
        type: "key-value",
        items: [
          { label: "Asset Found on Ground?", value: checklist.asset_found ? "YES" : "NO" },
          { label: "Active Construction / Work?", value: checklist.work_active ? "YES" : "NO" },
          { label: "Verified Physical Progress (%)", value: `${checklist.verified_physical_progress_pct}%` },
          { label: "Quality Concerns Observed?", value: checklist.quality_concern ? "YES — Flaws/Issues detected" : "NO — Acceptable" },
          { label: "Work Delayed / Stalled?", value: checklist.work_delayed ? "YES — Delayed" : "NO — On Track" },
          { label: "Cause of Delay", value: checklist.cause_of_delay || "None stated" },
          { label: "Additional Checklist Observations", value: checklist.additional_remarks || "None" },
          { label: "Inspector Overall Remarks", value: remarks || "None" },
        ],
      },
      {
        title: "Geotagged Device Verification & Evidence",
        type: "key-value",
        items: [
          { label: "GPS Captured?", value: deviceLocation ? "YES (High Accuracy)" : "NO" },
          {
            label: "Device Coordinates",
            value: deviceLocation ? `${deviceLocation.latitude.toFixed(6)}, ${deviceLocation.longitude.toFixed(6)} (±${Math.round(deviceLocation.accuracy || 0)}m)` : "Not captured",
          },
          { label: "GPS Timestamp", value: deviceLocation ? formatDateTime(deviceLocation.timestamp) : "—" },
          { label: "Evidence Attachments", value: `${evidence.length} verified photos attached` },
        ],
      },
    ];

    const report: PrintableReport = {
      title: "MPLADS FIELD INSPECTION & VERIFICATION DOSSIER",
      subtitle: `Case #${task.case.case_id} · ${task.work.title}`,
      categoryBadge: isSubmitted ? "SUBMITTED INSPECTION" : "FIELD AUDIT DRAFT",
      generatedBy: user ? `${user.full_name} (${user.role.replace(/_/g, " ").toUpperCase()})` : "Field Inspector",
      jurisdiction: `${task.work.district_name || ""}, ${task.work.state_name || ""}`.replace(/^, |, $/g, "") || "Jurisdiction",
      metadata: [
        { label: "Case ID", value: task.case.case_id },
        { label: "Work ID", value: task.work.work_id },
        { label: "Inspector", value: user?.full_name || user?.user_id || "Inspector" },
        { label: "Asset Found", value: checklist.asset_found ? "YES" : "NO" },
        { label: "Verified Progress", value: `${checklist.verified_physical_progress_pct}%` },
        { label: "GPS Status", value: deviceLocation ? "Captured" : "Unavailable" },
      ],
      sections,
      signOff: {
        designation: "Authorized Field Inspector / Technical Surveyor",
        office: "District Planning Cell / Ministry of Statistics & Programme Implementation",
      },
    };

    const csvHeaders = ["Category", "Item / Parameter", "Observed Value", "Remarks"];
    const csvRows: (string | number)[][] = [
      ["Scope", "Case ID", task.case.case_id, ""],
      ["Scope", "Work ID", task.work.work_id, ""],
      ["Scope", "Work Title", task.work.title, ""],
      ["Scope", "Agency", task.work.implementing_agency || "", ""],
      ["Scope", "State", task.work.state_name, ""],
      ["Scope", "District", task.work.district_name || "", ""],
      ["Checklist", "Asset Found", checklist.asset_found ? "YES" : "NO", ""],
      ["Checklist", "Work Active", checklist.work_active ? "YES" : "NO", ""],
      ["Checklist", "Verified Physical Progress (%)", checklist.verified_physical_progress_pct, ""],
      ["Checklist", "Quality Concern", checklist.quality_concern ? "YES" : "NO", ""],
      ["Checklist", "Work Delayed", checklist.work_delayed ? "YES" : "NO", ""],
      ["Checklist", "Cause of Delay", checklist.cause_of_delay, ""],
      ["Checklist", "Checklist Remarks", checklist.additional_remarks, ""],
      ["Checklist", "Inspector Remarks", remarks, ""],
      ["GPS", "GPS Captured", deviceLocation ? "YES" : "NO", ""],
      ["GPS", "Coordinates", deviceLocation ? `${deviceLocation.latitude}, ${deviceLocation.longitude}` : "", ""],
      ["GPS", "Accuracy (m)", deviceLocation?.accuracy || "", ""],
      ["GPS", "Timestamp", deviceLocation?.timestamp || "", ""],
    ];

    return {
      report,
      csv: { headers: csvHeaders, rows: csvRows },
      json: { task, checklist, remarks, deviceLocation, evidence },
    };
  };

  return <main style={s.page}><div style={s.container}>
    <header style={s.header}><div><button onClick={() => router.push("/dashboard/inspections")} style={s.back}>← Assigned inspections</button><p style={s.eyebrow}>Private field workflow · Case {task.case.case_id}</p><h1 style={s.title}>{task.case.title}</h1><p style={s.subtitle}>{task.case.description || "No additional case context was supplied."}</p></div><div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: "0.5rem" }}><span style={online ? s.online : s.offline}>{online ? "● Online" : "● Offline"}</span><ExportReportButton label="Export Inspection Dossier" filename={`Inspection_Case_${task.case.case_id}`} getReportData={getInspectionExportData} /></div></header>
    <section style={s.workCard}><div><span style={s.label}>Work</span><h2 style={s.workTitle}>{task.work.title}</h2><p style={s.workMeta}>{task.work.work_id} · {task.work.implementing_agency || "Agency unavailable"}</p><p style={s.workMeta}>{task.work.state_name} {task.work.district_name ? `· ${task.work.district_name}` : ""} · Recorded progress {task.work.physical_progress_pct}%</p></div><div style={s.workActions}>{navigationUrl ? <a href={navigationUrl} target="_blank" rel="noreferrer" style={s.navigate}>Open navigation ↗</a> : <span style={s.mutedSmall}>Location unavailable</span>}<button onClick={() => void load()} style={s.refresh}>Refresh task</button></div></section>
    {notice && <p style={s.notice}>{notice}</p>}{error && <p style={s.error}>{error}</p>}
    {queued && <section style={s.queue}><div><strong>Queued report on this device</strong><p style={s.queueText}>Saved {formatDateTime(queued.queued_at)}. It has {queued.payload.evidence_ids.length} secure evidence reference(s) and will keep the same idempotency key when synced.</p></div><button onClick={() => void syncQueuedReport()} disabled={!online || submitting || isSubmitted} style={s.queueButton}>{submitting ? "Syncing…" : "Sync queued report"}</button></section>}
    {isSubmitted && <section style={s.submitted}><strong>Inspection report submitted</strong><p style={s.queueText}>The District Authority has the report, evidence references, lifecycle event, and recalculated risk record. No additional report is needed for this assignment.</p></section>}
    <section style={s.layout}><div style={s.formColumn}>
      <section style={s.card}><h2 style={s.sectionTitle}>Field checklist</h2><p style={s.sectionText}>Record what you observed at the work site. A cause is mandatory when work is delayed.</p>
        <div style={s.checkGrid}><Check label="Asset found?" checked={checklist.asset_found} disabled={isSubmitted} onChange={(value) => setBoolean("asset_found", value)} /><Check label="Work active?" checked={checklist.work_active} disabled={isSubmitted} onChange={(value) => setBoolean("work_active", value)} /><Check label="Quality concern?" checked={checklist.quality_concern} disabled={isSubmitted} onChange={(value) => setBoolean("quality_concern", value)} /><Check label="Work delayed?" checked={checklist.work_delayed} disabled={isSubmitted} onChange={(value) => setBoolean("work_delayed", value)} /></div>
        <label style={s.fieldLabel}>Verified physical progress (%)<input type="number" min="0" max="100" value={checklist.verified_physical_progress_pct} disabled={isSubmitted} onChange={(event) => setChecklist((current) => ({ ...current, verified_physical_progress_pct: Math.max(0, Math.min(100, Number(event.target.value) || 0)) }))} style={s.input} /></label>
        <label style={s.fieldLabel}>Cause of delay {checklist.work_delayed ? <b style={s.required}>required</b> : ""}<textarea value={checklist.cause_of_delay} disabled={isSubmitted} onChange={(event) => setChecklist((current) => ({ ...current, cause_of_delay: event.target.value }))} style={s.textarea} placeholder="Cause observed at site" /></label>
        <label style={s.fieldLabel}>Additional remarks<textarea value={checklist.additional_remarks} disabled={isSubmitted} onChange={(event) => setChecklist((current) => ({ ...current, additional_remarks: event.target.value }))} style={s.textarea} placeholder="Additional checklist observations" /></label>
      </section>
      <section style={s.card}><h2 style={s.sectionTitle}>GPS and timestamp</h2><p style={s.sectionText}>Captured coordinates are stored privately with the report. The District Authority sees only availability and distance from the project.</p><div style={s.gpsRow}><button onClick={captureGps} disabled={capturingGps || isSubmitted} style={s.primary}>{capturingGps ? "Capturing GPS…" : deviceLocation ? "Recapture GPS" : "Capture GPS"}</button>{deviceLocation ? <span style={s.gpsInfo}>Captured {formatDateTime(deviceLocation.timestamp)}{deviceLocation.accuracy !== null ? ` · ±${Math.round(deviceLocation.accuracy)}m` : ""}</span> : <span style={s.mutedSmall}>Not captured</span>}</div>
      </section>
      <section style={s.card}>
        <h2 style={s.sectionTitle}>Private evidence photo</h2>
        <p style={s.sectionText}>Uses the signed Phase 12 upload flow. Files remain private; this report stores only their verification references.</p>
        <div style={s.uploadRow}>
          <button type="button" onClick={cameraActive ? stopCamera : startCamera} disabled={uploading || isSubmitted} style={s.primary}>
            {cameraActive ? "Close live camera" : "📷 Open live camera"}
          </button>
          <input ref={fileRef} type="file" capture="environment" accept="image/jpeg,image/png,image/webp,image/tiff" disabled={uploading || isSubmitted} style={s.fileInput} />
          <button onClick={() => void uploadPhoto()} disabled={uploading || isSubmitted} style={s.primary}>
            {uploading ? "Uploading…" : "Upload file"}
          </button>
        </div>
        {cameraActive && (
          <div style={{ marginTop: ".75rem", padding: ".75rem", background: "#f8fafc", borderRadius: 10, border: "1px solid #cbd5e1" }}>
            <video ref={setVideoRef} autoPlay playsInline muted style={{ width: "100%", maxHeight: 240, objectFit: "cover", borderRadius: 8 }} />
            <div style={{ marginTop: ".5rem", display: "flex", justifyContent: "center" }}>
              <button type="button" onClick={() => void snapPhoto()} disabled={uploading || isSubmitted} style={{ ...s.primary, background: "#0284c7", color: "#fff", fontWeight: 800 }}>
                📸 Take live photo & upload
              </button>
            </div>
          </div>
        )}
        {evidence.length > 0 ? (
          <div style={s.evidenceList}>
            {evidence.map((item) => (
              <div key={item.evidence_id} style={s.evidenceItem}>
                <strong>{item.evidence_id.slice(0, 12)}</strong>
                <span>{item.verification_labels.join(" · ")}</span>
              </div>
            ))}
          </div>
        ) : (
          <p style={s.mutedSmall}>No photo verification references attached.</p>
        )}
      </section>
      <section style={s.card}><h2 style={s.sectionTitle}>Inspection remarks and submission</h2><textarea value={remarks} disabled={isSubmitted} onChange={(event) => setRemarks(event.target.value)} style={s.remarks} placeholder="Overall inspection report remarks" /><p style={s.sectionText}>When offline, the report fields and evidence references are saved locally. Photo binaries are never queued in the browser.</p><button onClick={() => void submitReport()} disabled={submitting || isSubmitted} style={s.submit}>{!online ? "Save report offline" : submitting ? "Submitting report…" : "Submit inspection report"}</button></section>
    </div><aside style={s.mapColumn}><InspectionLocationMap project={project} device={device} /><section style={s.card}><h2 style={s.sectionTitle}>Case status</h2><p style={s.caseStatus}>{task.case.status.replaceAll("_", " ")}</p><p style={s.mutedSmall}>Severity: {task.case.severity}</p><p style={s.mutedSmall}>Due: {formatDateTime(task.case.due_date)}</p></section></aside></section>
  </div><style>{`@keyframes inspection-detail-spin{to{transform:rotate(360deg)}} button:hover:not(:disabled),a:hover{opacity:.86}`}</style></main>;
}

function Check({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (value: boolean) => void }) {
  return <label style={s.check}><input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}

function State({ icon, title, detail }: { icon: string; title: string; detail: string }) { return <section style={s.state}><span style={s.stateIcon}>{icon}</span><h1 style={s.stateTitle}>{title}</h1><p style={s.stateDetail}>{detail}</p></section>; }
function Spinner() { return <main style={s.page}><div style={s.spinner} /><style>{`@keyframes inspection-detail-spin{to{transform:rotate(360deg)}}`}</style></main>; }

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: "100vh", padding: "1.5rem", background: "#ffffff", fontFamily: '-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif' },
  container: { maxWidth: 1340, margin: "0 auto" },
  header: { display: "flex", justifyContent: "space-between", gap: "1rem", alignItems: "flex-start", marginBottom: "1rem" },
  back: { border: 0, padding: 0, background: "transparent", color: "#475569", cursor: "pointer", fontSize: ".78rem" },
  eyebrow: { margin: ".75rem 0 .22rem", color: "#2563eb", fontSize: ".68rem", letterSpacing: ".09em", fontWeight: 700, textTransform: "uppercase" as const },
  title: { margin: 0, color: "#0f172a", fontSize: "clamp(1.5rem,3vw,2.2rem)", letterSpacing: "-.03em", fontWeight: 700 },
  subtitle: { maxWidth: 730, margin: ".4rem 0 0", color: "#64748b", fontSize: ".84rem", lineHeight: 1.5 },
  online: { padding: ".35rem .55rem", border: "1px solid #bbf7d0", borderRadius: 999, color: "#166534", background: "#f0fdf4", fontSize: ".68rem", fontWeight: 700, whiteSpace: "nowrap" as const },
  offline: { padding: ".35rem .55rem", border: "1px solid #fde68a", borderRadius: 999, color: "#92400e", background: "#fffbeb", fontSize: ".68rem", fontWeight: 700, whiteSpace: "nowrap" as const },
  workCard: { display: "flex", justifyContent: "space-between", gap: "1rem", padding: ".9rem", border: "1px solid #e2e8f0", borderRadius: 13, background: "#ffffff", boxShadow: "0 1px 3px rgba(0,0,0,0.04)", marginBottom: ".75rem" },
  label: { display: "block", color: "#2563eb", fontSize: ".65rem", fontWeight: 750, textTransform: "uppercase" as const, letterSpacing: ".06em" },
  workTitle: { margin: ".3rem 0", color: "#0f172a", fontSize: "1rem", fontWeight: 700 },
  workMeta: { margin: ".2rem 0", color: "#64748b", fontSize: ".72rem", lineHeight: 1.4 },
  workActions: { display: "flex", alignItems: "flex-start", flexWrap: "wrap", justifyContent: "flex-end", gap: ".4rem" },
  navigate: { padding: ".45rem .55rem", border: "1px solid #2563eb", borderRadius: 7, color: "#ffffff", background: "#2563eb", textDecoration: "none", fontSize: ".69rem", fontWeight: 700 },
  refresh: { padding: ".45rem .55rem", border: "1px solid #cbd5e1", borderRadius: 7, color: "#0f172a", background: "#ffffff", cursor: "pointer", fontSize: ".69rem", fontWeight: 700 },
  notice: { padding: ".6rem .75rem", border: "1px solid #bbf7d0", borderRadius: 8, color: "#166534", background: "#f0fdf4", fontSize: ".77rem" },
  error: { padding: ".6rem .75rem", border: "1px solid #fecaca", borderRadius: 8, color: "#991b1b", background: "#fef2f2", fontSize: ".77rem" },
  queue: { display: "flex", justifyContent: "space-between", alignItems: "center", gap: ".8rem", padding: ".75rem", margin: ".75rem 0", border: "1px solid #fde68a", borderRadius: 10, color: "#92400e", background: "#fffbeb", fontSize: ".78rem" },
  submitted: { padding: ".75rem", margin: ".75rem 0", border: "1px solid #bbf7d0", borderRadius: 10, color: "#166534", background: "#f0fdf4", fontSize: ".78rem" },
  queueText: { margin: ".25rem 0 0", color: "#475569", fontSize: ".71rem", lineHeight: 1.45 },
  queueButton: { border: "1px solid #d97706", borderRadius: 7, padding: ".48rem .6rem", color: "#ffffff", background: "#d97706", cursor: "pointer", whiteSpace: "nowrap" as const, fontWeight: 700, fontSize: ".7rem" },
  layout: { display: "grid", gridTemplateColumns: "minmax(0,1.35fr) minmax(300px,.8fr)", gap: ".75rem", alignItems: "start" },
  formColumn: { display: "grid", gap: ".75rem" },
  mapColumn: { display: "grid", gap: ".75rem", position: "sticky" as const, top: ".75rem" },
  card: { padding: ".9rem", border: "1px solid #e2e8f0", borderRadius: 13, background: "#ffffff", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" },
  sectionTitle: { margin: 0, color: "#0f172a", fontSize: ".95rem", fontWeight: 700 },
  sectionText: { margin: ".3rem 0 .65rem", color: "#64748b", fontSize: ".72rem", lineHeight: 1.45 },
  checkGrid: { display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: ".45rem", marginBottom: ".65rem" },
  check: { display: "flex", alignItems: "center", gap: ".42rem", padding: ".45rem", border: "1px solid #e2e8f0", borderRadius: 7, color: "#0f172a", background: "#f8fafc", fontSize: ".72rem", cursor: "pointer" },
  fieldLabel: { display: "grid", gap: ".25rem", marginTop: ".6rem", color: "#334155", fontSize: ".72rem", fontWeight: 700 },
  required: { color: "#e11d48", fontSize: ".65rem" },
  input: { width: "100%", boxSizing: "border-box" as const, padding: ".5rem .55rem", color: "#0f172a", border: "1px solid #cbd5e1", borderRadius: 7, background: "#ffffff", fontSize: ".78rem" },
  textarea: { width: "100%", minHeight: 58, boxSizing: "border-box" as const, padding: ".5rem .55rem", color: "#0f172a", border: "1px solid #cbd5e1", borderRadius: 7, background: "#ffffff", resize: "vertical" as const, fontSize: ".78rem" },
  remarks: { width: "100%", minHeight: 90, boxSizing: "border-box" as const, padding: ".5rem .55rem", color: "#0f172a", border: "1px solid #cbd5e1", borderRadius: 7, background: "#ffffff", resize: "vertical" as const, fontSize: ".78rem" },
  gpsRow: { display: "flex", alignItems: "center", flexWrap: "wrap", gap: ".55rem" },
  primary: { border: "1px solid #2563eb", borderRadius: 7, padding: ".48rem .6rem", color: "#ffffff", background: "#2563eb", cursor: "pointer", fontWeight: 700, fontSize: ".72rem" },
  submit: { width: "100%", marginTop: ".4rem", border: "1px solid #2563eb", borderRadius: 8, padding: ".6rem", color: "#ffffff", background: "#2563eb", cursor: "pointer", fontWeight: 750, fontSize: ".78rem" },
  gpsInfo: { color: "#2563eb", fontSize: ".7rem", fontWeight: 600 },
  uploadRow: { display: "flex", alignItems: "center", gap: ".5rem", flexWrap: "wrap" },
  fileInput: { maxWidth: 290, color: "#475569", fontSize: ".7rem" },
  evidenceList: { display: "grid", gap: ".35rem", marginTop: ".65rem" },
  evidenceItem: { display: "grid", gap: ".18rem", padding: ".48rem", border: "1px solid #bfdbfe", borderRadius: 7, color: "#1e3a8a", background: "#eff6ff", fontSize: ".68rem", overflowWrap: "anywhere" as const },
  caseStatus: { margin: ".45rem 0", color: "#b45309", fontSize: ".8rem", fontWeight: 700, textTransform: "capitalize" as const },
  mutedSmall: { margin: ".3rem 0", color: "#64748b", fontSize: ".69rem", lineHeight: 1.45 },
  state: { minHeight: "80vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", textAlign: "center" as const },
  stateIcon: { fontSize: "2.2rem" },
  stateTitle: { margin: ".7rem 0 0", color: "#0f172a", fontWeight: 700 },
  stateDetail: { maxWidth: 470, color: "#64748b", lineHeight: 1.5 },
  spinner: { width: 34, height: 34, margin: "35vh auto", border: "3px solid rgba(0,0,0,.1)", borderTopColor: "#2563eb", borderRadius: "50%", animation: "inspection-detail-spin .75s linear infinite" },
  muted: { marginTop: "35vh", color: "#64748b", textAlign: "center" as const },
};
