import { pullFinanceReplica, pullFinanceReplicaPage } from "@/lib/amazon-sync/finance-replica";
import { pullOrderReplica, pullOrderReplicaPage } from "@/lib/amazon-sync/order-replica";
import { pullAdsReportReplica } from "@/lib/amazon-ads/report-replica";
import { pullAdsEntityReplica } from "@/lib/amazon-ads/entity-replica";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { AmazonCloudRelayError } from "@/lib/amazon/cloud-relay-protocol";
import { pullSnapshotReplica } from "@/lib/amazon-sync/inventory-replica";
import { AmazonReadError } from "@/lib/amazon-sync/read-account";
import { boundedJsonObject } from "@/lib/amazon-sync/request-body";
import { requiredText, SyncInputError } from "@/lib/amazon-sync/policy";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
export const runtime = "nodejs";
export async function POST(request: Request) {
  // Publishing a local replica is an operator action; business reads keep their
  // account-only permission model and never start imports as a side effect.
  const headers = { "Cache-Control": "no-store" };
  try {
    const input = await boundedJsonObject(request, 4096);
    const permission = await requireApiPermission("operations", "create", request);
    if (!permission.ok) return permission.response;
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request, input).workspaceId };
    const resource = input.resource ?? "inventory";
    if (resource === "finance" && input.paginated === true) {
      if (input.cursor !== undefined && (typeof input.cursor !== "string" || !input.cursor.length || input.cursor.length > 2048)) throw new SyncInputError("财务分批回传进度格式无效。", 400);
      return NextResponse.json(await pullFinanceReplicaPage(scope, permission.user.id, requiredText(input.sourceId, "财务来源 ID"), input.cursor as string | undefined), { headers });
    }
    if (resource === "finance") return NextResponse.json(await pullFinanceReplica(scope, permission.user.id, requiredText(input.sourceId, "财务来源 ID")), { headers });
    if (resource === "orders" && input.paginated === true) {
      if (input.cursor !== undefined && (typeof input.cursor !== "string" || !input.cursor.length || input.cursor.length > 2048)) throw new SyncInputError("订单分批回传进度格式无效。", 400);
      return NextResponse.json(await pullOrderReplicaPage(scope, permission.user.id, requiredText(input.sourceId, "订单来源 ID"), input.cursor as string | undefined), { headers });
    }
    if (resource === "orders") return NextResponse.json(await pullOrderReplica(scope, permission.user.id, requiredText(input.sourceId, "订单来源 ID")), { headers });
    if (resource === "ads-reports") return NextResponse.json(await pullAdsReportReplica(scope, permission.user.id, requiredText(input.profileRecordId, "广告 Profile ID")), { headers });
    if (resource === "ads-entities") return NextResponse.json(await pullAdsEntityReplica(scope, permission.user.id, requiredText(input.profileRecordId, "广告 Profile ID")), { headers });
    if (resource !== "inventory" && resource !== "catalog") throw new SyncInputError("该数据域尚不支持快照回传。", 400);
    return NextResponse.json(await pullSnapshotReplica(scope, permission.user.id, requiredText(input.sourceId, "快照来源 ID"), resource), { headers });
  } catch (error) {
    return NextResponse.json({ error: error instanceof SyncInputError ? error.message : "快照回传失败，未发布不完整版本。", ...(error instanceof AmazonCloudRelayError ? { code: error.code } : error instanceof AmazonReadError ? { code: error.businessCode } : {}) }, { status: error instanceof SyncInputError ? error.status : 500, headers });
  }
}
