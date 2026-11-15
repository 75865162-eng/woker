import { randomUUID } from "node:crypto";
import { assertSellfoxReadonlyEndpoint } from "./endpoint-safety";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { enqueueSellfoxSyncRun } from "@/lib/queue";
import { getSellfoxCredentialStatus } from "./credential-store";
import { canExecuteSellfoxSync } from "./sync-authorization";
import { sellfoxDateAt, sellfoxEndpointResource } from "./sync-contract";
import {
  builtinSyncRules, sellfoxDateChunks, sellfoxSpanDays, splitSellfoxDateChunk,
  isSellfoxChunkTooWide, addSellfoxDays, endpointSyncRule, isSellfoxEndpointResource,
  type SyncDateMode,
} from "./sync-rules";

/**
 * 全自动同步编排器：注册表 → 全量计划 → run → 队列 → 断点 → 分片。
 *
 * 后台配置/启用一个新 API 端点后无需任何脚本：
 * worker 每 30 秒调用 planSellfoxEndpointAuto()，按「历史回填游标 + 每日滚动窗口」
 * 自动生成 run；失败块由 handleSellfoxAdaptiveSplits() 自动对半拆到 1 天。
 * 一键全量（后台按钮 / API）走同一个 buildSellfoxFullSyncPlan() 纯函数。
 */

export type SyncScope = { organizationId: string; workspaceId: string; userId?: string };
export type FullSyncPlanItem = {
  resource: string; label: string; trigger: string;
  startDate?: string; endDate?: string; reportDate?: string; endpointCode?: string;
};

export type EndpointPlanInput = { code: string; label: string; dateMode: SyncDateMode; chunkDays: number };

/** 纯函数：把规则表展开成互不重叠的 run 计划。内置域按依赖顺序，配置端点排在后面。 */
export function buildSellfoxFullSyncPlan(input: {
  from: string; to: string; today?: string;
  builtinResources?: string[];
  endpoints?: EndpointPlanInput[];
  trigger?: string;
  limit?: number;
}): FullSyncPlanItem[] {
  const { from, to } = input;
  const today = input.today ?? addSellfoxDays(to, 1);
  const trigger = input.trigger ?? "auto_full";
  const limit = input.limit ?? 500;
  const selected = new Set(input.builtinResources ?? builtinSyncRules.map((rule) => rule.id));
  const items: FullSyncPlanItem[] = [];
  const push = (rule: { id: string; label: string; dateMode: SyncDateMode; chunkDays: number }, endpointCode?: string) => {
    const base = { resource: rule.id, label: rule.label, trigger, ...(endpointCode ? { endpointCode } : {}) };
    if (rule.dateMode === "none") { items.push(base); return; }
    if (rule.dateMode === "current") { items.push({ ...base, reportDate: today }); return; }
    for (const chunk of sellfoxDateChunks(from, to, rule.chunkDays || 90)) items.push({ ...base, ...chunk });
  };
  for (const rule of [...builtinSyncRules].sort((a, b) => a.order - b.order)) {
    if (!selected.has(rule.id)) continue;
    push(rule);
  }
  for (const config of input.endpoints ?? []) {
    const rule = endpointSyncRule({ ...config, intervalMinutes: 1440, maxRows: 50_000 });
    push(rule, config.code);
  }
  if (items.length > limit) throw new Error(`全量计划包含 ${items.length} 个任务，超过单次上限 ${limit}，请缩小日期范围。`);
  return items;
}

function runSummary(item: FullSyncPlanItem) {
  return {
    trigger: item.trigger, shopExternalIds: [], ...(item.endpointCode ? { endpointCode: item.endpointCode } : {}),
    ...(item.resource.startsWith("ads_") ? { adTypes: ["sp", "sb", "sd"] } : {}),
    ...(item.startDate ? { startDate: item.startDate } : {}),
    ...(item.endDate ? { endDate: item.endDate } : {}),
    ...(item.reportDate ? { reportDate: item.reportDate } : {}),
    datesFrozen: true, requestVersion: 2,
  } as Prisma.InputJsonValue;
}

function bag(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** 幂等：同资源同窗口已有排队/运行/完成的任务就不再重复建。 */
async function alreadyPlanned(scope: { organizationId: string; workspaceId: string }, item: FullSyncPlanItem, client: Pick<Prisma.TransactionClient, "sellfoxSyncRun"> = prisma) {
  const runs = await client.sellfoxSyncRun.findMany({
    where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, resource: item.resource, status: { in: ["queued", "running", "done"] } },
    select: { summary: true }, orderBy: { startedAt: "desc" },
  });
  return runs.some((run) => {
    const summary = bag(run.summary);
    return (summary.startDate ?? null) === (item.startDate ?? null)
      && (summary.endDate ?? null) === (item.endDate ?? null)
      && (summary.reportDate ?? null) === (item.reportDate ?? null);
  });
}

async function createAndEnqueue(scope: SyncScope, item: FullSyncPlanItem, extra: Record<string, unknown> = {}) {
  const userId = scope.userId ?? await resolvePlanUserId(scope);
  if (!userId) throw new Error("找不到具备赛狐同步权限的操作者，无法创建自动同步任务。");
  const runId = `sellfox-sync-${randomUUID()}`;
  const created = await prisma.$transaction(async tx => {
    const lockKey = JSON.stringify([scope.organizationId, scope.workspaceId, item.resource]);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;
    if (await alreadyPlanned(scope, item, tx)) return false;
    await tx.sellfoxSyncRun.create({ data: {
      id: runId, organizationId: scope.organizationId, workspaceId: scope.workspaceId, userId,
      resource: item.resource, status: "queued",
      summary: { ...(runSummary(item) as unknown as Record<string, unknown>), ...extra } as Prisma.InputJsonValue,
    } });
    return true;
  });
  if (!created) return null;
  try { await enqueueSellfoxSyncRun(runId); }
  catch { /* queued run 由 worker 恢复循环兜底入队 */ }
  return runId;
}

async function resolvePlanUserId(scope: { organizationId: string; workspaceId: string }) {
  const schedule = await prisma.sellfoxSyncSchedule.findFirst({ where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, enabled: true }, select: { userId: true } });
  if (schedule?.userId) return schedule.userId;
  const owner = await prisma.organizationMember.findFirst({ where: { organizationId: scope.organizationId, role: "owner" }, select: { userId: true } });
  return owner?.userId ?? null;
}

/** 一键全量：内置资源 + 已启用端点，按规则自动分块、幂等跳过。 */
export async function planSellfoxFullSync(scope: SyncScope, options: {
  from?: string; to?: string; resources?: string[]; endpointCodes?: string[]; trigger?: string;
} = {}) {
  const to = options.to ?? sellfoxDateAt(new Date(), -1);
  const from = options.from ?? addSellfoxDays(to, -89);
  // 凭据查询的 unique where 只接受组织/工作区，userId 属于权限校验参数，不能混进 scope。
  if (!(await getSellfoxCredentialStatus({ organizationId: scope.organizationId, workspaceId: scope.workspaceId })).configured) throw new Error("服务端赛狐凭据未配置。");
  if (scope.userId && !(await canExecuteSellfoxSync({ organizationId: scope.organizationId, workspaceId: scope.workspaceId, userId: scope.userId }))) throw new Error("当前用户没有赛狐同步权限。");
  const endpoints = await prisma.sellfoxApiEndpoint.findMany({
    where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, enabled: true,
      ...(options.endpointCodes?.length ? { code: { in: options.endpointCodes } } : {}) },
    select: { code: true, label: true, dateMode: true, chunkDays: true }, orderBy: { code: "asc" },
  });
  const items = buildSellfoxFullSyncPlan({
    from, to, trigger: options.trigger ?? "auto_full",
    builtinResources: options.resources,
    endpoints: endpoints.map((row) => ({
      code: row.code, label: row.label,
      dateMode: (["none", "current", "range"].includes(row.dateMode) ? row.dateMode : "range") as SyncDateMode,
      chunkDays: row.chunkDays,
    })),
  });
  const created: string[] = []; let skipped = 0;
  for (const item of items) {
    if (await alreadyPlanned(scope, item)) { skipped += 1; continue; }
    const runId = await createAndEnqueue(scope, item, { planFrom: from, planTo: to });
    if (runId) created.push(runId); else skipped += 1;
  }
  return { from, to, total: items.length, created: created.length, skipped, runIds: created };
}

/** 端点自动计划：历史窗口按游标逐块推进，回填完成后每天滚动重跑最近 7 天。 */
export async function planSellfoxEndpointAuto(now = new Date()) {
  const groups = await prisma.sellfoxApiEndpoint.findMany({
    where: { enabled: true }, distinct: ["organizationId", "workspaceId"],
    select: { organizationId: true, workspaceId: true },
  });
  let created = 0;
  for (const scope of groups) {
    if (!(await getSellfoxCredentialStatus(scope)).configured) continue;
    const endpoints = await prisma.sellfoxApiEndpoint.findMany({
      where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, enabled: true },
      orderBy: { code: "asc" },
    });
    for (const endpoint of endpoints) {
      const resource = sellfoxEndpointResource(endpoint.code);
      const active = await prisma.sellfoxSyncRun.findFirst({ where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, resource, status: { in: ["queued", "running"] } }, select: { id: true } });
      if (active) continue;
      const yesterday = sellfoxDateAt(now, -1);
      const today = sellfoxDateAt(now);
      const dateMode = (["none", "current", "range"].includes(endpoint.dateMode) ? endpoint.dateMode : "range") as SyncDateMode;
      if (dateMode !== "range") {
        const plannedToday = endpoint.lastPlannedAt && sellfoxDateAt(endpoint.lastPlannedAt) === today;
        if (plannedToday) continue;
        await createAndEnqueue(scope, { resource, label: endpoint.label, trigger: "endpoint_auto", endpointCode: endpoint.code, reportDate: dateMode === "current" ? today : undefined });
        await prisma.sellfoxApiEndpoint.update({ where: { id: endpoint.id }, data: { lastPlannedAt: now } });
        created += 1;
        continue;
      }
      // 只推进从历史起点连续覆盖的前缀，后段完成不跳过中间失败窗口。
      const doneRuns = await prisma.sellfoxSyncRun.findMany({
        where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, resource, status: "done" },
        orderBy: { finishedAt: "desc" }, select: { summary: true },
      });
      const historyFrom = endpoint.historyFrom ?? addSellfoxDays(yesterday, -89);
      const start = sellfoxNextUncoveredDate(historyFrom, doneRuns.map(row => bag(row.summary)));
      const item: FullSyncPlanItem = start <= yesterday
        ? { resource, label: endpoint.label, trigger: "endpoint_auto", endpointCode: endpoint.code,
            startDate: start, endDate: (() => { const end = addSellfoxDays(start, Math.max(1, endpoint.chunkDays) - 1); return end > yesterday ? yesterday : end; })() }
        : { resource, label: endpoint.label, trigger: "endpoint_rolling", endpointCode: endpoint.code,
            startDate: addSellfoxDays(yesterday, -6), endDate: yesterday };
      if (item.trigger === "endpoint_rolling") {
        const plannedToday = endpoint.lastPlannedAt && sellfoxDateAt(endpoint.lastPlannedAt) === today;
        if (plannedToday) continue;
        if (await alreadyPlanned(scope, item)) continue;
      }
      // 失败窗口 24h 内不重复建 run；超宽错误由 handleSellfoxAdaptiveSplits 拆成两个新窗口。
      const recent = await prisma.sellfoxSyncRun.findMany({
        where: { organizationId: scope.organizationId, workspaceId: scope.workspaceId, resource, startedAt: { gte: new Date(now.getTime() - 24 * 3_600_000) } },
        select: { summary: true }, take: 100,
      });
      if (recent.some((row) => bag(row.summary).startDate === item.startDate && bag(row.summary).endDate === item.endDate)) continue;
      await createAndEnqueue(scope, item);
      await prisma.sellfoxApiEndpoint.update({ where: { id: endpoint.id }, data: { lastPlannedAt: now, cursorDate: item.endDate ?? null } });
      created += 1;
    }
  }
  return { created, endpoints: groups.length };
}

export function sellfoxNextUncoveredDate(from: string, windows: Array<{ startDate?: unknown; endDate?: unknown }>) {
  let cursor = from;
  const intervals = windows.filter((item): item is { startDate: string; endDate: string } =>
    typeof item.startDate === "string" && typeof item.endDate === "string"
    && /^\d{4}-\d{2}-\d{2}$/.test(item.startDate) && /^\d{4}-\d{2}-\d{2}$/.test(item.endDate)
    && item.startDate <= item.endDate).sort((a, b) => a.startDate.localeCompare(b.startDate));
  for (const interval of intervals) {
    if (interval.startDate > cursor) break;
    if (interval.endDate >= cursor) cursor = addSellfoxDays(interval.endDate, 1);
  }
  return cursor;
}

/** 已完成窗口的并集是否覆盖 [from,to]；失败块若已被后续分块补齐就不再重复拉。 */
export function sellfoxWindowsCover(from: string, to: string, windows: Array<{ startDate?: unknown; endDate?: unknown }>) {
  const intervals = windows
    .map((window) => ({
      start: typeof window.startDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(window.startDate) ? window.startDate : null,
      end: typeof window.endDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(window.endDate) ? window.endDate : null,
    }))
    .filter((window): window is { start: string; end: string } => Boolean(window.start && window.end && window.start <= window.end))
    .filter((window) => window.end >= from && window.start <= to)
    .sort((a, b) => a.start.localeCompare(b.start));
  return sellfoxNextUncoveredDate(from, intervals.map(interval => ({ startDate: interval.start, endDate: interval.end }))) > to;
}

/** 失败块自动对半拆：五万行上限或端点上游 500，拆到 1 天为止，原失败 run 保留审计。 */
export async function handleSellfoxAdaptiveSplits(now = new Date()) {
  const candidates = await prisma.sellfoxSyncRun.findMany({
    where: { status: "failed", startedAt: { gte: new Date(now.getTime() - 6 * 3_600_000) } },
    orderBy: { startedAt: "desc" }, take: 60,
    select: { id: true, resource: true, error: true, organizationId: true, workspaceId: true, summary: true },
  });
  let split = 0;
  for (const run of candidates) {
    if (!run.resource.startsWith("ads_") && !isSellfoxEndpointResource(run.resource)) continue;
    const summary = bag(run.summary);
    const { startDate, endDate } = summary;
    if (typeof startDate !== "string" || typeof endDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) continue;
    if (sellfoxSpanDays(startDate, endDate) <= 1) continue;
    const error = run.error ?? "";
    const splittable = isSellfoxChunkTooWide(error) || (isSellfoxEndpointResource(run.resource) && /HTTP 200 \/ 500/.test(error));
    if (!splittable) continue;
    const existing = await prisma.sellfoxSyncRun.findFirst({ where: { organizationId: run.organizationId, workspaceId: run.workspaceId, summary: { path: ["splitFrom"], equals: run.id } }, select: { id: true } });
    if (existing) continue;
    const doneWindows = await prisma.sellfoxSyncRun.findMany({
      where: { organizationId: run.organizationId, workspaceId: run.workspaceId, resource: run.resource, status: "done" },
      orderBy: { finishedAt: "desc" }, take: 300, select: { summary: true },
    });
    if (sellfoxWindowsCover(startDate, endDate, doneWindows.map((row) => {
      const summary = bag(row.summary);
      return { startDate: summary.startDate, endDate: summary.endDate };
    }))) continue;
    const halves = splitSellfoxDateChunk(startDate, endDate);
    if (!halves) continue;
    for (const half of halves) {
      await createAndEnqueue({ organizationId: run.organizationId, workspaceId: run.workspaceId }, {
        resource: run.resource, label: run.resource, trigger: "adaptive_split", ...half,
        ...(typeof summary.endpointCode === "string" ? { endpointCode: summary.endpointCode } : {}),
      }, { splitFrom: run.id });
    }
    split += 1;
  }
  return { split };
}

/** 后台配置输入校验：拒绝非法路径/参数模板/窗口，避免把任意字符串写进执行链路。 */
export type SellfoxEndpointInput = {
  code: string; label: string; path: string; dateMode: "none" | "current" | "range";
  scopeMode: "store" | "global"; chunkDays: number; pageSize: number;
  rowsPath: string; idFields: string; params: string; dateFormat: string; maxRows: number;
  historyFrom: string | null; enabled: boolean;
};
export function validateSellfoxEndpointInput(body: Record<string, unknown>): SellfoxEndpointInput {
  const str = (key: string, fallback = "") => typeof body[key] === "string" ? (body[key] as string).trim() : fallback;
  const code = str("code");
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(code)) throw new Error("端点 code 必须是 2~64 位小写字母/数字/下划线/连字符。");
  const label = str("label") || code;
  if (label.length > 80) throw new Error("端点名称过长。");
  const path = str("path");
  if (!/^\/api\/[A-Za-z0-9_./-]{2,180}$/.test(path)) throw new Error("接口路径必须以 /api/ 开头且只含安全字符。");
  const dateMode = str("dateMode", "range");
  if (!["none", "current", "range"].includes(dateMode)) throw new Error("日期模式无效。");
  const scopeMode = str("scopeMode", "store");
  if (!["store", "global"].includes(scopeMode)) throw new Error("范围模式无效。");
  const chunkDays = Number(body.chunkDays ?? 7);
  if (!Number.isInteger(chunkDays) || chunkDays < 1 || chunkDays > 90) throw new Error("分块天数必须在 1~90 之间。");
  const pageSize = Number(body.pageSize ?? 100);
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 1000) throw new Error("分页大小必须在 1~1000 之间。");
  const maxRows = Number(body.maxRows ?? 50000);
  if (!Number.isInteger(maxRows) || maxRows < 1000 || maxRows > 100000) throw new Error("单页行数上限必须在 1000~100000 之间。");
  const params = str("params") || "{}";
  if (params.length > 4000) throw new Error("参数模板过长。");
  try { const parsed = JSON.parse(params); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); }
  catch { throw new Error("参数模板必须是 JSON 对象。"); }
  const dateFormat = str("dateFormat", "yyyy-MM-dd");
  if (!["yyyy-MM-dd", "yyyyMM", "yyyyMMdd", "MMdd"].includes(dateFormat)) throw new Error("日期格式必须是 yyyy-MM-dd / yyyyMM / yyyyMMdd / MMdd。");
  const rowsPath = str("rowsPath");
  if (rowsPath.length > 200) throw new Error("rowsPath 过长。");
  const idFields = str("idFields");
  if (idFields.length > 500) throw new Error("主键字段过长。");
  const historyFrom = str("historyFrom") || null;
  if (historyFrom && !/^\d{4}-\d{2}-\d{2}$/.test(historyFrom)) throw new Error("历史起点必须是 YYYY-MM-DD。");
  if (body.enabled === true) assertSellfoxReadonlyEndpoint({ path, params, scopeMode, dateMode, dateFormat, pageSize, chunkDays });
  return {
    code, label, path, dateMode: dateMode as SellfoxEndpointInput["dateMode"],
    scopeMode: scopeMode as SellfoxEndpointInput["scopeMode"], chunkDays, pageSize,
    rowsPath, idFields, params, dateFormat, maxRows, historyFrom,
    enabled: body.enabled === true,
  };
}

/** 控制台：端点配置 + 真实落表行数（count(*) 而非记账值）。 */
export async function sellfoxEndpointOverview(scope: { organizationId: string; workspaceId: string }) {
  const endpoints = await prisma.sellfoxApiEndpoint.findMany({
    where: scope, orderBy: { code: "asc" },
  });
  const counts = await prisma.sellfoxApiRecord.groupBy({
    by: ["endpointCode"], where: scope, _count: { _all: true }, _max: { period: true },
  });
  const runs = await prisma.sellfoxSyncRun.findMany({
    where: { ...scope, resource: { startsWith: "endpoint:" } }, orderBy: { startedAt: "desc" }, take: 60,
    select: { resource: true, status: true, error: true, startedAt: true, finishedAt: true },
  });
  return endpoints.map((endpoint) => {
    const counter = counts.find((row) => row.endpointCode === endpoint.code);
    const lastRun = runs.find((run) => run.resource === sellfoxEndpointResource(endpoint.code)) ?? null;
    return {
      id: endpoint.id, code: endpoint.code, label: endpoint.label, path: endpoint.path,
      dateMode: endpoint.dateMode, scopeMode: endpoint.scopeMode, chunkDays: endpoint.chunkDays,
      pageSize: endpoint.pageSize, rowsPath: endpoint.rowsPath, idFields: endpoint.idFields,
      params: endpoint.params, maxRows: endpoint.maxRows, enabled: endpoint.enabled,
      historyFrom: endpoint.historyFrom, cursorDate: endpoint.cursorDate, lastPlannedAt: endpoint.lastPlannedAt,
      rows: counter?._count._all ?? 0, lastPeriod: counter?._max.period ?? null,
      lastRun: lastRun ? { status: lastRun.status, error: lastRun.error, startedAt: lastRun.startedAt, finishedAt: lastRun.finishedAt } : null,
    };
  });
}
