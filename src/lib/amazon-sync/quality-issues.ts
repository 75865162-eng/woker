import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { amazonDataAccess, sourceAccessWhere } from "./data-access";
import { SyncInputError, type SyncScope } from "./policy";

export type ReportQualityCode = "CURRENCY_MISSING" | "ORDER_MATCH_PENDING" | "SKU_ATTRIBUTION_PENDING" | "DATE_COVERAGE_INCOMPLETE";
const entityType = "AmazonSyncQualityIssue";
const action = "amazon.sync.quality.checked";
const registeredChecks: ReportQualityCode[] = ["CURRENCY_MISSING", "SKU_ATTRIBUTION_PENDING", "DATE_COVERAGE_INCOMPLETE"];
const reason: Record<ReportQualityCode, string> = {
  CURRENCY_MISSING: "报告金额已保存但结构化币种为空；须核对加密原件与映射，不推断币种。",
  ORDER_MATCH_PENDING: "官方订单关联证据尚未完成核验。",
  SKU_ATTRIBUTION_PENDING: "报告行缺少完整的站点或商品关联证据，当前不可作为已归属事实。",
  DATE_COVERAGE_INCOMPLETE: "冻结报告窗口存在缺日、缺失指标或业务周期未闭合。",
};
const object = (v: unknown): Prisma.JsonObject => v && typeof v === "object" && !Array.isArray(v) ? v as Prisma.JsonObject : {};

export function qualityIssueId(scope: SyncScope, sourceId: string, reportId: string, code: ReportQualityCode) {
  return createHash("sha256").update(JSON.stringify([scope.organizationId, scope.workspaceId, sourceId, reportId, code])).digest("hex");
}

/** Caller holds scopeLock. Append every check; never mutate/delete a previous
 * discovery or resolution. Evidence contains counts/identifiers, never raw rows. */
export async function recordReportQualityIssue(tx: Prisma.TransactionClient, scope: SyncScope, actor: string, input: {
  sourceId: string; taskId: string; reportId: string; code: ReportQualityCode;
  affectedRows: number; affectedFields: string[]; from?: string; to?: string;
  rawSha256: string; checkedAt: Date;
}) {
  if (!Number.isSafeInteger(input.affectedRows) || input.affectedRows < 0 || !/^[a-f0-9]{64}$/.test(input.rawSha256)) throw new SyncInputError("质量证据计数或原件摘要无效。", 409);
  const source = await tx.amazonSyncDataSource.findFirstOrThrow({ where: { ...scope, id: input.sourceId }, select: { sellerAccountId: true, marketplaceId: true, resource: true, authorizationId: true, authorization: { select: { revision: true } } } });
  const issueId = qualityIssueId(scope, input.sourceId, input.reportId, input.code);
  const prior = await tx.auditLog.findFirst({ where: { organizationId: scope.organizationId, entityType, entityId: issueId, action }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { metadata: true } });
  if (!prior && input.affectedRows === 0) return;
  const previous = object(prior?.metadata), checkedAt = input.checkedAt.toISOString();
  const status = input.affectedRows > 0 ? "OPEN" : "RESOLVED";
  await tx.auditLog.create({ data: { id: randomUUID(), organizationId: scope.organizationId, userId: actor, action, entityType, entityId: issueId, metadata: {
    version: 1, issueId, workspaceId: scope.workspaceId, sourceId: input.sourceId, sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, resource: source.resource, authorizationId: source.authorizationId, authorizationRevision: source.authorization.revision,
    reportId: input.reportId, taskId: input.taskId, code: input.code, status, reason: reason[input.code],
    affectedFields: input.affectedFields, affectedRows: input.affectedRows,
    countMeaning: input.code === "DATE_COVERAGE_INCOMPLETE" ? "MISSING_DATES_PLUS_INVALID_ROWS_PLUS_UNCLOSED_PERIOD" : "REPORT_ROWS",
    requestedFrom: input.from ?? null, requestedTo: input.to ?? null,
    firstDetectedAt: typeof previous.firstDetectedAt === "string" ? previous.firstDetectedAt : checkedAt,
    lastCheckedAt: checkedAt, resolvedAt: status === "RESOLVED" ? checkedAt : null,
    evidence: { rawSha256: input.rawSha256, taskId: input.taskId, reportId: input.reportId, affectedRows: input.affectedRows },
    ...(status === "RESOLVED" ? { resolutionEvidence: { rawSha256: input.rawSha256, taskId: input.taskId, checkedAt, remainingRows: 0 } } : {}),
  } } });
}

/** Ordinary DTO exposes scoped quality metadata, never raw archives or audit
 * events from a different tenant/source. A bounded scan is explicitly partial. */
export async function readQualityIssues(scope: SyncScope, params: URLSearchParams, actor: string) {
  const requestedIssue = params.get("issueId");
  if (requestedIssue && !/^[a-f0-9]{64}$/.test(requestedIssue)) throw new SyncInputError("质量问题 ID 无效。");
  const status = params.get("status");
  if (status && !["OPEN", "RESOLVED"].includes(status)) throw new SyncInputError("质量问题状态无效。");
  const access = await amazonDataAccess(scope, actor);
  const filters = Object.fromEntries(["sourceId", "sellerAccountId", "marketplaceId", "resource"].flatMap(key => {
    const value = params.get(key); if (!value) return [];
    if (value.length > 200) throw new SyncInputError("质量筛选长度超限。");
    return [[key === "sourceId" ? "id" : key, value]];
  }));
  const sources = await prisma.amazonSyncDataSource.findMany({ where: { AND: [scope, sourceAccessWhere(access), filters] }, select: { id: true }, take: 201 });
  if (sources.length > 200) throw new SyncInputError("质量问题查询超过 200 个数据源，请缩小范围。", 409);
  if (!sources.length) return { issues: [], evidenceTruncated: false, complete: true, registeredChecks, persistence: "APPEND_ONLY_AUDIT_EVENTS", scope: "REGISTERED_REPORT_CHECKS_ONLY" };
  const events = await prisma.auditLog.findMany({ where: { organizationId: scope.organizationId, action, entityType, ...(requestedIssue ? { entityId: requestedIssue } : {}),
    AND: [{ metadata: { path: ["workspaceId"], equals: scope.workspaceId } }, { OR: sources.map(s => ({ metadata: { path: ["sourceId"], equals: s.id } })) }] },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 1001, select: { id: true, entityId: true, metadata: true, createdAt: true } });
  const latest = new Map<string, Prisma.JsonObject>();
  for (const event of events.slice(0, 1000)) if (event.entityId && !latest.has(event.entityId)) latest.set(event.entityId, { ...object(event.metadata), eventId: event.id });
  const currentAccess = await amazonDataAccess(scope, actor);
  const stillAccessible = await prisma.amazonSyncDataSource.count({ where: { AND: [scope, sourceAccessWhere(currentAccess), { id: { in: sources.map(source => source.id) } }] } });
  if (stillAccessible !== sources.length) throw new SyncInputError("质量问题的数据访问范围已变化。", 403);
  return { issues: [...latest.values()].filter(issue => !status || issue.status === status), evidenceTruncated: events.length > 1000,
    ...(requestedIssue ? { history: events.slice(0, 1000).map(event => ({ ...object(event.metadata), eventId: event.id, recordedAt: event.createdAt.toISOString() })) } : {}),
    complete: events.length <= 1000, registeredChecks,
    persistence: "APPEND_ONLY_AUDIT_EVENTS", scope: "REGISTERED_REPORT_CHECKS_ONLY" };
}
