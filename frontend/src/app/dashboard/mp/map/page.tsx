"use client";

import { useAuth } from "@/lib/auth";
import { formatCurrency, MapWorkMarker, WorkMapResponse } from "@/lib/api";
import {
  MapPin,
  Search,
  Filter,
  Layers,
  CheckCircle2,
  Clock,
  AlertCircle,
  ExternalLink,
  Building2,
  Landmark,
} from "lucide-react";
import dynamic from "next/dynamic";
import Link from "next/link";
import React, { useCallback, useEffect, useState } from "react";

const WorkExplorerMap = dynamic(
  () => import("@/components/maps/work-explorer-map").then((mod) => mod.WorkExplorerMap),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-[600px] w-full items-center justify-center rounded-2xl border border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500">
        Loading interactive constituency GIS map…
      </div>
    ),
  }
);

export default function MPConstituencyMapPage() {
  const { user, fetchWithAuth } = useAuth();

  const [mapData, setMapData] = useState<WorkMapResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [selectedMarker, setSelectedMarker] = useState<MapWorkMarker | null>(null);
  const [mapRevision, setMapRevision] = useState(0);

  const fetchMapWorks = useCallback(async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter !== "all") params.set("status", statusFilter);
      if (categoryFilter !== "all") params.set("category", categoryFilter);
      params.set("page_size", "100");

      const res = await fetchWithAuth(`/api/v1/works/map?${params.toString()}`);
      if (res.ok) {
        const data: WorkMapResponse = await res.json();
        setMapData(data);
        setMapRevision((r) => r + 1);
      }
    } catch (err) {
      console.error("Failed to load map data:", err);
    } finally {
      setIsLoading(false);
    }
  }, [fetchWithAuth, statusFilter, categoryFilter]);

  useEffect(() => {
    void fetchMapWorks();
  }, [fetchMapWorks]);

  const markers = mapData?.markers || [];
  const constituencyName = user?.jurisdiction.constituency || "Varanasi Urban";

  return (
    <div className="space-y-6 pb-12">
      {/* ── Header ── */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-b border-slate-200 pb-5">
        <div>
          <div className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-emerald-700">
            <MapPin className="h-3.5 w-3.5" />
            Constituency GIS Delivery Map
          </div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900 mt-1">
            Spatial Asset Distribution — {constituencyName}
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Geographic visibility of {mapData?.works_with_valid_coordinates || 0} GPS-tagged community assets across assembly wards.
          </p>
        </div>

        {/* Filter Badges */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-2xs focus:border-emerald-600 focus:outline-hidden"
          >
            <option value="all">All Project Statuses</option>
            <option value="recommended">Pending DA Sanction</option>
            <option value="sanctioned">Sanctioned</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
          </select>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 shadow-2xs focus:border-emerald-600 focus:outline-hidden"
          >
            <option value="all">All Sectors</option>
            <option value="drinking_water">Drinking Water</option>
            <option value="roads_and_bridges">Roads & Bridges</option>
            <option value="healthcare">Healthcare</option>
            <option value="education">Education</option>
            <option value="electricity">Electricity / Solar</option>
            <option value="sanitation">Sanitation</option>
          </select>
        </div>
      </div>

      {/* ── Main Map & Side Details Layout ── */}
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        {/* Map Container */}
        <div className="rounded-2xl border border-slate-200 bg-white p-2 shadow-xs overflow-hidden h-[620px]">
          <WorkExplorerMap
            markers={markers}
            fitRevision={mapRevision}
          />
        </div>

        {/* Side Panel: Asset Details or Works List */}
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-xs h-[620px] flex flex-col">
          <div className="border-b border-slate-100 pb-3 mb-4">
            <h3 className="text-sm font-bold text-slate-900">
              Constituency Assets in Scope ({markers.length})
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Click any project pin on the map or list below for details
            </p>
          </div>

          <div className="overflow-y-auto space-y-2.5 flex-1 pr-1">
            {markers.length === 0 ? (
              <p className="text-center text-xs text-slate-400 py-12">
                No GPS-tagged works match the selected filters.
              </p>
            ) : (
              markers.map((marker) => {
                const isSelected = selectedMarker?.work_id === marker.work_id;
                return (
                  <div
                    key={marker.work_id}
                    onClick={() => setSelectedMarker(marker)}
                    className={`p-3 rounded-xl border cursor-pointer transition ${
                      isSelected
                        ? "border-emerald-600 bg-emerald-50/70 shadow-xs"
                        : "border-slate-100 bg-slate-50/50 hover:border-slate-200 hover:bg-white"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <h4 className="text-xs font-bold text-slate-900 line-clamp-1">
                        {marker.title}
                      </h4>
                      <span
                        className={`text-[10px] font-bold uppercase rounded-full px-2 py-0.5 shrink-0 ${
                          marker.status === "completed"
                            ? "bg-emerald-100 text-emerald-800"
                            : marker.status === "in_progress"
                            ? "bg-blue-100 text-blue-800"
                            : "bg-amber-100 text-amber-800"
                        }`}
                      >
                        {marker.status.replace("_", " ")}
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-500 mt-1 capitalize">
                      {marker.category.replace("_", " ")} • {marker.physical_progress_pct}% physical
                    </p>

                    {marker.sanctioned_amount && (
                      <p className="text-xs font-black text-slate-800 mt-1.5">
                        {formatCurrency(marker.sanctioned_amount)}
                      </p>
                    )}

                    <div className="flex items-center justify-between mt-2 pt-2 border-t border-slate-200/60">
                      <span className="text-[10px] font-mono text-slate-400">
                        {marker.location.latitude.toFixed(4)}, {marker.location.longitude.toFixed(4)}
                      </span>
                      <Link
                        href={`/dashboard/works/${marker.work_id}`}
                        className="text-[11px] font-bold text-emerald-700 hover:text-emerald-800 inline-flex items-center gap-0.5"
                      >
                        360° View &rarr;
                      </Link>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
