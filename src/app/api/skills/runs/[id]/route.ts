import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { assertWorkspaceAccess } from "@/lib/workspace/access";
import { workspaceScopeFromRequest, WorkspaceScopeError } from "@/lib/workspace/scope";
import { SKILL_MODULE_ID } from "@/lib/skill-engine/types";
import { getSkillRun } from "@/lib/skill-engine/run-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 单次运行详情：报告正文、参数、模型、行数；严格作用域隔离。 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const permission = await requireApiPermission(SKILL_MODULE_ID, "view", request);
    if (!permission.ok) return permission.response;
    const { id } = await context.params;
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return NextResponse.json({ error: "INVALID_RUN_ID" }, { status: 400 });
    const scope = workspaceScopeFromRequest(request);
    if (process.env.DATABASE_URL && !(await assertWorkspaceAccess(permission.user.organizationId, scope.workspaceId, permission.user.id, undefined, request))) {
      return NextResponse.json({ error: "无权访问该工作区。" }, { status: 403 });
    }
    if (!process.env.DATABASE_URL) return NextResponse.json({ error: "运行历史不可用" }, { status: 404 });
    try {
      const detail = await getSkillRun(id, {
        organizationId: permission.user.organizationId,
        workspaceId: scope.workspaceId,
        ownerId: permission.user.id,
      });
      return NextResponse.json(detail, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof Error && error.message === "SKILL_RUN_NOT_FOUND") return NextResponse.json({ error: "运行记录不存在" }, { status: 404 });
      throw error;
    }
  } catch (error) {
    if (error instanceof WorkspaceScopeError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "读取运行详情失败。" }, { status: 500 });
  }
}
