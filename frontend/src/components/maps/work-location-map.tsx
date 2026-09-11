"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { WorkLocation } from "@/lib/api";
import { MapPin } from "lucide-react";
import { CircleMarker, MapContainer, Popup, TileLayer } from "react-leaflet";

export function WorkLocationMap({ location, title = "Work location" }: { location: WorkLocation; title?: string }) {
  const valid = location.latitude !== null && location.longitude !== null;
  return <Card className="overflow-hidden"><CardHeader><CardTitle>{title}</CardTitle><CardDescription>{location.address || "Location address is not available."}</CardDescription></CardHeader><CardContent className="p-0">{valid ? <MapContainer center={[location.latitude as number, location.longitude as number]} zoom={14} scrollWheelZoom={false} className="h-72 w-full" aria-label="Work location map"><TileLayer attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" /><CircleMarker center={[location.latitude as number, location.longitude as number]} radius={6} pathOptions={{ color: "#991b1b", fillColor: "#dc2626", fillOpacity: 1, weight: 2 }}><Popup><div className="space-y-1 text-xs text-slate-700"><strong className="block text-sm font-semibold text-slate-900">{title}</strong><p className="m-0 text-slate-600">{location.address || "Stored project coordinates"}</p><p className="m-0 font-mono text-[11px] text-slate-400">{location.latitude as number}, {location.longitude as number}</p></div></Popup></CircleMarker></MapContainer> : <div className="grid h-72 place-items-center bg-slate-50 p-6 text-center"><div><MapPin className="mx-auto h-8 w-8 text-sky-700" aria-hidden="true" /><p className="mt-3 text-sm font-medium text-slate-800">Location unavailable</p><p className="mt-1 text-sm text-slate-500">No project coordinates have been recorded for this work.</p></div></div>}</CardContent></Card>;
}
