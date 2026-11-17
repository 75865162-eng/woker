import { NextResponse } from "next/server";
import { getAuthorizationContext } from "@/lib/auth/authorization-context";
import { prisma } from "@/lib/db/prisma";
import { manageWorkspaceMembership, requireWorkspaceOwner } from "@/lib/workspace/memberships";
import { WorkspaceScopeError, workspaceScopeFromRequest } from "@/lib/workspace/scope";

export const runtime = "nodejs";
const failure = (error: unknown) => NextResponse.json({ error: error instanceof WorkspaceScopeError ? error.message : "工作区成员操作失败。" }, { status: error instanceof WorkspaceScopeError ? error.status : error instanceof SyntaxError ? 400 : 500 });

export async function GET(request: Request) {
  try {
    const authorization = await getAuthorizationContext(request);
    if (!authorization) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    const { user } = authorization;
    await requireWorkspaceOwner(user.organizationId, user.id);
    const { workspaceId } = workspaceScopeFromRequest(request);
    const workspace = await prisma.workspaceScope.findUnique({ where: { organizationId_id: { organizationId: user.organizationId, id: workspaceId } }, select: { id: true } });
    if (!workspace) throw new WorkspaceScopeError("工作区不可访问。", 403);
    const members = await prisma.organizationMember.findMany({ where: { organizationId: user.organizationId }, select: { userId: true, role: true, user: { select: { name: true, email: true, status: true } }, workspaceMemberships: { where: { workspaceId }, select: { workspaceId: true } } }, orderBy: { userId: "asc" } });
    return NextResponse.json({ workspaceId, members: members.map(({ workspaceMemberships, ...member }) => ({ ...member, granted: member.role === "owner" || workspaceMemberships.length > 0 })) });
  } catch (error) { return failure(error); }
}

async function change(request: Request, grant: boolean) {
  try {
    const authorization = await getAuthorizationContext(request);
    if (!authorization) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    const body = await request.json() as Record<string, unknown>;
    const { workspaceId } = workspaceScopeFromRequest(request, body);
    if (typeof body.userId !== "string" || !body.userId.trim()) throw new WorkspaceScopeError("缺少组织成员userId。", 400);
    const result = await manageWorkspaceMembership(authorization.user.organizationId, workspaceId, authorization.user.id, body.userId.trim(), grant);
    return NextResponse.json(result);
  } catch (error) { return failure(error); }
}
export const POST = (request: Request) => change(request, true);
export const DELETE = (request: Request) => change(request, false);
