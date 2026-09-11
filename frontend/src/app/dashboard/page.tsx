"use client";

import Link from "next/link";
import { RoleOverview } from "@/components/dashboard/role-overview";
import { Button } from "@/components/ui/button";
import { EmptyState, LoadingState } from "@/components/ui/states";
import { useAuth } from "@/lib/auth";

export default function DashboardPage() {
  const { user, isLoading } = useAuth();

  if (isLoading) return <LoadingState label="Preparing your workspace…" />;
  if (user?.role === "citizen") {
    return <EmptyState title="This is an internal workspace" description="Use the Citizen Portal to find public works or follow a submitted ground issue." action={<Button asChild><Link href="/">Open Citizen Portal</Link></Button>} />;
  }
  return <RoleOverview />;
}
