"use client";

import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import {
  BarChart3, BriefcaseBusiness, ChevronLeft, ClipboardCheck, Database, FileWarning, LayoutDashboard,
  LogOut, Menu, SearchCheck, Settings, ShieldAlert, UsersRound, WalletCards,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { ComponentType, ReactNode } from "react";

type NavigationItem = { href: string; label: string; icon: ComponentType<{ className?: string }>; roles?: string[] };

const allInternal = ["admin", "mospi", "state_nodal_officer", "district_authority", "mp", "agency", "inspector"];
const navigation: NavigationItem[] = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard, roles: allInternal },
  { href: "/dashboard/works", label: "Work register", icon: BriefcaseBusiness, roles: ["admin", "mospi", "state_nodal_officer", "district_authority", "mp", "agency"] },
  { href: "/dashboard/risk", label: "Risk alerts", icon: ShieldAlert, roles: ["admin", "mospi", "state_nodal_officer", "mp"] },
  { href: "/dashboard/compliance", label: "Compliance", icon: ClipboardCheck, roles: ["admin", "mospi", "state_nodal_officer", "district_authority"] },
  { href: "/dashboard/financial", label: "Financial intelligence", icon: WalletCards, roles: ["admin", "mospi", "state_nodal_officer", "district_authority", "mp"] },
  { href: "/dashboard/duplicates", label: "Duplicate explorer", icon: SearchCheck, roles: ["admin", "mospi", "state_nodal_officer", "district_authority"] },
  { href: "/dashboard/cases", label: "Case management", icon: FileWarning, roles: ["admin", "mospi", "state_nodal_officer", "district_authority"] },
  { href: "/dashboard/inspections", label: "Field inspections", icon: ClipboardCheck, roles: ["inspector"] },
  { href: "/dashboard/citizen-reports", label: "Citizen moderation", icon: UsersRound, roles: ["admin", "mospi", "state_nodal_officer", "district_authority"] },
  { href: "/dashboard/analytics", label: "Analytics & reports", icon: BarChart3, roles: ["admin", "mospi", "state_nodal_officer", "mp"] },
  { href: "/dashboard/settings", label: "Settings", icon: Settings, roles: allInternal },
  // --- Admin ---
  { href: "/dashboard/admin/users", label: "User management", icon: UsersRound, roles: ["admin"] },
  { href: "/dashboard/admin/permissions", label: "Permission matrix", icon: ShieldAlert, roles: ["admin"] },
  { href: "/dashboard/admin/datasets", label: "Dataset imports", icon: Database, roles: ["admin"] },
];

const roleLabels: Record<string, string> = { admin: "System administration", mospi: "National programme oversight", state_nodal_officer: "State programme oversight", district_authority: "District authority", mp: "Constituency oversight", agency: "Implementing agency", inspector: "Field inspection" };

export function DashboardShell({ children }: { children: ReactNode }) {
  const { user, logout, isLoading } = useAuth();
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login?redirect=/dashboard");
  }, [isLoading, router, user]);

  if (isLoading) return <div className="grid min-h-screen place-items-center bg-slate-50 text-sm text-slate-500">Preparing your workspace…</div>;
  if (!user) return <div className="grid min-h-screen place-items-center bg-slate-50 text-sm text-slate-500">Redirecting to sign in…</div>;
  if (user.role === "citizen") return <>{children}</>;

  const items = navigation.filter((item) => !item.roles || item.roles.includes(user.role));
  const currentItem = items.find((item) => pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`)));
  const pageTitle = currentItem ? currentItem.label : "Dashboard";
  const location = [user.jurisdiction.state_code, user.jurisdiction.district_code, user.jurisdiction.constituency].filter(Boolean).join(" · ") || "All assigned jurisdictions";

  async function signOut() { await logout(); router.push("/login"); }

  return (
    <div className="dashboard-surface min-h-screen bg-slate-50/50 text-slate-900">
      {/* Sidebar backdrop for mobile */}
      {open && (
        <button
          className="fixed inset-0 z-40 bg-slate-950/25 lg:hidden"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Left Sidebar */}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-slate-200 bg-white px-3 py-5 transition-transform lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between px-3">
          <Link href="/dashboard" className="text-lg font-bold tracking-tight text-slate-950">
            SAMARTH <span className="text-blue-600">AI</span>
          </Link>
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            aria-label="Close navigation"
            onClick={() => setOpen(false)}
          >
            <ChevronLeft className="h-5 w-5" />
          </Button>
        </div>

        <p className="mt-2 px-3 text-xs leading-5 text-slate-500">Public works assurance and delivery workflow</p>

        <nav className="mt-6 flex-1 space-y-1" aria-label="Primary navigation">
          {items.map((item, idx) => {
            const Icon = item.icon;
            const active = pathname === item.href || (item.href !== "/dashboard" && pathname.startsWith(`${item.href}/`));
            const isAdminSection = item.href.startsWith("/dashboard/admin");
            const prevIsAdmin = idx > 0 && items[idx - 1].href.startsWith("/dashboard/admin");

            return (
              <div key={item.href}>
                {isAdminSection && !prevIsAdmin && <div className="my-3 h-px bg-slate-100" />}
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className={cn(
                    "flex min-h-10 items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors",
                    active ? "bg-slate-100 text-slate-900 font-semibold border-l-2 border-blue-600" : "text-slate-600 hover:bg-slate-50 hover:text-slate-950"
                  )}
                >
                  <Icon className="h-4 w-4" aria-hidden="true" />
                  {item.label}
                </Link>
              </div>
            );
          })}
        </nav>

        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-sm font-semibold text-slate-900">{user.full_name}</p>
          <p className="mt-0.5 text-xs text-slate-500">{roleLabels[user.role] || user.role}</p>
          <p className="mt-2 text-xs leading-5 text-slate-500">{location}</p>
          <Button className="mt-3 w-full" variant="outline" size="sm" onClick={() => void signOut()}>
            <LogOut className="h-3.5 w-3.5" />
            Sign out
          </Button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="min-h-screen lg:pl-72 flex flex-col">
        {/* Sticky Top App Bar */}
        <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 sm:px-6 lg:px-8">
          {/* Left: Mobile hamburger + Current Page Title + Jurisdiction */}
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="lg:hidden text-slate-700 hover:bg-slate-100"
              aria-label="Open navigation"
              onClick={() => setOpen(true)}
            >
              <Menu className="h-5 w-5" />
            </Button>

            <div className="flex items-center gap-2 sm:gap-3">
              <span className="text-base font-semibold tracking-tight text-slate-950 sm:text-lg">
                {pageTitle}
              </span>
              <span className="hidden sm:inline-block text-slate-300">·</span>
              <span className="hidden sm:inline-flex items-center rounded-full border border-slate-200 bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                {location}
              </span>
            </div>
          </div>

          {/* Right: Role badge + Notification Bell + User details */}
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden md:inline-flex items-center rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-200/80">
              {roleLabels[user.role] || user.role}
            </span>
            <div className="hidden md:block h-4 w-px bg-slate-200" />
            {/* Notification Bell */}
            <NotificationBell align="end" />
            <div className="hidden sm:block h-4 w-px bg-slate-200" />
            {/* User Profile Chip */}
            <div className="hidden sm:flex items-center gap-2 text-xs font-medium text-slate-700">
              <div className="grid h-7 w-7 place-items-center rounded-full bg-slate-900 text-[11px] font-bold text-white uppercase shadow-xs">
                {user.full_name?.charAt(0) || "U"}
              </div>
              <span className="max-w-[130px] truncate">{user.full_name}</span>
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="flex-1">
          <div className="mx-auto w-full max-w-[1600px] p-4 sm:p-6 lg:p-8">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
