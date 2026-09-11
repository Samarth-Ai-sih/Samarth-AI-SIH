"use client";

import React, { useState, useMemo } from "react";
import { useAuth } from "@/lib/auth";
import { useAuthenticatedQuery } from "@/lib/query";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState, ErrorState, EmptyState } from "@/components/ui/states";
import { CreateUserDialog } from "@/components/admin/create-user-dialog";
import { AdminNavTabs } from "@/components/admin/admin-nav-tabs";
import { formatDate } from "@/lib/api";
import {
  Plus,
  Search,
  Users,
  UserCheck,
  UserX,
  Shield,
  RotateCcw,
  MapPin,
  ChevronRight,
  Clock,
} from "lucide-react";

interface UserResponse {
  user_id: string;
  email: string;
  username: string;
  full_name: string;
  role: string;
  jurisdiction: {
    state_code: string | null;
    district_code: string | null;
    constituency: string | null;
    assigned_task_ids: string[];
  };
  is_active: boolean;
  must_change_password: boolean;
  created_at: string;
  last_login: string | null;
}

const roleLabels: Record<string, string> = {
  admin: "Admin",
  mospi: "MoSPI Officer",
  state_nodal_officer: "State Nodal Officer",
  district_authority: "District Authority",
  inspector: "Field Inspector",
  mp: "Member of Parliament",
  agency: "Implementing Agency",
  citizen: "Citizen",
};

const roleBadgeClasses: Record<string, string> = {
  admin: "bg-purple-50 text-purple-700 border-purple-200",
  mospi: "bg-indigo-50 text-indigo-700 border-indigo-200",
  state_nodal_officer: "bg-blue-50 text-blue-700 border-blue-200",
  district_authority: "bg-blue-50 text-blue-800 border-blue-200",
  inspector: "bg-amber-50 text-amber-800 border-amber-200",
  mp: "bg-emerald-50 text-emerald-800 border-emerald-200",
  agency: "bg-teal-50 text-teal-800 border-teal-200",
  citizen: "bg-slate-100 text-slate-700 border-slate-200",
};

function getInitials(name: string): string {
  if (!name) return "U";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function UsersListPage() {
  const router = useRouter();
  const { user } = useAuth();

  const [page] = useState(1);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const skip = (page - 1) * 50;
  const { data, isLoading, error, refetch } = useAuthenticatedQuery<{ users: UserResponse[]; total: number }>(
    ["admin-users", page],
    `/api/v1/users?skip=${skip}&limit=50`
  );

  const rawUsers = useMemo(() => data?.users || [], [data]);

  // Summary Metrics
  const stats = useMemo(() => {
    const total = data?.total ?? rawUsers.length;
    const active = rawUsers.filter((u) => u.is_active).length;
    const disabled = rawUsers.filter((u) => !u.is_active).length;
    const rolesCount = new Set(rawUsers.map((u) => u.role)).size;
    return { total, active, disabled, rolesCount };
  }, [data, rawUsers]);

  // Client-side filtering
  const filteredUsers = useMemo(() => {
    let result = rawUsers;
    if (search.trim()) {
      const s = search.toLowerCase();
      result = result.filter(
        (u) =>
          u.full_name.toLowerCase().includes(s) ||
          u.email.toLowerCase().includes(s) ||
          u.username.toLowerCase().includes(s)
      );
    }
    if (roleFilter) {
      result = result.filter((u) => u.role === roleFilter);
    }
    if (statusFilter !== "all") {
      const isActive = statusFilter === "active";
      result = result.filter((u) => u.is_active === isActive);
    }
    return result;
  }, [rawUsers, search, roleFilter, statusFilter]);

  const hasActiveFilters = Boolean(search || roleFilter || statusFilter !== "all");

  const resetFilters = () => {
    setSearch("");
    setRoleFilter("");
    setStatusFilter("all");
  };

  if (user?.role !== "admin") {
    return <ErrorState title="Access denied" description="You do not have permission to view this page." />;
  }

  const formatJurisdiction = (j: UserResponse["jurisdiction"]) => {
    const parts: string[] = [];
    if (j.state_code) parts.push(`State: ${j.state_code}`);
    if (j.district_code) parts.push(`District: ${j.district_code}`);
    if (j.constituency) parts.push(`Constituency: ${j.constituency}`);
    return parts.join(" · ") || "All jurisdictions (National)";
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="User management"
        description="Create, manage, and configure system user accounts, roles, and administrative jurisdictions."
        actions={
          <Button onClick={() => setIsCreateOpen(true)} className="flex items-center gap-2 shadow-xs">
            <Plus className="h-4 w-4" />
            <span>Create user</span>
          </Button>
        }
      />

      {/* Admin Navigation Tabs */}
      <AdminNavTabs />

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <Card className="border-slate-200 bg-white shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-blue-50 text-blue-700">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Total Users</p>
                <p className="text-xl font-bold text-slate-900">{stats.total}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
                <UserCheck className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Active Accounts</p>
                <p className="text-xl font-bold text-slate-900">{stats.active}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-rose-50 text-rose-700">
                <UserX className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Disabled</p>
                <p className="text-xl font-bold text-slate-900">{stats.disabled}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-purple-50 text-purple-700">
                <Shield className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Active Roles</p>
                <p className="text-xl font-bold text-slate-900">{stats.rolesCount}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Table Card */}
      <Card className="border-slate-200 bg-white shadow-xs overflow-hidden">
        {/* Filter Toolbar */}
        <div className="border-b border-slate-100 bg-slate-50/50 p-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
              <Input
                placeholder="Search by name, email or username…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-white border-slate-200 text-sm"
              />
            </div>

            <select
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value)}
            >
              <option value="">All roles ({rawUsers.length})</option>
              {Object.entries(roleLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>

            <select
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">All status</option>
              <option value="active">Active only</option>
              <option value="disabled">Disabled only</option>
            </select>

            {hasActiveFilters && (
              <Button
                variant="ghost"
                size="sm"
                onClick={resetFilters}
                className="text-xs text-slate-500 hover:text-slate-900 gap-1"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset
              </Button>
            )}
          </div>

          <div className="text-xs text-slate-500 font-medium">
            Showing <span className="font-bold text-slate-800">{filteredUsers.length}</span> of {rawUsers.length} users
          </div>
        </div>

        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-12">
              <LoadingState label="Loading users directory…" />
            </div>
          ) : error ? (
            <div className="p-12">
              <ErrorState description="Failed to load users." onRetry={() => void refetch()} />
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="p-12">
              <EmptyState
                title="No users found"
                description={
                  hasActiveFilters
                    ? "No users match the active search and filter criteria."
                    : "No users exist in the database yet."
                }
                action={
                  hasActiveFilters ? (
                    <Button variant="outline" onClick={resetFilters}>
                      Clear filters
                    </Button>
                  ) : (
                    <Button onClick={() => setIsCreateOpen(true)}>Create user</Button>
                  )
                }
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-100">
                  <tr>
                    <th className="px-6 py-3.5">User</th>
                    <th className="px-6 py-3.5">Role</th>
                    <th className="px-6 py-3.5">Status</th>
                    <th className="px-6 py-3.5">Jurisdiction Scope</th>
                    <th className="px-6 py-3.5">Last Login</th>
                    <th className="px-4 py-3.5 text-right sr-only">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {filteredUsers.map((u) => {
                    const badgeClass =
                      roleBadgeClasses[u.role] || "bg-slate-50 text-slate-700 border-slate-200";
                    return (
                      <tr
                        key={u.user_id}
                        className="hover:bg-slate-50 cursor-pointer transition-colors group"
                        onClick={() => router.push(`/dashboard/admin/users/${u.user_id}`)}
                      >
                        <td className="px-6 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="h-9 w-9 rounded-full bg-slate-100 text-slate-800 font-semibold flex items-center justify-center text-xs shadow-2xs border border-slate-200 shrink-0">
                              {getInitials(u.full_name || u.username)}
                            </div>
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-900 group-hover:text-blue-700 transition-colors truncate">
                                {u.full_name || u.username}
                              </p>
                              <p className="text-xs text-slate-500 truncate">{u.email}</p>
                            </div>
                          </div>
                        </td>

                        <td className="px-6 py-3.5 whitespace-nowrap">
                          <span
                            className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-medium shadow-2xs ${badgeClass}`}
                          >
                            {roleLabels[u.role] || u.role}
                          </span>
                        </td>

                        <td className="px-6 py-3.5 whitespace-nowrap">
                          {u.is_active ? (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 text-xs font-medium text-emerald-700">
                              <span className="h-1.5 w-1.5 rounded-full bg-emerald-600 animate-pulse" />
                              Active
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 border border-rose-200 px-2.5 py-0.5 text-xs font-medium text-rose-700">
                              <span className="h-1.5 w-1.5 rounded-full bg-rose-500" />
                              Disabled
                            </span>
                          )}
                        </td>

                        <td className="px-6 py-3.5 text-xs text-slate-600">
                          <div className="flex items-center gap-1.5">
                            <MapPin className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            <span className="truncate max-w-xs">{formatJurisdiction(u.jurisdiction)}</span>
                          </div>
                        </td>

                        <td className="px-6 py-3.5 text-xs text-slate-500 whitespace-nowrap">
                          <div className="flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                            <span>{u.last_login ? formatDate(u.last_login) : "Never"}</span>
                          </div>
                        </td>

                        <td className="px-4 py-3.5 text-right">
                          <ChevronRight className="h-4 w-4 text-slate-300 group-hover:text-sky-600 transition-colors inline-block" />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <CreateUserDialog
        isOpen={isCreateOpen}
        onClose={() => setIsCreateOpen(false)}
        onSuccess={() => {
          void refetch();
        }}
      />
    </div>
  );
}
