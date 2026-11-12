import { SyncInputError } from "@/lib/amazon-sync/policy";
import { auditAmazonDataRead } from "@/lib/amazon-sync/read-audit";
import { NextResponse } from "next/server";
import { requireAmazonReadSession } from "@/lib/auth/amazon-read-session";
import { AmazonReadError } from "@/lib/amazon-sync/read-account";
import { getOperationsReadiness } from "@/lib/operations/readiness";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const permission = await requireAmazonReadSession(request);
    if (!permission.ok) return permission.response;
    await auditAmazonDataRead({ organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId }, permission.user.id, "readiness", permission.user.role);
    const readiness = await getOperationsReadiness({
      organizationId: permission.user.organizationId,
      actorUserId: permission.user.id,
      scope: workspaceScopeFromRequest(request),
      params: new URL(request.url).searchParams,
    });
    return NextResponse.json(readiness, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof SyncInputError ? error.message : "经营数据新鲜度读取失败。", ...(error instanceof AmazonReadError ? { code: error.businessCode } : {}) }, { status: error instanceof SyncInputError ? error.status : 500, headers: { "Cache-Control": "no-store" } });
  }
}
