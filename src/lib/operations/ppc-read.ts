import type { Prisma } from "@prisma/client";
import { createAgentRuntime } from "@/lib/agent-platform/runtime";
import { ppcAgentDefinition, ppcToolDefinitions, createPpcAnalyticsAdapter, createPpcAgentExecutionExecutor, type PpcExecutionOutput } from "@/lib/agent-platform/ppc";
import { amazonAdsToolDefinitions, createAmazonAdsApiAdapter } from "@/lib/agent-platform/amazon-ads";
import type { CampaignGroup, PerformanceRow } from "@/lib/types";
import { aggregateMetricsForCampaignGroups } from "@/lib/metrics";
import { inventorySnapshotStatus } from "./readiness";
import type { OpsIdentity } from "./cli";

export class PpcReadError extends Error {
  readonly code = "PPC_DATA_INVALID";
  readonly exitCode = 4;
}
export function validateLocalPpcRows(rows: unknown[]): asserts rows is PerformanceRow[] {
  for (const raw of rows) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new PpcReadError("PPC 行格式无效，未生成建议。");
    const row = raw as Record<string, unknown>;
    if (["id", "campaignGroupId", "campaignName", "adGroupName"].some((key) => typeof row[key] !== "string" || !row[key])
      || ![row.keyword, row.target].some((value) => typeof value === "string" && value.trim())
      || ["currentBid", "impressions", "clicks", "orders", "sales", "spend"].some((key) => typeof row[key] !== "number" || !Number.isFinite(row[key]) || row[key] < 0)) {
      throw new PpcReadError("PPC 行缺少可信身份/指标/出价；不能用默认数字补齐后分析。");
    }
  }
}

export type PpcLocalDataset = { id: string; createdAt: Date; marketplace: string; campaignGroups: CampaignGroup[]; performanceRows: PerformanceRow[] };
export async function readPpcDataset(db: Prisma.TransactionClient, identity: OpsIdentity): Promise<PpcLocalDataset | null> {
  // Actor-scoped: do not silently read another employee's imported workbook.
  const where = { organizationId: identity.organizationId, workspaceId: identity.workspaceId, userId: identity.actorUserId };
  const metadata = await db.workspaceDataset.findFirst({ where, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, rowCount: true } });
  if (!metadata) return null;
  if (metadata.rowCount > 10000) throw new PpcReadError("PPC 数据超过 CLI 10000 行上限，请在广告工作台缩小数据集。");
  const row = await db.workspaceDataset.findFirst({ where: { ...where, id: metadata.id }, select: { id: true, createdAt: true, marketplace: true, campaignGroups: true, performanceRows: true } });
  if (!row) return null;
  if (!Array.isArray(row.campaignGroups) || !Array.isArray(row.performanceRows) || row.performanceRows.length > 10000) throw new PpcReadError("PPC 数据集格式无效或超过安全上限。");
  if (row.campaignGroups.some((raw) => {
    const group = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    return ["id", "campaignName", "adGroupName"].some((key) => typeof group[key] !== "string" || !group[key]);
  })) throw new PpcReadError("PPC Campaign Group 身份缺失，不能生成默认名称进行分析。");
  validateLocalPpcRows(row.performanceRows);
  return { ...row, campaignGroups: row.campaignGroups as unknown as CampaignGroup[], performanceRows: row.performanceRows as unknown as PerformanceRow[] };
}
export function summarizePpc(dataset: PpcLocalDataset | null, now = new Date()) {
  if (!dataset) return { sourceStatus: "NOT_SYNCED", summary: null, note: "当前操作者在此工作区没有服务端 PPC 导入；浏览器 IndexedDB 不可由 CLI 读取。" };
  return { sourceStatus: "AVAILABLE", datasetId: dataset.id, importedAt: dataset.createdAt, reportPeriod: null,
    freshness: { status: "UNKNOWN", warning: "导入时间不代表广告报表日期；无法证明广告数据新鲜。", importOlderThan48Hours: now.getTime() - dataset.createdAt.getTime() > 48 * 3600000 },
    rowCount: dataset.performanceRows.length,
    summary: aggregateMetricsForCampaignGroups([...new Set(dataset.performanceRows.map((row) => row.campaignGroupId))], dataset.performanceRows) };
}
export async function suggestPpc(db: Prisma.TransactionClient, identity: OpsIdentity, dataset: PpcLocalDataset | null, now = new Date()) {
  const source = summarizePpc(dataset, now);
  if (!dataset || !dataset.performanceRows.length) return { source, report: null, adjustmentDrafts: [], freshnessWarnings: ["缺少 PPC 数据，不能生成建议。"], mode: "draft_only", externalWriteAttempted: false };
  const inventory = await db.amazonSyncRun.findFirst({ where: { organizationId: identity.organizationId, workspaceId: identity.workspaceId, resource: "inventory", status: "SUCCEEDED" }, orderBy: { finishedAt: "desc" } });
  const inventoryStatus = inventorySnapshotStatus(inventory?.finishedAt ?? null, now);
  validateLocalPpcRows(dataset.performanceRows);
  const clock = () => now;
  const runtime = createAgentRuntime({ definitions: [ppcAgentDefinition], tools: [...ppcToolDefinitions, ...amazonAdsToolDefinitions], adapters: [createPpcAnalyticsAdapter(clock), createAmazonAdsApiAdapter({ clock, writeEnabled: false })], clock });
  const request = { campaignGroups: dataset.campaignGroups, performanceRows: dataset.performanceRows, marketplace: dataset.marketplace, naturalLanguageGoal: "分析本地 PPC 导入，生成待人工复核的优化草稿" };
  const result = await runtime.run({ agentId: ppcAgentDefinition.id, workspaceId: identity.workspaceId, requestedByUserId: identity.actorUserId,
    context: { company: { organizationId: identity.organizationId }, workspace: { workspaceId: identity.workspaceId }, currentData: request }, input: {},
    executor: createPpcAgentExecutionExecutor({ request, clock, requestedByUserId: identity.actorUserId }) });
  if (result.execution.status !== "COMPLETED") throw new Error("PPC 本地分析失败，未生成建议。");
  const output = result.execution.output as unknown as PpcExecutionOutput;
  return { ...output, source, inventoryFreshness: inventoryStatus,
    freshnessWarnings: ["广告报表日期未建立可信映射；广告新鲜度 UNKNOWN，执行前必须复核。", ...(inventoryStatus !== "FRESH" ? [`库存 ${inventoryStatus}；建议不包含可靠的库存约束。`] : [])],
    assumptions: { targetAcosPercent: 30, targetRoas: 3, targetMarginPercent: 25, confidenceSource: "existing_rule_heuristics" },
    mode: "draft_only", externalWriteAttempted: false };
}
