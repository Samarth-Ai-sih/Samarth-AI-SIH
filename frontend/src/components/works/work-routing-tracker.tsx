"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useAuthenticatedQuery } from "@/lib/query";
import {
  formatDate,
  WorkRoutingResponse,
  StageRoutingInfo,
  StakeholderInfo,
} from "@/lib/api";
import {
  CheckCircle2,
  Clock,
  AlertCircle,
  ArrowRight,
  Shield,
  UserCheck,
  Building2,
  Camera,
  Landmark,
  FileCheck2,
  ChevronDown,
  ChevronUp,
  Mail,
} from "lucide-react";

interface WorkRoutingTrackerProps {
  workId: string;
  onOpenSanctionModal?: () => void;
  onOpenInspectionModal?: () => void;
  onOpenProgressModal?: () => void;
}

export function WorkRoutingTracker({
  workId,
  onOpenSanctionModal,
  onOpenInspectionModal,
  onOpenProgressModal,
}: WorkRoutingTrackerProps) {
  const { user } = useAuth();
  const [showAllContacts, setShowAllContacts] = useState(false);

  const { data: routing, isLoading, error } = useAuthenticatedQuery<WorkRoutingResponse>(
    ["work-routing", workId],
    `/api/v1/works/${workId}/routing`
  );

  if (isLoading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-4 animate-pulse">
        <div className="h-4 w-48 bg-slate-200 rounded mb-3"></div>
        <div className="h-8 bg-slate-200 rounded mb-2"></div>
        <div className="h-16 bg-slate-200 rounded"></div>
      </div>
    );
  }

  if (error || !routing) {
    return null;
  }

  const currentCustodian = routing.current_custodian;
  const isAssignedToCurrentUser =
    user && currentCustodian && (
      (currentCustodian.user_id && user.user_id === currentCustodian.user_id) ||
      (currentCustodian.email && user.email?.toLowerCase() === currentCustodian.email.toLowerCase()) ||
      (currentCustodian.role && user.role === currentCustodian.role)
    );

  const getStatusBadge = (status: StageRoutingInfo["status"]) => {
    switch (status) {
      case "completed":
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">
            <CheckCircle2 className="h-3 w-3 text-emerald-600" /> Completed
          </span>
        );
      case "in_progress":
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-300 px-2 py-0.5 rounded-full animate-pulse">
            <Clock className="h-3 w-3 text-amber-600" /> Action Required
          </span>
        );
      case "rejected":
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 px-2 py-0.5 rounded-full">
            <AlertCircle className="h-3 w-3 text-rose-600" /> Returned / Clarification
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500 bg-slate-100 border border-slate-200 px-2 py-0.5 rounded-full">
            Pending
          </span>
        );
    }
  };

  const inspectionStage = routing.stages.find((s) => s.stage_id === "field_inspection");
  const isInspectionDispatched = Boolean(
    inspectionStage && (inspectionStage.status !== "pending" || inspectionStage.action_ref)
  );

  return (
    <div className="rounded-2xl border-2 border-slate-200 bg-white shadow-sm overflow-hidden my-4">
      {/* ── Active Custodian Live Beacon Banner ── */}
      <div
        className={`px-5 py-4 border-b ${
          routing.current_status === "recommended"
            ? "bg-gradient-to-r from-amber-500/10 via-amber-50 to-orange-50/40 border-amber-200"
            : routing.current_status === "sanctioned" || routing.current_status === "in_progress"
            ? "bg-gradient-to-r from-blue-500/10 via-sky-50 to-indigo-50/40 border-blue-200"
            : routing.current_status === "under_verification"
            ? "bg-gradient-to-r from-purple-500/10 via-indigo-50 to-purple-50/40 border-purple-200"
            : routing.current_status === "completed"
            ? "bg-gradient-to-r from-emerald-500/10 via-teal-50 to-emerald-50/40 border-emerald-200"
            : "bg-slate-50 border-slate-200"
        }`}
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="flex h-2.5 w-2.5 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-blue-600"></span>
              </span>
              <span className="text-[11px] font-bold tracking-wider uppercase text-slate-600">
                Official Workflow & Request Routing
              </span>
              {isAssignedToCurrentUser && (
                <Badge variant="warning" className="text-[10px] font-bold uppercase tracking-wide">
                  ⭐ Action Assigned to You
                </Badge>
              )}
            </div>

            <div className="flex items-baseline gap-2 flex-wrap">
              <h3 className="text-base font-bold text-slate-900">
                Currently Routed To:{" "}
                <span className="text-blue-900 underline decoration-blue-300 underline-offset-4">
                  {currentCustodian?.name || "Competent Authority"}
                </span>
              </h3>
              <span className="text-xs font-semibold text-slate-500">
                ({currentCustodian?.role_label || currentCustodian?.role})
              </span>
            </div>

            <p className="text-xs text-slate-700 max-w-2xl leading-relaxed">
              <strong className="text-slate-900">Pending Action:</strong> {routing.current_action_required}
            </p>
          </div>

          {/* Quick Action Button for the current custodian */}
          <div className="flex items-center gap-2 shrink-0">
            {routing.current_stage_id === "da_sanction" && (user?.role === "district_authority" || user?.role === "admin") && onOpenSanctionModal && (
              <Button
                onClick={onOpenSanctionModal}
                size="sm"
                className="bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs shadow-xs"
              >
                Accord Administrative Sanction <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            )}

            {!isInspectionDispatched &&
              (routing.current_status === "sanctioned" || routing.current_status === "in_progress" || routing.current_stage_id === "agency_execution") &&
              (user?.role === "district_authority" || user?.role === "agency" || user?.role === "admin") &&
              onOpenInspectionModal && (
                <Button
                  onClick={onOpenInspectionModal}
                  size="sm"
                  variant="outline"
                  className="border-blue-300 text-blue-700 hover:bg-blue-50 text-xs font-semibold"
                >
                  <Camera className="mr-1 h-3.5 w-3.5" /> Dispatch Field Inspection
                </Button>
              )}

            {isInspectionDispatched && inspectionStage?.action_ref && (
              <span className="text-[11px] font-mono text-purple-700 bg-purple-50 border border-purple-200 px-2.5 py-1 rounded-lg">
                Inspection Ref: {inspectionStage.action_ref}
              </span>
            )}

            {routing.current_stage_id === "agency_execution" && (user?.role === "agency" || user?.role === "admin") && onOpenProgressModal && (
              <Button
                onClick={onOpenProgressModal}
                size="sm"
                className="bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-xs"
              >
                Record Physical Progress <ArrowRight className="ml-1 h-3.5 w-3.5" />
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAllContacts(!showAllContacts)}
              className="text-xs text-slate-600 hover:text-slate-900"
            >
              {showAllContacts ? (
                <>Hide Stakeholder Chain <ChevronUp className="ml-1 h-3.5 w-3.5" /></>
              ) : (
                <>View Stakeholder Chain ({routing.stages.length}) <ChevronDown className="ml-1 h-3.5 w-3.5" /></>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* ── 5-Stage Governance Stepper Bar ── */}
      <div className="p-4 bg-slate-50/70 border-b border-slate-200">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          {routing.stages.map((stage, idx) => {
            const isCurrent = stage.is_current_stage;
            return (
              <div
                key={stage.stage_id}
                className={`relative rounded-xl p-3 border transition-all ${
                  isCurrent
                    ? "bg-white border-blue-400 shadow-md ring-2 ring-blue-500/20"
                    : stage.status === "completed"
                    ? "bg-emerald-50/40 border-emerald-200"
                    : "bg-white/70 border-slate-200 opacity-80"
                }`}
              >
                <div className="flex items-center justify-between gap-1.5 mb-1.5">
                  <div
                    className={`flex h-6 w-6 items-center justify-center rounded-lg text-xs font-bold ${
                      stage.status === "completed"
                        ? "bg-emerald-600 text-white"
                        : isCurrent
                        ? "bg-blue-600 text-white"
                        : "bg-slate-200 text-slate-600"
                    }`}
                  >
                    {idx + 1}
                  </div>
                  {getStatusBadge(stage.status)}
                </div>

                <h4 className="text-xs font-bold text-slate-900 line-clamp-1 mb-0.5">
                  {stage.stage_label}
                </h4>

                <p className="text-[11px] font-medium text-slate-600 line-clamp-1">
                  {stage.active_custodian?.name || "Designated Authority"}
                </p>

                {stage.action_ref && (
                  <p className="text-[10px] text-slate-500 font-mono mt-1 truncate">
                    Ref: {stage.action_ref}
                  </p>
                )}

                {stage.completed_at && (
                  <p className="text-[10px] text-emerald-700 mt-1">
                    ✓ {formatDate(stage.completed_at)}
                  </p>
                )}

                {stage.sla_days_remaining !== null && stage.sla_days_remaining !== undefined && (
                  <p className="text-[10px] font-semibold text-amber-800 mt-1">
                    ⏱️ Statutory SLA: {stage.sla_days_remaining}d
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Expandable Stakeholder Contact Matrix ── */}
      {showAllContacts && (
        <div className="p-5 bg-white space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700">
              Assigned Government Stakeholders & Communication Directory
            </h4>
            <span className="text-xs text-slate-500 font-mono">
              Work ID: {routing.work_id} · {routing.district_name || routing.district_code}
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 text-xs">
            {/* 1. Originating MP */}
            <StakeholderCard
              title="1. Proposing Member of Parliament"
              icon={<Landmark className="h-4 w-4 text-emerald-700" />}
              stakeholder={routing.originating_mp}
              badgeText="Proposer / Sponsor"
              badgeVariant="success"
            />

            {/* 2. District Authority */}
            <StakeholderCard
              title="2. District Authority (Collector / DM)"
              icon={<Shield className="h-4 w-4 text-blue-700" />}
              stakeholder={routing.district_authority}
              badgeText="Administrative Custodian"
              badgeVariant="neutral"
            />

            {/* 3. Implementing Agency */}
            <StakeholderCard
              title="3. Implementing / Executing Agency"
              icon={<Building2 className="h-4 w-4 text-indigo-700" />}
              stakeholder={routing.implementing_agency}
              badgeText="Civil Execution Body"
              badgeVariant="neutral"
            />

            {/* 4. Field Technical Inspector */}
            <StakeholderCard
              title="4. Field Technical Inspector"
              icon={<Camera className="h-4 w-4 text-purple-700" />}
              stakeholder={routing.assigned_inspector}
              badgeText="Quality & GPS Inspection"
              badgeVariant="neutral"
            />

            {/* 5. State Nodal Officer */}
            <StakeholderCard
              title="5. State Nodal Officer (Supervisory)"
              icon={<FileCheck2 className="h-4 w-4 text-teal-700" />}
              stakeholder={routing.state_nodal_officer}
              badgeText="State Oversight"
              badgeVariant="neutral"
            />
          </div>
        </div>
      )}
    </div>
  );
}

function StakeholderCard({
  title,
  icon,
  stakeholder,
  badgeText,
  badgeVariant,
}: {
  title: string;
  icon: React.ReactNode;
  stakeholder?: StakeholderInfo | null;
  badgeText: string;
  badgeVariant: "success" | "warning" | "danger" | "neutral";
}) {
  if (!stakeholder) {
    return (
      <div className="rounded-xl border border-dashed border-slate-200 p-3.5 bg-slate-50/50">
        <div className="flex items-center gap-2 mb-1">
          {icon}
          <strong className="text-slate-700 text-xs">{title}</strong>
        </div>
        <p className="text-[11px] text-slate-400">Designation pending assignment.</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 p-3.5 bg-slate-50/40 hover:bg-slate-50 transition-colors space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {icon}
          <strong className="text-slate-900 text-xs truncate">{title}</strong>
        </div>
        <Badge variant={badgeVariant} className="text-[9px] font-semibold uppercase tracking-wider shrink-0">
          {badgeText}
        </Badge>
      </div>

      <div className="space-y-0.5">
        <p className="font-semibold text-slate-950 text-xs">{stakeholder.name}</p>
        <p className="text-[11px] text-slate-500">{stakeholder.role_label}</p>
      </div>

      <div className="pt-1 border-t border-slate-200/60 flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-1 text-slate-600 truncate">
          <Mail className="h-3 w-3 text-slate-400 shrink-0" />
          <span className="truncate font-mono">{stakeholder.email}</span>
        </div>
        {stakeholder.jurisdiction && (
          <span className="text-[10px] text-slate-500 font-medium shrink-0 ml-1">
            📍 {stakeholder.jurisdiction}
          </span>
        )}
      </div>
    </div>
  );
}
