import { render, screen } from "@testing-library/react";
import { expect, test, vi } from "vitest";

const auth = vi.hoisted(() => ({
  current: { user: null as { role: string } | null, isLoading: false },
}));

vi.mock("@/lib/auth", () => ({ useAuth: () => auth.current }));
vi.mock("@/components/dashboard/role-overview", () => ({ RoleOverview: () => <p>Role overview data</p> }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

import DashboardPage from "./page";

test("dashboard shows a loading state while the session is restored", () => {
  auth.current = { user: null, isLoading: true };
  render(<DashboardPage />);
  expect(screen.getByText("Preparing your workspace…")).toBeInTheDocument();
});

test("citizen sessions never receive an internal dashboard workflow", () => {
  auth.current = { user: { role: "citizen" }, isLoading: false };
  render(<DashboardPage />);
  expect(screen.getByText("This is an internal workspace")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Open Citizen Portal" })).toHaveAttribute("href", "/");
  expect(screen.queryByText("Role overview data")).not.toBeInTheDocument();
});

test("an internal session can render the role-scoped dashboard", () => {
  auth.current = { user: { role: "district_authority" }, isLoading: false };
  render(<DashboardPage />);
  expect(screen.getByText("Role overview data")).toBeInTheDocument();
});
