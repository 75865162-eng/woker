import { amazonMcpTools, bindAmazonMcpHandlers, isCallableAmazonMcpTool, mcpDiscoveryDescriptor, type AmazonMcpToolName } from "./mcp-tool-registry";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma, type AmazonAdsEntityRecord } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { amazonDataAccess, assertAmazonScopeAdmin, explicitAmazonDataAccess, parseAccessScopes, sellerAccessWhere, withAmazonMcpBoundary, type AmazonAccessScope, type AmazonDataAction } from "./data-access";
import { requiredText, SyncInputError, type SyncScope } from "./policy";
import { readTaskSnapshot } from "./snapshots";
import { readSalesTraffic } from "./sales-query";
import { availableSkillTables, describeSkillTable, querySkillTable, skillTableAvailability } from "./skill-data";
import { assertAdsQueryBudget } from "@/lib/amazon-ads/query-budget";
import { queryPublishedAdsReports } from "@/lib/amazon-ads/report-query";
import { AdsQueryError, parseAdsQuery } from "@/lib/amazon-ads/query-contract";
import { queryAdsEntities } from "@/lib/amazon-ads/data-query";
import { adsReadAdapterReady } from "@/lib/amazon-ads/sync-adapter";
import { adsScopeEnabled } from "@/lib/amazon-ads/sync-policy";
import { requestChange } from "./change-approval";

export { amazonMcpTools, amazonMcpToolCatalog } from "./mcp-tool-registry";
const canonicalMcpTool = (tool: string) => registeredAmazonMcpTools.find(item => item.name === tool)?.canonicalName ?? tool;
const adsStatusTools = new Set(["ads_get_sync_status", "ads_get_data_health", "ads_get_connection_status", "ads_get_settings"]);
export const mcpTokenHash = (value: string) => createHash("sha256").update(value).digest("hex");
const credentialSelect = { id: true, name: true, userId: true, tokenPrefix: true, tools: true, scopes: true, status: true, revision: true, expiresAt: true, createdAt: true, lastUsedAt: true } satisfies Prisma.AmazonMcpCredentialSelect;

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
  for (const key of ["requestId", "tool", "reason", "matchedCount", "returnedCount", "source", "page", "pageSize", "table", "resource", "from", "to", "sourceVersionIds"] as const) {
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
export type McpSettingsSnapshotOptions = {
  callLogPage?: number; callLogPageSize?: number; callLogStatus?: McpCallLogStatus; callLogTool?: string;
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
    const callLogWhere: Prisma.AuditLogWhereInput = {
      organizationId: scope.organizationId,
      userId: actor,
      action: options.callLogStatus ? `amazon.mcp.tool.${options.callLogStatus === "SUCCEEDED" ? "succeeded" : "denied"}` : { in: ["amazon.mcp.tool.succeeded", "amazon.mcp.tool.denied"] },
      AND: [
        { metadata: { path: ["workspaceId"], equals: scope.workspaceId } },
        ...(options.callLogTool ? [{ metadata: { path: ["tool"], equals: options.callLogTool } }] : []),
      ],
    };
    const access = await explicitAmazonDataAccess(scope, actor, prisma, "view", true);
    const allowed = sellerAccessWhere(access);
    const sellers = await prisma.sellerAccount.findMany({ where: { ...scope, status: "active" }, select: { id: true } });
    const profiles = await prisma.amazonAdsProfile.findMany({
      where: { ...scope, ...allowed, sellerAccountId: { in: sellers.map(seller => seller.id) }, ...(options.sourceFence ? { AND: [{ OR: options.sourceFence }] } : {}) },
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
      callLogFilters: { status: options.callLogStatus ?? null, tool: options.callLogTool ?? null },
    };
  } catch (error) {
    if (error instanceof SyncInputError && error.status === 403) return { ads: { connectionStatus: "NOT_AUTHORIZED", oauthConfigured: false, syncEnabled: false, structureAdapterReady: false, reportAdapterReady: false, profileCount: 0, connectedProfileCount: 0, profiles: [], schemaStatus: "NOT_AUTHORIZED", dataIntegrity: "UNAVAILABLE", freshness: "missing", lastPublishedAt: null, freshnessStates: [] }, publishedVersions: [], callLogs: [] };
    throw error;
  }
}
async function hasPublishedAdsReports(scope: SyncScope, sources: Awaited<ReturnType<typeof explicitSources>>) {
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
    const scopes = parseAccessScopes(action === "rotate" ? prior!.scopes : command.scopes);
    const tools = action === "rotate" ? prior!.tools : command.tools;
    if (!Array.isArray(tools) || !tools.length || tools.length > amazonMcpTools.length || tools.some(t => !amazonMcpTools.some(([name]) => name === t))) throw new SyncInputError("工具范围无效。");
    const sources = await explicitSources(tx, scope, userId);
    if (scopes.some(s => s.marketplaceIds.some(m => !sources.some(source => source.sellerAccountId === s.sellerAccountId && source.marketplaceId === m)))) throw new SyncInputError("数据范围不可访问。", 403);
    const expiresAt = action === "rotate" ? prior!.expiresAt : new Date(String(command.expiresAt));
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= new Date() || expiresAt.getTime() > Date.now() + 90 * 86400000) throw new SyncInputError("有效期须在未来 90 天内。");
    const token = `amcp_${randomBytes(32).toString("base64url")}`;
    if (prior) await tx.amazonMcpCredential.update({ where: { id: prior.id, revision: prior.revision }, data: { status: "REVOKED", revision: { increment: 1 } } });
    const row = await tx.amazonMcpCredential.create({ data: { id: randomUUID(), ...scope, userId, name: action === "rotate" ? prior!.name : requiredText(command.name, "名称", 100), tokenHash: mcpTokenHash(token), tokenPrefix: token.slice(0, 12), tools: [...new Set(tools)] as string[], scopes, expiresAt, createdByUserId: actor, rotatedFromId: prior?.id }, select: credentialSelect });
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: actor, action: `amazon.mcp.credential.${action}`, entityType: "AmazonMcpCredential", entityId: row.id, metadata: { workspaceId: scope.workspaceId, subjectUserId: userId, scopes, tools: row.tools } } });
    return { credential: row, token };
  });
}

export async function authenticateAmazonMcp(authorization: string | null) {
  const token = authorization?.match(/^Bearer (amcp_[A-Za-z0-9_-]{43})$/)?.[1];
  const row = token ? await prisma.amazonMcpCredential.findUnique({ where: { tokenHash: mcpTokenHash(token) } }) : null;
  if (!row || row.status !== "ACTIVE" || row.expiresAt <= new Date()) {
    await audit(null, null, "amazon.mcp.authentication.denied", { requestId: randomUUID(), reason: "INVALID_CREDENTIAL" });
    throw new SyncInputError("认证失败。", 401);
  }
  try { await explicitAmazonDataAccess({ organizationId: row.organizationId, workspaceId: row.workspaceId }, row.userId, prisma, "view", true); }
  catch { await audit(row, row.userId, "amazon.mcp.authentication.denied", { requestId: randomUUID(), credentialId: row.id, reason: "CURRENT_ACCESS_DENIED" }); throw new SyncInputError("认证失败。", 401); }
  return row;
}
type McpIdentity = Awaited<ReturnType<typeof authenticateAmazonMcp>>;
export async function auditAmazonMcpProtocol(identity: McpIdentity, method: string, requestId: string) {
  await audit(identity, identity.userId, "amazon.mcp.protocol", { credentialId: identity.id, requestId, method: ["initialize", "notifications/initialized", "ping", "tools/list"].includes(method) ? method : "UNKNOWN" });
}
function argumentsObject(value: unknown, tool?: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyncInputError("参数无效。");
  const args = value as Record<string, unknown>;
  if (args.sellerAccountId !== undefined && args.sellerAccountIds !== undefined) throw new SyncInputError("参数无效。");
  const adsFields = ["internalProfileId", "authorizationId", "entityType", "campaignId", "adGroupId", "externalId", "state", "search", "sort", "direction"];
  const reportFields = ["sellerAccountId", "sellerAccountIds", "marketplaceId", "internalProfileId", "authorizationId", "reportType", "adProduct", "campaignId", "adGroupId", "targetingId", "advertisedAsin", "searchTerm", "placement", "from", "to", "page", "pageSize", "sortBy", "sortDirection", "search"];
  const allowed = tool === "amazon.ads.reports.list" ? reportFields : tool === "amazon.ads.entities.list" ? ["sellerAccountId", "sellerAccountIds", "marketplaceId", "page", "pageSize", ...adsFields] : ["sellerAccountId", "sellerAccountIds", "marketplaceId", "from", "to", "keyword", "page", "pageSize", "taskId", "table", "filters", "resource", "dateFrom", "dateTo"];
  if (Object.keys(args).some(k => !allowed.includes(k))) throw new SyncInputError("数据范围不可访问。", 403);
  for (const [k, v] of Object.entries(args)) {
    if (k === "sellerAccountIds") continue;
    if (k === "filters") {
      if (!v || typeof v !== "object" || Array.isArray(v) || Object.entries(v).some(([field, filter]) => !/^[A-Za-z][A-Za-z0-9.]{0,80}$/.test(field) || typeof filter !== "string" || filter.length > 200)) throw new SyncInputError("筛选条件无效。");
      continue;
    }
    if (k === "page" && typeof v === "number" && Number.isInteger(v)) continue;
    if (k === "pageSize" && typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 1000) continue;
    if (typeof v !== "string" || v.length > 200) throw new SyncInputError("参数无效。");
  }
  if (args.sellerAccountIds !== undefined && (!Array.isArray(args.sellerAccountIds) || !args.sellerAccountIds.length || args.sellerAccountIds.length > 200 || args.sellerAccountIds.some(v => typeof v !== "string" || !v || v.length > 200))) throw new SyncInputError("参数无效。");
  return args;
}
/** Expose only documented structure fields, including a whitelist inside nested objects. */
function adsEntityFields(entity: AmazonAdsEntityRecord) {
  const payload = entity.payload;
  const row = payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {};
  const scalar = (value: Prisma.JsonValue | undefined) => typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
  const fields: Record<string, unknown> = Object.fromEntries(Object.entries(row).filter(([key, value]) => ["name", "campaignId", "adGroupId", "keywordText", "matchType", "bid", "defaultBid", "targetingType", "expressionType", "startDate", "endDate"].includes(key) && scalar(value)));
  for (const key of ["name", "campaignId", "adGroupId", "keywordText", "matchType", "targetingType", "expressionType"] as const) if (entity[key] != null) fields[key] = entity[key];
  if (entity.bid != null) {
    fields.bid = entity.bid.toFixed();
    if (entity.entityType === "SP:ad-group") fields.defaultBid = entity.bid.toFixed();
  }
  for (const key of ["startDate", "endDate"] as const) if (entity[key]) fields[key] = entity[key].toISOString().slice(0, 10);
  const budget = entity.budgetAmount != null || entity.budgetType != null ? { budget: entity.budgetAmount?.toFixed() ?? null, budgetType: entity.budgetType } : row.budget;
  if (budget && typeof budget === "object" && !Array.isArray(budget)) fields.budget = Object.fromEntries(Object.entries(budget).filter(([key, value]) => ["budget", "budgetType"].includes(key) && scalar(value)));
  for (const key of ["expression", "resolvedExpression"]) {
    const expressions = key === "expression" ? entity.targetingExpression ?? row[key] : row[key];
    if (Array.isArray(expressions)) fields[key] = expressions.filter(value => value && typeof value === "object" && !Array.isArray(value)).map(value => Object.fromEntries(Object.entries(value!).filter(([key, value]) => ["type", "value"].includes(key) && scalar(value))));
  }
  return fields;
}
async function invokeRegisteredAmazonMcp(identity: McpIdentity, tool: AmazonMcpToolName, raw: unknown, requestId: string = randomUUID()): Promise<unknown> {
  const scope = { organizationId: identity.organizationId, workspaceId: identity.workspaceId }, actor = identity.userId;
  const action: AmazonDataAction = registeredAmazonMcpTools.find(item => item.name === tool)!.action;
  let requested: AmazonAccessScope[] = [];
  try {
    if (!identity.tools.includes(tool) || !amazonMcpTools.some(([name]) => name === tool)) throw new SyncInputError("工具不可访问。", 403);
    const args = argumentsObject(raw, canonicalMcpTool(tool));
    return await withAmazonMcpBoundary({ ...scope, userId: actor, credentialId: identity.id, tool, action }, async () => {
      const resolve = async () => {
        const access = await amazonDataAccess(scope, actor);
        return verifiedSources(prisma, scope, sellerAccessWhere(access));
      };
      const canReadAdsReports = async () => !!await prisma.amazonMcpCredential.findFirst({ where: { ...scope, id: identity.id, userId: actor, status: "ACTIVE", expiresAt: { gt: new Date() }, tools: { has: "amazon.ads.reports.list" } }, select: { id: true } });
      const requireAdsReports = async () => { if (!await canReadAdsReports()) throw new SyncInputError("Ads 报表工具未授权，数据不可访问。", 403); };
      const sources = await resolve();
      const sellers = args.sellerAccountIds as string[] | undefined ?? (args.sellerAccountId ? [String(args.sellerAccountId)] : undefined);
      if (sellers?.some(id => !sources.some(s => s.sellerAccountId === id)) || (args.marketplaceId && !sources.some(s => s.marketplaceId === args.marketplaceId && (!sellers || sellers.includes(s.sellerAccountId))))) throw new SyncInputError("数据范围不可访问。", 403);
      if (args.marketplaceId && sellers?.some(id => !sources.some(s => s.sellerAccountId === id && s.marketplaceId === args.marketplaceId))) throw new SyncInputError("数据范围不可访问。", 403);
      const selected = sources.filter(s => (!sellers || sellers.includes(s.sellerAccountId)) && (!args.marketplaceId || s.marketplaceId === args.marketplaceId));
      if (!selected.length) throw new SyncInputError("数据范围不可访问。", 403);
      requested = selected.map(s => ({ sellerAccountId: s.sellerAccountId, marketplaceIds: [s.marketplaceId] }));
      const page = args.page === undefined ? 1 : Number(args.page);
      if (!Number.isInteger(page) || page < 1 || page > 10000) throw new SyncInputError("分页无效。");
      let result: unknown;
      if (adsStatusTools.has(tool)) {
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
        await requireAdsReports();
        assertAdsQueryBudget(identity.id);
        const params = new URLSearchParams({ kind: "reports" });
        for (const [key, value] of Object.entries(args)) if (key !== "sellerAccountIds") params.set(key, String(value));
        const data = await queryPublishedAdsReports(scope, actor, parseAdsQuery(params), selected.map(source => ({ sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId })));
        result = { data: { items: data.rows, total: data.total }, meta: { ...data.meta, warnings: data.warnings } };
      } else if (tool === "amazon.ads.entities.list" || tool === "ads_list_entities" || tool === "ads_get_campaign_structure") {
        const queryArgs = { ...args, ...(tool === "ads_get_campaign_structure" ? { entityType: "SP:campaign" } : {}) };
        if (queryArgs.entityType !== undefined && !["SP:campaign", "SP:ad-group", "SP:keyword", "SP:target", "SP:negative-keyword", "SP:negative-target", "SP:campaign-negative-keyword", "SP:campaign-negative-target"].includes(String(queryArgs.entityType))) throw new SyncInputError("Ads 实体类型无效。");
        const params = new URLSearchParams();
        for (const [key, value] of Object.entries(queryArgs)) if (!["sellerAccountIds", "marketplaceId"].includes(key)) params.set(key, String(value));
        const data = await queryAdsEntities(scope, actor, params, selected.map(source => ({ sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId })));
        // Recheck Ads bindings outside the read snapshot before releasing any rows or metadata.
        const bindings = new Map(data.meta.profiles.map(profile => [profile.id, { id: profile.id, profileId: profile.amazonProfileId, authorizationId: profile.authorizationId, sellerAccountId: profile.sellerAccountId, marketplaceId: profile.marketplaceId }]));
        for (const row of data.rows) bindings.set(row.internalProfileId, { id: row.internalProfileId, profileId: row.amazonProfileId, authorizationId: row.profile.authorizationId, sellerAccountId: row.profile.sellerAccountId, marketplaceId: row.profile.marketplaceId });
        if (bindings.size && await prisma.amazonAdsProfile.count({ where: { ...scope, authorization: { status: "CONNECTED" }, OR: [...bindings.values()] } }) !== bindings.size) throw new SyncInputError("数据范围不可访问。", 403);
        result = {
          data: { items: data.rows.map(row => ({
            entityType: row.entityType, externalId: row.externalId, parentExternalId: row.parentExternalId,
            internalProfileId: row.internalProfileId, amazonProfileId: row.amazonProfileId,
            sellerAccountId: row.profile.sellerAccountId, marketplaceId: row.profile.marketplaceId,
            state: row.state, sourceUpdatedAt: row.sourceUpdatedAt, syncedAt: row.syncedAt,
            sourceTaskId: row.sourceTaskId, sourceTask: row.sourceTask, apiVersion: row.apiVersion,
            fields: adsEntityFields(row),
          })), total: data.total },
          meta: { ...data.meta, page: { page: data.page, pageSize: data.pageSize, hasNext: data.page * data.pageSize < data.total },
            fieldDefinitions: { internalProfileId: "ERP Profile 主键，用于筛选", amazonProfileId: "Amazon 外部 Profile ID，不是 ERP 主键", externalId: "Amazon 实体 ID，须与 Profile 和 entityType 联合识别", parentExternalId: "直接父级 Amazon ID；Campaign 级否定项不属于 Ad Group", fields: "SP v3 结构字段白名单；不含指标或原始响应", sourceUpdatedAt: "Amazon 上游更新时间，可能为空", syncedAt: "此行本地同步时间", sourceTask: "来源任务当前状态；部分失败任务的已提交行可能存在" },
            warnings: ["只读当前已观察的结构快照；缺失行不表示已删除，不保证历史版本。", "结构数据无报告日期维度，不提供业绩指标。"],
          },
        };
      } else if (tool === "data_list_tables") {
        const tables = availableSkillTables(selected);
        if (await canReadAdsReports() && await hasPublishedAdsReports(scope, selected)) tables.push({ name: "ads_report_daily", source: "AmazonAdsReportFact", grain: ["sellerAccountId", "marketplaceId", "reportType", "adProduct", "reportDate", "factKey", "versionId"], schemaStatus: "application_schema_confirmed_source_sample_pending", warnings: ["只展示完整成功任务的已发布版本。", "金额按行返回；不得跨币种汇总。", "Amazon 报表真实样本仍待核验。"] });
        const resources = new Set<string>(tables.filter(table => table.name !== "ads_report_daily").map(table => table.name === "inventory" ? "inventory" : table.name === "listings" ? "catalog" : "sales_traffic"));
        const tableSources = selected.filter(source => resources.has(source.resource));
        result = { data: { items: tables, total: tables.length }, meta: dataMeta(tableSources, "AmazonSyncDataSource", ["sellerAccountId", "marketplaceId", "resource"]) };
      } else if (tool === "data_describe_table") {
        const table = requiredText(args.table, "逻辑表", 100);
        if (table === "ads_report_daily") await requireAdsReports();
        if (table === "ads_report_daily" && !await hasPublishedAdsReports(scope, selected)) throw new SyncInputError("TABLE_NOT_ALLOWED: 当前授权范围没有该表的已发布数据源。", 403);
        const description = describeSkillTable(table, selected);
        result = { data: { table: description }, meta: dataMeta([], "Prisma application schema", description.grain, description.warnings, "schema") };
      } else if (tool === "data_query") {
        const table = requiredText(args.table, "逻辑表", 100);
        if (table === "ads_report_daily") await requireAdsReports();
        if (table === "ads_report_daily" && !await hasPublishedAdsReports(scope, selected)) throw new SyncInputError("TABLE_NOT_ALLOWED: 当前授权范围没有该表的已发布数据源。", 403);
        if (table === "ads_report_daily") assertAdsQueryBudget(identity.id);
        const pageSize = args.pageSize === undefined ? 100 : Number(args.pageSize);
        if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new SyncInputError("pageSize 须为 1–1000 的整数。");
        const resourceByTable: Record<string, string> = { inventory: "inventory", listings: "catalog", sales_traffic_daily: "sales_traffic" };
        if (resourceByTable[table]) requested = selected.filter(source => source.resource === resourceByTable[table]).map(source => ({ sellerAccountId: source.sellerAccountId, marketplaceIds: [source.marketplaceId] }));
        result = await querySkillTable({ scope, actor, sources: selected, tableName: table,
          ...(args.sellerAccountId ? { sellerAccountId: String(args.sellerAccountId) } : {}),
          ...(args.marketplaceId ? { marketplaceId: String(args.marketplaceId) } : {}),
          ...(args.filters ? { filters: args.filters as Record<string, string> } : {}), page, pageSize });
      } else if (tool === "data_sync_start") {
        const resource = requiredText(args.resource, "数据域", 100);
        const selectedSyncSources = selected.filter(source => source.resource === resource
          && (!sellers || sellers.includes(source.sellerAccountId)) && (!args.marketplaceId || source.marketplaceId === args.marketplaceId));
        if (!selectedSyncSources.length || selectedSyncSources.length > 20) throw new SyncInputError("数据域无可用授权数据源，或一次申请超过 20 个数据源。");
        const syncableResources = new Set<string>(["inventory", "catalog", "sales_traffic"]);
        if (!syncableResources.has(resource)) throw new SyncInputError("该数据域暂不支持通过 Skill 提交同步申请。");
        if ((args.dateFrom || args.dateTo) && resource !== "sales_traffic") throw new SyncInputError("只有销售流量支持指定日期范围。");
        requested = selectedSyncSources.map(source => ({ sellerAccountId: source.sellerAccountId, marketplaceIds: [source.marketplaceId] }));
        const changeRequest = await requestChange(scope, actor, { action: "run", sourceIds: selectedSyncSources.map(source => source.id), ...(args.dateFrom ? { dateFrom: args.dateFrom } : {}), ...(args.dateTo ? { dateTo: args.dateTo } : {}) });
        result = { data: { approvalRequired: true, started: false, changeRequest, message: "同步申请已提交，审批并应用前不会创建或执行同步任务。" }, meta: dataMeta(selectedSyncSources, "AmazonDataCenterChangeRequest", ["sellerAccountId", "marketplaceId", "resource"], [], "pending_approval") };
      } else {
        const published = selected.filter(s => s.activeRunId && s.publishedRun?.status === "SUCCEEDED" && s.publishedRun.finishedAt && s.publishedRun.stage !== "PURGED" && s.publishedRun.executionVersion === 2 && s.publishedRun.resource === s.resource && s.publishedRun.sourceId === s.id);
        const common = { ...scope, OR: published.filter(s => s.activeRunId).map(s => ({ sellerAccountId: s.sellerAccountId, marketplaceId: s.marketplaceId, syncRunId: s.activeRunId! })) };
        if (tool === "data_sync_status") result = { data: { items: selected.map(s => ({ sellerAccountId: s.sellerAccountId, displayName: s.seller.displayName, amazonSellerId: s.authorization.amazonSellerId, marketplaceId: s.marketplaceId, region: s.authorization.awsRegion, resource: s.resource, enabled: s.enabled, lastSyncedAt: s.lastSuccessAt, syncRunId: s.activeRunId, rowCount: s.rowCount })), total: selected.length }, meta: dataMeta(selected, "AmazonSyncDataSource", ["sellerAccountId", "marketplaceId", "resource"]) };
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
        result = tool === "amazon.sales.export" ? { format: "jsonl", rowCount: rows.length, content: rows.map(r => JSON.stringify(r)).join("\n"), source: "amazon_sp_api_snapshot" } : { rows, pagination: data.pagination, source: "amazon_sp_api_snapshot", asOf: data.asOf };
        } else if (tool === "amazon.catalog.list") {
        const where = { ...scope, OR: published.filter(s => s.resource === "catalog" && s.activeRunId).map(s => ({ sellerAccountId: s.sellerAccountId, marketplaceId: s.marketplaceId, sourceRunId: s.activeRunId! })) };
        result = { rows: await prisma.amazonCatalogSnapshot.findMany({ where, select: { sellerAccountId: true, marketplaceId: true, sellerSku: true, asin: true, listingStatus: true, capturedAt: true, sourceRunId: true }, orderBy: { id: "asc" }, skip: (page - 1) * 50, take: 50 }), source: "amazon_sp_api_snapshot" };
        } else if (tool === "amazon.inventory.list" || tool === "amazon.inventory.summary") {
        const where = { ...common, OR: published.filter(s => s.resource === "inventory" && s.activeRunId).map(s => ({ sellerAccountId: s.sellerAccountId, marketplaceId: s.marketplaceId, syncRunId: s.activeRunId! })) };
        result = tool === "amazon.inventory.summary" ? { summary: await prisma.amazonInventorySnapshot.aggregate({ where, _sum: { fulfillableQuantity: true, inboundWorkingQuantity: true, inboundShippedQuantity: true, inboundReceivingQuantity: true }, _count: { _all: true } }), source: "amazon_sp_api_snapshot" } : { rows: await prisma.amazonInventorySnapshot.findMany({ where, select: { sellerAccountId: true, marketplaceId: true, sellerSku: true, asin: true, fulfillableQuantity: true, capturedAt: true, syncRunId: true }, orderBy: { id: "asc" }, skip: (page - 1) * 50, take: 50 }), source: "amazon_sp_api_snapshot" };
        }
      }
      if (result === undefined) throw new SyncInputError("工具不可访问。", 403);
      if (tool === "amazon.ads.reports.list" || args.table === "ads_report_daily") await requireAdsReports();
      const live = await resolve();
      // The source ID alone is not a fence against an in-flight binding change.
      if (selected.some(s => !live.some(l => l.id === s.id && l.revision === s.revision && l.authorizationId === s.authorizationId && l.sellerAccountId === s.sellerAccountId && l.marketplaceId === s.marketplaceId && l.resource === s.resource && l.authorization.amazonSellerId === s.authorization.amazonSellerId && l.authorization.awsRegion === s.authorization.awsRegion))) throw new SyncInputError("数据范围不可访问。", 403);
      const summary = result && typeof result === "object" ? result as { data?: { total?: number; items?: Array<{ versionId?: string }> }; meta?: { source?: string } } : {};
      const versionIds = [...new Set((summary.data?.items ?? []).flatMap(item => typeof item.versionId === "string" ? [item.versionId] : []))].slice(0,100);
      const filters = args.filters && typeof args.filters === "object" ? args.filters as Record<string, unknown> : {};
      await audit(scope, actor, "amazon.mcp.tool.succeeded", { requestId, credentialId: identity.id, tool, scopes: requested,
        from: typeof args.from === "string" ? args.from : typeof filters.from === "string" ? filters.from : typeof args.dateFrom === "string" ? args.dateFrom : null,
        to: typeof args.to === "string" ? args.to : typeof filters.to === "string" ? filters.to : typeof args.dateTo === "string" ? args.dateTo : null,
        page, querySummary: Object.fromEntries(["internalProfileId", "authorizationId", "reportType", "adProduct", "campaignId", "adGroupId", "targetingId", "entityType", "state", "sortBy", "sortDirection"].flatMap(key => { const value = args[key] ?? filters[key]; return typeof value === "string" ? [[key, value]] : []; })), ...(typeof summary.data?.total === "number" ? { matchedCount: summary.data.total, returnedCount: summary.data.items?.length ?? 0, source: summary.meta?.source ?? null, sourceVersionIds: versionIds } : {}), ...(typeof args.pageSize === "number" ? { pageSize: args.pageSize } : {}), ...(typeof args.table === "string" ? { table: args.table } : {}), ...(typeof args.resource === "string" ? { resource: args.resource } : {}) });
      await prisma.amazonMcpCredential.updateMany({ where: { id: identity.id, status: "ACTIVE" }, data: { lastUsedAt: new Date() } });
      return result;
    });
  } catch (caught) {
    const error = caught instanceof AdsQueryError ? new SyncInputError(caught.message, caught.status) : caught;
    await audit(scope, actor, "amazon.mcp.tool.denied", { requestId, credentialId: identity.id, tool: amazonMcpTools.some(([name]) => name === tool) ? tool : "UNKNOWN", scopes: requested, reason: error instanceof SyncInputError ? `REQUEST_REJECTED_${error.status}` : "INTERNAL_FAILURE" });
    throw error;
  }
}


type McpInvocationContext = { identity: McpIdentity; raw: unknown; requestId: string };
const registeredAmazonMcpTools = bindAmazonMcpHandlers<McpInvocationContext, unknown>({
  "amazon.ads.reports.list": context => invokeRegisteredAmazonMcp(context.identity, "amazon.ads.reports.list", context.raw, context.requestId),
  "amazon.ads.entities.list": context => invokeRegisteredAmazonMcp(context.identity, "amazon.ads.entities.list", context.raw, context.requestId),
  "ads_list_entities": context => invokeRegisteredAmazonMcp(context.identity, "ads_list_entities", context.raw, context.requestId),
  "ads_get_campaign_structure": context => invokeRegisteredAmazonMcp(context.identity, "ads_get_campaign_structure", context.raw, context.requestId),
  "ads_get_sync_status": context => invokeRegisteredAmazonMcp(context.identity, "ads_get_sync_status", context.raw, context.requestId),
  "ads_get_data_health": context => invokeRegisteredAmazonMcp(context.identity, "ads_get_data_health", context.raw, context.requestId),
  "ads_get_connection_status": context => invokeRegisteredAmazonMcp(context.identity, "ads_get_connection_status", context.raw, context.requestId),
  "ads_get_settings": context => invokeRegisteredAmazonMcp(context.identity, "ads_get_settings", context.raw, context.requestId),
  "amazon.stores.list": context => invokeRegisteredAmazonMcp(context.identity, "amazon.stores.list", context.raw, context.requestId),
  "amazon.inventory.list": context => invokeRegisteredAmazonMcp(context.identity, "amazon.inventory.list", context.raw, context.requestId),
  "amazon.inventory.summary": context => invokeRegisteredAmazonMcp(context.identity, "amazon.inventory.summary", context.raw, context.requestId),
  "amazon.catalog.list": context => invokeRegisteredAmazonMcp(context.identity, "amazon.catalog.list", context.raw, context.requestId),
  "amazon.sales.list": context => invokeRegisteredAmazonMcp(context.identity, "amazon.sales.list", context.raw, context.requestId),
  "amazon.sync.status": context => invokeRegisteredAmazonMcp(context.identity, "amazon.sync.status", context.raw, context.requestId),
  "amazon.history.read": context => invokeRegisteredAmazonMcp(context.identity, "amazon.history.read", context.raw, context.requestId),
  "amazon.sales.export": context => invokeRegisteredAmazonMcp(context.identity, "amazon.sales.export", context.raw, context.requestId),
  "data_list_tables": context => invokeRegisteredAmazonMcp(context.identity, "data_list_tables", context.raw, context.requestId),
  "data_describe_table": context => invokeRegisteredAmazonMcp(context.identity, "data_describe_table", context.raw, context.requestId),
  "data_query": context => invokeRegisteredAmazonMcp(context.identity, "data_query", context.raw, context.requestId),
  "data_sync_status": context => invokeRegisteredAmazonMcp(context.identity, "data_sync_status", context.raw, context.requestId),
  "data_sync_start": context => invokeRegisteredAmazonMcp(context.identity, "data_sync_start", context.raw, context.requestId),
});

/** Refresh on every discovery. At most three action groups, never one DB traversal per tool. */
export async function listDiscoverableAmazonMcpTools(identity: McpIdentity, protocolVersion: string | null = null) {
  const scope = { organizationId: identity.organizationId, workspaceId: identity.workspaceId };
  const credential = await prisma.amazonMcpCredential.findFirst({
    where: { ...scope, id: identity.id, userId: identity.userId, status: "ACTIVE", expiresAt: { gt: new Date() } },
    select: { tools: true, scopes: true, revision: true, expiresAt: true },
  });
  if (!credential) throw new SyncInputError("工具不可访问。", 403);
  const candidates = registeredAmazonMcpTools.filter(tool => isCallableAmazonMcpTool(tool)
    && identity.tools.includes(tool.name) && credential.tools.includes(tool.name));
  const actions = [...new Set(candidates.map(tool => tool.action))];
  const resolveAction = async (action: AmazonDataAction) => {
    const tool = candidates.find(tool => tool.action === action)!;
    try {
      return await withAmazonMcpBoundary({ ...scope, userId: identity.userId, credentialId: identity.id, tool: tool.name, action }, async () => {
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
  const allowed = new Set<AmazonDataAction>();
  for (const action of actions) {
    const previous = before.get(action)!;
    const current = await resolveAction(action);
    // Do not release discovery after an in-flight binding change, even if source IDs survive.
    const unchanged = previous.length > 0 && previous.every(source => current.some(live => live.id === source.id
      && live.revision === source.revision && live.authorizationId === source.authorizationId
      && live.sellerAccountId === source.sellerAccountId && live.marketplaceId === source.marketplaceId
      && live.resource === source.resource && live.authorization.amazonSellerId === source.authorization.amazonSellerId
      && live.authorization.awsRegion === source.authorization.awsRegion));
    if (unchanged && (action !== "sync" || current.some(source => ["inventory", "catalog", "sales_traffic"].includes(source.resource)))) allowed.add(action);
  }
  const latest = await prisma.amazonMcpCredential.findFirst({
    where: { ...scope, id: identity.id, userId: identity.userId, status: "ACTIVE", expiresAt: { gt: new Date() } },
    select: { tools: true, scopes: true, revision: true, expiresAt: true },
  });
  if (!latest || latest.revision !== credential.revision || latest.expiresAt.getTime() !== credential.expiresAt.getTime()
    || JSON.stringify(latest.scopes) !== JSON.stringify(credential.scopes) || JSON.stringify(latest.tools) !== JSON.stringify(credential.tools)) {
    throw new SyncInputError("工具不可访问。", 403);
  }
  return candidates.filter(tool => allowed.has(tool.action)).map(tool => mcpDiscoveryDescriptor(tool, protocolVersion));
}

export async function invokeAmazonMcp(identity: McpIdentity, tool: string, raw: unknown, requestId: string = randomUUID()) {
  const registered = registeredAmazonMcpTools.find(item => item.name === tool);
  if (!registered || !isCallableAmazonMcpTool(registered)) {
    await audit(identity, identity.userId, "amazon.mcp.tool.denied", { requestId, credentialId: identity.id, tool: "UNKNOWN", reason: "TOOL_UNAVAILABLE" });
    throw new SyncInputError("工具不可访问。", 403);
  }
  return registered.handler({ identity, raw, requestId });
}
