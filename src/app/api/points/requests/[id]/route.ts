import { NextResponse } from "next/server";
import { toPointsErrorPayload } from "@/lib/points/errors";
import { getPointsAccessContext } from "@/lib/points/permissions";
import { approvePointsRequest, rejectPointsRequest, withdrawPointsRequest } from "@/lib/points/requests";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 审批动作统一走一个端点：action = approve | reject | withdraw */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await getPointsAccessContext(request);
    if (!auth) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const { id } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      action?: unknown;
      approvedAmount?: unknown;
      decisionNote?: unknown;
    };
    const action = typeof body.action === "string" ? body.action : "";

    if (action === "withdraw") {
      const result = await withdrawPointsRequest({
        organizationId: auth.user.organizationId,
        requestId: id,
        applicantId: auth.user.id,
      });

      return NextResponse.json(result);
    }

    if (action !== "approve" && action !== "reject") {
      return NextResponse.json({ error: "未知的 action。", code: "POINTS_INVALID_INPUT" }, { status: 400 });
    }

    if (!auth.access.canApprove) {
      return NextResponse.json({ error: "没有审批积分申请的权限。", code: "POINTS_FORBIDDEN" }, { status: 403 });
    }

    if (action === "approve") {
      const approvedAmount = body.approvedAmount === undefined || body.approvedAmount === null
        ? null
        : Math.trunc(Number(body.approvedAmount));

      const result = await approvePointsRequest({
        organizationId: auth.user.organizationId,
        requestId: id,
        approverId: auth.user.id,
        approvedAmount: Number.isFinite(approvedAmount as number) ? approvedAmount : null,
        decisionNote: typeof body.decisionNote === "string" ? body.decisionNote : null,
      });

      return NextResponse.json(result);
    }

    const result = await rejectPointsRequest({
      organizationId: auth.user.organizationId,
      requestId: id,
      approverId: auth.user.id,
      decisionNote: typeof body.decisionNote === "string" ? body.decisionNote : null,
    });

    return NextResponse.json(result);
  } catch (error) {
    const payload = toPointsErrorPayload(error);
    return NextResponse.json(payload.body, { status: payload.status });
  }
}
