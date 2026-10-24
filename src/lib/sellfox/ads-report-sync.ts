import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver } from "@/lib/storage";
import { sellfoxPost } from "./client";
import { parseSellfoxAdProductReport, sellfoxReportDownloadUrl } from "./ads-report-contract";
import { sellfoxReportDates, SellfoxSyncInputError } from "./sync-contract";
import { sellfoxStoreFailure, SellfoxStoreSyncError } from "./sync-errors";
async function download(url: URL) {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(60000), cache: "no-store" });
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > 25 * 1024 * 1024) throw new SellfoxSyncInputError("广告报告下载失败或文件超限。");
  const chunks: Uint8Array[] = []; let size = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const part = await reader.read(); if (part.done) break;
      size += part.value.length;
      if (size > 25 * 1024 * 1024) throw new SellfoxSyncInputError("广告报告下载超过 25MB。");
      chunks.push(part.value);
    }
  } finally { await reader.cancel(); }
  return Buffer.concat(chunks);
}
export async function syncSellfoxAdsReports(input: {
  runId: string; organizationId: string; workspaceId: string; shopExternalIds: string[]; startDate: string; endDate: string;
  adTypes?: string[]; onProgress: (progress: Record<string, unknown>, tx?: Prisma.TransactionClient) => Promise<void>;
}, dependencies = { db: prisma, post: sellfoxPost, storage: getStorageDriver, download, sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)) }) {
  sellfoxReportDates(input.startDate, input.endDate);
  if (input.adTypes && (!input.adTypes.length || input.adTypes.some((type) => !["sp", "sb", "sd"].includes(type)))) throw new SellfoxSyncInputError("广告类型无效。");
  const stores = await dependencies.db.sellfoxStore.findMany({ where: { organizationId: input.organizationId, workspaceId: input.workspaceId, externalId: { in: input.shopExternalIds } }, orderBy: { externalId: "asc" } });
  if (!stores.length || stores.length !== new Set(input.shopExternalIds).size) throw new SellfoxSyncInputError("广告报告店铺范围无效。");
  const failures: boolean[] = []; const units: Record<string, unknown> = {};
  for (const store of stores) for (const adType of input.adTypes ?? ["sp"]) {
    const id = createHash("sha256").update(JSON.stringify([input.runId, store.id, adType])).digest("hex");
    try {
      let task = await dependencies.db.sellfoxReportTask.findUnique({ where: { id } });
      if (task?.status === "done") {
        const rows = await dependencies.db.sellfoxAdsProductDaily.count({ where: { storeId: store.id, adType, reportDate: { gte: input.startDate, lte: input.endDate } } });
        units[id] = { store: store.externalId, adType, status: "done", rows }; continue;
      }
      if (!task) {
        const ambiguous = await dependencies.db.sellfoxReportTask.findFirst({ where: { organizationId: input.organizationId, workspaceId: input.workspaceId, storeId: store.id, adType, startDate: input.startDate, endDate: input.endDate, status: "creating", externalTaskId: null } });
        if (ambiguous) throw new SellfoxSyncInputError("同范围存在创建结果不明的广告任务，请先核对并关联原任务。");
        await dependencies.db.$transaction(async (tx) => {
          await input.onProgress({ units, cursor: { shopExternalId: store.externalId, adType, status: "creating" } }, tx);
          await tx.sellfoxReportTask.create({ data: { id, organizationId: input.organizationId, workspaceId: input.workspaceId, storeId: store.id, runId: input.runId, adType, startDate: input.startDate, endDate: input.endDate, status: "creating" } });
        });
        // Once sent, a timeout is ambiguous. Persisted creating is never automatically resubmitted.
        const result = await dependencies.post<{ id?: unknown }>("/api/cpc/download/createTask.json", { shopIds: [store.externalId], adTypeCode: adType, reportTypeCode: "adProductReport", timeUnit: "daily", reportStartDate: input.startDate, reportEndDate: input.endDate }, { retry: false });
        if (typeof result?.id !== "string" || !result.id) throw new SellfoxSyncInputError("广告任务响应缺少 ID；需人工核对上游任务，禁止重复创建。");
        await dependencies.db.$transaction(async (tx) => {
          await input.onProgress({ units, cursor: { shopExternalId: store.externalId, adType, taskId: result.id } }, tx);
          await tx.sellfoxReportTask.update({ where: { id }, data: { externalTaskId: result.id as string, status: "pending" } });
        });
        task = await dependencies.db.sellfoxReportTask.findUniqueOrThrow({ where: { id } });
      }
      if (!task.externalTaskId) throw new SellfoxSyncInputError("广告任务创建结果不明，需人工关联上游 taskId；未重复创建。");
      let buffer: Buffer | undefined;
      if (task.fileKey) buffer = await dependencies.storage().getBuffer(task.fileKey);
      for (let attempt = 0; !buffer && attempt < 20; attempt++) {
        await input.onProgress({ units, cursor: { shopExternalId: store.externalId, adType, taskId: task.externalTaskId, poll: attempt } });
        const page: { rows?: Record<string, unknown>[] } = await dependencies.post<{ rows?: Record<string, unknown>[] }>("/api/cpc/download/pageList.json", { taskIds: [task.externalTaskId], pageNo: "1", pageSize: "20" });
        if (!Array.isArray(page?.rows) || page.rows.length !== 1) throw new SellfoxSyncInputError("广告任务进度结构无效。");
        const row: Record<string, unknown> = page.rows[0];
        if (typeof row.reportState !== "string" || row.id !== task.externalTaskId || !Array.isArray(row.shopId) || row.shopId.length !== 1 || row.shopId[0] !== store.externalId || row.adTypeCode !== adType || row.reportTypeCode !== "adProductReport" || row.timeUnit !== "daily") throw new SellfoxSyncInputError("广告任务归属或报告口径不一致。");
        if (row.reportState === "已生成") {
          if (!Array.isArray(row.downloadUrl) || row.downloadUrl.length !== 1) throw new SellfoxSyncInputError("广告报告下载分片契约未验证。");
          buffer = await dependencies.download(sellfoxReportDownloadUrl(row.downloadUrl[0]));
          const fileKey = `sellfox-reports/${input.organizationId}/${input.workspaceId}/${id}.xlsx`;
          await dependencies.storage().putBuffer({ key: fileKey, buffer, contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
          await dependencies.db.$transaction(async (tx) => {
            await input.onProgress({ units, cursor: { shopExternalId: store.externalId, adType, status: "downloaded" } }, tx);
            await tx.sellfoxReportTask.update({ where: { id }, data: { fileKey, status: "downloaded" } });
          });
        } else {
          if (String(row.reportState).includes("失败")) throw new SellfoxSyncInputError("赛狐广告报告生成失败。");
          await dependencies.sleep(15000);
        }
      }
      if (!buffer) throw new SellfoxStoreSyncError("广告报告仍在生成，已保存 taskId，重试只查询进度。", true);
      const rows = await parseSellfoxAdProductReport(buffer, { storeName: store.name, startDate: input.startDate, endDate: input.endDate });
      // Validate whole file before replacing the requested store/type/date window atomically.
      await dependencies.db.$transaction(async (tx) => {
        await input.onProgress({ units, cursor: { shopExternalId: store.externalId, adType, status: "committing" } }, tx);
        await tx.sellfoxAdsProductDaily.deleteMany({ where: { organizationId: input.organizationId, workspaceId: input.workspaceId, storeId: store.id, adType, reportDate: { gte: input.startDate, lte: input.endDate } } });
        for (let offset = 0; offset < rows.length; offset += 500) {
          await tx.sellfoxAdsProductDaily.createMany({ data: rows.slice(offset, offset + 500).map((row) => ({ ...row, id: createHash("sha256").update(JSON.stringify([store.id, adType, row.reportDate, row.campaignId, row.adGroupId, row.productId])).digest("hex"), organizationId: input.organizationId, workspaceId: input.workspaceId, storeId: store.id, adType, payload: row.payload as Prisma.InputJsonValue })) });
        }
        await tx.sellfoxReportTask.update({ where: { id }, data: { status: "done" } });
        units[id] = { store: store.externalId, adType, status: "done", rows: rows.length };
        await input.onProgress({ units, count: Object.values(units).reduce<number>((n, unit) => n + Number((unit as { rows?: number }).rows ?? 0), 0) }, tx);
      });
    } catch (error) {
      const failure = sellfoxStoreFailure(error); failures.push(failure.retryable);
      units[id] = { store: store.externalId, adType, status: "failed", error: failure.error };
      await input.onProgress({ units });
    }
  }
  if (failures.length) throw new SellfoxStoreSyncError(`${failures.length} 个店铺/广告类型报告失败，已继续其余店铺；任务 ID 已保留。`, failures.some(Boolean));
  return { units, count: Object.values(units).reduce<number>((n, unit) => n + Number((unit as { rows?: number }).rows ?? 0), 0) };
}
