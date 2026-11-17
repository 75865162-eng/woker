import type { JsonObject, JsonValue } from "./types";
import type { CampaignGroup, OverallAdDataRow, PerformanceRow } from "@/lib/types";
import type { PpcExecutionRequest } from "./ppc-contracts";

export function normalizePpcExecutionRequest(request: PpcExecutionRequest, context: Record<string, unknown>) {
  const currentData = isRecord(context.currentData) ? context.currentData : {};
  const currentCampaignGroups = Array.isArray(currentData.campaignGroups) ? (currentData.campaignGroups as CampaignGroup[]) : [];
  const currentPerformanceRows = Array.isArray(currentData.performanceRows) ? (currentData.performanceRows as PerformanceRow[]) : [];
  const currentOverallRows = Array.isArray(currentData.overallAdDataRows) ? (currentData.overallAdDataRows as OverallAdDataRow[]) : [];

  return {
    naturalLanguageGoal: String(request.naturalLanguageGoal ?? currentData.goal ?? "Diagnose PPC and generate recommendations."),
    marketplace: String(request.marketplace ?? currentData.marketplace ?? context.marketplace ?? "US"),
    campaignGroupId: request.campaignGroupId ?? (typeof currentData.activeCampaignGroupId === "string" ? currentData.activeCampaignGroupId : undefined),
    workspaceUnitId: request.workspaceUnitId ?? (typeof currentData.activeWorkspaceUnitId === "string" ? currentData.activeWorkspaceUnitId : undefined),
    workspaceMode: String(request.workspaceMode ?? currentData.workspaceMode ?? "campaign"),
    campaignGroups: (request.campaignGroups ?? currentCampaignGroups).filter(Boolean),
    performanceRows: (request.performanceRows ?? currentPerformanceRows).filter(Boolean),
    overallAdDataRows: (request.overallAdDataRows ?? currentOverallRows).filter(Boolean),
    productContext: request.productContext ?? currentData.productContext ?? null,
    sellerSpriteKeywords: request.sellerSpriteKeywords ?? currentData.sellerSpriteKeywords ?? null,
    historicalData: request.historicalData ?? currentData.historicalData ?? null,
    currentData,
    targetAcos: request.targetAcos ?? numberValue(currentData.targetAcos, undefined),
    targetRoas: request.targetRoas ?? numberValue(currentData.targetRoas, undefined),
    targetMargin: request.targetMargin ?? numberValue(currentData.targetMargin, undefined),
  };
}

export function normalizeCampaignGroups(groups: unknown): CampaignGroup[] {
  if (!Array.isArray(groups)) return [];

  return groups.filter(isRecord).map((group, index) => ({
    id: String(group.id ?? `campaign-group-${index}`),
    campaignName: String(group.campaignName ?? group.adGroupName ?? `Campaign ${index + 1}`),
    adGroupName: String(group.adGroupName ?? group.campaignName ?? `Ad Group ${index + 1}`),
    lifecycleGroupId: normalizeLifecycleGroupId(group.lifecycleGroupId),
    keywordCount: numberValue(group.keywordCount, 0),
    lastUpdated: String(group.lastUpdated ?? new Date().toISOString()),
    sheetName: typeof group.sheetName === "string" ? group.sheetName : undefined,
  }));
}

export function normalizePerformanceRows(rows: unknown): PerformanceRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.filter(isRecord).map((row, index) => ({
    id: String(row.id ?? `row-${index}`),
    campaignGroupId: String(row.campaignGroupId ?? "default"),
    batchId: String(row.batchId ?? "batch-default"),
    sheetName: typeof row.sheetName === "string" ? row.sheetName : undefined,
    sourceRowIndex: numberValue(row.sourceRowIndex, undefined),
    sourceRowNumber: numberValue(row.sourceRowNumber, undefined),
    entity: typeof row.entity === "string" ? row.entity : undefined,
    adGroupNameRef: typeof row.adGroupNameRef === "string" ? row.adGroupNameRef : undefined,
    campaignName: String(row.campaignName ?? "Campaign"),
    adGroupName: String(row.adGroupName ?? "Ad Group"),
    keyword: String(row.keyword ?? row.target ?? "keyword"),
    target: String(row.target ?? row.keyword ?? "target"),
    matchType: String(row.matchType ?? "broad"),
    currentBid: requiredMetric(row, "currentBid", index, "performanceRows"),
    impressions: requiredMetric(row, "impressions", index, "performanceRows"),
    clicks: requiredMetric(row, "clicks", index, "performanceRows"),
    orders: requiredMetric(row, "orders", index, "performanceRows"),
    sales: requiredMetric(row, "sales", index, "performanceRows"),
    spend: requiredMetric(row, "spend", index, "performanceRows"),
    topOfSearchShare: requiredMetric(row, "topOfSearchShare", index, "performanceRows"),
    advertisedProductOrders: requiredMetric(row, "advertisedProductOrders", index, "performanceRows"),
    otherProductOrders: requiredMetric(row, "otherProductOrders", index, "performanceRows"),
    viewableImpressions: requiredMetric(row, "viewableImpressions", index, "performanceRows"),
    status: row.status === "paused" ? "paused" : "enabled",
  }));
}

export function normalizeOverallRows(rows: unknown): OverallAdDataRow[] {
  if (!Array.isArray(rows)) return [];

  return rows.filter(isRecord).map((row, index) => ({
    id: String(row.id ?? `overall-${index}`),
    fileId: String(row.fileId ?? "file-default"),
    sheetName: typeof row.sheetName === "string" ? row.sheetName : undefined,
    campaignGroupId: typeof row.campaignGroupId === "string" ? row.campaignGroupId : undefined,
    scopeCampaignGroupIds: Array.isArray(row.scopeCampaignGroupIds) ? row.scopeCampaignGroupIds.map(String) : undefined,
    campaignName: typeof row.campaignName === "string" ? row.campaignName : undefined,
    adGroupName: typeof row.adGroupName === "string" ? row.adGroupName : undefined,
    keyword: String(row.keyword ?? row.target ?? "keyword"),
    target: String(row.target ?? row.keyword ?? "target"),
    matchType: String(row.matchType ?? "broad"),
    impressions: requiredMetric(row, "impressions", index, "overallAdDataRows"),
    clicks: requiredMetric(row, "clicks", index, "overallAdDataRows"),
    orders: requiredMetric(row, "orders", index, "overallAdDataRows"),
    sales: requiredMetric(row, "sales", index, "overallAdDataRows"),
    spend: requiredMetric(row, "spend", index, "overallAdDataRows"),
    cpc: numberValue(row.cpc, undefined),
    acos: numberValue(row.acos, undefined),
    roas: numberValue(row.roas, undefined),
    matchStatus: normalizeMatchStatus(row.matchStatus),
    matchError: typeof row.matchError === "string" ? row.matchError : undefined,
  }));
}

export function deriveScopeFromRows(rows: PerformanceRow[]) {
  return Array.from(new Set(rows.map((row) => row.campaignGroupId))).slice(0, 6);
}

export function productContextText(value: JsonValue | null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  return String(record.title ?? record.name ?? record.summary ?? record.productName ?? "");
}

export function normalizeLifecycleGroupId(value: unknown) {
  return value === "launch" || value === "mature" || value === "decline" || value === "clearance" ? value : undefined;
}

export function normalizeMatchStatus(value: unknown) {
  return value === "matched" || value === "unmatched" || value === "ambiguous" ? value : "matched";
}

export function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value.map(String).map((item) => item.trim()).filter(Boolean);
}

export function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function roundBid(value: number) {
  return Math.max(0.02, Number(value.toFixed(2)));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function numberValue(value: unknown, fallback: number): number;

export function numberValue(value: unknown, fallback: undefined): number | undefined;

export function numberValue(value: unknown, fallback: number | undefined) {
  if (typeof value !== "number" && (typeof value !== "string" || !value.trim())) return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function requiredMetric(row: Record<string, unknown>, field: string, index: number, source: string): number {
  const value = numberValue(row[field], undefined);
  if (value === undefined) throw new Error(`NEEDS_DATA：${source}[${index}].${field} 缺少有效数字，不能作为零值分析。`);
  return value;
}

export function toJsonValue(value: unknown): JsonValue {
  if (value === null || value === undefined) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => toJsonValue(item));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, toJsonValue(item)]));
  }
  return null;
}

export function extractJsonObject(value: JsonValue | undefined) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as JsonObject;
}

export function formatPercent(value: number) {
  return `${Number(value.toFixed(1))}%`;
}
