import { parseArgs } from "node:util";
import { prisma } from "@/lib/db/prisma";
import { getStorageDriver } from "@/lib/storage";
import { commitSellfoxAdsReportWindow, parseSellfoxCpcReport, sellfoxAdsReportWindow, type SellfoxAdsReportWindow, type SellfoxCpcReportType } from "./ads-report-sync";
import { isSellfoxDate, sellfoxReportDates, SellfoxSyncInputError } from "./sync-contract";

const reportTypes: SellfoxCpcReportType[] = ["adProductReport", "adTargeringReport", "adSearchTermReport", "adCampaignReport", "adGroupReport", "adSpaceReport"];
export type SellfoxAdsReparseInput = {
  organizationId: string; workspaceId: string; write?: boolean;
  reportType?: string; storeId?: string; shopExternalId?: string; adType?: string; taskId?: string;
  startDate?: string; endDate?: string;
};

export function parseSellfoxAdsReparseArgs(args: string[]): SellfoxAdsReparseInput {
  const { values } = parseArgs({ args, options: {
    "organization-id": { type: "string" }, "workspace-id": { type: "string" },
    "report-type": { type: "string" }, "store-id": { type: "string" }, "shop-external-id": { type: "string" },
    "ad-type": { type: "string" }, "task-id": { type: "string" },
    "start-date": { type: "string" }, "end-date": { type: "string" }, write: { type: "boolean", default: false },
  } });
  return { organizationId: values["organization-id"] ?? "", workspaceId: values["workspace-id"] ?? "", write: values.write,
    reportType: values["report-type"], storeId: values["store-id"], shopExternalId: values["shop-external-id"],
    adType: values["ad-type"], taskId: values["task-id"], startDate: values["start-date"], endDate: values["end-date"] };
}

function isStorageSegment(value: string) {
  return value.trim() === value && value.length > 0 && !/[\\/]/.test(value) && value !== "." && value !== "..";
}
function selectedReportTypes(input: SellfoxAdsReparseInput) {
  if (![input.organizationId, input.workspaceId].every(isStorageSegment)) throw new SellfoxSyncInputError("必须显式指定有效 organization-id 和 workspace-id。");
  if (input.adType !== undefined && !["sp", "sb", "sd"].includes(input.adType)) throw new SellfoxSyncInputError("ad-type 仅支持 sp/sb/sd。");
  for (const date of [input.startDate, input.endDate]) if (date !== undefined && !isSellfoxDate(date)) throw new SellfoxSyncInputError("日期必须使用有效 YYYY-MM-DD。");
  if (input.startDate && input.endDate && input.startDate > input.endDate) throw new SellfoxSyncInputError("开始日期不得晚于结束日期。");
  for (const value of [input.reportType, input.storeId, input.shopExternalId, input.taskId]) if (value !== undefined && !value.trim()) throw new SellfoxSyncInputError("筛选参数不得为空。");
  if (input.reportType !== undefined && !reportTypes.includes(input.reportType as SellfoxCpcReportType)) throw new SellfoxSyncInputError("report-type 必须使用已支持的精确报告代码。");
  return input.reportType ? [input.reportType as SellfoxCpcReportType] : ["adTargeringReport", "adSearchTermReport"] as SellfoxCpcReportType[];
}

type Identity = { reportDate: string; campaignId: string; adGroupId?: string | null; targetingId?: string; searchTerm?: string; productId?: string; placement?: string };
function identity(row: Identity) {
  return { reportDate: row.reportDate, campaignId: row.campaignId,
    ...("adGroupId" in row ? { adGroupId: row.adGroupId } : {}),
    ...("targetingId" in row ? { targetingId: row.targetingId } : {}),
    ...("searchTerm" in row ? { searchTerm: row.searchTerm } : {}),
    ...("productId" in row ? { productId: row.productId } : {}),
    ...("placement" in row ? { placement: row.placement } : {}) };
}

async function inspectWindow(db: typeof prisma, scope: SellfoxAdsReportWindow, code: SellfoxCpcReportType) {
  const where = sellfoxAdsReportWindow(scope);
  const sample = { where, take: 3, orderBy: { id: "asc" as const } };
  const common = { reportDate: true, campaignId: true } as const;
  if (code === "adTargeringReport" || code === "adSearchTermReport") {
    const select = { ...common, adGroupId: true, targetingId: true } as const;
    const legacyWhere = { ...where, OR: [{ targetingId: { startsWith: "text:" } }, { targetingId: "" }] };
    if (code === "adTargeringReport") return {
      beforeCount: await db.sellfoxAdsTargetingDaily.count({ where }),
      legacyIdentityCount: await db.sellfoxAdsTargetingDaily.count({ where: legacyWhere }),
      before: await db.sellfoxAdsTargetingDaily.findMany({ ...sample, select }),
      legacy: await db.sellfoxAdsTargetingDaily.findMany({ ...sample, where: legacyWhere, select }),
    };
    return {
      beforeCount: await db.sellfoxAdsSearchTermDaily.count({ where }),
      legacyIdentityCount: await db.sellfoxAdsSearchTermDaily.count({ where: legacyWhere }),
      before: await db.sellfoxAdsSearchTermDaily.findMany({ ...sample, select: { ...select, searchTerm: true } }),
      legacy: await db.sellfoxAdsSearchTermDaily.findMany({ ...sample, where: legacyWhere, select: { ...select, searchTerm: true } }),
    };
  }
  if (code === "adCampaignReport") return { beforeCount: await db.sellfoxAdsCampaignDaily.count({ where }), before: await db.sellfoxAdsCampaignDaily.findMany({ ...sample, select: common }) };
  if (code === "adGroupReport") return { beforeCount: await db.sellfoxAdsAdGroupDaily.count({ where }), before: await db.sellfoxAdsAdGroupDaily.findMany({ ...sample, select: { ...common, adGroupId: true } }) };
  if (code === "adSpaceReport") return { beforeCount: await db.sellfoxAdsPlacementDaily.count({ where }), before: await db.sellfoxAdsPlacementDaily.findMany({ ...sample, select: { ...common, placement: true } }) };
  return { beforeCount: await db.sellfoxAdsProductDaily.count({ where }), before: await db.sellfoxAdsProductDaily.findMany({ ...sample, select: { ...common, adGroupId: true, productId: true } }) };
}

type ReparseResult = {
  taskId: string; fileKey: string | null; reportType: string; storeId: string; shopExternalId: string; adType: string;
  startDate: string; endDate: string; beforeCount: number | null; afterCount: number | null;
  legacyIdentityCount?: number; identitySample: { before: Identity[]; legacy: Identity[]; after: Identity[] };
  status: "would_write" | "written" | "skipped_missing" | "parse_failed" | "write_failed";
};

// 仅注入数据库和缓存读取能力；没有上游 HTTP、创建任务或下载回退。
export async function reparseSellfoxAdsReportsFromCache(input: SellfoxAdsReparseInput, dependencies: {
  db: typeof prisma; storage: () => Pick<ReturnType<typeof getStorageDriver>, "getBuffer">;
  onResult?: (result: ReparseResult) => void;
} = { db: prisma, storage: getStorageDriver }) {
  const codes = selectedReportTypes(input);
  const { db } = dependencies;
  const tasks = await db.sellfoxReportTask.findMany({
    where: { organizationId: input.organizationId, workspaceId: input.workspaceId,
      status: { in: ["done", "downloaded"] }, fileKey: { not: null }, reportTypeCode: { in: codes },
      ...(input.taskId ? { id: input.taskId } : {}), ...(input.storeId ? { storeId: input.storeId } : {}),
      ...(input.adType ? { adType: input.adType } : {}),
      ...(input.startDate ? { startDate: { gte: input.startDate } } : {}), ...(input.endDate ? { endDate: { lte: input.endDate } } : {}),
      SellfoxStore: { organizationId: input.organizationId, workspaceId: input.workspaceId, ...(input.shopExternalId ? { externalId: input.shopExternalId } : {}) },
    },
    select: { id: true, organizationId: true, workspaceId: true, storeId: true, adType: true, reportTypeCode: true, startDate: true, endDate: true, status: true, fileKey: true,
      SellfoxStore: { select: { id: true, organizationId: true, workspaceId: true, externalId: true, name: true } } },
    // 固定不可变排序，重复执行时重叠窗口的覆盖顺序不受 updatedAt 改变影响。
    orderBy: [{ startDate: "asc" }, { endDate: "asc" }, { id: "asc" }],
  });
  if (input.taskId && !tasks.length) throw new SellfoxSyncInputError("任务不在指定组织/工作区或不满足缓存重解析筛选条件。");
  // 在读取任何文件或执行任何写入前核验整批租户归属。
  for (const task of tasks) {
    const store = task.SellfoxStore;
    if (task.organizationId !== input.organizationId || task.workspaceId !== input.workspaceId || store.organizationId !== input.organizationId || store.workspaceId !== input.workspaceId || store.id !== task.storeId) throw new SellfoxSyncInputError("拒绝跨组织/工作区缓存重解析。");
    if (!isStorageSegment(task.id) || (task.fileKey && task.fileKey !== `sellfox-reports/${input.organizationId}/${input.workspaceId}/${task.id}.xlsx`)) throw new SellfoxSyncInputError("缓存 fileKey 与任务租户范围不一致。");
  }
  const results: ReparseResult[] = [];
  for (const task of tasks) {
    const code = task.reportTypeCode as SellfoxCpcReportType;
    const result: ReparseResult = { taskId: task.id, fileKey: task.fileKey, reportType: code, storeId: task.storeId, shopExternalId: task.SellfoxStore.externalId,
      adType: task.adType, startDate: task.startDate, endDate: task.endDate, beforeCount: null, afterCount: null,
      identitySample: { before: [], legacy: [], after: [] }, status: "parse_failed" };
    try {
      sellfoxReportDates(task.startDate, task.endDate);
      if (!codes.includes(code) || !["sp", "sb", "sd"].includes(task.adType)) throw new SellfoxSyncInputError("缓存任务报告类型无效。");
      const before = await inspectWindow(db, task, code);
      result.beforeCount = before.beforeCount;
      result.legacyIdentityCount = before.legacyIdentityCount;
      result.identitySample.before = before.before.map(identity);
      result.identitySample.legacy = before.legacy?.map(identity) ?? [];
      let buffer: Buffer | undefined;
      try { if (task.fileKey) buffer = await dependencies.storage().getBuffer(task.fileKey); } catch { /* 不可读缓存一律拒绝，不回退上游。 */ }
      if (!buffer?.length) result.status = "skipped_missing";
      else {
        const report = await parseSellfoxCpcReport(code, buffer, { storeName: task.SellfoxStore.name, startDate: task.startDate, endDate: task.endDate });
        result.afterCount = report.rows.length;
        result.identitySample.after = report.rows.slice(0, 3).map(identity);
        result.status = "would_write";
        if (input.write) {
          result.status = "write_failed";
          await commitSellfoxAdsReportWindow(db, { ...task, taskId: task.id }, report);
          result.status = "written";
        }
      }
    } catch { /* 保留阶段状态；不输出数据库连接串、原始响应或原始行。 */ }
    results.push(result);
    dependencies.onResult?.(result);
  }
  return { mode: input.write ? "write" : "dry-run", organizationId: input.organizationId, workspaceId: input.workspaceId, selectedTasks: tasks.length,
    failedTasks: results.filter(result => !["would_write", "written"].includes(result.status)).length, results };
}
