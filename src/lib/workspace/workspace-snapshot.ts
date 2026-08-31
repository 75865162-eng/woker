import { defaultRules } from "@/data/mock-data";
import type {
  AdjustmentDraft,
  BlockedCampaignIdentity,
  CampaignGroup,
  CampaignSheetGroup,
  ConditionGroup,
  ExportHistoryRecord,
  LifecycleGroupId,
  OverallAdDataMatchSummary,
  OverallAdDataRow,
  OverallAdDataStatus,
  OverallAdDataUpload,
  ParseJobStatus,
  PerformanceRow,
  Rule,
  RuleRunHistoryRecord,
  WorkspaceUnit,
} from "@/lib/types";
import type { ParseDiagnostics } from "@/lib/workspace/workspace-import";

export type WorkspaceSnapshot = {
  rules: Rule[];
  campaignGroups: CampaignGroup[];
  campaignSheetGroups: CampaignSheetGroup[];
  workspaceUnits: WorkspaceUnit[];
  performanceRows: PerformanceRow[];
  activeCampaignGroupId: string;
  activeWorkspaceUnitId?: string;
  activeLifecycleGroupId?: LifecycleGroupId;
  workspaceMode: "campaign" | "lifecycle" | "workspace-unit";
  openTabIds: string[];
  selectedDraftIds: string[];
  parseStatus: ParseJobStatus;
  parseProgress: number;
  uploadedFileName?: string;
  originalWorkbookFileId?: string;
  originalWorkbookFileName?: string;
  originalWorkbookBuffer?: ArrayBuffer;
  activeBatchId?: string;
  parsedRowCount: number;
  parsedSheets: string[];
  parseError?: string;
  parseDiagnostics: ParseDiagnostics;
  overallAdDataFileName?: string;
  overallAdDataRows: OverallAdDataRow[];
  overallAdDataStatus: OverallAdDataStatus;
  overallAdDataError?: string;
  overallAdDataMatchSummary: OverallAdDataMatchSummary;
  overallAdDataUploads: OverallAdDataUpload[];
  adjustmentDrafts: AdjustmentDraft[];
  pendingAdjustmentDrafts: AdjustmentDraft[];
  exportHistoryRecords: ExportHistoryRecord[];
  ruleRunHistoryRecords: RuleRunHistoryRecord[];
  blockedCampaignIdentities: BlockedCampaignIdentity[];
};

export type LegacyWorkspaceSnapshot = WorkspaceSnapshot &
  Partial<{
    recentAdDataFileName: string;
    recentAdDataRows: OverallAdDataRow[];
    recentAdDataStatus: OverallAdDataStatus;
    recentAdDataError: string;
    recentAdDataMatchSummary: OverallAdDataMatchSummary;
  }>;

export function takeWorkspaceSnapshot(state: WorkspaceSnapshot): WorkspaceSnapshot {
  return {
    rules: state.rules,
    campaignGroups: state.campaignGroups,
    campaignSheetGroups: state.campaignSheetGroups,
    workspaceUnits: state.workspaceUnits,
    performanceRows: state.performanceRows,
    activeCampaignGroupId: state.activeCampaignGroupId,
    activeWorkspaceUnitId: state.activeWorkspaceUnitId,
    activeLifecycleGroupId: state.activeLifecycleGroupId,
    workspaceMode: state.workspaceMode,
    openTabIds: state.openTabIds,
    selectedDraftIds: state.selectedDraftIds,
    parseStatus: state.parseStatus,
    parseProgress: state.parseProgress,
    uploadedFileName: state.uploadedFileName,
    originalWorkbookFileId: state.originalWorkbookFileId,
    originalWorkbookFileName: state.originalWorkbookFileName,
    activeBatchId: state.activeBatchId,
    parsedRowCount: state.parsedRowCount,
    parsedSheets: state.parsedSheets,
    parseError: state.parseError,
    parseDiagnostics: state.parseDiagnostics,
    overallAdDataFileName: state.overallAdDataFileName,
    overallAdDataRows: state.overallAdDataRows,
    overallAdDataStatus: state.overallAdDataStatus,
    overallAdDataError: state.overallAdDataError,
    overallAdDataMatchSummary: state.overallAdDataMatchSummary,
    overallAdDataUploads: state.overallAdDataUploads,
    adjustmentDrafts: state.adjustmentDrafts,
    pendingAdjustmentDrafts: state.pendingAdjustmentDrafts,
    exportHistoryRecords: state.exportHistoryRecords,
    ruleRunHistoryRecords: state.ruleRunHistoryRecords,
    blockedCampaignIdentities: state.blockedCampaignIdentities,
  };
}

function migrateConditionGroupDataSources(group: ConditionGroup): ConditionGroup {
  return {
    ...group,
    conditions: group.conditions.map((item) => {
      if ("logic" in item) {
        return migrateConditionGroupDataSources(item);
      }

      const legacyDataSource = item.dataSource as string | undefined;

      return {
        ...item,
        dataSource: legacyDataSource === "recent" ? "overall" : item.dataSource,
      };
    }),
  };
}

function migrateRulesDataSources(rules: Rule[]) {
  return rules.map((rule) => ({
    ...rule,
    conditionGroup: migrateConditionGroupDataSources(rule.conditionGroup),
  }));
}

export function mergeDefaultRulesWithPersistedRules(rules: Rule[]) {
  const migratedRules = migrateRulesDataSources(rules);
  const defaultRuleIds = new Set(defaultRules.map((rule) => rule.id));
  const legacyDefaultRuleIds = new Set([
    "launch-bv-02-low-impression-boost",
    "mature-bv-02-low-impression-boost",
    "decline-bv-02-low-impression-boost",
    "clearance-bv-02-low-impression-boost",
  ]);
  const persistedCustomRules = migratedRules.filter((rule) => !defaultRuleIds.has(rule.id) && !legacyDefaultRuleIds.has(rule.id));
  const migratedRuleById = new Map(migratedRules.map((rule) => [rule.id, rule]));

  return [
    ...defaultRules.map((defaultRule) => {
      const persistedRule = migratedRuleById.get(defaultRule.id);

      if (!persistedRule) {
        return defaultRule;
      }

      return {
        ...defaultRule,
        enabled: persistedRule.enabled,
      };
    }),
    ...persistedCustomRules,
  ];
}

export function migrateWorkspaceSnapshot(
  snapshot: LegacyWorkspaceSnapshot,
  emptyOverallAdDataMatchSummary: OverallAdDataMatchSummary,
): WorkspaceSnapshot {
  return {
    ...snapshot,
    rules: mergeDefaultRulesWithPersistedRules(snapshot.rules ?? defaultRules),
    overallAdDataFileName: snapshot.overallAdDataFileName ?? snapshot.recentAdDataFileName,
    overallAdDataRows: snapshot.overallAdDataRows ?? snapshot.recentAdDataRows ?? [],
    overallAdDataStatus: snapshot.overallAdDataStatus ?? snapshot.recentAdDataStatus ?? "idle",
    overallAdDataError: snapshot.overallAdDataError ?? snapshot.recentAdDataError,
    overallAdDataMatchSummary:
      snapshot.overallAdDataMatchSummary ?? snapshot.recentAdDataMatchSummary ?? emptyOverallAdDataMatchSummary,
    overallAdDataUploads:
      snapshot.overallAdDataUploads ??
      ((snapshot.overallAdDataRows ?? snapshot.recentAdDataRows ?? []).length
        ? [{
            id: `overall-upload-migrated-${Date.now()}`,
            uploadedAt: new Date().toISOString(),
            fileName: snapshot.overallAdDataFileName ?? snapshot.recentAdDataFileName ?? "Overall CSV",
            scopeCampaignGroupIds:
              (snapshot.overallAdDataRows ?? snapshot.recentAdDataRows ?? [])[0]?.scopeCampaignGroupIds ?? [],
            rows: snapshot.overallAdDataRows ?? snapshot.recentAdDataRows ?? [],
            status: snapshot.overallAdDataStatus ?? snapshot.recentAdDataStatus ?? "matched",
            error: snapshot.overallAdDataError ?? snapshot.recentAdDataError,
            matchSummary:
              snapshot.overallAdDataMatchSummary ?? snapshot.recentAdDataMatchSummary ?? emptyOverallAdDataMatchSummary,
          }]
        : []),
    exportHistoryRecords: snapshot.exportHistoryRecords ?? [],
    ruleRunHistoryRecords: snapshot.ruleRunHistoryRecords ?? [],
    blockedCampaignIdentities: snapshot.blockedCampaignIdentities ?? [],
    pendingAdjustmentDrafts: snapshot.pendingAdjustmentDrafts ?? [],
  };
}
