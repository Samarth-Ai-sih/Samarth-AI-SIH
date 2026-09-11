"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Popup,
  TileLayer,
  useMap,
  useMapEvents,
} from "react-leaflet";
import type { LatLngExpression } from "leaflet";
import type { MapWorkMarker } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/api";

type Cluster = { key: string; latitude: number; longitude: number; markers: MapWorkMarker[] };

function riskColor(tier: MapWorkMarker["risk_tier"]) {
  if (tier === "red") return "#dc2626";
  if (tier === "amber") return "#d97706";
  if (tier === "green") return "#059669";
  return "#0369a1";
}

function makeClusters(markers: MapWorkMarker[], zoom: number): Cluster[] {
  if (markers.length < 25) {
    return markers.map((marker) => ({
      key: marker.work_id,
      latitude: marker.location.latitude,
      longitude: marker.location.longitude,
      markers: [marker],
    }));
  }
  // A deterministic viewport-independent grid keeps browser work bounded when
  // a permitted result set contains many work points.  It never changes the
  // server data or presents a cluster centroid as a project location.
  const cellDegrees = Math.max(0.003, 12 / (2 ** Math.max(0, zoom - 3)));
  const buckets = new Map<string, MapWorkMarker[]>();
  for (const marker of markers) {
    const key = `${Math.floor(marker.location.latitude / cellDegrees)}:${Math.floor(marker.location.longitude / cellDegrees)}`;
    buckets.set(key, [...(buckets.get(key) || []), marker]);
  }
  return [...buckets.entries()].map(([key, members]) => ({
    key,
    latitude: members.reduce((total, marker) => total + marker.location.latitude, 0) / members.length,
    longitude: members.reduce((total, marker) => total + marker.location.longitude, 0) / members.length,
    markers: members,
  }));
}

function FitToResults({ markers, revision }: { markers: MapWorkMarker[]; revision: number }) {
  const map = useMap();
  useEffect(() => {
    if (!markers.length) return;
    const points = markers.map((marker) => [marker.location.latitude, marker.location.longitude] as [number, number]);
    if (points.length === 1) map.setView(points[0], 14);
    else map.fitBounds(points, { padding: [30, 30], maxZoom: 14 });
  }, [map, markers, revision]);
  return null;
}

function ZoomListener({ onZoom }: { onZoom: (value: number) => void }) {
  useMapEvents({ zoomend: (event) => onZoom(event.target.getZoom()) });
  return null;
}

function ClusterPopup({ cluster, onFitCluster }: { cluster: Cluster; onFitCluster: (markers: MapWorkMarker[]) => void }) {
  if (cluster.markers.length === 1) {
    const marker = cluster.markers[0];
    return <Popup minWidth={240}>
      <div className="space-y-2 text-sm text-slate-700">
        <div className="flex items-center gap-1.5">
          <span className="h-2 w-2 rounded-full bg-red-600 inline-block shrink-0" />
          <span className="text-[11px] font-mono font-semibold text-red-700 bg-red-50 border border-red-200 px-1.5 py-0.5 rounded">
            Work ID: {marker.work_id}
          </span>
        </div>
        <strong className="block text-slate-950 font-bold text-sm leading-snug">{marker.title}</strong>
        <p className="m-0 text-xs text-slate-500 capitalize">{marker.status.replaceAll("_", " ")}</p>
        <p className="m-0 text-xs">{marker.district_name || marker.state_name || "Location jurisdiction not recorded"}</p>
        <p className="m-0 text-xs">{marker.physical_progress_pct.toFixed(0)}% physical progress</p>
        {marker.sanctioned_amount !== null && <p className="m-0 text-xs">Sanctioned: {formatCurrency(marker.sanctioned_amount)}</p>}
        {marker.risk_tier && <p className="m-0 text-xs capitalize">Risk tier: {marker.risk_tier}{marker.composite_risk_score !== null ? ` (${marker.composite_risk_score.toFixed(0)}/100)` : ""}</p>}
        <p className="m-0 text-[11px] text-slate-400">Updated {formatDate(marker.last_updated_at)}</p>
        <div className="pt-1 border-t border-slate-100">
          <a className="inline-block font-semibold text-blue-700 hover:text-blue-800 text-xs underline" href={`/dashboard/works/${encodeURIComponent(marker.work_id)}`}>Open Work 360°</a>
        </div>
      </div>
    </Popup>;
  }
  return <Popup minWidth={220}>
    <div className="space-y-2 text-sm text-slate-700">
      <div className="flex items-center gap-1.5">
        <span className="h-2 w-2 rounded-full bg-red-600 inline-block shrink-0" />
        <strong className="block text-slate-950">{cluster.markers.length} work locations</strong>
      </div>
      <p className="m-0 text-xs text-slate-500">Cluster centroid is for navigation only; individual project coordinates are unchanged.</p>
      <button type="button" className="font-semibold text-blue-700 hover:text-blue-800 text-xs underline" onClick={() => onFitCluster(cluster.markers)}>Zoom to these works</button>
    </div>
  </Popup>;
}

export function WorkExplorerMap({ markers, fitRevision }: { markers: MapWorkMarker[]; fitRevision: number }) {
  const [zoom, setZoom] = useState(7);
  const [clusterFocus, setClusterFocus] = useState<MapWorkMarker[] | null>(null);
  const visibleMarkers = clusterFocus || markers;
  const clusters = useMemo(() => makeClusters(visibleMarkers, zoom), [visibleMarkers, zoom]);
  const first = markers[0];
  if (!first) return null;
  const center: LatLngExpression = [first.location.latitude, first.location.longitude];
  const tileUrl = process.env.NEXT_PUBLIC_MAP_TILE_URL || "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
  const attribution = process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION || "&copy; OpenStreetMap contributors";
  return <div className="relative overflow-hidden rounded-xl border border-sky-100 bg-slate-50">
    {clusterFocus && <button type="button" onClick={() => setClusterFocus(null)} className="absolute right-3 top-3 z-[1000] rounded-md border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-900 shadow-sm">Show all results</button>}
    <MapContainer center={center} zoom={zoom} scrollWheelZoom className="h-[28rem] w-full" aria-label="MPLADS work locations map">
      <TileLayer attribution={attribution} url={tileUrl} />
      <ZoomListener onZoom={setZoom} />
      <FitToResults markers={visibleMarkers} revision={fitRevision} />
      {clusters.map((cluster) => {
        const single = cluster.markers.length === 1 ? cluster.markers[0] : null;
        return <CircleMarker key={cluster.key} center={[cluster.latitude, cluster.longitude]} radius={single ? 6 : Math.min(10, 6 + Math.log2(cluster.markers.length) * 2)} pathOptions={{ color: "#991b1b", fillColor: "#dc2626", fillOpacity: 0.95, weight: 2 }}>
          <ClusterPopup cluster={cluster} onFitCluster={(members) => setClusterFocus(members)} />
        </CircleMarker>;
      })}
    </MapContainer>
    <p className="border-t border-sky-100 bg-white px-3 py-2 text-xs text-slate-500">Markers use stored work coordinates only. Clusters are a display aid and do not create new project locations.</p>
  </div>;
}
