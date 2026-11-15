import { NextResponse } from "next/server";
import { toPointsErrorPayload } from "@/lib/points/errors";
import { getPointsAccessContext } from "@/lib/points/permissions";
import { getMyPointsSummary } from "@/lib/points/summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await getPointsAccessContext(request);
    if (!context) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const summary = await getMyPointsSummary(context.user.organizationId, context.user.id);

    return NextResponse.json({ summary, access: context.access });
  } catch (error) {
    const payload = toPointsErrorPayload(error);
    return NextResponse.json(payload.body, { status: payload.status });
  }
}
