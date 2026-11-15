import { amazonAccountReadAccess } from "./read-account";
import { amazonAdsAccountReadAccess } from "@/lib/amazon-ads/read-access";
import { adsEntityBusinessFields } from "@/lib/amazon-ads/business-fields";
import { readActualFieldCoverage } from "./actual-field-coverage";
import { orderRecoveryReadiness } from "./orders-recovery";
import { readFieldRegistry } from "./field-registry";
import { readArchivedBusinessData } from "./archive-business-query";
import { accountToolsForLili, credentialAllowsTool, amazonAccountReadTools } from "@/lib/lili/account-tool-access";
import { adsEntityTypes, mcpDatasets, datasetForTable, resolveMcpDataset, normalizeDatasetQuery, describeMcpDataset, enrichDatasetResult, presentMcpReport, McpDatasetError } from "./mcp-datasets";
import { readSyncCoverage } from "./coverage";
import { createToolGateway, GatewayInvocationError } from "@/lib/agent-platform/tool-gateway";
import { fixedAmazonMcpDataset, amazonMcpTools, amazonMcpSyncResources, bindAmazonMcpHandlers, hasReimbursementAnalysisReadPath, isCallableAmazonMcpTool, mcpDiscoveryDescriptor, type AmazonMcpToolName } from "./mcp-tool-registry";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { amazonDataAccess, assertAmazonAction, assertAmazonScopeAdmin, assertAmazonFinanceAccess, explicitAmazonDataAccess, parseAccessScopes, sellerAccessWhere, withAmazonMcpBoundary, type AmazonAccessScope, type AmazonDataAction } from "./data-access";
import { isResearchTool, researchCredentialTools, researchToolActions, liliToolModule } from "@/lib/lili/research-grants";
import { requiredText, SyncInputError, type SyncScope } from "./policy";
import { incrementalOperatorAction } from "./read";
import { readTaskSnapshot } from "./snapshots";
import { readSalesTraffic } from "./sales-query";
import { availableSkillTables, describeSkillTable, querySkillTable, skillReadiness, skillTableAvailability } from "./skill-data";
import { assertAdsQueryBudget } from "@/lib/amazon-ads/query-budget";
import { queryPublishedAdsReports } from "@/lib/amazon-ads/report-query";
import { AdsQueryError, parseAdsQuery } from "@/lib/amazon-ads/query-contract";
import { queryAdsEntities } from "@/lib/amazon-ads/data-query";
import { adsReadAdapterReady } from "@/lib/amazon-ads/sync-adapter";
import { adsScopeEnabled } from "@/lib/amazon-ads/sync-policy";
import { analyzeReimbursementRecovery } from "./reimbursement-analysis";
import { assertSkillSyncSourcePublishable, skillSyncRetryCommand } from "./skill-sync-retry";
import { requestChange } from "./change-approval";
import { assertAmazonMcpScope } from "./mcp-scope";

export { amazonMcpTools, amazonMcpToolCatalog } from "./mcp-tool-registry";
const canonicalMcpTool = (tool: string) => registeredAmazonMcpTools.find(item => item.name === tool)?.canonicalName ?? tool;
const adsStatusTools = new Set(["ads_get_sync_status", "ads_get_data_health", "ads_get_connection_status", "ads_get_settings"]);
export const mcpTokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
const credentialSelect = { id: true, name: true, userId: true, tokenPrefix: true, tools: true, scopes: true, status: true, revision: true, expiresAt: true, createdAt: true, lastUsedAt: true } satisfies Prisma.AmazonMcpCredentialSelect;

/** Cross-provider attempts are recorded even when no Amazon identity matched. */
export async function auditAmazonMcpIsolation(metadata: Prisma.InputJsonObject) {
  await prisma.auditLog.create({
    data: { organizationId: null, userId: null, action: "amazon.mcp.isolation.denied", entityType: "AmazonMcpCredential", metadata: { provider: "amazon", ...metadata } },
  }).catch(() => undefined);
}

async function audit(scope: SyncScope | null, actor: string | null, action: string, metadata: Prisma.InputJsonObject) {
  await prisma.auditLog.create({ data: { organizationId: scope?.organizationId, userId: actor, action, entityType: "AmazonMcpCredential", metadata: { workspaceId: scope?.workspaceId, ...metadata } } });
}
async function explicitSources(tx: Prisma.TransactionClient, scope: SyncScope, actor: string, action: AmazonDataAction = "view") {
  const access = await explicitAmazonDataAccess(scope, actor, tx, action, true);
  return verifiedSources(tx, scope, sellerAccessWhere(access));
}
async function verifiedSources(tx: Prisma.TransactionClient, scope: SyncScope, allowed: ReturnType<typeof sellerAccessWhere>) {
  const identities = await tx.amazonSellerIdentity.findMany({ where: { ...scope, ...allowed }, take: 201 });
  if (identities.length > 200) throw new SyncInputError("数据源超过安全上限。", 403);
  const sources = await tx.amazonSyncDataSource.findMany({ where: { AND: [scope, allowed, { seller: { status: "active" }, authorization: { identityVerifiedAt: { not: null }, status: "CONFIGURED" }, OR: identities.map(i => ({ sellerAccountId: i.sellerAccountId, marketplaceId: i.marketplaceId, authorizationId: i.authorizationId, authorization: { amazonSellerId: i.amazonSellerId, awsRegion: i.region } })) }] }, include: { seller: { select: { displayName: true } }, authorization: { select: { amazonSellerId: true, awsRegion: true } }, publishedRun: { select: { status: true, executionVersion: true, resource: true, sourceId: true, finishedAt: true, stage: true } } }, take: 201 });
  if (sources.length > 200) throw new SyncInputError("数据源超过安全上限。", 403);
  return sources;
}
function dataMeta(sources: Array<{ lastSuccessAt: Date | null; freshnessMinutes: number }>, source: string, grain: string[], warnings: string[] = [], freshnessOverride?: string) {
  const now = Date.now(), dates = sources.map(item => item.lastSuccessAt).filter((value): value is Date => !!value);
  return {
    source, isSandbox: false, lastSyncAt: dates.length ? new Date(Math.min(...dates.map(value => value.getTime()))).toISOString() : null,
    freshness: freshnessOverride ?? (!dates.length ? "missing" : sources.some(item => !item.lastSuccessAt || now - item.lastSuccessAt.getTime() > item.freshnessMinutes * 60_000) ? "stale" : "ok"),
    grain, currency: null, attributionWindow: null, warnings,
    page: { page: 1, pageSize: sources.length, hasNext: false },
  };
}
export async function listMcpScopeOptions(scope: SyncScope, actor: string) {
  try { return (await explicitSources(prisma, scope, actor)).map(s => ({ sellerAccountId: s.sellerAccountId, marketplaceId: s.marketplaceId, displayName: s.seller.displayName })); }
  catch (e) { if (e instanceof SyncInputError && e.status === 403) return []; throw e; }
}
export async function listMcpSkillTableOptions(scope: SyncScope, actor: string) {
  try {
    const sources = await explicitSources(prisma, scope, actor);
    const tables = skillTableAvailability(sources).filter(table => table.name !== "ads_report_daily");
    const authorizedProfiles = sources.map(source => ({ sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId }));
    if (!authorizedProfiles.length) {
      tables.push({ name: "ads_report_daily", source: "AmazonAdsReportFact", grain: ["sellerAccountId", "marketplaceId", "reportType", "adProduct", "reportDate", "factKey", "versionId"], warnings: ["只展示完整成功任务的已发布版本。", "金额按行返回；不得跨币种汇总。", "Amazon 报表真实样本仍待核验。"], schemaStatus: "application_schema_confirmed_source_sample_pending", available: false, sourceCount: 0, rowCount: null, lastSyncAt: null, freshness: "missing" });
      return tables;
    }
    const pairs = authorizedProfiles.map(source => Prisma.sql`(p."sellerAccountId" = ${source.sellerAccountId} AND p."marketplaceId" = ${source.marketplaceId})`);
    const [adsAvailability] = await prisma.$queryRaw<Array<{ sourceCount: number; lastSyncAt: Date | null }>>(Prisma.sql`
      SELECT COUNT(DISTINCT v."profileId")::int AS "sourceCount", MAX(v."publishedAt") AS "lastSyncAt"
      FROM "AmazonAdsReportVersion" v
      JOIN "AmazonAdsSyncTask" t ON t."organizationId" = v."organizationId" AND t."workspaceId" = v."workspaceId" AND t.id = v."sourceTaskId"
      JOIN "AmazonAdsProfile" p ON p."organizationId" = v."organizationId" AND p."workspaceId" = v."workspaceId" AND p.id = v."profileId"
      JOIN "AmazonAdsAuthorization" a ON a.id = p."authorizationId" AND a."organizationId" = p."organizationId" AND a."workspaceId" = p."workspaceId"
      WHERE a.status = 'CONNECTED' AND v."publishedAt" IS NOT NULL AND v."organizationId" = ${scope.organizationId} AND v."workspaceId" = ${scope.workspaceId}
        AND v.status = 'PUBLISHED' AND t.status = 'SUCCEEDED' AND (${Prisma.join(pairs, " OR ")})`);
    const reportFreshnessRows = await prisma.$queryRaw<Array<{ profileId: string; lastPublishedAt: Date | null; intervalMinutes: number | null }>>(Prisma.sql`
      SELECT p.id AS "profileId", MAX(CASE WHEN t.id IS NOT NULL THEN v."publishedAt" END) AS "lastPublishedAt", MAX(plan."intervalMinutes")::int AS "intervalMinutes"
      FROM "AmazonAdsProfile" p
      JOIN "AmazonAdsAuthorization" a ON a.id = p."authorizationId" AND a."organizationId" = p."organizationId" AND a."workspaceId" = p."workspaceId"
      LEFT JOIN "AmazonAdsSyncPlan" plan ON plan."organizationId" = p."organizationId" AND plan."workspaceId" = p."workspaceId" AND plan."profileId" = p.id
      LEFT JOIN "AmazonAdsReportVersion" v ON v."organizationId" = p."organizationId" AND v."workspaceId" = p."workspaceId" AND v."profileId" = p.id AND v.status = 'PUBLISHED' AND v."publishedAt" IS NOT NULL
      LEFT JOIN "AmazonAdsSyncTask" t ON t."organizationId" = v."organizationId" AND t."workspaceId" = v."workspaceId" AND t.id = v."sourceTaskId" AND t.status = 'SUCCEEDED'
      WHERE p."organizationId" = ${scope.organizationId} AND p."workspaceId" = ${scope.workspaceId} AND a.status = 'CONNECTED' AND (${Prisma.join(pairs, " OR ")})
      GROUP BY p.id`);
    const now = Date.now();
    const reportFreshness = reportFreshnessRows.length && reportFreshnessRows.some(row => row.lastPublishedAt)
      ? reportFreshnessRows.every(row => row.lastPublishedAt && (!row.intervalMinutes || now - row.lastPublishedAt.getTime() <= row.intervalMinutes * 2 * 60_000)) ? "ok" : "stale"
      : "missing";
    tables.push({ name: "ads_report_daily", source: "AmazonAdsReportFact", grain: ["sellerAccountId", "marketplaceId", "reportType", "adProduct", "reportDate", "factKey", "versionId"], warnings: ["只展示完整成功任务的已发布版本。", "金额按行返回；不得跨币种汇总。", "Amazon 报表真实样本仍待核验。"], schemaStatus: "application_schema_confirmed_source_sample_pending", available: (adsAvailability?.sourceCount ?? 0) > 0, sourceCount: adsAvailability?.sourceCount ?? 0, rowCount: null, lastSyncAt: adsAvailability?.lastSyncAt?.toISOString() ?? null, freshness: reportFreshness });
    return tables;
  }
  catch (e) { if (e instanceof SyncInputError && e.status === 403) return skillTableAvailability([]).map(table => table.name === "ads_report_daily" ? { ...table, schemaStatus: "application_schema_confirmed_source_sample_pending", rowCount: null, warnings: ["只展示完整成功任务的已发布版本。", "金额按行返回；不得跨币种汇总。", "Amazon 报表真实样本仍待核验。"] } : table); throw e; }
}

function safeCallLogMetadata(value: Prisma.JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const row = value as Record<string, Prisma.JsonValue | undefined>;
  const result: Record<string, unknown> = {};
  for (const key of ["requestId", "tool", "toolVersion", "gatewayStatus", "failureClass", "durationMs", "reason", "matchedCount", "returnedCount", "source", "page", "pageSize", "table", "resource", "from", "to", "sourceVersionIds"] as const) {
    if (row[key] !== undefined) result[key] = row[key];
  }
  if (row.querySummary && typeof row.querySummary === "object" && !Array.isArray(row.querySummary)) result.querySummary = row.querySummary;
  return result;
}

/**
 * Server-backed status used by the Skill/ERP settings page. It intentionally
 * reports only the current user's authorized Ads bindings and redacted MCP
 * audit summaries; credentials, raw payloads and encrypted fields never leave
 * the server.
 */
export type McpCallLogStatus = "SUCCEEDED" | "DENIED";
export const mcpCallLogFailureClasses = ["ACCESS_DENIED", "VALIDATION", "SCHEMA_VALIDATION", "OUTPUT_SCHEMA", "TIMEOUT", "CANCELLED", "INVALID_GATEWAY_CONFIG", "EXECUTION_FAILED"] as const;
export type McpSettingsSnapshotOptions = {
  callLogPage?: number; callLogPageSize?: number; callLogStatus?: McpCallLogStatus; callLogTool?: string; callLogFailureClass?: typeof mcpCallLogFailureClasses[number];
  /** Server-resolved MCP pairs only; never accept as an authorization grant. */
  sourceFence?: Array<{ sellerAccountId: string; marketplaceId: string }>;
  omitCallLogs?: boolean;
};

export async function getMcpSettingsSnapshot(scope: SyncScope, actor: string, options: McpSettingsSnapshotOptions = {}) {
  try {
    const callLogPage = options.callLogPage ?? 1;
    const callLogPageSize = options.callLogPageSize ?? 20;
    if (!Number.isInteger(callLogPage) || callLogPage < 1 || callLogPage > 10000 || !Number.isInteger(callLogPageSize) || callLogPageSize < 1 || callLogPageSize > 100) throw new SyncInputError("MCP 调用记录分页参数无效。", 400);
    if (options.callLogTool && (options.callLogTool.length > 120 || !amazonMcpTools.some(([name]) => name === options.callLogTool))) throw new SyncInputError("MCP 调用工具筛选无效。", 400);
    if (options.callLogFailureClass && !mcpCallLogFailureClasses.includes(options.callLogFailureClass)) throw new SyncInputError("MCP 调用失败分类筛选无效。", 400);
    const callLogWhere: Prisma.AuditLogWhereInput = {
      organizationId: scope.organizationId,
      userId: actor,
      action: options.callLogStatus ? `amazon.mcp.tool.${options.callLogStatus === "SUCCEEDED" ? "succeeded" : "denied"}` : { in: ["amazon.mcp.tool.succeeded", "amazon.mcp.tool.denied"] },
      AND: [
        { metadata: { path: ["workspaceId"], equals: scope.workspaceId } },
        ...(options.callLogTool ? [{ metadata: { path: ["tool"], equals: options.callLogTool } }] : []),
        ...(options.callLogFailureClass ? [{ metadata: { path: ["failureClass"], equals: options.callLogFailureClass } }] : []),
      ],
    };
    const access = await explicitAmazonDataAccess(scope, actor, prisma, "view", true);
    const allowed = sellerAccessWhere(access);
    const sellers = await prisma.sellerAccount.findMany({ where: { ...scope, status: "active" }, select: { id: true } });
    const profiles = await prisma.amazonAdsProfile.findMany({
      where: { AND: [scope, allowed, { sellerAccountId: { in: sellers.map(seller => seller.id) } }, ...(options.sourceFence ? [{ OR: options.sourceFence }] : [])] },
      orderBy: { updatedAt: "desc" }, take: 500,
      select: { id: true, profileId: true, sellerAccountId: true, marketplaceId: true, currencyCode: true, timezone: true, region: true, authorizationId: true, authorization: { select: { name: true, status: true, lastValidatedAt: true, validationErrorCode: true } } },
    });
    const profileIds = profiles.map(profile => profile.id);
    const connectedProfileIds = profiles.filter(profile => profile.authorization.status === "CONNECTED" && profile.sellerAccountId).map(profile => profile.id);
    const [plans, states, versions, callLogTotal, logs] = await Promise.all([
      prisma.amazonAdsSyncPlan.findMany({ where: { ...scope, profileId: { in: profileIds } }, select: { profileId: true, status: true, intervalMinutes: true, reportLookbackDays: true, attributionLagDays: true, lastSuccessAt: true, lastErrorCode: true } }),
      prisma.amazonAdsSyncDomainState.findMany({ where: { ...scope, profileId: { in: profileIds } }, orderBy: [{ profileId: "asc" }, { dataDomain: "asc" }], select: { profileId: true, dataDomain: true, reportType: true, status: true, coveredFrom: true, coveredTo: true, lastAttemptAt: true, lastSuccessAt: true, lastTaskId: true, warningCodes: true } }),
      prisma.amazonAdsReportVersion.findMany({
        where: { ...scope, profileId: { in: connectedProfileIds }, status: "PUBLISHED", publishedAt: { not: null }, sourceTask: { status: "SUCCEEDED" } },
        orderBy: [{ publishedAt: "desc" }, { id: "desc" }], take: 100,
        select: { id: true, profileId: true, sourceTaskId: true, status: true, requestedFrom: true, requestedTo: true, rowCount: true, publishedAt: true, sourceTask: { select: { status: true, finishedAt: true, errorCode: true } }, profile: { select: { profileId: true, sellerAccountId: true, marketplaceId: true, currencyCode: true, timezone: true } }, requests: { orderBy: { createdAt: "desc" }, take: 1, select: { reportType: true, adProduct: true, apiVersion: true, status: true, requestedFrom: true, requestedTo: true, completedAt: true, warningCodes: true } } },
      }),
      options.omitCallLogs ? Promise.resolve(0) : prisma.auditLog.count({ where: callLogWhere }),
      options.omitCallLogs ? Promise.resolve([]) : prisma.auditLog.findMany({ where: callLogWhere, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (callLogPage - 1) * callLogPageSize, take: callLogPageSize, select: { id: true, action: true, createdAt: true, metadata: true } }),
    ]);
    const profilePlan = new Map(plans.map(plan => [plan.profileId, plan]));
    const now = Date.now();
    const latestPublishedAt = versions.map(version => version.publishedAt).filter((value): value is Date => !!value).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const latestPlan = profiles.map(profile => profilePlan.get(profile.id)).find(plan => plan?.intervalMinutes);
    const freshness = !latestPublishedAt ? "missing" : latestPlan && now - latestPublishedAt.getTime() <= latestPlan.intervalMinutes * 2 * 60_000 ? "ok" : "stale";
    return {
      ads: {
        connectionStatus: connectedProfileIds.length ? "CONNECTED" : profiles.length ? "DISCONNECTED_OR_UNBOUND" : "NOT_CONFIGURED",
        oauthConfigured: Boolean(process.env.AMAZON_ADS_LWA_CLIENT_ID?.trim() && process.env.AMAZON_ADS_LWA_CLIENT_SECRET?.trim() && process.env.AMAZON_ADS_OAUTH_REDIRECT_URI?.trim()),
        syncEnabled: adsScopeEnabled(scope),
        structureAdapterReady: adsReadAdapterReady(),
        reportAdapterReady: adsReadAdapterReady(["reports"]),
        profileCount: profiles.length,
        connectedProfileCount: connectedProfileIds.length,
        profiles: profiles.map(profile => ({ profileRecordId: profile.id, amazonProfileId: profile.profileId, sellerAccountId: profile.sellerAccountId, marketplaceId: profile.marketplaceId, currencyCode: profile.currencyCode, timezone: profile.timezone, region: profile.region, authorizationId: profile.authorizationId, authorizationName: profile.authorization.name, authorizationStatus: profile.authorization.status, lastValidatedAt: profile.authorization.lastValidatedAt, validationErrorCode: profile.authorization.validationErrorCode, plan: profilePlan.get(profile.id) ?? null })),
        schemaStatus: "application_schema_confirmed_source_sample_pending",
        dataIntegrity: versions.length ? "PUBLISHED_VERSION_FACTS_ONLY" : "NO_PUBLISHED_VERSION",
        freshness,
        lastPublishedAt: latestPublishedAt,
        freshnessStates: states,
      },
      publishedVersions: versions.map(version => ({ versionId: version.id, profileRecordId: version.profileId, amazonProfileId: version.profile.profileId, sellerAccountId: version.profile.sellerAccountId, marketplaceId: version.profile.marketplaceId, currencyCode: version.profile.currencyCode, timezone: version.profile.timezone, sourceTaskId: version.sourceTaskId, taskStatus: version.sourceTask.status, taskFinishedAt: version.sourceTask.finishedAt, taskErrorCode: version.sourceTask.errorCode, status: version.status, rowCount: version.rowCount, requestedFrom: version.requestedFrom, requestedTo: version.requestedTo, publishedAt: version.publishedAt, request: version.requests[0] ?? null })),
      callLogs: logs.map(log => ({ id: log.id, status: log.action.endsWith("succeeded") ? "SUCCEEDED" : "DENIED", createdAt: log.createdAt, ...safeCallLogMetadata(log.metadata) })),
      callLogPagination: { page: callLogPage, pageSize: callLogPageSize, total: callLogTotal, pageCount: Math.ceil(callLogTotal / callLogPageSize), hasMore: callLogPage * callLogPageSize < callLogTotal },
      callLogFilters: { status: options.callLogStatus ?? null, tool: options.callLogTool ?? null, failureClass: options.callLogFailureClass ?? null },
    };
  } catch (error) {
    if (error instanceof SyncInputError && error.status === 403) return { ads: { connectionStatus: "NOT_AUTHORIZED", oauthConfigured: false, syncEnabled: false, structureAdapterReady: false, reportAdapterReady: false, profileCount: 0, connectedProfileCount: 0, profiles: [], schemaStatus: "NOT_AUTHORIZED", dataIntegrity: "UNAVAILABLE", freshness: "missing", lastPublishedAt: null, freshnessStates: [] }, publishedVersions: [], callLogs: [] };
    throw error;
  }
}
async function hasPublishedAdsReports(scope: SyncScope, sources: Array<{ sellerAccountId: string; marketplaceId: string }>) {
  const authorizedProfiles = sources.map(source => ({ sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId }));
  return authorizedProfiles.length > 0 && !!await prisma.amazonAdsReportVersion.findFirst({ where: { ...scope, status: "PUBLISHED", publishedAt: { not: null }, sourceTask: { status: "SUCCEEDED" }, profile: { ...scope, authorization: { status: "CONNECTED" }, OR: authorizedProfiles } }, select: { id: true } });
}
export async function listMcpCredentials(scope: SyncScope, actor: string) {
  return prisma.amazonMcpCredential.findMany({ where: { ...scope, userId: actor }, select: credentialSelect, orderBy: { createdAt: "desc" }, take: 100 });
}
/** A credential can only reduce already-explicit ERP grants; admin never implies MCP access. */
export async function manageMcpCredential(scope: SyncScope, actor: string, command: Record<string, unknown>) {
  return prisma.$transaction(async tx => {
    const userId = command.userId === undefined ? actor : requiredText(command.userId, "成员");
    if (userId !== actor) await assertAmazonScopeAdmin(scope, actor, tx);
    const action = requiredText(command.action, "操作");
    const prior = command.id ? await tx.amazonMcpCredential.findFirst({ where: { ...scope, userId, id: requiredText(command.id, "凭证") } }) : null;
    if (action !== "create" && (!prior || prior.revision !== command.revision)) throw new SyncInputError("凭证不可访问或版本已变化。", 409);
    if ((action === "disable" && prior?.status !== "ACTIVE") || (action === "revoke" && prior?.status === "REVOKED")) throw new SyncInputError("凭证状态已变化。", 409);
    if (action === "disable" || action === "revoke") {
      const row = await tx.amazonMcpCredential.update({ where: { id: prior!.id, revision: prior!.revision }, data: { status: action === "disable" ? "DISABLED" : "REVOKED", revision: { increment: 1 } }, select: credentialSelect });
      await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: `amazon.mcp.credential.${action}`, entityType: "AmazonMcpCredential", entityId: row.id, metadata: { workspaceId: scope.workspaceId, subjectUserId: userId } } });
      return { credential: row };
    }
    if (!["create", "rotate"].includes(action) || (action === "rotate" && prior?.status !== "ACTIVE")) throw new SyncInputError("操作不可用。");
    const rawScopes = action === "rotate" ? prior!.scopes : command.scopes ?? [];
    const scopes = Array.isArray(rawScopes) && !rawScopes.length ? [] : parseAccessScopes(rawScopes);
    const tools = action === "rotate" ? prior!.tools : command.tools ?? [];
    const credentialTools = [...amazonMcpTools, ...researchCredentialTools];
    if (!Array.isArray(tools) || tools.length > credentialTools.length || tools.some(t => !credentialTools.some(([name]) => name === t))) throw new SyncInputError("工具范围无效。");
    for (const tool of tools) if (typeof tool === "string" && isResearchTool(tool)) {
      await assertAmazonAction(scope, userId, "view", tx, liliToolModule(tool));
      await assertAmazonAction(scope, userId, researchToolActions[tool], tx, liliToolModule(tool));
    }
    const sources = await explicitSources(tx, scope, userId);
    if (scopes.some(s => s.marketplaceIds.some(m => !sources.some(source => source.sellerAccountId === s.sellerAccountId && source.marketplaceId === m)))) throw new SyncInputError("数据范围不可访问。", 403);
    const expiresAt = action === "rotate" ? prior!.expiresAt : new Date(String(command.expiresAt));
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date() || expiresAt.getTime() > Date.now() + 90 * 86400000) throw new SyncInputError("有效期须在未来 90 天内。");
    const token = `amcp_${randomBytes(32).toString("base64url")}`;
    if (prior) await tx.amazonMcpCredential.update({ where: { id: prior.id, revision: prior.revision }, data: { status: "REVOKED", revision: { increment: 1 } } });
    const row = await tx.amazonMcpCredential.create({ data: { id: randomUUID(), ...scope, userId, name: action === "rotate" ? prior!.name : requiredText(command.name, "名称", 100), tokenHash: mcpTokenHash(token), tokenPrefix: token.slice(0, 12), tools: [...new Set(tools)] as string[], scopes, expiresAt, createdByUserId: actor, rotatedFromId: prior?.name.startsWith("Lili device: ") ? prior.rotatedFromId : prior?.id }, select: credentialSelect });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: `amazon.mcp.credential.${action}`, entityType: "AmazonMcpCredential", entityId: row.id, metadata: { workspaceId: scope.workspaceId, subjectUserId: userId, scopes, tools: row.tools } } });
    return { credential: row, token };
  });
}

export async function authenticateAmazonMcp(authorization: string | null, resource?: string) {
  const token = authorization?.match(/^Bearer (amcp_[A-Za-z0-9_-]{43})$/)?.[1];
  const row = token ? await prisma.amazonMcpCredential.findUnique({ where: { tokenHash: mcpTokenHash(token) } }) : null;
  if (row) {
    const oauth = await prisma.liliOAuthGrant.findUnique({ where: { deviceId: row.id } });
    if (oauth && (oauth.revokedAt || oauth.expiresAt <= new Date() || resource && resource !== oauth.resource)) throw new SyncInputError("认证失败。", 401);
  }
  const validated = await validateAmazonMcpCredential(row);
  return { ...validated, tools: await accountToolsForLili(validated) };
}
/** Server-only validation shared by OAuth refresh; never accepts client identity fields. */
export async function validateAmazonMcpCredential(row: Awaited<ReturnType<typeof prisma.amazonMcpCredential.findUnique>>, allowExpired = false) {
  if (!row || row.status !== "ACTIVE" || (!allowExpired && row.expiresAt <= new Date())) {
    await audit(null, null, "amazon.mcp.authentication.denied", { requestId: randomUUID(), reason: "INVALID_CREDENTIAL" });
    throw new SyncInputError("认证失败。", 401);
  }
  if (row.name.startsWith("Lili device: ")) {
    let parentId = row.rotatedFromId;
    const seen = new Set([row.id]);
    while (parentId) {
      if (seen.has(parentId) || seen.size > 20) throw new SyncInputError("认证失败。", 401);
      seen.add(parentId);
      const parent = await prisma.amazonMcpCredential.findFirst({ where: { id: parentId, organizationId: row.organizationId, workspaceId: row.workspaceId, userId: row.userId, status: "ACTIVE", expiresAt: { gt: new Date() } } });
      if (!parent) throw new SyncInputError("认证失败。", 401);
      parentId = parent.name.startsWith("Lili device: ") ? parent.rotatedFromId : null;
    }
  }
  try { await explicitAmazonDataAccess({ organizationId: row.organizationId, workspaceId: row.workspaceId }, row.userId, prisma, "view", true); }
  catch { await audit(row, row.userId, "amazon.mcp.authentication.denied", { requestId: randomUUID(), credentialId: row.id, reason: "CURRENT_ACCESS_DENIED" }); throw new SyncInputError("认证失败。", 401); }
  return row;
}
type McpIdentity = Awaited<ReturnType<typeof authenticateAmazonMcp>>;
const sessionIdentities = new WeakSet<object>();
const boundaryCredentialId = (identity: McpIdentity) => sessionIdentities.has(identity) ? undefined : identity.id;

/** Called only from authenticated ERP handlers. Never persisted or accepted from JSON. */
export async function createErpSessionAmazonMcpIdentity(scope: SyncScope & { userId: string }): Promise<McpIdentity> {
  await explicitAmazonDataAccess(scope, scope.userId, prisma);
  const now = new Date();
  const identity: McpIdentity = { ...scope, id: `erp-session:${scope.userId}`, name: "ERP session", tools: [...amazonAccountReadTools], scopes: [],
    status: "ACTIVE", revision: 0, expiresAt: new Date(now.getTime() + 3600_000), createdAt: now, updatedAt: now,
    createdByUserId: scope.userId, rotatedFromId: null, lastUsedAt: null, tokenHash: "", tokenPrefix: "" };
  sessionIdentities.add(identity);
  return identity;
}
async function liveMcpCredential(identity: McpIdentity) {
  if (sessionIdentities.has(identity)) {
    await explicitAmazonDataAccess(identity, identity.userId, prisma);
    return identity;
  }
  return prisma.amazonMcpCredential.findFirst({ where: { organizationId: identity.organizationId, workspaceId: identity.workspaceId,
    id: identity.id, userId: identity.userId, status: "ACTIVE", expiresAt: { gt: new Date() } },
    select: { id: true, name: true, tools: true, scopes: true, revision: true, expiresAt: true } });
}
export async function auditAmazonMcpProtocol(identity: McpIdentity, method: string, requestId: string) {
  await audit(identity, identity.userId, "amazon.mcp.protocol", { credentialId: identity.id, requestId, method: ["initialize", "notifications/initialized", "ping", "tools/list"].includes(method) ? method : "UNKNOWN" });
}
function argumentsObject(value: unknown, tool?: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyncInputError("参数无效。");
  const args = value as Record<string, unknown>;
  assertAmazonMcpScope(tool ?? "", args);
  for (const key of ["sellerAccountId", "marketplaceId"]) if (args[key] !== undefined && (typeof args[key] !== "string" || !String(args[key]).trim())) throw new SyncInputError("数据范围不可访问。", 403);
  if (args.sellerAccountId !== undefined && args.sellerAccountIds !== undefined) throw new SyncInputError("参数无效。");
  const definition = registeredAmazonMcpTools.find(item => item.name === tool);
  const usesDataset = !!fixedAmazonMcpDataset(tool ?? "") || ["amazon.data.archive.read", "amazon.fields.coverage", "amazon.fields.catalog", "data_query", "data_describe_table", "amazon.ads.reports.list", "amazon.ads.entities.list"].includes(tool ?? "");
  const allowed = usesDataset ? Object.keys(definition?.inputSchema.properties ?? {}) : ["sellerAccountId", "sellerAccountIds", "marketplaceId", "from", "to", "keyword", "page", "pageSize", "taskId", "table", "filters", "resource", "dateFrom", "dateTo", "eventType"];
  if (Object.keys(args).some(k => !allowed.includes(k))) throw new SyncInputError("FIELD_NOT_MAPPED: 参数不属于此工具的输入合同。", 400);
  for (const [k, v] of Object.entries(args)) {
    if (k === "sellerAccountIds") continue;
    if (k === "filters") {
      if (!v || typeof v !== "object" || Array.isArray(v) || Object.entries(v).some(([field, filter]) => !/^[A-Za-z][A-Za-z0-9.]{0,80}$/.test(field) || typeof filter !== "string" || filter.length > 200)) throw new SyncInputError("筛选条件无效。");
      continue;
    }
    if (k === "page" && typeof v === "number" && Number.isInteger(v)) continue;
    if (tool === "amazon.data.archive.read" && k === "rawPage" && typeof v === "number" && Number.isInteger(v)) continue;
    if (tool === "amazon.data.archive.read" && k === "pointer" && typeof v === "string" && v.length <= 2048) continue;
    if (k === "pageSize" && typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 1000) continue;
    if (typeof v !== "string" || v.length > 200) throw new SyncInputError("参数无效。");
  }
  if (args.sellerAccountIds !== undefined && (!Array.isArray(args.sellerAccountIds) || !args.sellerAccountIds.length || args.sellerAccountIds.length > 200 || args.sellerAccountIds.some(v => typeof v !== "string" || !v || v.length > 200))) throw new SyncInputError("参数无效。");
  return args;
}
async function invokeRegisteredAmazonMcp(identity: McpIdentity, tool: AmazonMcpToolName, raw: unknown, requestId: string = randomUUID(), signal?: AbortSignal): Promise<unknown> {
  const startedAt = Date.now();
  const scope = { organizationId: identity.organizationId, workspaceId: identity.workspaceId }, actor = identity.userId;
  const definition = registeredAmazonMcpTools.find(item => item.name === tool)!;
  const action: AmazonDataAction = definition.action;
  let requested: AmazonAccessScope[] = [];
  try {
    if (sessionIdentities.has(identity) && !amazonAccountReadTools.includes(tool)) throw new SyncInputError("会话数据接口只允许读取。", 403);
    if (!await credentialAllowsTool(identity, tool) || !amazonMcpTools.some(([name]) => name === tool)) throw new SyncInputError("工具不可访问。", 403);
    const args = argumentsObject(raw, canonicalMcpTool(tool));
    if (["promotions_get", "promotions_get_items"].includes(tool) && (typeof args.promotionId !== "string" || !args.promotionId.trim())) throw new SyncInputError("必须指定 promotionId。", 422);
    return await withAmazonMcpBoundary({ ...scope, userId: actor, credentialId: boundaryCredentialId(identity), tool, action }, async () => {
      if (signal?.aborted) throw new GatewayInvocationError("CANCELLED", "Tool execution was cancelled.");
      const adsRead = tool.startsWith("amazon.ads.") || tool.startsWith("ads_")
        || ["data_query", "data_describe_table"].includes(tool) && resolveMcpDataset(args).module === "amazon_ads";
      const catalogRead = tool === "data_list_tables";
      const financeRead = tool === "finance_get_transactions" || ["data_query", "data_describe_table"].includes(tool) && resolveMcpDataset(args).resource === "finance";
      const resolve = async () => {
        const access = args.sellerAccountId && definition.operationMode === "READ_ONLY" && !catalogRead
          ? adsRead
            ? await amazonAdsAccountReadAccess(scope, actor, { sellerAccountId: String(args.sellerAccountId), marketplaceId: String(args.marketplaceId) })
            : await amazonAccountReadAccess(scope, actor, new URLSearchParams({ sellerAccountId: String(args.sellerAccountId), ...(args.marketplaceId ? { marketplaceId: String(args.marketplaceId) } : {}) }), prisma, financeRead ? "finance" : undefined)
          : await amazonDataAccess(scope, actor);
        if (args.sellerAccountId && !access.allSellers && !access.sellerIds.includes(String(args.sellerAccountId))) throw new SyncInputError("Amazon 账号未分配给当前用户。", 403);
        return verifiedSources(prisma, scope, sellerAccessWhere(access));
      };
      const requiredDatasetTools = new Set<string>();
      const canReadTool = async (name: string) => {
        const live = await liveMcpCredential(identity);
        return !!live && await credentialAllowsTool(live, name);
      };
      const requireDatasetTool = async (name: string) => {
        if (!await canReadTool(name)) throw new SyncInputError(name === "amazon.ads.reports.list" ? "Ads 报表工具未授权，数据不可访问。" : "Ads 结构工具未授权，数据不可访问。", 403);
        requiredDatasetTools.add(name);
      };
      const requireAdsReports = () => requireDatasetTool("amazon.ads.reports.list");
      const sources = await resolve();
      const sellers = args.sellerAccountIds as string[] | undefined ?? (args.sellerAccountId ? [String(args.sellerAccountId)] : undefined);
      if (!adsRead && !catalogRead && !financeRead && (sellers?.some(id => !sources.some(s => s.sellerAccountId === id)) || (args.marketplaceId && !sources.some(s => s.marketplaceId === args.marketplaceId && (!sellers || sellers.includes(s.sellerAccountId)))))) throw new SyncInputError("数据范围不可访问。", 403);
      if (!adsRead && !catalogRead && !financeRead && args.marketplaceId && sellers?.some(id => !sources.some(s => s.sellerAccountId === id && s.marketplaceId === args.marketplaceId))) throw new SyncInputError("数据范围不可访问。", 403);
      const selected = sources.filter(s => (!sellers || sellers.includes(s.sellerAccountId)) && (!args.marketplaceId || s.marketplaceId === args.marketplaceId));
      if (!adsRead && !catalogRead && !financeRead && !selected.length) throw new SyncInputError("数据范围不可访问。", 403);
      // A finance source's site is an administrative anchor, not the site of
      // its attributed rows. Reads inherit the account grant, without requiring
      // another data-domain source at the requested site.
      const resolveFinanceProjection = async () => {
        await assertAmazonFinanceAccess(scope, actor);
        await amazonAccountReadAccess(scope, actor, new URLSearchParams({ sellerAccountId: String(args.sellerAccountId) }), prisma, "finance");
        const anchors = await prisma.amazonSyncDataSource.findMany({
          where: { ...scope, resource: "finance", sellerAccountId: String(args.sellerAccountId), authorization: { status: "CONFIGURED", identityVerifiedAt: { not: null } } },
          include: { seller: { select: { displayName: true } }, authorization: { select: { amazonSellerId: true, awsRegion: true } }, publishedRun: { select: { status: true, executionVersion: true, resource: true, sourceId: true, finishedAt: true, stage: true } } }, take: 201,
        });
        if (anchors.length > 200) throw new SyncInputError("财务来源超过安全上限。", 403);
        // Collection approval governs future Amazon calls, not reads of facts
        // already attributed to this account and verified site.
        return anchors.map(source => ({ ...source, marketplaceId: String(args.marketplaceId) }));
      };
      let financeProjection: typeof selected | undefined;
      requested = selected.map(s => ({ sellerAccountId: s.sellerAccountId, marketplaceIds: [s.marketplaceId] }));
      const page = args.page === undefined ? 1 : Number(args.page);
      if (!Number.isInteger(page) || page < 1 || page > 10000) throw new SyncInputError("分页无效。");
      let normalizedQuery: ReturnType<typeof normalizeDatasetQuery> | undefined;
      const readEntities = async (queryArgs: Record<string, unknown>) => {
        if (queryArgs.entityType !== undefined && !(adsEntityTypes as readonly string[]).includes(String(queryArgs.entityType))) throw new SyncInputError("Ads 实体类型无效。");
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(queryArgs)) if (!["sellerAccountIds", "marketplaceId"].includes(key)) params.set(key, String(value));
        const data = await queryAdsEntities(scope, actor, params, [{ sellerAccountId: String(args.sellerAccountId), marketplaceId: String(args.marketplaceId) }]);
        // Recheck Ads bindings outside the read snapshot before releasing any rows or metadata.
        const bindings = new Map(data.meta.profiles.map(profile => [profile.id, { id: profile.id, profileId: profile.amazonProfileId, authorizationId: profile.authorizationId, sellerAccountId: profile.sellerAccountId, marketplaceId: profile.marketplaceId }]));
        for (const row of data.rows) bindings.set(row.internalProfileId, { id: row.internalProfileId, profileId: row.amazonProfileId, authorizationId: row.profile.authorizationId, sellerAccountId: row.profile.sellerAccountId, marketplaceId: row.profile.marketplaceId });
        if (bindings.size && await prisma.amazonAdsProfile.count({ where: { ...scope, authorization: { status: "CONNECTED" }, OR: [...bindings.values()] } }) !== bindings.size) throw new SyncInputError("数据范围不可访问。", 403);
        return {
          data: { items: data.rows.map(row => ({
            entityType: row.entityType, externalId: row.externalId, parentExternalId: row.parentExternalId,
            internalProfileId: row.internalProfileId, amazonProfileId: row.amazonProfileId,
            sellerAccountId: row.profile.sellerAccountId, marketplaceId: row.profile.marketplaceId,
            state: row.state, sourceUpdatedAt: row.sourceUpdatedAt, syncedAt: row.syncedAt,
            sourceTaskId: row.sourceTaskId, sourceTask: row.sourceTask, apiVersion: row.apiVersion,
            fields: adsEntityBusinessFields(row),
          })), total: data.total },
          meta: { ...data.meta, profiles: data.meta.profiles.map(({ authorization, ...profile }) => ({ ...profile, authorizationName: authorization.name, authorizationStatus: authorization.status })),
            page: { page: data.page, pageSize: data.pageSize, hasNext: data.page * data.pageSize < data.total },
            fieldDefinitions: { internalProfileId: "ERP Profile 主键，用于筛选", amazonProfileId: "Amazon 外部 Profile ID，不是 ERP 主键", externalId: "Amazon 实体 ID，须与 Profile 和 entityType 联合识别", parentExternalId: "直接父级 Amazon ID；Campaign 级否定项不属于 Ad Group", fields: "全部已采集业务结构字段；秘密已移除，精确十进制列优先", sourceUpdatedAt: "Amazon 上游更新时间，可能为空", syncedAt: "此行本地同步时间", sourceTask: "来源任务当前状态；部分失败任务的已提交行可能存在" },
            warnings: ["只读当前已观察的结构快照；缺失行不表示已删除，不保证历史版本。", "结构数据无报告日期维度，不提供业绩指标。", "bid/defaultBid/budget优先使用规范化十进制列；历史payload回退数值的采集精度未核验。"],
          },
        };
      };
      const readReports = async (queryArgs: Record<string, unknown>) => {
        await requireAdsReports();
        assertAdsQueryBudget(identity.id);
        const params = new URLSearchParams({ kind: "reports" });
        for (const [key, value] of Object.entries(queryArgs)) if (key !== "sellerAccountIds") params.set(key, String(value));
        const data = await queryPublishedAdsReports(scope, actor, parseAdsQuery(params), [{ sellerAccountId: String(args.sellerAccountId), marketplaceId: String(args.marketplaceId) }]);
        return presentMcpReport(data);
      };
      let result: unknown;
      if (tool === "amazon.data.archive.read") {
        const params = new URLSearchParams(Object.entries(args).map(([key, value]) => [key, String(value)]));
        result = await readArchivedBusinessData(scope, params, actor);
      } else if (tool === "amazon.fields.coverage") {
        const params = new URLSearchParams({ sourceId: String(args.sourceId ?? "") });
        for (const key of ["from", "to"] as const) if (args[key] !== undefined) params.set(key, String(args[key]));
        result = await readActualFieldCoverage(scope, params, actor, selected.map(source => source.id));
      } else if (tool === "amazon.fields.catalog") {
        result = await readFieldRegistry(scope, new URLSearchParams({ sourceId: String(args.sourceId ?? ""), page: String(args.page ?? 1) }), actor, selected.map(source => source.id));
      } else if (adsStatusTools.has(tool)) {
        const snapshot = await getMcpSettingsSnapshot(scope, actor, {
          sourceFence: selected.map(source => ({ sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId })),
          omitCallLogs: true,
        });
        const statusData = tool === "ads_get_connection_status"
          ? { connection: snapshot.ads }
          : tool === "ads_get_data_health"
            ? { health: { schemaStatus: snapshot.ads.schemaStatus, dataIntegrity: snapshot.ads.dataIntegrity, freshness: snapshot.ads.freshness, lastPublishedAt: snapshot.ads.lastPublishedAt, freshnessStates: snapshot.ads.freshnessStates } }
            : tool === "ads_get_sync_status"
              ? { sync: { enabled: snapshot.ads.syncEnabled, structureAdapterReady: snapshot.ads.structureAdapterReady, reportAdapterReady: snapshot.ads.reportAdapterReady, freshness: snapshot.ads.freshness, states: snapshot.ads.freshnessStates } }
              : snapshot;
        result = { data: statusData, total: 1, meta: { source: "ERP_AmazonAds_Settings", isDemo: false, isSandbox: false, dataIntegrity: snapshot.ads.dataIntegrity, schemaStatus: snapshot.ads.schemaStatus, page: { page: 1, pageSize: 1, hasNext: false } } };
      } else if (tool === "amazon.ads.reports.list") {
        normalizedQuery = normalizeDatasetQuery(datasetForTable("ads_report_daily"), { ...args, pageSize: args.pageSize ?? 50 });
        result = await readReports({ ...normalizedQuery.filters, page, pageSize: normalizedQuery.pageSize });
      } else if (tool === "amazon.ads.entities.list" || tool === "ads_list_entities" || tool === "ads_get_campaign_structure") {
        normalizedQuery = normalizeDatasetQuery(mcpDatasets.find(item => item.name === "ads_entities")!, args);
        if (tool === "ads_get_campaign_structure" && args.entityType !== undefined && args.entityType !== "SP:campaign") throw new McpDatasetError("FILTER_CONFLICT", "活动结构别名仅支持SP:campaign。");
        const { sortBy, sortDirection, ...filters } = normalizedQuery.filters;
        result = await readEntities({ ...filters, page, pageSize: normalizedQuery.pageSize, sort: sortBy, direction: sortDirection,
          ...(tool === "ads_get_campaign_structure" ? { entityType: "SP:campaign" } : {}) });
      } else if (tool === "data_list_tables") {
        const catalogSources = selected.filter(source => source.resource !== "finance");
        if (selected.length) catalogSources.push(...(financeProjection = await resolveFinanceProjection()));
        const tables = availableSkillTables(catalogSources);
        if (await canReadTool("amazon.ads.reports.list") && await hasPublishedAdsReports(scope, [{ sellerAccountId: String(args.sellerAccountId), marketplaceId: String(args.marketplaceId) }])) {
          tables.push(describeMcpDataset(datasetForTable("ads_report_daily")));
          requiredDatasetTools.add("amazon.ads.reports.list");
        }
        const datasets = tables.map(table => describeMcpDataset(datasetForTable(table.name)));
        if (await canReadTool("amazon.ads.entities.list")) {
          datasets.push(describeMcpDataset(mcpDatasets.find(item => item.name === "ads_entities")!));
          requiredDatasetTools.add("amazon.ads.entities.list");
        }
        const resources = new Set<string>(tables.filter(table => table.name !== "ads_report_daily").map(table => datasetForTable(table.name).resource));
        const tableSources = catalogSources.filter(source => resources.has(source.resource));
        const liveCredential = await liveMcpCredential(identity);
        const executableTools = liveCredential ? (await accountToolsForLili(liveCredential)).filter(name => registeredAmazonMcpTools.some(tool => tool.name === name)) : [];
        const availability = skillTableAvailability(catalogSources);
        result = { data: { items: tables, total: tables.length, datasets,
          skillReadiness: skillReadiness(availability, executableTools),
          skillReadinessBasis: "CATALOG_DIAGNOSTIC_ONLY; FIELD_VALUES_AND_DATE_COVERAGE_NOT_CHECKED" },
          meta: dataMeta(tableSources, "AmazonSyncDataSource", ["sellerAccountId", "marketplaceId", "resource"]) };
      } else if (tool === "reimbursement_analyze") {
        const from = requiredText(args.from, "开始日期", 10), to = requiredText(args.to, "结束日期", 10);
        const readPathTools = ["reimbursement_get_events", "reimbursement_get_payments", "finance_get_transactions", "data_query"] as const;
        const readableTools = (await Promise.all(readPathTools.map(async name => await canReadTool(name) ? name : null))).filter((name): name is typeof readPathTools[number] => name !== null);
        if (!hasReimbursementAnalysisReadPath(readableTools)) throw new SyncInputError("赔付分析需要完整授权事件、赔付和财务读取工具，或授权 data_query。", 403);
        const tables = ["inventory_events", "reimbursements", "finance_transactions"] as const;
        requested = selected.filter(source => tables.some(table => datasetForTable(table).resource === source.resource))
          .map(source => ({ sellerAccountId: source.sellerAccountId, marketplaceIds: [source.marketplaceId] }));
        const readAllPages = async (tableName: typeof tables[number]) => {
          const dataset = datasetForTable(tableName), normalized = normalizeDatasetQuery(dataset, { from, to, page: 1, pageSize: 50 });
          const pages: Array<{ records: Array<Record<string, unknown>>; total: number; page: number; pageCount: number; hasMore: boolean; coverageStatus: string }> = [];
          const maximumPages = 20;
          try {
            const querySources = tableName === "finance_transactions"
              ? (financeProjection = await resolveFinanceProjection())
              : selected;
            for (let currentPage = 1; currentPage <= maximumPages; currentPage++) {
              const response = await querySkillTable({ scope, actor, sources: querySources, tableName, sellerAccountId: String(args.sellerAccountId), marketplaceId: String(args.marketplaceId), filters: normalized.filters, page: currentPage, pageSize: 50 });
              const metadata = response.meta as Record<string, unknown>;
              const reportCoverage = metadata.reportCoverage as { coverageStatus?: string } | undefined;
              const pageMeta = metadata.page as { hasNext?: boolean } | undefined;
              const sourceRefs = Array.isArray(metadata.sources) ? metadata.sources as Array<Record<string, unknown>> : [];
              const records = (response.data.items as Array<Record<string, unknown>>).map(row => {
                const document = row.document && typeof row.document === "object" ? row.document as Record<string, unknown> : null;
                const source = sourceRefs.find(item => item.sourceId === row.sourceId)
                  ?? (sourceRefs.length === 1 ? sourceRefs[0] : null);
                const sourceId = typeof row.sourceId === "string" ? row.sourceId
                  : typeof source?.sourceId === "string" ? source.sourceId : undefined;
                const sourceRunId = typeof row.sourceRunId === "string" ? row.sourceRunId
                  : typeof document?.sourceRunId === "string" ? document.sourceRunId
                    : typeof source?.syncRunId === "string" ? source.syncRunId : undefined;
                const evidenceRefs = {
                  ...(sourceId ? { sourceId } : {}),
                  ...(sourceRunId ? { sourceRunId } : {}),
                  ...(typeof row.reportId === "string" ? { reportId: row.reportId } : {}),
                  ...(typeof row.rowNumber === "number" ? { rowNumber: row.rowNumber } : {}),
                  ...(typeof document?.id === "string" ? { reportDocumentId: document.id } : {}),
                  ...(typeof row.transactionId === "string" ? { transactionId: row.transactionId } : {}),
                };
                return { ...row, evidenceRefs };
              });
              const total = response.data.total, pageCount = Math.ceil(total / 50);
              pages.push({ records, total, page: currentPage, pageCount,
                hasMore: pageMeta?.hasNext ?? currentPage < pageCount,
                coverageStatus: reportCoverage?.coverageStatus ?? (metadata.freshness === "missing" ? "NOT_RETURNED" : "HISTORY_INCOMPLETE") });
              if (!pages[pages.length - 1].hasMore) return { pages };
            }
            return { pages, error: "PAGINATION_LIMIT_REACHED" };
          } catch (error) {
            const status = error instanceof SyncInputError && error.status === 403 ? "NOT_AUTHORIZED"
              : error instanceof McpDatasetError && error.businessCode === "DATASET_UNPUBLISHED" ? "NOT_REQUESTED" : "QUERY_FAILED";
            return { pages, error: status };
          }
        };
        const [events, payments, finance] = await Promise.all(tables.map(readAllPages));
        result = { data: { analysis: analyzeReimbursementRecovery({ events, payments, finance }) },
          source: "Amazon Reports GET_LEDGER_DETAIL_VIEW_DATA + GET_FBA_REIMBURSEMENTS_DATA + Finances v2024-06-19",
          dataRange: { from, to, basis: "REQUESTED_BOUNDS; per-dataset date semantics preserved" },
          dateSemantics: { inventory_events: "eventDate", reimbursements: "approvalDate", finance_transactions: "postedAt" },
          scope: { sellerAccountId: args.sellerAccountId, marketplaceId: args.marketplaceId }, pageLimitPerDataset: 20,
          warnings: ["该分析不推断事件与赔付关联；UNMATCHED/UNABLE_TO_CONFIRM 不代表未赔付。", "财务读取继承同一账号分配，并验证官方授权状态。"] };
      } else if (tool === "data_describe_table" || tool === "data_query" || fixedAmazonMcpDataset(tool)) {
        const fixedDataset = fixedAmazonMcpDataset(tool);
        const dataset = resolveMcpDataset(fixedDataset ? { ...args, table: fixedDataset } : args);
        const datasetSources = dataset.resource === "finance" ? (financeProjection = await resolveFinanceProjection()) : selected;
        if (dataset.name === "ads_report_daily") {
          await requireAdsReports();
          if (!await hasPublishedAdsReports(scope, [{ sellerAccountId: String(args.sellerAccountId), marketplaceId: String(args.marketplaceId) }])) throw new McpDatasetError("DATASET_UNPUBLISHED", "TABLE_NOT_ALLOWED: 当前授权范围没有该表的已发布数据源。", 403);
        }
        if (dataset.name === "ads_entities") await requireDatasetTool("amazon.ads.entities.list");
        if (tool === "data_describe_table") {
          const description = dataset.module === "amazon_ads" ? describeMcpDataset(dataset) : describeSkillTable(dataset.name, datasetSources);
          const relevant = dataset.module === "amazon_ads" ? datasetSources : datasetSources.filter(source => source.resource === dataset.resource);
          result = { data: { table: description }, meta: { ...dataMeta([], "Prisma application schema", description.grain, description.warnings, "schema"),
            requestId, toolVersion: registeredAmazonMcpTools.find(item => item.name === tool)!.version,
            dataset: { id: dataset.name, module: dataset.module, dataType: dataset.dataType, legacyTable: dataset.legacyTable },
            dateSemantics: dataset.dateSemantics, resultStatus: "DESCRIBED", dataAvailability: "NOT_CHECKED",
            scope: { pairs: [...new Map(relevant.map(source => [`${source.sellerAccountId}\0${source.marketplaceId}`, { sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId }])).values()] } } };
        } else {
          normalizedQuery = normalizeDatasetQuery(dataset, args);
          if (dataset.name === "ads_entities") {
            const { sortBy, sortDirection, ...filters } = normalizedQuery.filters;
            result = await readEntities({ ...filters, page, pageSize: normalizedQuery.pageSize, sort: sortBy, direction: sortDirection });
          } else if (dataset.name === "ads_report_daily") {
            result = await readReports({ ...normalizedQuery.filters, page, pageSize: normalizedQuery.pageSize });
          } else {
            requested = datasetSources.filter(source => source.resource === dataset.resource).map(source => ({ sellerAccountId: source.sellerAccountId, marketplaceIds: [source.marketplaceId] }));
            result = await querySkillTable({ scope, actor, sources: datasetSources, tableName: dataset.name,
              ...(args.sellerAccountId ? { sellerAccountId: String(args.sellerAccountId) } : {}),
              ...(args.marketplaceId ? { marketplaceId: String(args.marketplaceId) } : {}),
              filters: normalizedQuery.filters, page, pageSize: normalizedQuery.pageSize });
          }
        }
      } else if (tool === "data_sync_start") {
        const resource = requiredText(args.resource, "数据域", 100);
        const selectedSyncSources = selected.filter(source => source.resource === resource
          && (!sellers || sellers.includes(source.sellerAccountId)) && (!args.marketplaceId || source.marketplaceId === args.marketplaceId));
        if (!selectedSyncSources.length || selectedSyncSources.length > 20) throw new SyncInputError("数据域无可用授权数据源，或一次申请超过 20 个数据源。");
        for (const source of selectedSyncSources) assertSkillSyncSourcePublishable(source.resource, source.domainPolicy);
        const syncableResources = new Set<string>(amazonMcpSyncResources);
        if (!syncableResources.has(resource)) throw new SyncInputError("该数据域暂不支持通过 Skill 提交同步申请。");
        if (["fulfillment", "catalog_items", "listing_details"].includes(resource) && args.taskId === undefined) throw new SyncInputError("此数据域须指定原任务 taskId，从已有检查点恢复；不创建新的采集范围。");
        const hasDateFrom = typeof args.dateFrom === "string", hasDateTo = typeof args.dateTo === "string";
        if (hasDateFrom !== hasDateTo) throw new SyncInputError("日期范围必须同时提供 dateFrom 和 dateTo。");
        if ((hasDateFrom || hasDateTo) && !["sales_traffic", "reimbursements", "inventory_events"].includes(resource)) throw new SyncInputError("该数据域不支持在同步申请中指定日期范围。");
        if (resource === "inventory_events" && args.taskId === undefined && (!hasDateFrom || typeof args.eventType !== "string")) throw new SyncInputError("库存事件补采必须提供日期范围和 eventType。");
        if (resource !== "inventory_events" && args.eventType !== undefined) throw new SyncInputError("eventType 仅适用于库存事件补采。");
        requested = selectedSyncSources.map(source => ({ sellerAccountId: source.sellerAccountId, marketplaceIds: [source.marketplaceId] }));
        let command: Record<string, unknown> = { action: "run", sourceIds: selectedSyncSources.map(source => source.id), ...(args.dateFrom ? { dateFrom: args.dateFrom } : {}), ...(args.dateTo ? { dateTo: args.dateTo } : {}), ...(args.eventType !== undefined ? { eventType: args.eventType } : {}) };
        if (args.taskId !== undefined) {
          const task = await prisma.amazonSyncRun.findFirst({ where: { ...scope, id: String(args.taskId), resource, executionVersion: 2, sourceId: { in: selectedSyncSources.map(source => source.id) } }, select: { id: true, resource: true, status: true, stage: true } });
          command = skillSyncRetryCommand(resource, task, args);
        }
        const changeRequest = await requestChange(scope, actor, command);
        result = { data: { approvalRequired: true, started: false, changeRequest, message: "同步申请已提交，审批并应用前不会创建或执行同步任务。" }, meta: dataMeta(selectedSyncSources, "AmazonDataCenterChangeRequest", ["sellerAccountId", "marketplaceId", "resource"], [], "pending_approval") };
      } else {
        const published = selected.filter(s => s.activeRunId && s.publishedRun?.status === "SUCCEEDED" && s.publishedRun.finishedAt && s.publishedRun.stage !== "PURGED" && s.publishedRun.executionVersion === 2 && s.publishedRun.resource === s.resource && s.publishedRun.sourceId === s.id);
        const common = { ...scope, OR: published.filter(s => s.activeRunId).map(s => ({ sellerAccountId: s.sellerAccountId, marketplaceId: s.marketplaceId, syncRunId: s.activeRunId! })) };
        if (tool === "data_sync_status") {
          const states = await prisma.amazonSyncDataSource.findMany({ where: { ...scope, id: { in: selected.map(s => s.id) } }, select: { id: true, coverage: true, runs: { where: { executionVersion: 2 }, orderBy: [{ startedAt: "desc" }, { id: "desc" }], take: 1, select: { id: true, status: true, stage: true, processedCount: true, pagesCompleted: true, nextAttemptAt: true, attempts: true, maxAttempts: true, apiRequests: true, throttles: true, insertedCount: true, updatedCount: true, failedCount: true, detailsCompletedCount: true, executionStartedAt: true, finishedAt: true } }, targets: { where: { schedule: { enabled: true } }, select: { schedule: { select: { nextRunAt: true } } } } } });
          const orderRecovery = await prisma.$transaction(async tx => {
            const ids = states.filter(state => selected.some(source => source.id === state.id && source.resource === "orders")).flatMap(state => state.runs[0] ? [state.runs[0].id] : []);
            const runs = ids.length ? await tx.amazonSyncRun.findMany({ where: { ...scope, id: { in: ids }, sourceId: { in: selected.filter(source => source.resource === "orders").map(source => source.id) }, resource: "orders", executionVersion: 2 } }) : [];
            return new Map(await Promise.all(runs.map(async run => [run.id, await orderRecoveryReadiness(tx, run)] as const)));
          }, { isolationLevel: "RepeatableRead" });
          const items = selected.map(s => {
            const state = states.find(row => row.id === s.id);
            const rawCoverage = state?.coverage && typeof state.coverage === "object" && !Array.isArray(state.coverage) ? state.coverage : {};
            // Never expose raw payloads, discovery object IDs or cross-site manifests.
            const coverage = Object.fromEntries(["type", "complete", "historicalComplete", "paginationComplete", "accountUniverseComplete", "from", "to"].flatMap(key => {
              const value = (rawCoverage as Record<string, unknown>)[key];
              return typeof value === "boolean" || typeof value === "string" ? [[key, value]] : [];
            }));
            const dates = state?.targets.map(t => t.schedule.nextRunAt).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime());
            return { sellerAccountId: s.sellerAccountId, displayName: s.seller.displayName, amazonSellerId: s.authorization.amazonSellerId, marketplaceId: s.marketplaceId, region: s.authorization.awsRegion, resource: s.resource, enabled: s.enabled, lastSyncedAt: s.lastSuccessAt, syncRunId: s.activeRunId, rowCount: s.rowCount, coverage, latestTask: state?.runs[0] ? { ...state.runs[0], ...(s.resource === "orders" ? { orderRecovery: orderRecovery.get(state.runs[0].id) ?? null } : {}), operatorAction: incrementalOperatorAction(s.resource, state.runs[0].status) } : null, nextScheduledAt: dates?.[0] ?? null };
          });
          const coverage = await readSyncCoverage(scope, new URLSearchParams({ ...(args.marketplaceId ? { marketplaceId: String(args.marketplaceId) } : {}), ...(args.sellerAccountId ? { sellerAccountId: String(args.sellerAccountId) } : {}) }), actor, selected.map(s => s.id));
          result = { data: { items, total: selected.length, coverage }, meta: dataMeta(selected, "AmazonSyncDataSource", ["sellerAccountId", "marketplaceId", "resource"], ["成功快照不等于全部 API 或全部历史已完成；未报告的覆盖范围为未知。"]) };
        }
        else if (tool === "amazon.stores.list" || tool === "amazon.sync.status") result = selected.map(s => ({ sellerAccountId: s.sellerAccountId, displayName: s.seller.displayName, amazonSellerId: s.authorization.amazonSellerId, marketplaceId: s.marketplaceId, region: s.authorization.awsRegion, resource: s.resource, enabled: s.enabled, lastSyncedAt: s.lastSuccessAt, source: "amazon_sp_api_snapshot", syncRunId: s.activeRunId, rowCount: s.rowCount }));
        else if (tool === "amazon.history.read") {
        const taskId = requiredText(args.taskId, "任务");
        const task = await prisma.amazonSyncRun.findFirst({ where: { ...scope, id: taskId, sourceId: { in: selected.map(s => s.id) }, status: "SUCCEEDED", executionVersion: 2 } });
        if (!task) throw new SyncInputError("数据范围不可访问。", 403);
        const history = await readTaskSnapshot(scope, new URLSearchParams({ id: taskId, page: String(page) }), actor);
        result = { ...history, source: "amazon_sp_api_historical_snapshot" };
        } else if (tool === "amazon.sales.list" || tool === "amazon.sales.export") {
        const now = new Date().toISOString().slice(0, 10);
        const from = String(args.from ?? new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10)), to = String(args.to ?? now);
        if ((Date.parse(to) - Date.parse(from)) / 86400000 > 90) throw new SyncInputError("查询范围最多 90 天。");
        // The service's boundary applies credential AND current ERP grants. User selection
        // is an additional fence applied to source IDs by the sales service.
        const params = new URLSearchParams({ from, to, page: String(page), ...(args.sellerAccountId ? { sellerAccountId: String(args.sellerAccountId) } : {}), ...(args.marketplaceId ? { marketplaceId: String(args.marketplaceId) } : {}), ...(args.taskId ? { taskId: String(args.taskId) } : {}), ...(args.keyword ? { keyword: String(args.keyword) } : {}) });
        const data = await readSalesTraffic(scope, params, { actor, pageSize: tool === "amazon.sales.export" ? 1000 : 50, sourceFence: selected.filter(s => s.resource === "sales_traffic").map(s => s.id) });
        const rows = data.rows.map(({ sellerAccountId, marketplaceId, businessDate, metrics, syncRunId, capturedAt, reportId }) => ({ sellerAccountId, marketplaceId, businessDate, metrics, syncRunId, capturedAt, reportId, source: "amazon_sp_api_snapshot" }));
        if (tool === "amazon.sales.export" && (data.pagination.total > 1000 || page !== 1)) throw new SyncInputError("导出最多 1000 行，请缩小范围。");
        result = tool === "amazon.sales.export" ? { format: "jsonl", rowCount: rows.length, content: rows.map(r => JSON.stringify(r)).join("\n"), numericEncoding: data.numericEncoding, source: "amazon_sp_api_snapshot" } : { rows, pagination: data.pagination, numericEncoding: data.numericEncoding, source: "amazon_sp_api_snapshot", asOf: data.asOf };
        } else if (tool === "amazon.catalog.list") {
        const data = await querySkillTable({ scope, actor, sources: selected, tableName: "listings", page, pageSize: 50 });
        result = { rows: data.data.items, pagination: { page, pageSize: 50, total: data.data.total, hasNext: page * 50 < data.data.total }, source: "amazon_sp_api_snapshot", numericEncoding: "JSON_NUMERIC_STRINGS" };
        } else if (tool === "amazon.inventory.list" || tool === "amazon.inventory.summary") {
        if (tool === "amazon.inventory.summary") {
          const where = { ...common, OR: published.filter(s => s.resource === "inventory" && s.activeRunId).map(s => ({ sellerAccountId: s.sellerAccountId, marketplaceId: s.marketplaceId, syncRunId: s.activeRunId! })) };
          result = { summary: await prisma.amazonInventorySnapshot.aggregate({ where, _sum: { fulfillableQuantity: true, inboundWorkingQuantity: true, inboundShippedQuantity: true, inboundReceivingQuantity: true }, _count: { _all: true } }), source: "amazon_sp_api_snapshot" };
        } else {
          const data = await querySkillTable({ scope, actor, sources: selected, tableName: "inventory", page, pageSize: 50 });
          result = { rows: data.data.items, pagination: { page, pageSize: 50, total: data.data.total, hasNext: page * 50 < data.data.total }, source: "amazon_sp_api_snapshot" };
        }
        }
      }
      if (result === undefined) throw new SyncInputError("工具不可访问。", 403);
      for (const name of requiredDatasetTools) await requireDatasetTool(name);
      if (normalizedQuery) {
        const queryResult = result as { data: { items: unknown[]; total: number }; meta: Record<string, unknown> };
        const metadataSources = (queryResult.meta.profiles ?? queryResult.meta.sources ?? []) as Array<{ sellerAccountId: string | null; marketplaceId: string }>;
        result = enrichDatasetResult(queryResult, { dataset: normalizedQuery.dataset, filters: normalizedQuery.filters, requestId,
          toolVersion: registeredAmazonMcpTools.find(item => item.name === tool)!.version,
          scopePairs: metadataSources.filter((source): source is { sellerAccountId: string; marketplaceId: string } => typeof source.sellerAccountId === "string").map(source => ({ sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId })) });
      }
      if (signal?.aborted) throw new GatewayInvocationError("CANCELLED", "Tool execution was cancelled.");
      const live = await resolve();
      if (financeProjection) {
        const current = await resolveFinanceProjection();
        if (financeProjection.some(source => !current.some(item => item.id === source.id && item.revision === source.revision && item.authorizationId === source.authorizationId && item.marketplaceId === source.marketplaceId))) throw new SyncInputError("财务来源在查询期间发生变化。", 403);
      }
      // The source ID alone is not a fence against an in-flight binding change.
      if (selected.some(s => !live.some(l => l.id === s.id && l.revision === s.revision && l.authorizationId === s.authorizationId && l.sellerAccountId === s.sellerAccountId && l.marketplaceId === s.marketplaceId && l.resource === s.resource && l.authorization.amazonSellerId === s.authorization.amazonSellerId && l.authorization.awsRegion === s.authorization.awsRegion))) throw new SyncInputError("数据范围不可访问。", 403);
      const summary = result && typeof result === "object" ? result as { data?: { total?: number; items?: Array<{ versionId?: string }> }; meta?: { source?: string } } : {};
      const versionIds = [...new Set((summary.data?.items ?? []).flatMap(item => item && typeof item === "object" && typeof item.versionId === "string" ? [item.versionId] : []))].slice(0,100);
      const filters = normalizedQuery?.filters ?? (args.filters && typeof args.filters === "object" ? args.filters as Record<string, unknown> : {});
      if (signal?.aborted) throw new GatewayInvocationError("CANCELLED", "Tool execution was cancelled.");
      await audit(scope, actor, "amazon.mcp.tool.succeeded", { requestId, credentialId: identity.id, tool, toolVersion: definition.version, gatewayStatus: "SUCCEEDED", failureClass: null, durationMs: Date.now() - startedAt, scopes: requested,
        from: typeof args.from === "string" ? args.from : typeof filters.from === "string" ? filters.from : typeof args.dateFrom === "string" ? args.dateFrom : null,
        to: typeof args.to === "string" ? args.to : typeof filters.to === "string" ? filters.to : typeof args.dateTo === "string" ? args.dateTo : null,
        page, querySummary: Object.fromEntries(["internalProfileId", "authorizationId", "reportType", "adProduct", "campaignId", "adGroupId", "targetingId", "entityType", "state", "sortBy", "sortDirection"].flatMap(key => { const value = args[key] ?? filters[key]; return typeof value === "string" ? [[key, value]] : []; })), ...(typeof summary.data?.total === "number" ? { matchedCount: summary.data.total, returnedCount: summary.data.items?.length ?? 0, source: summary.meta?.source ?? null, sourceVersionIds: versionIds } : {}), ...(typeof args.pageSize === "number" ? { pageSize: args.pageSize } : {}), ...(typeof args.table === "string" ? { table: args.table } : {}), ...(typeof args.resource === "string" ? { resource: args.resource } : {}) });
      if (!sessionIdentities.has(identity)) await prisma.amazonMcpCredential.updateMany({ where: { id: identity.id, status: "ACTIVE" }, data: { lastUsedAt: new Date() } });
      return result;
    });
  } catch (caught) {
    const error = caught instanceof AdsQueryError ? new SyncInputError(caught.message, caught.status) : caught;
    if (!(error instanceof GatewayInvocationError)) await audit(scope, actor, "amazon.mcp.tool.denied", { requestId, credentialId: identity.id, tool: amazonMcpTools.some(([name]) => name === tool) ? tool : "UNKNOWN", toolVersion: definition.version, gatewayStatus: "FAILED", failureClass: error instanceof SyncInputError ? error.status === 403 ? "ACCESS_DENIED" : "VALIDATION" : "EXECUTION_FAILED", durationMs: Date.now() - startedAt, scopes: requested, reason: error instanceof SyncInputError ? `REQUEST_REJECTED_${error.status}` : "INTERNAL_FAILURE" });
    throw error;
  }
}


type McpInvocationContext = { identity: McpIdentity; raw: unknown; requestId: string; signal?: AbortSignal };
const invokeNamedTool = (tool: AmazonMcpToolName) => (context: McpInvocationContext) =>
  invokeRegisteredAmazonMcp(context.identity, tool, context.raw, context.requestId, context.signal);
const registeredAmazonMcpTools = bindAmazonMcpHandlers<McpInvocationContext, unknown>({
  "inventory_get_snapshot": invokeNamedTool("inventory_get_snapshot"),
  "inventory_get_events": invokeNamedTool("inventory_get_events"),
  "inventory_get_age": invokeNamedTool("inventory_get_age"),
  "reimbursement_get_events": invokeNamedTool("reimbursement_get_events"),
  "reimbursement_get_payments": invokeNamedTool("reimbursement_get_payments"),
  "reimbursement_analyze": invokeNamedTool("reimbursement_analyze"),
  "returns_get_items": invokeNamedTool("returns_get_items"),
  "promotions_search": invokeNamedTool("promotions_search"),
  "promotions_get": invokeNamedTool("promotions_get"),
  "promotions_get_items": invokeNamedTool("promotions_get_items"),
  "orders_search": invokeNamedTool("orders_search"),
  "orders_get_items": invokeNamedTool("orders_get_items"),
  "finance_get_transactions": invokeNamedTool("finance_get_transactions"),
  "finance_get_settlements": invokeNamedTool("finance_get_settlements"),
  "amazon.fields.coverage": invokeNamedTool("amazon.fields.coverage"),
  "amazon.fields.catalog": invokeNamedTool("amazon.fields.catalog"),
  "amazon.data.archive.read": invokeNamedTool("amazon.data.archive.read"),
  "amazon.ads.reports.list": invokeNamedTool("amazon.ads.reports.list"),
  "amazon.ads.entities.list": invokeNamedTool("amazon.ads.entities.list"),
  "ads_list_entities": invokeNamedTool("ads_list_entities"),
  "ads_get_campaign_structure": invokeNamedTool("ads_get_campaign_structure"),
  "ads_get_sync_status": invokeNamedTool("ads_get_sync_status"),
  "ads_get_data_health": invokeNamedTool("ads_get_data_health"),
  "ads_get_connection_status": invokeNamedTool("ads_get_connection_status"),
  "ads_get_settings": invokeNamedTool("ads_get_settings"),
  "amazon.stores.list": invokeNamedTool("amazon.stores.list"),
  "amazon.inventory.list": invokeNamedTool("amazon.inventory.list"),
  "amazon.inventory.summary": invokeNamedTool("amazon.inventory.summary"),
  "amazon.catalog.list": invokeNamedTool("amazon.catalog.list"),
  "amazon.sales.list": invokeNamedTool("amazon.sales.list"),
  "amazon.sync.status": invokeNamedTool("amazon.sync.status"),
  "amazon.history.read": invokeNamedTool("amazon.history.read"),
  "amazon.sales.export": invokeNamedTool("amazon.sales.export"),
  "data_list_tables": invokeNamedTool("data_list_tables"),
  "data_describe_table": invokeNamedTool("data_describe_table"),
  "data_query": invokeNamedTool("data_query"),
  "get_listings": invokeNamedTool("get_listings"),
  "get_inventory": invokeNamedTool("get_inventory"),
  "get_sales": invokeNamedTool("get_sales"),
  "get_orders": invokeNamedTool("get_orders"),
  "get_order_items": invokeNamedTool("get_order_items"),
  "data_sync_status": invokeNamedTool("data_sync_status"),
  "data_sync_start": invokeNamedTool("data_sync_start"),
});

/** Refresh on every discovery. At most three action groups, never one DB traversal per tool. */
export async function listDiscoverableAmazonMcpTools(identity: McpIdentity, protocolVersion: string | null = null) {
  const scope = { organizationId: identity.organizationId, workspaceId: identity.workspaceId };
  const credential = await liveMcpCredential(identity);
  if (!credential) throw new SyncInputError("工具不可访问。", 403);
  const [identityTools, credentialTools] = await Promise.all([accountToolsForLili(identity), accountToolsForLili(credential)]);
  const candidates = registeredAmazonMcpTools.filter(tool => isCallableAmazonMcpTool(tool)
    && identityTools.includes(tool.name) && credentialTools.includes(tool.name)
    && (!sessionIdentities.has(identity) || tool.operationMode === "READ_ONLY"));
  const readAccess = await explicitAmazonDataAccess(scope, identity.userId, prisma);
  const actions = [...new Set(candidates.filter(tool => tool.operationMode !== "READ_ONLY").map(tool => tool.action))];
  const resolveAction = async (action: AmazonDataAction) => {
    const tool = candidates.find(tool => tool.action === action)!;
    try {
      return await withAmazonMcpBoundary({ ...scope, userId: identity.userId, credentialId: boundaryCredentialId(identity), tool: tool.name, action }, async () => {
        const access = await amazonDataAccess(scope, identity.userId);
        return verifiedSources(prisma, scope, sellerAccessWhere(access));
      });
    } catch (error) {
      if (error instanceof SyncInputError && error.status === 403) return [];
      throw error;
    }
  };
  const before = new Map<AmazonDataAction, Awaited<ReturnType<typeof verifiedSources>>>();
  for (const action of actions) before.set(action, await resolveAction(action));
  const allowed = new Set<AmazonDataAction>(["view", "export"]);
  for (const action of actions) {
    const previous = before.get(action)!;
    const current = await resolveAction(action);
    // Do not release discovery after an in-flight binding change, even if source IDs survive.
    const unchanged = previous.length > 0 && previous.every(source => current.some(live => live.id === source.id
      && live.revision === source.revision && live.authorizationId === source.authorizationId
      && live.sellerAccountId === source.sellerAccountId && live.marketplaceId === source.marketplaceId
      && live.resource === source.resource && live.authorization.amazonSellerId === source.authorization.amazonSellerId
      && live.authorization.awsRegion === source.authorization.awsRegion));
    if (unchanged && (action !== "sync" || current.some(source => (amazonMcpSyncResources as readonly string[]).includes(source.resource)))) allowed.add(action);
  }
  const currentReadAccess = await explicitAmazonDataAccess(scope, identity.userId, prisma);
  if (readAccess.sellerIds.some(id => !currentReadAccess.sellerIds.includes(id))) throw new SyncInputError("账号分配在查询期间已变化。", 403);
  const latest = await liveMcpCredential(identity);
  if (!latest || latest.name !== credential.name || latest.revision !== credential.revision || latest.expiresAt.getTime() !== credential.expiresAt.getTime()
    || JSON.stringify(latest.scopes) !== JSON.stringify(credential.scopes) || JSON.stringify(latest.tools) !== JSON.stringify(credential.tools)) {
    throw new SyncInputError("工具不可访问。", 403);
  }
  return candidates.filter(tool => allowed.has(tool.action)).map(tool => mcpDiscoveryDescriptor(tool, protocolVersion));
}

const amazonMcpGateway = createToolGateway({ tools: [], adapters: [] });
export async function invokeAmazonMcp(identity: McpIdentity, tool: string, raw: unknown, requestId: string = randomUUID(), signal?: AbortSignal) {
  const startedAt = Date.now();
  const registered = registeredAmazonMcpTools.find(item => item.name === tool);
  if (!registered || !isCallableAmazonMcpTool(registered)) {
    await audit(identity, identity.userId, "amazon.mcp.tool.denied", { requestId, credentialId: identity.id, tool: "UNKNOWN", reason: "TOOL_UNAVAILABLE" });
    throw new SyncInputError("工具不可访问。", 403);
  }
  try { return await amazonMcpGateway.invokeMcp({ toolId: tool, input: raw, inputSchema: registered.inputSchema, outputSchema: registered.outputSchema,
    timeoutMs: 15_000, signal,
    beforeInvalidInput: async () => {
      try {
      const args = argumentsObject(raw, canonicalMcpTool(tool));
    if (["promotions_get", "promotions_get_items"].includes(tool) && (typeof args.promotionId !== "string" || !args.promotionId.trim())) throw new SyncInputError("必须指定 promotionId。", 422);
      if (args.sellerAccountId || args.marketplaceId || args.sellerAccountIds) {
        await withAmazonMcpBoundary({ organizationId: identity.organizationId, workspaceId: identity.workspaceId, userId: identity.userId, credentialId: boundaryCredentialId(identity), tool: tool as AmazonMcpToolName, action: registered.action }, async () => {
          const access = await amazonDataAccess({ organizationId: identity.organizationId, workspaceId: identity.workspaceId }, identity.userId, prisma, registered.action);
          if (args.sellerAccountId && !access.allSellers && !access.sellerIds.includes(String(args.sellerAccountId))) throw new SyncInputError("Amazon 账号未分配给当前用户。", 403);
          const sources = await verifiedSources(prisma, { organizationId: identity.organizationId, workspaceId: identity.workspaceId }, sellerAccessWhere(access));
          const sellers = Array.isArray(args.sellerAccountIds) ? args.sellerAccountIds as string[] : args.sellerAccountId ? [String(args.sellerAccountId)] : [];
          if (!registered.module.includes("amazon_ads") && sellers.some(seller => !sources.some(source => source.sellerAccountId === seller && (!args.marketplaceId || source.marketplaceId === args.marketplaceId)))) throw new SyncInputError("数据范围不可访问。", 403);
          if (args.marketplaceId && !sellers.length && !sources.some(source => source.marketplaceId === args.marketplaceId)) throw new SyncInputError("数据范围不可访问。", 403);
        });
      }
      if (["data_query", "data_describe_table"].includes(tool) || fixedAmazonMcpDataset(tool)) {
        const fixedDataset = fixedAmazonMcpDataset(tool);
        const dataset = resolveMcpDataset(fixedDataset ? { ...args, table: fixedDataset } : args);
        if (tool !== "data_describe_table") normalizeDatasetQuery(dataset, args);
      } else if (tool === "amazon.ads.reports.list") normalizeDatasetQuery(mcpDatasets.find(dataset => dataset.name === "ads_report_daily")!, args);
      else if (["amazon.ads.entities.list", "ads_list_entities", "ads_get_campaign_structure"].includes(tool)) normalizeDatasetQuery(mcpDatasets.find(dataset => dataset.name === "ads_entities")!, args);
      } catch (error) {
        await audit({ organizationId: identity.organizationId, workspaceId: identity.workspaceId }, identity.userId, "amazon.mcp.tool.denied", { requestId, credentialId: identity.id, tool, toolVersion: registered.version, gatewayStatus: "REJECTED", failureClass: error instanceof SyncInputError && error.status === 403 ? "ACCESS_DENIED" : "VALIDATION", durationMs: Date.now() - startedAt, reason: error instanceof SyncInputError ? `REQUEST_REJECTED_${error.status}` : "INVALID_ARGUMENT" });
        throw error;
      }
    },
    execute: childSignal => registered.handler({ identity, raw, requestId, signal: childSignal }) });
  } catch (error) {
    if (error instanceof GatewayInvocationError) {
      const failureClass = error.code === "INVALID_INPUT" ? "SCHEMA_VALIDATION" : error.code === "INVALID_OUTPUT" ? "OUTPUT_SCHEMA" : error.code;
      await audit({ organizationId: identity.organizationId, workspaceId: identity.workspaceId }, identity.userId, "amazon.mcp.tool.denied", { requestId, credentialId: identity.id, tool, toolVersion: registered.version, gatewayStatus: error.code === "CANCELLED" ? "CANCELLED" : "FAILED", failureClass, durationMs: Date.now() - startedAt, reason: error.code });
    }
    throw error;
  }
}
