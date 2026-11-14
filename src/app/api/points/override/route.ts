import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toPointsErrorPayload } from "@/lib/points/errors";
import { getPointsAccessContext } from "@/lib/points/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function optionalInt(value: unknown, min: number, max: number): { ok: boolean; value: number | null } {
  if (value === null || value === undefined || value === "") return { ok: true, value: null };

  const numeric = Math.trunc(Number(value));
  if (!Number.isFinite(numeric) || numeric < min || numeric > max) return { ok: false, value: null };

  return { ok: true, value: numeric };
}

/** 单个成员的额度覆盖。null 表示继承组织默认。 */
export async function PUT(request: Request) {
  try {
    const auth = await getPointsAccessContext(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    if (!auth.access.canAdjust) {
      return NextResponse.json({ error: "没有调整成员额度的权限。", code: "POINTS_FORBIDDEN" }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const userId = typeof body.userId === "string" ? body.userId.trim() : "";

    if (!userId) {
      return NextResponse.json({ error: "userId 不能为空。", code: "POINTS_INVALID_INPUT" }, { status: 400 });
    }

    if (userId === auth.user.id) {
      return NextResponse.json(
        { error: "不能修改自己的配额与审批权限。", code: "POINTS_FORBIDDEN" },
        { status: 403 },
      );
    }

    const monthlyQuota = optionalInt(body.monthlyQuota, 0, 100_000);
    const carryoverCap = optionalInt(body.carryoverCap, 0, 100_000);

    if (!monthlyQuota.ok || !carryoverCap.ok) {
      return NextResponse.json({ error: "配额数值不合法。", code: "POINTS_INVALID_INPUT" }, { status: 400 });
    }

    const organizationId = auth.user.organizationId;
    const data = {
      monthlyQuota: monthlyQuota.value,
      carryoverCap: carryoverCap.value,
      canApprove: typeof body.canApprove === "boolean" ? body.canApprove : false,
      canRequest: typeof body.canRequest === "boolean" ? body.canRequest : true,
      note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null,
      updatedById: auth.user.id,
    };

    const saved = await prisma.pointsMemberOverride.upsert({
      where: { organizationId_userId: { organizationId, userId } },
      create: { organizationId, userId, ...data },
      update: data,
    });

    await prisma.auditLog.create({
      data: {
        organizationId,
        userId: auth.user.id,
        action: "points_member_override_update",
        entityType: "PointsMemberOverride",
        entityId: userId,
        metadata: { targetUserId: userId, ...data },
      },
    });

    return NextResponse.json({ override: saved });
  } catch (error) {
    const payload = toPointsErrorPayload(error);
    return NextResponse.json(payload.body, { status: payload.status });
  }
}

export async function GET(request: Request) {
  try {
    const auth = await getPointsAccessContext(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    if (!auth.access.canViewOrg) {
      return NextResponse.json({ error: "Forbidden.", code: "POINTS_FORBIDDEN" }, { status: 403 });
    }

    const url = new URL(request.url);
    const userId = url.searchParams.get("userId");
    const organizationId = auth.user.organizationId;

    const rows = userId
      ? await prisma.pointsMemberOverride.findMany({ where: { organizationId, userId } })
      : await prisma.pointsMemberOverride.findMany({ where: { organizationId } });

    return NextResponse.json({ overrides: rows });
  } catch (error) {
    const payload = toPointsErrorPayload(error);
    return NextResponse.json(payload.body, { status: payload.status });
  }
}
