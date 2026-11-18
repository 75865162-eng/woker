import { NextResponse } from "next/server";
import { requireAccessEdit, requireAccessView } from "@/lib/accounts/access-api-guard";
import { getSubjectGrants, saveSubjectGrants, type GrantChange } from "@/lib/accounts/access-service";

export const runtime = "nodejs";

/** 审批矩阵以一条 ROLE/__approval_matrix__ 聚合记录保存，每行=一个单据类型+金额区间。 */
const MATRIX_SUBJECT = "__approval_matrix__";

export async function GET(request: Request) {
  const guard = await requireAccessView(request);
  if (!guard.ok) return guard.response;
  const snapshot = await getSubjectGrants({
    organizationId: guard.user.organizationId,
    workspaceId: guard.workspaceId,
    subjectType: "ROLE",
    subjectId: MATRIX_SUBJECT,
  });
  const rows = snapshot.grants
    .filter((grant) => grant.resourceType === "APPROVAL")
    .map((grant) => {
      const scope = grant.scopeJson ?? {};
      return {
        type: typeof scope.approvalType === "string" ? scope.approvalType : grant.resourceId.split("@")[0],
        min: typeof scope.amountMin === "string" ? scope.amountMin : null,
        max: typeof scope.amountMax === "string" ? scope.amountMax : null,
        actions: grant.actions,
      };
    });
  return NextResponse.json({ rows, revision: snapshot.revision });
}

export async function PUT(request: Request) {
  const guard = await requireAccessEdit(request);
  if (!guard.ok) return guard.response;
  const body = (await request.json()) as { rows?: Array<{ type: string; min: string | null; max: string | null; actions: string[] }>; expectedRevision?: string };
  if (!Array.isArray(body.rows) || typeof body.expectedRevision !== "string") {
    return NextResponse.json({ error: "rows / expectedRevision 参数无效。" }, { status: 400 });
  }
  const changes: GrantChange[] = body.rows.map((row) => ({
    resourceType: "APPROVAL",
    resourceId: `${row.type}@${row.min ?? "-"}~${row.max ?? "-"}`,
    actions: row.actions,
    scopeJson: { approvalType: row.type, amountMin: row.min, amountMax: row.max },
  }));
  // 删除本次未提交的旧区间行，保证 rows 是全量快照。
  const current = await getSubjectGrants({
    organizationId: guard.user.organizationId,
    workspaceId: guard.workspaceId,
    subjectType: "ROLE",
    subjectId: MATRIX_SUBJECT,
  });
  const keep = new Set(changes.map((change) => `${change.resourceType}:${change.resourceId}`));
  for (const grant of current.grants) {
    if (grant.resourceType !== "APPROVAL") continue;
    if (!keep.has(`${grant.resourceType}:${grant.resourceId}`)) {
      changes.push({ resourceType: "APPROVAL", resourceId: grant.resourceId, actions: [] });
    }
  }
  const result = await saveSubjectGrants({
    organizationId: guard.user.organizationId,
    workspaceId: guard.workspaceId,
    subjectType: "ROLE",
    subjectId: MATRIX_SUBJECT,
    changes,
    expectedRevision: body.expectedRevision,
    actor: { id: guard.user.id, role: guard.user.role },
  });
  if (!result.ok) {
    return NextResponse.json({ error: "审批矩阵已被他人修改，请刷新后重试。", revision: result.currentRevision }, { status: 409 });
  }
  return NextResponse.json(result);
}
