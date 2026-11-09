import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { readMarketCallQuota } from "@/lib/lili/call-quota-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const permission = await requireApiPermission("agents", "view", request);
  if (!permission.ok) return permission.response;
  const page = Number(new URL(request.url).searchParams.get("page") || "1");
  if (!Number.isSafeInteger(page) || page < 1 || page > 10_000) return NextResponse.json({ error: "INVALID_QUOTA_PAGE" }, { status: 400 });
  try {
    return NextResponse.json(await readMarketCallQuota({ organizationId: permission.user.organizationId, userId: permission.user.id }, page), { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "MARKET_QUOTA_UNAVAILABLE" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
