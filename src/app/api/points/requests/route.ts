import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toPointsErrorPayload } from "@/lib/points/errors";
import { canRequestPoints, getPointsAccessContext } from "@/lib/points/permissions";
import { createPointsRequest, listPointsRequests } from "@/lib/points/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const context = await getPointsAccessContext(request);
    if (!context) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") === "org" ? "org" : "mine";

    if (scope === "org" && !context.access.canViewOrg) {
      return NextResponse.json({ error: "Forbidden.", code: "POINTS_FORBIDDEN" }, { status: 403 });
    }

    const result = await listPointsRequests(prisma, {
      organizationId: context.user.organizationId,
      applicantId: scope === "mine" ? context.user.id : undefined,
      status: url.searchParams.get("status") ?? undefined,
      take: Number(url.searchParams.get("take") ?? 20),
      cursor: url.searchParams.get("cursor"),
    });

    return NextResponse.json(result);
  } catch (error) {
    const payload = toPointsErrorPayload(error);
    return NextResponse.json(payload.body, { status: payload.status });
  }
}

export async function POST(request: Request) {
  try {
    const context = await getPointsAccessContext(request);
    if (!context) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    if (!(await canRequestPoints(context.user))) {
      return NextResponse.json({ error: "当前账号没有提交积分申请的权限。", code: "POINTS_FORBIDDEN" }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      requestedAmount?: unknown;
      reason?: unknown;
      usagePlan?: unknown;
    };

    const created = await createPointsRequest({
      organizationId: context.user.organizationId,
      applicantId: context.user.id,
      requestedAmount: Number(body.requestedAmount),
      reason: typeof body.reason === "string" ? body.reason : "",
      usagePlan: typeof body.usagePlan === "string" ? body.usagePlan : null,
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const payload = toPointsErrorPayload(error);
    return NextResponse.json(payload.body, { status: payload.status });
  }
}
