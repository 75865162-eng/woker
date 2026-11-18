import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { assertWorkspaceAccess } from "@/lib/workspace/access";
import { workspaceScopeFromRequest, WorkspaceScopeError } from "@/lib/workspace/scope";
import { SKILL_MODULE_ID } from "@/lib/skill-engine/types";
import { listSkillRuns } from "@/lib/skill-engine/run-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Skill 运行历史列表：仅当前组织/工作区/登录人可见，不返回公开存储地址。 */
export async function GET(request: Request) {
  try {
    const permission = await requireApiPermission(SKILL_MODULE_ID, "view", request);
    if (!permission.ok) return permission.response;
    const scope = workspaceScopeFromRequest(request);
    if (process.env.DATABASE_URL && !(await assertWorkspaceAccess(permission.user.organizationId, scope.workspaceId, permission.user.id, undefined, request))) {
      return NextResponse.json({ error: "无权访问该工作区。" }, { status: 403 });
    }
    const query = new URL(request.url).searchParams;
    const page = Number(query.get("page") ?? 1);
    const pageSize = Number(query.get("pageSize") ?? 20);
    if (!Number.isInteger(page) || page < 1 || page > 10000 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 50) {
      return NextResponse.json({ error: "INVALID_HISTORY_REQUEST" }, { status: 400 });
    }
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ runs: [], page, pageSize, hasNext: false, persisted: false, message: "数据库未配置，暂无持久化运行历史。" }, { headers: { "Cache-Control": "no-store" } });
    }
    const result = await listSkillRuns(
      { organizationId: permission.user.organizationId, workspaceId: scope.workspaceId, ownerId: permission.user.id },
      page,
      pageSize,
    );
    return NextResponse.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof WorkspaceScopeError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "读取运行历史失败。" }, { status: 500 });
  }
}
