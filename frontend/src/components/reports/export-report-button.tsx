"use client";

import React, { useEffect, useRef, useState } from "react";
import { Download, FileDown, FileSpreadsheet, FileText, Loader2, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PrintableReport,
  exportToCSV,
  exportToJSON,
  printFormattedReport,
} from "@/lib/export-report";

export interface ExportDataPayload {
  report: PrintableReport;
  csv?: {
    headers: string[];
    rows: (string | number | boolean | null | undefined)[][];
  };
  json?: unknown;
}

export interface ExportReportButtonProps {
  label?: string;
  filename?: string;
  getReportData: () => ExportDataPayload | Promise<ExportDataPayload>;
  variant?: "default" | "outline" | "ghost" | "secondary";
  size?: "sm" | "default" | "icon" | "lg";
  className?: string;
  align?: "left" | "right";
}

export function ExportReportButton({
  label = "Export Report",
  filename = "samarth_report",
  getReportData,
  variant = "outline",
  size = "sm",
  className = "",
  align = "right",
}: ExportReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Click outside listener
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  async function handleExport(action: "print" | "csv" | "json") {
    setLoading(true);
    setLoadingAction(action);
    try {
      const data = await Promise.resolve(getReportData());
      const baseName = filename.replace(/[^a-zA-Z0-9_-]/g, "_");

      if (action === "print") {
        printFormattedReport(data.report);
      } else if (action === "csv") {
        if (data.csv) {
          exportToCSV(baseName, data.csv.headers, data.csv.rows);
        } else {
          // Auto-generate flat CSV from metadata and table sections
          const headers = ["Section", "Field / Item", "Value"];
          const rows: (string | number)[][] = [];

          data.report.metadata.forEach((m) => {
            rows.push(["Metadata", m.label, m.value || ""]);
          });

          data.report.sections.forEach((s) => {
            if (s.type === "key-value" && s.items) {
              s.items.forEach((item) => rows.push([s.title, item.label, item.value || ""]));
            } else if (s.type === "text" && s.content) {
              rows.push([s.title, "Details", s.content]);
            } else if (s.type === "table" && s.headers && s.rows) {
              s.rows.forEach((r, idx) => {
                r.forEach((cell, cIdx) => {
                  rows.push([s.title, `Row ${idx + 1} - ${s.headers?.[cIdx] || ""}`, String(cell ?? "")]);
                });
              });
            }
          });

          exportToCSV(baseName, headers, rows);
        }
      } else if (action === "json") {
        exportToJSON(baseName, data.json || data.report);
      }
      setOpen(false);
    } catch (err) {
      console.error("Export failed:", err);
      alert("Failed to compile export report. Please retry.");
    } finally {
      setLoading(false);
      setLoadingAction(null);
    }
  }

  return (
    <div ref={menuRef} className="relative inline-block text-left">
      <Button
        type="button"
        variant={variant}
        size={size}
        onClick={() => setOpen((prev) => !prev)}
        disabled={loading}
        className={`flex items-center gap-1.5 font-medium border-slate-300 text-slate-800 hover:bg-slate-50 shadow-xs ${className}`}
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-slate-500" />
        ) : (
          <Download className="h-4 w-4 text-slate-600" />
        )}
        <span>{loading ? "Exporting..." : label}</span>
      </Button>

      {open && (
        <div
          className={`absolute z-50 mt-1.5 w-64 rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl transition-all ${
            align === "right" ? "right-0" : "left-0"
          }`}
          role="menu"
        >
          <div className="px-2.5 py-1.5 border-b border-slate-100 mb-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              Select Export Format
            </span>
          </div>

          <button
            type="button"
            onClick={() => void handleExport("print")}
            disabled={loading}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-800 hover:bg-slate-100 transition-colors"
          >
            <Printer className="h-4 w-4 text-blue-600 shrink-0" />
            <div>
              <strong className="block text-slate-900 leading-tight">Official PDF / Print</strong>
              <span className="text-[10px] text-slate-500 block">Print-ready government dossier</span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => void handleExport("csv")}
            disabled={loading}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-800 hover:bg-slate-100 transition-colors"
          >
            <FileSpreadsheet className="h-4 w-4 text-emerald-600 shrink-0" />
            <div>
              <strong className="block text-slate-900 leading-tight">Excel / CSV Spreadsheet</strong>
              <span className="text-[10px] text-slate-500 block">Structured table data (UTF-8)</span>
            </div>
          </button>

          <button
            type="button"
            onClick={() => void handleExport("json")}
            disabled={loading}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-xs font-medium text-slate-800 hover:bg-slate-100 transition-colors"
          >
            <FileDown className="h-4 w-4 text-purple-600 shrink-0" />
            <div>
              <strong className="block text-slate-900 leading-tight">JSON Data Payload</strong>
              <span className="text-[10px] text-slate-500 block">Raw audit schema payload</span>
            </div>
          </button>
        </div>
      )}
    </div>
  );
}
