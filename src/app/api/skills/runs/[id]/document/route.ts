import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { assertWorkspaceAccess } from "@/lib/workspace/access";
import { workspaceScopeFromRequest, WorkspaceScopeError } from "@/lib/workspace/scope";
import { SKILL_MODULE_ID } from "@/lib/skill-engine/types";
import { getSkillRunDocument } from "@/lib/skill-engine/run-history";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 历史文档的授权下载：按组织/工作区/发起人 + 存储前缀 + 哈希校验，不返回公开 URL。 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const permission = await requireApiPermission(SKILL_MODULE_ID, "export", request);
    if (!permission.ok) return permission.response;
    const { id } = await context.params;
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) return NextResponse.json({ error: "INVALID_RUN_ID" }, { status: 400 });
    const scope = workspaceScopeFromRequest(request);
    if (process.env.DATABASE_URL && !(await assertWorkspaceAccess(permission.user.organizationId, scope.workspaceId, permission.user.id, undefined, request))) {
      return NextResponse.json({ error: "无权访问该工作区。" }, { status: 403 });
    }
    if (!process.env.DATABASE_URL) return NextResponse.json({ error: "运行历史不可用" }, { status: 404 });
    let doc: Awaited<ReturnType<typeof getSkillRunDocument>>;
    try {
      doc = await getSkillRunDocument(id, {
        organizationId: permission.user.organizationId,
        workspaceId: scope.workspaceId,
        ownerId: permission.user.id,
      });
    } catch (error) {
      if (error instanceof Error && (error.message === "SKILL_RUN_NOT_FOUND" || error.message === "SKILL_RUN_INTEGRITY_FAILED")) {
        return NextResponse.json({ error: "文档不存在或校验失败" }, { status: 404 });
      }
      throw error;
    }
    return new Response(new Uint8Array(doc.bytes), { headers: {
      "Content-Type": doc.mimeType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
      "Content-Length": String(doc.bytes.byteLength),
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    } });
  } catch (error) {
    if (error instanceof WorkspaceScopeError) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ error: "下载文档失败。" }, { status: 500 });
  }
}
