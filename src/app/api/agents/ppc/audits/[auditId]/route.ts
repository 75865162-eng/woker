import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";
export const runtime = "nodejs";
export async function GET(request: Request, context: { params: Promise<{ auditId: string }> }) {
  const permission = await requireApiPermission("agents", "view", request);
  if (!permission.ok) return permission.response;
  try {
    const { auditId } = await context.params;
    const audit = await prisma.amazonAgentActionAudit.findFirst({ where: { id: auditId, organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId } });
    return NextResponse.json(audit ? { audit } : { error: "当前工作区审计不存在。" }, { status: audit ? 200 : 404, headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "审计读取失败。" }, { status: 500 }); }
}
