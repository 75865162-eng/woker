import { SyncInputError } from "@/lib/amazon-sync/policy";
import { auditAmazonDataRead } from "@/lib/amazon-sync/read-audit";
import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { getOperationsReadiness } from "@/lib/operations/readiness";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission("operations", "view", request);
    if (!permission.ok) return permission.response;
    await auditAmazonDataRead({ organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId }, permission.user.id, "readiness", permission.user.role);
    const readiness = await getOperationsReadiness({
      organizationId: permission.user.organizationId,
      actorUserId: permission.user.id,
      scope: workspaceScopeFromRequest(request),
    });
    return NextResponse.json(readiness, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof SyncInputError ? "数据范围不可访问。" : "经营数据新鲜度读取失败。" }, { status: error instanceof SyncInputError ? error.status : 500, headers: { "Cache-Control": "no-store" } });
  }
}
