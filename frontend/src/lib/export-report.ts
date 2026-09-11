/**
 * SAMARTH AI — Universal Report Export & Print Engine
 * Provides client-side export to CSV, JSON, and Print-ready Official PDF/Document.
 */

export interface ReportMetadataItem {
  label: string;
  value: string;
}

export interface ReportSection {
  title: string;
  type: "key-value" | "table" | "text" | "checklist" | "timeline";
  items?: { label: string; value: string }[];
  headers?: string[];
  rows?: (string | number | boolean | null | undefined)[][];
  content?: string;
  checklist?: { item: string; status?: string }[];
}

export interface PrintableReport {
  title: string;
  subtitle?: string;
  categoryBadge?: string;
  generatedBy?: string;
  jurisdiction?: string;
  metadata: ReportMetadataItem[];
  sections: ReportSection[];
  disclaimer?: string;
  signOff?: {
    designation?: string;
    office?: string;
  };
}

/**
 * Trigger download of any raw text file with MIME type
 */
export function downloadFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Format and download spreadsheet CSV with UTF-8 BOM for Microsoft Excel compatibility
 */
export function exportToCSV(
  filename: string,
  headers: string[],
  rows: (string | number | boolean | null | undefined)[][]
) {
  const escapeCell = (cell: unknown): string => {
    if (cell === null || cell === undefined) return "";
    const str = String(cell);
    if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headerLine = headers.map(escapeCell).join(",");
  const bodyLines = rows.map((row) => row.map(escapeCell).join(","));
  const csvContent = "\uFEFF" + [headerLine, ...bodyLines].join("\r\n");

  const cleanName = filename.endsWith(".csv") ? filename : `${filename}.csv`;
  downloadFile(cleanName, csvContent, "text/csv;charset=utf-8;");
}

/**
 * Export data payload to structured formatted JSON
 */
export function exportToJSON(filename: string, data: unknown) {
  const jsonContent = JSON.stringify(data, null, 2);
  const cleanName = filename.endsWith(".json") ? filename : `${filename}.json`;
  downloadFile(cleanName, jsonContent, "application/json;charset=utf-8;");
}

/**
 * Generate official Government of India / SAMARTH AI styled print report HTML
 */
export function generateReportHTML(report: PrintableReport): string {
  const now = new Date().toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  });

  const metadataRows = report.metadata
    .map(
      (m) => `
      <div class="meta-card">
        <span class="meta-label">${m.label}</span>
        <strong class="meta-value">${m.value || "—"}</strong>
      </div>`
    )
    .join("");

  const sectionsHTML = report.sections
    .map((sec, idx) => {
      let body = "";
      if (sec.type === "key-value" && sec.items) {
        body = `
          <div class="kv-grid">
            ${sec.items
              .map(
                (item) => `
              <div class="kv-item">
                <span class="kv-label">${item.label}:</span>
                <span class="kv-value">${item.value || "—"}</span>
              </div>`
              )
              .join("")}
          </div>`;
      } else if (sec.type === "table" && sec.headers && sec.rows) {
        body = `
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  ${sec.headers.map((h) => `<th>${h}</th>`).join("")}
                </tr>
              </thead>
              <tbody>
                ${sec.rows
                  .map(
                    (row) => `
                  <tr>
                    ${row.map((cell) => `<td>${cell === null || cell === undefined ? "—" : cell}</td>`).join("")}
                  </tr>`
                  )
                  .join("")}
              </tbody>
            </table>
          </div>`;
      } else if (sec.type === "checklist" && sec.checklist) {
        body = `
          <ul class="checklist">
            ${sec.checklist
              .map(
                (c) => `
              <li>
                <span class="check-box">${c.status === "verified" || c.status === "completed" ? "☑" : "☐"}</span>
                <span class="check-text">${c.item}</span>
                ${c.status ? `<span class="check-badge">${c.status}</span>` : ""}
              </li>`
              )
              .join("")}
          </ul>`;
      } else if (sec.type === "text" && sec.content) {
        body = `<p class="sec-text">${sec.content.replace(/\n/g, "<br/>")}</p>`;
      }

      return `
        <section class="report-sec">
          <h2 class="sec-title">${idx + 1}. ${sec.title}</h2>
          ${body}
        </section>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${report.title} — SAMARTH AI</title>
  <style>
    @media print {
      @page { margin: 1.5cm; size: A4 portrait; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 24px;
      font-size: 11pt;
      line-height: 1.45;
    }
    .header {
      border-bottom: 2px solid #0f172a;
      padding-bottom: 12px;
      margin-bottom: 16px;
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
    }
    .header-left h1 {
      margin: 0;
      font-size: 16pt;
      font-weight: 800;
      letter-spacing: -0.02em;
      color: #0f172a;
    }
    .header-left p {
      margin: 2px 0 0;
      font-size: 9pt;
      color: #475569;
    }
    .header-right {
      text-align: right;
      font-size: 8.5pt;
      color: #64748b;
    }
    .govt-badge {
      display: inline-block;
      font-size: 8pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: #1e3a8a;
      background: #dbeafe;
      padding: 2px 8px;
      border-radius: 4px;
      margin-bottom: 4px;
    }
    .meta-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 8px;
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      padding: 10px;
      border-radius: 6px;
      margin-bottom: 18px;
    }
    .meta-card {
      display: flex;
      flex-direction: column;
    }
    .meta-label {
      font-size: 7.5pt;
      font-weight: 700;
      color: #64748b;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .meta-value {
      font-size: 9.5pt;
      color: #0f172a;
      margin-top: 1px;
    }
    .report-sec {
      margin-bottom: 18px;
      page-break-inside: avoid;
    }
    .sec-title {
      font-size: 11pt;
      font-weight: 700;
      color: #0f172a;
      border-bottom: 1px solid #cbd5e1;
      padding-bottom: 4px;
      margin: 0 0 8px 0;
    }
    .sec-text {
      font-size: 9.5pt;
      color: #334155;
      margin: 0;
      white-space: pre-wrap;
    }
    .kv-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 6px 12px;
      font-size: 9pt;
    }
    .kv-item {
      display: flex;
      justify-content: space-between;
      border-bottom: 1px dashed #e2e8f0;
      padding-bottom: 2px;
    }
    .kv-label {
      color: #64748b;
      font-weight: 600;
    }
    .kv-value {
      color: #0f172a;
      font-weight: 600;
      text-align: right;
    }
    .table-wrap {
      width: 100%;
      overflow: hidden;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.5pt;
      margin-top: 4px;
    }
    th, td {
      border: 1px solid #cbd5e1;
      padding: 5px 8px;
      text-align: left;
    }
    th {
      background: #f1f5f9;
      color: #1e293b;
      font-weight: 700;
      text-transform: uppercase;
      font-size: 7.5pt;
      letter-spacing: 0.04em;
    }
    tr:nth-child(even) td {
      background: #f8fafc;
    }
    .checklist {
      list-style: none;
      padding: 0;
      margin: 0;
      font-size: 9pt;
    }
    .checklist li {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 0;
      border-bottom: 1px solid #f1f5f9;
    }
    .check-box {
      font-size: 11pt;
      color: #2563eb;
    }
    .check-text {
      flex: 1;
      color: #1e293b;
    }
    .check-badge {
      font-size: 7.5pt;
      background: #e2e8f0;
      padding: 1px 6px;
      border-radius: 4px;
      text-transform: capitalize;
    }
    .sign-off {
      margin-top: 32px;
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 32px;
      page-break-inside: avoid;
    }
    .sign-box {
      border-top: 1px solid #0f172a;
      padding-top: 8px;
      font-size: 9pt;
    }
    .footer {
      margin-top: 24px;
      border-top: 1px solid #e2e8f0;
      padding-top: 8px;
      font-size: 7.5pt;
      color: #64748b;
      text-align: center;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-left">
      <span class="govt-badge">Government of India · MoSPI</span>
      <h1>${report.title}</h1>
      <p>${report.subtitle || "SAMARTH AI — MPLADS Project Governance & Decision Support System"}</p>
    </div>
    <div class="header-right">
      <div><strong>Date:</strong> ${now}</div>
      ${report.jurisdiction ? `<div><strong>Jurisdiction:</strong> ${report.jurisdiction}</div>` : ""}
      ${report.generatedBy ? `<div><strong>Generated By:</strong> ${report.generatedBy}</div>` : ""}
    </div>
  </div>

  <div class="meta-grid">
    ${metadataRows}
  </div>

  ${sectionsHTML}

  <div class="sign-off">
    <div class="sign-box">
      <strong>Examined & Verified by:</strong>
      <div style="height: 32px;"></div>
      <div>Officer Signature / Seal</div>
      <div style="color: #64748b; font-size: 8pt; margin-top: 2px;">
        ${report.signOff?.designation || "Competent Authority"}
      </div>
    </div>
    <div class="sign-box">
      <strong>Counter-Signed & Attested:</strong>
      <div style="height: 32px;"></div>
      <div>Authorised Supervisory Signature</div>
      <div style="color: #64748b; font-size: 8pt; margin-top: 2px;">
        ${report.signOff?.office || "District / State Monitoring Unit"}
      </div>
    </div>
  </div>

  <div class="footer">
    ${report.disclaimer || "Confidential official record. Generated from SAMARTH AI analytical datasets for administrative scrutiny and verification under MPLADS guidelines."}
  </div>
</body>
</html>`;
}

/**
 * Print the report using a clean hidden iframe (no popup blockers, zero external libraries)
 */
export function printFormattedReport(report: PrintableReport) {
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  document.body.appendChild(iframe);

  const doc = iframe.contentWindow?.document;
  if (!doc) {
    window.print();
    return;
  }

  doc.open();
  doc.write(generateReportHTML(report));
  doc.close();

  iframe.contentWindow?.focus();
  setTimeout(() => {
    iframe.contentWindow?.print();
    setTimeout(() => {
      document.body.removeChild(iframe);
    }, 2000);
  }, 300);
}
