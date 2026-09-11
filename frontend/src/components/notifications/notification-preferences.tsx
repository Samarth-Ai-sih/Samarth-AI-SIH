"use client";

import { BellRing, Mail, MessageCircleMore, Smartphone } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/lib/auth";
import type { NotificationPreference } from "@/lib/api";
import { useAuthenticatedQuery } from "@/lib/query";

const channels = [
  { key: "in_app_enabled", label: "In-app notifications", detail: "Visible in your protected workspace.", icon: BellRing },
  { key: "email_enabled", label: "Email", detail: "Delivered only when an approved adapter is configured.", icon: Mail },
  { key: "sms_enabled", label: "SMS", detail: "Delivered only when an approved adapter is configured.", icon: Smartphone },
  { key: "whatsapp_enabled", label: "WhatsApp", detail: "Delivered only when an approved adapter is configured.", icon: MessageCircleMore },
] as const;

export function NotificationPreferencesCard() {
  const { fetchWithAuth } = useAuth(); const client = useQueryClient();
  const preferences = useAuthenticatedQuery<NotificationPreference>(["notification-preferences"], "/api/v1/background/notification-preferences");
  const update = useMutation({
    mutationFn: async (payload: Partial<NotificationPreference>) => {
      const response = await fetchWithAuth("/api/v1/background/notification-preferences", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!response.ok) throw new Error("Preferences could not be saved.");
      return response.json() as Promise<NotificationPreference>;
    },
    onSuccess: (result) => client.setQueryData(["notification-preferences"], result),
  });
  return <Card className="mt-6 max-w-4xl"><CardHeader><CardTitle>Notification preferences</CardTitle><CardDescription>Delivery content is limited to safe workflow prompts. Private evidence, citizen details, GPS, and financial data are never sent through these channels.</CardDescription></CardHeader><CardContent>{preferences.isLoading ? <p className="text-sm text-slate-500">Loading notification preferences…</p> : preferences.isError ? <p className="text-sm text-red-700">Notification preferences could not be loaded.</p> : <div className="divide-y divide-slate-100">{channels.map(({ key, label, detail, icon: Icon }) => <label key={key} className="flex cursor-pointer items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"><span className="flex gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-sky-100 text-sky-800"><Icon className="h-4 w-4" /></span><span><strong className="block text-sm text-slate-900">{label}</strong><span className="mt-0.5 block text-xs leading-5 text-slate-500">{detail}</span></span></span><input type="checkbox" className="h-4 w-4 accent-sky-700" checked={Boolean(preferences.data?.[key])} disabled={update.isPending} onChange={(event) => update.mutate({ [key]: event.target.checked })} aria-label={`Enable ${label}`} /></label>)}</div>}{update.isError && <p role="alert" className="mt-4 text-sm text-red-700">Preferences could not be saved. Try again.</p>}</CardContent></Card>;
}
