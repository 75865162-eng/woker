import { NextResponse } from "next/server";
import { toPointsErrorPayload } from "@/lib/points/errors";
import { getPointsAccessContext } from "@/lib/points/permissions";
import { listPointsLedger } from "@/lib/points/summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await getPointsAccessContext(request);
    if (!context) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const url = new URL(request.url);
    const requestedUserId = url.searchParams.get("userId");
    const targetUserId = requestedUserId && requestedUserId !== context.user.id ? requestedUserId : context.user.id;

    if (targetUserId !== context.user.id && !context.access.canViewOrg) {
      return NextResponse.json({ error: "Forbidden.", code: "POINTS_FORBIDDEN" }, { status: 403 });
    }

    const result = await listPointsLedger({
      organizationId: context.user.organizationId,
      userId: targetUserId,
      take: Number(url.searchParams.get("take") ?? 20),
      cursor: url.searchParams.get("cursor"),
    });

    return NextResponse.json(result);
  } catch (error) {
    const payload = toPointsErrorPayload(error);
    return NextResponse.json(payload.body, { status: payload.status });
  }
}
