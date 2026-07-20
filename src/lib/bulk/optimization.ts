import { runRuleEngine } from "@/lib/rule-engine/engine";
import type { AdjustmentDraft, CampaignGroup, DataBatch, OverallAdDataRow, PerformanceRow, Rule, WorkspaceUnit } from "@/lib/types";

function selectRowsForCampaignGroup(input: {
  campaignGroup: CampaignGroup;
  rows: PerformanceRow[];
  dataBatches: DataBatch[];
  activeBatchId?: string;
}) {
  const scopedBatchIds = input.dataBatches
    .filter((batch) => batch.campaignGroupId === input.campaignGroup.id)
    .slice(-1)
    .map((batch) => batch.id);

  return input.rows.filter((row) => {
    const isActiveGroup = row.campaignGroupId === input.campaignGroup.id;
    const isImportedBatch = input.activeBatchId ? row.batchId === input.activeBatchId : false;
    const isMockBatch = scopedBatchIds.includes(row.batchId);

    return isActiveGroup && (isImportedBatch || isMockBatch);
  });
}

export function runBulkOptimizationForCampaignGroup(input: {
  campaignGroup: CampaignGroup;
  rows: PerformanceRow[];
  dataBatches: DataBatch[];
  activeBatchId?: string;
  overallAdDataRows: OverallAdDataRow[];
  rules: Rule[];
}): AdjustmentDraft[] {
  return runRuleEngine({
    campaignGroup: input.campaignGroup,
    rows: selectRowsForCampaignGroup(input),
    overallAdDataRows: input.overallAdDataRows,
    rules: input.rules,
  });
}

export function runBulkOptimizationForLifecycleGroup(input: {
  lifecycleGroupId: string;
  campaignGroups: CampaignGroup[];
  rows: PerformanceRow[];
  dataBatches: DataBatch[];
  activeBatchId?: string;
  overallAdDataRows: OverallAdDataRow[];
  rules: Rule[];
}): AdjustmentDraft[] {
  return input.campaignGroups
    .filter((group) => group.lifecycleGroupId === input.lifecycleGroupId)
    .flatMap((campaignGroup) =>
      runBulkOptimizationForCampaignGroup({
        campaignGroup,
        rows: input.rows,
        dataBatches: input.dataBatches,
        activeBatchId: input.activeBatchId,
        overallAdDataRows: input.overallAdDataRows,
        rules: input.rules,
      }),
    );
}

export function runBulkOptimizationForWorkspaceUnit(input: {
  workspaceUnit: WorkspaceUnit;
  campaignGroups: CampaignGroup[];
  rows: PerformanceRow[];
  dataBatches: DataBatch[];
  activeBatchId?: string;
  overallAdDataRows: OverallAdDataRow[];
  rules: Rule[];
}): AdjustmentDraft[] {
  const scopedOverallRows = input.overallAdDataRows.filter(
    (row) => !row.campaignGroupId || input.workspaceUnit.campaignGroupIds.includes(row.campaignGroupId),
  );

  return input.workspaceUnit.campaignGroupIds.flatMap((campaignGroupId) => {
    const campaignGroup = input.campaignGroups.find((group) => group.id === campaignGroupId);

    if (!campaignGroup) {
      return [];
    }

    return runBulkOptimizationForCampaignGroup({
      campaignGroup,
      rows: input.rows,
      dataBatches: input.dataBatches,
      activeBatchId: input.activeBatchId,
      overallAdDataRows: scopedOverallRows,
      rules: input.rules,
    });
  });
}
