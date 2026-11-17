import { prisma } from "@/lib/db/prisma";
import { WorkspaceScopeError } from "@/lib/workspace/scope";

type WorkspaceAccessClient = Pick<typeof prisma, "workspaceScope" | "organizationMember" | "workspaceMembership">;
const requestChecks = new WeakMap<Request, Map<string, Promise<boolean>>>();

/** 所有入口绑定真实actor；请求内去重，撤权和停用在下一请求立即生效。 */
export async function assertWorkspaceAccess(
  organizationId: string,
  workspaceId: string,
  userId: string,
  client: WorkspaceAccessClient = prisma,
  request?: Request,
): Promise<boolean> {
  if (![organizationId, workspaceId, userId].every(value => typeof value === "string" && value.trim())) return false;
  const load = async () => {
    const [workspace, member] = await Promise.all([
      client.workspaceScope.findUnique({ where: { organizationId_id: { organizationId, id: workspaceId } }, select: { id: true } }),
      client.organizationMember.findUnique({ where: { organizationId_userId: { organizationId, userId } }, select: { role: true, user: { select: { status: true } } } }),
    ]);
    if (!workspace || !member || member.user.status !== "active") return false;
    if (member.role === "owner") return true;
    return Boolean(await client.workspaceMembership.findUnique({
      where: { organizationId_workspaceId_userId: { organizationId, workspaceId, userId } }, select: { userId: true },
    }));
  };
  if (!request || client !== prisma) return load();
  let checks = requestChecks.get(request);
  if (!checks) { checks = new Map(); requestChecks.set(request, checks); }
  const key = JSON.stringify([organizationId, workspaceId, userId]);
  const existing = checks.get(key);
  if (existing) return existing;
  const result = load();
  checks.set(key, result);
  return result;
}

/** 上传路由在任何存储副作用之前检查所有表单选择器。 */
export async function assertUploadWorkspaceAccess(organizationId: string, formData: FormData, workspaceId: string, userId: string, request?: Request) {
  const checked = new Set<string>();
  for (const value of [...formData.getAll("workspaceId"), workspaceId]) {
    if (typeof value !== "string" || !value.trim()) throw new WorkspaceScopeError("Invalid workspaceId.", 400);
    const id = value.trim();
    if (checked.has(id)) continue;
    checked.add(id);
    if (checked.size > 4 || !(await assertWorkspaceAccess(organizationId, id, userId, prisma, request))) {
      throw new WorkspaceScopeError("Forbidden workspace.", 403);
    }
  }
}
