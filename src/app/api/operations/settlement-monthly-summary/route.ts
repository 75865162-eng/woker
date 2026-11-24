import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { readSettlementMonthlySummary } from "@/lib/amazon-sync/settlement-monthly-summary";
import type { SyncScope } from "@/lib/amazon-sync/policy";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };

export async function GET(request: Request) {
  const auth = await requireApiPermission("operations", "view", request);
  if (!auth.ok) return auth.response;
  try {
    const scope: SyncScope = {
      organizationId: auth.user.organizationId,
      workspaceId: workspaceScopeFromRequest(request).workspaceId,
    };
    const params = new URL(request.url).searchParams;
    const result = await readSettlementMonthlySummary(scope, params, auth.user.id);
    return NextResponse.json({ ...result, source: "AmazonSettlementRow(ATTRIBUTED)" }, { headers });
  } catch (error) {
    console.error("[operations.settlement-monthly-summary]", error instanceof Error ? `${error.name}: ${error.message}` : String(error));
    return NextResponse.json({ error: "结算月度汇总暂不可用。" }, { status: 500, headers });
  }
}
