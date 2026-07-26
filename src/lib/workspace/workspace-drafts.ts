import type {
  AdjustmentDraft,
  CampaignGroup,
  OverallAdDataMatchSummary,
  OverallAdDataRow,
  OverallAdDataUpload,
  PerformanceRow,
  RuleRunHistoryRecord,
} from "@/lib/types";

export function getRunnableRowsForCampaignGroup(input: {
  performanceRows: PerformanceRow[];
  activeBatchId?: string;
  mockBatchIds: string[];
  campaignGroupId: string;
}) {
  return input.performanceRows.filter((row) => {
    const isActiveGroup = row.campaignGroupId === input.campaignGroupId;
    const isImportedBatch = input.activeBatchId ? row.batchId === input.activeBatchId : false;
    const isMockBatch = input.mockBatchIds.includes(row.batchId);

    return isActiveGroup && (isImportedBatch || isMockBatch);
  });
}

export function buildNoDraftMessage(input: {
  groupCount: number;
  runnableRowCount: number;
  ruleCount: number;
  overallMatchedRowCount?: number;
}) {
  if (input.groupCount === 0) {
    return "当前没有可运行的广告组，请先选择或分配广告组。";
  }

  if (input.ruleCount === 0) {
    return "当前产品周期没有启用规则，请先在规则页启用规则。";
  }

  if (input.runnableRowCount === 0) {
    return "当前广告组没有可运行的 Bulk 行，请确认已上传 Bulk 文件并选择了包含关键词/投放对象和竞价的广告组。";
  }

  if ((input.overallMatchedRowCount ?? 0) > 0) {
    return `规则引擎已运行，但没有生成可写回草稿。Sellfox Overall 已匹配 ${input.overallMatchedRowCount} 行，当前范围有 ${input.runnableRowCount} 条可运行 Bulk 行、${input.ruleCount} 条启用规则；说明匹配正常，但这些行没有达到当前生命周期规则的触发条件。`;
  }

  return "规则引擎已运行，但当前数据没有命中任何启用规则，所以没有生成可写回草稿。";
}

export function replacePendingDraftsForCampaignGroups(
  pendingDrafts: AdjustmentDraft[],
  campaignGroupIds: string[],
  nextDrafts: AdjustmentDraft[],
) {
  const scopeIds = new Set(campaignGroupIds);

  return [
    ...pendingDrafts.filter((draft) => !scopeIds.has(draft.campaignGroupId)),
    ...nextDrafts.map((draft) => ({ ...draft, selected: true })),
  ];
}

function sameCampaignScope(left: string[], right: string[]) {
  return left.length === right.length && left.every((id) => right.includes(id));
}

function containsCampaignScope(container: string[], scope: string[]) {
  return scope.every((id) => container.includes(id));
}

export function findOverallAdDataUploadForScope(uploads: OverallAdDataUpload[], scopeCampaignGroupIds: string[]) {
  return (
    uploads.find((item) => sameCampaignScope(item.scopeCampaignGroupIds, scopeCampaignGroupIds)) ??
    uploads.find((item) => containsCampaignScope(item.scopeCampaignGroupIds, scopeCampaignGroupIds))
  );
}

export function summarizeOverallRows(rows: OverallAdDataRow[], scopedCampaignGroups: number): OverallAdDataMatchSummary {
  const matchedCampaignGroups = new Set(rows.flatMap((row) => (row.campaignGroupId ? [row.campaignGroupId] : []))).size;

  return {
    totalRows: rows.length,
    matchedRows: rows.filter((row) => row.matchStatus !== "unmatched" && row.campaignGroupId).length,
    unmatchedRows: rows.filter((row) => row.matchStatus === "unmatched").length,
    ambiguousRows: rows.filter((row) => row.matchStatus === "ambiguous").length,
    matchedCampaignGroups,
    scopedCampaignGroups,
  };
}

export function upsertOverallAdDataUpload(
  uploads: OverallAdDataUpload[],
  upload: OverallAdDataUpload,
) {
  return [upload, ...uploads.filter((item) => !sameCampaignScope(item.scopeCampaignGroupIds, upload.scopeCampaignGroupIds))];
}

export function createRuleRunHistory(input: {
  campaignGroups: CampaignGroup[];
  uploadedFileName?: string;
  overallAdDataFileName?: string;
  overallAdDataRows: OverallAdDataRow[];
  overallAdDataMatchSummary: OverallAdDataMatchSummary;
  campaignGroupIds: string[];
  drafts: AdjustmentDraft[];
}) {
  const ranAt = new Date().toISOString();
  const runIdByCampaignGroupId = new Map(
    input.campaignGroupIds.map((campaignGroupId) => [
      campaignGroupId,
      `rule-run-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    ]),
  );
  const adjustmentDrafts = input.drafts.map((draft) => ({
    ...draft,
    runHistoryId: runIdByCampaignGroupId.get(draft.campaignGroupId),
    selected: true,
  }));
  const records: RuleRunHistoryRecord[] = input.campaignGroupIds.map((campaignGroupId) => {
    const campaignGroup = input.campaignGroups.find((group) => group.id === campaignGroupId);

    return {
      id: runIdByCampaignGroupId.get(campaignGroupId)!,
      ranAt,
      bulkFileName: input.uploadedFileName,
      overallFileName: input.overallAdDataFileName,
      campaignGroupIds: [campaignGroupId],
      campaignGroupNames: [campaignGroup?.adGroupName ?? campaignGroupId],
      overallAdDataRows: input.overallAdDataRows,
      overallAdDataMatchSummary: input.overallAdDataMatchSummary,
      adjustmentDrafts: adjustmentDrafts.filter((draft) => draft.campaignGroupId === campaignGroupId),
    };
  });

  return { records, adjustmentDrafts };
}
