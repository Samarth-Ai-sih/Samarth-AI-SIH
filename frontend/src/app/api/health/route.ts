import { NextResponse } from "next/server";

/** Lightweight frontend liveness endpoint for container/orchestrator probes. */
export function GET() {
  return NextResponse.json({
    status: "ok",
    service: "samarth-frontend",
    timestamp: new Date().toISOString(),
  });
}
