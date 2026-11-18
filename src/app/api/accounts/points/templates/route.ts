import { NextResponse } from "next/server";
import { requireAccessEdit, requireAccessView } from "@/lib/accounts/access-api-guard";
import { getSubjectGrants, saveSubjectGrants, type GrantChange } from "@/lib/accounts/access-service";
import { prisma } from "@/lib/db/prisma";

export const runtime = "nodejs";

function prismaRoleList(organizationId: string) {
  return prisma.organizationRosterRole.findMany({
    where: { organizationId },
    select: { id: true, name: true },
    orderBy: { sortOrder: "asc" },
  });
}

export async function GET(request: Request) {
  const guard = await requireAccessView(request);
  if (!guard.ok) return guard.response;
  // 逐角色读取 POINTS 模板。角色数有限，直接并发读取，保持简单可读。
  const roles = await prismaRoleList(guard.user.organizationId);
  const snapshots = await Promise.all(
    roles.map((role) => getSubjectGrants({
      organizationId: guard.user.organizationId,
      workspaceId: guard.workspaceId,
      subjectType: "ROLE",
      subjectId: role.id,
    })),
  );
  const rows = snapshots.map((snapshot, index) => {
    const grant = snapshot.grants.find((item) => item.resourceType === "POINTS");
    const scope = grant?.scopeJson ?? {};
    return {
      roleId: roles[index].id,
      roleName: roles[index].name,
      quota: typeof scope.quota === "string" ? scope.quota : null,
      maxRequestAmount: typeof scope.maxRequestAmount === "string" ? scope.maxRequestAmount : null,
      maxRequestsPerPeriod: typeof scope.maxRequestsPerPeriod === "number" ? scope.maxRequestsPerPeriod : null,
    };
  });
  return NextResponse.json({ rows });
}

export async function PUT(request: Request) {
  const guard = await requireAccessEdit(request);
  if (!guard.ok) return guard.response;
  const body = (await request.json()) as {
    rows?: Array<{ roleId: string; quota: string | null; maxRequestAmount: string | null; maxRequestsPerPeriod: number | null }>;
  };
  if (!Array.isArray(body.rows)) {
    return NextResponse.json({ error: "rows 参数无效。" }, { status: 400 });
  }
  for (const row of body.rows) {
    if (!row.roleId || typeof row.roleId !== "string") {
      return NextResponse.json({ error: "roleId 无效。" }, { status: 400 });
    }
    const snapshot = await getSubjectGrants({
      organizationId: guard.user.organizationId,
      workspaceId: guard.workspaceId,
      subjectType: "ROLE",
      subjectId: row.roleId,
    });
    const changes: GrantChange[] = [{
      resourceType: "POINTS",
      resourceId: "template",
      actions: ["view"],
      scopeJson: {
        quota: row.quota,
        maxRequestAmount: row.maxRequestAmount,
        maxRequestsPerPeriod: row.maxRequestsPerPeriod,
      },
    }];
    const result = await saveSubjectGrants({
      organizationId: guard.user.organizationId,
      workspaceId: guard.workspaceId,
      subjectType: "ROLE",
      subjectId: row.roleId,
      changes,
      expectedRevision: snapshot.revision,
      actor: { id: guard.user.id, role: guard.user.role },
    });
    if (!result.ok) {
      return NextResponse.json({ error: "积分模板已被他人修改，请刷新后重试。", roleId: row.roleId }, { status: 409 });
    }
  }
  return NextResponse.json({ ok: true });
}
