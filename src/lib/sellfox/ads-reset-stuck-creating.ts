import { parseArgs } from "node:util";
import { prisma } from "@/lib/db/prisma";
import { SellfoxSyncInputError } from "./sync-contract";

/** Persisted on SellfoxReportTask: only status becomes failed (no lastError column). */
export const STUCK_CREATING_RESET_NOTE = "ops reset stuck creating without externalTaskId";

const reportTypes = ["adProductReport", "adTargeringReport", "adSearchTermReport", "adCampaignReport", "adGroupReport", "adSpaceReport"] as const;

export type SellfoxAdsResetStuckCreatingInput = {
  organizationId: string;
  workspaceId: string;
  write?: boolean;
  reportTypeCode?: string;
  adType?: string;
  taskId?: string;
  /** Only rows whose updatedAt is at least this many minutes ago. */
  olderThanMinutes?: number;
};

export type SellfoxAdsStuckCreatingTask = {
  id: string;
  shop: string;
  shopName: string;
  storeId: string;
  reportTypeCode: string;
  adType: string;
  status: string;
  attempts: number | null;
  runId: string;
  startDate: string;
  endDate: string;
  updatedAt: string;
  externalTaskId: string | null;
  fileKey: string | null;
  lastError: string;
};

export type SellfoxAdsResetStuckCreatingSummary = {
  mode: "dry-run" | "write";
  organizationId: string;
  workspaceId: string;
  selectedTasks: number;
  updatedTasks: number;
  lastError: string;
  tasks: SellfoxAdsStuckCreatingTask[];
};

export function parseSellfoxAdsResetStuckCreatingArgs(args: string[]): SellfoxAdsResetStuckCreatingInput {
  const { values } = parseArgs({
    args,
    options: {
      "organization-id": { type: "string" },
      "workspace-id": { type: "string" },
      "report-type": { type: "string" },
      "ad-type": { type: "string" },
      "task-id": { type: "string" },
      "older-than-minutes": { type: "string" },
      write: { type: "boolean", default: false },
    },
  });
  const olderRaw = values["older-than-minutes"];
  let olderThanMinutes: number | undefined;
  if (olderRaw !== undefined) {
    if (!/^\d+$/.test(olderRaw)) throw new SellfoxSyncInputError("older-than-minutes 必须是非负整数分钟。");
    olderThanMinutes = Number(olderRaw);
  }
  return {
    organizationId: values["organization-id"] ?? "",
    workspaceId: values["workspace-id"] ?? "",
    write: values.write,
    reportTypeCode: values["report-type"],
    adType: values["ad-type"],
    taskId: values["task-id"],
    olderThanMinutes,
  };
}

function isScopeSegment(value: string) {
  return value.trim() === value && value.length > 0 && !/[\\/]/.test(value) && value !== "." && value !== "..";
}

function validateInput(input: SellfoxAdsResetStuckCreatingInput) {
  if (![input.organizationId, input.workspaceId].every(isScopeSegment)) {
    throw new SellfoxSyncInputError("必须显式指定有效 organization-id 和 workspace-id。");
  }
  if (input.adType !== undefined && !["sp", "sb", "sd"].includes(input.adType)) {
    throw new SellfoxSyncInputError("ad-type 仅支持 sp/sb/sd。");
  }
  if (input.reportTypeCode !== undefined) {
    if (!input.reportTypeCode.trim()) throw new SellfoxSyncInputError("筛选参数不得为空。");
    if (!(reportTypes as readonly string[]).includes(input.reportTypeCode)) {
      throw new SellfoxSyncInputError("report-type 必须使用已支持的精确报告代码。");
    }
  }
  for (const value of [input.taskId]) {
    if (value !== undefined && !value.trim()) throw new SellfoxSyncInputError("筛选参数不得为空。");
  }
  if (input.olderThanMinutes !== undefined && (!Number.isInteger(input.olderThanMinutes) || input.olderThanMinutes < 0)) {
    throw new SellfoxSyncInputError("older-than-minutes 必须是非负整数分钟。");
  }
}

/** Hard safety filter: creating + no upstream id + no cached file. Never touches rows with externalTaskId. */
function stuckCreatingWhere(input: SellfoxAdsResetStuckCreatingInput) {
  return {
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    status: "creating",
    externalTaskId: null,
    fileKey: null,
    ...(input.taskId ? { id: input.taskId } : {}),
    ...(input.reportTypeCode ? { reportTypeCode: input.reportTypeCode } : {}),
    ...(input.adType ? { adType: input.adType } : {}),
    ...(input.olderThanMinutes !== undefined
      ? { updatedAt: { lte: new Date(Date.now() - input.olderThanMinutes * 60_000) } }
      : {}),
    SellfoxStore: { organizationId: input.organizationId, workspaceId: input.workspaceId },
  };
}

// 只读库 + 可选 status→failed；无 Sellfox HTTP、无删行、不碰有 externalTaskId 的行。
export async function resetSellfoxAdsStuckCreating(
  input: SellfoxAdsResetStuckCreatingInput,
  dependencies: { db: typeof prisma; onTask?: (task: SellfoxAdsStuckCreatingTask) => void } = { db: prisma },
): Promise<SellfoxAdsResetStuckCreatingSummary> {
  validateInput(input);
  const { db } = dependencies;
  const where = stuckCreatingWhere(input);
  const rows = await db.sellfoxReportTask.findMany({
    where,
    select: {
      id: true,
      organizationId: true,
      workspaceId: true,
      storeId: true,
      runId: true,
      reportTypeCode: true,
      adType: true,
      startDate: true,
      endDate: true,
      status: true,
      externalTaskId: true,
      fileKey: true,
      updatedAt: true,
      SellfoxStore: { select: { id: true, organizationId: true, workspaceId: true, externalId: true, name: true } },
    },
    orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
  });
  if (input.taskId && !rows.length) {
    throw new SellfoxSyncInputError("任务不在指定组织/工作区或不满足卡住 creating 筛选条件。");
  }
  for (const row of rows) {
    const store = row.SellfoxStore;
    if (
      row.organizationId !== input.organizationId
      || row.workspaceId !== input.workspaceId
      || store.organizationId !== input.organizationId
      || store.workspaceId !== input.workspaceId
      || store.id !== row.storeId
    ) {
      throw new SellfoxSyncInputError("拒绝跨组织/工作区重置卡住任务。");
    }
    // Defense in depth: never act on a row that somehow retained an upstream id or cache.
    if (row.externalTaskId != null || row.fileKey != null || row.status !== "creating") {
      throw new SellfoxSyncInputError("筛选结果含非卡住 creating 任务，已中止。");
    }
  }

  const runIds = [...new Set(rows.map((row) => row.runId))];
  const runs = runIds.length
    ? await db.sellfoxSyncRun.findMany({
      where: { id: { in: runIds }, organizationId: input.organizationId, workspaceId: input.workspaceId },
      select: { id: true, executionAttempts: true },
    })
    : [];
  const attemptsByRun = new Map(runs.map((run) => [run.id, run.executionAttempts]));

  const tasks: SellfoxAdsStuckCreatingTask[] = rows.map((row) => {
    const task: SellfoxAdsStuckCreatingTask = {
      id: row.id,
      shop: row.SellfoxStore.externalId,
      shopName: row.SellfoxStore.name,
      storeId: row.storeId,
      reportTypeCode: row.reportTypeCode,
      adType: row.adType,
      status: row.status,
      attempts: attemptsByRun.get(row.runId) ?? null,
      runId: row.runId,
      startDate: row.startDate,
      endDate: row.endDate,
      updatedAt: row.updatedAt.toISOString(),
      externalTaskId: row.externalTaskId,
      fileKey: row.fileKey,
      lastError: STUCK_CREATING_RESET_NOTE,
    };
    dependencies.onTask?.(task);
    return task;
  });

  let updatedTasks = 0;
  if (input.write && tasks.length) {
    // Re-assert hard filters on write so a race cannot mark rows that gained an externalTaskId.
    const result = await db.sellfoxReportTask.updateMany({
      where: {
        id: { in: tasks.map((task) => task.id) },
        organizationId: input.organizationId,
        workspaceId: input.workspaceId,
        status: "creating",
        externalTaskId: null,
        fileKey: null,
      },
      data: { status: "failed" },
    });
    updatedTasks = result.count;
    for (const task of tasks) task.status = "failed";
  }

  return {
    mode: input.write ? "write" : "dry-run",
    organizationId: input.organizationId,
    workspaceId: input.workspaceId,
    selectedTasks: tasks.length,
    updatedTasks,
    lastError: STUCK_CREATING_RESET_NOTE,
    tasks,
  };
}
