"use client";

import { useAuth } from "@/lib/auth";
import { formatCurrency, formatDate, STATUS_CONFIG, CATEGORY_LABELS, WorkStatus } from "@/lib/api";
import {
  BriefcaseBusiness,
  Plus,
  AlertTriangle,
  CheckCircle2,
  MapPin,
  Search,
  Filter,
  ArrowRight,
  ExternalLink,
  ShieldCheck,
  Building2,
  Calendar,
  X,
  FileText,
  Navigation,
} from "lucide-react";
import Link from "next/link";
import React, { useCallback, useEffect, useRef, useState } from "react";

interface DuplicateWarning {
  work_id: string;
  title: string;
  status: string;
  distance_meters?: number;
  similarity_score?: number;
  warning_reason: string;
}

interface DuplicateCheckResult {
  has_potential_duplicate: boolean;
  warnings: DuplicateWarning[];
}

interface WorkItem {
  work_id: string;
  title: string;
  status: string;
  category: string;
  sub_category?: string;
  sanctioned_amount: number;
  recommended_date?: string;
  sanctioned_date?: string;
  implementing_agency?: string;
  sc_st_quota_type?: string;
  sanction_order_ref?: string;
  rejection_reason?: string;
  location?: {
    latitude?: number;
    longitude?: number;
    address?: string;
  };
}

const CATEGORIES = [
  { value: "drinking_water", label: "Drinking Water (Handpumps, Water ATMs, RO)" },
  { value: "roads_and_bridges", label: "Roads & Bridges (Bituminous, Concrete, Pathways)" },
  { value: "healthcare", label: "Healthcare (PHCs, Ambulances, Diagnostic Units)" },
  { value: "education", label: "Education (Smart Classrooms, Libraries, Science Labs)" },
  { value: "sanitation", label: "Sanitation (Community Toilet Blocks, Drainage)" },
  { value: "electricity", label: "Electricity & Energy (Solar High-Mast, Transformers)" },
  { value: "community_infrastructure", label: "Community Infrastructure (Barat Ghar, Halls)" },
  { value: "irrigation", label: "Irrigation & Water Conservation (Check Dams, Canals)" },
  { value: "sports", label: "Sports Facilities (Gymnasiums, Mini Stadiums, Turf)" },
  { value: "other", label: "Other Public Utility Assets" },
];

export default function MPRecommendationsPage() {
  const { user, fetchWithAuth } = useAuth();

  const [works, setWorks] = useState<WorkItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Form states
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("drinking_water");
  const [subCategory, setSubCategory] = useState("");
  const [sanctionedAmount, setSanctionedAmount] = useState<string>("");
  const [scStQuota, setScStQuota] = useState<"general" | "sc" | "st">("general");
  const [latitude, setLatitude] = useState<string>("");
  const [longitude, setLongitude] = useState<string>("");
  const [address, setAddress] = useState("");
  const [pincode, setPincode] = useState("");

  // Duplicate check telemetry
  const [dupResult, setDupResult] = useState<DuplicateCheckResult | null>(null);
  const [isCheckingDup, setIsCheckingDup] = useState(false);
  const dupTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const fetchRecommendations = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetchWithAuth("/api/v1/works?page=1&page_size=50&sort_by=created_at&sort_order=desc");
      if (res.ok) {
        const data = await res.json();
        setWorks(data.works || []);
      }
    } catch (err) {
      console.error("Failed to load recommendations:", err);
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth]);

  useEffect(() => {
    void fetchRecommendations();
  }, [fetchRecommendations]);

  // Debounced live pre-submission duplicate check
  useEffect(() => {
    if (!title && (!latitude || !longitude)) {
      setDupResult(null);
      return;
    }

    if (dupTimeoutRef.current) clearTimeout(dupTimeoutRef.current);
    dupTimeoutRef.current = setTimeout(async () => {
      setIsCheckingDup(true);
      try {
        const res = await fetchWithAuth("/api/v1/works/check-duplicate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            title: title.trim() || undefined,
            latitude: latitude ? parseFloat(latitude) : undefined,
            longitude: longitude ? parseFloat(longitude) : undefined,
          }),
        });
        if (res.ok) {
          const data: DuplicateCheckResult = await res.json();
          setDupResult(data);
        }
      } catch (err) {
        console.error("Duplicate check failed:", err);
      } finally {
        setIsCheckingDup(false);
      }
    }, 500);

    return () => {
      if (dupTimeoutRef.current) clearTimeout(dupTimeoutRef.current);
    };
  }, [title, latitude, longitude, fetchWithAuth]);

  const handleDetectLocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser.");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLatitude(pos.coords.latitude.toFixed(6));
        setLongitude(pos.coords.longitude.toFixed(6));
      },
      (err) => {
        console.warn("Geolocation denied, using Varanasi center:", err.message);
        setLatitude("25.317600");
        setLongitude("82.973900");
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleCreateRecommendation = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    const amount = parseFloat(sanctionedAmount);
    if (isNaN(amount) || amount <= 0) {
      setErrorMessage("Please enter a valid positive project outlay.");
      setIsSubmitting(false);
      return;
    }

    const constituency = user?.jurisdiction.constituency || "Varanasi Urban";
    const stateCode = user?.jurisdiction.state_code || "UP";
    const stateName = stateCode === "UP" ? "Uttar Pradesh" : stateCode;
    const districtCode = user?.jurisdiction.district_code || (stateCode === "UP" ? "UP-VNS" : "DEFAULT");
    const districtName = districtCode === "UP-VNS" ? "Varanasi" : "District";

    const payload = {
      title: title.trim(),
      description: description.trim(),
      category,
      sub_category: subCategory.trim(),
      state_code: stateCode,
      state_name: stateName,
      district_code: districtCode,
      district_name: districtName,
      constituency,
      pincode: pincode.trim() || "221001",
      mp_name: user?.full_name || "Hon. Member of Parliament",
      sanctioned_amount: amount,
      sc_st_quota_type: scStQuota,
      location: {
        latitude: latitude ? parseFloat(latitude) : 25.3176,
        longitude: longitude ? parseFloat(longitude) : 82.9739,
        address: address.trim() || `${constituency}, ${districtName}`,
        pincode: pincode.trim() || "221001",
      },
    };

    try {
      const res = await fetchWithAuth("/api/v1/works", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed to submit recommendation" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }

      setSuccessMessage("Work proposal successfully submitted! It has been dispatched to the District Authority for Administrative Sanction.");
      setIsModalOpen(false);
      // Reset form
      setTitle("");
      setDescription("");
      setSanctionedAmount("");
      setAddress("");
      setLatitude("");
      setLongitude("");
      setDupResult(null);
      void fetchRecommendations();
    } catch (err: unknown) {
      setErrorMessage(err instanceof Error ? err.message : "Submission failed");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-6 pb-12">
      {/* ── Page Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-5">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700">
            <BriefcaseBusiness className="h-3.5 w-3.5" />
            MP Project Recommendation Portal
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 mt-1">
            Propose Public Utility Assets
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Submit community project recommendations to District Magistrate / Collector with automated &le;50m spatial duplicate checks.
          </p>
        </div>

        <button
          onClick={() => {
            setIsModalOpen(true);
            setSuccessMessage(null);
            setErrorMessage(null);
          }}
          className="inline-flex items-center gap-2 rounded-xl bg-emerald-600 px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-emerald-700"
        >
          <Plus className="h-4 w-4" />
          Recommend New Work
        </button>
      </div>

      {/* ── Success Banner ── */}
      {successMessage && (
        <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-xs font-semibold text-emerald-900 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            <span>{successMessage}</span>
          </div>
          <button onClick={() => setSuccessMessage(null)} className="text-emerald-700 hover:text-emerald-950 font-bold">
            &times;
          </button>
        </div>
      )}

      {/* ── Statutory Guidance Card ── */}
      <div className="rounded-2xl border border-blue-200 bg-blue-50/60 p-4 sm:p-5 text-xs text-blue-900 shadow-2xs">
        <div className="flex items-start gap-3">
          <ShieldCheck className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h4 className="font-bold text-blue-950">Statutory MPLADS Recommendation Guidelines (Chapter 2)</h4>
            <p className="leading-relaxed text-blue-800">
              Hon&apos;ble MPs recommend works of developmental nature with emphasis on the creation of durable community assets based on locally felt needs.
              Each recommendation transmits instantly to the responsible District Authority (Collector/DM) who conducts technical scrutiny, selects the implementing agency, and accords formal Administrative Sanction.
            </p>
          </div>
        </div>
      </div>

      {/* ── Proposals Register Table ── */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-xs overflow-hidden">
        <div className="border-b border-slate-100 p-5 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">Submitted Project Recommendations</h2>
          <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-600">
            {works.length} Total Projects
          </span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-slate-100 bg-slate-50/60 text-slate-500 uppercase font-semibold">
              <tr>
                <th className="px-5 py-3">Work Title & Details</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3">Quota Tag</th>
                <th className="px-4 py-3">Proposed Outlay</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">DA AS Order / Agency</th>
                <th className="px-5 py-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-slate-400">
                    Loading recommendations…
                  </td>
                </tr>
              ) : works.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-slate-400">
                    No project recommendations submitted yet. Click &quot;Recommend New Work&quot; to begin.
                  </td>
                </tr>
              ) : (
                works.map((work) => {
                  const sc = STATUS_CONFIG[work.status as WorkStatus] || {
                    label: work.status,
                    color: "#475569",
                    bg: "#f1f5f9",
                    border: "#cbd5e1",
                  };
                  return (
                    <tr key={work.work_id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="px-5 py-3.5">
                        <div className="space-y-0.5">
                          <Link
                            href={`/dashboard/works/${work.work_id}`}
                            className="font-bold text-slate-900 hover:text-emerald-700 line-clamp-1"
                          >
                            {work.title}
                          </Link>
                          <p className="text-[11px] text-slate-500 font-mono">{work.work_id.slice(0, 12)}…</p>
                        </div>
                      </td>

                      <td className="px-4 py-3.5 text-slate-600">
                        {CATEGORY_LABELS[work.category as keyof typeof CATEGORY_LABELS] || work.category}
                      </td>

                      <td className="px-4 py-3.5">
                        {work.sc_st_quota_type === "sc" ? (
                          <span className="rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-bold text-indigo-700">
                            SC (15%)
                          </span>
                        ) : work.sc_st_quota_type === "st" ? (
                          <span className="rounded bg-teal-50 px-2 py-0.5 text-[11px] font-bold text-teal-700">
                            ST (7.5%)
                          </span>
                        ) : (
                          <span className="text-slate-400 font-medium text-[11px]">General</span>
                        )}
                      </td>

                      <td className="px-4 py-3.5 font-bold text-slate-900">
                        {formatCurrency(work.sanctioned_amount)}
                      </td>

                      <td className="px-4 py-3.5">
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold"
                          style={{ color: sc.color, backgroundColor: sc.bg }}
                        >
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: sc.color }} />
                          {sc.label}
                        </span>
                      </td>

                      <td className="px-4 py-3.5 text-slate-600">
                        {work.sanction_order_ref ? (
                          <div>
                            <span className="font-mono text-[11px] font-bold text-slate-900 block">
                              {work.sanction_order_ref}
                            </span>
                            <span className="text-[10px] text-slate-500 block truncate max-w-44">
                              {work.implementing_agency}
                            </span>
                          </div>
                        ) : work.status === "recommended" ? (
                          <span className="text-amber-700 font-semibold text-[11px] italic">
                            ⏳ Under District Magistrate Review
                          </span>
                        ) : work.status === "cancelled" && work.rejection_reason ? (
                          <span className="text-rose-700 text-[11px] block truncate max-w-44" title={work.rejection_reason}>
                            Returned: {work.rejection_reason}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>

                      <td className="px-5 py-3.5 text-right">
                        <Link
                          href={`/dashboard/works/${work.work_id}`}
                          className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 py-1 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50 hover:text-emerald-700"
                        >
                          Details
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Recommend Work Modal ── */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs">
          <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl border border-slate-200">
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-100 bg-white px-6 py-4">
              <div>
                <h3 className="text-lg font-bold text-slate-900">Propose New Public Work</h3>
                <p className="text-xs text-slate-500">Official Recommendation under MPLADS Scheme Guidelines</p>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleCreateRecommendation} className="p-6 space-y-4">
              {errorMessage && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs font-semibold text-rose-800">
                  {errorMessage}
                </div>
              )}

              {/* Title */}
              <div>
                <label className="block text-xs font-bold text-slate-800 uppercase mb-1">
                  Project Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Installation of Solar High-Mast Lighting at Shivpur Chauraha"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full h-10 rounded-xl border border-slate-200 px-3 text-xs text-slate-900 focus:border-emerald-600 focus:outline-hidden"
                />
              </div>

              {/* Category & Sub-Category */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-bold text-slate-800 uppercase mb-1">
                    Sector Category *
                  </label>
                  <select
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="w-full h-10 rounded-xl border border-slate-200 px-3 text-xs text-slate-800 focus:border-emerald-600 focus:outline-hidden font-medium"
                  >
                    {CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-800 uppercase mb-1">
                    Sub-Category / Technology
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., Solar LED, Deep Tube Well"
                    value={subCategory}
                    onChange={(e) => setSubCategory(e.target.value)}
                    className="w-full h-10 rounded-xl border border-slate-200 px-3 text-xs text-slate-900 focus:border-emerald-600 focus:outline-hidden"
                  />
                </div>
              </div>

              {/* Proposed Outlay & Quota Tag */}
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-bold text-slate-800 uppercase mb-1">
                    Proposed Financial Outlay (₹ INR) *
                  </label>
                  <input
                    type="number"
                    required
                    min="10000"
                    step="1000"
                    placeholder="e.g., 1850000"
                    value={sanctionedAmount}
                    onChange={(e) => setSanctionedAmount(e.target.value)}
                    className="w-full h-10 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-900 focus:border-emerald-600 focus:outline-hidden"
                  />
                  {sanctionedAmount && !isNaN(parseFloat(sanctionedAmount)) && (
                    <p className="mt-1 text-[11px] text-emerald-700 font-semibold">
                      = {formatCurrency(parseFloat(sanctionedAmount))}
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-800 uppercase mb-1">
                    Statutory Beneficiary Designation
                  </label>
                  <div className="flex items-center gap-2 pt-1">
                    <label className="flex items-center gap-1.5 text-xs text-slate-700 font-semibold cursor-pointer">
                      <input
                        type="radio"
                        name="quota"
                        value="general"
                        checked={scStQuota === "general"}
                        onChange={() => setScStQuota("general")}
                        className="text-emerald-600"
                      />
                      General
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-indigo-800 font-semibold cursor-pointer">
                      <input
                        type="radio"
                        name="quota"
                        value="sc"
                        checked={scStQuota === "sc"}
                        onChange={() => setScStQuota("sc")}
                        className="text-indigo-600"
                      />
                      SC (15% Mandate)
                    </label>
                    <label className="flex items-center gap-1.5 text-xs text-teal-800 font-semibold cursor-pointer">
                      <input
                        type="radio"
                        name="quota"
                        value="st"
                        checked={scStQuota === "st"}
                        onChange={() => setScStQuota("st")}
                        className="text-teal-600"
                      />
                      ST (7.5% Mandate)
                    </label>
                  </div>
                </div>
              </div>

              {/* Description & Justification */}
              <div>
                <label className="block text-xs font-bold text-slate-800 uppercase mb-1">
                  Community Benefit & Public Utility Justification *
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="Describe the public utility necessity, beneficiary village/ward, and rationale for MPLADS funding…"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 p-3 text-xs text-slate-900 focus:border-emerald-600 focus:outline-hidden"
                />
              </div>

              {/* Geographic Coordinates & Location */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-800 uppercase flex items-center gap-1.5">
                    <MapPin className="h-3.5 w-3.5 text-emerald-700" />
                    Spatial Coordinates & Geo-Tagging
                  </span>
                  <button
                    type="button"
                    onClick={handleDetectLocation}
                    className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-700 hover:text-emerald-800"
                  >
                    <Navigation className="h-3 w-3" />
                    Detect Current GPS
                  </button>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Latitude</label>
                    <input
                      type="number"
                      step="any"
                      placeholder="e.g. 25.3176"
                      value={latitude}
                      onChange={(e) => setLatitude(e.target.value)}
                      className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-mono text-slate-900 focus:border-emerald-600 focus:outline-hidden"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Longitude</label>
                    <input
                      type="number"
                      step="any"
                      placeholder="e.g. 82.9739"
                      value={longitude}
                      onChange={(e) => setLongitude(e.target.value)}
                      className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-mono text-slate-900 focus:border-emerald-600 focus:outline-hidden"
                    />
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Address / Landmark</label>
                    <input
                      type="text"
                      placeholder="e.g., Near Primary School, Ward 12"
                      value={address}
                      onChange={(e) => setAddress(e.target.value)}
                      className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-900 focus:border-emerald-600 focus:outline-hidden"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-600 mb-0.5">Pincode</label>
                    <input
                      type="text"
                      maxLength={6}
                      placeholder="e.g., 221002"
                      value={pincode}
                      onChange={(e) => setPincode(e.target.value)}
                      className="w-full h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-mono text-slate-900 focus:border-emerald-600 focus:outline-hidden"
                    />
                  </div>
                </div>
              </div>

              {/* ── Pre-Submission Duplicate Check Visual Alert ── */}
              {isCheckingDup ? (
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-500 flex items-center gap-2">
                  <div className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
                  Running automated &le;50m spatial duplicate check…
                </div>
              ) : dupResult ? (
                dupResult.has_potential_duplicate ? (
                  <div className="rounded-xl border-2 border-amber-400 bg-amber-50/80 p-4 space-y-2">
                    <div className="flex items-center gap-2 text-xs font-bold text-amber-950 uppercase">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      Spatial Proximity Warning (&le; 50m Rule)
                    </div>
                    <div className="space-y-1">
                      {dupResult.warnings.map((w, idx) => (
                        <div key={idx} className="text-xs text-amber-900 bg-white/60 rounded-lg p-2 border border-amber-200">
                          <p className="font-semibold">{w.warning_reason}</p>
                          <p className="text-[11px] text-amber-800">
                            Target Asset: <strong>{w.title}</strong> (Status: {w.status})
                          </p>
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-amber-800 italic">
                      Note: You can still submit this proposal if this represents an expansion or separate community phase. The District Magistrate will conduct physical verification.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-xs font-semibold text-emerald-900 flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                    Spatial Feasibility Passed: No existing public assets detected within 50 meters.
                  </div>
                )
              ) : null}

              {/* Modal Buttons */}
              <div className="flex items-center justify-end gap-3 pt-4 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="rounded-xl border border-slate-200 px-4 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="rounded-xl bg-emerald-600 px-5 py-2 text-xs font-bold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
                >
                  {isSubmitting ? "Submitting Proposal…" : "Submit Official Recommendation"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
