import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { defaultRolePermissionMap, roleCanPerformAction } from "@/lib/accounts/permissions";
import { normalizeRolePermissionMap, normalizeRolePermissions } from "@/lib/accounts/role-permissions-utils";
import { decryptSellfoxCredentials, encryptSellfoxCredentials, mergeSellfoxCredentials, sellfoxEncryptionReady, SellfoxCredentialError, type SellfoxCredentials, type SellfoxCredentialScope } from "./credential-crypto";

type Db = Prisma.TransactionClient;
export type SellfoxResolvedCredentials = SellfoxCredentials & { namespace: string };
export type SellfoxCredentialStatus = { configured: boolean; source: "database" | "environment" | "none"; revision: number; updatedAt: string | null; encryptionReady: boolean; storageReady: boolean; configurationError?: string };

function environmentCredentials(): SellfoxCredentials | null {
  const clientId = process.env.SELLFOX_CLIENT_ID?.trim(), clientSecret = process.env.SELLFOX_CLIENT_SECRET?.trim();
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}
export function legacySellfoxCredentials(): SellfoxResolvedCredentials {
  const credentials = environmentCredentials();
  if (!credentials) throw new SellfoxCredentialError("赛狐凭据尚未配置，请在设置的集成页保存凭据。", 503);
  return { ...credentials, namespace: JSON.stringify(["environment", createHash("sha256").update(JSON.stringify(credentials)).digest("hex")]) };
}
function missingCredentialTable(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2021";
}
async function storedCredential(scope: SellfoxCredentialScope, db: Db) {
  if (!process.env.DATABASE_URL) return { record: null, storageReady: false };
  try {
    const record = await db.sellfoxIntegrationCredential.findUnique({ where: { organizationId_workspaceId: scope } });
    return { record, storageReady: true };
  } catch (error) {
    if (missingCredentialTable(error)) return { record: null, storageReady: false };
    throw error;
  }
}
export async function resolveSellfoxCredentials(scope: SellfoxCredentialScope, db: Db = prisma): Promise<SellfoxResolvedCredentials> {
  const { record } = await storedCredential(scope, db);
  if (record) return { ...decryptSellfoxCredentials(record.credentialsCiphertext, scope), namespace: JSON.stringify(["database", scope.organizationId, scope.workspaceId, record.revision, createHash("sha256").update(record.credentialsCiphertext).digest("hex")]) };
  const legacy = legacySellfoxCredentials();
  return { ...legacy, namespace: JSON.stringify([scope.organizationId, scope.workspaceId, legacy.namespace]) };
}
export async function getSellfoxCredentialStatus(scope: SellfoxCredentialScope, db: Db = prisma): Promise<SellfoxCredentialStatus> {
  const { record, storageReady } = await storedCredential(scope, db);
  const base = { revision: record?.revision ?? 0, updatedAt: record?.updatedAt.toISOString() ?? null, encryptionReady: sellfoxEncryptionReady(), storageReady };
  if (record) {
    try { decryptSellfoxCredentials(record.credentialsCiphertext, scope); return { ...base, source: "database", configured: true }; }
    catch { return { ...base, source: "database", configured: false, configurationError: "已保存的赛狐凭据不可用，请管理员核对原加密主密钥。" }; }
  }
  return { ...base, source: environmentCredentials() ? "environment" : "none", configured: Boolean(environmentCredentials()) };
}

export async function sellfoxCredentialAccess(scope: SellfoxCredentialScope, actorUserId: string, db: Db = prisma) {
  const [member, workspace, roles, legacy] = await Promise.all([
    db.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: actorUserId } }, select: { role: true, user: { select: { status: true } } } }),
    db.workspaceScope.findUnique({ where: { organizationId_id: { organizationId: scope.organizationId, id: scope.workspaceId } }, select: { id: true } }),
    db.organizationRosterRole.findMany({ where: { organizationId: scope.organizationId }, select: { id: true, permissions: true } }),
    db.organizationRolePermission.findUnique({ where: { organizationId: scope.organizationId }, select: { permissions: true } }),
  ]);
  const permissions = { ...defaultRolePermissionMap, ...normalizeRolePermissionMap(legacy?.permissions) };
  for (const role of roles) permissions[role.id] = { ...(permissions[role.id] ?? {}), ...normalizeRolePermissions(role.permissions) };
  if (!member || member.user.status !== "active" || !workspace || !roleCanPerformAction(member.role, "sellfox", "view", permissions)) throw new SellfoxCredentialError("无权访问当前工作区的赛狐凭据设置。", 403);
  return { canEdit: ["owner", "database_admin"].includes(member.role) && roleCanPerformAction(member.role, "settings", "edit", permissions) && roleCanPerformAction(member.role, "sellfox", "create", permissions) };
}

export async function saveSellfoxCredentials(scope: SellfoxCredentialScope, actorUserId: string, submitted: unknown, revision: number) {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new SellfoxCredentialError("凭据版本无效，请重新读取配置。", 409);
  return prisma.$transaction(async tx => {
    if (!(await sellfoxCredentialAccess(scope, actorUserId, tx)).canEdit) throw new SellfoxCredentialError("仅有配置权限的组织管理员可保存赛狐凭据。", 403);
    if (!sellfoxEncryptionReady()) throw new SellfoxCredentialError("服务端赛狐加密主密钥尚未配置，未保存凭据。", 503);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["sellfox-credentials", scope.organizationId, scope.workspaceId])}, 0))`;
    const { record, storageReady } = await storedCredential(scope, tx);
    if (!storageReady) throw new SellfoxCredentialError("赛狐凭据存储尚未就绪，请管理员先完成受控数据库迁移。", 503);
    if ((record?.revision ?? 0) !== revision) throw new SellfoxCredentialError("凭据已被其他管理员更新，请重新读取配置后核对再保存。", 409);
    // A corrupt database credential must never fall back to environment values.
    const existing = record ? decryptSellfoxCredentials(record.credentialsCiphertext, scope) : environmentCredentials();
    const credentials = mergeSellfoxCredentials(submitted, existing);
    const credentialsCiphertext = encryptSellfoxCredentials(credentials, scope);
    const nextRevision = revision + 1;
    if (record) {
      const changed = await tx.sellfoxIntegrationCredential.updateMany({ where: { ...scope, revision }, data: { credentialsCiphertext, revision: nextRevision, updatedByUserId: actorUserId } });
      if (changed.count !== 1) throw new SellfoxCredentialError("凭据版本已变化，请重新读取配置。", 409);
    } else await tx.sellfoxIntegrationCredential.create({ data: { ...scope, credentialsCiphertext, revision: nextRevision, updatedByUserId: actorUserId } });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actorUserId, action: "sellfox.credentials.saved", entityType: "sellfox_integration_credential", entityId: JSON.stringify([scope.organizationId, scope.workspaceId]), metadata: { workspaceId: scope.workspaceId, previousRevision: revision, revision: nextRevision, source: "database", externalRequest: false } } });
    return { revision: nextRevision };
  });
}
