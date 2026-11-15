import { NextResponse } from "next/server";
import { toPointsErrorPayload } from "@/lib/points/errors";
import { getPointsAccessContext } from "@/lib/points/permissions";
import { releasePoints, reservePoints, settlePoints } from "@/lib/points/spend";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SpendBody = {
  action?: unknown;
  operationCode?: unknown;
  requestKey?: unknown;
  runId?: unknown;
  actualCost?: unknown;
  userId?: unknown;
};

/**
 * 积分预扣 / 结算 / 释放。
 * 普通调用只作用于自己；管理员可用 userId 代其他成员结算（补账场景）。
 */
export async function POST(request: Request) {
  try {
    const context = await getPointsAccessContext(request);
    if (!context) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const body = (await request.json().catch(() => ({}))) as SpendBody;
    const action = typeof body.action === "string" ? body.action : "";
    const requestKey = typeof body.requestKey === "string" ? body.requestKey.trim() : "";
    const targetUserId = typeof body.userId === "string" && body.userId ? body.userId : context.user.id;

    if (targetUserId !== context.user.id && !context.access.canAdjust) {
      return NextResponse.json({ error: "Forbidden.", code: "POINTS_FORBIDDEN" }, { status: 403 });
    }

    if (!requestKey) {
      return NextResponse.json({ error: "requestKey 不能为空。", code: "POINTS_INVALID_INPUT" }, { status: 400 });
    }

    const organizationId = context.user.organizationId;

    if (action === "reserve") {
      const operationCode = typeof body.operationCode === "string" ? body.operationCode.trim() : "";
      if (!operationCode) {
        return NextResponse.json({ error: "operationCode 不能为空。", code: "POINTS_INVALID_INPUT" }, { status: 400 });
      }

      const result = await reservePoints({
        organizationId,
        userId: targetUserId,
        operationCode,
        requestKey,
        runId: typeof body.runId === "string" ? body.runId : null,
        createdById: context.user.id,
      });

      return NextResponse.json(result);
    }

    if (action === "settle") {
      const actualCost = Number(body.actualCost);

      if (!Number.isFinite(actualCost) || actualCost < 0) {
        return NextResponse.json({ error: "actualCost 必须是非负数字。", code: "POINTS_INVALID_INPUT" }, { status: 400 });
      }

      const result = await settlePoints({
        organizationId,
        userId: targetUserId,
        requestKey,
        actualCost: Math.trunc(actualCost),
        createdById: context.user.id,
      });

      return NextResponse.json(result);
    }

    if (action === "release") {
      const result = await releasePoints({
        organizationId,
        userId: targetUserId,
        requestKey,
        createdById: context.user.id,
      });

      return NextResponse.json(result);
    }

    return NextResponse.json({ error: "未知的 action。", code: "POINTS_INVALID_INPUT" }, { status: 400 });
  } catch (error) {
    const payload = toPointsErrorPayload(error);
    return NextResponse.json(payload.body, { status: payload.status });
  }
}
