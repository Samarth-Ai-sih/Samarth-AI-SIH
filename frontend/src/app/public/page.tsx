"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import {
  PublicWorkSummary,
  PublicWorkDetail,
  PublicWorkListResponse,
  CitizenVerificationChallenge,
  CitizenIssueReceipt,
  CitizenIssueType,
  CitizenReportPublicSummary,
  CitizenRecentUpdatesResponse,
  CitizenCommunityIssueItem,
  CitizenCommunityIssueListResponse,
  CitizenPersonalIssueItem,
  formatDate,
  formatDateTime,
} from "@/lib/api";
import {
  Search,
  Camera,
  Upload,
  X,
  CheckCircle2,
  AlertCircle,
  Clock,
  MapPin,
  Building2,
  FileText,
  RefreshCw,
  Eye,
  ShieldCheck,
  ChevronRight,
  Filter,
  Layers,
  Sparkles,
  ExternalLink,
  ArrowRight,
  User,
} from "lucide-react";

const API = "/api/v1/public";

const ISSUE_TYPES: Array<{ value: CitizenIssueType; label: string; description: string }> = [
  { value: "work_not_started", label: "Work Not Started", description: "Sanctioned funds exist but no physical ground work has commenced." },
  { value: "work_appears_stopped", label: "Work Abandoned or Stopped", description: "Construction was started earlier but has halted for months." },
  { value: "quality_concern", label: "Substandard Quality", description: "Defective materials, cracked structures, or safety hazards observed." },
  { value: "asset_not_visible", label: "Asset Not Found", description: "Project recorded as complete on paper, but no asset exists on site." },
  { value: "incorrect_information", label: "Discrepancy / Misreporting", description: "Physical progress or sign board details conflict with reality." },
  { value: "other", label: "Other Civic Concern", description: "Other community grievances regarding this public expenditure." },
];

const CATEGORIES = [
  "education",
  "healthcare",
  "drinking_water",
  "roads_and_bridges",
  "sanitation",
  "community_infrastructure",
  "sports",
  "electricity",
  "irrigation",
  "other",
];

export default function CitizenPortalPage() {
  const { user, login, logout, accessToken } = useAuth();

  // Navigation tabs: Search & Report, Community Issues, My Raised Issues (Auth), Resolved Feed
  const [activeTab, setActiveTab] = useState<"search" | "community_issues" | "my_issues" | "resolved_feed">("search");

  // Citizen Login Modal state
  const [loginModalOpen, setLoginModalOpen] = useState(false);
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Search Filters (NO work_id search)
  const [filters, setFilters] = useState({
    query: "",
    pincode: "",
    district: "",
    constituency: "",
    mp_name: "",
    category: "",
  });

  // Works state
  const [works, setWorks] = useState<PublicWorkSummary[]>([]);
  const [totalWorks, setTotalWorks] = useState(0);
  const [loadingWorks, setLoadingWorks] = useState(false);
  const [searchExecuted, setSearchExecuted] = useState(false);

  // Selected work for modal view
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null);
  const [selectedWorkDetail, setSelectedWorkDetail] = useState<PublicWorkDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  // Issue reporting modal state
  const [reportModalOpen, setReportModalOpen] = useState(false);
  const [reportingWork, setReportingWork] = useState<PublicWorkSummary | PublicWorkDetail | null>(null);
  const [issueType, setIssueType] = useState<CitizenIssueType>("work_appears_stopped");
  const [issueDescription, setIssueDescription] = useState("");
  const [locationConsent, setLocationConsent] = useState(false);
  const [capturedLocation, setCapturedLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [capturingGps, setCapturingGps] = useState(false);

  // Live Camera snapshots state (max 3)
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [imagePreviews, setImagePreviews] = useState<string[]>([]);

  // Live Camera stream state
  const [cameraActive, setCameraActive] = useState(false);
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const videoRef = useRef<HTMLVideoElement>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);

  // Captcha challenge
  const [challenge, setChallenge] = useState<CitizenVerificationChallenge | null>(null);
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [submittingIssue, setSubmittingIssue] = useState(false);

  // Submission success receipt
  const [receipt, setReceipt] = useState<CitizenIssueReceipt | null>(null);
  const [submissionSuccessModal, setSubmissionSuccessModal] = useState(false);

  // Community-raised issues (unauthenticated public social audit feed)
  const [communityIssues, setCommunityIssues] = useState<CitizenCommunityIssueItem[]>([]);
  const [totalCommunityIssues, setTotalCommunityIssues] = useState(0);
  const [loadingCommunityIssues, setLoadingCommunityIssues] = useState(false);
  const [filterCommunityStatus, setFilterCommunityStatus] = useState<string>("all");
  const [searchCommunityText, setSearchCommunityText] = useState("");

  // Personal issues submitted by logged-in citizen
  const [myIssues, setMyIssues] = useState<CitizenPersonalIssueItem[]>([]);
  const [loadingMyIssues, setLoadingMyIssues] = useState(false);

  // Transparency / Recent updates feed
  const [recentUpdates, setRecentUpdates] = useState<CitizenReportPublicSummary[]>([]);
  const [loadingUpdates, setLoadingUpdates] = useState(false);
  const [filterUpdateStatus, setFilterUpdateStatus] = useState<string>("all");

  // Notifications / status
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch human verification challenge
  const fetchChallenge = useCallback(async () => {
    try {
      const res = await fetch(`${API}/verification-challenge`);
      if (res.ok) {
        setChallenge(await res.json());
      }
    } catch {
      // ignore
    }
  }, []);

  // Fetch recent transparency updates
  const fetchRecentUpdates = useCallback(async () => {
    setLoadingUpdates(true);
    try {
      const res = await fetch(`${API}/recent-updates?limit=30`);
      if (res.ok) {
        const data: CitizenRecentUpdatesResponse = await res.json();
        setRecentUpdates(data.reports || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingUpdates(false);
    }
  }, []);

  // Fetch all community-raised issues (unauthenticated feed)
  const fetchCommunityIssues = useCallback(async () => {
    setLoadingCommunityIssues(true);
    try {
      const res = await fetch(`${API}/all-issues?page=1&page_size=50`);
      if (res.ok) {
        const data: CitizenCommunityIssueListResponse = await res.json();
        setCommunityIssues(data.issues || []);
        setTotalCommunityIssues(data.total || 0);
      }
    } catch {
      // ignore
    } finally {
      setLoadingCommunityIssues(false);
    }
  }, []);

  // Fetch issues submitted by authenticated citizen
  const fetchMyIssues = useCallback(async () => {
    if (!user) return;
    setLoadingMyIssues(true);
    try {
      const headers: Record<string, string> = {};
      if (accessToken) {
        headers["Authorization"] = `Bearer ${accessToken}`;
      }
      const res = await fetch(`${API}/my-issues`, { headers });
      if (res.ok) {
        const data: CitizenPersonalIssueItem[] = await res.json();
        setMyIssues(data || []);
      }
    } catch {
      // ignore
    } finally {
      setLoadingMyIssues(false);
    }
  }, [user, accessToken]);

  // Citizen login handler
  async function handleCitizenLogin(e: React.FormEvent) {
    e.preventDefault();
    if (!loginEmail.trim() || !loginPassword) {
      setLoginError("Please enter email and password.");
      return;
    }
    setLoginLoading(true);
    setLoginError(null);
    try {
      await login(loginEmail.trim(), loginPassword);
      setLoginModalOpen(false);
      setLoginEmail("");
      setLoginPassword("");
      setActiveTab("my_issues");
      setNotice("Successfully signed in as Citizen.");
    } catch (err: unknown) {
      setLoginError(err instanceof Error ? err.message : "Citizen login failed. Check credentials.");
    } finally {
      setLoginLoading(false);
    }
  }

  // Initial load
  useEffect(() => {
    void fetchChallenge();
    void fetchRecentUpdates();
    void fetchCommunityIssues();
    // Default search to show initial public works
    void handleSearch();
  }, [fetchChallenge, fetchRecentUpdates, fetchCommunityIssues]);

  // Sync my issues when user signs in
  useEffect(() => {
    if (user) {
      void fetchMyIssues();
    } else {
      setMyIssues([]);
    }
  }, [user, fetchMyIssues]);

  // Clean up camera stream on unmount
  useEffect(() => {
    return () => {
      stopCameraStream();
    };
  }, []);

  // Search works (excluding work_id)
  async function handleSearch(e?: React.FormEvent) {
    if (e) e.preventDefault();
    setLoadingWorks(true);
    setError(null);
    setSearchExecuted(true);

    try {
      const params = new URLSearchParams({ page: "1", page_size: "30" });
      if (filters.query.trim()) params.set("query", filters.query.trim());
      if (filters.pincode.trim()) params.set("pincode", filters.pincode.trim());
      if (filters.district.trim()) params.set("district", filters.district.trim());
      if (filters.constituency.trim()) params.set("constituency", filters.constituency.trim());
      if (filters.mp_name.trim()) params.set("mp_name", filters.mp_name.trim());
      if (filters.category.trim()) params.set("category", filters.category.trim());

      const res = await fetch(`${API}/works?${params.toString()}`);
      if (!res.ok) {
        throw new Error("Could not search public works. Please check your connection.");
      }
      const data: PublicWorkListResponse = await res.json();
      setWorks(data.works || []);
      setTotalWorks(data.total || 0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error searching works");
    } finally {
      setLoadingWorks(false);
    }
  }

  // Open Work Detail modal
  async function openWorkDetails(work: PublicWorkSummary) {
    setSelectedWorkId(work.work_id);
    setSelectedWorkDetail(null);
    setLoadingDetail(true);
    setError(null);

    try {
      const res = await fetch(`${API}/works/${encodeURIComponent(work.work_id)}`);
      if (!res.ok) {
        // Fallback to summary data if detailed endpoint has an issue
        setSelectedWorkDetail({
          ...work,
          description: "MPLADS community infrastructure project under public execution.",
          sub_category: "General",
          start_date: null,
          actual_completion_date: null,
          last_updated_at: new Date().toISOString(),
          public_notice: "Standard public disclosure under social audit guidelines.",
        });
        return;
      }
      const data: PublicWorkDetail = await res.json();
      setSelectedWorkDetail(data);
    } catch {
      // Fallback
      setSelectedWorkDetail({
        ...work,
        description: "MPLADS community infrastructure project under public execution.",
        sub_category: "General",
        start_date: null,
        actual_completion_date: null,
        last_updated_at: new Date().toISOString(),
        public_notice: "Standard public disclosure under social audit guidelines.",
      });
    } finally {
      setLoadingDetail(false);
    }
  }

  // Start issue reporting for a work
  function startReporting(work: PublicWorkSummary | PublicWorkDetail) {
    setReportingWork(work);
    setSelectedFiles([]);
    setImagePreviews([]);
    setIssueDescription("");
    setCaptchaAnswer("");
    setLocationConsent(false);
    setCapturedLocation(null);
    setCameraActive(false);
    stopCameraStream();
    setReportModalOpen(true);
    void fetchChallenge();
    // Automatically launch live camera for ground verification
    void startLiveCamera();
  }

  function removePhoto(index: number) {
    const updatedFiles = selectedFiles.filter((_, i) => i !== index);
    const updatedPreviews = imagePreviews.filter((_, i) => i !== index);
    setSelectedFiles(updatedFiles);
    setImagePreviews(updatedPreviews);
  }

  // Callback ref ensuring video element receives the stream as soon as it mounts in the DOM
  const setVideoRef = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    if (node && mediaStreamRef.current) {
      node.srcObject = mediaStreamRef.current;
      node.onloadedmetadata = () => {
        void node.play().catch((err) => console.warn("Video play:", err));
      };
    }
  }, []);

  // Ensure stream plays whenever cameraActive turns true
  useEffect(() => {
    if (cameraActive && mediaStreamRef.current && videoRef.current) {
      const vid = videoRef.current;
      vid.srcObject = mediaStreamRef.current;
      vid.onloadedmetadata = () => {
        void vid.play().catch((err) => console.warn("Video play:", err));
      };
    }
  }, [cameraActive]);

  // Live Camera handling with fallback
  async function startLiveCamera(desiredMode?: "environment" | "user") {
    setCameraError(null);
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setCameraError("Camera stream not supported by this browser. Please use 'Select Image Files'.");
      return;
    }
    const mode = desiredMode || facingMode;
    // Stop any existing stream first
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }

    let stream: MediaStream | null = null;
    try {
      // 1. Try requested facingMode with ideal resolution
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: mode }, width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
    } catch {
      try {
        // 2. Fallback to general video constraint (ideal for desktop/laptop webcams)
        stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
      } catch (err: unknown) {
        setCameraError("Camera permission denied or camera is in use. Please allow camera permissions or upload photos from device.");
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

  function stopCameraStream() {
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((t) => t.stop());
      mediaStreamRef.current = null;
    }
    setCameraActive(false);
  }

  async function flipCamera() {
    const nextMode = facingMode === "environment" ? "user" : "environment";
    setFacingMode(nextMode);
    await startLiveCamera(nextMode);
  }

  function capturePhotoFromCamera() {
    if (!videoRef.current || selectedFiles.length >= 3) return;
    const video = videoRef.current;
    const w = video.videoWidth > 0 ? video.videoWidth : 640;
    const h = video.videoHeight > 0 ? video.videoHeight : 480;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, w, h);

    canvas.toBlob(
      (blob) => {
        if (!blob) return;
        const filename = `camera-snap-${Date.now()}.jpg`;
        const file = new File([blob], filename, { type: "image/jpeg" });
        const updated = [...selectedFiles, file].slice(0, 3);
        setSelectedFiles(updated);
        setImagePreviews(updated.map((f) => URL.createObjectURL(f)));

        if (updated.length >= 3) {
          stopCameraStream();
        }
      },
      "image/jpeg",
      0.9
    );
  }

  // Location capture
  function handleCaptureLocation() {
    if (!locationConsent) {
      setError("Please check the location consent checkbox first.");
      return;
    }
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser.");
      return;
    }
    setCapturingGps(true);
    setError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCapturedLocation({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setCapturingGps(false);
        setNotice("Live GPS coordinates captured securely.");
      },
      (err) => {
        setCapturingGps(false);
        setError(`Could not obtain GPS location: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  // Submit Issue
  async function handleSubmitIssue(e: React.FormEvent) {
    e.preventDefault();
    if (!reportingWork) return;
    if (!issueDescription.trim() || issueDescription.trim().length < 10) {
      setError("Please provide a detailed problem description (at least 10 characters).");
      return;
    }
    if (!challenge) {
      setError("Verification challenge expired. Loading a new one...");
      void fetchChallenge();
      return;
    }
    if (!captchaAnswer.trim()) {
      setError("Please answer the human verification question.");
      return;
    }

    setSubmittingIssue(true);
    setError(null);
    setNotice(null);

    try {
      // 1. Submit the issue metadata
      const issuePayload = {
        work_id: reportingWork.work_id,
        issue_type: issueType,
        description: issueDescription.trim(),
        location_consent: locationConsent,
        latitude: locationConsent && capturedLocation ? capturedLocation.latitude : null,
        longitude: locationConsent && capturedLocation ? capturedLocation.longitude : null,
        verification_id: challenge.verification_id,
        verification_answer: captchaAnswer.trim(),
      };

      const issueHeaders: Record<string, string> = { "Content-Type": "application/json" };
      if (accessToken) {
        issueHeaders["Authorization"] = `Bearer ${accessToken}`;
      }

      const res = await fetch(`${API}/issues`, {
        method: "POST",
        headers: issueHeaders,
        body: JSON.stringify(issuePayload),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({ detail: "Failed to submit report." }));
        throw new Error(errData.detail || "Failed to submit report.");
      }

      const receiptData: CitizenIssueReceipt = await res.json();
      setReceipt(receiptData);

      // 2. Upload photos if any attached (max 3)
      if (selectedFiles.length > 0 && receiptData.photo_upload_token) {
        const formData = new FormData();
        formData.append("upload_token", receiptData.photo_upload_token);
        selectedFiles.forEach((file) => {
          formData.append("files", file);
        });

        const uploadHeaders: Record<string, string> = {};
        if (accessToken) {
          uploadHeaders["Authorization"] = `Bearer ${accessToken}`;
        }

        const uploadRes = await fetch(`${API}/issues/${encodeURIComponent(receiptData.reference_id)}/evidence`, {
          method: "POST",
          headers: uploadHeaders,
          body: formData,
        });

        if (!uploadRes.ok) {
          console.warn("Evidence photo upload had an issue, but main report was logged.");
        }
      }

      // Close report modal and open success modal
      setReportModalOpen(false);
      stopCameraStream();
      setSubmissionSuccessModal(true);

      // Refresh transparency feed, community feed, and personal issues
      void fetchRecentUpdates();
      void fetchCommunityIssues();
      if (user) void fetchMyIssues();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error submitting ground report.");
      void fetchChallenge();
    } finally {
      setSubmittingIssue(false);
    }
  }

  // Filtered recent updates
  const filteredUpdates = recentUpdates.filter((item) => {
    if (filterUpdateStatus === "all") return true;
    if (filterUpdateStatus === "resolved") return item.status === "resolved" || item.status === "closed";
    if (filterUpdateStatus === "in_progress") return item.status !== "resolved" && item.status !== "closed";
    return true;
  });

  // Filtered community-raised issues
  const filteredCommunityIssues = communityIssues.filter((item) => {
    if (filterCommunityStatus !== "all" && item.status !== filterCommunityStatus) return false;
    if (searchCommunityText.trim()) {
      const q = searchCommunityText.trim().toLowerCase();
      const match =
        item.reference_id.toLowerCase().includes(q) ||
        item.work_title.toLowerCase().includes(q) ||
        item.district_name.toLowerCase().includes(q) ||
        item.description.toLowerCase().includes(q);
      if (!match) return false;
    }
    return true;
  });

  return (
    <div className="min-h-screen bg-slate-50/50 text-slate-900 font-sans">
      {/* Top National Civic Header */}
      <header className="bg-white text-slate-900 border-b border-slate-200 shadow-2xs">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-5">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="h-12 w-12 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center text-slate-800 font-black text-2xl shadow-2xs">
                🏛️
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold tracking-widest text-blue-700 uppercase">
                    SAMARTH AI · Public Citizen Portal
                  </span>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                    Social Audit Live
                  </span>
                </div>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900">
                  MPLADS Public Project Explorer & Ground Reporting
                </h1>
                <p className="text-xs sm:text-sm text-slate-600 max-w-2xl mt-0.5">
                  Inspect parliamentary constituency works, capture live ground photos to report stalled or defective projects, and monitor real-time senior authority resolutions.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2.5">
              {user ? (
                <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-1.5">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-xs text-emerald-900 font-medium">
                    {user.full_name || user.username} ({user.role === "citizen" ? "Citizen" : user.role.replaceAll("_", " ")})
                  </span>
                  <button
                    onClick={() => void logout()}
                    className="ml-2 text-[11px] text-slate-500 hover:text-slate-800 underline cursor-pointer"
                  >
                    Sign Out
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setLoginModalOpen(true)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold transition-all shadow-xs cursor-pointer"
                >
                  <User className="h-3.5 w-3.5" />
                  Citizen Sign In
                </button>
              )}

              <Link
                href={user ? "/dashboard" : "/login"}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold border border-slate-300 transition-colors shadow-2xs"
              >
                {user ? "Internal Dashboard" : "Official Login"}
              </Link>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex gap-2 mt-6 pt-2 border-t border-slate-200 overflow-x-auto">
            {/* Tab 1: Search & Report */}
            <button
              onClick={() => setActiveTab("search")}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-t-lg transition-all whitespace-nowrap cursor-pointer ${
                activeTab === "search"
                  ? "bg-slate-100 text-blue-900 border-b-2 border-blue-600 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/60"
              }`}
            >
              <Search className="h-4 w-4 text-blue-600" />
              Find Works & Report Ground Issues
            </button>

            {/* Tab 2: Community Raised Issues (Without Login) */}
            <button
              onClick={() => {
                setActiveTab("community_issues");
                void fetchCommunityIssues();
              }}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-t-lg transition-all whitespace-nowrap cursor-pointer ${
                activeTab === "community_issues"
                  ? "bg-slate-100 text-blue-900 border-b-2 border-blue-600 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/60"
              }`}
            >
              <Building2 className="h-4 w-4 text-blue-600" />
              Community Raised Issues (Public Feed)
              {communityIssues.length > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-blue-100 text-blue-800 font-bold border border-blue-200">
                  {totalCommunityIssues || communityIssues.length}
                </span>
              )}
            </button>

            {/* Tab 3: My Raised Issues & Status (Authenticated Citizen) */}
            <button
              onClick={() => {
                setActiveTab("my_issues");
                if (user) void fetchMyIssues();
              }}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-t-lg transition-all whitespace-nowrap cursor-pointer ${
                activeTab === "my_issues"
                  ? "bg-slate-100 text-blue-900 border-b-2 border-blue-600 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/60"
              }`}
            >
              <ShieldCheck className="h-4 w-4 text-emerald-600" />
              My Raised Issues & Status
              {user && myIssues.length > 0 && (
                <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-100 text-emerald-800 font-bold border border-emerald-200">
                  {myIssues.length}
                </span>
              )}
            </button>

            {/* Tab 4: Senior Resolutions & Changes Done */}
            <button
              onClick={() => {
                setActiveTab("resolved_feed");
                void fetchRecentUpdates();
              }}
              className={`flex items-center gap-2 px-4 py-2.5 text-xs font-bold rounded-t-lg transition-all whitespace-nowrap cursor-pointer ${
                activeTab === "resolved_feed"
                  ? "bg-slate-100 text-blue-900 border-b-2 border-blue-600 shadow-2xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100/60"
              }`}
            >
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              Senior Resolutions & Changes Done
              {recentUpdates.length > 0 && (
                <span className="ml-1.5 px-1.5 py-0.2 rounded-full text-[10px] bg-emerald-100 text-emerald-800 font-bold border border-emerald-200">
                  {recentUpdates.length}
                </span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Banner Alert for Notice or Error */}
        {notice && (
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs shadow-sm">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0" />
              <span>{notice}</span>
            </div>
            <button onClick={() => setNotice(null)} className="text-emerald-700 hover:text-emerald-900 font-bold">
              ✕
            </button>
          </div>
        )}
        {error && (
          <div className="flex items-center justify-between p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-900 text-xs shadow-sm">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-rose-600 flex-shrink-0" />
              <span>{error}</span>
            </div>
            <button onClick={() => setError(null)} className="text-rose-700 hover:text-rose-900 font-bold">
              ✕
            </button>
          </div>
        )}

        {/* TAB 1: Search & Report Public Works */}
        {activeTab === "search" && (
          <div className="space-y-6">
            {/* Search Filter Box (High Visibility Card) */}
            <section className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 md:p-6 transition-all">
              <div className="flex items-center justify-between mb-4 border-b border-slate-100 pb-3">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-blue-600" />
                  <h2 className="text-sm sm:text-base font-bold text-slate-900">
                    Search Public MPLADS Works in Your Locality
                  </h2>
                </div>
                <span className="text-xs text-slate-500">Filter by area, representative, or category</span>
              </div>

              <form onSubmit={handleSearch} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
                  {/* Keywords */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Keywords / Title</label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-slate-400" />
                      <input
                        type="text"
                        value={filters.query}
                        onChange={(e) => setFilters({ ...filters, query: e.target.value })}
                        placeholder="e.g. Solar lights, road, water tank..."
                        className="w-full pl-9 pr-3 py-2 text-xs rounded-lg border border-slate-300 bg-slate-50/50 text-slate-900 focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-all"
                      />
                    </div>
                  </div>

                  {/* Pincode */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Pincode</label>
                    <input
                      type="text"
                      value={filters.pincode}
                      onChange={(e) => setFilters({ ...filters, pincode: e.target.value })}
                      placeholder="e.g. 110001, 226001..."
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-slate-50/50 text-slate-900 focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-all"
                    />
                  </div>

                  {/* District */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">District</label>
                    <input
                      type="text"
                      value={filters.district}
                      onChange={(e) => setFilters({ ...filters, district: e.target.value })}
                      placeholder="e.g. Varanasi, Lucknow, Ranchi..."
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-slate-50/50 text-slate-900 focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-all"
                    />
                  </div>

                  {/* Constituency */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Constituency</label>
                    <input
                      type="text"
                      value={filters.constituency}
                      onChange={(e) => setFilters({ ...filters, constituency: e.target.value })}
                      placeholder="e.g. South Delhi, Varanasi..."
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-slate-50/50 text-slate-900 focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-all"
                    />
                  </div>

                  {/* MP Name */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Member of Parliament (MP)</label>
                    <input
                      type="text"
                      value={filters.mp_name}
                      onChange={(e) => setFilters({ ...filters, mp_name: e.target.value })}
                      placeholder="e.g. MP Name..."
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-slate-50/50 text-slate-900 focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-all"
                    />
                  </div>

                  {/* Category */}
                  <div>
                    <label className="block text-xs font-semibold text-slate-700 mb-1">Development Category</label>
                    <select
                      value={filters.category}
                      onChange={(e) => setFilters({ ...filters, category: e.target.value })}
                      className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-slate-50/50 text-slate-900 focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-all"
                    >
                      <option value="">All Categories</option>
                      {CATEGORIES.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat.replaceAll("_", " ").toUpperCase()}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-between pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      setFilters({ query: "", pincode: "", district: "", constituency: "", mp_name: "", category: "" });
                      void handleSearch();
                    }}
                    className="text-xs font-semibold text-slate-500 hover:text-slate-800 transition-colors"
                  >
                    Reset Filters
                  </button>

                  <button
                    type="submit"
                    disabled={loadingWorks}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-500/20 transition-all disabled:opacity-50 cursor-pointer"
                  >
                    <Search className={`h-4 w-4 ${loadingWorks ? "animate-spin" : ""}`} />
                    {loadingWorks ? "Searching..." : "Search Works"}
                  </button>
                </div>
              </form>
            </section>

            {/* Results Header */}
            <div className="flex items-center justify-between px-1">
              <h3 className="text-sm font-bold text-slate-800 flex items-center gap-2">
                <span>Public Works Found</span>
                <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800">
                  {totalWorks} projects
                </span>
              </h3>
              <p className="text-xs text-slate-500">
                Click any project card to view full details and submit a field report
              </p>
            </div>

            {/* Works Grid */}
            {loadingWorks ? (
              <div className="flex flex-col items-center justify-center p-12 bg-white rounded-2xl border border-slate-200">
                <RefreshCw className="h-8 w-8 text-blue-600 animate-spin mb-3" />
                <p className="text-sm font-medium text-slate-600">Retrieving official work records...</p>
              </div>
            ) : works.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {works.map((work) => (
                  <div
                    key={work.work_id}
                    onClick={() => void openWorkDetails(work)}
                    className="group bg-white rounded-xl border border-slate-200 hover:border-blue-400 hover:shadow-lg transition-all p-5 flex flex-col justify-between cursor-pointer relative"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <span className="inline-block px-2.5 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-slate-100 text-slate-700 border border-slate-200">
                          {work.category.replaceAll("_", " ")}
                        </span>
                        <span
                          className={`inline-block px-2.5 py-0.5 rounded text-[11px] font-bold capitalize ${
                            work.status === "completed"
                              ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                              : work.status === "in_progress"
                              ? "bg-blue-100 text-blue-800 border border-blue-200"
                              : "bg-amber-100 text-amber-800 border border-amber-200"
                          }`}
                        >
                          {work.status.replaceAll("_", " ")}
                        </span>
                      </div>

                      <h4 className="text-sm sm:text-base font-bold text-slate-900 group-hover:text-blue-600 line-clamp-2 transition-colors">
                        {work.title}
                      </h4>

                      <div className="text-xs text-slate-600 space-y-1">
                        <div className="flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                          <span className="truncate">
                            {work.district_name || "District N/A"}, {work.state_name}
                            {work.pincode ? ` (${work.pincode})` : ""}
                          </span>
                        </div>
                        {work.mp_name && (
                          <div className="flex items-center gap-1.5 text-slate-500">
                            <Building2 className="h-3.5 w-3.5 text-slate-400 flex-shrink-0" />
                            <span className="truncate">MP: {work.mp_name}</span>
                          </div>
                        )}
                      </div>

                      {/* Progress Bar */}
                      <div className="pt-1">
                        <div className="flex justify-between text-[11px] font-semibold text-slate-600 mb-1">
                          <span>Recorded Progress</span>
                          <span className="text-blue-700 font-bold">{work.physical_progress_pct}%</span>
                        </div>
                        <div className="w-full bg-slate-100 h-2 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              work.physical_progress_pct >= 100
                                ? "bg-emerald-500"
                                : work.physical_progress_pct > 50
                                ? "bg-blue-600"
                                : "bg-amber-500"
                            }`}
                            style={{ width: `${Math.min(100, Math.max(0, work.physical_progress_pct))}%` }}
                          />
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between text-xs font-bold text-blue-600 group-hover:text-blue-800">
                      <span>View Project Details</span>
                      <ChevronRight className="h-4 w-4 group-hover:translate-x-1 transition-transform" />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 px-4 bg-white rounded-2xl border border-dashed border-slate-300">
                <Building2 className="h-10 w-10 text-slate-400 mx-auto mb-2" />
                <h4 className="text-sm font-bold text-slate-800">No public works match your criteria</h4>
                <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                  Try clearing some search filters or searching for another district or keyword.
                </p>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: Community Raised Issues (Without Login / Public Feed) */}
        {activeTab === "community_issues" && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 p-5 md:p-6 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-blue-600" />
                    <h2 className="text-base sm:text-lg font-bold text-slate-900">
                      Community Raised Civic Issues (Public Ledger)
                    </h2>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Live public social-audit ledger of citizen reports across constituencies. Public transparency mode — citizen personal data is protected.
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Status Filter Buttons */}
                  <div className="inline-flex rounded-lg border border-slate-200 p-1 bg-slate-50 text-xs">
                    {["all", "received", "under_review", "inspection_assigned", "resolved"].map((st) => (
                      <button
                        key={st}
                        onClick={() => setFilterCommunityStatus(st)}
                        className={`px-2.5 py-1 font-semibold rounded-md capitalize transition-all cursor-pointer ${
                          filterCommunityStatus === st ? "bg-blue-600 text-white shadow-sm" : "text-slate-600 hover:text-slate-900"
                        }`}
                      >
                        {st.replaceAll("_", " ")}
                      </button>
                    ))}
                  </div>

                  <button
                    onClick={() => void fetchCommunityIssues()}
                    disabled={loadingCommunityIssues}
                    className="p-2 text-slate-600 hover:text-slate-900 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer"
                    title="Refresh community feed"
                  >
                    <RefreshCw className={`h-4 w-4 ${loadingCommunityIssues ? "animate-spin" : ""}`} />
                  </button>
                </div>
              </div>

              {/* Filter search input */}
              <div className="mt-4">
                <input
                  type="text"
                  value={searchCommunityText}
                  onChange={(e) => setSearchCommunityText(e.target.value)}
                  placeholder="Filter community issues by keyword, title, district, or reference ID..."
                  className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-200 bg-slate-50/70 text-slate-900 placeholder:text-slate-400 focus:bg-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none"
                />
              </div>

              {/* Community Issues List */}
              <div className="mt-5 space-y-4">
                {loadingCommunityIssues ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <RefreshCw className="h-6 w-6 text-blue-600 animate-spin mb-2" />
                    <p className="text-xs text-slate-600">Loading community raised issues...</p>
                  </div>
                ) : filteredCommunityIssues.length > 0 ? (
                  filteredCommunityIssues.map((item) => (
                    <div
                      key={item.reference_id}
                      className="p-4 sm:p-5 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-white hover:border-slate-300 hover:shadow-md transition-all"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-2.5">
                        <div>
                          <div className="flex items-center gap-2 mb-1 flex-wrap">
                            <span className="font-mono text-[11px] font-bold text-slate-600 bg-slate-200/80 px-2 py-0.5 rounded">
                              {item.reference_id}
                            </span>
                            {item.category && (
                              <span className="text-[11px] font-bold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded capitalize">
                                {item.category.replaceAll("_", " ")}
                              </span>
                            )}
                            <span
                              className={`text-[11px] font-bold px-2 py-0.5 rounded capitalize ${
                                item.status === "resolved" || item.status === "closed"
                                  ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                  : item.status === "inspection_assigned"
                                  ? "bg-sky-100 text-sky-800 border border-sky-200"
                                  : item.status === "under_review"
                                  ? "bg-indigo-100 text-indigo-800 border border-indigo-200"
                                  : "bg-amber-100 text-amber-800 border border-amber-200"
                              }`}
                            >
                              {item.status.replaceAll("_", " ")}
                            </span>
                            {item.evidence_received && (
                              <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
                                📷 {item.evidence_count} Live Photo(s)
                              </span>
                            )}
                          </div>
                          <h4 className="text-sm sm:text-base font-bold text-slate-900">{item.work_title}</h4>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {item.district_name ? `${item.district_name}, ` : ""}
                            {item.state_name || "Jurisdiction Disclosed"} · Issue Type:{" "}
                            <span className="font-semibold text-slate-700 capitalize">
                              {item.issue_type.replaceAll("_", " ")}
                            </span>
                          </p>
                        </div>

                        <div className="text-right flex-shrink-0 text-xs text-slate-400">
                          <div className="flex items-center sm:justify-end gap-1">
                            <Clock className="h-3 w-3" />
                            <span>Reported {formatDate(item.submitted_at)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Citizen's Reported Problem */}
                      <div className="mt-2.5 p-3 rounded-lg bg-white border border-slate-200/80">
                        <span className="block text-[10px] font-bold text-slate-400 uppercase tracking-wider mb-1">
                          Reported Observation:
                        </span>
                        <p className="text-xs text-slate-700 leading-relaxed">{item.description}</p>
                      </div>

                      {/* Senior Authority Action / Remarks */}
                      {(item.changes_done || item.status_message) && (
                        <div className="mt-3 p-3 rounded-lg bg-emerald-50/70 border border-emerald-200">
                          <div className="flex items-start gap-2">
                            <CheckCircle2 className="h-4 w-4 text-emerald-700 flex-shrink-0 mt-0.5" />
                            <div className="space-y-0.5">
                              <span className="text-xs font-bold text-emerald-950 uppercase tracking-wider">
                                Senior Authority Action / Changes Done:
                              </span>
                              <p className="text-xs text-emerald-900 font-medium">
                                {item.changes_done || item.status_message}
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  ))
                ) : (
                  <div className="text-center py-12 text-slate-500 text-xs bg-slate-50 rounded-xl border border-dashed border-slate-200">
                    No community issues match the selected filter.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: My Raised Issues & Status (Authenticated Citizen) */}
        {activeTab === "my_issues" && (
          <div className="space-y-6">
            {!user ? (
              /* Not Authenticated Callout */
              <div className="bg-white rounded-2xl border border-slate-200 p-8 text-center max-w-xl mx-auto shadow-sm space-y-4">
                <div className="h-14 w-14 rounded-2xl bg-indigo-50 border border-indigo-100 text-indigo-600 flex items-center justify-center mx-auto text-2xl">
                  🛡️
                </div>
                <div>
                  <h3 className="text-lg font-bold text-slate-900">Sign In to View Your Raised Issues</h3>
                  <p className="text-xs text-slate-500 mt-1 max-w-md mx-auto">
                    Sign in with your citizen account to monitor the real-time status of your submissions, see assigned field inspectors, and view official senior resolution remarks.
                  </p>
                </div>
                <button
                  onClick={() => setLoginModalOpen(true)}
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
                >
                  <User className="h-4 w-4" />
                  Sign In with Citizen Account
                </button>
              </div>
            ) : (
              /* Authenticated Citizen's Personal Issues */
              <div className="bg-white rounded-2xl border border-slate-200 p-5 md:p-6 shadow-sm">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 pb-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-5 w-5 text-indigo-600" />
                      <h2 className="text-base sm:text-lg font-bold text-slate-900">
                        My Reported Civic Issues & Live Lifecycle
                      </h2>
                    </div>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Personal tracker for <span className="font-semibold text-slate-700">{user.full_name || user.username}</span> ({user.email}). Only issues submitted by your account are displayed here.
                    </p>
                  </div>

                  <button
                    onClick={() => void fetchMyIssues()}
                    disabled={loadingMyIssues}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors cursor-pointer"
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${loadingMyIssues ? "animate-spin" : ""}`} />
                    Refresh My Reports
                  </button>
                </div>

                {/* List of Personal Issues */}
                <div className="mt-5 space-y-6">
                  {loadingMyIssues ? (
                    <div className="flex flex-col items-center justify-center py-12">
                      <RefreshCw className="h-6 w-6 text-indigo-600 animate-spin mb-2" />
                      <p className="text-xs text-slate-600">Retrieving your ground reports...</p>
                    </div>
                  ) : myIssues.length > 0 ? (
                    myIssues.map((item) => {
                      // Calculate status step index: 1: received, 2: under_review, 3: inspection_assigned, 4: resolved / closed
                      const stepIndex =
                        item.status === "resolved" || item.status === "closed"
                          ? 4
                          : item.status === "inspection_assigned"
                          ? 3
                          : item.status === "under_review"
                          ? 2
                          : 1;

                      return (
                        <div
                          key={item.reference_id}
                          className="p-5 rounded-2xl border border-slate-200 bg-slate-50/70 hover:bg-white hover:border-slate-300 hover:shadow-md transition-all space-y-4"
                        >
                          {/* Card Header */}
                          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 border-b border-slate-200/60 pb-3">
                            <div>
                              <div className="flex items-center gap-2 mb-1 flex-wrap">
                                <span className="font-mono text-xs font-bold text-indigo-900 bg-indigo-100 px-2.5 py-0.5 rounded">
                                  {item.reference_id}
                                </span>
                                {item.category && (
                                  <span className="text-xs font-bold text-slate-600 bg-white border border-slate-200 px-2 py-0.5 rounded capitalize">
                                    {item.category.replaceAll("_", " ")}
                                  </span>
                                )}
                                <span className="text-xs text-slate-500 font-semibold">
                                  Submitted on {formatDateTime(item.submitted_at)}
                                </span>
                              </div>
                              <h3 className="text-base font-bold text-slate-900">{item.work_title}</h3>
                              <p className="text-xs text-slate-500 mt-0.5">
                                {item.district_name ? `${item.district_name}, ` : ""}
                                {item.state_name || "Jurisdiction Scope"} · Issue:{" "}
                                <span className="font-semibold text-slate-700 capitalize">
                                  {item.issue_type.replaceAll("_", " ")}
                                </span>
                              </p>
                            </div>

                            <div className="text-right flex-shrink-0">
                              <span
                                className={`inline-block text-xs font-bold px-3 py-1 rounded-full capitalize ${
                                  item.status === "resolved" || item.status === "closed"
                                    ? "bg-emerald-100 text-emerald-800 border border-emerald-300"
                                    : item.status === "inspection_assigned"
                                    ? "bg-blue-100 text-blue-800 border border-blue-300"
                                    : item.status === "under_review"
                                    ? "bg-amber-100 text-amber-800 border border-amber-300"
                                    : "bg-slate-200 text-slate-800 border border-slate-300"
                                }`}
                              >
                                ● {item.status.replaceAll("_", " ")}
                              </span>
                            </div>
                          </div>

                          {/* 4-Step Visual Progress Stepper */}
                          <div className="py-2">
                            <div className="grid grid-cols-4 gap-2 text-center relative">
                              {[
                                { label: "1. Received", desc: "Logged in ledger" },
                                { label: "2. Under Review", desc: "DM evaluating" },
                                {
                                  label: "3. Inspection Assigned",
                                  desc: item.assigned_inspector_name
                                    ? item.assigned_inspector_name
                                    : "Inspector dispatched",
                                },
                                { label: "4. Resolved", desc: "Rectified & verified" },
                              ].map((step, idx) => {
                                const isDone = stepIndex >= idx + 1;
                                const isCurrent = stepIndex === idx + 1;
                                return (
                                  <div key={step.label} className="flex flex-col items-center">
                                    <div
                                      className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all mb-1 ${
                                        isDone
                                          ? "bg-emerald-600 text-white shadow-sm"
                                          : "bg-slate-200 text-slate-500"
                                      } ${isCurrent ? "ring-2 ring-emerald-400 ring-offset-2" : ""}`}
                                    >
                                      {isDone ? "✓" : idx + 1}
                                    </div>
                                    <span
                                      className={`text-[11px] font-bold ${
                                        isDone ? "text-slate-900" : "text-slate-400"
                                      }`}
                                    >
                                      {step.label}
                                    </span>
                                    <span className="text-[10px] text-slate-500 truncate max-w-[120px]">
                                      {step.desc}
                                    </span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Citizen's Problem Description */}
                          <div className="p-3.5 rounded-xl bg-white border border-slate-200 space-y-1">
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                              Your Submitted Report Details:
                            </span>
                            <p className="text-xs text-slate-700 leading-relaxed">{item.description}</p>
                            <div className="flex items-center gap-4 text-[11px] text-slate-500 pt-2 border-t border-slate-100 flex-wrap">
                              <span>📷 Evidence: {item.evidence_count} Live Photo(s)</span>
                              {item.location_consent && item.latitude !== null && (
                                <span>
                                  📍 Consented GPS: {item.latitude.toFixed(5)}, {item.longitude?.toFixed(5)}
                                </span>
                              )}
                              {item.assigned_inspector_name && (
                                <span className="text-blue-700 font-semibold">
                                  👮 Assigned Field Inspector: {item.assigned_inspector_name}
                                </span>
                              )}
                            </div>
                          </div>

                          {/* Official Status Message & Resolution Remarks */}
                          {(item.moderation_reason || item.status_message) && (
                            <div className="p-3.5 rounded-xl bg-emerald-50/80 border border-emerald-200 space-y-1.5">
                              <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-950 uppercase tracking-wider">
                                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                                District Authority Resolution & Senior Remarks:
                              </div>
                              {item.moderation_reason && (
                                <p className="text-xs text-emerald-900 font-medium">
                                  {item.moderation_reason}
                                </p>
                              )}
                              {item.status_message && item.status_message !== item.moderation_reason && (
                                <p className="text-[11px] text-emerald-800/90 italic">
                                  Public Notice: &ldquo;{item.status_message}&rdquo;
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-12 px-4 bg-slate-50 rounded-2xl border border-dashed border-slate-200 space-y-2">
                      <FileText className="h-10 w-10 text-slate-400 mx-auto" />
                      <h4 className="text-sm font-bold text-slate-800">You haven't reported any ground issues yet</h4>
                      <p className="text-xs text-slate-500 max-w-md mx-auto">
                        Explore local constituency projects in the "Find Works & Report Ground Issues" tab and use your live camera to report delayed or defective works.
                      </p>
                      <button
                        onClick={() => setActiveTab("search")}
                        className="inline-flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800 cursor-pointer pt-2"
                      >
                        Search Community Works →
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: Transparency & Resolution Feed */}
        {activeTab === "resolved_feed" && (
          <div className="space-y-6">
            <div className="bg-white rounded-2xl border border-slate-200 p-5 md:p-6 shadow-sm">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-slate-100 pb-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-5 w-5 text-amber-500" />
                    <h2 className="text-base sm:text-lg font-bold text-slate-900">
                      Senior Resolution Remarks & Updates Feed
                    </h2>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Real-time transparency into how district authorities and senior admins address social audit reports, including changes done and field rectifications.
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  <div className="inline-flex rounded-lg border border-slate-200 p-1 bg-slate-50">
                    <button
                      onClick={() => setFilterUpdateStatus("all")}
                      className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                        filterUpdateStatus === "all" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      All
                    </button>
                    <button
                      onClick={() => setFilterUpdateStatus("resolved")}
                      className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                        filterUpdateStatus === "resolved" ? "bg-emerald-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      Resolved
                    </button>
                    <button
                      onClick={() => setFilterUpdateStatus("in_progress")}
                      className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
                        filterUpdateStatus === "in_progress" ? "bg-blue-600 text-white shadow-sm" : "text-slate-500 hover:text-slate-800"
                      }`}
                    >
                      Under Review
                    </button>
                  </div>

                  <button
                    onClick={() => void fetchRecentUpdates()}
                    disabled={loadingUpdates}
                    className="p-2 text-slate-600 hover:text-slate-900 rounded-lg border border-slate-200 hover:bg-slate-50 transition-colors"
                    title="Refresh feed"
                  >
                    <RefreshCw className={`h-4 w-4 ${loadingUpdates ? "animate-spin" : ""}`} />
                  </button>
                </div>
              </div>

              {/* Updates List */}
              <div className="mt-5 space-y-4">
                {loadingUpdates ? (
                  <div className="flex flex-col items-center justify-center py-12">
                    <RefreshCw className="h-6 w-6 text-emerald-600 animate-spin mb-2" />
                    <p className="text-xs text-slate-600">Loading verified social audit records...</p>
                  </div>
                ) : filteredUpdates.length > 0 ? (
                  filteredUpdates.map((item) => (
                    <div
                      key={item.reference_id}
                      className="p-4 sm:p-5 rounded-xl border border-slate-200 bg-slate-50/50 hover:bg-white hover:border-slate-300 hover:shadow-md transition-all"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-2.5">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-mono text-[11px] font-bold text-slate-500 bg-slate-200/70 px-2 py-0.5 rounded">
                              {item.reference_id}
                            </span>
                            {item.category && (
                              <span className="text-[11px] font-bold text-slate-600 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded capitalize">
                                {item.category.replaceAll("_", " ")}
                              </span>
                            )}
                            <span
                              className={`text-[11px] font-bold px-2 py-0.5 rounded capitalize ${
                                item.status === "resolved" || item.status === "closed"
                                  ? "bg-emerald-100 text-emerald-800 border border-emerald-200"
                                  : item.status === "inspection_assigned"
                                  ? "bg-sky-100 text-sky-800 border border-sky-200"
                                  : "bg-amber-100 text-amber-800 border border-amber-200"
                              }`}
                            >
                              {item.status.replaceAll("_", " ")}
                            </span>
                          </div>
                          <h4 className="text-sm sm:text-base font-bold text-slate-900">{item.work_title}</h4>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {item.district_name ? `${item.district_name}, ` : ""}
                            {item.state_name || "Jurisdiction Disclosed"} · Reported as{" "}
                            <span className="font-semibold text-slate-700">{item.issue_type.replaceAll("_", " ")}</span>
                          </p>
                        </div>

                        <div className="text-right flex-shrink-0 text-xs text-slate-400">
                          <div className="flex items-center sm:justify-end gap-1">
                            <Clock className="h-3 w-3" />
                            <span>Updated {formatDate(item.updated_at)}</span>
                          </div>
                        </div>
                      </div>

                      {/* Prominent "Changes Done" Box */}
                      <div className="mt-3 p-3.5 rounded-lg bg-emerald-50/70 border border-emerald-200/80">
                        <div className="flex items-start gap-2">
                          <CheckCircle2 className="h-4 w-4 text-emerald-700 flex-shrink-0 mt-0.5" />
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5">
                              <span className="text-xs font-bold text-emerald-950 uppercase tracking-wider">
                                Action Taken & Changes Done:
                              </span>
                            </div>
                            <p className="text-xs text-emerald-900 font-medium leading-relaxed">
                              {item.changes_done}
                            </p>
                            {item.status_message && item.status_message !== item.changes_done && (
                              <p className="text-[11px] text-emerald-800/90 italic pt-0.5">
                                Public Remark: &ldquo;{item.status_message}&rdquo;
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-10 text-slate-500 text-xs">
                    No resolution records currently available under this status filter.
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </main>

      {/* MODAL 1: WORK FULL DETAILS */}
      {selectedWorkId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto overflow-x-hidden border border-slate-200">
            {loadingDetail || !selectedWorkDetail ? (
              <div className="flex flex-col items-center justify-center p-12">
                <RefreshCw className="h-8 w-8 text-blue-600 animate-spin mb-3" />
                <p className="text-sm font-medium text-slate-600">Loading project disclosure...</p>
              </div>
            ) : (
              <div className="p-5 sm:p-6 space-y-4">
                {/* Header */}
                <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                      <span className="text-xs font-bold uppercase bg-blue-100 text-blue-800 px-2.5 py-0.5 rounded">
                        {selectedWorkDetail.category.replaceAll("_", " ")}
                      </span>
                      <span
                        className={`text-xs font-bold px-2.5 py-0.5 rounded capitalize ${
                          selectedWorkDetail.status === "completed"
                            ? "bg-emerald-100 text-emerald-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {selectedWorkDetail.status.replaceAll("_", " ")}
                      </span>
                    </div>
                    <h3 className="text-base sm:text-lg font-bold text-slate-900 leading-snug break-words">
                      {selectedWorkDetail.title}
                    </h3>
                    <p className="text-xs text-slate-500 font-mono mt-0.5 truncate">ID: {selectedWorkDetail.work_id}</p>
                  </div>
                  <button
                    onClick={() => setSelectedWorkId(null)}
                    className="p-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 transition-colors flex-shrink-0"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {/* Description */}
                <div>
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
                    Project Scope & Description
                  </h4>
                  <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 p-3 rounded-lg border border-slate-100 break-words">
                    {selectedWorkDetail.description || "Official MPLADS public infrastructure project."}
                  </p>
                </div>

                {/* Key Metrics Grid */}
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 text-xs">
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 min-w-0">
                    <span className="text-slate-500 block text-[11px]">Recorded Progress</span>
                    <span className="text-sm sm:text-base font-bold text-blue-700">
                      {selectedWorkDetail.physical_progress_pct}%
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 min-w-0">
                    <span className="text-slate-500 block text-[11px]">District / State</span>
                    <span className="font-bold text-slate-800 truncate block text-xs">
                      {selectedWorkDetail.district_name || "N/A"}, {selectedWorkDetail.state_name}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 min-w-0">
                    <span className="text-slate-500 block text-[11px]">Member of Parliament</span>
                    <span className="font-bold text-slate-800 truncate block text-xs">
                      {selectedWorkDetail.mp_name || "Not published"}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 min-w-0">
                    <span className="text-slate-500 block text-[11px]">Constituency</span>
                    <span className="font-bold text-slate-800 truncate block text-xs">
                      {selectedWorkDetail.constituency || "Not published"}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 min-w-0">
                    <span className="text-slate-500 block text-[11px]">Target Completion</span>
                    <span className="font-bold text-slate-800 block text-xs truncate">
                      {formatDate(selectedWorkDetail.expected_completion_date)}
                    </span>
                  </div>
                  <div className="p-2.5 rounded-lg bg-slate-50 border border-slate-100 min-w-0">
                    <span className="text-slate-500 block text-[11px]">Site Address</span>
                    <span className="font-bold text-slate-800 truncate block text-xs">
                      {selectedWorkDetail.location_address || "District Site"}
                    </span>
                  </div>
                </div>

                {/* Action footer */}
                <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                  <div className="text-[11px] text-slate-500 flex items-center gap-1.5 min-w-0">
                    <ShieldCheck className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                    <span className="truncate">Routed to District Authority & Admin moderation</span>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button
                      type="button"
                      onClick={() => setSelectedWorkId(null)}
                      className="flex-1 sm:flex-none px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
                    >
                      Close
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        const w = selectedWorkDetail;
                        setSelectedWorkId(null);
                        startReporting(w);
                      }}
                      className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-600/20 transition-all cursor-pointer whitespace-nowrap"
                    >
                      <Camera className="h-3.5 w-3.5" />
                      Report Ground Issue
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL 2: REPORT GROUND ISSUE WITH CAMERA & UP TO 3 PHOTOS */}
      {reportModalOpen && reportingWork && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full max-h-[92vh] overflow-y-auto overflow-x-hidden border border-slate-200">
            <form onSubmit={handleSubmitIssue} className="p-6 space-y-5">
              {/* Modal Header */}
              <div className="flex items-start justify-between gap-3 border-b border-slate-100 pb-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
                    <span className="text-xs font-bold uppercase tracking-wider text-rose-600">
                      Community Ground Report
                    </span>
                  </div>
                  <h3 className="text-base sm:text-lg font-bold text-slate-900 mt-1">
                    Report Issue for: {reportingWork.title}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Attach real-time ground photos and elaborate what is happening on site.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setReportModalOpen(false);
                    stopCameraStream();
                  }}
                  className="p-1.5 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {/* Issue Type */}
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Issue Classification <span className="text-rose-500">*</span>
                </label>
                <select
                  value={issueType}
                  onChange={(e) => setIssueType(e.target.value as CitizenIssueType)}
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 bg-white text-slate-900 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none"
                  required
                >
                  {ISSUE_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label} — {t.description}
                    </option>
                  ))}
                </select>
              </div>

              {/* Problem Description */}
              <div>
                <label className="block text-xs font-bold text-slate-800 mb-1">
                  Elaborate Problem Observed On Ground <span className="text-rose-500">*</span>
                </label>
                <textarea
                  value={issueDescription}
                  onChange={(e) => setIssueDescription(e.target.value)}
                  placeholder="Describe your factual observation: e.g., work has been halted for 6 months, substandard brickwork crumbling, no signboard, incomplete boundary wall..."
                  rows={4}
                  minLength={10}
                  maxLength={3000}
                  className="w-full p-3 text-xs rounded-lg border border-slate-300 bg-white text-slate-900 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none resize-y"
                  required
                />
                <div className="flex justify-between text-[11px] text-slate-400 mt-1">
                  <span>Minimum 10 characters</span>
                  <span>{issueDescription.length} / 3000</span>
                </div>
              </div>

              {/* REAL-TIME CAMERA ONLY (ANTI-AI TAMPER VERIFICATION) */}
              <div className="space-y-3 bg-slate-50 p-4 rounded-xl border border-slate-200">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Camera className="h-4 w-4 text-slate-800" />
                    <span className="text-xs font-bold text-slate-900">
                      Real-Time Camera Evidence (Max 3 Photos)
                    </span>
                  </div>
                  <span className="text-[11px] font-semibold text-slate-500">
                    {selectedFiles.length} of 3 photos captured
                  </span>
                </div>

                {/* Anti-AI Security Integrity Notice */}
                <div className="flex items-start gap-2 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 text-[11px] leading-relaxed">
                  <ShieldCheck className="h-4 w-4 text-amber-600 flex-shrink-0 mt-0.5" />
                  <span>
                    <strong>Anti-Tamper Live Capture:</strong> Device file uploads are strictly disabled to prevent AI-generated, morphed, or recycled images. Only real-time photos taken directly on site are verified.
                  </span>
                </div>

                {/* Camera Action Button */}
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      if (cameraActive) {
                        stopCameraStream();
                      } else {
                        void startLiveCamera();
                      }
                    }}
                    disabled={selectedFiles.length >= 3}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-xs font-bold transition-all shadow-sm cursor-pointer ${
                      cameraActive
                        ? "bg-rose-600 hover:bg-rose-700 text-white"
                        : "bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                    }`}
                  >
                    <Camera className="h-3.5 w-3.5" />
                    {cameraActive ? "Hide Camera Viewfinder" : "Open Live Camera"}
                  </button>
                </div>

                {/* Live Camera Viewfinder if active */}
                {cameraActive && (
                  <div className="mt-3 relative rounded-xl overflow-hidden bg-black border-2 border-blue-500 shadow-inner">
                    <video
                      ref={setVideoRef}
                      autoPlay
                      playsInline
                      muted
                      className="w-full h-56 sm:h-64 object-cover bg-black"
                    />
                    <div className="absolute top-2 right-2 z-10">
                      <button
                        type="button"
                        onClick={() => void flipCamera()}
                        className="px-2.5 py-1 rounded-md bg-black/60 hover:bg-black/80 text-white text-[11px] font-semibold border border-white/20 backdrop-blur-sm transition-all shadow cursor-pointer"
                        title="Switch Camera (Front/Rear)"
                      >
                        🔄 Switch Camera
                      </button>
                    </div>
                    <div className="absolute bottom-3 left-0 right-0 flex justify-center items-center gap-3 z-10">
                      <button
                        type="button"
                        onClick={capturePhotoFromCamera}
                        disabled={selectedFiles.length >= 3}
                        className="px-5 py-2 rounded-full bg-amber-500 hover:bg-amber-600 text-slate-900 font-black text-xs shadow-xl flex items-center gap-2 transition-transform active:scale-95 cursor-pointer"
                      >
                        📸 Take Snapshot ({3 - selectedFiles.length} remaining)
                      </button>
                    </div>
                  </div>
                )}

                {cameraError && (
                  <p className="text-[11px] text-rose-600 font-medium">{cameraError}</p>
                )}

                {/* Previews of attached images */}
                {imagePreviews.length > 0 && (
                  <div className="grid grid-cols-3 gap-2 pt-2">
                    {imagePreviews.map((src, index) => (
                      <div
                        key={index}
                        className="relative rounded-lg overflow-hidden border border-slate-300 aspect-square bg-slate-200 group"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={src}
                          alt={`Evidence preview ${index + 1}`}
                          className="w-full h-full object-cover"
                        />
                        <button
                          type="button"
                          onClick={() => removePhoto(index)}
                          className="absolute top-1 right-1 p-1 rounded-full bg-rose-600 text-white shadow-md hover:bg-rose-700 transition-colors"
                          title="Remove photo"
                        >
                          <X className="h-3 w-3" />
                        </button>
                        <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-black/60 text-white">
                          Photo {index + 1}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Optional Location Consent */}
              <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <label className="flex items-start gap-2.5 text-xs text-slate-700 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={locationConsent}
                    onChange={(e) => {
                      setLocationConsent(e.target.checked);
                      if (!e.target.checked) setCapturedLocation(null);
                    }}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>
                    <strong>Consent to share current location:</strong> Check this to record GPS coordinates verifying that you are present near the project site.
                  </span>
                </label>

                {locationConsent && (
                  <div className="flex items-center gap-3 pt-1">
                    <button
                      type="button"
                      onClick={handleCaptureLocation}
                      disabled={capturingGps}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                    >
                      <MapPin className="h-3.5 w-3.5 text-blue-600" />
                      {capturingGps ? "Acquiring GPS..." : capturedLocation ? "Recapture Location" : "Acquire GPS"}
                    </button>
                    {capturedLocation && (
                      <span className="text-[11px] text-emerald-700 font-semibold">
                        ✓ Coordinates captured ({capturedLocation.latitude.toFixed(4)}, {capturedLocation.longitude.toFixed(4)})
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Human Anti-Spam Challenge */}
              <div className="p-3.5 rounded-xl bg-blue-50/50 border border-blue-200">
                <div className="flex items-center justify-between mb-1.5">
                  <label className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                    <span>Human Verification:</span>
                    <span className="text-blue-700 bg-white px-2 py-0.5 rounded border border-blue-200 font-mono">
                      {challenge ? challenge.prompt : "Loading challenge..."}
                    </span>
                  </label>
                  <button
                    type="button"
                    onClick={() => void fetchChallenge()}
                    className="text-[11px] text-blue-600 hover:underline font-semibold"
                  >
                    Refresh
                  </button>
                </div>
                <input
                  type="text"
                  value={captchaAnswer}
                  onChange={(e) => setCaptchaAnswer(e.target.value)}
                  placeholder="Enter answer here"
                  required
                  className="w-full px-3 py-1.5 text-xs rounded-md border border-slate-300 bg-white text-slate-900 focus:border-blue-600 outline-none"
                />
              </div>

              {/* Submit Buttons */}
              <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setReportModalOpen(false);
                    stopCameraStream();
                  }}
                  className="px-4 py-2 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:bg-slate-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingIssue || !issueDescription.trim()}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-lg bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold shadow-md shadow-rose-600/20 disabled:opacity-50 cursor-pointer"
                >
                  <Camera className={`h-4 w-4 ${submittingIssue ? "animate-spin" : ""}`} />
                  {submittingIssue ? "Transmitting Report & Photos..." : "Submit Ground Report"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 3: SUBMISSION SUCCESS NOTIFICATION */}
      {submissionSuccessModal && receipt && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 text-center border border-slate-200 space-y-4">
            <div className="h-14 w-14 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center mx-auto text-2xl">
              ✓
            </div>

            <div>
              <h3 className="text-lg font-bold text-slate-900">Ground Report Submitted Successfully</h3>
              <p className="text-xs text-slate-500 mt-1">
                Your observations and evidence photos have been securely encrypted and routed to the District Authority and Administrative oversight queue.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-left space-y-1.5 font-mono text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500 font-sans">Reference ID:</span>
                <span className="font-bold text-slate-900">{receipt.reference_id}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-sans">Status:</span>
                <span className="font-bold text-blue-600 uppercase">{receipt.status}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500 font-sans">Submitted At:</span>
                <span className="text-slate-700">{formatDateTime(receipt.submitted_at)}</span>
              </div>
            </div>

            <div className="pt-2 flex flex-col gap-2">
              <button
                onClick={() => {
                  setSubmissionSuccessModal(false);
                  setActiveTab("resolved_feed");
                  void fetchRecentUpdates();
                }}
                className="w-full py-2.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
              >
                View Public Resolution Feed
              </button>
              <button
                onClick={() => setSubmissionSuccessModal(false)}
                className="w-full py-2 text-xs font-semibold text-slate-600 hover:text-slate-900 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: CITIZEN LOGIN MODAL */}
      {loginModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm animate-in fade-in">
          <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6 border border-slate-200 space-y-4">
            <div className="flex items-center justify-between border-b border-slate-100 pb-3">
              <div className="flex items-center gap-2">
                <div className="h-8 w-8 rounded-lg bg-amber-500/10 text-amber-600 flex items-center justify-center font-bold">
                  👤
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-900">Citizen Sign In</h3>
                  <p className="text-[11px] text-slate-500">Access your reported issues & real-time updates</p>
                </div>
              </div>
              <button
                onClick={() => setLoginModalOpen(false)}
                className="p-1 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100 cursor-pointer"
              >
                ✕
              </button>
            </div>

            {loginError && (
              <div className="p-2.5 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-xs font-medium">
                {loginError}
              </div>
            )}

            <form onSubmit={handleCitizenLogin} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Email / Username</label>
                <input
                  type="text"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  placeholder="e.g. citizen.demo@samarth-demo.in"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">Password</label>
                <input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-300 focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loginLoading}
                className="w-full py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold shadow-md shadow-blue-600/20 disabled:opacity-50 transition-all cursor-pointer"
              >
                {loginLoading ? "Signing In..." : "Sign In to Citizen Portal"}
              </button>

              {/* Quick Demo Pre-fill */}
              <div className="pt-2 border-t border-slate-100 space-y-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setLoginEmail("citizen.demo@samarth-demo.in");
                    setLoginPassword("Password@123");
                  }}
                  className="w-full py-1.5 px-3 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium transition-colors cursor-pointer text-center"
                >
                  Fill Demo Citizen (citizen.demo@samarth-demo.in)
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
