import { assertAmazonCloudExecution } from "@/lib/amazon/execution-role";
import { assertAmazonScopeAdmin } from "./data-access";
import { requireSyncCenter, officialEndpoint, optionalAmazonSellerId, requiredText, SyncInputError, type SyncScope } from "./policy";
import { decryptAmazonSpApiCredentials, encryptAmazonSpApiCredentials, mergeAmazonSpApiSettings, type AmazonSpApiSettings } from "@/lib/amazon/integration-secrets";
import { AmazonSpApiClient, AmazonSpApiError } from "@/lib/amazon/sp-api-client";
import { extractMarketplaceParticipations } from "@/lib/operations/readiness";
import { scopeLock, stopOrderSourceTasks } from "./service";
import { ensureAmazonSyncInitialized } from "./scheduler";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";

const authorizationSelect = {
  id: true, name: true, amazonSellerId: true, awsRegion: true, endpoint: true, revision: true,
  status: true, approvedRoles: true, rolesAttestedAt: true, marketplaceParticipations: true,
  lastValidatedAt: true, validationAttemptedAt: true, validationErrorCode: true, updatedAt: true,
} satisfies Prisma.AmazonSpApiAuthorizationSelect;

/**
 * 免审批「保存即激活」：一次请求内完成 保存凭证 → 真实调用 Amazon 校验参与站点 →
 * 置 CONFIGURED → 自动建立数据源/调度并入队全量同步。
 *
 * 这是 OAuth 路径（finishAmazonOAuth）在「手动填写凭证」场景下的等价实现：
 * 审批状态机（requestChange/decideChange/applyChange）与人工「验证参与站点」步骤被移除，
 * 但所有安全校验原样保留：云执行角色、scope 管理员权限、官方 endpoint、凭证加密、
 * revision 乐观并发、scope 锁、真实 Amazon API 参与站点核验、审计。
 *
 * 只有「参与站点」技术核验保留——它是决定同步哪些站点的必需事实来源，不是审批门槛。
 */
export async function saveAndActivateAuthorizationDirect(
  scope: SyncScope,
  actorUserId: string,
  body: Record<string, unknown>,
) {
  assertAmazonCloudExecution();
  requireSyncCenter(scope);
  await assertAmazonScopeAdmin(scope, actorUserId);

  // validate 模式（兼容调用）：跳过保存，直接对已存凭证重新验证并初始化。
  if (body.action === "validate-authorization") {
    return activateExistingAuthorizationDirect(scope, actorUserId, requiredText(body.id, "授权 ID"));
  }

  const id = body.id === undefined ? requiredText(body.proposedId, "新记录 ID") : requiredText(body.id, "授权 ID");
  const name = requiredText(body.name, "授权名称", 100);
  const amazonSellerId = optionalAmazonSellerId(body.amazonSellerId);
  const region = requiredText(body.region, "区域");
  const endpoint = requiredText(body.endpoint, "API endpoint");
  officialEndpoint(region, endpoint);

  // 读取既有授权，校验 revision 与不可原地变更的字段。
  const existing = await prisma.amazonSpApiAuthorization.findFirst({ where: { ...scope, id } });
  if (body.id && !existing) throw new SyncInputError("授权不存在。", 404);
  if (existing && body.revision !== existing.revision) throw new SyncInputError("授权已更新，请刷新后重新编辑。", 409);
  if (existing && ((existing.amazonSellerId && existing.amazonSellerId !== amazonSellerId) || existing.awsRegion !== region || existing.endpoint !== endpoint)) {
    throw new SyncInputError("卖家身份、区域和 endpoint 不可原地更换，请新增授权。");
  }

  const credentials = existing
    ? decryptAmazonSpApiCredentials(existing.credentialsCiphertext, { ...scope, authorizationId: id })
    : null;
  const submitted: Partial<AmazonSpApiSettings> = { region, endpoint };
  for (const field of ["lwaClientId", "lwaClientSecret", "refreshToken", "awsAccessKeyId", "awsSecretAccessKey", "awsSessionToken"] as const) {
    if (body[field] !== undefined && (typeof body[field] !== "string" || (body[field] as string).length > 16384)) {
      throw new SyncInputError("凭证格式无效或超出长度限制。");
    }
    if (typeof body[field] === "string") submitted[field] = body[field];
  }
  const settings = mergeAmazonSpApiSettings(credentials, submitted);
  const roleData = body.approvedRoles === undefined ? {} : { approvedRoles: body.approvedRoles as string[], rolesAttestedAt: new Date() };
  const credentialsCiphertext = encryptAmazonSpApiCredentials(settings, { ...scope, authorizationId: id });

  // 1) 保存凭证（scope 锁 + 乐观并发 + 审计），状态先置 NOT_CONFIGURED。
  await prisma.$transaction(async tx => {
    await scopeLock(tx, scope);
    if (!amazonSellerId && await tx.amazonSpApiAuthorization.findFirst({
      where: { ...scope, amazonSellerId: "", awsRegion: region, ...(existing ? { id: { not: id } } : {}) }, select: { id: true },
    })) throw new SyncInputError("此区域已有待补充 Seller ID 的基础连接，请更新该连接后再新增。", 409);
    if (existing) {
      const changed = await tx.amazonSpApiAuthorization.updateMany({
        where: { ...scope, id, revision: body.revision as number },
        data: {
          name, amazonSellerId, credentialsCiphertext, ...roleData, revision: { increment: 1 },
          identityVerifiedAt: null, identityEvidence: "MANUAL_UNVERIFIED", status: "NOT_CONFIGURED",
          marketplaceParticipations: [], lastValidatedAt: null, validationAttemptedAt: null,
          validationErrorCode: null, updatedByUserId: actorUserId,
        },
      });
      if (!changed.count) throw new SyncInputError("授权已更新，请刷新。", 409);
    } else {
      await tx.amazonSpApiAuthorization.create({
        data: { ...scope, id, name, amazonSellerId, awsRegion: region, endpoint, credentialsCiphertext, ...roleData, updatedByUserId: actorUserId },
      });
    }
    await tx.auditLog.create({
      data: { organizationId: scope.organizationId, userId: actorUserId, action: "amazon.sync.authorization.saved", entityType: "AmazonSpApiAuthorization", entityId: id, metadata: { workspaceId: scope.workspaceId, encrypted: true, autoActivate: true } },
    });
  });

  // 2+3) 真实校验参与站点 → 置 CONFIGURED → 自动建立数据源/调度并入队全量同步。
  return verifyAndInitialize(scope, actorUserId, id);
}

/**
 * 兼容「验证参与站点」调用：对已存凭证直接重新验证并自动初始化，无审批门槛。
 */
export async function activateExistingAuthorizationDirect(scope: SyncScope, actorUserId: string, id: string) {
  assertAmazonCloudExecution();
  requireSyncCenter(scope);
  await assertAmazonScopeAdmin(scope, actorUserId);
  return verifyAndInitialize(scope, actorUserId, id);
}

/** 真实参与站点校验 + 自动初始化的共享实现。 */
async function verifyAndInitialize(scope: SyncScope, actorUserId: string, id: string) {
  const auth = await prisma.amazonSpApiAuthorization.findFirst({ where: { ...scope, id } });
  if (!auth || auth.status === "DISABLED") throw new SyncInputError("授权不存在或已停用。", 409);
  officialEndpoint(auth.awsRegion, auth.endpoint);
  const decrypted = decryptAmazonSpApiCredentials(auth.credentialsCiphertext, { ...scope, authorizationId: id });
  const attemptedAt = new Date();
  let lastResponseOperation = "LWA";
  try {
    const client = new AmazonSpApiClient({ ...decrypted, region: auth.awsRegion, endpoint: auth.endpoint }, {
      onResponse: event => { lastResponseOperation = event.operation; },
    });
    const participations = extractMarketplaceParticipations(await client.getMarketplaceParticipations());
    if (!participations.length) throw new SyncInputError("Amazon 未返回可用 Marketplace 参与站点。", 409);
    const changed = await prisma.amazonSpApiAuthorization.updateMany({
      where: { ...scope, id, revision: auth.revision, status: { not: "DISABLED" } },
      data: {
        status: "CONFIGURED", marketplaceParticipations: participations as Prisma.InputJsonValue,
        lastValidatedAt: attemptedAt, validationAttemptedAt: attemptedAt, validationErrorCode: null,
        revision: { increment: 1 }, updatedByUserId: actorUserId,
      },
    });
    if (!changed.count) throw new SyncInputError("授权在验证期间已发生变更。", 409);
    await prisma.auditLog.create({
      data: { organizationId: scope.organizationId, userId: actorUserId, action: "amazon.sync.authorization.validated", entityType: "AmazonSpApiAuthorization", entityId: id, metadata: { workspaceId: scope.workspaceId, marketplaceCount: participations.length, credentialsEncrypted: true, autoActivate: true } },
    });
  } catch (error) {
    const errorCode = error instanceof AmazonSpApiError && error.authorizationRejected ? "AUTH_REJECTED" : error instanceof SyncInputError ? "INVALID_PARTICIPATIONS" : "VALIDATION_FAILED";
    await prisma.amazonSpApiAuthorization.updateMany({
      where: { ...scope, id, revision: auth.revision, status: { not: "DISABLED" } },
      data: { status: errorCode === "AUTH_REJECTED" ? "ERROR" : "NOT_CONFIGURED", validationAttemptedAt: attemptedAt, validationErrorCode: errorCode },
    });
    await prisma.auditLog.create({
      data: { organizationId: scope.organizationId, userId: actorUserId, action: "amazon.sync.authorization.validation_failed", entityType: "AmazonSpApiAuthorization", entityId: id, metadata: { workspaceId: scope.workspaceId, code: errorCode } },
    });
    if (error instanceof SyncInputError) throw error;
    if (error instanceof AmazonSpApiError) {
      const failedStep = lastResponseOperation === "LWA" ? "LWA 换取访问令牌"
        : lastResponseOperation === "getMarketplaceParticipations" ? "Sellers.getMarketplaceParticipations（参与站点查询）" : "SP-API 授权校验";
      const message = error.status !== null ? `亚马逊返回：${error.message} 失败步骤：${failedStep}。` : `连接异常：${error.message} 请检查网络或代理后重试。`;
      throw new SyncInputError(message, 409);
    }
    throw new SyncInputError("系统异常：授权验证未完成，请检查服务状态后重试。", 409);
  }

  let automaticSync: Awaited<ReturnType<typeof ensureAmazonSyncInitialized>>;
  try {
    automaticSync = await ensureAmazonSyncInitialized(scope, id);
  } catch {
    console.error(`[amazon-direct-activation] automatic initialization deferred for authorization ${String(id).slice(0, 80)}`);
    automaticSync = { status: "deferred", sourceCount: 0, planCount: 0, taskCount: 0 };
  }
  return {
    activated: true,
    authorization: await prisma.amazonSpApiAuthorization.findUniqueOrThrow({ where: { id }, select: authorizationSelect }),
    automaticSync,
  };
}

/** 直接停用授权：保留 scope 管理员权限、revision 并发与审计，无审批门槛。 */
export async function disableAuthorizationDirect(scope: SyncScope, actorUserId: string, id: string, revision: unknown) {
  assertAmazonCloudExecution();
  requireSyncCenter(scope);
  await assertAmazonScopeAdmin(scope, actorUserId);
  if (!Number.isInteger(revision)) throw new SyncInputError("请提供授权版本。");
  return prisma.$transaction(async tx => {
    await scopeLock(tx, scope);
    const changed = await tx.amazonSpApiAuthorization.updateMany({ where: { ...scope, id, revision: revision as number }, data: { status: "DISABLED", revision: { increment: 1 } } });
    if (!changed.count) throw new SyncInputError("授权不存在或已更新。", 409);
    const domainReportResources = ["orders", "finance", "returns", "settlements", "reimbursements", "inventory_age", "long_term_storage_fees", "removal_shipment_report", "fba_shipments", "fba_customer_sales", "mfn_returns", "fba_inventory_by_country", "removal_order_report", "storage_fees", "fba_overage_fees", "fee_preview", "fba_fulfilled_inventory", "fba_inventory_report", "reserved_inventory", "stranded_inventory", "recommended_removals", "inventory_events", "fulfillment", "pricing", "brand_analytics", "buy_box_history", "notifications", "listing_details", "catalog_items", "promotions"];
    const orderSources = await tx.amazonSyncDataSource.findMany({ where: { ...scope, authorizationId: id, resource: { in: domainReportResources } }, select: { id: true } });
    if (orderSources.length) {
      await tx.amazonSyncDataSource.updateMany({ where: { ...scope, id: { in: orderSources.map(s => s.id) } }, data: { enabled: false, revision: { increment: 1 } } });
      await stopOrderSourceTasks(tx, scope, orderSources.map(s => s.id));
    }
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actorUserId, action: "amazon.sync.authorization.disabled", entityType: "AmazonSpApiAuthorization", entityId: id, metadata: { workspaceId: scope.workspaceId, direct: true } } });
    return { disabled: true };
  });
}

/** 直接重新启用授权并自动验证+同步：无审批、无手动验证步骤。 */
export async function enableAndActivateAuthorizationDirect(scope: SyncScope, actorUserId: string, id: string, revision: unknown) {
  assertAmazonCloudExecution();
  requireSyncCenter(scope);
  await assertAmazonScopeAdmin(scope, actorUserId);
  if (!Number.isInteger(revision)) throw new SyncInputError("请提供授权版本。");
  await prisma.$transaction(async tx => {
    await scopeLock(tx, scope);
    const changed = await tx.amazonSpApiAuthorization.updateMany({
      where: { ...scope, id, revision: revision as number, status: "DISABLED" },
      data: { status: "NOT_CONFIGURED", revision: { increment: 1 }, marketplaceParticipations: [], lastValidatedAt: null, validationAttemptedAt: null, validationErrorCode: null, identityVerifiedAt: null, identityEvidence: "MANUAL_UNVERIFIED", updatedByUserId: actorUserId },
    });
    if (!changed.count) throw new SyncInputError("授权不存在、未停用或版本已变化。", 409);
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actorUserId, action: "amazon.sync.authorization.enabled", entityType: "AmazonSpApiAuthorization", entityId: id, metadata: { workspaceId: scope.workspaceId, direct: true } } });
  });
  return verifyAndInitialize(scope, actorUserId, id);
}
