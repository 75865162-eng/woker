import { prisma } from "@/lib/db/prisma";
import { SellfoxCredentialError, type SellfoxCredentialScope } from "./credential-crypto";
import { getSellfoxCredentialStatus, resolveSellfoxCredentials, sellfoxCredentialAccess } from "./credential-store";
import { SellfoxRequestError, testSellfoxConnection } from "./client";

export async function runSellfoxConnectionTest(scope: SellfoxCredentialScope, actor: string, revision: number) {
  if (!Number.isSafeInteger(revision) || revision < 0) throw new SellfoxCredentialError("请重新读取凭据配置后再测试。", 409);
  const prepared = await prisma.$transaction(async tx => {
    if (!(await sellfoxCredentialAccess(scope, actor, tx)).canEdit) throw new SellfoxCredentialError("仅有配置权限的组织管理员可测试连接。", 403);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(["sellfox-connection-test", scope.organizationId, scope.workspaceId])}, 0))`;
    const status = await getSellfoxCredentialStatus(scope, tx);
    if (status.revision !== revision) throw new SellfoxCredentialError("凭据版本已变化，请重新读取配置后再测试。", 409);
    if (!status.configured) throw new SellfoxCredentialError("请先保存有效的赛狐凭据，再测试连接。", 409);
    const entityId = JSON.stringify([scope.organizationId, scope.workspaceId]);
    const recent = await tx.auditLog.findFirst({ where: { organizationId: scope.organizationId, entityId, action: "sellfox.credentials.test.started", createdAt: { gte: new Date(Date.now() - 60_000) } }, select: { id: true } });
    if (recent) throw new SellfoxCredentialError("测试过于频繁，请一分钟后重试。", 429);
    const credentials = await resolveSellfoxCredentials(scope, tx);
    const audit = await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, entityType: "sellfox_integration_credential", entityId, action: "sellfox.credentials.test.started", metadata: { workspaceId: scope.workspaceId, revision, tokenOnly: true } }, select: { id: true } });
    return { credentials, auditId: audit.id, entityId };
  });
  let passed = false;
  let message = "赛狐连接测试失败，请检查凭据、网络及赛狐 IP 白名单。";
  try {
    await testSellfoxConnection(prepared.credentials);
    passed = true;
    message = "连接成功，赛狐已接受当前凭据并返回有效 Token。尚未验证店铺或各业务接口权限。";
  } catch (error) {
    // Only fixed, locally generated client messages may leave the server.
    if (error instanceof SellfoxRequestError) message = error.message;
  }
  await prisma.$transaction(async tx => {
    if (!(await sellfoxCredentialAccess(scope, actor, tx)).canEdit) throw new SellfoxCredentialError("测试期间权限已变化，请重新读取配置。", 403);
    const current = await resolveSellfoxCredentials(scope, tx);
    if (current.namespace !== prepared.credentials.namespace) throw new SellfoxCredentialError("测试期间凭据已更新，请重新测试。", 409);
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, entityType: "sellfox_integration_credential", entityId: prepared.entityId, action: "sellfox.credentials.test.finished", metadata: { workspaceId: scope.workspaceId, revision, attemptId: prepared.auditId, passed, tokenOnly: true } } });
  });
  return { passed, message, revision, testedAt: new Date().toISOString() };
}
