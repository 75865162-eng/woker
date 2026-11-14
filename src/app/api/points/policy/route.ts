import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toPointsErrorPayload } from "@/lib/points/errors";
import { getPointsAccessContext } from "@/lib/points/permissions";
import { loadPointsPolicy } from "@/lib/points/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Math.trunc(Number(value));
  if (!Number.isFinite(numeric)) return fallback;

  return Math.min(Math.max(numeric, min), max);
}

export async function GET(request: Request) {
  try {
    const auth = await getPointsAccessContext(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    if (!auth.access.canViewOrg && !auth.access.canConfigure) {
      return NextResponse.json({ error: "Forbidden.", code: "POINTS_FORBIDDEN" }, { status: 403 });
    }

    const policy = await loadPointsPolicy(prisma, auth.user.organizationId);

    return NextResponse.json({ policy, access: auth.access });
  } catch (error) {
    const payload = toPointsErrorPayload(error);
    return NextResponse.json(payload.body, { status: payload.status });
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await getPointsAccessContext(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    if (!auth.access.canConfigure) {
      return NextResponse.json({ error: "没有修改积分策略的权限。", code: "POINTS_FORBIDDEN" }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const current = await loadPointsPolicy(prisma, auth.user.organizationId);

    const data = {
      baseQuota: clampInt(body.baseQuota, current.baseQuota, 0, 100_000),
      carryoverCap: clampInt(body.carryoverCap, current.carryoverCap, 0, 100_000),
      maxRequestsPerPeriod: clampInt(body.maxRequestsPerPeriod, current.maxRequestsPerPeriod, 0, 100),
      maxRequestAmount: clampInt(body.maxRequestAmount, current.maxRequestAmount, 1, 100_000),
      maxExtraPerPeriod: clampInt(body.maxExtraPerPeriod, current.maxExtraPerPeriod, 0, 1_000_000),
      requestExpireDays: clampInt(body.requestExpireDays, current.requestExpireDays, 1, 90),
      reserveTimeoutMinutes: clampInt(body.reserveTimeoutMinutes, current.reserveTimeoutMinutes, 1, 1440),
      warnPercent: clampInt(body.warnPercent, current.warnPercent, 0, 100),
      grantOnCreate: typeof body.grantOnCreate === "boolean" ? body.grantOnCreate : current.grantOnCreate,
      grantToDisabled: typeof body.grantToDisabled === "boolean" ? body.grantToDisabled : current.grantToDisabled,
      timezone: typeof body.timezone === "string" && body.timezone.trim() ? body.timezone.trim() : current.timezone,
      updatedById: auth.user.id,
    };

    const saved = await prisma.pointsPolicy.upsert({
      where: { organizationId: auth.user.organizationId },
      create: { organizationId: auth.user.organizationId, ...data },
      update: data,
    });

    await prisma.auditLog.create({
      data: {
        organizationId: auth.user.organizationId,
        userId: auth.user.id,
        action: "points_policy_update",
        entityType: "PointsPolicy",
        entityId: auth.user.organizationId,
        metadata: { before: current, after: data },
      },
    });

    return NextResponse.json({ policy: saved });
  } catch (error) {
    const payload = toPointsErrorPayload(error);
    return NextResponse.json(payload.body, { status: payload.status });
  }
}
