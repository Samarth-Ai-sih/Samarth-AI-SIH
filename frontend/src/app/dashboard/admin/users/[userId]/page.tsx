"use client";

import React, { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useAuthenticatedQuery } from "@/lib/query";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState, ErrorState } from "@/components/ui/states";
import { formatDate, formatApiError } from "@/lib/api";
import { ArrowLeft, KeyRound, Shield, UserRound, Zap } from "lucide-react";
import Link from "next/link";

const roleLabels: Record<string, string> = {
  admin: "Admin", mospi: "MoSPI", state_nodal_officer: "State Nodal Officer",
  district_authority: "District Authority", inspector: "Inspector", mp: "MP",
  agency: "Agency", citizen: "Citizen",
};

interface UserData {
  user_id: string; email: string; username: string; full_name: string; role: string;
  jurisdiction: { state_code: string | null; district_code: string | null; constituency: string | null; assigned_task_ids: string[] };
  is_active: boolean; must_change_password: boolean; created_at: string; last_login: string | null;
}

interface AuditLog { log_id: string; event_type: string; timestamp: string; ip_address: string; details: Record<string, unknown> }

export default function UserDetailPage() {
  const { userId } = useParams();
  const router = useRouter();
  const { user, fetchWithAuth } = useAuth();

  const [roleFormData, setRoleFormData] = useState({ role: "", state_code: "", district_code: "", constituency: "" });
  const [isRoleEditing, setIsRoleEditing] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [actionLoading, setActionLoading] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const { data: userData, isLoading: userLoading, error: userError, refetch: refetchUser } = useAuthenticatedQuery<UserData>(
    ["admin-user", userId], `/api/v1/users/${userId}`
  );
  const { data: auditData, isLoading: auditLoading } = useAuthenticatedQuery<{ logs: AuditLog[]; total: number }>(
    ["admin-user-audit", userId], `/api/v1/users/${userId}/audit?skip=0&limit=20`
  );

  if (user?.role !== "admin") return <ErrorState title="Access denied" description="Admin access required." />;
  if (userLoading) return <LoadingState label="Loading user details…" />;
  if (userError || !userData) return <ErrorState description="Failed to load user." onRetry={() => void refetchUser()} />;

  const handleUpdateRole = async () => {
    setActionLoading(true); setMessage(null);
    try {
      const jurisdiction: Record<string, unknown> = { assigned_task_ids: userData.jurisdiction?.assigned_task_ids || [] };
      if (["state_nodal_officer", "district_authority", "inspector", "mp", "agency"].includes(roleFormData.role)) {
        jurisdiction.state_code = roleFormData.state_code || null;
      }
      if (["district_authority", "inspector", "agency"].includes(roleFormData.role)) {
        jurisdiction.district_code = roleFormData.district_code || null;
      }
      if (roleFormData.role === "mp") {
        jurisdiction.constituency = roleFormData.constituency || null;
      }
      const res = await fetchWithAuth(`/api/v1/users/${userId}/role`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: roleFormData.role, jurisdiction }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(formatApiError(b.detail, "Failed to update role")); }
      setMessage({ type: "success", text: "Role and jurisdiction updated. User sessions have been revoked." });
      setIsRoleEditing(false); void refetchUser();
    } catch (err) { setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed" }); }
    finally { setActionLoading(false); }
  };

  const handleToggleStatus = async () => {
    if (!confirm(`Are you sure you want to ${userData.is_active ? "deactivate" : "activate"} this user?`)) return;
    setActionLoading(true); setMessage(null);
    try {
      const res = await fetchWithAuth(`/api/v1/users/${userId}/status`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !userData.is_active }),
      });
      if (!res.ok) { const b = await res.json().catch(() => ({})); throw new Error(formatApiError(b.detail, "Failed to update status")); }
      setMessage({ type: "success", text: `User ${!userData.is_active ? "activated" : "deactivated"} successfully.` });
      void refetchUser();
    } catch (err) { setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed" }); }
    finally { setActionLoading(false); }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 8) { setMessage({ type: "error", text: "Password must be at least 8 characters." }); return; }
    setActionLoading(true); setMessage(null);
    try {
      const res = await fetchWithAuth(`/api/v1/users/${userId}/password-reset`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ new_password: newPassword }),
      });
      if (!res.ok) throw new Error("Failed to reset password");
      setMessage({ type: "success", text: "Password reset. User must change password on next login." });
      setNewPassword("");
    } catch (err) { setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed" }); }
    finally { setActionLoading(false); }
  };

  const handleRevokeSessions = async () => {
    if (!confirm("Revoke all active sessions? The user will be logged out immediately.")) return;
    setActionLoading(true); setMessage(null);
    try {
      const res = await fetchWithAuth(`/api/v1/users/${userId}/sessions/revoke`, { method: "POST" });
      if (!res.ok) throw new Error("Failed");
      const body = await res.json();
      setMessage({ type: "success", text: body.message || "All sessions revoked." });
    } catch (err) { setMessage({ type: "error", text: err instanceof Error ? err.message : "Failed" }); }
    finally { setActionLoading(false); }
  };

  const startEditingRole = () => {
    setRoleFormData({
      role: userData.role,
      state_code: userData.jurisdiction?.state_code || "",
      district_code: userData.jurisdiction?.district_code || "",
      constituency: userData.jurisdiction?.constituency || "",
    });
    setIsRoleEditing(true);
  };

  const scope = [userData.jurisdiction.state_code && `State: ${userData.jurisdiction.state_code}`, userData.jurisdiction.district_code && `District: ${userData.jurisdiction.district_code}`, userData.jurisdiction.constituency && `Constituency: ${userData.jurisdiction.constituency}`].filter(Boolean);
  const auditLogs = auditData?.logs || [];

  return (
    <>
      <div className="mb-4">
        <Button variant="ghost" size="sm" asChild><Link href="/dashboard/admin/users"><ArrowLeft className="h-4 w-4" />Back to users</Link></Button>
      </div>

      <PageHeader eyebrow={roleLabels[userData.role] || userData.role} title={userData.full_name} description={userData.email} />

      {message && (
        <div role="alert" className={`mb-6 rounded-lg border px-4 py-3 text-sm ${message.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>
          {message.text}
        </div>
      )}

      <section className="grid gap-6 lg:grid-cols-2">
        {/* Profile Card */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><UserRound className="h-5 w-5 text-sky-700" />Account profile</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Info label="User ID" value={userData.user_id} mono />
            <Info label="Username" value={userData.username} />
            <Info label="Full name" value={userData.full_name} />
            <Info label="Email" value={userData.email} />
            <Info label="Created" value={formatDate(userData.created_at)} />
            <Info label="Last login" value={userData.last_login ? formatDate(userData.last_login) : "Never"} />
            <Info label="Must change password" value={userData.must_change_password ? "Yes" : "No"} />
          </CardContent>
        </Card>

        {/* Role & Jurisdiction Card */}
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4">
            <div><CardTitle className="flex items-center gap-2"><Shield className="h-5 w-5 text-sky-700" />Role & jurisdiction</CardTitle>
            <CardDescription>Changes revoke all active sessions.</CardDescription></div>
            {!isRoleEditing && <Button variant="outline" size="sm" onClick={startEditingRole} disabled={actionLoading}>Edit</Button>}
          </CardHeader>
          <CardContent>
            {isRoleEditing ? (
              <div className="space-y-3">
                <label className="grid gap-1.5 text-sm font-medium text-slate-700">Role
                  <select className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm" value={roleFormData.role} onChange={(e) => setRoleFormData({ ...roleFormData, role: e.target.value })}>
                    {Object.entries(roleLabels).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select>
                </label>
                {["state_nodal_officer", "district_authority", "inspector", "mp", "agency"].includes(roleFormData.role) && (
                  <label className="grid gap-1.5 text-sm font-medium text-slate-700">State code
                    <Input placeholder="e.g. Maharashtra" value={roleFormData.state_code} onChange={(e) => setRoleFormData({ ...roleFormData, state_code: e.target.value })} />
                  </label>
                )}
                {["district_authority", "inspector", "agency"].includes(roleFormData.role) && (
                  <label className="grid gap-1.5 text-sm font-medium text-slate-700">District code
                    <Input placeholder="e.g. Mumbai" value={roleFormData.district_code} onChange={(e) => setRoleFormData({ ...roleFormData, district_code: e.target.value })} />
                  </label>
                )}
                {roleFormData.role === "mp" && (
                  <label className="grid gap-1.5 text-sm font-medium text-slate-700">Constituency
                    <Input placeholder="e.g. Mumbai North" value={roleFormData.constituency} onChange={(e) => setRoleFormData({ ...roleFormData, constituency: e.target.value })} />
                  </label>
                )}
                <div className="flex gap-2 pt-2">
                  <Button size="sm" onClick={handleUpdateRole} disabled={actionLoading}>{actionLoading ? "Saving…" : "Save changes"}</Button>
                  <Button size="sm" variant="outline" onClick={() => setIsRoleEditing(false)} disabled={actionLoading}>Cancel</Button>
                </div>
              </div>
            ) : (
              <div className="space-y-3 text-sm">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 w-28">Role</span>
                  <Badge variant="secondary">{roleLabels[userData.role] || userData.role}</Badge>
                </div>
                {scope.length > 0 ? scope.map((s) => (
                  <div key={s} className="flex items-center gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 w-28">{(s as string).split(":")[0]}</span>
                    <span className="text-slate-900">{(s as string).split(": ")[1]}</span>
                  </div>
                )) : (
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 w-28">Scope</span>
                    <span className="text-slate-900">All jurisdictions</span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Account Status Card */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Zap className="h-5 w-5 text-sky-700" />Account status</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-700">Current status: {userData.is_active ? <span className="font-semibold text-emerald-700">Active</span> : <span className="font-semibold text-red-700">Disabled</span>}</p>
                <p className="mt-1 text-xs text-slate-500">Disabled users cannot log in or access the system.</p>
              </div>
              <Button variant={userData.is_active ? "outline" : "default"} size="sm" onClick={handleToggleStatus} disabled={actionLoading} className={userData.is_active ? "border-red-200 text-red-700 hover:bg-red-50" : ""}>
                {userData.is_active ? "Deactivate" : "Activate"}
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* Security & Sessions Card */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-sky-700" />Security & sessions</CardTitle></CardHeader>
          <CardContent className="space-y-5">
            <form onSubmit={handleResetPassword} className="space-y-3">
              <p className="text-sm font-medium text-slate-700">Reset password</p>
              <div className="flex gap-2">
                <Input type="password" placeholder="New password (min 8 chars)" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} className="flex-1" />
                <Button type="submit" disabled={actionLoading || !newPassword}>Reset</Button>
              </div>
              <p className="text-xs text-slate-500">Sets a temporary password. User must change it at next login.</p>
            </form>
            <div className="border-t border-slate-100 pt-4 space-y-3">
              <p className="text-sm font-medium text-slate-700">Active sessions</p>
              <p className="text-xs text-slate-500">Force the user to sign out from all devices.</p>
              <Button variant="outline" size="sm" onClick={handleRevokeSessions} disabled={actionLoading} className="border-red-200 text-red-700 hover:bg-red-50">
                Revoke all sessions
              </Button>
            </div>
          </CardContent>
        </Card>
      </section>

      {/* Audit History */}
      <Card className="mt-6">
        <CardHeader><CardTitle>Recent audit history</CardTitle><CardDescription>Security and workflow events targeting this account.</CardDescription></CardHeader>
        <CardContent className="p-0">
          {auditLoading ? (
            <div className="p-6 text-center text-sm text-slate-500">Loading audit history…</div>
          ) : auditLogs.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">No audit events found for this user.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-xs font-medium uppercase tracking-wider text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3">Event</th>
                    <th className="px-4 py-3">IP address</th>
                    <th className="px-4 py-3">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {auditLogs.map((log) => (
                    <tr key={log.log_id} className="hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap text-xs text-slate-500">{formatDate(log.timestamp)}</td>
                      <td className="px-4 py-3 font-medium text-slate-900">{log.event_type.replace(/_/g, " ")}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{log.ip_address}</td>
                      <td className="px-4 py-3 text-xs text-slate-500 max-w-xs truncate" title={JSON.stringify(log.details)}>{JSON.stringify(log.details)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start gap-3">
      <span className="text-xs font-semibold uppercase tracking-wide text-slate-500 w-36 pt-0.5">{label}</span>
      <span className={`text-slate-900 ${mono ? "font-mono text-xs" : ""}`}>{value}</span>
    </div>
  );
}
