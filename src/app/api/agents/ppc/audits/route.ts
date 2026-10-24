import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
import { assertActionWorkspace } from "@/lib/agent-platform/amazon-action-audit";
import { AmazonActionError } from "@/lib/agent-platform/amazon-action-policy";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const permission = await requireApiPermission("agents", "view", request);
  if (!permission.ok) return permission.response;
  try {
    if (!process.env.DATABASE_URL) return NextResponse.json({ rows: [], unavailable: "AUDIT_DATABASE_REQUIRED" }, { headers: { "Cache-Control": "no-store" } });
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId, actorUserId: permission.user.id };
    await assertActionWorkspace(prisma, scope);
    const rows = await prisma.amazonAgentActionAudit.findMany({ where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 20 });
    return NextResponse.json({ rows }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ code: error instanceof AmazonActionError ? error.code : "AUDIT_READ_FAILED", error: error instanceof AmazonActionError ? error.message : "审计读取失败。" }, { status: error instanceof AmazonActionError ? error.status : 500 });
  }
}
