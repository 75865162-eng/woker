import { createHash } from "node:crypto";
import { assertSellfoxReadonlyEndpoint } from "./endpoint-safety";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { sellfoxPost } from "./client";
import { fenceSellfoxRun, type SellfoxRunLease } from "./run-lease";
import { nextSellfoxPage, SellfoxSyncInputError } from "./sync-contract";
import { isSellfoxChunkTooWide } from "./sync-rules";

/**
 * 通用赛狐 API 采集器：后台配置一条 SellfoxApiEndpoint，即可按「店铺 × 日期块」自动拉全量。
 *
 * 设计边界（与全仓口径一致）：
 * - payload 保存接口原始行，不猜字段、不补零、不做金额换算；
 * - 行身份优先用配置的主键字段，缺失时回退整行内容哈希（保证幂等，不编造业务键）；
 * - 进度按单元持久化，进程被回收后同 runId 从 pageNo 断点续跑；
 * - 单块超过行数上限抛 SellfoxChunkTooWideError，由编排器自动对半拆窗口。
 */

export type SellfoxEndpointConfig = {
  code: string; label: string; path: string;
  dateMode: "none" | "current" | "range"; scopeMode: "store" | "global";
  chunkDays: number; pageSize: number; rowsPath: string; idFields: string; params: string; dateFormat: string; maxRows: number;
};

export class SellfoxChunkTooWideError extends Error {
  constructor(message: string) { super(message); this.name = "SellfoxChunkTooWideError"; }
}

type Bag = Record<string, unknown>;
function asBag(value: unknown): Bag | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Bag : null;
}

/** 参数模板占位符：${shopId}(店铺 externalId) ${shopIdNumeric}(店铺数字 ID，取自 payload.id) ${startDate} ${endDate} ${startDateRaw} ${endDateRaw}(原始 yyyy-MM-dd) ${pageNo} ${pageSize} ${today}；未知占位符原样保留。 */
export function renderSellfoxEndpointParams(template: string, vars: Record<string, string>) {
  let parsed: unknown;
  try { parsed = template.trim() ? JSON.parse(template) : {}; }
  catch { throw new SellfoxSyncInputError("端点参数模板不是合法 JSON。"); }
  if (!asBag(parsed)) throw new SellfoxSyncInputError("端点参数模板必须是 JSON 对象。");
  const render = (value: unknown): unknown => {
    if (typeof value === "string") return value.replace(/\$\{([a-zA-Z][a-zA-Z0-9_]*)\}/g, (match, key: string) => vars[key] ?? match);
    if (Array.isArray(value)) return value.map(render);
    if (asBag(value)) return Object.fromEntries(Object.entries(value as Bag).map(([key, item]) => [key, render(item)]));
    return value;
  };
  return render(parsed) as Bag;
}

/** rowsPath 为空时复用现有赛狐响应约定，避免为每个接口写解析器。 */
export function sellfoxEndpointRows(payload: unknown, rowsPath: string): Bag[] {
  let cursor = payload;
  if (rowsPath.trim()) {
    for (const key of rowsPath.split(".").map((item) => item.trim()).filter(Boolean)) {
      cursor = asBag(cursor)?.[key];
      if (cursor === undefined) throw new SellfoxSyncInputError(`端点响应缺少 rowsPath 路径：${rowsPath}。`);
    }
  }
  const collect = (value: unknown): Bag[] => {
    if (Array.isArray(value)) {
      if (value.some((row) => !asBag(row))) throw new SellfoxSyncInputError("赛狐端点列表含有无效记录。");
      return value as Bag[];
    }
    const bag = asBag(value);
    if (!bag) throw new SellfoxSyncInputError("赛狐端点响应结构无法识别。");
    // reportList：财务 V2 利润报表（monthProfit/*）实测响应行键；其余为既有赛狐约定。
    for (const key of ["rows", "records", "list", "itemList", "reportList", "data", "result"]) {
      const nested = bag[key];
      if (Array.isArray(nested) || asBag(nested)) return collect(nested);
    }
    throw new SellfoxSyncInputError("赛狐端点响应缺少有效记录列表。");
  };
  return collect(cursor);
}

export function sellfoxEndpointPageCount(payload: unknown, pageSize = 100) {
  const bag = asBag(payload) ?? {};
  const nested = asBag(bag.data) ?? {};
  const totalPage = Number(bag.totalPage ?? bag.totalPages ?? nested.totalPage ?? nested.totalPages);
  const totalSize = Number(bag.totalSize ?? bag.total ?? nested.totalSize ?? nested.total);
  if (Number.isFinite(totalPage) && totalPage > 0) return Math.floor(totalPage);
  if (Number.isFinite(totalSize) && totalSize >= 0) return Math.max(1, Math.ceil(totalSize / Math.max(1, pageSize)));
  return null;
}

/** 按端点配置的 dateFormat 把 yyyy-MM-dd 重格式化为接口需要的形态（财务类 yyyyMM / yyyyMMdd）。 */
function formatSellfoxEndpointDate(date: string, format: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const [year, month, day] = date.split("-");
  if (format === "yyyyMM") return `${year}${month}`;
  if (format === "yyyyMMdd") return `${year}${month}${day}`;
  if (format === "MMdd") return `${month}${day}`;
  return date;
}

/** 稳定序列化：对象按键排序、数组保序，保证同一行内容哈希一致。 */
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (asBag(value)) return `{${Object.entries(value as Bag).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`).join(",")}}`;
  return JSON.stringify(value ?? null);
}

/** 配置的主键字段齐全则用业务键；否则整行内容哈希，绝不编造字段值。 */
export function sellfoxEndpointRecordId(row: Bag, idFields: string) {
  const keys = idFields.split(",").map((item) => item.trim()).filter(Boolean);
  const parts = keys.map((key) => {
    const value = row[key];
    return value === undefined || value === null ? "" : String(value).trim();
  });
  if (keys.length && parts.every(Boolean)) return parts.join("|");
  return createHash("sha256").update(stable(row)).digest("hex").slice(0, 40);
}

export type GenericEndpointInput = {
  runId: string; organizationId: string; workspaceId: string;
  lease: SellfoxRunLease;
  endpoint: SellfoxEndpointConfig;
  shopExternalIds: string[];
  startDate?: string; endDate?: string;
  progress?: Record<string, unknown>;
  onProgress: (progress: Record<string, unknown>, tx?: Prisma.TransactionClient) => Promise<void>;
};

export async function syncSellfoxGenericEndpoint(input: GenericEndpointInput) {
  const { endpoint, lease } = input;
  assertSellfoxReadonlyEndpoint(endpoint);
  if (endpoint.pageSize < 1 || endpoint.pageSize > 1000) throw new SellfoxSyncInputError("端点分页大小必须在 1~1000 之间。");
  const stores = endpoint.scopeMode === "global"
    ? [{ id: null as string | null, externalId: "*", payload: null as Record<string, unknown> | null }]
    : await prisma.sellfoxStore.findMany({
        where: { organizationId: input.organizationId, workspaceId: input.workspaceId, externalId: { in: input.shopExternalIds } },
        select: { id: true, externalId: true, payload: true }, orderBy: { externalId: "asc" },
      });
  if (!stores.length) throw new SellfoxSyncInputError("端点同步没有可用店铺范围。");

  const period = input.startDate ? (input.endDate && input.endDate !== input.startDate ? `${input.startDate}..${input.endDate}` : input.startDate) : "-";
  const units = asBag(input.progress?.units) ?? {};
  let total = 0;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });

  for (const store of stores) {
    const scopeKey = store.id ? `store:${store.externalId}` : "*";
    const unitKey = `${scopeKey}|${period}`;
    const prior = asBag(units[unitKey]);
    if (prior?.done === true) { total += Number(prior.rows ?? 0) || 0; continue; }
    let pageNo = Number(prior?.pageNo ?? 1);
    if (!Number.isInteger(pageNo) || pageNo < 1 || pageNo > 10_000) throw new SellfoxSyncInputError("端点同步断点页码无效。");
    let rowsWritten = Number(prior?.rows ?? 0) || 0;
    let done = false;
    while (!done) {
      const startDateRaw = input.startDate ?? "";
      const endDateRaw = input.endDate ?? "";
      const shopIdNumeric = store.id ? String((store.payload as Record<string, unknown> | null)?.id ?? store.externalId) : "";
      const params = renderSellfoxEndpointParams(endpoint.params, {
        shopId: store.externalId, shopIdNumeric,
        startDate: formatSellfoxEndpointDate(startDateRaw, endpoint.dateFormat),
        endDate: formatSellfoxEndpointDate(endDateRaw, endpoint.dateFormat),
        startDateRaw, endDateRaw,
        pageNo: String(pageNo), pageSize: String(endpoint.pageSize), today,
      });
      let payload: unknown;
      try { payload = await sellfoxPost<unknown>(endpoint.path, params); }
      catch (error) {
        if (isSellfoxChunkTooWide(error)) throw new SellfoxChunkTooWideError(error instanceof Error ? error.message : "端点响应超过行数上限。");
        throw error;
      }
      const rows = sellfoxEndpointRows(payload, endpoint.rowsPath);
      if (rows.length > endpoint.maxRows) throw new SellfoxChunkTooWideError(`端点 ${endpoint.code} 单页返回 ${rows.length} 行，超过上限 ${endpoint.maxRows}，请缩小日期范围。`);
      await prisma.$transaction(async (tx) => {
        await fenceSellfoxRun(lease, tx);
        for (const row of rows) {
          const externalId = sellfoxEndpointRecordId(row, endpoint.idFields);
          const id = createHash("sha256").update(JSON.stringify([input.organizationId, input.workspaceId, endpoint.code, scopeKey, period, externalId])).digest("hex").slice(0, 40);
          const data = {
            payload: row as Prisma.InputJsonValue, syncedAt: new Date(), storeId: store.id,
          };
          await tx.sellfoxApiRecord.upsert({
            where: { organizationId_workspaceId_endpointCode_scopeKey_period_externalId: { organizationId: input.organizationId, workspaceId: input.workspaceId, endpointCode: endpoint.code, scopeKey, period, externalId } },
            create: { id, organizationId: input.organizationId, workspaceId: input.workspaceId, endpointCode: endpoint.code, scopeKey, period, externalId, ...data },
            update: data,
          });
        }
        units[unitKey] = { store: store.externalId, status: "running", rows: rowsWritten + rows.length, pageNo };
        await input.onProgress({ units, count: total + rowsWritten + rows.length }, tx);
      });
      rowsWritten += rows.length;
      const next = nextSellfoxPage(rows.length, pageNo, sellfoxEndpointPageCount(payload, endpoint.pageSize), endpoint.pageSize, 10_000);
      if (next === null) { done = true; units[unitKey] = { store: store.externalId, status: "done", rows: rowsWritten, pageNo, done: true }; }
      else pageNo = next;
    }
    total += rowsWritten;
    await input.onProgress({ units, count: total });
  }
  return { units, count: total, storeCount: stores.length, startDate: input.startDate ?? null, endDate: input.endDate ?? null, period };
}
