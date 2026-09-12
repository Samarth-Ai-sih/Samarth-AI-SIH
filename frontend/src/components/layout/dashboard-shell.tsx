"use client";

import { Button } from "@/components/ui/button";
import { NotificationBell } from "@/components/notifications/notification-bell";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import {
  BarChart3, BriefcaseBusiness, ChevronDown, ChevronLeft, ClipboardCheck, Database, FileWarning, LayoutDashboard,
  LogOut, Menu, SearchCheck, Settings, ShieldAlert, UsersRound, WalletCards, Landmark, TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
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
  // --- MoSPI National Command Center ---
  { href: "/dashboard/mospi", label: "National Command Center", icon: Landmark, roles: ["admin", "mospi"] },
  { href: "/dashboard/mospi/telemetry", label: "Macro Fund Telemetry", icon: BarChart3, roles: ["admin", "mospi"] },
  { href: "/dashboard/mospi/benchmarking", label: "State Benchmarking", icon: TrendingUp, roles: ["admin", "mospi"] },
  { href: "/dashboard/mospi/quotas", label: "Statutory SC/ST Quotas", icon: ShieldAlert, roles: ["admin", "mospi"] },
  { href: "/dashboard/mospi/releases", label: "Treasury Releases (₹2.5Cr)", icon: WalletCards, roles: ["admin", "mospi"] },
  { href: "/dashboard/mospi/ingestion", label: "PFMS / eSAKSHI Sync", icon: Database, roles: ["admin", "mospi"] },
  // --- Admin ---
  { href: "/dashboard/admin/users", label: "User management", icon: UsersRound, roles: ["admin"] },
  { href: "/dashboard/admin/permissions", label: "Permission matrix", icon: ShieldAlert, roles: ["admin"] },
  { href: "/dashboard/admin/datasets", label: "Dataset imports", icon: Database, roles: ["admin"] },
];

const roleLabels: Record<string, string> = { admin: "System administration", mospi: "National programme oversight", state_nodal_officer: "State programme oversight", district_authority: "District authority", mp: "Constituency oversight", agency: "Implementing agency", inspector: "Field inspection" };

export function DashboardShell({ children }: { children: ReactNode }) {
  const { user, logout, isLoading } = useAuth();
  const [open, setOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && !user) router.replace("/login?redirect=/dashboard");
  }, [isLoading, router, user]);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    if (userMenuOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [userMenuOpen]);

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

        <div className="mt-auto pt-3 border-t border-slate-100 px-3 text-[11px] text-slate-400">
          <p className="font-semibold text-slate-600">SAMARTH AI</p>
          <p className="text-[10px] text-slate-400">MPLADS National Platform</p>
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

          {/* Right: Role badge + Notification Bell + Quick Settings + User Profile Dropdown + Quick Sign Out */}
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="hidden lg:inline-flex items-center rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-700 border border-slate-200/80">
              {roleLabels[user.role] || user.role}
            </span>
            <div className="hidden lg:block h-4 w-px bg-slate-200" />

            {/* Notification Bell */}
            <NotificationBell align="end" />

            {/* Direct Quick Action: Settings Link */}
            <Link
              href="/dashboard/settings"
              title="Account Settings"
              className="hidden sm:grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-slate-800 transition-colors border border-transparent hover:border-slate-200"
            >
              <Settings className="h-4 w-4" />
            </Link>

            <div className="h-4 w-px bg-slate-200" />

            {/* User Profile & Account Menu Dropdown */}
            <div ref={userMenuRef} className="relative inline-block text-left">
              <button
                type="button"
                onClick={() => setUserMenuOpen((prev) => !prev)}
                className={cn(
                  "flex items-center gap-2 rounded-xl border border-slate-200/90 bg-white sm:bg-slate-50/70 p-1 sm:px-2.5 sm:py-1.5 text-xs font-medium text-slate-700 transition-all hover:bg-slate-100 hover:border-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 cursor-pointer shadow-2xs",
                  userMenuOpen && "bg-slate-100 border-slate-300 ring-2 ring-blue-500/20"
                )}
                aria-expanded={userMenuOpen}
                aria-haspopup="true"
                aria-label="User account, settings and sign out menu"
              >
                <div className="grid h-7 w-7 place-items-center rounded-full bg-slate-900 text-[11px] font-bold text-white uppercase shadow-xs ring-1 ring-slate-200 shrink-0">
                  {user.full_name?.charAt(0) || "U"}
                </div>
                <div className="hidden sm:flex flex-col text-left">
                  <span className="max-w-[130px] truncate font-semibold text-slate-900 leading-tight">
                    {user.full_name}
                  </span>
                  <span className="max-w-[130px] truncate text-[10px] text-slate-500 font-normal">
                    {roleLabels[user.role] || user.role}
                  </span>
                </div>
                <ChevronDown className={cn("h-3.5 w-3.5 text-slate-400 transition-transform duration-200", userMenuOpen && "rotate-180")} />
              </button>

              {userMenuOpen && (
                <div className="absolute right-0 mt-2 w-72 origin-top-right rounded-2xl border border-slate-200 bg-white p-2 shadow-2xl ring-1 ring-black/5 z-50 animate-in fade-in-50 zoom-in-95">
                  {/* User Profile Card Header */}
                  <div className="rounded-xl bg-gradient-to-br from-slate-50 to-slate-100/80 p-3 border border-slate-200/80">
                    <div className="flex items-center gap-2.5">
                      <div className="grid h-10 w-10 place-items-center rounded-full bg-slate-900 text-sm font-bold text-white uppercase shadow-xs">
                        {user.full_name?.charAt(0) || "U"}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-bold text-slate-950 truncate">{user.full_name}</p>
                        <p className="text-[11px] text-slate-500 truncate font-mono">{user.email}</p>
                      </div>
                    </div>

                    <div className="mt-2.5 pt-2 border-t border-slate-200/60 flex flex-col gap-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Designation</span>
                        <span className="inline-flex items-center rounded-md bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-blue-700 border border-blue-200">
                          {roleLabels[user.role] || user.role}
                        </span>
                      </div>
                      <div className="flex items-center justify-between gap-1 text-[11px] text-slate-600">
                        <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">Jurisdiction</span>
                        <span className="truncate max-w-[150px] font-medium text-slate-700" title={location}>
                          {location}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Menu Action Items */}
                  <div className="my-1.5 h-px bg-slate-100" />

                  <div className="space-y-0.5">
                    <Link
                      href="/dashboard/settings"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-2.5 w-full rounded-lg px-2.5 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-950 transition-colors"
                    >
                      <div className="grid h-7 w-7 place-items-center rounded-lg bg-slate-100 text-slate-700 border border-slate-200/60">
                        <Settings className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex-1 text-left">
                        <span className="block font-semibold text-slate-900">Account Settings</span>
                        <span className="block text-[10px] text-slate-500">Change password & preferences</span>
                      </div>
                    </Link>

                    {user.role === "mospi" && (
                      <Link
                        href="/dashboard/mospi"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2.5 w-full rounded-lg px-2.5 py-2 text-xs font-medium text-indigo-700 hover:bg-indigo-50 transition-colors"
                      >
                        <div className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-100 text-indigo-700 border border-indigo-200/60">
                          <Landmark className="h-3.5 w-3.5" />
                        </div>
                        <div className="flex-1 text-left">
                          <span className="block font-semibold text-indigo-950">MoSPI Apex Center</span>
                          <span className="block text-[10px] text-indigo-600">Macro fund telemetry & releases</span>
                        </div>
                      </Link>
                    )}
                  </div>

                  {/* Sign Out Section */}
                  <div className="my-1.5 h-px bg-slate-100" />

                  <button
                    type="button"
                    onClick={() => {
                      setUserMenuOpen(false);
                      void signOut();
                    }}
                    className="flex items-center gap-2.5 w-full rounded-lg px-2.5 py-2 text-xs font-semibold text-rose-600 hover:bg-rose-50 hover:text-rose-700 transition-colors cursor-pointer"
                  >
                    <div className="grid h-7 w-7 place-items-center rounded-lg bg-rose-100 text-rose-600 border border-rose-200/60">
                      <LogOut className="h-3.5 w-3.5" />
                    </div>
                    <div className="flex-1 text-left">
                      <span className="block">Sign out</span>
                      <span className="block text-[10px] font-normal text-rose-400">End active session securely</span>
                    </div>
                  </button>
                </div>
              )}
            </div>

            {/* Direct Quick Action: Sign Out Button */}
            <Button
              variant="outline"
              size="sm"
              onClick={() => void signOut()}
              className="hidden md:inline-flex items-center gap-1.5 h-8 px-2.5 text-xs font-medium text-rose-600 border-slate-200 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 transition-colors"
              title="Sign out of current session"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Logout</span>
            </Button>
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
