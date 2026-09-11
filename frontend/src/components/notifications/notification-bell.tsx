"use client";

import Link from "next/link";
import { Bell, CheckCheck, LoaderCircle, Inbox } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { useAuthenticatedQuery } from "@/lib/query";

type Notice = {
  notification_id: string;
  title: string;
  message: string;
  resource_type: string;
  resource_id: string;
  read_at: string | null;
  created_at: string;
};

type NoticeList = {
  notifications: Notice[];
  total: number;
  unread_total: number;
};

function resolveDestination(notice: Notice, role?: string): string {
  if (notice.resource_type === "case" || notice.resource_type === "verification_request") {
    if (role === "inspector") {
      return `/dashboard/inspections/${notice.resource_id}`;
    }
    return `/dashboard/cases/${notice.resource_id}`;
  }
  if (notice.resource_type === "citizen_issue") {
    return "/dashboard/citizen-reports";
  }
  if (notice.resource_type === "work") {
    const text = `${notice.title} ${notice.message}`.toLowerCase();
    if (text.includes("financial") || text.includes("cost") || text.includes("payment") || text.includes("expenditure") || text.includes("tranche")) {
      return `/dashboard/works/${notice.resource_id}?focus=financial`;
    }
    if (text.includes("compliance") || text.includes("rule") || text.includes("norm") || text.includes("violation")) {
      return `/dashboard/works/${notice.resource_id}?focus=compliance`;
    }
    if (text.includes("risk") || text.includes("delay") || text.includes("stalled") || text.includes("inspection")) {
      return `/dashboard/works/${notice.resource_id}?focus=risk`;
    }
    if (text.includes("duplicate") || text.includes("overlap") || text.includes("co-location")) {
      return `/dashboard/works/${notice.resource_id}?focus=duplicate`;
    }
    return `/dashboard/works/${notice.resource_id}`;
  }
  return "/dashboard/risk";
}

export function NotificationBell({ align = "end" }: { align?: "start" | "end" }) {
  const [open, setOpen] = useState(false);
  const bellRef = useRef<HTMLDivElement>(null);
  const { user, fetchWithAuth } = useAuth();
  const queryClient = useQueryClient();

  const notices = useAuthenticatedQuery<NoticeList>(
    ["in-app-notifications"],
    "/api/v1/background/notifications",
    { staleTime: 15_000, refetchInterval: 30_000 }
  );

  const markRead = useMutation({
    mutationFn: async (notificationId: string) => {
      const response = await fetchWithAuth(`/api/v1/background/notifications/${notificationId}/read`, {
        method: "PUT",
      });
      if (!response.ok) throw new Error("The notification could not be marked as read.");
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["in-app-notifications"] }),
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      const response = await fetchWithAuth("/api/v1/background/notifications/read-all", {
        method: "PUT",
      });
      if (!response.ok) throw new Error("Notifications could not be marked as read.");
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ["in-app-notifications"] }),
  });

  // Auto-dismiss on click outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (bellRef.current && !bellRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    if (open) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [open]);

  const unread = notices.data?.unread_total || 0;
  const items = notices.data?.notifications || [];

  return (
    <div ref={bellRef} className="relative inline-block text-left">
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="relative h-9 w-9 rounded-lg text-slate-700 hover:bg-sky-100/70 hover:text-sky-900 focus-visible:ring-2 focus-visible:ring-sky-500 transition-colors"
      >
        <Bell className="h-5 w-5" />
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white shadow-xs">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </Button>

      {open && (
        <section
          className={`absolute ${
            align === "end" ? "right-0" : "left-0"
          } z-50 mt-2 w-[min(24rem,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-2xl transition-all duration-200`}
          aria-label="Notifications"
        >
          {/* Header */}
          <header className="flex items-center justify-between border-b border-sky-100 bg-slate-50/80 px-4 py-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-semibold text-slate-900">Notifications</h2>
              {unread > 0 && (
                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-medium text-sky-800">
                  {unread} unread
                </span>
              )}
            </div>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => markAllRead.mutate()}
                disabled={markAllRead.isPending}
                className="flex items-center gap-1 text-xs font-medium text-sky-700 hover:text-sky-900 disabled:opacity-50"
              >
                <CheckCheck className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Mark all read</span>
              </button>
            )}
          </header>

          {/* List */}
          <div className="max-h-[26rem] overflow-y-auto divide-y divide-slate-100">
            {notices.isLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
                <LoaderCircle className="h-4 w-4 animate-spin text-sky-600" />
                <span>Loading updates…</span>
              </div>
            ) : notices.isError ? (
              <div className="p-6 text-center text-sm text-red-600">
                Notifications could not be loaded. Please try again.
              </div>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                <div className="grid h-10 w-10 place-items-center rounded-full bg-slate-100 text-slate-400">
                  <Inbox className="h-5 w-5" />
                </div>
                <p className="mt-2 text-sm font-medium text-slate-700">All caught up</p>
                <p className="text-xs text-slate-500">No new notifications in your workspace.</p>
              </div>
            ) : (
              items.map((notice) => {
                const isUnread = !notice.read_at;
                return (
                  <Link
                    key={notice.notification_id}
                    href={resolveDestination(notice, user?.role)}
                    onClick={() => {
                      if (isUnread) markRead.mutate(notice.notification_id);
                      setOpen(false);
                    }}
                    className={`block p-4 transition-colors ${
                      isUnread
                        ? "border-l-4 border-l-blue-600 bg-blue-50/40 hover:bg-blue-50/70"
                        : "border-l-4 border-l-transparent bg-white hover:bg-slate-50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <strong className={`text-sm leading-snug break-words ${isUnread ? "font-semibold text-slate-950" : "font-medium text-slate-800"}`}>
                        {notice.title}
                      </strong>
                      {isUnread && (
                        <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-blue-600" aria-label="Unread" />
                      )}
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-600 break-words">
                      {notice.message}
                    </p>
                    <p className="mt-2 text-[11px] text-slate-400">
                      {new Date(notice.created_at).toLocaleString("en-IN", {
                        dateStyle: "medium",
                        timeStyle: "short",
                      })}
                    </p>
                  </Link>
                );
              })
            )}
          </div>
        </section>
      )}
    </div>
  );
}
