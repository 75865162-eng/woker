import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver } from "@/lib/storage";
import { sellfoxPost } from "./client";
import { MAX_REPORT_BYTES, parseSellfoxAdProductReport, sellfoxReportDownloadUrl } from "./ads-report-contract";
import { parseSellfoxAdTargetingReport } from "./ads-targeting-contract";
import { parseSellfoxAdSearchTermReport } from "./ads-search-term-contract";
import { parseSellfoxAdCampaignReport } from "./ads-campaign-contract";
import { parseSellfoxAdGroupReport } from "./ads-ad-group-contract";
import { parseSellfoxAdPlacementReport } from "./ads-placement-contract";
import { sellfoxReportDates, SellfoxSyncInputError } from "./sync-contract";
import { sellfoxCreateTaskAmbiguous, sellfoxStoreFailure, SellfoxStoreSyncError } from "./sync-errors";
async function download(url: URL) {
  const maxBytes = MAX_REPORT_BYTES();
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(60000), cache: "no-store" });
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > maxBytes) throw new SellfoxSyncInputError("广告报告下载失败或文件超限。");
  const chunks: Uint8Array[] = []; let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > maxBytes) throw new SellfoxSyncInputError("广告报告下载超过大小上限。");
      chunks.push(part.value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}
export type SellfoxCpcReportType = "adProductReport" | "adTargeringReport" | "adSearchTermReport" | "adCampaignReport" | "adGroupReport" | "adSpaceReport";
type ParsedCpcReport = { kind: "targeting"; rows: Awaited<ReturnType<typeof parseSellfoxAdTargetingReport>> }
  | { kind: "searchTerm"; rows: Awaited<ReturnType<typeof parseSellfoxAdSearchTermReport>> }
  | { kind: "campaign"; rows: Awaited<ReturnType<typeof parseSellfoxAdCampaignReport>> }
  | { kind: "adGroup"; rows: Awaited<ReturnType<typeof parseSellfoxAdGroupReport>> }
  | { kind: "placement"; rows: Awaited<ReturnType<typeof parseSellfoxAdPlacementReport>> }
  | { kind: "product"; rows: Awaited<ReturnType<typeof parseSellfoxAdProductReport>> };
async function parseSellfoxCpcShard(code: SellfoxCpcReportType, buffer: Buffer, scope: { storeName: string; startDate: string; endDate: string }): Promise<ParsedCpcReport> {
  if (code === "adTargeringReport") return { kind: "targeting", rows: await parseSellfoxAdTargetingReport(buffer, scope) };
  if (code === "adSearchTermReport") return { kind: "searchTerm", rows: await parseSellfoxAdSearchTermReport(buffer, scope) };
  if (code === "adCampaignReport") return { kind: "campaign", rows: await parseSellfoxAdCampaignReport(buffer, scope) };
  if (code === "adGroupReport") return { kind: "adGroup", rows: await parseSellfoxAdGroupReport(buffer, scope) };
  if (code === "adSpaceReport") return { kind: "placement", rows: await parseSellfoxAdPlacementReport(buffer, scope) };
  return { kind: "product", rows: await parseSellfoxAdProductReport(buffer, scope) };
}
/**
 * 赛狐对大报告按行拆成多个 XLSX 分片（真实投放报告实测 downloadUrl 为 2 个分片）。
 * 逐分片按同一严格契约解析后合并行，并用与 commitSellfoxAdsReportWindow 相同的身份哈希去重，
 * 保证跨分片边界不产生重复行；单分片仍是同一逻辑的一个特例。
 */
export async function parseSellfoxCpcReport(code: SellfoxCpcReportType, buffers: Buffer | Buffer[], scope: { storeName: string; startDate: string; endDate: string }): Promise<ParsedCpcReport> {
  const shards = Array.isArray(buffers) ? buffers : [buffers];
  const parsed: ParsedCpcReport[] = [];
  for (const buffer of shards) parsed.push(await parseSellfoxCpcShard(code, buffer, scope));
  if (parsed.length === 1) return parsed[0];
  const kind = parsed[0].kind;
  if (parsed.some((item) => item.kind !== kind)) throw new SellfoxSyncInputError("广告报告分片类型不一致。");
  const seen = new Set<string>();
  const rows: unknown[] = [];
  for (const item of parsed) {
    for (const row of item.rows as Record<string, unknown>[]) {
      const r = row as { reportDate?: unknown; campaignId?: unknown; adGroupId?: unknown; productId?: unknown; searchTerm?: unknown; targetingId?: unknown; placement?: unknown };
      const identity = "placement" in r && r.placement !== undefined ? [r.placement]
        : "adGroupId" in r && r.adGroupId !== undefined ? [r.adGroupId, ...("productId" in r ? [r.productId] : "searchTerm" in r ? [r.searchTerm, r.targetingId] : "targetingId" in r ? [r.targetingId] : [])] : [];
      const key = JSON.stringify([r.reportDate, r.campaignId, ...identity]);
      if (seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }
  }
  return { kind, rows } as ParsedCpcReport;
}

/** 赛狐大报告按行拆分的分片数安全上限（实测为 2，留出余量并 fail-closed）。 */
const MAX_REPORT_SHARDS = 20;

export type SellfoxAdsReportWindow = {
  organizationId: string; workspaceId: string; storeId: string; adType: string; startDate: string; endDate: string;
};
export function sellfoxAdsReportWindow(input: SellfoxAdsReportWindow) {
  return { organizationId: input.organizationId, workspaceId: input.workspaceId, storeId: input.storeId, adType: input.adType, reportDate: { gte: input.startDate, lte: input.endDate } };
}

// 两个入口共用事务、批次和身份哈希；progress 回调仍在同一事务内执行。
export async function commitSellfoxAdsReportWindow(
  db: Pick<typeof prisma, "$transaction">,
  input: SellfoxAdsReportWindow & { taskId: string },
  report: Awaited<ReturnType<typeof parseSellfoxCpcReport>>,
  hooks: { before?: (tx: Prisma.TransactionClient) => Promise<void>; after?: (tx: Prisma.TransactionClient) => Promise<void> } = {},
) {
  await db.$transaction(async (tx) => {
    await hooks.before?.(tx);
    const window = sellfoxAdsReportWindow(input);
    if (report.kind === "targeting") await tx.sellfoxAdsTargetingDaily.deleteMany({ where: window });
    else if (report.kind === "searchTerm") await tx.sellfoxAdsSearchTermDaily.deleteMany({ where: window });
    else if (report.kind === "campaign") await tx.sellfoxAdsCampaignDaily.deleteMany({ where: window });
    else if (report.kind === "adGroup") await tx.sellfoxAdsAdGroupDaily.deleteMany({ where: window });
    else if (report.kind === "placement") await tx.sellfoxAdsPlacementDaily.deleteMany({ where: window });
    else await tx.sellfoxAdsProductDaily.deleteMany({ where: window });
    const base = <T extends (typeof report.rows)[number]>(row: T) => {
      // Preserve Phase A hashes; campaign/placement identities never depend on group metadata.
      const identity = "placement" in row ? [row.placement] : "adGroupId" in row ? [row.adGroupId, ...("productId" in row ? [row.productId] : "searchTerm" in row ? [row.searchTerm, row.targetingId] : "targetingId" in row ? [row.targetingId] : [])] : [];
      return { ...row, id: createHash("sha256").update(JSON.stringify([input.storeId, input.adType, row.reportDate, row.campaignId, ...identity])).digest("hex"), organizationId: input.organizationId, workspaceId: input.workspaceId, storeId: input.storeId, adType: input.adType, payload: row.payload as Prisma.InputJsonValue };
    };
    for (let offset = 0; offset < report.rows.length; offset += 500) {
      if (report.kind === "product") await tx.sellfoxAdsProductDaily.createMany({ data: report.rows.slice(offset, offset + 500).map(row => ({ ...base(row), productId: row.productId })) });
      else if (report.kind === "targeting") await tx.sellfoxAdsTargetingDaily.createMany({ data: report.rows.slice(offset, offset + 500).map(row => ({ ...base(row), targetingId: row.targetingId })) });
      else if (report.kind === "campaign") await tx.sellfoxAdsCampaignDaily.createMany({ data: report.rows.slice(offset, offset + 500).map(row => base(row)) });
      else if (report.kind === "adGroup") await tx.sellfoxAdsAdGroupDaily.createMany({ data: report.rows.slice(offset, offset + 500).map(row => base(row)) });
      else if (report.kind === "placement") await tx.sellfoxAdsPlacementDaily.createMany({ data: report.rows.slice(offset, offset + 500).map(row => base(row)) });
      else await tx.sellfoxAdsSearchTermDaily.createMany({ data: report.rows.slice(offset, offset + 500).map(row => ({ ...base(row), searchTerm: row.searchTerm, targetingId: row.targetingId })) });
    }
    await tx.sellfoxReportTask.update({ where: { id: input.taskId, organizationId: input.organizationId, workspaceId: input.workspaceId }, data: { status: "done" } });
    await hooks.after?.(tx);
  });
}
export async function syncSellfoxAdsReports(input: {
  runId: string; organizationId: string; workspaceId: string; shopExternalIds: string[]; startDate: string; endDate: string;
  reportTypeCode?: SellfoxCpcReportType; adTypes?: string[]; onProgress: (progress: Record<string, unknown>, tx?: Prisma.TransactionClient) => Promise<void>;
}, dependencies = { db: prisma, post: sellfoxPost, storage: getStorageDriver, download, sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) }) {
  sellfoxReportDates(input.startDate, input.endDate);
  const reportTypeCode = input.reportTypeCode ?? "adProductReport";
  if (!["adProductReport", "adTargeringReport", "adSearchTermReport", "adCampaignReport", "adGroupReport", "adSpaceReport"].includes(reportTypeCode)) throw new SellfoxSyncInputError("广告报告类型无效。");
  if (input.adTypes && (!input.adTypes.length || input.adTypes.some((type) => !["sp", "sb", "sd"].includes(type)))) throw new SellfoxSyncInputError("广告类型无效。");
  const stores = await dependencies.db.sellfoxStore.findMany({ where: { organizationId: input.organizationId, workspaceId: input.workspaceId, externalId: { in: input.shopExternalIds } }, orderBy: { externalId: "asc" } });
  if (!stores.length || stores.length !== new Set(input.shopExternalIds).size) throw new SellfoxSyncInputError("广告报告店铺范围无效。");
  const failures: boolean[] = []; const units: Record<string, unknown> = {};
  for (const store of stores) for (const adType of input.adTypes ?? ["sp"]) {
    let id = createHash("sha256").update(JSON.stringify([input.runId, store.id, adType, reportTypeCode])).digest("hex");
    try {
      let task = await dependencies.db.sellfoxReportTask.findUnique({ where: { id } });
      // Existing product tasks retain their old IDs and cached files after migration.
      if (!task && reportTypeCode === "adProductReport") {
        const legacyId = createHash("sha256").update(JSON.stringify([input.runId, store.id, adType])).digest("hex");
        task = await dependencies.db.sellfoxReportTask.findUnique({ where: { id: legacyId } });
        if (task) id = legacyId;
      }
      if (task && (task.organizationId !== input.organizationId || task.workspaceId !== input.workspaceId || task.runId !== input.runId || task.storeId !== store.id || task.adType !== adType || task.reportTypeCode !== reportTypeCode || task.startDate !== input.startDate || task.endDate !== input.endDate)) throw new SellfoxSyncInputError("广告任务归属或报告范围不一致。");
      if (task?.status === "done") {
        const where = { organizationId: input.organizationId, workspaceId: input.workspaceId, storeId: store.id, adType, reportDate: { gte: input.startDate, lte: input.endDate } };
        const rows = reportTypeCode === "adCampaignReport" ? await dependencies.db.sellfoxAdsCampaignDaily.count({ where }) : reportTypeCode === "adGroupReport" ? await dependencies.db.sellfoxAdsAdGroupDaily.count({ where }) : reportTypeCode === "adSpaceReport" ? await dependencies.db.sellfoxAdsPlacementDaily.count({ where }) : reportTypeCode === "adTargeringReport" ? await dependencies.db.sellfoxAdsTargetingDaily.count({ where }) : reportTypeCode === "adSearchTermReport" ? await dependencies.db.sellfoxAdsSearchTermDaily.count({ where }) : await dependencies.db.sellfoxAdsProductDaily.count({ where });
        units[id] = { store: store.externalId, adType, reportTypeCode, status: "done", rows }; continue;
      }
      // Definite prior create failures (failed + no external id) are safe to resubmit; ambiguous creating is not.
      const needsCreate = !task || (task.status === "failed" && !task.externalTaskId);
      if (needsCreate) {
        const ambiguous = await dependencies.db.sellfoxReportTask.findFirst({ where: { organizationId: input.organizationId, workspaceId: input.workspaceId, storeId: store.id, adType, reportTypeCode, startDate: input.startDate, endDate: input.endDate, status: "creating", externalTaskId: null } });
        if (ambiguous) throw new SellfoxSyncInputError("同范围存在创建结果不明的广告任务，请先核对并关联原任务。");
        await dependencies.db.$transaction(async (tx) => {
          await input.onProgress({ units, cursor: { shopExternalId: store.externalId, adType, reportTypeCode, status: "creating" } }, tx);
          if (!task) await tx.sellfoxReportTask.create({ data: { id, organizationId: input.organizationId, workspaceId: input.workspaceId, storeId: store.id, runId: input.runId, adType, reportTypeCode, startDate: input.startDate, endDate: input.endDate, status: "creating" } });
          else await tx.sellfoxReportTask.update({ where: { id }, data: { status: "creating" } });
        });
        // Once sent, a timeout is ambiguous. Persisted creating is never automatically resubmitted.
        const result = await dependencies.post<{ id?: unknown }>("/api/cpc/download/createTask.json", { shopIds: [store.externalId], adTypeCode: adType, reportTypeCode, timeUnit: "daily", reportStartDate: input.startDate, reportEndDate: input.endDate }, { retry: false });
        if (typeof result?.id !== "string" || !result.id) throw new SellfoxSyncInputError("广告任务响应缺少 ID；需人工核对上游任务，禁止重复创建。");
        await dependencies.db.$transaction(async (tx) => {
          await input.onProgress({ units, cursor: { shopExternalId: store.externalId, adType, reportTypeCode, taskId: result.id } }, tx);
          await tx.sellfoxReportTask.update({ where: { id }, data: { externalTaskId: result.id as string, status: "pending" } });
        });
        task = await dependencies.db.sellfoxReportTask.findUniqueOrThrow({ where: { id } });
      }
      if (!task) throw new SellfoxSyncInputError("广告任务缺失。");
      if (!task.externalTaskId) throw new SellfoxSyncInputError("广告任务创建结果不明，需人工关联上游 taskId；未重复创建。");
      // 主分片沿用 <id>.xlsx（兼容缓存重解析的租户校验），额外分片为 <id>.partN.xlsx（N 从 2 起）。
      const primaryKey = `sellfox-reports/${input.organizationId}/${input.workspaceId}/${id}.xlsx`;
      const shardKey = (part: number) => part === 0 ? primaryKey : `sellfox-reports/${input.organizationId}/${input.workspaceId}/${id}.part${part + 1}.xlsx`;
      const loadCachedShards = async (): Promise<Buffer[]> => {
        if (!task.fileKey || task.fileKey !== primaryKey) return task.fileKey ? [await dependencies.storage().getBuffer(task.fileKey)] : [];
        const out: Buffer[] = [];
        for (let part = 0; part < MAX_REPORT_SHARDS; part++) {
          try { out.push(await dependencies.storage().getBuffer(shardKey(part))); }
          catch { if (part === 0) return []; break; }
        }
        return out;
      };
      let buffers: Buffer[] = task.fileKey ? await loadCachedShards() : [];
      for (let attempt = 0; !buffers.length && attempt < 20; attempt++) {
        await input.onProgress({ units, cursor: { shopExternalId: store.externalId, adType, reportTypeCode, taskId: task.externalTaskId, poll: attempt } });
        const page: { rows?: Record<string, unknown>[] } = await dependencies.post<{ rows?: Record<string, unknown>[] }>("/api/cpc/download/pageList.json", { taskIds: [task.externalTaskId], pageNo: "1", pageSize: "20" });
        if (!Array.isArray(page?.rows) || page.rows.length !== 1) throw new SellfoxSyncInputError("广告任务进度结构无效。");
        const row: Record<string, unknown> = page.rows[0];
        if (typeof row.reportState !== "string" || row.id !== task.externalTaskId || !Array.isArray(row.shopId) || row.shopId.length !== 1 || row.shopId[0] !== store.externalId || row.adTypeCode !== adType || row.reportTypeCode !== reportTypeCode || row.timeUnit !== "daily") throw new SellfoxSyncInputError("广告任务归属或报告口径不一致。");
        if (row.reportState === "已生成") {
          // 赛狐按行把大报告拆成多个 XLSX 分片；全部下载、持久化后合并解析。
          if (!Array.isArray(row.downloadUrl) || row.downloadUrl.length < 1 || row.downloadUrl.length > MAX_REPORT_SHARDS) throw new SellfoxSyncInputError("广告报告下载分片契约未验证。");
          const downloaded: Buffer[] = [];
          for (let part = 0; part < row.downloadUrl.length; part++) {
            const shard = await dependencies.download(sellfoxReportDownloadUrl(row.downloadUrl[part]));
            downloaded.push(shard);
            await dependencies.storage().putBuffer({ key: shardKey(part), buffer: shard, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
          }
          buffers = downloaded;
          await dependencies.db.$transaction(async (tx) => {
            await input.onProgress({ units, cursor: { shopExternalId: store.externalId, adType, reportTypeCode, status: "downloaded", shards: buffers.length } }, tx);
            await tx.sellfoxReportTask.update({ where: { id }, data: { fileKey: primaryKey, status: "downloaded" } });
          });
        } else {
          if (String(row.reportState).includes("失败")) throw new SellfoxSyncInputError("赛狐广告报告生成失败。");
          await dependencies.sleep(15000);
        }
      }
      if (!buffers.length) throw new SellfoxStoreSyncError("广告报告仍在生成，已保存 taskId，重试只查询进度。", true);
      const report = await parseSellfoxCpcReport(reportTypeCode, buffers, { storeName: store.name, startDate: input.startDate, endDate: input.endDate });
      // Validate whole file before replacing the requested store/type/date window atomically.
      await commitSellfoxAdsReportWindow(dependencies.db, { ...input, storeId: store.id, adType, taskId: id }, report, {
        before: async (tx) => { await input.onProgress({ units, cursor: { shopExternalId: store.externalId, adType, reportTypeCode, status: "committing" } }, tx); },
        after: async (tx) => {
          units[id] = { store: store.externalId, adType, reportTypeCode, status: "done", rows: report.rows.length };
          await input.onProgress({ units, count: Object.values(units).reduce<number>((n, unit) => n + Number((unit as { rows?: number }).rows ?? 0), 0) }, tx);
        },
      });
    } catch (error) {
      const failure = sellfoxStoreFailure(error); failures.push(failure.retryable);
      units[id] = { store: store.externalId, adType, reportTypeCode, status: "failed", error: failure.error };
      // Definite createTask failures must not leave permanent creating blockers for the same shop/type/window.
      const current = await dependencies.db.sellfoxReportTask.findUnique({ where: { id } });
      if (current?.status === "creating" && !current.externalTaskId && !sellfoxCreateTaskAmbiguous(error)) {
        await dependencies.db.sellfoxReportTask.update({ where: { id }, data: { status: "failed" } });
      }
      await input.onProgress({ units });
    }
  }
  if (failures.length) {
    const samples = [...new Set(Object.values(units).flatMap((unit) => {
      const row = unit as { status?: string; adType?: string; error?: string };
      return row.status === "failed" && row.error ? [`${row.adType ?? "?"}:${row.error}`] : [];
    }))].slice(0, 3);
    const detail = samples.length ? ` 原因示例：${samples.join("；")}` : "";
    throw new SellfoxStoreSyncError(`${failures.length} 个店铺/广告类型报告失败，已继续其余店铺；任务 ID 已保留。${detail}`, failures.some(Boolean));
  }
  return { units, count: Object.values(units).reduce<number>((n, unit) => n + Number((unit as { rows?: number }).rows ?? 0), 0) };
}
