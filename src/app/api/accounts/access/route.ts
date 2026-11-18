import { NextResponse } from "next/server";
import { requireAccessEdit, requireAccessView } from "@/lib/accounts/access-api-guard";
import { getSubjectGrants, saveSubjectGrants, type GrantChange, type SubjectType } from "@/lib/accounts/access-service";

export const runtime = "nodejs";

function parseSubjectType(value: string | null): SubjectType | null {
  return value === "ROLE" || value === "MEMBER" ? value : null;
}

export async function GET(request: Request) {
  const guard = await requireAccessView(request);
  if (!guard.ok) return guard.response;
  const url = new URL(request.url);
  const subjectType = parseSubjectType(url.searchParams.get("subjectType"));
  const subjectId = url.searchParams.get("subjectId")?.trim();
  if (!subjectType || !subjectId) {
    return NextResponse.json({ error: "subjectType 与 subjectId 必填。" }, { status: 400 });
  }
  const snapshot = await getSubjectGrants({
    organizationId: guard.user.organizationId,
    workspaceId: guard.workspaceId,
    subjectType,
    subjectId,
  });
  return NextResponse.json(snapshot);
}

export async function PUT(request: Request) {
  const guard = await requireAccessEdit(request);
  if (!guard.ok) return guard.response;
  const body = (await request.json()) as {
    subjectType?: string;
    subjectId?: string;
    changes?: GrantChange[];
    expectedRevision?: string;
  };
  const subjectType = parseSubjectType(body.subjectType ?? null);
  const subjectId = body.subjectId?.trim();
  if (!subjectType || !subjectId || !Array.isArray(body.changes) || typeof body.expectedRevision !== "string") {
    return NextResponse.json({ error: "subject / changes / expectedRevision 参数无效。" }, { status: 400 });
  }
  // 防御：成员补充授权不允许写入 ROLE 专属资源类型；主体类型必须在白名单。
  const result = await saveSubjectGrants({
    organizationId: guard.user.organizationId,
    workspaceId: guard.workspaceId,
    subjectType,
    subjectId,
    changes: body.changes,
    expectedRevision: body.expectedRevision,
    actor: { id: guard.user.id, role: guard.user.role },
  });
  if (!result.ok) {
    return NextResponse.json({ error: "授权已被他人修改，请刷新后重试。", revision: result.currentRevision }, { status: 409 });
  }
  return NextResponse.json(result);
}
