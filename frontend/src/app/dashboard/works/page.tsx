"use client";

import { useAuth } from "@/lib/auth";
import {
  WorkSummary,
  WorkListResponse,
  WorkMapResponse,
  WorkStatus,
  STATUS_CONFIG,
  CATEGORY_LABELS,
  formatCurrency,
  formatDate,
  WorkCategory,
} from "@/lib/api";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import React, { useCallback, useEffect, useRef, useState, Suspense } from "react";

const WorkExplorerMap = dynamic(
  () => import("@/components/maps/work-explorer-map").then((module) => module.WorkExplorerMap),
  { ssr: false, loading: () => <div className="grid h-[28rem] place-items-center rounded-xl border border-sky-100 bg-slate-50 text-sm text-slate-500">Loading work map…</div> },
);

// ── Constants ───────────────────────────────────────────────────

const API_URL = "/api/v1/works";

const ALL_STATUSES: WorkStatus[] = [
  "recommended",
  "under_review",
  "sanctioned",
  "in_progress",
  "on_hold",
  "completed",
  "under_verification",
  "cancelled",
];

const ALL_CATEGORIES: WorkCategory[] = [
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

const PAGE_SIZES = [10, 20, 50];

// ── Component ───────────────────────────────────────────────────

export default function WorksListPage() {
  const { user, fetchWithAuth, isLoading: authLoading } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const urlStatus = searchParams?.get("status") || "";

  // Data state
  const [works, setWorks] = useState<WorkSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [statusFilter, setStatusFilter] = useState<string>(urlStatus);
  const [categoryFilter, setCategoryFilter] = useState<string>("");
  const [riskTierFilter, setRiskTierFilter] = useState<string>("");
  const [stateCodeFilter, setStateCodeFilter] = useState("");
  const [districtCodeFilter, setDistrictCodeFilter] = useState("");
  const [constituencyFilter, setConstituencyFilter] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState("created_at");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

  // Sync URL parameter if it changes
  useEffect(() => {
    const s = searchParams?.get("status");
    if (s !== null && s !== undefined && s !== statusFilter) {
      setStatusFilter(s);
      setPage(1);
    }
  }, [searchParams]);

  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [mapData, setMapData] = useState<WorkMapResponse | null>(null);
  const [isMapLoading, setIsMapLoading] = useState(true);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapRevision, setMapRevision] = useState(0);

  // Debounce search
  useEffect(() => {
    if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    searchTimeoutRef.current = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 400);
    return () => {
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
    };
  }, [search]);

  const applySharedFilters = useCallback((params: URLSearchParams) => {
    if (statusFilter) params.set("status", statusFilter);
    if (categoryFilter) params.set("category", categoryFilter);
    if (riskTierFilter) params.set("risk_tier", riskTierFilter);
    if (stateCodeFilter.trim()) params.set("state_code", stateCodeFilter.trim());
    if (districtCodeFilter.trim()) params.set("district_code", districtCodeFilter.trim());
    if (constituencyFilter.trim()) params.set("constituency", constituencyFilter.trim());
    if (debouncedSearch) params.set("search", debouncedSearch);
  }, [statusFilter, categoryFilter, riskTierFilter, stateCodeFilter, districtCodeFilter, constituencyFilter, debouncedSearch]);

  // Fetch works
  const fetchWorks = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    const params = new URLSearchParams({
      page: String(page),
      page_size: String(pageSize),
      sort_by: sortBy,
      sort_order: sortOrder,
    });
    applySharedFilters(params);

    try {
      const res = await fetchWithAuth(`${API_URL}?${params.toString()}`);
      if (res.status === 403) {
        setError("PERMISSION_DENIED");
        setIsLoading(false);
        return;
      }
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: "Failed to load works" }));
        throw new Error(err.detail || `HTTP ${res.status}`);
      }
      const data: WorkListResponse = await res.json();
      setWorks(data.works);
      setTotal(data.total);
      setTotalPages(data.total_pages);
    } catch (err: unknown) {
      if (err instanceof Error && err.message === "PERMISSION_DENIED") {
        setError("PERMISSION_DENIED");
      } else {
        setError(err instanceof Error ? err.message : "Failed to load works");
      }
    } finally {
      setIsLoading(false);
    }
  }, [page, pageSize, sortBy, sortOrder, fetchWithAuth, applySharedFilters]);

  const fetchMapWorks = useCallback(async () => {
    setIsMapLoading(true);
    setMapError(null);
    const params = new URLSearchParams({ page: "1", page_size: "500" });
    applySharedFilters(params);
    try {
      const res = await fetchWithAuth(`${API_URL}/map?${params.toString()}`);
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ detail: "Failed to load work map" }));
        throw new Error(payload.detail || `HTTP ${res.status}`);
      }
      setMapData(await res.json() as WorkMapResponse);
      setMapRevision((current) => current + 1);
    } catch (err: unknown) {
      setMapError(err instanceof Error ? err.message : "Failed to load work map");
    } finally {
      setIsMapLoading(false);
    }
  }, [fetchWithAuth, applySharedFilters]);

  useEffect(() => {
    if (authLoading || !user) return;
    const timer = window.setTimeout(() => { void fetchWorks(); void fetchMapWorks(); }, 0);
    return () => window.clearTimeout(timer);
  }, [fetchWorks, fetchMapWorks, authLoading, user]);

  // Sort handler
  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortOrder("desc");
    }
    setPage(1);
  };

  // ── Auth loading ────────────────────────────────────────────
  if (authLoading) {
    return (
      <div style={s.pageWrap}>
        <div style={s.spinner} />
        <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      </div>
    );
  }

  if (!user) {
    return (
      <div style={s.pageWrap}>
        <p style={{ color: "#94a3b8" }}>Not authenticated. Redirecting…</p>
      </div>
    );
  }

  // ── Permission denied ───────────────────────────────────────
  if (error === "PERMISSION_DENIED") {
    return (
      <div style={s.pageWrap}>
        <div style={s.container}>
          <Header user={user} onBack={() => router.push("/dashboard")} />
          <div style={s.emptyState}>
            <div style={s.emptyIcon}>🔒</div>
            <h2 style={s.emptyTitle}>Insufficient Permissions</h2>
            <p style={s.emptyDesc}>
              Your role ({user.role}) does not have permission to view works.
              Contact your administrator for access.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={s.pageWrap}>
      <div style={s.container}>
        <Header user={user} onBack={() => router.push("/dashboard")} />

        {/* ── Quick Filter Tabs ────────────────────────────── */}
        <div style={{ display: "flex", gap: "0.5rem", marginBottom: "1rem", flexWrap: "wrap", alignItems: "center" }}>
          <button
            type="button"
            onClick={() => { setStatusFilter(""); setRiskTierFilter(""); setPage(1); }}
            style={{
              padding: "0.4rem 0.85rem",
              borderRadius: "20px",
              fontSize: "0.78rem",
              fontWeight: 650,
              cursor: "pointer",
              border: statusFilter === "" && riskTierFilter === "" ? "1px solid #2563eb" : "1px solid #cbd5e1",
              backgroundColor: statusFilter === "" && riskTierFilter === "" ? "#eff6ff" : "#ffffff",
              color: statusFilter === "" && riskTierFilter === "" ? "#1d4ed8" : "#475569",
              transition: "all 0.15s ease",
            }}
          >
            All Works
          </button>
          <button
            type="button"
            onClick={() => { setStatusFilter("recommended"); setRiskTierFilter(""); setPage(1); }}
            style={{
              padding: "0.4rem 0.85rem",
              borderRadius: "20px",
              fontSize: "0.78rem",
              fontWeight: 650,
              cursor: "pointer",
              display: "inline-flex",
              alignItems: "center",
              gap: "0.4rem",
              border: statusFilter === "recommended" ? "1px solid #7c3aed" : "1px solid #cbd5e1",
              backgroundColor: statusFilter === "recommended" ? "#f5f3ff" : "#ffffff",
              color: statusFilter === "recommended" ? "#6d28d9" : "#475569",
              boxShadow: statusFilter === "recommended" ? "0 1px 4px rgba(124, 58, 237, 0.2)" : "none",
              transition: "all 0.15s ease",
            }}
          >
            <span>📋 MP Recommendations (Pending Sanction)</span>
            <span
              style={{
                fontSize: "0.68rem",
                padding: "1px 6px",
                borderRadius: "10px",
                backgroundColor: statusFilter === "recommended" ? "#7c3aed" : "#f1f5f9",
                color: statusFilter === "recommended" ? "#ffffff" : "#64748b",
                fontWeight: 700,
              }}
            >
              Actionable
            </span>
          </button>
          <button
            type="button"
            onClick={() => { setStatusFilter("sanctioned"); setRiskTierFilter(""); setPage(1); }}
            style={{
              padding: "0.4rem 0.85rem",
              borderRadius: "20px",
              fontSize: "0.78rem",
              fontWeight: 650,
              cursor: "pointer",
              border: statusFilter === "sanctioned" ? "1px solid #0284c7" : "1px solid #cbd5e1",
              backgroundColor: statusFilter === "sanctioned" ? "#f0f9ff" : "#ffffff",
              color: statusFilter === "sanctioned" ? "#0369a1" : "#475569",
              transition: "all 0.15s ease",
            }}
          >
            🏛️ Sanctioned
          </button>
          <button
            type="button"
            onClick={() => { setStatusFilter("in_progress"); setRiskTierFilter(""); setPage(1); }}
            style={{
              padding: "0.4rem 0.85rem",
              borderRadius: "20px",
              fontSize: "0.78rem",
              fontWeight: 650,
              cursor: "pointer",
              border: statusFilter === "in_progress" ? "1px solid #16a34a" : "1px solid #cbd5e1",
              backgroundColor: statusFilter === "in_progress" ? "#f0fdf4" : "#ffffff",
              color: statusFilter === "in_progress" ? "#15803d" : "#475569",
              transition: "all 0.15s ease",
            }}
          >
            🔨 In Progress
          </button>
          <button
            type="button"
            onClick={() => { setRiskTierFilter("red"); setStatusFilter(""); setPage(1); }}
            style={{
              padding: "0.4rem 0.85rem",
              borderRadius: "20px",
              fontSize: "0.78rem",
              fontWeight: 650,
              cursor: "pointer",
              border: riskTierFilter === "red" ? "1px solid #dc2626" : "1px solid #cbd5e1",
              backgroundColor: riskTierFilter === "red" ? "#fef2f2" : "#ffffff",
              color: riskTierFilter === "red" ? "#b91c1c" : "#475569",
              transition: "all 0.15s ease",
            }}
          >
            ⚠️ High Risk (Red Tier)
          </button>
        </div>

        {/* ── Search & Filters ──────────────────────────────── */}
        <div style={s.filtersRow}>
          <div style={s.searchWrap}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" style={s.searchIcon}>
              <circle cx="11" cy="11" r="7" stroke="#64748b" strokeWidth="2" />
              <path d="M16 16L21 21" stroke="#64748b" strokeWidth="2" strokeLinecap="round" />
            </svg>
            <input
              id="works-search"
              type="text"
              placeholder="Search works, MPs, agencies…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={s.searchInput}
            />
          </div>

          <select
            id="status-filter"
            value={statusFilter}
            onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
            style={s.select}
          >
            <option value="">All Statuses</option>
            {ALL_STATUSES.map((st) => (
              <option key={st} value={st}>
                {STATUS_CONFIG[st].label}
              </option>
            ))}
          </select>

          <select
            id="category-filter"
            value={categoryFilter}
            onChange={(e) => { setCategoryFilter(e.target.value); setPage(1); }}
            style={s.select}
          >
            <option value="">All Categories</option>
            {ALL_CATEGORIES.map((cat) => (
              <option key={cat} value={cat}>
                {CATEGORY_LABELS[cat]}
              </option>
            ))}
          </select>
          <select value={riskTierFilter} onChange={(e) => { setRiskTierFilter(e.target.value); setPage(1); }} style={s.select} aria-label="Risk tier filter">
            <option value="">All Risk Tiers</option>
            <option value="red">Red risk</option><option value="amber">Amber risk</option><option value="green">Green risk</option>
          </select>
          <input value={stateCodeFilter} onChange={(e) => { setStateCodeFilter(e.target.value); setPage(1); }} style={s.compactInput} aria-label="State code filter" placeholder="State code" maxLength={32} />
          <input value={districtCodeFilter} onChange={(e) => { setDistrictCodeFilter(e.target.value); setPage(1); }} style={s.compactInput} aria-label="District code filter" placeholder="District code" maxLength={32} />
          <input value={constituencyFilter} onChange={(e) => { setConstituencyFilter(e.target.value); setPage(1); }} style={s.compactInput} aria-label="Constituency filter" placeholder="Constituency" maxLength={120} />
        </div>

        <section style={s.mapSection} aria-labelledby="work-map-title">
          <div style={s.mapHeader}><div><h2 id="work-map-title" style={s.mapTitle}>Work locations</h2><p style={s.mapDescription}>Uses the same server-scoped filters as the register. Only coordinates stored with work records are shown.</p></div>{!isMapLoading && mapData && <span style={s.mapCount}>{mapData.works_with_valid_coordinates} mapped · {mapData.works_without_valid_coordinates} without coordinates</span>}</div>
          {isMapLoading && <div style={s.mapState}>Loading permitted work locations…</div>}
          {mapError && <div style={s.mapState}><span>Map unavailable: {mapError}</span><button type="button" style={s.retryBtn} onClick={() => void fetchMapWorks()}>Retry map</button></div>}
          {!isMapLoading && !mapError && mapData && mapData.markers.length === 0 && <div style={s.mapState}>{mapData.total_matching_works ? "Matching works do not have valid stored coordinates yet. No approximate markers are shown." : "No work records match the current filters."}</div>}
          {!isMapLoading && !mapError && mapData && mapData.markers.length > 0 && <><WorkExplorerMap markers={mapData.markers} fitRevision={mapRevision} />{mapData.total_pages > 1 && <p style={s.mapLimitNotice}>Showing the first {mapData.markers.length} of {mapData.works_with_valid_coordinates} mapped works. Refine filters to explore a smaller area.</p>}</>}
        </section>

        {/* ── Results count ─────────────────────────────────── */}
        {!isLoading && !error && (
          <div style={s.resultsBar}>
            <span style={s.resultsCount}>
              {total} work{total !== 1 ? "s" : ""} found
            </span>
            <div style={s.pageSizeWrap}>
              <label style={s.pageSizeLabel}>Show</label>
              <select
                value={pageSize}
                onChange={(e) => { setPageSize(Number(e.target.value)); setPage(1); }}
                style={{ ...s.select, minWidth: 60 }}
              >
                {PAGE_SIZES.map((sz) => (
                  <option key={sz} value={sz}>{sz}</option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* ── Loading ──────────────────────────────────────── */}
        {isLoading && (
          <div style={s.skeletonWrap}>
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={s.skeletonRow}>
                <div style={{ ...s.skeletonBar, width: "25%" }} />
                <div style={{ ...s.skeletonBar, width: "15%" }} />
                <div style={{ ...s.skeletonBar, width: "12%" }} />
                <div style={{ ...s.skeletonBar, width: "10%" }} />
              </div>
            ))}
            <style>{`@keyframes shimmer{0%{background-position:-200px 0}100%{background-position:200px 0}}`}</style>
          </div>
        )}

        {/* ── Error ────────────────────────────────────────── */}
        {error && error !== "PERMISSION_DENIED" && (
          <div style={s.errorState}>
            <div style={s.emptyIcon}>⚠️</div>
            <h2 style={s.emptyTitle}>Failed to Load Works</h2>
            <p style={s.emptyDesc}>{error}</p>
            <button onClick={fetchWorks} style={s.retryBtn}>
              Retry
            </button>
          </div>
        )}

        {/* ── Empty state ──────────────────────────────────── */}
        {!isLoading && !error && works.length === 0 && (
          <div style={s.emptyState}>
            <div style={s.emptyIcon}>📋</div>
            <h2 style={s.emptyTitle}>No Works Found</h2>
            <p style={s.emptyDesc}>
              {debouncedSearch || statusFilter || categoryFilter
                ? "Try adjusting your filters or search query."
                : "No MPLADS works have been created yet."}
            </p>
          </div>
        )}

        {/* ── Table ────────────────────────────────────────── */}
        {!isLoading && !error && works.length > 0 && (
          <>
            {/* Desktop table */}
            <div style={s.tableWrap}>
              <table style={s.table}>
                <thead>
                  <tr>
                    <SortHeader field="title" label="Work" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                    <SortHeader field="status" label="Status" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                    <th style={s.th}>Location</th>
                    <th style={s.th}>MP</th>
                    <SortHeader field="sanctioned_amount" label="Sanctioned" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                    <SortHeader field="physical_progress_pct" label="Progress" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                    <SortHeader field="recommended_date" label="Date" sortBy={sortBy} sortOrder={sortOrder} onSort={handleSort} />
                  </tr>
                </thead>
                <tbody>
                  {works.map((w) => {
                    const sc = STATUS_CONFIG[w.status];
                    return (
                      <tr
                        key={w.work_id}
                        style={s.tr}
                        onClick={() => router.push(`/dashboard/works/${w.work_id}`)}
                        onMouseEnter={(e) => {
                          (e.currentTarget as HTMLElement).style.background = "rgba(255,255,255,0.04)";
                        }}
                        onMouseLeave={(e) => {
                          (e.currentTarget as HTMLElement).style.background = "transparent";
                        }}
                      >
                        <td style={s.td}>
                          <div style={s.workTitle}>{w.title}</div>
                          <div style={s.workMeta}>{CATEGORY_LABELS[w.category]}</div>
                        </td>
                        <td style={s.td}>
                          <span style={{ ...s.badge, color: sc.color, background: sc.bg, borderColor: sc.border }}>
                            {sc.label}
                          </span>
                          {w.status === "recommended" && (
                            <div style={{ fontSize: "0.68rem", color: "#d97706", marginTop: "0.25rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.25rem" }}>
                              <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: "#f59e0b" }} />
                              Routed: DA Review
                            </div>
                          )}
                          {(w.status === "sanctioned" || w.status === "in_progress") && (
                            <div style={{ fontSize: "0.68rem", color: "#2563eb", marginTop: "0.25rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.25rem" }}>
                              <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: "#3b82f6" }} />
                              Routed: {w.implementing_agency ? (w.implementing_agency.length > 16 ? w.implementing_agency.slice(0, 16) + "…" : w.implementing_agency) : "Agency"}
                            </div>
                          )}
                          {w.status === "completed" && (
                            <div style={{ fontSize: "0.68rem", color: "#16a34a", marginTop: "0.25rem", fontWeight: 600, display: "flex", alignItems: "center", gap: "0.25rem" }}>
                              <span style={{ display: "inline-block", width: 5, height: 5, borderRadius: "50%", background: "#16a34a" }} />
                              Audited & Closed
                            </div>
                          )}
                        </td>
                        <td style={s.td}>
                          <div style={s.tdPrimary}>{w.district_name}</div>
                          <div style={s.workMeta}>{w.state_name}</div>
                        </td>
                        <td style={s.td}>
                          <div style={s.tdPrimary}>{w.mp_name}</div>
                          <div style={s.workMeta}>{w.constituency}</div>
                        </td>
                        <td style={{ ...s.td, fontVariantNumeric: "tabular-nums" }}>
                          {formatCurrency(w.sanctioned_amount)}
                        </td>
                        <td style={s.td}>
                          <ProgressBar pct={w.physical_progress_pct} />
                        </td>
                        <td style={{ ...s.td, color: "#94a3b8", fontSize: "0.8rem" }}>
                          {formatDate(w.recommended_date)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div style={s.mobileCards}>
              {works.map((w) => {
                const sc = STATUS_CONFIG[w.status];
                return (
                  <div
                    key={w.work_id}
                    style={s.mobileCard}
                    onClick={() => router.push(`/dashboard/works/${w.work_id}`)}
                  >
                    <div style={s.mobileCardHeader}>
                      <span style={s.workTitle}>{w.title}</span>
                      <span style={{ ...s.badge, color: sc.color, background: sc.bg, borderColor: sc.border, fontSize: "0.65rem" }}>
                        {sc.label}
                      </span>
                    </div>
                    <div style={s.mobileCardGrid}>
                      <MobileField label="Location" value={`${w.district_name}, ${w.state_name}`} />
                      <MobileField label="MP" value={w.mp_name} />
                      <MobileField label="Sanctioned" value={formatCurrency(w.sanctioned_amount)} />
                      <MobileField label="Progress" value={`${w.physical_progress_pct}%`} />
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Pagination */}
            <div style={s.paginationRow}>
              <button
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
                style={{ ...s.pageBtn, opacity: page <= 1 ? 0.4 : 1 }}
              >
                ← Prev
              </button>
              <span style={s.pageInfo}>
                Page {page} of {totalPages}
              </span>
              <button
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                style={{ ...s.pageBtn, opacity: page >= totalPages ? 0.4 : 1 }}
              >
                Next →
              </button>
            </div>
          </>
        )}
      </div>

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes shimmer {
          0% { background-position: -200px 0; }
          100% { background-position: 200px 0; }
        }
        button:hover { opacity: 0.85; }
        tr { cursor: pointer; }
        select:focus, input:focus { outline: none; border-color: rgba(99,102,241,0.5); }
      `}</style>
    </div>
  );
}

// ── Sub-Components ──────────────────────────────────────────────

function Header({ user, onBack }: { user: { full_name: string; role: string }; onBack: () => void }) {
  return (
    <div style={s.header}>
      <div style={s.headerLeft}>
        <button onClick={onBack} style={s.backBtn} title="Back to Dashboard">
          ←
        </button>
        <div>
          <h1 style={s.pageTitle}>MPLADS Works</h1>
          <p style={s.pageSubtitle}>Work lifecycle management and monitoring</p>
        </div>
      </div>
      <div style={s.headerRight}>
        <span style={s.userLabel}>{user.full_name}</span>
        <span style={s.roleLabel}>{user.role}</span>
      </div>
    </div>
  );
}

function SortHeader({
  field, label, sortBy, sortOrder, onSort,
}: {
  field: string; label: string; sortBy: string; sortOrder: string; onSort: (f: string) => void;
}) {
  const isActive = sortBy === field;
  return (
    <th
      style={{ ...s.th, cursor: "pointer", userSelect: "none" }}
      onClick={() => onSort(field)}
    >
      {label}{" "}
      {isActive && (
        <span style={{ fontSize: "0.7rem" }}>{sortOrder === "asc" ? "▲" : "▼"}</span>
      )}
    </th>
  );
}

function ProgressBar({ pct }: { pct: number }) {
  const color = pct >= 75 ? "#22c55e" : pct >= 40 ? "#fbbf24" : "#f87171";
  return (
    <div style={s.progressWrap}>
      <div style={s.progressTrack}>
        <div
          style={{
            height: "100%",
            width: `${Math.min(100, pct)}%`,
            background: color,
            borderRadius: 4,
            transition: "width 0.4s ease",
          }}
        />
      </div>
      <span style={{ ...s.progressLabel, color }}>{pct.toFixed(0)}%</span>
    </div>
  );
}

function MobileField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div style={s.mobileFieldLabel}>{label}</div>
      <div style={s.mobileFieldValue}>{value}</div>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  pageWrap: {
    minHeight: "100vh",
    background: "#ffffff",
    padding: "1.5rem",
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    display: "flex",
    justifyContent: "center",
  },
  container: {
    width: "100%",
    maxWidth: 1200,
  },
  spinner: {
    width: 32,
    height: 32,
    border: "3px solid rgba(0,0,0,0.1)",
    borderTopColor: "#2563eb",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
    margin: "40vh auto",
  },

  // Header
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "1.5rem",
    flexWrap: "wrap" as const,
    gap: "1rem",
  },
  headerLeft: {
    display: "flex",
    alignItems: "center",
    gap: "0.75rem",
  },
  headerRight: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
  },
  backBtn: {
    width: 36,
    height: 36,
    borderRadius: 8,
    border: "1px solid #cbd5e1",
    background: "#ffffff",
    color: "#475569",
    fontSize: "1.1rem",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    transition: "all 0.2s",
  },
  pageTitle: {
    margin: 0,
    fontSize: "1.4rem",
    fontWeight: 700,
    color: "#0f172a",
  },
  pageSubtitle: {
    margin: 0,
    fontSize: "0.8rem",
    color: "#64748b",
  },
  userLabel: {
    fontSize: "0.8rem",
    color: "#334155",
    fontWeight: 500,
  },
  roleLabel: {
    fontSize: "0.65rem",
    color: "#2563eb",
    background: "#eff6ff",
    border: "1px solid #bfdbfe",
    padding: "2px 8px",
    borderRadius: 4,
    fontWeight: 600,
    textTransform: "uppercase" as const,
  },

  // Filters
  filtersRow: {
    display: "flex",
    gap: "0.75rem",
    marginBottom: "1rem",
    flexWrap: "wrap" as const,
  },
  searchWrap: {
    flex: "1 1 250px",
    position: "relative" as const,
  },
  searchIcon: {
    position: "absolute" as const,
    left: 12,
    top: "50%",
    transform: "translateY(-50%)",
  },
  searchInput: {
    width: "100%",
    padding: "0.6rem 0.75rem 0.6rem 2.2rem",
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    color: "#0f172a",
    fontSize: "0.85rem",
    boxSizing: "border-box" as const,
  },
  select: {
    padding: "0.6rem 0.75rem",
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    color: "#0f172a",
    fontSize: "0.8rem",
    minWidth: 140,
    cursor: "pointer",
  },
  compactInput: {
    minWidth: 120,
    padding: "0.6rem 0.75rem",
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    color: "#0f172a",
    fontSize: "0.8rem",
  },
  mapSection: {
    marginBottom: "1.25rem",
    padding: "1rem",
    borderRadius: 14,
    border: "1px solid #e2e8f0",
    background: "#f8fafc",
  },
  mapHeader: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "1rem", flexWrap: "wrap" as const, marginBottom: "0.75rem" },
  mapTitle: { margin: 0, color: "#0f172a", fontSize: "1rem", fontWeight: 700 },
  mapDescription: { margin: "0.25rem 0 0", color: "#64748b", fontSize: "0.76rem", lineHeight: 1.45 },
  mapCount: { color: "#2563eb", fontSize: "0.72rem", fontWeight: 600, whiteSpace: "nowrap" as const },
  mapState: { minHeight: 160, display: "flex", gap: "0.75rem", flexDirection: "column" as const, justifyContent: "center", alignItems: "center", textAlign: "center" as const, color: "#64748b", fontSize: "0.82rem", padding: "1rem", border: "1px dashed #cbd5e1", borderRadius: 10 },
  mapLimitNotice: { margin: "0.6rem 0 0", color: "#64748b", fontSize: "0.72rem" },

  // Results bar
  resultsBar: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: "0.75rem",
    flexWrap: "wrap" as const,
    gap: "0.5rem",
  },
  resultsCount: {
    fontSize: "0.8rem",
    color: "#64748b",
  },
  pageSizeWrap: {
    display: "flex",
    alignItems: "center",
    gap: "0.4rem",
  },
  pageSizeLabel: {
    fontSize: "0.75rem",
    color: "#64748b",
  },

  // Table
  tableWrap: {
    overflowX: "auto" as const,
    borderRadius: 12,
    border: "1px solid #e2e8f0",
    background: "#ffffff",
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  },
  table: {
    width: "100%",
    borderCollapse: "collapse" as const,
    minWidth: 800,
  },
  th: {
    padding: "0.75rem 1rem",
    textAlign: "left" as const,
    fontSize: "0.7rem",
    fontWeight: 600,
    color: "#475569",
    textTransform: "uppercase" as const,
    letterSpacing: "0.05em",
    borderBottom: "1px solid #e2e8f0",
    background: "#f8fafc",
    whiteSpace: "nowrap" as const,
  },
  tr: {
    borderBottom: "1px solid #e2e8f0",
    transition: "background 0.15s",
  },
  td: {
    padding: "0.75rem 1rem",
    fontSize: "0.85rem",
    color: "#0f172a",
    verticalAlign: "middle" as const,
  },
  tdPrimary: {
    fontSize: "0.85rem",
    color: "#0f172a",
  },
  workTitle: {
    fontSize: "0.85rem",
    fontWeight: 600,
    color: "#0f172a",
    marginBottom: 2,
  },
  workMeta: {
    fontSize: "0.7rem",
    color: "#64748b",
  },
  badge: {
    display: "inline-block",
    padding: "3px 10px",
    borderRadius: 20,
    fontSize: "0.7rem",
    fontWeight: 600,
    border: "1px solid",
    whiteSpace: "nowrap" as const,
  },

  // Progress bar
  progressWrap: {
    display: "flex",
    alignItems: "center",
    gap: "0.5rem",
    minWidth: 100,
  },
  progressTrack: {
    flex: 1,
    height: 6,
    borderRadius: 4,
    background: "#e2e8f0",
    overflow: "hidden",
  },
  progressLabel: {
    fontSize: "0.75rem",
    fontWeight: 600,
    minWidth: 32,
    textAlign: "right" as const,
    color: "#0f172a",
  },

  // Pagination
  paginationRow: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "1rem",
    marginTop: "1.25rem",
    paddingBottom: "2rem",
  },
  pageBtn: {
    padding: "0.5rem 1rem",
    background: "#ffffff",
    border: "1px solid #cbd5e1",
    borderRadius: 8,
    color: "#0f172a",
    fontSize: "0.8rem",
    cursor: "pointer",
    transition: "all 0.2s",
    fontWeight: 500,
  },
  pageInfo: {
    fontSize: "0.8rem",
    color: "#64748b",
  },

  // Empty / Error states
  emptyState: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    padding: "4rem 2rem",
    background: "#f8fafc",
    borderRadius: 16,
    border: "1px solid #e2e8f0",
  },
  errorState: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    padding: "4rem 2rem",
    background: "#fef2f2",
    borderRadius: 16,
    border: "1px solid #fecaca",
  },
  emptyIcon: {
    fontSize: "2.5rem",
    marginBottom: "1rem",
  },
  emptyTitle: {
    fontSize: "1.15rem",
    fontWeight: 700,
    color: "#0f172a",
    margin: "0 0 0.5rem",
  },
  emptyDesc: {
    fontSize: "0.85rem",
    color: "#64748b",
    textAlign: "center" as const,
    maxWidth: 400,
    lineHeight: 1.5,
  },
  retryBtn: {
    marginTop: "1rem",
    padding: "0.6rem 1.5rem",
    background: "#2563eb",
    border: "1px solid #2563eb",
    borderRadius: 8,
    color: "#ffffff",
    fontSize: "0.85rem",
    fontWeight: 600,
    cursor: "pointer",
    transition: "all 0.2s",
  },

  // Skeleton
  skeletonWrap: {
    display: "flex",
    flexDirection: "column" as const,
    gap: "0.75rem",
  },
  skeletonRow: {
    display: "flex",
    gap: "1rem",
    padding: "1rem",
    background: "#ffffff",
    borderRadius: 8,
    border: "1px solid #e2e8f0",
  },
  skeletonBar: {
    height: 14,
    borderRadius: 4,
    background: "#f1f5f9",
  },

  // Mobile cards
  mobileCards: {
    display: "none",
  },
  mobileCard: {
    background: "#ffffff",
    border: "1px solid #e2e8f0",
    borderRadius: 12,
    padding: "1rem",
    cursor: "pointer",
    transition: "all 0.2s",
    boxShadow: "0 1px 3px rgba(0,0,0,0.04)",
  },
  mobileCardHeader: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: "0.5rem",
    marginBottom: "0.75rem",
  },
  mobileCardGrid: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "0.5rem",
  },
  mobileFieldLabel: {
    fontSize: "0.65rem",
    color: "#64748b",
    textTransform: "uppercase" as const,
    letterSpacing: "0.03em",
    fontWeight: 600,
  },
  mobileFieldValue: {
    fontSize: "0.8rem",
    color: "#0f172a",
  },
};
