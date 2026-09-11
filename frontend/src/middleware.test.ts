import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "./proxy";

function request(path: string, csrfToken?: string) {
  const headers = new Headers();
  if (csrfToken) headers.set("cookie", `csrf_token=${csrfToken}`);
  return new NextRequest(new URL(path, "http://samarth.test"), { headers });
}

describe("route protection", () => {
  it("redirects unauthenticated dashboard requests to login with a return path", () => {
    const response = proxy(request("/dashboard/works"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://samarth.test/login?redirect=%2Fdashboard%2Fworks",
    );
  });

  it("allows the login page even when a stale CSRF cookie exists", () => {
    const response = proxy(request("/login", "demo-token"));
    expect(response.status).toBe(200);
  });

  it("allows a protected request with the auth cookie", () => {
    expect(proxy(request("/dashboard", "demo-token")).status).toBe(200);
  });
});
