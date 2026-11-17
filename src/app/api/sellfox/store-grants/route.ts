import { NextResponse } from "next/server";
import { requireApiPermission } from "@/lib/auth/api-permissions";
import { prisma } from "@/lib/db/prisma";
import { SellfoxBrowseError } from "@/lib/sellfox/browse-query";
import { resolveSellfoxVisibleStoreIds, saveSellfoxStoreGrant } from "@/lib/sellfox/store-access";
import { workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
function fail(error: unknown) {
  return NextResponse.json({ error: error instanceof SellfoxBrowseError ? error.message : "赛狐店铺授权暂不可用，请管理员检查数据库迁移。" }, { status: error instanceof SellfoxBrowseError ? error.status : 503, headers });
}

export async function GET(request: Request) {
  const permission = await requireApiPermission("sellfox", "view", request);
  if (!permission.ok) return permission.response;
  try {
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request).workspaceId };
    const actor = { id: permission.user.id, role: permission.user.role };
    const [memberGrant, roleGrant, stores, roles, members, visible] = await Promise.all([
      prisma.sellfoxDataAccessGrant.findUnique({ where: { organizationId_workspaceId_userId: { ...scope, userId: actor.id } } }),
      prisma.sellfoxRoleDataAccessGrant.findMany({ where: scope, take: 201 }),
      prisma.sellfoxStore.findMany({ where: scope, select: { id: true, externalId: true, name: true, marketplace: true }, orderBy: { name: "asc" }, take: 2000 }),
      prisma.organizationRosterRole.findMany({ where: { organizationId: scope.organizationId }, select: { id: true, name: true }, take: 200 }),
      prisma.organizationMember.findMany({ where: { organizationId: scope.organizationId, user: { status: "active" } }, select: { userId: true, role: true, user: { select: { name: true, email: true } } }, take: 200 }),
      resolveSellfoxVisibleStoreIds(actor, scope),
    ]);
    return NextResponse.json({
      scope,
      enabled: visible !== undefined || memberGrant !== null || roleGrant.length > 0,
      selfGrant: memberGrant,
      roleGrants: roleGrant,
      visibleStoreIds: visible ?? null,
      stores,
      roles,
      members: members.map(m => ({ userId: m.userId, role: m.role, name: m.user.name, email: m.user.email })),
    }, { headers });
  } catch (error) { return fail(error); }
}

export async function POST(request: Request) {
  const permission = await requireApiPermission("sellfox", "view", request);
  if (!permission.ok) return permission.response;
  try {
    const origin = request.headers.get("origin");
    if ((origin && origin !== new URL(request.url).origin) || request.headers.get("sec-fetch-site") === "cross-site") throw new SellfoxBrowseError("不接受跨站授权变更请求。", 403);
    if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new SellfoxBrowseError("请使用 JSON 提交。", 415);
    const body = await request.json() as Record<string, unknown>;
    const scope = { organizationId: permission.user.organizationId, workspaceId: workspaceScopeFromRequest(request, body).workspaceId };
    const actor = { id: permission.user.id, role: permission.user.role };
    const row = await saveSellfoxStoreGrant(scope, actor, body);
    return NextResponse.json({ grant: row }, { headers });
  } catch (error) { return fail(error); }
}
