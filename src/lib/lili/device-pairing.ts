import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { assertAmazonAction, explicitAmazonDataAccess } from "@/lib/amazon-sync/data-access";
import { SyncInputError, type SyncScope } from "@/lib/amazon-sync/policy";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const invalid = () => new SyncInputError("配对码无效、过期、已使用或已撤销。", 401);
const deviceSelect = { id: true, name: true, status: true, revision: true, expiresAt: true, lastUsedAt: true, createdAt: true, tools: true, scopes: true } satisfies Prisma.AmazonMcpCredentialSelect;
export async function createPairing(scope: SyncScope, actor: string, credentialId: string) {
 return prisma.$transaction(async tx => {
  await assertAmazonAction(scope, actor, "edit", tx, "settings");
  await explicitAmazonDataAccess(scope, actor, tx, "view", true);
  const parent = await tx.amazonMcpCredential.findFirst({ where: { ...scope, userId: actor, id: credentialId, status: "ACTIVE", expiresAt: { gt: new Date() } } });
  if (!parent) throw new SyncInputError("请选择本人有效凭证。", 403);
  const id = randomUUID(), code = randomBytes(32).toString("base64url"), expiresAt = new Date(Date.now() + 300_000);
  await tx.amazonMcpCredential.create({ data: { id, ...scope, userId: actor, name: "Lili pending device", tokenHash: hash(code), tokenPrefix: "pairing", tools: parent.tools, scopes: parent.scopes as Prisma.InputJsonValue, status: "DISABLED", expiresAt, createdByUserId: actor, rotatedFromId: parent.id } });
  await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "lili.pairing.created", entityType: "AmazonMcpCredential", entityId: id, metadata: { workspaceId: scope.workspaceId, parentId: parent.id } } });
  return { pairingId: id, code, expiresAt, authentication: "bearer-transition", oauth: false };
 });
}
export async function exchangePairing(pairingId: string, code: string, deviceName: string, onPaired?: (tx: Prisma.TransactionClient, device: { id: string; expiresAt: Date }) => Promise<void>) {
 if (!/^[a-f0-9-]{36}$/.test(pairingId) || !/^[A-Za-z0-9_-]{43}$/.test(code) || !deviceName.trim() || deviceName.length > 100) throw invalid();
 const result = await prisma.$transaction(async tx => {
  await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "lili-pair:" + pairingId);
  const pair = await tx.amazonMcpCredential.findUnique({ where: { id: pairingId } });
  if (!pair || !(pair.status === "DISABLED" && pair.tokenPrefix === "pairing" && pair.revision <= 5) || pair.expiresAt <= new Date()) return null;
  if (!timingSafeEqual(Buffer.from(pair.tokenHash, "hex"), Buffer.from(hash(code), "hex"))) {
   const attempts = pair.revision;
   await tx.amazonMcpCredential.update({ where: { id: pair.id }, data: { status: attempts >= 5 ? "REVOKED" : "DISABLED", revision: { increment: 1 } } });
   await tx.auditLog.create({ data: { organizationId: pair.organizationId, userId: pair.userId, action: "lili.pairing.denied", entityType: "AmazonMcpCredential", entityId: pair.id, metadata: { workspaceId: pair.workspaceId, attempts } } });
   return null;
  }
  const scope = { organizationId: pair.organizationId, workspaceId: pair.workspaceId };
  const parent = await tx.amazonMcpCredential.findFirst({ where: { id: pair.rotatedFromId!, ...scope, userId: pair.userId, status: "ACTIVE", expiresAt: { gt: new Date() } } });
  if (!parent || JSON.stringify(parent.scopes) !== JSON.stringify(pair.scopes) || JSON.stringify(parent.tools) !== JSON.stringify(pair.tools)) return null;
  await explicitAmazonDataAccess(scope, pair.userId, tx, "view", true);
  const token = "amcp_" + randomBytes(32).toString("base64url");
  const device = await tx.amazonMcpCredential.create({ data: { id: randomUUID(), ...scope, userId: pair.userId, name: "Lili device: " + deviceName.trim(), tokenHash: hash(token), tokenPrefix: token.slice(0,12), tools: parent.tools, scopes: parent.scopes as Prisma.InputJsonValue, expiresAt: new Date(Math.min(parent.expiresAt.getTime(), Date.now() + 30 * 86400_000)), createdByUserId: pair.userId, rotatedFromId: parent.id }, select: deviceSelect });
  await tx.amazonMcpCredential.update({ where: { id: pair.id }, data: { status: "REVOKED", revision: { increment: 1 } } });
  await tx.auditLog.create({ data: { organizationId: pair.organizationId, userId: pair.userId, action: "lili.device.paired", entityType: "AmazonMcpCredential", entityId: device.id, metadata: { workspaceId: pair.workspaceId, pairingId: pair.id, parentId: parent.id } } });
  if (onPaired) await onPaired(tx, device);
  return { device, access_token: token, token_type: "Bearer", expires_at: device.expiresAt, oauth: false };
 });
 if (!result) throw invalid();
 return result;
}
export async function listDevices(scope: SyncScope, actor: string, parentId?: string) {
 return prisma.amazonMcpCredential.findMany({ where: { ...scope, userId: actor, ...(parentId ? { rotatedFromId: parentId } : {}), OR: [{ name: { startsWith: "Lili device: " } }, { tokenPrefix: "pairing", status: "DISABLED" }] }, select: deviceSelect, orderBy: { createdAt: "desc" }, take: 100 });
}
export async function revokeDevice(scope: SyncScope, actor: string, id: string) {
 return prisma.$transaction(async tx => {
  await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", "lili-pair:" + id);
  const row = await tx.amazonMcpCredential.findFirst({ where: { id, ...scope, userId: actor, OR: [{ name: { startsWith: "Lili device: " } }, { tokenPrefix: "pairing", status: "DISABLED" }] } });
  if (!row) throw new SyncInputError("设备不可访问。", 403);
  await tx.amazonMcpCredential.update({ where: { id: row.id }, data: { status: "REVOKED", revision: { increment: 1 } } });
  await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: "lili.device.revoked", entityType: "AmazonMcpCredential", entityId: id, metadata: { workspaceId: scope.workspaceId } } });
  return { ok: true };
 });
}
