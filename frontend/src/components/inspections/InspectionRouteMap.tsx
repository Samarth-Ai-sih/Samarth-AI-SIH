"use client";

import React, { useEffect, useMemo, useState } from "react";
import dynamic from "next/dynamic";
import {
  Compass,
  ExternalLink,
  Milestone,
  Navigation,
  RefreshCw,
  Route,
  ShieldCheck,
  Timer,
  Waypoints,
  MapPin,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import {
  computeBTreeShortestPath,
  haversineKm,
  RouteResult,
} from "@/lib/btree-routing";

// Dynamically import Leaflet components to avoid SSR errors
const MapContainer = dynamic(
  () => import("react-leaflet").then((mod) => mod.MapContainer),
  { ssr: false }
);
const TileLayer = dynamic(
  () => import("react-leaflet").then((mod) => mod.TileLayer),
  { ssr: false }
);
const CircleMarker = dynamic(
  () => import("react-leaflet").then((mod) => mod.CircleMarker),
  { ssr: false }
);
const Polyline = dynamic(
  () => import("react-leaflet").then((mod) => mod.Polyline),
  { ssr: false }
);
const Popup = dynamic(
  () => import("react-leaflet").then((mod) => mod.Popup),
  { ssr: false }
);

interface InspectionRouteMapProps {
  workId: string;
  workTitle: string;
  targetLatitude: number | null;
  targetLongitude: number | null;
  targetAddress?: string;
  deviceLatitude?: number | null;
  deviceLongitude?: number | null;
  onLocationUpdate?: (lat: number, lng: number) => void;
}

export function InspectionRouteMap({
  workId,
  workTitle,
  targetLatitude,
  targetLongitude,
  targetAddress,
  deviceLatitude,
  deviceLongitude,
  onLocationUpdate,
}: InspectionRouteMapProps) {
  const [mounted, setMounted] = useState(false);
  const [showTurns, setShowTurns] = useState(true);
  const [detectingGps, setDetectingGps] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);

  // Fallback project coordinates if unrecorded
  const siteLat = targetLatitude ?? 26.8467;
  const siteLng = targetLongitude ?? 80.9462;

  // Starting location: browser device GPS or default District Dispatch Hub
  const [startLat, setStartLat] = useState<number>(() => deviceLatitude ?? 26.853);
  const [startLng, setStartLng] = useState<number>(() => deviceLongitude ?? 80.942);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (deviceLatitude && deviceLongitude) {
      setStartLat(deviceLatitude);
      setStartLng(deviceLongitude);
    }
  }, [deviceLatitude, deviceLongitude]);

  // Compute B-Tree shortest path route
  const route: RouteResult = useMemo(() => {
    return computeBTreeShortestPath(startLat, startLng, siteLat, siteLng, workTitle);
  }, [startLat, startLng, siteLat, siteLng, workTitle]);

  // Distance from inspector to site
  const directDistanceMeters = useMemo(() => {
    return Math.round(haversineKm(startLat, startLng, siteLat, siteLng) * 1000);
  }, [startLat, startLng, siteLat, siteLng]);

  const isWithinPerimeter = directDistanceMeters <= 500;

  function detectLiveGps() {
    setGpsError(null);
    if (!navigator.geolocation) {
      setGpsError("Geolocation is not supported by your browser.");
      return;
    }
    setDetectingGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDetectingGps(false);
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        setStartLat(lat);
        setStartLng(lng);
        onLocationUpdate?.(lat, lng);
      },
      (err) => {
        setDetectingGps(false);
        setGpsError(`Could not acquire GPS: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  }

  // Google Maps external navigation URL
  const gmapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${startLat},${startLng}&destination=${siteLat},${siteLng}&travelmode=driving`;

  const mapCenter: [number, number] = [
    (startLat + siteLat) / 2,
    (startLng + siteLng) / 2,
  ];

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
      {/* Top Header */}
      <div className="flex flex-col gap-3 border-b border-slate-200 bg-slate-50/70 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-6 items-center gap-1.5 rounded-full bg-blue-100 px-2.5 text-xs font-semibold text-blue-700">
              <Route className="h-3.5 w-3.5" />
              B-Tree Shortest Path Route
            </span>
            <span className="flex h-6 items-center gap-1 rounded-full bg-slate-100 px-2.5 text-xs font-medium text-slate-600">
              O(log N) Spatial Index
            </span>
          </div>
          <h2 className="mt-1 text-base font-bold tracking-tight text-slate-900">
            Inspection Site Navigation
          </h2>
          <p className="text-xs text-slate-500">
            Interactive routing to site coordinates using Spatial B-Tree Morton index + Dijkstra shortest path.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={detectLiveGps}
            disabled={detectingGps}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 active:scale-95 disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${detectingGps ? "animate-spin" : ""}`} />
            {detectingGps ? "Acquiring GPS…" : "Detect My Location"}
          </button>

          <a
            href={gmapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-blue-600 bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-sm transition hover:bg-blue-700 active:scale-95"
          >
            <Navigation className="h-3.5 w-3.5" />
            Google Maps
            <ExternalLink className="h-3 w-3 opacity-80" />
          </a>
        </div>
      </div>

      {gpsError && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs font-medium text-amber-800">
          ⚠️ {gpsError}
        </div>
      )}

      {/* Metrics Bar */}
      <div className="grid grid-cols-2 divide-x divide-slate-100 border-b border-slate-200 bg-white p-3 sm:grid-cols-4 sm:divide-x">
        <div className="px-3 py-1">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <Milestone className="h-3.5 w-3.5 text-blue-600" />
            Road Distance
          </span>
          <p className="mt-1 text-lg font-bold text-slate-900">
            {route.total_distance_km} <span className="text-xs font-normal text-slate-500">km</span>
          </p>
        </div>

        <div className="px-3 py-1">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <Timer className="h-3.5 w-3.5 text-blue-600" />
            Est. Drive Time
          </span>
          <p className="mt-1 text-lg font-bold text-slate-900">
            ~{route.estimated_duration_minutes} <span className="text-xs font-normal text-slate-500">mins</span>
          </p>
        </div>

        <div className="px-3 py-1">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            Site Perimeter
          </span>
          <div className="mt-1 flex items-center gap-1.5">
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                isWithinPerimeter ? "bg-emerald-500" : "bg-amber-500"
              }`}
            />
            <p className="text-xs font-bold text-slate-900">
              {isWithinPerimeter ? "On-Site (< 500m)" : `${directDistanceMeters}m away`}
            </p>
          </div>
        </div>

        <div className="px-3 py-1">
          <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            <Waypoints className="h-3.5 w-3.5 text-indigo-600" />
            B-Tree Traversal
          </span>
          <p className="mt-1 text-xs font-semibold text-slate-700">
            {route.btree_metrics.tree_size} nodes indexed
          </p>
          <p className="text-[10px] text-slate-400">
            O(log N) nearest road snap
          </p>
        </div>
      </div>

      {/* Interactive Leaflet Map */}
      <div className="relative h-80 w-full bg-slate-100 sm:h-96">
        {mounted ? (
          <MapContainer
            center={mapCenter}
            zoom={13}
            scrollWheelZoom={false}
            className="h-full w-full"
          >
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />

            {/* B-Tree Shortest Path Route Polyline */}
            <Polyline
              positions={route.path}
              pathOptions={{
                color: "#2563eb",
                weight: 5,
                opacity: 0.9,
                lineJoin: "round",
                lineCap: "round",
              }}
            />

            {/* Inspector Start Point Marker (Blue pulsing dot) */}
            <CircleMarker
              center={[startLat, startLng]}
              radius={8}
              pathOptions={{
                color: "#1d4ed8",
                fillColor: "#3b82f6",
                fillOpacity: 1,
                weight: 3,
              }}
            >
              <Popup>
                <div className="space-y-1 text-xs text-slate-800">
                  <div className="flex items-center gap-1.5 font-bold text-blue-700">
                    <Compass className="h-3.5 w-3.5" />
                    Field Inspector Origin
                  </div>
                  <p className="text-slate-600">
                    {deviceLatitude ? "Current GPS Coordinates" : "District Dispatch Hub"}
                  </p>
                  <p className="font-mono text-[10px] text-slate-400">
                    {startLat.toFixed(5)}, {startLng.toFixed(5)}
                  </p>
                </div>
              </Popup>
            </CircleMarker>

            {/* Destination Project Site Marker (Red dot with work ID popup) */}
            <CircleMarker
              center={[siteLat, siteLng]}
              radius={8}
              pathOptions={{
                color: "#991b1b",
                fillColor: "#dc2626",
                fillOpacity: 1,
                weight: 3,
              }}
            >
              <Popup>
                <div className="space-y-1 text-xs text-slate-800">
                  <div className="flex items-center gap-1.5 font-bold text-red-700">
                    <MapPin className="h-3.5 w-3.5" />
                    Work ID: {workId}
                  </div>
                  <strong className="block text-sm font-semibold text-slate-900">
                    {workTitle}
                  </strong>
                  <p className="text-slate-600">
                    {targetAddress || "Official MPLADS Project Ground Site"}
                  </p>
                  <p className="font-mono text-[10px] text-slate-400">
                    Target: {siteLat.toFixed(5)}, {siteLng.toFixed(5)}
                  </p>
                </div>
              </Popup>
            </CircleMarker>
          </MapContainer>
        ) : (
          <div className="grid h-full place-items-center text-xs text-slate-400">
            Initializing B-Tree Navigation Map…
          </div>
        )}
      </div>

      {/* Turn-by-Turn Guidance Accordion */}
      <div className="border-t border-slate-200 bg-white">
        <button
          type="button"
          onClick={() => setShowTurns((prev) => !prev)}
          className="flex w-full items-center justify-between p-3 text-left text-xs font-bold text-slate-800 transition hover:bg-slate-50"
        >
          <span className="flex items-center gap-2">
            <Route className="h-4 w-4 text-blue-600" />
            Turn-by-Turn Navigation ({route.turns.length} steps)
          </span>
          {showTurns ? (
            <ChevronUp className="h-4 w-4 text-slate-500" />
          ) : (
            <ChevronDown className="h-4 w-4 text-slate-500" />
          )}
        </button>

        {showTurns && (
          <div className="max-h-56 divide-y divide-slate-100 overflow-y-auto px-4 py-2 text-xs">
            {route.turns.map((turn, idx) => (
              <div key={idx} className="flex items-start gap-3 py-2">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-100 text-[10px] font-bold text-slate-700">
                  {idx + 1}
                </span>
                <div className="flex-1">
                  <p className="font-medium text-slate-900">{turn.instruction}</p>
                  <p className="text-[11px] text-slate-500">{turn.street}</p>
                </div>
                {turn.distance_km > 0 && (
                  <span className="shrink-0 font-mono text-[11px] font-semibold text-slate-600">
                    {turn.distance_km} km
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
