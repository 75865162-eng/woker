import { prisma } from "@/lib/db/prisma";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@prisma/client";
import { SyncInputError, type SyncScope } from "./policy";
import { defaultRolePermissionMap, roleCanPerformAction, type PermissionAction } from "@/lib/accounts/permissions";
import { normalizeRolePermissions } from "@/lib/accounts/role-permissions-utils";

export const isAmazonScopeAdmin = (role: string) => role === "owner" || role === "database_admin";
export type AmazonDataAction = "view" | "sync" | "export" | "edit";
export type AmazonAccessScope = { sellerAccountId: string; marketplaceIds: string[] };
export type AmazonDataAccess = { allSellers: boolean; sellerIds: string[]; scopes?: AmazonAccessScope[] };
type Boundary = { organizationId: string; workspaceId: string; userId: string; credentialId: string; tool: string; action: AmazonDataAction };
const boundary = new AsyncLocalStorage<Boundary>();
export function withAmazonMcpBoundary<T>(value: Boundary, work: () => Promise<T>) { return boundary.run(value, work); }
export function parseAccessScopes(value: unknown): AmazonAccessScope[] {
  if (!Array.isArray(value) || !value.length || value.length > 200) throw new SyncInputError("数据范围不可访问。", 403);
  return value.map(raw => {
    const r = raw as AmazonAccessScope;
    if (!r || typeof r.sellerAccountId !== "string" || !r.sellerAccountId || r.sellerAccountId.length > 200 || !Array.isArray(r.marketplaceIds) || !r.marketplaceIds.length || r.marketplaceIds.length > 30 || r.marketplaceIds.some(m => typeof m !== "string" || !m || m.length > 200)) throw new SyncInputError("数据范围不可访问。", 403);
    return { sellerAccountId: r.sellerAccountId, marketplaceIds: [...new Set(r.marketplaceIds)].sort() };
  });
}
export async function explicitAmazonDataAccess(scope: SyncScope, actor: string, db: Prisma.TransactionClient, action: AmazonDataAction = "view", mcp = false): Promise<AmazonDataAccess> {
  const member = await db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: actor } }, include: { user: { select: { status: true } } } });
  if (!member || member.user.status !== "active" || !await db.workspaceScope.findUnique({ where: { organizationId_id: { organizationId: scope.organizationId, id: scope.workspaceId } }, select: { id: true } })) throw new SyncInputError("Amazon 数据范围不可访问。", 403);
  await assertAmazonAction(scope, actor, action === "sync" ? "create" : action, db);
  const filter = { ...scope, enabled: true, ...(mcp ? { mcpEnabled: true } : {}) };
  const grants = await db.amazonDataAccessGrant.findMany({ where: { ...filter, userId: actor }, select: { sellerAccountId: true, marketplaceIds: true, actions: true }, take: 201 });
  const roles = await db.amazonRoleDataAccessGrant.findMany({ where: { ...filter, roleId: member.role }, select: { sellerAccountId: true, marketplaceIds: true, actions: true }, take: 201 });
  if (grants.length + roles.length > 200) throw new SyncInputError("授权超过安全上限。", 403);
  const scopes: AmazonAccessScope[] = [...grants, ...roles].filter(g => (g.actions ?? ["view", "sync", "export", "edit"]).includes(action)).map(g => ({ sellerAccountId: g.sellerAccountId, marketplaceIds: g.marketplaceIds ?? [] }));
  if (!scopes.length) throw new SyncInputError("当前成员没有有效的 Workspace / Seller 数据授权。", 403);
  return { allSellers: false, sellerIds: [...new Set(scopes.map(g => g.sellerAccountId))], ...(scopes.some(s => s.marketplaceIds.length) ? { scopes } : {}) };
}
/** Always resolve membership and grants from PostgreSQL. Never accept seller IDs as grants. */
export async function amazonDataAccess(scope: SyncScope, actor: string | undefined, db: Prisma.TransactionClient = prisma, action: AmazonDataAction = "view"): Promise<AmazonDataAccess> {
  if (!actor) throw new SyncInputError("缺少 Amazon 数据操作人。", 403);
  scope = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
  const current = boundary.getStore();
  if (current) {
    if (current.organizationId !== scope.organizationId || current.workspaceId !== scope.workspaceId || current.userId !== actor) throw new SyncInputError("数据范围不可访问。", 403);
    const credential = await db.amazonMcpCredential.findFirst({ where: { id: current.credentialId, ...scope, userId: actor, status: "ACTIVE", expiresAt: { gt: new Date() }, tools: { has: current.tool } }, select: { scopes: true } });
    if (!credential) throw new SyncInputError("数据范围不可访问。", 403);
    const erp = await explicitAmazonDataAccess(scope, actor, db, current.action, true);
    const scopes = parseAccessScopes(credential.scopes).map(s => ({ ...s, marketplaceIds: s.marketplaceIds.filter(m => (erp.scopes ?? erp.sellerIds.map(sellerAccountId => ({ sellerAccountId, marketplaceIds: [] as string[] }))).some(g => g.sellerAccountId === s.sellerAccountId && (!g.marketplaceIds.length || g.marketplaceIds.includes(m)))) })).filter(s => s.marketplaceIds.length);
    if (!scopes.length) throw new SyncInputError("数据范围不可访问。", 403);
    return { allSellers: false, sellerIds: [...new Set(scopes.map(s => s.sellerAccountId))], scopes };
  }
  const member = await db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: actor } }, include: { user: { select: { status: true } } } });
  if (!member || member.user.status !== "active" || !await db.workspaceScope.findUnique({ where: { organizationId_id: { organizationId: scope.organizationId, id: scope.workspaceId } }, select: { id: true } })) throw new SyncInputError("Amazon 数据范围不可访问。", 403);
  if (isAmazonScopeAdmin(member.role)) return { allSellers: true, sellerIds: [] };
  return explicitAmazonDataAccess(scope, actor, db, action);
}
export function sellerAccessWhere(access: AmazonDataAccess) { return access.allSellers ? {} : { sellerAccountId: { in: access.sellerIds }, ...(access.scopes ? { OR: access.scopes.map(s => ({ sellerAccountId: s.sellerAccountId, ...(s.marketplaceIds.length ? { marketplaceId: { in: s.marketplaceIds } } : {}) })) } : {}) }; }
export async function assertSellerAccess(scope: SyncScope, actor: string, sellers: string[], db: Prisma.TransactionClient = prisma, action: AmazonDataAction = "view") {
  const access = await amazonDataAccess(scope, actor, db, action);
  if (!access.allSellers && (!sellers.length || sellers.some(id => !access.sellerIds.includes(id)))) throw new SyncInputError("操作超出成员的 Seller 数据授权。", 403);
  return access;
}
export async function assertAmazonScopeAdmin(scope: SyncScope, actor: string, db: Prisma.TransactionClient = prisma) {
  if (!(await amazonDataAccess(scope, actor, db)).allSellers) throw new SyncInputError("授权及范围管理仅限组织管理员。", 403);
}

/** Live RBAC for background work as well as HTTP. Never trust a session role snapshot. */
export async function assertAmazonAction(scope: SyncScope, actor: string, action: PermissionAction, db: Prisma.TransactionClient = prisma, moduleId = "operations") {
  const member = await db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: actor } }, include: { user: { select: { status: true } } } });
  const permissions = { ...defaultRolePermissionMap };
  for (const role of await db.organizationRosterRole.findMany({ where: { organizationId: scope.organizationId }, select: { id: true, permissions: true } })) permissions[role.id] = { ...(permissions[role.id] ?? {}), ...normalizeRolePermissions(role.permissions) };
  if (!member || member.user.status !== "active" || !roleCanPerformAction(member.role, moduleId, action, permissions)) throw new SyncInputError("数据范围不可访问。", 403);
}

/** A local Marketplace FK or a matching SKU is not evidence of an Amazon site binding. */
export async function assertSellerMarketplaceAccess(scope: SyncScope, actor: string, sellerAccountId: string, marketplaceId: string, db: Prisma.TransactionClient = prisma, action: AmazonDataAction = "view") {
  scope = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
  const access = await assertSellerAccess(scope, actor, [sellerAccountId], db, action);
  if (access.scopes && !access.scopes.some(s => s.sellerAccountId === sellerAccountId && (!s.marketplaceIds.length || s.marketplaceIds.includes(marketplaceId)))) throw new SyncInputError("数据范围不可访问。", 403);
  const source = await db.amazonSyncDataSource.findFirst({ where: { ...scope, sellerAccountId, marketplaceId, seller: { status: "active" } }, select: { id: true } });
  if (!source) throw new SyncInputError("数据范围不可访问。", 403);
}
