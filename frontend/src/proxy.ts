import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Next.js proxy for route protection.
 *
 * - /dashboard/* routes require the csrf_token cookie (set on login).
 *   If missing, redirect to /login.
 * - /login remains reachable even when a CSRF cookie exists. The client
 *   verifies the refresh token before routing an authenticated session.
 *
 * Note: This is a lightweight check. Full auth validation happens on the
 * backend via JWT. The cookie presence is a UX signal, not a security gate.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasCsrfToken = request.cookies.has("csrf_token");

  if (pathname.startsWith("/dashboard") && !hasCsrfToken) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*"],
};
