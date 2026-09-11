"use client";

import React, { useMemo, useState } from "react";
import { useAuthenticatedQuery } from "@/lib/query";
import { PageHeader } from "@/components/ui/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { LoadingState, ErrorState } from "@/components/ui/states";
import { AdminNavTabs } from "@/components/admin/admin-nav-tabs";
import {
  ShieldCheck,
  ShieldAlert,
  Search,
  Check,
  Info,
  Filter,
  Users,
  Layers,
  Sparkles,
  Eye,
  SlidersHorizontal,
} from "lucide-react";

type Permission = {
  permission: string;
  label: string;
  description: string;
  category: string;
};

type RoleDef = {
  role: string;
  label: string;
  scope_label: string;
  permissions: string[];
};

type PermissionMatrixResponse = {
  permissions: Permission[];
  roles: RoleDef[];
  policy_source: string;
};

export default function PermissionsPage() {
  const { data, isLoading, isError, error, refetch } = useAuthenticatedQuery<PermissionMatrixResponse>(
    ["permissions-matrix"],
    "/api/v1/users/permissions"
  );

  const [search, setSearch] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [focusedRole, setFocusedRole] = useState<string>("all");
  const [simpleMode, setSimpleMode] = useState<boolean>(true);

  const roles = data?.roles || [];
  const allPermissions = data?.permissions || [];

  // Group and filter permissions
  const categoriesMap = useMemo(() => {
    const map = new Map<string, Permission[]>();
    allPermissions.forEach((p) => {
      // Apply search filter
      if (search) {
        const query = search.toLowerCase();
        const matchLabel = p.label.toLowerCase().includes(query);
        const matchKey = p.permission.toLowerCase().includes(query);
        const matchDesc = p.description.toLowerCase().includes(query);
        if (!matchLabel && !matchKey && !matchDesc) return;
      }
      // Apply category filter
      if (selectedCategory !== "all" && p.category.toLowerCase() !== selectedCategory.toLowerCase()) {
        return;
      }
      if (!map.has(p.category)) {
        map.set(p.category, []);
      }
      map.get(p.category)!.push(p);
    });
    return map;
  }, [allPermissions, search, selectedCategory]);

  const allCategoryNames = useMemo(() => {
    const set = new Set<string>();
    allPermissions.forEach((p) => set.add(p.category));
    return Array.from(set);
  }, [allPermissions]);

  const categoryOrder = [
    "Works",
    "Risk",
    "Investigations",
    "Payments",
    "Evidence",
    "Administration",
    "Jurisdiction",
    "Data ingestion",
    "Compliance",
  ];

  const sortedCategories = useMemo(() => {
    return Array.from(categoriesMap.keys()).sort((a, b) => {
      const idxA = categoryOrder.indexOf(a);
      const idxB = categoryOrder.indexOf(b);
      if (idxA !== -1 && idxB !== -1) return idxA - idxB;
      if (idxA !== -1) return -1;
      if (idxB !== -1) return 1;
      return a.localeCompare(b);
    });
  }, [categoriesMap]);

  // Display roles based on role filter
  const displayedRoles = useMemo(() => {
    if (focusedRole === "all") return roles;
    return roles.filter((r) => r.role === focusedRole);
  }, [roles, focusedRole]);

  if (isLoading) return <LoadingState label="Loading permission matrix..." />;
  if (isError) return <ErrorState description={(error as Error).message} onRetry={() => void refetch()} />;

  const getPermissionIndicator = (role: RoleDef, perm: Permission) => {
    const hasPermission = role.permissions.includes(perm.permission);
    if (!hasPermission) {
      if (simpleMode) {
        return <span className="text-slate-300 font-bold select-none text-sm tracking-wider" title="No access">—</span>;
      }
      return (
        <span className="inline-block rounded px-2 py-0.5 text-[11px] font-normal text-slate-400 bg-slate-50 border border-slate-100">
          No
        </span>
      );
    }

    if (role.role === "admin") {
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-purple-200 bg-purple-50/80 px-2 py-0.5 text-xs font-medium text-purple-700 shadow-2xs">
          <Check className="h-3 w-3 text-purple-600 stroke-[2.5]" />
          <span>Full</span>
        </span>
      );
    }

    if (
      perm.permission.startsWith("write") ||
      perm.permission.startsWith("create") ||
      perm.permission.startsWith("manage") ||
      perm.permission.startsWith("assign") ||
      perm.permission.startsWith("edit")
    ) {
      return (
        <span className="inline-flex items-center gap-1 rounded-md border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-medium text-sky-800 shadow-2xs">
          <Check className="h-3 w-3 text-sky-600 stroke-[2.5]" />
          <span>Write</span>
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800 shadow-2xs">
        <Check className="h-3 w-3 text-emerald-600 stroke-[2.5]" />
        <span>Read</span>
      </span>
    );
  };

  const totalFilteredPerms = Array.from(categoriesMap.values()).reduce((acc, curr) => acc + curr.length, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Permission matrix"
        description="Role-Based Access Control (RBAC) definitions specifying capabilities and access restrictions across platform modules."
      />

      {/* Admin Navigation Sub-Header */}
      <AdminNavTabs />

      {/* Overview Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <Card className="border-sky-100 bg-white shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-sky-50 text-sky-700">
                <Users className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Roles Defined</p>
                <p className="text-xl font-bold text-slate-900">{roles.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-sky-100 bg-white shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-emerald-50 text-emerald-700">
                <Layers className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Modules</p>
                <p className="text-xl font-bold text-slate-900">{allCategoryNames.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-purple-50 text-purple-700">
                <ShieldCheck className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Capabilities</p>
                <p className="text-xl font-bold text-slate-900">{allPermissions.length}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-slate-200 bg-white shadow-xs">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="grid h-10 w-10 place-items-center rounded-lg bg-amber-50 text-amber-700">
                <Sparkles className="h-5 w-5" />
              </div>
              <div>
                <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Enforcement</p>
                <p className="text-base font-bold text-slate-900 truncate">Strict RBAC</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Table Card */}
      <Card className="border-slate-200 bg-white shadow-xs">
        {/* Controls & Filter Bar */}
        <div className="border-b border-slate-200 bg-slate-50/60 p-4 sm:p-5 space-y-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="relative w-full sm:w-80">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input
                type="text"
                placeholder="Search capability or scope…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full pl-9 pr-4 py-2 text-sm rounded-lg border border-slate-200 bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs"
              />
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto justify-between sm:justify-end">
              {/* Focus Role Selector */}
              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                <Filter className="h-3.5 w-3.5 text-slate-400" />
                <span>Role:</span>
                <select
                  value={focusedRole}
                  onChange={(e) => setFocusedRole(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-2xs"
                >
                  <option value="all">All Roles ({roles.length})</option>
                  {roles.map((r) => (
                    <option key={r.role} value={r.role}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Simple Mode Toggle */}
              <button
                type="button"
                onClick={() => setSimpleMode(!simpleMode)}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  simpleMode
                    ? "border-blue-200 bg-blue-50 text-blue-800"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
                <span>{simpleMode ? "Clean view (—)" : "Verbose badges"}</span>
              </button>
            </div>
          </div>

          {/* Category Filter Pills */}
          <div className="flex flex-wrap items-center gap-1.5 pt-1">
            <span className="text-xs font-medium text-slate-500 mr-1">Category:</span>
            <button
              type="button"
              onClick={() => setSelectedCategory("all")}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                selectedCategory === "all"
                  ? "bg-blue-600 text-white shadow-2xs"
                  : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
              }`}
            >
              All ({allPermissions.length})
            </button>
            {allCategoryNames.map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setSelectedCategory(cat)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  selectedCategory === cat
                    ? "bg-blue-600 text-white shadow-2xs"
                    : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Matrix Table */}
        <CardContent className="p-0">
          {totalFilteredPerms === 0 ? (
            <div className="p-12 text-center">
              <ShieldAlert className="mx-auto h-8 w-8 text-slate-400" />
              <p className="mt-2 text-sm font-medium text-slate-700">No capabilities match your search</p>
              <p className="mt-1 text-xs text-slate-500">Try clearing the search or category filters.</p>
              <button
                type="button"
                onClick={() => {
                  setSearch("");
                  setSelectedCategory("all");
                  setFocusedRole("all");
                }}
                className="mt-4 inline-flex items-center rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 shadow-2xs"
              >
                Reset filters
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left border-collapse">
                <thead className="bg-slate-50 text-slate-700 sticky top-0 z-20 border-b border-slate-200">
                  <tr>
                    <th className="px-6 py-4 font-semibold sticky left-0 z-30 bg-slate-50 border-r border-slate-200 w-72 min-w-[280px] shadow-[2px_0_4px_rgba(0,0,0,0.02)]">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                        Capability & Scope
                      </span>
                    </th>
                    {displayedRoles.map((role) => (
                      <th
                        key={role.role}
                        className="px-5 py-4 font-semibold border-r border-slate-200 last:border-r-0 text-center min-w-[130px]"
                      >
                        <div className="text-sm font-semibold text-slate-900">{role.label}</div>
                        <div className="text-[11px] font-normal text-slate-500 mt-0.5">
                          {role.scope_label}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100 bg-white">
                  {sortedCategories.map((category) => (
                    <React.Fragment key={category}>
                      {/* Module Header Bar */}
                      <tr className="bg-slate-50 border-y border-slate-200">
                        <td
                          colSpan={displayedRoles.length + 1}
                          className="px-6 py-2.5 font-bold text-slate-900 sticky left-0 z-10 text-xs uppercase tracking-wider bg-slate-50 shadow-[2px_0_4px_rgba(0,0,0,0.02)]"
                        >
                          <div className="flex items-center gap-2">
                            <span className="h-2 w-2 rounded-full bg-blue-600" />
                            <span>{category}</span>
                            <span className="text-[11px] font-normal text-slate-500">
                              ({categoriesMap.get(category)?.length || 0} permissions)
                            </span>
                          </div>
                        </td>
                      </tr>

                      {/* Capabilities in Category */}
                      {categoriesMap.get(category)?.map((perm) => (
                        <tr
                          key={perm.permission}
                          className="hover:bg-slate-50/80 transition-colors group"
                        >
                          {/* Permission Title & Info */}
                          <td className="px-6 py-3 border-r border-slate-200 sticky left-0 z-10 bg-white group-hover:bg-slate-50/80 shadow-[2px_0_4px_rgba(0,0,0,0.02)] transition-colors">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-medium text-slate-800 text-sm">
                                {perm.label}
                              </span>
                              <div
                                title={perm.description}
                                className="cursor-help text-slate-400 hover:text-blue-700 transition-colors"
                              >
                                <Info className="h-3.5 w-3.5" />
                              </div>
                            </div>
                            <div className="text-[11px] font-mono text-slate-400 mt-0.5">
                              {perm.permission}
                            </div>
                          </td>

                          {/* Role Permission Cells */}
                          {displayedRoles.map((role) => (
                            <td
                              key={`${role.role}-${perm.permission}`}
                              className="px-4 py-3 text-center border-r border-slate-100 last:border-r-0"
                            >
                              {getPermissionIndicator(role, perm)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </React.Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>

        {/* Footer info & legend */}
        <div className="border-t border-slate-200 bg-slate-50/60 p-4 sm:p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 text-xs">
          <div className="flex flex-wrap items-center gap-4 text-slate-600">
            <span className="font-semibold text-slate-700">Legend:</span>
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded border border-purple-200 bg-purple-50 px-2 py-0.5 text-[11px] font-medium text-purple-700">
                <Check className="h-2.5 w-2.5 text-purple-600" /> Full
              </span>
              <span>All rights</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-800">
                <Check className="h-2.5 w-2.5 text-blue-600" /> Write
              </span>
              <span>Create/Update</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-800">
                <Check className="h-2.5 w-2.5 text-emerald-600" /> Read
              </span>
              <span>View only</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-slate-400 font-bold select-none text-sm px-1">—</span>
              <span>No access</span>
            </div>
          </div>

          <div className="text-slate-400 font-mono text-[11px]">
            Policy Source: {data?.policy_source}
          </div>
        </div>
      </Card>
    </div>
  );
}

