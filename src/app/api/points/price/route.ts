import { NextResponse } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { toPointsErrorPayload } from "@/lib/points/errors";
import { getPointsAccessContext } from "@/lib/points/permissions";
import { listPriceRules, priceRuleLabels } from "@/lib/points/policy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const auth = await getPointsAccessContext(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    if (!auth.access.canViewOrg && !auth.access.canConfigure) {
      return NextResponse.json({ error: "Forbidden.", code: "POINTS_FORBIDDEN" }, { status: 403 });
    }

    const rules = await listPriceRules(prisma, auth.user.organizationId);

    return NextResponse.json({ rules, access: auth.access });
  } catch (error) {
    const payload = toPointsErrorPayload(error);
    return NextResponse.json(payload.body, { status: payload.status });
  }
}

/**
 * 发布新版本定价。不原地修改：历史流水锁定了 priceRuleVersion，原地改会导致旧流水解释不通。
 */
export async function POST(request: Request) {
  try {
    const auth = await getPointsAccessContext(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    if (!auth.access.canConfigure) {
      return NextResponse.json({ error: "没有修改定价的权限。", code: "POINTS_FORBIDDEN" }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      operationCode?: unknown;
      unitCost?: unknown;
      maxCost?: unknown;
      dailyFreeCount?: unknown;
      note?: unknown;
    };

    const operationCode = typeof body.operationCode === "string" ? body.operationCode.trim() : "";
    const unitCost = Math.trunc(Number(body.unitCost));
    const maxCost = Math.trunc(Number(body.maxCost));
    const dailyFreeCount = Math.max(0, Math.trunc(Number(body.dailyFreeCount ?? 0)));

    if (!operationCode) {
      return NextResponse.json({ error: "operationCode 不能为空。", code: "POINTS_INVALID_INPUT" }, { status: 400 });
    }
    if (!Number.isFinite(unitCost) || !Number.isFinite(maxCost) || unitCost < 0 || maxCost < unitCost) {
      return NextResponse.json(
        { error: "定价不合法：单价需 ≥ 0，且预扣上限需 ≥ 单价。", code: "POINTS_INVALID_INPUT" },
        { status: 400 },
      );
    }

    const organizationId = auth.user.organizationId;
    const now = new Date();

    const created = await prisma.$transaction(async (tx) => {
      const latest = await tx.pointsPriceRule.findFirst({
        where: { organizationId, operationCode },
        orderBy: { version: "desc" },
        select: { version: true },
      });

      await tx.pointsPriceRule.updateMany({
        where: { organizationId, operationCode, status: "ACTIVE" },
        data: { status: "RETIRED", effectiveTo: now },
      });

      return tx.pointsPriceRule.create({
        data: {
          organizationId,
          operationCode,
          version: (latest?.version ?? 0) + 1,
          unitCost,
          maxCost,
          dailyFreeCount,
          status: "ACTIVE",
          effectiveFrom: now,
          note: typeof body.note === "string" && body.note.trim() ? body.note.trim() : null,
          createdById: auth.user.id,
        },
      });
    });

    await prisma.auditLog.create({
      data: {
        organizationId,
        userId: auth.user.id,
        action: "points_price_publish",
        entityType: "PointsPriceRule",
        entityId: created.id,
        metadata: {
          operationCode,
          label: priceRuleLabels[operationCode] ?? operationCode,
          version: created.version,
          unitCost,
          maxCost,
        },
      },
    });

    return NextResponse.json({ rule: created }, { status: 201 });
  } catch (error) {
    const payload = toPointsErrorPayload(error);
    return NextResponse.json(payload.body, { status: payload.status });
  }
}
