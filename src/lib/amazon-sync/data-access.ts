import { credentialAllowsTool } from "@/lib/lili/account-tool-access";
import { prisma } from "@/lib/db/prisma";
import { assertWorkspaceAccess } from "@/lib/workspace/access";
import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@prisma/client";
import { SyncInputError, type SyncScope } from "./policy";
import { roleCanPerformAction, type PermissionAction } from "@/lib/accounts/permissions";
import { mergeRolePermissions, type RolePermissionRow } from "@/lib/accounts/role-permissions-utils";
import { getOrganizationRolePermissionsCached } from "@/lib/accounts/role-permission-cache";

export const isAmazonScopeAdmin = (role: string) => role === "owner" || role === "database_admin";
export type AmazonDataAction = "view" | "sync" | "export" | "edit";
export type AmazonAccessScope = { sellerAccountId: string; marketplaceIds: string[] };
export type AmazonDataAccess = { allSellers: boolean; sellerIds: string[]; scopes?: AmazonAccessScope[] };
type Boundary = { organizationId: string; workspaceId: string; userId: string; credentialId?: string; tool: string; action: AmazonDataAction };
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
  scope = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
  const member = await db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: actor } }, include: { user: { select: { status: true } } } });
  if (!member || member.user.status !== "active" || !await assertWorkspaceAccess(scope.organizationId, scope.workspaceId, actor, db)) throw new SyncInputError("Amazon 数据范围不可访问。", 403);
  // An enabled user/account assignment grants every Amazon business read.
  // Legacy module, tool, action and marketplace settings apply only to mutations.
  // P0 并集口径：view/export 也合并"成员所属角色"的店铺授权（旧逻辑仅认成员授权）。
  // 双读期保留全部既有语义：active 店铺校验、200 安全上限、外层 boundary/MCP 链路不变。
  if (action === "view" || action === "export") {
    // Scope admins (owner/database_admin) see every active seller on direct ERP reads
    // without per-seller grants. MCP token reads keep the grant scope below.
    if (!mcp && isAmazonScopeAdmin(member.role)) {
      const allSellers = await db.sellerAccount.findMany({ where: { ...scope, status: "active" }, select: { id: true }, take: 201 });
      if (allSellers.length > 200) throw new SyncInputError("授权超过安全上限。", 403);
      if (!allSellers.length) throw new SyncInputError("当前用户没有已分配的 Amazon 账号。", 403, "AMAZON_SCOPE_EMPTY");
      return { allSellers: false, sellerIds: allSellers.map(seller => seller.id) };
    }
    const grants = await db.amazonDataAccessGrant.findMany({ where: { ...scope, userId: actor, enabled: true, seller: { status: "active" } }, select: { sellerAccountId: true }, take: 201 });
    const roleGrants = await db.amazonRoleDataAccessGrant.findMany({ where: { ...scope, roleId: member.role, enabled: true }, select: { sellerAccountId: true }, take: 201 });
    // 角色授权表无 seller 关联，需显式过滤 active 店铺，避免读到停用/删除店铺。
    const roleSellerIds = roleGrants.length
      ? (await db.sellerAccount.findMany({ where: { ...scope, id: { in: roleGrants.map(grant => grant.sellerAccountId) }, status: "active" }, select: { id: true }, take: 201 })).map(seller => seller.id)
      : [];
    const sellerIds = [...new Set([...grants.map(grant => grant.sellerAccountId), ...roleSellerIds])];
    if (sellerIds.length > 200) throw new SyncInputError("授权超过安全上限。", 403);
    if (!sellerIds.length) throw new SyncInputError("当前用户没有已分配的 Amazon 账号。", 403, "AMAZON_SCOPE_EMPTY");
    return { allSellers: false, sellerIds };
  }
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
    const effectiveAction = action === "view" && current.action !== "view" ? current.action : action;
    if (!current.credentialId) {
      if (effectiveAction !== "view" && effectiveAction !== "export") throw new SyncInputError("会话数据接口只允许读取。", 403);
      return explicitAmazonDataAccess(scope, actor, db, effectiveAction);
    }
    const credential = await db.amazonMcpCredential.findFirst({ where: { id: current.credentialId, ...scope, userId: actor, status: "ACTIVE", expiresAt: { gt: new Date() } }, select: { id: true, scopes: true, name: true, rotatedFromId: true, tools: true } });
    if (!credential || !await credentialAllowsTool(credential, current.tool, db, {
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
      userId: actor,
      provider: "amazon",
    })) throw new SyncInputError("数据范围不可访问。", 403);
    if (credential.name.startsWith("Lili device: ")) {
      let parentId = credential.rotatedFromId;
      const seen = new Set([current.credentialId]);
      while (parentId) {
        if (seen.has(parentId) || seen.size > 20) throw new SyncInputError("数据范围不可访问。", 403);
        seen.add(parentId);
        const parent = await db.amazonMcpCredential.findFirst({ where: { id: parentId, ...scope, userId: actor, status: "ACTIVE", expiresAt: { gt: new Date() } }, select: { scopes: true, tools: true, name: true, rotatedFromId: true } });
        if (!parent || (effectiveAction !== "view" && effectiveAction !== "export" && JSON.stringify(credential.scopes) !== JSON.stringify(parent.scopes))) throw new SyncInputError("数据范围不可访问。", 403);
        parentId = parent.name.startsWith("Lili device: ") ? parent.rotatedFromId : null;
      }
    }
    const erp = await explicitAmazonDataAccess(scope, actor, db, effectiveAction, true);
    if (effectiveAction === "view" || effectiveAction === "export") return erp;
    const scopes = parseAccessScopes(credential.scopes).map(s => ({ ...s, marketplaceIds: s.marketplaceIds.filter(m => (erp.scopes ?? erp.sellerIds.map(sellerAccountId => ({ sellerAccountId, marketplaceIds: [] as string[] }))).some(g => g.sellerAccountId === s.sellerAccountId && (!g.marketplaceIds.length || g.marketplaceIds.includes(m)))) })).filter(s => s.marketplaceIds.length);
    if (!scopes.length) throw new SyncInputError("数据范围不可访问。", 403);
    return { allSellers: false, sellerIds: [...new Set(scopes.map(s => s.sellerAccountId))], scopes };
  }
  const member = await db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: actor } }, include: { user: { select: { status: true } } } });
  if (!member || member.user.status !== "active" || !await assertWorkspaceAccess(scope.organizationId, scope.workspaceId, actor, db)) throw new SyncInputError("Amazon 数据范围不可访问。", 403);
  if (action !== "view" && action !== "export" && isAmazonScopeAdmin(member.role)) return { allSellers: true, sellerIds: [] };
  return explicitAmazonDataAccess(scope, actor, db, action);
}
export function sellerAccessWhere(access: AmazonDataAccess) { return access.allSellers ? {} : { sellerAccountId: { in: access.sellerIds }, ...(access.scopes ? { OR: access.scopes.map(s => ({ sellerAccountId: s.sellerAccountId, ...(s.marketplaceIds.length ? { marketplaceId: { in: s.marketplaceIds } } : {}) })) } : {}) }; }
/** Every business domain inherits the same account assignment. */
export const sourceAccessWhere = sellerAccessWhere;
export async function assertSellerAccess(scope: SyncScope, actor: string, sellers: string[], db: Prisma.TransactionClient = prisma, action: AmazonDataAction = "view") {
  const access = await amazonDataAccess(scope, actor, db, action);
  if (!access.allSellers && (!sellers.length || sellers.some(id => !access.sellerIds.includes(id)))) throw new SyncInputError("操作超出成员的 Seller 数据授权。", 403);
  return access;
}
/** Management authority is separate from business data access. */
export async function assertAmazonScopeAdmin(scope: SyncScope, actor: string, db: Prisma.TransactionClient = prisma) {
  if (boundary.getStore()) throw new SyncInputError("数据接口不能管理账号授权。", 403);
  const member = await db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: actor } }, include: { user: { select: { status: true } } } });
  if (!member || member.user.status !== "active" || !isAmazonScopeAdmin(member.role)
    || !await assertWorkspaceAccess(scope.organizationId, scope.workspaceId, actor, db)) {
    throw new SyncInputError("授权及范围管理仅限组织管理员。", 403);
  }
}

/** Finance reads inherit the account assignment; callers must still filter that account. */
export async function assertAmazonFinanceAccess(scope: SyncScope, actor: string, db: Prisma.TransactionClient = prisma) {
  await amazonDataAccess(scope, actor, db);
  return true;
}

/** Live RBAC for background work as well as HTTP. Never trust a session role snapshot. */
export async function assertAmazonAction(scope: SyncScope, actor: string, action: PermissionAction, db: Prisma.TransactionClient = prisma, moduleId = "operations") {
  const member = await db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: actor } }, include: { user: { select: { status: true } } } });
  if (!member || member.user.status !== "active") throw new SyncInputError("数据范围不可访问。", 403);
  const readRoles = () => db.organizationRosterRole.findMany({ where: { organizationId: scope.organizationId }, select: { id: true, permissions: true } }) as Promise<RolePermissionRow[]>;
  // Transaction clients must read their own view; only the global client may use
  // the cross-request cache. The member status above is always read live.
  const permissions = db === prisma
    ? await getOrganizationRolePermissionsCached(scope.organizationId, async () => mergeRolePermissions(await readRoles()))
    : mergeRolePermissions(await readRoles());
  if (!roleCanPerformAction(member.role, moduleId, action, permissions)) throw new SyncInputError("数据范围不可访问。", 403);
}

/** A local Marketplace FK or a matching SKU is not evidence of an Amazon site binding. */
export async function assertSellerMarketplaceAccess(scope: SyncScope, actor: string, sellerAccountId: string, marketplaceId: string, db: Prisma.TransactionClient = prisma, action: AmazonDataAction = "view", allowInactiveSeller = false) {
  scope = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
  const access = await assertSellerAccess(scope, actor, [sellerAccountId], db, action);
  if (access.scopes && !access.scopes.some(s => s.sellerAccountId === sellerAccountId && (!s.marketplaceIds.length || s.marketplaceIds.includes(marketplaceId)))) throw new SyncInputError("数据范围不可访问。", 403);
  const source = await db.amazonSyncDataSource.findFirst({ where: { ...scope, sellerAccountId, marketplaceId, ...(allowInactiveSeller ? {} : { seller: { status: "active" } }) }, select: { id: true } });
  if (!source) throw new SyncInputError("数据范围不可访问。", 403);
}
