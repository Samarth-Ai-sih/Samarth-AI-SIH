"use client";

import type { ECharts, EChartsOption } from "echarts";
import { useEffect, useRef } from "react";

interface FinancialChartProps {
  title: string;
  description: string;
  option: EChartsOption;
  isEmpty?: boolean;
  emptyMessage?: string;
  height?: number;
  onPointClick?: (pointData: any) => void;
}

/**
 * Browser-only Apache ECharts host. The library is dynamically imported in an
 * effect so the App Router can safely render this client component on the server.
 */
export function FinancialChart({
  title,
  description,
  option,
  isEmpty = false,
  emptyMessage = "No data is available for the selected filters.",
  height = 310,
  onPointClick,
}: FinancialChartProps) {
  const chartElement = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const element = chartElement.current;
    if (!element || isEmpty) return;

    let chart: ECharts | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let cancelled = false;

    void import("echarts").then((echarts) => {
      if (cancelled) return;
      chart = echarts.init(element, undefined, { renderer: "canvas" });
      chart.setOption(option, { notMerge: true });
      if (onPointClick) {
        chart.on("click", (params) => {
          if (params.data) {
            onPointClick(params.data);
          }
        });
      }
      resizeObserver = new ResizeObserver(() => chart?.resize());
      resizeObserver.observe(element);
    });

    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      chart?.dispose();
    };
  }, [isEmpty, option, onPointClick]);

  return (
    <section className="rounded-xl border border-sky-100 bg-white p-5 shadow-sm" aria-label={title}>
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-slate-900">{title}</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>
      </div>
      {isEmpty ? (
        <div className="flex flex-col items-center justify-center gap-2 p-4 text-center text-sm text-slate-500" style={{ minHeight: height }}>
          <span aria-hidden="true" className="text-2xl text-sky-700">◌</span>
          {emptyMessage}
        </div>
      ) : (
        <div ref={chartElement} style={{ width: "100%", height }} />
      )}
    </section>
  );
}
