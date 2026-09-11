"use client";

import type { ECharts, EChartsOption } from "echarts";
import React, { useEffect, useMemo, useRef } from "react";

interface LocationPoint { label: string; latitude: number | null; longitude: number | null; address?: string; color: string; }

/** Private inspection coordinate map from FastAPI work data and optional device GPS. */
export function InspectionLocationMap({ project, device }: { project: LocationPoint; device?: LocationPoint }) {
  const element = useRef<HTMLDivElement | null>(null);
  const projectLabel = project.label;
  const projectLatitude = project.latitude;
  const projectLongitude = project.longitude;
  const projectAddress = project.address;
  const projectColor = project.color;
  const deviceLabel = device?.label;
  const deviceLatitude = device?.latitude;
  const deviceLongitude = device?.longitude;
  const deviceAddress = device?.address;
  const deviceColor = device?.color;
  const points = useMemo(
    () => {
      const candidates: Array<LocationPoint | undefined> = [
        { label: projectLabel, latitude: projectLatitude, longitude: projectLongitude, address: projectAddress, color: projectColor },
        deviceLabel === undefined ? undefined : { label: deviceLabel, latitude: deviceLatitude ?? null, longitude: deviceLongitude ?? null, address: deviceAddress, color: deviceColor || "#fbbf24" },
      ];
      return candidates.filter((point): point is LocationPoint => Boolean(point && point.latitude !== null && point.longitude !== null));
    },
    [
      projectLabel, projectLatitude, projectLongitude, projectAddress, projectColor,
      deviceLabel, deviceLatitude, deviceLongitude, deviceAddress, deviceColor,
    ],
  );
  const option = useMemo<EChartsOption>(() => {
    if (!points.length) return {};
    const lats = points.map((point) => point.latitude as number);
    const lons = points.map((point) => point.longitude as number);
    const latPadding = Math.max((Math.max(...lats) - Math.min(...lats)) * .45, .0015);
    const lonPadding = Math.max((Math.max(...lons) - Math.min(...lons)) * .45, .0015);
    return {
      backgroundColor: "transparent", grid: { left: 48, right: 22, top: 22, bottom: 38 },
      tooltip: {
        trigger: "item",
        backgroundColor: "#ffffff",
        borderColor: "#e2e8f0",
        textStyle: { color: "#0f172a" },
        formatter: (params: unknown) => {
          const data = (params as { data?: { name: string; address?: string; value: [number, number] } }).data;
          return data ? `
            <div style="font-family: system-ui, sans-serif; padding: 2px 4px;">
              <div style="display: flex; align-items: center; gap: 4px; margin-bottom: 2px;">
                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #dc2626;"></span>
                <strong style="color: #0f172a; font-size: 13px;">${data.name}</strong>
              </div>
              <div style="font-size: 11px; color: #64748b;">${data.address || "Coordinates captured"}</div>
              <div style="font-size: 10px; font-family: monospace; color: #94a3b8; margin-top: 2px;">
                ${data.value[1].toFixed(5)}, ${data.value[0].toFixed(5)}
              </div>
            </div>
          ` : "";
        },
      },
      xAxis: { type: "value", min: Math.min(...lons) - lonPadding, max: Math.max(...lons) + lonPadding, name: "Longitude", nameTextStyle: { color: "#64748b" }, axisLabel: { color: "#64748b", formatter: (value: number) => value.toFixed(4) }, splitLine: { lineStyle: { color: "#f1f5f9" } } },
      yAxis: { type: "value", min: Math.min(...lats) - latPadding, max: Math.max(...lats) + latPadding, name: "Latitude", nameTextStyle: { color: "#64748b" }, axisLabel: { color: "#64748b", formatter: (value: number) => value.toFixed(4) }, splitLine: { lineStyle: { color: "#f1f5f9" } } },
      series: [{
        type: "scatter",
        symbol: "circle",
        symbolSize: 8,
        itemStyle: { color: "#dc2626", borderColor: "#991b1b", borderWidth: 1 },
        label: { show: true, position: "top", color: "#0f172a", fontSize: 11, fontWeight: "bold", formatter: "{b}" },
        data: points.map((point) => ({
          name: point.label,
          address: point.address,
          value: [point.longitude as number, point.latitude as number],
          itemStyle: { color: "#dc2626" },
        })),
      }],
    };
  }, [points]);

  useEffect(() => {
    const target = element.current;
    if (!target || !points.length) return;
    let chart: ECharts | null = null; let observer: ResizeObserver | null = null; let cancelled = false;
    void import("echarts").then((echarts) => {
      if (cancelled) return;
      chart = echarts.init(target, undefined, { renderer: "canvas" }); chart.setOption(option, { notMerge: true });
      observer = new ResizeObserver(() => chart?.resize()); observer.observe(target);
    });
    return () => { cancelled = true; observer?.disconnect(); chart?.dispose(); };
  }, [option, points.length]);

  return <section style={styles.card} aria-label="Inspection location map">
    <h2 style={styles.title}>Inspection location</h2>
    <p style={styles.description}>Private coordinate map from the work record and optional device GPS. No external map data is loaded.</p>
    {points.length ? <div ref={element} style={styles.chart} /> : <p style={styles.empty}>Project coordinates are unavailable.</p>}
  </section>;
}

const styles: Record<string, React.CSSProperties> = {
  card: { padding: "1rem", borderRadius: 14, border: "1px solid #e2e8f0", background: "#ffffff", boxShadow: "0 1px 3px rgba(0,0,0,0.04)" },
  title: { margin: 0, color: "#0f172a", fontSize: ".96rem", fontWeight: 700 }, description: { margin: ".28rem 0 .6rem", color: "#64748b", fontSize: ".74rem", lineHeight: 1.45 },
  chart: { width: "100%", height: 270 }, empty: { display: "grid", minHeight: 270, placeItems: "center", margin: 0, color: "#64748b", textAlign: "center" as const },
};
