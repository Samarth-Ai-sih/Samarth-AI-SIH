"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Users, ShieldCheck, Database } from "lucide-react";

export function AdminNavTabs() {
  const pathname = usePathname();

  const tabs = [
    {
      href: "/dashboard/admin/users",
      label: "User accounts",
      icon: Users,
    },
    {
      href: "/dashboard/admin/permissions",
      label: "Permission matrix",
      icon: ShieldCheck,
    },
    {
      href: "/dashboard/admin/datasets",
      label: "Dataset imports",
      icon: Database,
    },
  ];

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-1.5 shadow-xs mb-6 inline-flex flex-wrap gap-1.5">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const active = pathname === tab.href || (tab.href !== "/dashboard/admin" && pathname.startsWith(tab.href + "/"));
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={`flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition-all ${
              active
                ? "bg-blue-600 text-white shadow-xs"
                : "text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            }`}
          >
            <Icon className={`h-4 w-4 ${active ? "text-white" : "text-slate-500"}`} />
            <span>{tab.label}</span>
          </Link>
        );
      })}
    </div>
  );
}