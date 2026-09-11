import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, test, vi } from "vitest";

const login = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ current: { login, isLoading: false, isAuthenticated: false } }));
const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }));
vi.mock("@/lib/auth", () => ({ useAuth: () => auth.current }));
vi.mock("next/navigation", () => ({ useRouter: () => router, useSearchParams: () => ({ get: () => null }) }));
vi.mock("next/link", () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));

import LoginPage from "./page";

test("login form validates required credentials and surfaces an authentication error", async () => {
  auth.current = { login, isLoading: false, isAuthenticated: false };
  login.mockRejectedValueOnce(new Error("Invalid credentials"));
  const user = userEvent.setup();
  render(<LoginPage />);

  const email = screen.getByLabelText("Email address");
  const password = screen.getByLabelText("Password");
  expect(email).toHaveAttribute("required");
  expect(password).toHaveAttribute("minlength", "8");
  await user.type(email, "district@example.gov.in");
  await user.type(password, "BadPassword1");
  await user.click(screen.getByRole("button", { name: "Sign in securely" }));

  expect(login).toHaveBeenCalledWith("district@example.gov.in", "BadPassword1");
  expect(await screen.findByRole("alert")).toHaveTextContent("Invalid credentials");
});

test("restored sessions redirect after render", async () => {
  router.replace.mockReset();
  auth.current = { login, isLoading: false, isAuthenticated: true };
  render(<LoginPage />);

  await waitFor(() => expect(router.replace).toHaveBeenCalledWith("/dashboard"));
});
