import { NextResponse } from "next/server";
import { toPointsErrorPayload } from "@/lib/points/errors";
import { getPointsAccessContext } from "@/lib/points/permissions";
import { getOrganizationPointsOverview } from "@/lib/points/summary";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await getPointsAccessContext(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    if (!auth.access.canViewOrg) {
      return NextResponse.json({ error: "Forbidden.", code: "POINTS_FORBIDDEN" }, { status: 403 });
    }

    const overview = await getOrganizationPointsOverview(auth.user.organizationId);

    return NextResponse.json({ ...overview, access: auth.access });
  } catch (error) {
    const payload = toPointsErrorPayload(error);
    return NextResponse.json(payload.body, { status: payload.status });
  }
}
