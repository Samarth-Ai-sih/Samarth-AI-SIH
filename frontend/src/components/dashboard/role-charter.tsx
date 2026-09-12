"use client";

import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import Link from "next/link";
import {
  ShieldCheck,
  Building2,
  MapPin,
  Landmark,
  FileCheck2,
  HardHat,
  Eye,
  Settings,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Ban,
  BookOpen,
  X,
  ExternalLink,
  Sparkles,
  ArrowRight,
} from "lucide-react";

export interface RoleSpecification {
  roleId: string;
  name: string;
  level: string;
  scope: string;
  icon: React.ComponentType<{ className?: string }>;
  tone: "blue" | "emerald" | "amber" | "purple" | "indigo" | "rose" | "teal" | "slate";
  summary: string;
  responsibilities: Array<{ title: string; desc: string; href?: string }>;
  authorized: string[];
  restricted: string[];
  statutoryReference: string;
}

export const ROLE_SPECIFICATIONS: Record<string, RoleSpecification> = {
  mospi: {
    roleId: "mospi",
    name: "Ministry of Statistics & Programme Implementation (MoSPI)",
    level: "Central Government Ministry",
    scope: "National Scope (All 28 States, 8 UTs & 543 Constituencies)",
    icon: Landmark,
    tone: "indigo",
    summary:
      "Acts as the apex national custodian of MPLADS, managing central budget drawdowns, policy compliance, and cross-state performance intelligence.",
    responsibilities: [
      {
        title: "Macro Fund Telemetry",
        desc: "Real-time oversight of the ₹4,000+ Cr annual national outlay, tracking expenditure velocity across all parliamentary constituencies.",
        href: "/dashboard/mospi/telemetry",
      },
      {
        title: "Inter-State Benchmarking",
        desc: "Comparative analytics identifying leading and lagging states, unspent district treasury balances, and fund absorption bottlenecks.",
        href: "/dashboard/mospi/benchmarking",
      },
      {
        title: "Statutory Quota Enforcement",
        desc: "Nationwide monitoring of mandatory 15% Scheduled Caste (SC) and 7.5% Scheduled Tribe (ST) capital allocation norms.",
        href: "/dashboard/mospi/quotas",
      },
      {
        title: "Central Treasury Releases",
        desc: "Authorizes subsequent ₹2.5 Cr installment tranches based on automated validation of digital Utilization Certificates (UCs).",
        href: "/dashboard/mospi/releases",
      },
      {
        title: "Bulk Data Ingestion & Integration",
        desc: "Manages batch CSV ingestion and secure synchronization with national financial pipelines (PFMS & eSAKSHI).",
        href: "/dashboard/mospi/ingestion",
      },
    ],
    authorized: [
      "View All Jurisdictions",
      "Read National Risk & Compliance",
      "Upload Master Datasets",
      "Authorize Central Treasury Releases",
    ],
    restricted: [
      "Cannot override local DM sanction decisions",
      "Cannot approve contractor billing directly",
    ],
    statutoryReference: "MoSPI Revised MPLADS Guidelines 2023, Chapter 2 & 5; GFR 2017 Rules",
  },
  state_nodal_officer: {
    roleId: "state_nodal_officer",
    name: "State Nodal Officer (SNO)",
    level: "State Government Administration",
    scope: "State Scope (All Districts within designated State)",
    icon: Building2,
    tone: "purple",
    summary:
      "Oversees statewide implementation, coordinates cross-district fund distribution, and resolves administrative bottlenecks before statutory escalation.",
    responsibilities: [
      {
        title: "Statewide Risk Heatmap",
        desc: "Tracks district-by-district performance, expenditure utilization rates, and identifies lagging districts across the state.",
        href: "/dashboard/sno/heatmap",
      },
      {
        title: "Bottleneck Escalation",
        desc: "Automatically identifies delayed projects and issues formal administrative show-cause notices to District Magistrates exceeding delay thresholds.",
        href: "/dashboard/sno/escalations",
      },
      {
        title: "Inter-District Allocation",
        desc: "Resolves cross-district fund transfers, reallocating unspent treasury balances to high-absorption districts to prevent fund surrender.",
        href: "/dashboard/sno/allocations",
      },
      {
        title: "Compliance Auditing",
        desc: "Ensures district authorities meet MoSPI's mandatory 10% annual physical inspection quota, issuing time-bound Special Drive Directives for deficits.",
        href: "/dashboard/sno/inspections-audit",
      },
    ],
    authorized: [
      "View All Districts in State",
      "Issue Administrative Escalations",
      "Review State Compliance Register",
      "Monitor State Risk Distribution",
    ],
    restricted: [
      "Cannot view projects outside state boundary",
      "Cannot disburse local contractor payments",
    ],
    statutoryReference: "MoSPI MPLADS Guidelines 2023, Para 3.3 (State Administration)",
  },
  district_authority: {
    roleId: "district_authority",
    name: "District Authority (District Magistrate / Collector / DC)",
    level: "District Administrative Headquarters",
    scope: "District Scope (All Works & Agencies in District)",
    icon: ShieldCheck,
    tone: "emerald",
    summary:
      "The primary operational command center of MPLADS: sanctions works, clears milestone payments, reviews AI risk signals, and executes field audits.",
    responsibilities: [
      {
        title: "Administrative Sanction & Rejection Hub",
        desc: "Evaluates MP recommendations; grants 1-click sanctions backed by automated spatial duplicate checks (≤ 50m radius).",
      },
      {
        title: "Milestone-Linked Fund Disbursals",
        desc: "Authorizes financial releases strictly tied to certified physical milestone completion, preventing unspent fund parking.",
      },
      {
        title: "Red-Tier Risk & Anomaly Investigation",
        desc: "Uses the Work 360 Dossier and Tree-SHAP health cards to investigate flagged cost overruns, delays, and contractor backlogs.",
      },
      {
        title: "Field Case Dispatch & Management",
        desc: "Dispatches high-risk projects to verification inspectors with strict due dates, reviewing incoming ground evidence.",
      },
    ],
    authorized: [
      "Sanction / Reject Recommended Works",
      "Disburse Financial Milestone Payments",
      "Assign Inspection Tasks",
      "Resolve Anomaly & Risk Flags",
    ],
    restricted: [
      "Cannot access works outside designated district",
      "AI provides decision support only — officer retains final legal responsibility",
    ],
    statutoryReference: "MoSPI MPLADS Guidelines 2023, Chapter 3; GFR 2017 Rules 130-157",
  },
  mp: {
    roleId: "mp",
    name: "Member of Parliament (MP — Lok Sabha / Rajya Sabha)",
    level: "Parliamentary Representative",
    scope: "Constituency Scope (Designated Parliamentary Constituency)",
    icon: Landmark,
    tone: "blue",
    summary:
      "Recommends high-impact public development works, monitors annual ₹5.00 Cr entitlement utilization, and presents verified delivery to voters.",
    responsibilities: [
      {
        title: "Constituency Project Recommendations",
        desc: "Proposes public utility assets with GPS coordinates, estimated budgets, and sector categories (education, healthcare, roads).",
      },
      {
        title: "Real-Time ₹5.00 Cr Entitlement Ledger",
        desc: "Tracks live balances of recommended, sanctioned, disbursed, and remaining annual funds to avoid fiscal year-end lapsing.",
      },
      {
        title: "Interactive Constituency Map",
        desc: "Visualizes completed, active, and pending works across all villages and urban wards with real-time milestone meters.",
      },
      {
        title: "1-Click Public Delivery Dossier",
        desc: "Exports official, print-ready achievement dossiers summarizing completed community assets for public accountability.",
      },
    ],
    authorized: [
      "Recommend New Development Works",
      "Track Real-Time Entitlement Balance",
      "Inspect Constituency Delivery Map",
      "Export Delivery Dossiers",
    ],
    restricted: [
      "Strictly prohibited from approving contractor bills (prevents conflict of interest)",
      "Cannot close internal administrative audit cases",
    ],
    statutoryReference: "Members of Parliament Local Area Development Scheme Guidelines, Para 2.1",
  },
  agency: {
    roleId: "agency",
    name: "Implementing Agency (Line Departments / Contractors)",
    level: "Executive & Engineering Line Agency (PWD, Jal Nigam, etc.)",
    scope: "Project / Contract Scope (Assigned District Civil Works)",
    icon: HardHat,
    tone: "amber",
    summary:
      "Executes sanctioned civil projects on the ground, updates stage milestones, and submits measurement verification records for tranche release.",
    responsibilities: [
      {
        title: "Ground Work Execution",
        desc: "Constructs sanctioned public works adhering strictly to sanctioned technical specifications and approved timelines.",
      },
      {
        title: "Physical Milestone Updates",
        desc: "Updates verified physical completion percentage (0% to 100%) through structured construction stages.",
      },
      {
        title: "Expenditure & Measurement Claims",
        desc: "Submits running contractor measurement books (MB) and billing records to unlock subsequent milestone payment tranches.",
      },
      {
        title: "Completion Handover",
        desc: "Submits final structural completion certificates for asset commissioning and public handover.",
      },
    ],
    authorized: [
      "Update Physical Progress on Assigned Works",
      "Submit Milestone Completion Records",
      "View Assigned Contract Details",
    ],
    restricted: [
      "Cannot modify sanctioned budgets or project scopes",
      "Cannot alter risk scores or administrative review flags",
    ],
    statutoryReference: "CPWD Works Manual & State PWD Procedural Guidelines",
  },
  inspector: {
    roleId: "inspector",
    name: "Field Verification Officer (Inspector / Junior Engineer)",
    level: "Field Audit & Physical Verification",
    scope: "Task Scope (Only specifically assigned inspection tasks)",
    icon: FileCheck2,
    tone: "teal",
    summary:
      "Conducts independent ground-truth physical audits, captures tamper-evident geotagged evidence, and confirms physical progress matches paper claims.",
    responsibilities: [
      {
        title: "On-Site Physical Audits",
        desc: "Conducts physical inspections for works prioritized by SAMARTH AI's risk engine, fulfilling MoSPI's 10% inspection quota.",
      },
      {
        title: "Tamper-Proof Ground Evidence",
        desc: "Captures live camera photos with cryptographically bound GPS coordinates, timestamp, and compass heading.",
      },
      {
        title: "Geofence Ground-Truth Validation",
        desc: "System validates whether inspection evidence is captured within ≤ 200 meters of the sanctioned project coordinates.",
      },
      {
        title: "Inspection Checklist Submission",
        desc: "Submits structured qualitative observations and safety assessments directly to the District Magistrate.",
      },
    ],
    authorized: [
      "Access Assigned Inspection Task Queue",
      "Capture Live Geotagged Field Evidence",
      "Submit Ground-Truth Inspection Reports",
    ],
    restricted: [
      "Cannot view unassigned projects or other district records",
      "Cannot approve or authorize financial payments",
    ],
    statutoryReference: "MoSPI MPLADS Guidelines 2023, Para 6.2 (Inspection & Monitoring)",
  },
  citizen: {
    roleId: "citizen",
    name: "Citizen / Local Community",
    level: "Public Beneficiary & Civil Society",
    scope: "Public Access (Constituency & Local Pincode)",
    icon: Eye,
    tone: "emerald",
    summary:
      "Discovers public assets funded by taxpayer money, participates in social auditing, and submits geotagged reports on stalled or abandoned works.",
    responsibilities: [
      {
        title: "Public Asset Discovery",
        desc: "Explores completed and ongoing schools, drinking water facilities, and roads funded under MPLADS in their local neighborhood.",
      },
      {
        title: "Civic Social Auditing",
        desc: "Reports abandoned, delayed, or substandard infrastructure directly to the district administration with photos and GPS.",
      },
      {
        title: "Transparent Grievance Tracking",
        desc: "Monitors the administrative status of submitted community reports with verifiable tracking reference IDs.",
      },
      {
        title: "Whistleblower Protection",
        desc: "Citizen identity is encrypted under MoSPI whistleblower protection guidelines to ensure safe civic participation.",
      },
    ],
    authorized: [
      "Search & View Completed Public Works",
      "Submit Geotagged Civic Ground Reports",
      "Track Public Grievance Status",
    ],
    restricted: [
      "Zero access to internal administrative files or contractor banking details",
      "Restricted from internal decision deliberations",
    ],
    statutoryReference: "Right to Information (RTI) Act 2005 & MoSPI Social Audit Framework",
  },
  admin: {
    roleId: "admin",
    name: "System Administrator (Technical Governance)",
    level: "Platform Administration & Technical Operations",
    scope: "Full Platform Scope (All Services & Master Configurations)",
    icon: Settings,
    tone: "slate",
    summary:
      "Maintains system security, provisions administrative accounts with strict geographic scopes, governs MLOps models, and monitors immutable audit logs.",
    responsibilities: [
      {
        title: "User & RBAC Provisioning",
        desc: "Onboards government officers, assigns geographic jurisdiction boundaries, and manages secure session credentials.",
      },
      {
        title: "MLOps Model Governance",
        desc: "Inspects registered XGBoost delay models and Isolation Forest versions in model registry; triggers 1-click rollbacks if needed.",
      },
      {
        title: "Statutory Compliance Rules Engine",
        desc: "Configures and fine-tunes regulatory rule thresholds (e.g. 90-day sanction delays, SC/ST ratios, dormant fund thresholds).",
      },
      {
        title: "Immutable Security Audits",
        desc: "Audits cryptographic SHA-256 system event logs (audit_logs) to detect unauthorized access or data tampering attempts.",
      },
    ],
    authorized: [
      "Full Role-Based Access Control (RBAC)",
      "ML Model Approval & 1-Click Rollback",
      "Compliance Rule Configuration",
      "Inspect Security Audit Logs",
    ],
    restricted: [
      "Cannot alter immutable historical audit event hashes",
    ],
    statutoryReference: "CERT-In National Cybersecurity Guidelines & IT Act 2000",
  },
};

export function RoleCharter({ currentRoleId }: { currentRoleId: string }) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedRoleTab, setSelectedRoleTab] = useState<string>(currentRoleId);

  const spec = ROLE_SPECIFICATIONS[currentRoleId] || ROLE_SPECIFICATIONS.district_authority;
  const RoleIcon = spec.icon;

  const toneStyles = {
    indigo: "border-indigo-200 bg-indigo-50/60 text-indigo-950",
    purple: "border-purple-200 bg-purple-50/60 text-purple-950",
    emerald: "border-emerald-200 bg-emerald-50/60 text-emerald-950",
    blue: "border-blue-200 bg-blue-50/60 text-blue-950",
    amber: "border-amber-200 bg-amber-50/60 text-amber-950",
    teal: "border-teal-200 bg-teal-50/60 text-teal-950",
    rose: "border-rose-200 bg-rose-50/60 text-rose-950",
    slate: "border-slate-200 bg-slate-50/60 text-slate-950",
  }[spec.tone];

  const badgeStyles = {
    indigo: "bg-indigo-100 text-indigo-800 border-indigo-300",
    purple: "bg-purple-100 text-purple-800 border-purple-300",
    emerald: "bg-emerald-100 text-emerald-800 border-emerald-300",
    blue: "bg-blue-100 text-blue-800 border-blue-300",
    amber: "bg-amber-100 text-amber-800 border-amber-300",
    teal: "bg-teal-100 text-teal-800 border-teal-300",
    rose: "bg-rose-100 text-rose-800 border-rose-300",
    slate: "bg-slate-100 text-slate-800 border-slate-300",
  }[spec.tone];

  return (
    <>
      <Card className={`mb-6 border transition-all duration-200 shadow-xs ${toneStyles}`}>
        <CardHeader className="p-4 sm:p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white shadow-2xs border border-slate-200">
                <RoleIcon className="h-5 w-5 text-slate-800" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-base font-bold tracking-tight text-slate-900">{spec.name}</h3>
                  <Badge variant="outline" className={`text-xs font-semibold ${badgeStyles}`}>
                    {spec.scope}
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-slate-600 leading-relaxed max-w-3xl">{spec.summary}</p>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
              {(currentRoleId === "mospi" || currentRoleId === "admin") && (
                <Button size="sm" asChild className="bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold h-8 shadow-xs">
                  <Link href="/dashboard/mospi">
                    <Landmark className="mr-1.5 h-3.5 w-3.5" /> Command Center
                  </Link>
                </Button>
              )}

              <Button
                variant="outline"
                size="sm"
                className="bg-white hover:bg-slate-50 border-slate-300 text-xs font-medium"
                onClick={() => setModalOpen(true)}
              >
                <BookOpen className="h-3.5 w-3.5 mr-1 text-blue-600" />
                All 8 Roles Matrix
              </Button>

              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs font-medium text-slate-700 hover:bg-white/80"
                onClick={() => setIsExpanded(!isExpanded)}
              >
                {isExpanded ? (
                  <>
                    Hide Charter <ChevronUp className="ml-1 h-3.5 w-3.5" />
                  </>
                ) : (
                  <>
                    View Charter <ChevronDown className="ml-1 h-3.5 w-3.5" />
                  </>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>

        {isExpanded && (
          <CardContent className="border-t border-slate-200/70 bg-white/95 p-4 sm:p-5">
            <div className="grid gap-5 md:grid-cols-2">
              {/* Left Column: Core Responsibilities */}
              <div>
                <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700 mb-3">
                  <Sparkles className="h-3.5 w-3.5 text-blue-600" />
                  Core Operational Mandate & Responsibilities
                </h4>
                <div className="space-y-2.5">
                  {spec.responsibilities.map((resp, i) => (
                    <div key={i} className="rounded-lg border border-slate-100 bg-slate-50/50 p-2.5">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-xs font-semibold text-slate-900 flex items-center gap-1.5">
                          <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                          {resp.title}
                        </p>
                        {resp.href && (
                          <Link
                            href={resp.href}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 hover:underline shrink-0"
                          >
                            Open Route <ArrowRight className="h-3 w-3" />
                          </Link>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-slate-600 pl-5 leading-normal">{resp.desc}</p>
                    </div>
                  ))}
                </div>
              </div>

              {/* Right Column: Powers, Guardrails & Legal Basis */}
              <div className="space-y-4">
                <div>
                  <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                    <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
                    Authorized Platform Powers
                  </h4>
                  <div className="flex flex-wrap gap-1.5">
                    {spec.authorized.map((auth, i) => (
                      <span
                        key={i}
                        className="inline-flex items-center rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-800 border border-emerald-200"
                      >
                        ✓ {auth}
                      </span>
                    ))}
                  </div>
                </div>

                <div>
                  <h4 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-700 mb-2">
                    <Ban className="h-3.5 w-3.5 text-rose-600" />
                    Statutory Guardrails & Restrictions
                  </h4>
                  <div className="space-y-1.5">
                    {spec.restricted.map((rest, i) => (
                      <p key={i} className="text-xs text-rose-900 bg-rose-50/80 px-2.5 py-1 rounded border border-rose-200 flex items-center gap-1.5">
                        <span>✕</span> {rest}
                      </p>
                    ))}
                  </div>
                </div>

                <div className="rounded-lg bg-blue-50/70 border border-blue-200 p-2.5">
                  <p className="text-[11px] font-semibold text-blue-950 uppercase tracking-wide">
                    Statutory & Policy Basis
                  </p>
                  <p className="mt-0.5 text-xs text-blue-800">{spec.statutoryReference}</p>
                </div>
              </div>
            </div>
          </CardContent>
        )}
      </Card>

      {/* Governance Modal: All 8 Roles Matrix */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs animate-in fade-in">
          <div className="w-full max-w-4xl max-h-[90vh] flex flex-col rounded-xl bg-white shadow-2xl border border-slate-200 overflow-hidden">
            {/* Modal Header */}
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4 bg-slate-50">
              <div>
                <h3 className="text-base font-bold text-slate-950 flex items-center gap-2">
                  <Landmark className="h-5 w-5 text-blue-600" />
                  SAMARTH AI — 8-Role Governance & Administrative Charter
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Official operational boundaries, statutory mandates, and check-and-balance matrix
                </p>
              </div>
              <button
                onClick={() => setModalOpen(false)}
                className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-200 hover:text-slate-800"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body: Tabs on Left / Details on Right */}
            <div className="flex flex-1 flex-col md:flex-row overflow-hidden">
              {/* Role Selection Tabs */}
              <div className="w-full md:w-64 border-r border-slate-200 bg-slate-50/70 overflow-y-auto p-2 space-y-1 shrink-0">
                {Object.values(ROLE_SPECIFICATIONS).map((r) => {
                  const Icon = r.icon;
                  const isSelected = selectedRoleTab === r.roleId;
                  return (
                    <button
                      key={r.roleId}
                      onClick={() => setSelectedRoleTab(r.roleId)}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-left text-xs font-semibold transition-colors ${
                        isSelected
                          ? "bg-blue-600 text-white shadow-xs"
                          : "text-slate-700 hover:bg-slate-200/70"
                      }`}
                    >
                      <Icon className={`h-4 w-4 ${isSelected ? "text-white" : "text-slate-500"}`} />
                      <div className="min-w-0">
                        <p className="truncate leading-tight">{r.name.split("(")[0].trim()}</p>
                        <p className={`text-[10px] truncate ${isSelected ? "text-blue-100" : "text-slate-400"}`}>
                          {r.level}
                        </p>
                      </div>
                    </button>
                  );
                })}
              </div>

              {/* Selected Role Content */}
              {(() => {
                const active = ROLE_SPECIFICATIONS[selectedRoleTab] || spec;
                const ActiveIcon = active.icon;
                return (
                  <div className="flex-1 overflow-y-auto p-6 space-y-5">
                    <div className="flex items-start justify-between gap-4 pb-4 border-b border-slate-100">
                      <div className="flex items-center gap-3">
                        <span className="grid h-12 w-12 place-items-center rounded-xl bg-blue-50 border border-blue-200 text-blue-700">
                          <ActiveIcon className="h-6 w-6" />
                        </span>
                        <div>
                          <h4 className="text-lg font-bold text-slate-950">{active.name}</h4>
                          <div className="flex items-center gap-2 mt-1">
                            <Badge variant="outline" className="text-xs bg-slate-100 text-slate-800">
                              {active.level}
                            </Badge>
                            <span className="text-xs text-slate-500">· {active.scope}</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="rounded-lg bg-slate-50 p-3.5 border border-slate-200/80">
                      <p className="text-xs text-slate-700 font-medium leading-relaxed">{active.summary}</p>
                    </div>

                    <div>
                      <h5 className="text-xs font-bold uppercase tracking-wider text-slate-900 mb-3 flex items-center gap-1.5">
                        <Sparkles className="h-3.5 w-3.5 text-blue-600" />
                        Operational Work & Specific Responsibilities
                      </h5>
                      <div className="grid gap-2.5 sm:grid-cols-2">
                        {active.responsibilities.map((r, i) => (
                          <div key={i} className="rounded-lg border border-slate-200 p-3 bg-white shadow-2xs flex flex-col justify-between">
                            <div>
                              <p className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
                                {r.title}
                              </p>
                              <p className="mt-1.5 text-xs text-slate-600 leading-normal">{r.desc}</p>
                            </div>
                            {r.href && (
                              <div className="mt-2.5 pt-2 border-t border-slate-100 flex justify-end">
                                <Link
                                  href={r.href}
                                  onClick={() => setModalOpen(false)}
                                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-blue-600 hover:text-blue-700 hover:underline"
                                >
                                  Open Route <ArrowRight className="h-3 w-3" />
                                </Link>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2 pt-2">
                      <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3.5">
                        <p className="text-xs font-bold text-emerald-950 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                          <ShieldCheck className="h-4 w-4 text-emerald-600" />
                          Authorized Privileges
                        </p>
                        <ul className="space-y-1.5 text-xs text-emerald-900">
                          {active.authorized.map((a, i) => (
                            <li key={i} className="flex items-start gap-1.5">
                              <span className="text-emerald-600 font-bold">✓</span>
                              <span>{a}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div className="rounded-lg border border-rose-200 bg-rose-50/40 p-3.5">
                        <p className="text-xs font-bold text-rose-950 uppercase tracking-wide mb-2 flex items-center gap-1.5">
                          <Ban className="h-4 w-4 text-rose-600" />
                          Strict Operational Guardrails
                        </p>
                        <ul className="space-y-1.5 text-xs text-rose-900">
                          {active.restricted.map((res, i) => (
                            <li key={i} className="flex items-start gap-1.5">
                              <span className="text-rose-600 font-bold">✕</span>
                              <span>{res}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    </div>

                    <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-900">
                      <strong>Statutory / Legal Reference:</strong> {active.statutoryReference}
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between border-t border-slate-200 px-6 py-3 bg-slate-50 text-xs text-slate-500">
              <span>Enforced in backend via <code className="text-blue-600 font-mono">app.core.permissions.ROLE_PERMISSIONS</code></span>
              <Button size="sm" onClick={() => setModalOpen(false)}>
                Done
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
