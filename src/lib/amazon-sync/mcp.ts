import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { amazonDataAccess, assertAmazonScopeAdmin, explicitAmazonDataAccess, parseAccessScopes, sellerAccessWhere, withAmazonMcpBoundary, type AmazonAccessScope, type AmazonDataAction } from "./data-access";
import { requiredText, SyncInputError, type SyncScope } from "./policy";
import { readTaskSnapshot } from "./snapshots";
import { readSalesTraffic } from "./sales-query";
import { availableSkillTables, describeSkillTable, querySkillTable, skillTableAvailability } from "./skill-data";
import { requestChange } from "./change-approval";

export const amazonMcpTools = [
  ["amazon.stores.list", "查询当前授权店铺和站点"], ["amazon.inventory.list", "查询最近已同步的库存"],
  ["amazon.inventory.summary", "汇总授权库存"], ["amazon.catalog.list", "查询最近已同步的刊登"],
  ["amazon.sales.list", "查询店铺逐日销售流量快照"], ["amazon.sync.status", "查询同步状态"],
  ["amazon.history.read", "查询成功同步的历史库存或刊登快照"], ["amazon.sales.export", "导出最多 1000 条授权销售快照"],
  ["data_list_tables", "列出当前授权范围内有已发布数据的 Skill 逻辑表"],
  ["data_describe_table", "查看已接入 Skill 逻辑表的字段、粒度和限制"],
  ["data_query", "分页查询已接入 Skill 逻辑表的已发布数据"],
  ["data_sync_status", "查询当前授权数据源和同步状态"],
  ["data_sync_start", "提交同步申请；审批并应用后才会创建同步任务"],
] as const;
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
    if (!authorizedProfiles.length) return tables;
    const versions = await prisma.amazonAdsReportVersion.findMany({ where: { ...scope, status: "PUBLISHED", sourceTask: { status: "SUCCEEDED" }, profile: { ...scope, OR: authorizedProfiles } }, select: { profileId: true, rowCount: true, publishedAt: true } });
    const publishedAt = versions.map(version => version.publishedAt).filter((value): value is Date => !!value);
    tables.push({ name: "ads_report_daily", source: "AmazonAdsReportFact", grain: ["sellerAccountId", "marketplaceId", "reportType", "adProduct", "reportDate", "factKey", "versionId"], warnings: ["只展示完整成功任务的已发布版本。", "金额按行返回；不得跨币种汇总。", "Amazon 报表真实样本仍待核验。"], schemaStatus: "application_schema_confirmed_source_sample_pending", available: versions.length > 0, sourceCount: new Set(versions.map(version => version.profileId)).size, rowCount: versions.reduce((total, version) => total + version.rowCount, 0), lastSyncAt: publishedAt.length ? new Date(Math.max(...publishedAt.map(value => value.getTime()))).toISOString() : null, freshness: versions.length ? "ok" : "missing" });
    return tables;
  }
  catch (e) { if (e instanceof SyncInputError && e.status === 403) return skillTableAvailability([]); throw e; }
}
async function hasPublishedAdsReports(scope: SyncScope, sources: Awaited<ReturnType<typeof explicitSources>>) {
  const authorizedProfiles = sources.map(source => ({ sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId }));
  return authorizedProfiles.length > 0 && !!await prisma.amazonAdsReportVersion.findFirst({ where: { ...scope, status: "PUBLISHED", sourceTask: { status: "SUCCEEDED" }, profile: { ...scope, OR: authorizedProfiles } }, select: { id: true } });
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
function argumentsObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SyncInputError("参数无效。");
  const args = value as Record<string, unknown>;
  if (args.sellerAccountId !== undefined && args.sellerAccountIds !== undefined) throw new SyncInputError("参数无效。");
  const allowed = ["sellerAccountId", "sellerAccountIds", "marketplaceId", "from", "to", "keyword", "page", "pageSize", "taskId", "table", "filters", "resource", "dateFrom", "dateTo"];
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
export async function invokeAmazonMcp(identity: McpIdentity, tool: string, raw: unknown, requestId = randomUUID()) {
  const scope = { organizationId: identity.organizationId, workspaceId: identity.workspaceId }, actor = identity.userId;
  const action: AmazonDataAction = tool === "amazon.sales.export" ? "export" : tool === "data_sync_start" ? "sync" : "view";
  let requested: AmazonAccessScope[] = [];
  try {
    if (!identity.tools.includes(tool) || !amazonMcpTools.some(([name]) => name === tool)) throw new SyncInputError("工具不可访问。", 403);
    const args = argumentsObject(raw);
    return await withAmazonMcpBoundary({ ...scope, userId: actor, credentialId: identity.id, tool, action }, async () => {
      const resolve = async () => {
        const access = await amazonDataAccess(scope, actor);
        return verifiedSources(prisma, scope, sellerAccessWhere(access));
      };
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
      if (tool === "data_list_tables") {
        const tables = availableSkillTables(selected);
        if (await hasPublishedAdsReports(scope, selected)) tables.push({ name: "ads_report_daily", source: "AmazonAdsReportFact", grain: ["sellerAccountId", "marketplaceId", "reportType", "adProduct", "reportDate", "factKey", "versionId"], schemaStatus: "application_schema_confirmed_source_sample_pending", warnings: ["只展示完整成功任务的已发布版本。", "金额按行返回；不得跨币种汇总。", "Amazon 报表真实样本仍待核验。"] });
        const resources = new Set<string>(tables.filter(table => table.name !== "ads_report_daily").map(table => table.name === "inventory" ? "inventory" : table.name === "listings" ? "catalog" : "sales_traffic"));
        const tableSources = selected.filter(source => resources.has(source.resource));
        result = { data: { items: tables, total: tables.length }, meta: dataMeta(tableSources, "AmazonSyncDataSource", ["sellerAccountId", "marketplaceId", "resource"]) };
      } else if (tool === "data_describe_table") {
        const table = requiredText(args.table, "逻辑表", 100);
        if (table === "ads_report_daily" && !await hasPublishedAdsReports(scope, selected)) throw new SyncInputError("TABLE_NOT_ALLOWED: 当前授权范围没有该表的已发布数据源。", 403);
        const description = describeSkillTable(table, selected);
        result = { data: { table: description }, meta: dataMeta([], "Prisma application schema", description.grain, description.warnings, "schema") };
      } else if (tool === "data_query") {
        const table = requiredText(args.table, "逻辑表", 100);
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
        } else {
        const where = { ...common, OR: published.filter(s => s.resource === "inventory" && s.activeRunId).map(s => ({ sellerAccountId: s.sellerAccountId, marketplaceId: s.marketplaceId, syncRunId: s.activeRunId! })) };
        result = tool === "amazon.inventory.summary" ? { summary: await prisma.amazonInventorySnapshot.aggregate({ where, _sum: { fulfillableQuantity: true, inboundWorkingQuantity: true, inboundShippedQuantity: true, inboundReceivingQuantity: true }, _count: { _all: true } }), source: "amazon_sp_api_snapshot" } : { rows: await prisma.amazonInventorySnapshot.findMany({ where, select: { sellerAccountId: true, marketplaceId: true, sellerSku: true, asin: true, fulfillableQuantity: true, capturedAt: true, syncRunId: true }, orderBy: { id: "asc" }, skip: (page - 1) * 50, take: 50 }), source: "amazon_sp_api_snapshot" };
        }
      }
      const live = await resolve();
      // The source ID alone is not a fence against an in-flight binding change.
      if (selected.some(s => !live.some(l => l.id === s.id && l.revision === s.revision && l.authorizationId === s.authorizationId && l.sellerAccountId === s.sellerAccountId && l.marketplaceId === s.marketplaceId && l.resource === s.resource && l.authorization.amazonSellerId === s.authorization.amazonSellerId && l.authorization.awsRegion === s.authorization.awsRegion))) throw new SyncInputError("数据范围不可访问。", 403);
      const filters = args.filters && typeof args.filters === "object" ? args.filters as Record<string, unknown> : {};
      await audit(scope, actor, "amazon.mcp.tool.succeeded", { requestId, credentialId: identity.id, tool, scopes: requested,
        from: typeof args.from === "string" ? args.from : typeof filters.from === "string" ? filters.from : typeof args.dateFrom === "string" ? args.dateFrom : null,
        to: typeof args.to === "string" ? args.to : typeof filters.to === "string" ? filters.to : typeof args.dateTo === "string" ? args.dateTo : null,
        page, ...(typeof args.pageSize === "number" ? { pageSize: args.pageSize } : {}), ...(typeof args.table === "string" ? { table: args.table } : {}), ...(typeof args.resource === "string" ? { resource: args.resource } : {}) });
      await prisma.amazonMcpCredential.updateMany({ where: { id: identity.id, status: "ACTIVE" }, data: { lastUsedAt: new Date() } });
      return result;
    });
  } catch (error) {
    await audit(scope, actor, "amazon.mcp.tool.denied", { requestId, credentialId: identity.id, tool: amazonMcpTools.some(([name]) => name === tool) ? tool : "UNKNOWN", scopes: requested, reason: error instanceof SyncInputError ? `REQUEST_REJECTED_${error.status}` : "INTERNAL_FAILURE" });
    throw error;
  }
}
