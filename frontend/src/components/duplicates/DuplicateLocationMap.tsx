"use client";

import type { ECharts, EChartsOption } from "echarts";
import React, { useEffect, useMemo, useRef } from "react";

interface LocationPoint {
  label: string;
  latitude: number | null;
  longitude: number | null;
  address: string;
}

/** A coordinate comparison map rendered from FastAPI-provided work locations. */
export function DuplicateLocationMap({ left, right }: { left: LocationPoint; right: LocationPoint }) {
  const element = useRef<HTMLDivElement | null>(null);
  const hasCoordinates = left.latitude !== null && left.longitude !== null && right.latitude !== null && right.longitude !== null;
  const option = useMemo<EChartsOption>(() => {
    if (!hasCoordinates) return {};
    const lats = [left.latitude as number, right.latitude as number];
    const lons = [left.longitude as number, right.longitude as number];
    const latPadding = Math.max((Math.max(...lats) - Math.min(...lats)) * 0.45, 0.0015);
    const lonPadding = Math.max((Math.max(...lons) - Math.min(...lons)) * 0.45, 0.0015);
    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        backgroundColor: "#ffffff",
        borderColor: "#e2e8f0",
        textStyle: { color: "#0f172a" },
        formatter: (params: unknown) => {
          const data = (params as { data?: { name: string; address: string; value: [number, number] } }).data;
          return data ? `
            <div style="font-family: system-ui, sans-serif; padding: 2px 4px;">
              <div style="display: flex; align-items: center; gap: 4px; margin-bottom: 2px;">
                <span style="display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #dc2626;"></span>
                <strong style="color: #0f172a; font-size: 13px;">${data.name}</strong>
              </div>
              <div style="font-size: 11px; color: #64748b;">${data.address || "No address recorded"}</div>
              <div style="font-size: 10px; font-family: monospace; color: #94a3b8; margin-top: 2px;">
                ${data.value[1].toFixed(5)}, ${data.value[0].toFixed(5)}
              </div>
            </div>
          ` : "";
        },
      },
      grid: { left: 48, right: 20, top: 20, bottom: 38 },
      xAxis: {
        type: "value",
        min: Math.min(...lons) - lonPadding,
        max: Math.max(...lons) + lonPadding,
        axisLabel: { color: "#64748b", formatter: (value: number) => value.toFixed(4) },
        splitLine: { lineStyle: { color: "#f1f5f9" } },
        name: "Longitude",
        nameTextStyle: { color: "#64748b" },
      },
      yAxis: {
        type: "value",
        min: Math.min(...lats) - latPadding,
        max: Math.max(...lats) + latPadding,
        axisLabel: { color: "#64748b", formatter: (value: number) => value.toFixed(4) },
        splitLine: { lineStyle: { color: "#f1f5f9" } },
        name: "Latitude",
        nameTextStyle: { color: "#64748b" },
      },
      series: [{
        type: "scatter",
        symbol: "circle",
        symbolSize: 8,
        itemStyle: { color: "#dc2626", borderColor: "#991b1b", borderWidth: 1 },
        label: { show: true, position: "top", color: "#0f172a", fontSize: 11, fontWeight: "bold", formatter: "{b}" },
        data: [
          { name: left.label, address: left.address, value: [left.longitude as number, left.latitude as number], itemStyle: { color: "#dc2626" } },
          { name: right.label, address: right.address, value: [right.longitude as number, right.latitude as number], itemStyle: { color: "#dc2626" } },
        ],
      }],
    };
  }, [hasCoordinates, left, right]);

  useEffect(() => {
    const target = element.current;
    if (!target || !hasCoordinates) return;
    let chart: ECharts | null = null;
    let observer: ResizeObserver | null = null;
    let cancelled = false;
    void import("echarts").then((echarts) => {
      if (cancelled) return;
      chart = echarts.init(target, undefined, { renderer: "canvas" });
      chart.setOption(option, { notMerge: true });
      observer = new ResizeObserver(() => chart?.resize());
      observer.observe(target);
    });
    return () => { cancelled = true; observer?.disconnect(); chart?.dispose(); };
  }, [hasCoordinates, option]);

  return (
    <section style={styles.card} aria-label="Location comparison map">
      <h2 style={styles.title}>Location comparison map</h2>
      <p style={styles.description}>Coordinate-only map from stored work locations. No external mapping data is used.</p>
      {hasCoordinates ? <div ref={element} style={styles.chart} /> : <p style={styles.empty}>Coordinates are unavailable for one or both works.</p>}
    </section>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: { minWidth: 0, padding: "1rem", background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 14, boxShadow: "0 1px 3px rgba(0,0,0,0.04)" },
  title: { margin: 0, color: "#0f172a", fontSize: "0.95rem", fontWeight: 700 },
  description: { margin: "0.3rem 0 0.6rem", color: "#64748b", fontSize: "0.74rem", lineHeight: 1.45 },
  chart: { width: "100%", height: 280 },
  empty: { minHeight: 280, display: "grid", placeItems: "center", margin: 0, color: "#64748b", textAlign: "center" },
};
