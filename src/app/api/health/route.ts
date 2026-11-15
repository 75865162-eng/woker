import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Unauthenticated liveness probe for reverse proxies and systemd health checks.
 * Deliberately performs no database / Redis work and exposes no configuration,
 * version or tenant details. Use `npm run check:production` for readiness.
 */
export function GET() {
  return NextResponse.json(
    { status: "ok" },
    { headers: { "Cache-Control": "no-store" } },
  );
}
