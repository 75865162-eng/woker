import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { amazonAccountReadAccess } from "./read-account";
import { amazonBusinessData, parseAmazonBusinessJson } from "./business-data";
import { unseal } from "./approval-policy";
import { responseArchiveHashMatches } from "./response-evidence";
import { isObservationResource } from "./observation-policy";
import { readTsv } from "./domain-reports";
import { SyncInputError, type SyncScope } from "./policy";
import { auditAmazonDataRead } from "./read-audit";

const maxBytes = 4 * 1024 * 1024;

/** A projection of the immutable source, never a replacement for published facts.
 * Sanitize before selecting paths, so a path cannot bypass the secret boundary.
 */
export function projectArchivedBusinessData(text: string, format: "JSON" | "REPORT", pointer: string, page: number, pageSize: number) {
  if (Buffer.byteLength(text, "utf8") > maxBytes) throw new SyncInputError("原件超过单次读取容量（4 MiB）。", 409);
  if (format === "JSON" || /^[\s]*[\[{]/.test(text)) {
    let value: Prisma.JsonValue;
    try { value = parseAmazonBusinessJson(text); }
    catch { throw new SyncInputError("原件 JSON 无法安全解析或超过解析容量。", 409); }
    if (pointer) {
      if (!pointer.startsWith("/") || pointer.length > 2048 || /~(?:[^01]|$)/.test(pointer)) throw new SyncInputError("JSON 路径须使用 RFC 6901 JSON Pointer。");
      for (const token of pointer.slice(1).split("/").map(part => part.replace(/~1/g, "/").replace(/~0/g, "~"))) {
        if (!value || typeof value !== "object" || !Object.hasOwn(value, token)) throw new SyncInputError("原件中不存在可读取的请求路径。", 404);
        value = (value as Record<string, Prisma.JsonValue>)[token];
      }
    }
    const values = Array.isArray(value) ? value : [value];
    return { format: "JSON" as const, items: values.slice((page - 1) * pageSize, page * pageSize), total: values.length, columns: null };
  }
  if (pointer) throw new SyncInputError("TSV 原件不接受 JSON 路径。");
  if (!text.includes("\t")) throw new SyncInputError("原件格式暂不支持业务读取；原件仍保留。", 409);
  const iterator = readTsv(text);
  const header = iterator.next();
  if (header.done || !header.value.length) throw new SyncInputError("报告原件缺少表头。", 409);
  const columns = header.value;
  const items: Array<{ values: Prisma.JsonValue[] }> = [];
  let total = 0;
  for (const cells of iterator) {
    if (cells.length !== columns.length) throw new SyncInputError("报告行与表头不一致，无法完整读取。", 409);
    if (total >= (page - 1) * pageSize && total < page * pageSize) {
      items.push({ values: cells.map((cell, index) => {
        const safe = amazonBusinessData({ [columns[index]]: cell }) as Prisma.JsonObject;
        return safe[columns[index]] ?? null;
      }) });
    }
    total++;
  }
  return { format: "TSV" as const, items, total, columns };
}

export async function readArchivedBusinessData(scope: SyncScope, params: URLSearchParams, actor: string) {
  scope = { organizationId: scope.organizationId, workspaceId: scope.workspaceId };
  const textParam = (key: string) => {
    const value = params.get(key);
    if (!value || value.length > 200 || params.getAll(key).length !== 1) throw new SyncInputError(`须指定唯一 ${key}。`);
    return value;
  };
  const sourceId = textParam("sourceId"), taskId = textParam("taskId");
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const raw = params.get(key);
    if (params.getAll(key).length > 1 || raw !== null && !/^-?\d+$/.test(raw)) throw new SyncInputError("原件分页参数无效。");
    const value = raw === null ? fallback : Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new SyncInputError("原件分页参数无效。");
    return value;
  };
  const rawPage = integer("rawPage", 0, -2147483648, 2147483647);
  if (!rawPage) throw new SyncInputError("须指定非零 rawPage。");
  const page = integer("page", 1, 1, 10000), pageSize = integer("pageSize", 20, 1, 100);
  if (params.getAll("pointer").length > 1) throw new SyncInputError("须指定唯一路径。");
  const pointer = params.get("pointer") ?? "";
  const resolveSource = async (db: Prisma.TransactionClient) => {
    const access = await amazonAccountReadAccess(scope, actor, params, db);
    const source = await db.amazonSyncDataSource.findFirst({ where: { ...scope, id: sourceId, sellerAccountId: { in: access.sellerIds } },
      select: { id: true, sellerAccountId: true, marketplaceId: true, resource: true, authorizationId: true, revision: true } });
    if (!source) throw new SyncInputError("原件来源不属于当前账号。", 403);
    return source;
  };
  const result = await prisma.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    await tx.$executeRaw`SET LOCAL statement_timeout = '8000ms'`;
    const source = await resolveSource(tx);
    const task = await tx.amazonSyncRun.findFirst({ where: { ...scope, id: taskId, sourceId, resource: source.resource, executionVersion: 2 }, select: { id: true, stage: true, status: true } });
    if (!task || task.stage === "PURGED") throw new SyncInputError("原件任务不可访问。", 403);
    // Fetch length first; never load an unbounded encrypted report into the query process.
    const sizes = await tx.$queryRaw<Array<{ size: number }>>`SELECT length("rawCiphertext") AS size FROM "AmazonSyncRawPage" WHERE "organizationId" = ${scope.organizationId} AND "workspaceId" = ${scope.workspaceId} AND "taskId" = ${taskId} AND "resource" = ${source.resource} AND "page" = ${rawPage}`;
    if (!sizes.length) throw new SyncInputError("原件页不存在。", 404);
    if (sizes[0].size > 6 * 1024 * 1024) throw new SyncInputError("原件超过单次读取容量。", 409);
    const raw = await tx.amazonSyncRawPage.findFirstOrThrow({ where: { ...scope, taskId, resource: source.resource, page: rawPage } });
    const metadata = raw.requestMetadata && typeof raw.requestMetadata === "object" && !Array.isArray(raw.requestMetadata) ? raw.requestMetadata : {};
    const context = isObservationResource(source.resource) ? "amazon-observation-raw.v1"
      : source.resource === "catalog" && metadata.operation === "getReportDocument" ? "amazon-catalog-report-raw.v1"
        : source.resource === "sales_traffic" ? "amazon-sales-traffic-raw.v1" : `amazon-${source.resource}-raw.v1`;
    const envelope = unseal(raw.rawCiphertext, scope, `${taskId}:${rawPage}`, context);
    const text = typeof envelope.rawBody === "string" ? envelope.rawBody : envelope.rawText;
    if (typeof text !== "string" || !responseArchiveHashMatches(text, raw.bodySha256)) throw new SyncInputError("原件摘要校验失败。", 409);
    const data = projectArchivedBusinessData(text, typeof envelope.rawBody === "string" ? "JSON" : "REPORT", pointer, page, pageSize);
    if (Buffer.byteLength(JSON.stringify(data), "utf8") > 512 * 1024) throw new SyncInputError("结果超过单次读取容量，请选择更深 JSON 路径或减小 pageSize。", 409);
    return { source, data, taskStatus: task.status, capturedAt: raw.capturedAt, bodySha256: raw.bodySha256 };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 20000 });
  const current = await resolveSource(prisma);
  if (JSON.stringify(current) !== JSON.stringify(result.source)) throw new SyncInputError("原件来源在查询期间发生变化。", 403);
  await auditAmazonDataRead(scope, actor, "archive-business-data");
  return { data: result.data, pagination: { page, pageSize, total: result.data.total, hasNext: page * pageSize < result.data.total },
    meta: { source: "AmazonSyncRawPage", ...result.source, taskId, rawPage, pointer, taskStatus: result.taskStatus, capturedAt: result.capturedAt, bodySha256: result.bodySha256,
      numberEncoding: "EXACT_SOURCE_TEXT", dataIntegrity: "ARCHIVED_SOURCE_NOT_PUBLISHED_FACTS", warnings: ["原件业务数据不代表结构化发布成功、全部历史或完整账号覆盖。秘密字段及分页令牌不返回。"] } };
}
