import { render, screen, waitFor } from "@testing-library/react";
import { expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({ current: { user: null as Record<string, unknown> | null, isLoading: false, logout: vi.fn() } }));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));

vi.mock("@/lib/auth", () => ({ useAuth: () => auth.current }));
vi.mock("@/components/notifications/notification-bell", () => ({ NotificationBell: () => <span>Notification bell</span> }));
vi.mock("next/navigation", () => ({ usePathname: () => "/dashboard", useRouter: () => router }));
vi.mock("next/link", () => ({ default: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => <a href={href} {...props}>{children}</a> }));

import { DashboardShell } from "./dashboard-shell";

function user(role: string) {
  return { role, full_name: "Test User", jurisdiction: { state_code: "UP", district_code: "LKO", constituency: null } };
}

test("redirects an unauthenticated session after render", async () => {
  router.replace.mockReset();
  auth.current = { user: null, isLoading: false, logout: vi.fn() };
  render(<DashboardShell><p>Protected content</p></DashboardShell>);

  expect(screen.getByText("Redirecting to sign in…")).toBeInTheDocument();
  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/login?redirect=/dashboard"));
});

test("inspector navigation exposes the field queue without unrelated management routes", () => {
  auth.current = { user: user("inspector"), isLoading: false, logout: vi.fn() };
  render(<DashboardShell><p>Assigned content</p></DashboardShell>);
  expect(screen.getByRole("link", { name: "Field inspections" })).toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Work register" })).not.toBeInTheDocument();
  expect(screen.queryByRole("link", { name: "Risk alerts" })).not.toBeInTheDocument();
});

test("district navigation exposes jurisdictional review tools", () => {
  auth.current = { user: user("district_authority"), isLoading: false, logout: vi.fn() };
  render(<DashboardShell><p>District content</p></DashboardShell>);
  expect(screen.getByRole("link", { name: "Case management" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Citizen moderation" })).toBeInTheDocument();
});
