import { NextResponse } from "next/server";
import { toPointsErrorPayload } from "@/lib/points/errors";
import { getPointsAccessContext } from "@/lib/points/permissions";
import { adjustMemberPoints } from "@/lib/points/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 管理员调额。必须带原因，写 auditLog。 */
export async function POST(request: Request) {
  try {
    const auth = await getPointsAccessContext(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    if (!auth.access.canAdjust) {
      return NextResponse.json({ error: "没有调整积分额度的权限。", code: "POINTS_FORBIDDEN" }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as {
      userId?: unknown;
      amount?: unknown;
      reason?: unknown;
    };

    const userId = typeof body.userId === "string" ? body.userId.trim() : "";
    if (!userId) {
      return NextResponse.json({ error: "userId 不能为空。", code: "POINTS_INVALID_INPUT" }, { status: 400 });
    }

    const result = await adjustMemberPoints({
      organizationId: auth.user.organizationId,
      userId,
      operatorId: auth.user.id,
      amount: Number(body.amount),
      reason: typeof body.reason === "string" ? body.reason : "",
    });

    return NextResponse.json(result);
  } catch (error) {
    const payload = toPointsErrorPayload(error);
    return NextResponse.json(payload.body, { status: payload.status });
  }
}
