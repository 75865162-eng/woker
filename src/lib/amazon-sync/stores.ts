import { prisma } from "@/lib/db/prisma";
import { assertAmazonAction, assertAmazonScopeAdmin } from "./data-access";
import { requiredText, SyncInputError, type SyncScope } from "./policy";
import { scopeLock } from "./service";

export async function listAmazonStores(scope: SyncScope, actor: string) {
  await assertAmazonScopeAdmin(scope, actor);
  const [sellers, identities, sources, grants, roles, members] = await Promise.all([
    prisma.sellerAccount.findMany({ where: scope, select: { id: true, displayName: true, accountKey: true, status: true, updatedAt: true }, orderBy: { displayName: "asc" }, take: 201 }),
    prisma.amazonSellerIdentity.findMany({ where: scope, take: 201 }),
    prisma.amazonSyncDataSource.findMany({ where: scope, select: { id: true, sellerAccountId: true, marketplaceId: true, resource: true, lastSuccessAt: true, activeRunId: true, authorizationId: true }, take: 201 }),
    prisma.amazonDataAccessGrant.findMany({ where: { ...scope, enabled: true }, take: 2001 }),
    prisma.amazonRoleDataAccessGrant.findMany({ where: { ...scope, enabled: true }, take: 2001 }),
    prisma.organizationMember.findMany({ where: { organizationId: scope.organizationId, user: { status: "active" } }, select: { userId: true, role: true, user: { select: { name: true } } }, take: 2001 }),
  ]);
  if (sellers.length > 200 || identities.length > 200 || sources.length > 200 || grants.length > 2000 || roles.length > 2000 || members.length > 2000) throw new SyncInputError("范围超过管理页安全上限，请缩小工作区。", 409);
  const authorizations = await prisma.amazonSpApiAuthorization.findMany({ where: { ...scope, id: { in: [...new Set([...identities.map(i => i.authorizationId), ...sources.map(s => s.authorizationId)])] } }, select: { id: true, amazonSellerId: true, awsRegion: true, status: true, identityVerifiedAt: true, authorizedByUserId: true, createdAt: true } });
  await prisma.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.stores.admin.read", entityType: "SellerAccount", metadata: { workspaceId: scope.workspaceId, sellerCount: sellers.length } } });
  return sellers.map(seller => ({ ...seller, identities: identities.filter(i => i.sellerAccountId === seller.id), authorizations: authorizations.filter(a => identities.some(i => i.sellerAccountId === seller.id && i.authorizationId === a.id) || sources.some(s => s.sellerAccountId === seller.id && s.authorizationId === a.id)), sources: sources.filter(s => s.sellerAccountId === seller.id), operators: members.filter(m => grants.some(g => g.sellerAccountId === seller.id && g.userId === m.userId) || roles.some(g => g.sellerAccountId === seller.id && g.roleId === m.role)).map(m => ({ userId: m.userId, name: m.user.name, role: m.role })), grants: grants.filter(g => g.sellerAccountId === seller.id), roleGrants: roles.filter(g => g.sellerAccountId === seller.id) }));
}
export async function renameAmazonStore(scope: SyncScope, actor: string, body: Record<string, unknown>) {
  const id = requiredText(body.id, "店铺"), displayName = requiredText(body.displayName, "ERP 显示名称", 100), updatedAt = new Date(requiredText(body.updatedAt, "版本"));
  if (!Number.isFinite(updatedAt.getTime())) throw new SyncInputError("版本无效。");
  return prisma.$transaction(async tx => {
    await scopeLock(tx, scope); await assertAmazonScopeAdmin(scope, actor, tx); await assertAmazonAction(scope, actor, "edit", tx, "settings");
    const existing = await tx.sellerAccount.findFirst({ where: { ...scope, id, updatedAt }, select: { displayName: true } });
    if (!existing) throw new SyncInputError("店铺不可访问或已更新。", 409);
    const changed = await tx.sellerAccount.updateMany({ where: { ...scope, id, updatedAt }, data: { displayName } });
    if (!changed.count) throw new SyncInputError("店铺已更新，请刷新。", 409);
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "amazon.store.renamed", entityType: "SellerAccount", entityId: id, metadata: { workspaceId: scope.workspaceId, before: existing.displayName, after: displayName } } });
    return { saved: true };
  });
}
