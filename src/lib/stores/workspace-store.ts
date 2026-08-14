"use client";

import { create } from "zustand";
import { campaignGroups, dataBatches, defaultRules, performanceRows as mockPerformanceRows } from "@/data/mock-data";
import {
  deleteWorkspaceSnapshot,
  readWorkspaceSnapshot,
  writeWorkspaceSnapshot,
} from "@/lib/repositories/workspace-repository";
import { runRuleEngine } from "@/lib/rule-engine/engine";
import {
  buildNoDraftMessage,
  createRuleRunHistory,
  findOverallAdDataUploadForScope,
  getRunnableRowsForCampaignGroup,
  replacePendingDraftsForCampaignGroups,
  summarizeOverallRows,
  upsertOverallAdDataUpload,
} from "@/lib/workspace/workspace-drafts";
import {
  buildBlockedCampaignIdentityId,
  buildGroupsFromRows,
  buildOverallAdDataRows,
  buildOverallAdDataRowsFromFiles,
  buildParseFailureMessage,
  buildSheetGroups,
  buildWorkspaceUnitName,
  buildWorkspaceUnitsFromGroupingRows,
  collectDiagnostics,
  createWorkspaceUnitId,
  detachCampaignGroupFromWorkspaceUnits,
  findWorkspaceUnitByCampaignGroupId,
  matchOverallAdDataRows,
  parseCsv,
  rebuildWorkspaceUnits,
  toPerformanceRow,
  upsertWorkspaceUnitForCampaign,
  type OverallAdDataCsvFile,
  type ParseDiagnostics,
  type SheetRow,
} from "@/lib/workspace/workspace-import";
import {
  mergeDefaultRulesWithPersistedRules,
  migrateWorkspaceSnapshot,
  takeWorkspaceSnapshot,
  type LegacyWorkspaceSnapshot,
} from "@/lib/workspace/workspace-snapshot";
import type {
  AdjustmentDraft,
  BlockedCampaignIdentity,
  CampaignGroup,
  CampaignSheetGroup,
  ExportHistoryRecord,
  LifecycleGroupId,
  ParseJobStatus,
  PerformanceRow,
  OverallAdDataMatchSummary,
  OverallAdDataRow,
  OverallAdDataStatus,
  OverallAdDataUpload,
  Rule,
  RuleRunHistoryRecord,
  WorkspaceDatasetPayload,
  WorkspaceUnit,
} from "@/lib/types";

type RunRulesResult = {
  draftCount: number;
  message?: string;
};

interface WorkspaceState {
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
  workspaceDatasetId?: string;
  sourceFileId?: string;
  importJobId?: string;
  sourceParserVersion?: string;
  sourceDatasetCreatedAt?: string;
  activeDraftRunId?: string;
  persistenceStatus: "loading" | "ready" | "saving" | "saved" | "failed";
  persistenceError?: string;
  setRules: (rules: Rule[]) => void;
  upsertRule: (rule: Rule) => void;
  deleteRule: (ruleId: string) => void;
  setActiveCampaignGroup: (campaignGroupId: string) => void;
  openCampaignGroup: (campaignGroupId: string) => void;
  mergeCampaignGroupsIntoWorkspaceUnit: (sourceCampaignGroupId: string, targetCampaignGroupId: string) => void;
  removeCampaignGroupFromWorkspaceUnit: (campaignGroupId: string) => void;
  setActiveWorkspaceUnit: (workspaceUnitId: string) => void;
  setActiveLifecycleGroup: (lifecycleGroupId?: LifecycleGroupId) => void;
  assignLifecycleGroup: (campaignGroupId: string, lifecycleGroupId: LifecycleGroupId) => void;
  clearLifecycleGroup: (campaignGroupId: string) => void;
  blockCampaignGroup: (campaignGroupId: string) => void;
  unblockCampaignIdentity: (identityId: string) => void;
  importGroupingStatusCsv: (fileName: string, text: string) => { importedRows: number; workspaceUnitCount: number };
  runRulesForActiveGroup: () => RunRulesResult;
  runRulesForActiveLifecycleGroup: () => RunRulesResult;
  runRulesForActiveWorkspaceUnit: () => RunRulesResult;
  runRulesForMatchedOverallGroups: () => RunRulesResult;
  toggleDraft: (draftId: string) => void;
  setDraftSelected: (draftId: string, selected: boolean) => void;
  selectAllDrafts: () => void;
  invertDraftSelection: () => void;
  clearDraftSelection: () => void;
  removePendingDraftsForCampaignGroup: (campaignGroupId: string) => void;
  clearPendingAdjustmentDrafts: () => void;
  setParseStarted: (fileName: string, originalWorkbookBuffer: ArrayBuffer) => void;
  applyWorkspaceDataset: (dataset: WorkspaceDatasetPayload, originalWorkbookBuffer?: ArrayBuffer) => void;
  setActiveDraftRunId: (draftRunId?: string) => void;
  setParseProgress: (progress: number, sheets?: string[]) => void;
  ingestParsedRows: (sheetName: string, rows: SheetRow[], startRowIndex: number) => void;
  setParseCompleted: (rowCount: number, sheets: string[]) => void;
  setParseFailed: (message: string) => void;
  ingestOverallAdDataCsv: (fileName: string, text: string, scopeCampaignGroupIds: string[]) => void;
  ingestOverallAdDataCsvFiles: (files: OverallAdDataCsvFile[], scopeCampaignGroupIds: string[]) => void;
  activateOverallAdDataForScope: (scopeCampaignGroupIds: string[]) => boolean;
  recordExportHistory: (fileName: string, drafts?: AdjustmentDraft[]) => void;
  reuseExportHistory: (recordId: string) => void;
  reuseRuleRunHistory: (recordId: string) => void;
  hydratePersistedWorkspace: () => Promise<void>;
  clearPersistedWorkspace: () => Promise<void>;
}

const initialActiveId = campaignGroups[0]?.id ?? "";

const emptyDiagnostics: ParseDiagnostics = {
  totalRows: 0,
  sponsoredProductRows: 0,
  rowsWithAdGroup: 0,
  keywordRows: 0,
  rowsWithBid: 0,
  executableRows: 0,
  sampleHeaders: [],
  sampleEntities: [],
};

const emptyOverallAdDataMatchSummary: OverallAdDataMatchSummary = {
  totalRows: 0,
  matchedRows: 0,
  unmatchedRows: 0,
  ambiguousRows: 0,
  matchedCampaignGroups: 0,
  scopedCampaignGroups: 0,
};

function countMatchedOverallRowsForCampaignGroups(rows: OverallAdDataRow[], campaignGroupIds: string[]) {
  const scopeIds = new Set(campaignGroupIds);

  return rows.filter((row) => row.matchStatus !== "unmatched" && row.campaignGroupId && scopeIds.has(row.campaignGroupId)).length;
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  rules: defaultRules,
  campaignGroups,
  campaignSheetGroups: buildSheetGroups(campaignGroups),
  workspaceUnits: [],
  performanceRows: mockPerformanceRows,
  activeCampaignGroupId: initialActiveId,
  activeWorkspaceUnitId: undefined,
  activeLifecycleGroupId: undefined,
  workspaceMode: "campaign",
  openTabIds: campaignGroups.slice(0, 4).map((group) => group.id),
  selectedDraftIds: [],
  parseStatus: "idle",
  parseProgress: 0,
  uploadedFileName: undefined,
  originalWorkbookBuffer: undefined,
  activeBatchId: undefined,
  parsedRowCount: 0,
  parsedSheets: [],
  parseError: undefined,
  parseDiagnostics: emptyDiagnostics,
  overallAdDataFileName: undefined,
  overallAdDataRows: [],
  overallAdDataStatus: "idle",
  overallAdDataError: undefined,
  overallAdDataMatchSummary: emptyOverallAdDataMatchSummary,
  overallAdDataUploads: [],
  adjustmentDrafts: [],
  pendingAdjustmentDrafts: [],
  exportHistoryRecords: [],
  ruleRunHistoryRecords: [],
  blockedCampaignIdentities: [],
  workspaceDatasetId: undefined,
  sourceFileId: undefined,
  importJobId: undefined,
  sourceParserVersion: undefined,
  sourceDatasetCreatedAt: undefined,
  activeDraftRunId: undefined,
  persistenceStatus: "loading",
  persistenceError: undefined,
  setRules: (rules) => set({ rules }),
  upsertRule: (rule) =>
    set((state) => ({
      rules: state.rules.some((existingRule) => existingRule.id === rule.id)
        ? state.rules.map((existingRule) => (existingRule.id === rule.id ? rule : existingRule))
        : [...state.rules, rule],
    })),
  deleteRule: (ruleId) =>
    set((state) => ({
      rules: state.rules.filter((rule) => rule.id !== ruleId),
    })),
  setActiveCampaignGroup: (campaignGroupId) =>
    set((state) => ({
      activeCampaignGroupId: campaignGroupId,
      activeWorkspaceUnitId: undefined,
      workspaceMode: "campaign",
      openTabIds: state.openTabIds.includes(campaignGroupId)
        ? state.openTabIds
        : [...state.openTabIds, campaignGroupId],
    })),
  openCampaignGroup: (campaignGroupId) =>
    set((state) => ({
      activeCampaignGroupId: campaignGroupId,
      activeWorkspaceUnitId: undefined,
      activeLifecycleGroupId: undefined,
      workspaceMode: "campaign",
      openTabIds: state.openTabIds.includes(campaignGroupId)
        ? state.openTabIds
        : [campaignGroupId, ...state.openTabIds].slice(0, 12),
      adjustmentDrafts: [],
      selectedDraftIds: [],
    })),
  mergeCampaignGroupsIntoWorkspaceUnit: (sourceCampaignGroupId, targetCampaignGroupId) =>
    set((state) => {
      if (sourceCampaignGroupId === targetCampaignGroupId) {
        return state;
      }

      const sourceGroup = state.campaignGroups.find((group) => group.id === sourceCampaignGroupId);
      const targetGroup = state.campaignGroups.find((group) => group.id === targetCampaignGroupId);

      if (!sourceGroup || !targetGroup) {
        return state;
      }

      const targetUnit = findWorkspaceUnitByCampaignGroupId(state.workspaceUnits, targetCampaignGroupId);
      const sourceUnit = findWorkspaceUnitByCampaignGroupId(state.workspaceUnits, sourceCampaignGroupId);
      let workspaceUnits = detachCampaignGroupFromWorkspaceUnits(state.workspaceUnits, sourceCampaignGroupId);

      if (targetUnit) {
        workspaceUnits = upsertWorkspaceUnitForCampaign(workspaceUnits, state.campaignGroups, sourceCampaignGroupId, targetUnit.id);
      } else {
        const id = sourceUnit?.id ?? createWorkspaceUnitId();
        const campaignGroupIds = Array.from(new Set([targetCampaignGroupId, sourceCampaignGroupId]));
        const groups = state.campaignGroups.filter((group) => campaignGroupIds.includes(group.id));

        workspaceUnits.push({
          id,
          name: buildWorkspaceUnitName(groups),
          campaignGroupIds,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      const activeWorkspaceUnit =
        findWorkspaceUnitByCampaignGroupId(workspaceUnits, targetCampaignGroupId) ??
        findWorkspaceUnitByCampaignGroupId(workspaceUnits, sourceCampaignGroupId);

      return {
        workspaceUnits,
        activeWorkspaceUnitId: activeWorkspaceUnit?.id ?? state.activeWorkspaceUnitId,
        activeCampaignGroupId: targetCampaignGroupId,
        activeLifecycleGroupId: undefined,
        workspaceMode: activeWorkspaceUnit ? "workspace-unit" : state.workspaceMode,
        openTabIds: Array.from(new Set([targetCampaignGroupId, sourceCampaignGroupId, ...state.openTabIds])).slice(0, 12),
        adjustmentDrafts: [],
        selectedDraftIds: [],
      };
    }),
  removeCampaignGroupFromWorkspaceUnit: (campaignGroupId) =>
    set((state) => {
      const existingUnit = findWorkspaceUnitByCampaignGroupId(state.workspaceUnits, campaignGroupId);

      if (!existingUnit) {
        return state;
      }

      const workspaceUnits = rebuildWorkspaceUnits(
        detachCampaignGroupFromWorkspaceUnits(state.workspaceUnits, campaignGroupId),
        state.campaignGroups,
      );
      const nextActiveWorkspaceUnit =
        state.activeWorkspaceUnitId && existingUnit.id === state.activeWorkspaceUnitId
          ? workspaceUnits.find((unit) => unit.id === existingUnit.id)
          : undefined;
      const nextActiveCampaignGroupId =
        nextActiveWorkspaceUnit?.campaignGroupIds[0] ??
        (state.activeCampaignGroupId === campaignGroupId ? existingUnit.campaignGroupIds.find((id) => id !== campaignGroupId) : undefined) ??
        state.activeCampaignGroupId;

      return {
        workspaceUnits,
        activeWorkspaceUnitId: nextActiveWorkspaceUnit?.id,
        activeCampaignGroupId: nextActiveCampaignGroupId,
        workspaceMode: nextActiveWorkspaceUnit ? "workspace-unit" : "campaign",
        openTabIds: state.openTabIds.filter((id) => id !== campaignGroupId),
        adjustmentDrafts: [],
        selectedDraftIds: [],
      };
    }),
  setActiveWorkspaceUnit: (workspaceUnitId) =>
    set((state) => {
      const workspaceUnit = state.workspaceUnits.find((unit) => unit.id === workspaceUnitId);
      const activeCampaignGroupId = workspaceUnit?.campaignGroupIds[0] ?? state.activeCampaignGroupId;

      return workspaceUnit
        ? {
            activeWorkspaceUnitId: workspaceUnitId,
            activeCampaignGroupId,
            activeLifecycleGroupId: undefined,
            workspaceMode: "workspace-unit" as const,
            openTabIds: Array.from(new Set([...workspaceUnit.campaignGroupIds, ...state.openTabIds])).slice(0, 12),
            adjustmentDrafts: [],
            selectedDraftIds: [],
          }
        : state;
    }),
  setActiveLifecycleGroup: (lifecycleGroupId) =>
    set((state) => {
      if (!lifecycleGroupId) {
        return {
          activeLifecycleGroupId: undefined,
          activeWorkspaceUnitId: undefined,
          workspaceMode: "campaign" as const,
          adjustmentDrafts: [],
          selectedDraftIds: [],
        };
      }

      const assignedGroups = state.campaignGroups.filter((group) => group.lifecycleGroupId === lifecycleGroupId);
      const activeCampaignGroupId = assignedGroups.some((group) => group.id === state.activeCampaignGroupId)
        ? state.activeCampaignGroupId
        : assignedGroups[0]?.id ?? "";

      return {
        activeLifecycleGroupId: lifecycleGroupId,
        activeCampaignGroupId,
        activeWorkspaceUnitId: undefined,
        workspaceMode: "lifecycle",
        openTabIds: assignedGroups.map((group) => group.id),
        adjustmentDrafts: [],
        selectedDraftIds: [],
      };
    }),
  assignLifecycleGroup: (campaignGroupId, lifecycleGroupId) =>
    set((state) => {
      const campaignGroups = state.campaignGroups.map((group) =>
        group.id === campaignGroupId ? { ...group, lifecycleGroupId } : group,
      );
      const assignedGroups = campaignGroups.filter((group) => group.lifecycleGroupId === lifecycleGroupId);

      return {
        campaignGroups,
        campaignSheetGroups: buildSheetGroups(campaignGroups),
        activeLifecycleGroupId: state.workspaceMode === "lifecycle" ? lifecycleGroupId : state.activeLifecycleGroupId,
        openTabIds:
          state.workspaceMode === "lifecycle"
            ? assignedGroups.map((group) => group.id)
            : state.openTabIds.includes(campaignGroupId)
              ? state.openTabIds
              : [...state.openTabIds, campaignGroupId],
        activeCampaignGroupId: campaignGroupId,
      };
    }),
  clearLifecycleGroup: (campaignGroupId) =>
    set((state) => {
      const campaignGroups = state.campaignGroups.map((group) =>
        group.id === campaignGroupId ? { ...group, lifecycleGroupId: undefined } : group,
      );

      return {
        campaignGroups,
        campaignSheetGroups: buildSheetGroups(campaignGroups),
        activeLifecycleGroupId:
          state.workspaceMode === "lifecycle" ? undefined : state.activeLifecycleGroupId,
        workspaceMode: state.workspaceMode === "lifecycle" ? "campaign" : state.workspaceMode,
        activeCampaignGroupId: campaignGroupId,
        adjustmentDrafts: [],
        selectedDraftIds: [],
      };
    }),
  blockCampaignGroup: (campaignGroupId) =>
    set((state) => {
      const campaignGroup = state.campaignGroups.find((group) => group.id === campaignGroupId);

      if (!campaignGroup) {
        return {};
      }

      const id = buildBlockedCampaignIdentityId(campaignGroup.campaignName, campaignGroup.adGroupName);
      const blockedCampaignIdentities = state.blockedCampaignIdentities.some((identity) => identity.id === id)
        ? state.blockedCampaignIdentities
        : [
            ...state.blockedCampaignIdentities,
            {
              id,
              campaignName: campaignGroup.campaignName,
              adGroupName: campaignGroup.adGroupName,
              blockedAt: new Date().toISOString(),
            },
          ];
      const workspaceUnits = rebuildWorkspaceUnits(
        detachCampaignGroupFromWorkspaceUnits(state.workspaceUnits, campaignGroupId),
        state.campaignGroups,
      );

      return {
        blockedCampaignIdentities,
        workspaceUnits,
        activeWorkspaceUnitId: undefined,
        workspaceMode: state.workspaceMode === "workspace-unit" ? "campaign" : state.workspaceMode,
        openTabIds: state.openTabIds.filter((id) => id !== campaignGroupId),
        adjustmentDrafts: [],
        selectedDraftIds: [],
      };
    }),
  unblockCampaignIdentity: (identityId) =>
    set((state) => ({
      blockedCampaignIdentities: state.blockedCampaignIdentities.filter((identity) => identity.id !== identityId),
    })),
  importGroupingStatusCsv: (_fileName, text) => {
    const rows = parseCsv(text);
    const result = buildWorkspaceUnitsFromGroupingRows(rows, get().campaignGroups);

    set((state) => {
      const campaignGroups = state.campaignGroups.map((group) =>
        result.lifecycleByCampaignGroupId.has(group.id)
          ? { ...group, lifecycleGroupId: result.lifecycleByCampaignGroupId.get(group.id) }
          : group,
      );
      const activeWorkspaceUnit = result.workspaceUnits.find((unit) => unit.campaignGroupIds.includes(state.activeCampaignGroupId));

      return {
        campaignGroups,
        campaignSheetGroups: buildSheetGroups(campaignGroups),
        workspaceUnits: result.workspaceUnits,
        activeWorkspaceUnitId: activeWorkspaceUnit?.id,
        workspaceMode: activeWorkspaceUnit ? "workspace-unit" : "campaign",
        adjustmentDrafts: [],
        selectedDraftIds: [],
      };
    });

    return {
      importedRows: result.importedRows,
      workspaceUnitCount: result.workspaceUnits.length,
    };
  },
  runRulesForActiveGroup: () => {
    const state = get();
    const campaignGroup = state.campaignGroups.find((group) => group.id === state.activeCampaignGroupId);
    const rules = mergeDefaultRulesWithPersistedRules(state.rules);

    if (!campaignGroup) {
      return { draftCount: 0, message: buildNoDraftMessage({ groupCount: 0, runnableRowCount: 0, ruleCount: rules.length }) };
    }

    if (!campaignGroup.lifecycleGroupId) {
      return { draftCount: 0, message: "请先把当前广告组拖入新品组、成熟组、衰退组或清库存组，再运行规则引擎。" };
    }

    const scopedCampaignGroups = [campaignGroup];
    const runnableRowsByGroupId = new Map(
      scopedCampaignGroups.map((group) => [
        group.id,
        getRunnableRowsForCampaignGroup({
          performanceRows: state.performanceRows,
          activeBatchId: state.activeBatchId,
          mockBatchIds: dataBatches
            .filter((batch) => batch.campaignGroupId === group.id)
            .slice(-1)
            .map((batch) => batch.id),
          campaignGroupId: group.id,
        }),
      ]),
    );
    const runnableRowCount = Array.from(runnableRowsByGroupId.values()).reduce((total, rows) => total + rows.length, 0);
    const ruleCount = rules.filter((rule) => rule.enabled && rule.lifecycleGroupId === campaignGroup.lifecycleGroupId).length;
    const overallMatchedRowCount = countMatchedOverallRowsForCampaignGroups(
      state.overallAdDataRows,
      scopedCampaignGroups.map((group) => group.id),
    );
    const drafts = scopedCampaignGroups.flatMap((scopedCampaignGroup) => {
      const rows = runnableRowsByGroupId.get(scopedCampaignGroup.id) ?? [];

      return runRuleEngine({
        campaignGroup: scopedCampaignGroup,
        rows,
        overallAdDataRows: state.overallAdDataRows,
        rules,
      });
    });
    const runHistory = createRuleRunHistory({
      campaignGroups: state.campaignGroups,
      uploadedFileName: state.uploadedFileName,
      overallAdDataFileName: state.overallAdDataFileName,
      overallAdDataRows: state.overallAdDataRows,
      overallAdDataMatchSummary: state.overallAdDataMatchSummary,
      campaignGroupIds: scopedCampaignGroups.map((group) => group.id),
      drafts,
    });

    set((current) => ({
      rules,
      adjustmentDrafts: runHistory.adjustmentDrafts,
      pendingAdjustmentDrafts: replacePendingDraftsForCampaignGroups(
        current.pendingAdjustmentDrafts,
        scopedCampaignGroups.map((group) => group.id),
        runHistory.adjustmentDrafts,
      ),
      ruleRunHistoryRecords: [...runHistory.records, ...current.ruleRunHistoryRecords],
      selectedDraftIds: runHistory.adjustmentDrafts.map((draft) => draft.id),
    }));
    return {
      draftCount: drafts.length,
      message:
        drafts.length === 0
          ? buildNoDraftMessage({ groupCount: scopedCampaignGroups.length, runnableRowCount, ruleCount, overallMatchedRowCount })
          : undefined,
    };
  },
  runRulesForActiveLifecycleGroup: () => {
    const state = get();
    const lifecycleGroupId = state.activeLifecycleGroupId;
    const rules = mergeDefaultRulesWithPersistedRules(state.rules);

    if (!lifecycleGroupId) {
      return { draftCount: 0, message: "请先选择一个产品周期分组，再运行产品周期规则。" };
    }

    const campaignGroups = state.campaignGroups.filter((group) => group.lifecycleGroupId === lifecycleGroupId);
    const runnableRowsByGroupId = new Map(
      campaignGroups.map((group) => [
        group.id,
        getRunnableRowsForCampaignGroup({
          performanceRows: state.performanceRows,
          activeBatchId: state.activeBatchId,
          mockBatchIds: dataBatches
            .filter((batch) => batch.campaignGroupId === group.id)
            .slice(-1)
            .map((batch) => batch.id),
          campaignGroupId: group.id,
        }),
      ]),
    );
    const runnableRowCount = Array.from(runnableRowsByGroupId.values()).reduce((total, rows) => total + rows.length, 0);
    const ruleCount = rules.filter((rule) => rule.enabled && rule.lifecycleGroupId === lifecycleGroupId).length;
    const overallMatchedRowCount = countMatchedOverallRowsForCampaignGroups(
      state.overallAdDataRows,
      campaignGroups.map((group) => group.id),
    );
    const drafts = campaignGroups.flatMap((campaignGroup) => {
      const rows = runnableRowsByGroupId.get(campaignGroup.id) ?? [];

      return runRuleEngine({
        campaignGroup,
        rows,
        overallAdDataRows: state.overallAdDataRows,
        rules,
      });
    });
    const runHistory = createRuleRunHistory({
      campaignGroups: state.campaignGroups,
      uploadedFileName: state.uploadedFileName,
      overallAdDataFileName: state.overallAdDataFileName,
      overallAdDataRows: state.overallAdDataRows,
      overallAdDataMatchSummary: state.overallAdDataMatchSummary,
      campaignGroupIds: campaignGroups.map((group) => group.id),
      drafts,
    });

    set((current) => ({
      rules,
      adjustmentDrafts: runHistory.adjustmentDrafts,
      pendingAdjustmentDrafts: replacePendingDraftsForCampaignGroups(
        current.pendingAdjustmentDrafts,
        campaignGroups.map((group) => group.id),
        runHistory.adjustmentDrafts,
      ),
      ruleRunHistoryRecords: [...runHistory.records, ...current.ruleRunHistoryRecords],
      selectedDraftIds: runHistory.adjustmentDrafts.map((draft) => draft.id),
    }));
    return {
      draftCount: drafts.length,
      message:
        drafts.length === 0
          ? buildNoDraftMessage({ groupCount: campaignGroups.length, runnableRowCount, ruleCount, overallMatchedRowCount })
          : undefined,
    };
  },
  runRulesForActiveWorkspaceUnit: () => {
    const state = get();
    const workspaceUnit = state.workspaceUnits.find((unit) => unit.id === state.activeWorkspaceUnitId);
    const rules = mergeDefaultRulesWithPersistedRules(state.rules);

    if (!workspaceUnit) {
      return { draftCount: 0, message: "请先选择组合工作单元，再运行组合单元规则。" };
    }

    const workspaceCampaignGroups = workspaceUnit.campaignGroupIds
      .map((id) => state.campaignGroups.find((group) => group.id === id))
      .filter((group): group is CampaignGroup => Boolean(group));
    const lifecycleIds = workspaceCampaignGroups.map((group) => group.lifecycleGroupId);

    if (
      workspaceCampaignGroups.length !== workspaceUnit.campaignGroupIds.length ||
      lifecycleIds.some((id) => !id) ||
      new Set(lifecycleIds).size !== 1
    ) {
      return {
        draftCount: 0,
        message: "组合内所有广告组必须选择相同的生命周期组，统一后才能运行规则。",
      };
    }

    let runnableRowCount = 0;
    let ruleCount = 0;
    const overallMatchedRowCount = countMatchedOverallRowsForCampaignGroups(
      state.overallAdDataRows,
      workspaceUnit.campaignGroupIds,
    );
    const drafts = workspaceUnit.campaignGroupIds.flatMap((campaignGroupId) => {
      const campaignGroup = state.campaignGroups.find((group) => group.id === campaignGroupId);

      if (!campaignGroup) {
        return [];
      }

      const rows = getRunnableRowsForCampaignGroup({
        performanceRows: state.performanceRows,
        activeBatchId: state.activeBatchId,
        mockBatchIds: dataBatches
          .filter((batch) => batch.campaignGroupId === campaignGroup.id)
          .slice(-1)
          .map((batch) => batch.id),
        campaignGroupId: campaignGroup.id,
      });
      runnableRowCount += rows.length;
      ruleCount += rules.filter((rule) => rule.enabled && rule.lifecycleGroupId === campaignGroup.lifecycleGroupId).length;

      return runRuleEngine({
        campaignGroup,
        rows,
        overallAdDataRows: state.overallAdDataRows.filter(
          (row) => !row.campaignGroupId || workspaceUnit.campaignGroupIds.includes(row.campaignGroupId),
        ),
        rules,
      });
    });
    const runHistory = createRuleRunHistory({
      campaignGroups: state.campaignGroups,
      uploadedFileName: state.uploadedFileName,
      overallAdDataFileName: state.overallAdDataFileName,
      overallAdDataRows: state.overallAdDataRows,
      overallAdDataMatchSummary: state.overallAdDataMatchSummary,
      campaignGroupIds: workspaceUnit.campaignGroupIds,
      drafts,
    });

    set((current) => ({
      rules,
      adjustmentDrafts: runHistory.adjustmentDrafts,
      pendingAdjustmentDrafts: replacePendingDraftsForCampaignGroups(
        current.pendingAdjustmentDrafts,
        workspaceUnit.campaignGroupIds,
        runHistory.adjustmentDrafts,
      ),
      ruleRunHistoryRecords: [...runHistory.records, ...current.ruleRunHistoryRecords],
      selectedDraftIds: runHistory.adjustmentDrafts.map((draft) => draft.id),
    }));
    return {
      draftCount: drafts.length,
      message:
        drafts.length === 0
          ? buildNoDraftMessage({ groupCount: workspaceUnit.campaignGroupIds.length, runnableRowCount, ruleCount, overallMatchedRowCount })
          : undefined,
    };
  },
  runRulesForMatchedOverallGroups: () => {
    const state = get();
    const rules = mergeDefaultRulesWithPersistedRules(state.rules);
    const matchedCampaignGroupIds = Array.from(
      new Set(
        state.overallAdDataRows.flatMap((row) =>
          row.matchStatus !== "unmatched" && row.campaignGroupId ? [row.campaignGroupId] : [],
        ),
      ),
    );
    const campaignGroups = matchedCampaignGroupIds
      .map((id) => state.campaignGroups.find((group) => group.id === id))
      .filter((group): group is CampaignGroup => Boolean(group?.lifecycleGroupId));

    if (matchedCampaignGroupIds.length === 0) {
      return { draftCount: 0, message: buildNoDraftMessage({ groupCount: 0, runnableRowCount: 0, ruleCount: rules.length }) };
    }

    if (campaignGroups.length === 0) {
      return { draftCount: 0, message: "Sellfox Overall 已匹配广告组，但这些广告组还没有分配生命周期，请先选择新品组、成熟组、衰退组或清库存组。" };
    }

    let runnableRowCount = 0;
    let ruleCount = 0;
    const overallMatchedRowCount = countMatchedOverallRowsForCampaignGroups(
      state.overallAdDataRows,
      campaignGroups.map((group) => group.id),
    );
    const overallRowsByCampaignGroupId = state.overallAdDataRows.reduce<Map<string, OverallAdDataRow[]>>((map, row) => {
      if (!row.campaignGroupId || row.matchStatus === "unmatched") {
        return map;
      }

      map.set(row.campaignGroupId, [...(map.get(row.campaignGroupId) ?? []), row]);
      return map;
    }, new Map());
    const drafts = campaignGroups.flatMap((campaignGroup) => {
      const rows = getRunnableRowsForCampaignGroup({
        performanceRows: state.performanceRows,
        activeBatchId: state.activeBatchId,
        mockBatchIds: dataBatches
          .filter((batch) => batch.campaignGroupId === campaignGroup.id)
          .slice(-1)
          .map((batch) => batch.id),
        campaignGroupId: campaignGroup.id,
      });

      runnableRowCount += rows.length;
      ruleCount += rules.filter((rule) => rule.enabled && rule.lifecycleGroupId === campaignGroup.lifecycleGroupId).length;

      return runRuleEngine({
        campaignGroup,
        rows,
        overallAdDataRows: overallRowsByCampaignGroupId.get(campaignGroup.id) ?? [],
        rules,
      });
    });
    const campaignGroupIds = campaignGroups.map((group) => group.id);
    const runHistory = createRuleRunHistory({
      campaignGroups: state.campaignGroups,
      uploadedFileName: state.uploadedFileName,
      overallAdDataFileName: state.overallAdDataFileName,
      overallAdDataRows: state.overallAdDataRows,
      overallAdDataMatchSummary: state.overallAdDataMatchSummary,
      campaignGroupIds,
      drafts,
    });

    set((current) => ({
      rules,
      adjustmentDrafts: runHistory.adjustmentDrafts,
      pendingAdjustmentDrafts: replacePendingDraftsForCampaignGroups(
        current.pendingAdjustmentDrafts,
        campaignGroupIds,
        runHistory.adjustmentDrafts,
      ),
      ruleRunHistoryRecords: [...runHistory.records, ...current.ruleRunHistoryRecords],
      selectedDraftIds: runHistory.adjustmentDrafts.map((draft) => draft.id),
    }));
    return {
      draftCount: drafts.length,
      message:
        drafts.length === 0
          ? buildNoDraftMessage({ groupCount: campaignGroups.length, runnableRowCount, ruleCount, overallMatchedRowCount })
          : undefined,
    };
  },
  toggleDraft: (draftId) =>
    set((state) => {
      const selectedDraftIds = state.selectedDraftIds.includes(draftId)
        ? state.selectedDraftIds.filter((id) => id !== draftId)
        : [...state.selectedDraftIds, draftId];

      return {
        selectedDraftIds,
        adjustmentDrafts: state.adjustmentDrafts.map((draft) => ({
          ...draft,
          selected: selectedDraftIds.includes(draft.id),
        })),
      };
    }),
  setDraftSelected: (draftId, selected) =>
    set((state) => {
      const selectedDraftIds = selected
        ? state.selectedDraftIds.includes(draftId)
          ? state.selectedDraftIds
          : [...state.selectedDraftIds, draftId]
        : state.selectedDraftIds.filter((id) => id !== draftId);

      return {
        selectedDraftIds,
        adjustmentDrafts: state.adjustmentDrafts.map((draft) => ({
          ...draft,
          selected: selectedDraftIds.includes(draft.id),
        })),
      };
    }),
  selectAllDrafts: () =>
    set((state) => ({
      selectedDraftIds: state.adjustmentDrafts.map((draft) => draft.id),
      adjustmentDrafts: state.adjustmentDrafts.map((draft) => ({ ...draft, selected: true })),
    })),
  invertDraftSelection: () =>
    set((state) => {
      const selectedDraftIds = state.adjustmentDrafts
        .filter((draft) => !state.selectedDraftIds.includes(draft.id))
        .map((draft) => draft.id);

      return {
        selectedDraftIds,
        adjustmentDrafts: state.adjustmentDrafts.map((draft) => ({
          ...draft,
          selected: selectedDraftIds.includes(draft.id),
        })),
      };
    }),
  clearDraftSelection: () =>
    set((state) => ({
      selectedDraftIds: [],
      adjustmentDrafts: state.adjustmentDrafts.map((draft) => ({ ...draft, selected: false })),
    })),
  removePendingDraftsForCampaignGroup: (campaignGroupId) =>
    set((state) => ({
      pendingAdjustmentDrafts: state.pendingAdjustmentDrafts.filter(
        (draft) => draft.campaignGroupId !== campaignGroupId,
      ),
    })),
  clearPendingAdjustmentDrafts: () => set({ pendingAdjustmentDrafts: [] }),
  setParseStarted: (fileName, originalWorkbookBuffer) => {
    const batchId = `batch-${Date.now()}`;
    set({
      campaignGroups: [],
      campaignSheetGroups: [],
      workspaceUnits: [],
      rules: defaultRules,
      performanceRows: [],
      activeCampaignGroupId: "",
      activeWorkspaceUnitId: undefined,
      activeLifecycleGroupId: undefined,
      workspaceMode: "campaign",
      openTabIds: [],
      adjustmentDrafts: [],
      pendingAdjustmentDrafts: [],
      selectedDraftIds: [],
      parseStatus: "parsing",
      parseProgress: 0,
      uploadedFileName: fileName,
      originalWorkbookBuffer,
      activeBatchId: batchId,
      parsedRowCount: 0,
      parsedSheets: [],
      parseError: undefined,
      parseDiagnostics: emptyDiagnostics,
      overallAdDataFileName: undefined,
      overallAdDataRows: [],
      overallAdDataStatus: "idle",
      overallAdDataError: undefined,
      overallAdDataMatchSummary: emptyOverallAdDataMatchSummary,
      overallAdDataUploads: [],
      workspaceDatasetId: undefined,
      sourceFileId: undefined,
      importJobId: undefined,
      sourceParserVersion: undefined,
      sourceDatasetCreatedAt: undefined,
      activeDraftRunId: undefined,
    });
  },
  applyWorkspaceDataset: (dataset, originalWorkbookBuffer) =>
    set((state) => {
      const activeCampaignGroupId = dataset.campaignGroups[0]?.id ?? "";
      const overallMatch = state.overallAdDataRows.length
        ? matchOverallAdDataRows(
            state.overallAdDataRows,
            state.overallAdDataRows[0]?.scopeCampaignGroupIds ?? dataset.campaignGroups.map((group) => group.id),
            dataset.performanceRows,
            state.overallAdDataFileName ?? "",
          )
        : undefined;

      return {
        campaignGroups: dataset.campaignGroups,
        campaignSheetGroups: buildSheetGroups(dataset.campaignGroups),
        workspaceUnits: [],
        performanceRows: dataset.performanceRows,
        activeCampaignGroupId,
        activeWorkspaceUnitId: undefined,
        activeLifecycleGroupId: undefined,
        workspaceMode: "campaign",
        openTabIds: dataset.campaignGroups.slice(0, 4).map((group) => group.id),
        adjustmentDrafts: [],
        pendingAdjustmentDrafts: [],
        selectedDraftIds: [],
        parseStatus: "completed" as const,
        parseProgress: 100,
        uploadedFileName: dataset.sourceFileName,
        originalWorkbookBuffer: originalWorkbookBuffer ?? state.originalWorkbookBuffer,
        activeBatchId: dataset.dataBatches[0]?.id,
        parsedRowCount: dataset.rowCount,
        parsedSheets: Array.from(new Set(dataset.campaignGroups.map((group) => group.sheetName).filter(Boolean))) as string[],
        parseError: dataset.campaignGroups.length ? undefined : "数据库数据集没有可用广告组。",
        parseDiagnostics: dataset.parseDiagnostics as ParseDiagnostics,
        overallAdDataRows: overallMatch?.rows ?? state.overallAdDataRows,
        overallAdDataMatchSummary: overallMatch?.summary ?? state.overallAdDataMatchSummary,
        workspaceDatasetId: dataset.id,
        sourceFileId: dataset.fileId,
        importJobId: dataset.jobId,
        sourceParserVersion: dataset.parserVersion,
        sourceDatasetCreatedAt: dataset.createdAt,
        activeDraftRunId: undefined,
      };
    }),
  setActiveDraftRunId: (draftRunId) => set({ activeDraftRunId: draftRunId }),
  setParseProgress: (progress, sheets) =>
    set((state) => ({
      parseStatus: "parsing",
      parseProgress: progress,
      parsedSheets: sheets?.length ? sheets : state.parsedSheets,
    })),
  ingestParsedRows: (sheetName, rows, startRowIndex) =>
    set((state) => {
      const batchId = state.activeBatchId ?? `batch-${Date.now()}`;
      const executableRows = rows
        .map((row, index) => toPerformanceRow(row, sheetName, batchId, startRowIndex + index + 2))
        .filter((row): row is PerformanceRow => Boolean(row));
      const performanceRows = [...state.performanceRows, ...executableRows];
      const campaignGroups = buildGroupsFromRows(state.campaignGroups, executableRows);
      const activeCampaignGroupId =
        state.activeCampaignGroupId && campaignGroups.some((group) => group.id === state.activeCampaignGroupId)
          ? state.activeCampaignGroupId
          : campaignGroups[0]?.id ?? "";

      return {
        performanceRows,
        campaignGroups,
        campaignSheetGroups: buildSheetGroups(campaignGroups),
        activeCampaignGroupId,
        parseDiagnostics: collectDiagnostics(sheetName, rows, state.parseDiagnostics),
        openTabIds: activeCampaignGroupId
          ? state.openTabIds.includes(activeCampaignGroupId)
            ? state.openTabIds
            : [activeCampaignGroupId, ...state.openTabIds].slice(0, 4)
          : [],
      };
    }),
  setParseCompleted: (rowCount, sheets) =>
    set((state) => {
      const overallMatch = state.overallAdDataRows.length
        ? matchOverallAdDataRows(
            state.overallAdDataRows,
            state.overallAdDataRows[0]?.scopeCampaignGroupIds ?? state.campaignGroups.map((group) => group.id),
            state.performanceRows,
            state.overallAdDataFileName ?? "",
          )
        : undefined;

      return {
        parseStatus: "completed",
        parseProgress: 100,
        parsedRowCount: rowCount,
        parsedSheets: sheets,
        parseError: state.campaignGroups.length ? undefined : buildParseFailureMessage(state.parseDiagnostics),
        campaignSheetGroups: buildSheetGroups(state.campaignGroups),
        overallAdDataRows: overallMatch?.rows ?? state.overallAdDataRows,
        overallAdDataMatchSummary: overallMatch?.summary ?? state.overallAdDataMatchSummary,
      };
    }),
  setParseFailed: (message) =>
    set({
      parseStatus: "failed",
      parseError: message,
    }),
  ingestOverallAdDataCsv: (fileName, text, scopeCampaignGroupIds) =>
    set((state) => {
      try {
        const result = buildOverallAdDataRows(fileName, text, scopeCampaignGroupIds, state.performanceRows);
        const hasFatalMismatch = result.summary.totalRows > 0 && result.summary.matchedRows === 0;
        const status: OverallAdDataStatus = hasFatalMismatch ? "failed" : "matched";
        const error = hasFatalMismatch ? "Overall 所有日期广告数据未匹配到任何 Bulk 行，请检查关键词和匹配类型是否完全一致。" : undefined;
        const upload: OverallAdDataUpload = {
          id: `overall-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          uploadedAt: new Date().toISOString(),
          fileName: result.fileName,
          scopeCampaignGroupIds: [...scopeCampaignGroupIds],
          rows: result.rows,
          status,
          error,
          matchSummary: result.summary,
        };

        return {
          overallAdDataFileName: result.fileName,
          overallAdDataRows: result.rows,
          overallAdDataStatus: status,
          overallAdDataError: error,
          overallAdDataMatchSummary: result.summary,
          overallAdDataUploads: upsertOverallAdDataUpload(state.overallAdDataUploads, upload),
          adjustmentDrafts: [],
          selectedDraftIds: [],
        };
      } catch (error) {
        return {
          overallAdDataFileName: fileName,
          overallAdDataRows: [],
          overallAdDataStatus: "failed",
          overallAdDataError: error instanceof Error ? error.message : "Overall 所有日期广告数据 CSV 解析失败。",
          overallAdDataMatchSummary: emptyOverallAdDataMatchSummary,
        };
      }
    }),
  ingestOverallAdDataCsvFiles: (files, scopeCampaignGroupIds) =>
    set((state) => {
      const fileName = files.length === 1 ? files[0]?.fileName ?? "" : `${files.length} 个 Overall 文件`;

      try {
        const result = buildOverallAdDataRowsFromFiles(files, scopeCampaignGroupIds, state.performanceRows);
        const hasFatalMismatch = result.summary.totalRows > 0 && result.summary.matchedRows === 0;
        const status: OverallAdDataStatus = hasFatalMismatch ? "failed" : "matched";
        const error = hasFatalMismatch ? "Overall 所有日期广告数据未匹配到任何 Bulk 行，请检查关键词和匹配类型是否完全一致。" : undefined;
        const upload: OverallAdDataUpload = {
          id: `overall-upload-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          uploadedAt: new Date().toISOString(),
          fileName: result.fileName,
          scopeCampaignGroupIds: [...scopeCampaignGroupIds],
          rows: result.rows,
          status,
          error,
          matchSummary: result.summary,
        };

        return {
          overallAdDataFileName: result.fileName,
          overallAdDataRows: result.rows,
          overallAdDataStatus: status,
          overallAdDataError: error,
          overallAdDataMatchSummary: result.summary,
          overallAdDataUploads: upsertOverallAdDataUpload(state.overallAdDataUploads, upload),
          adjustmentDrafts: [],
          selectedDraftIds: [],
        };
      } catch (error) {
        return {
          overallAdDataFileName: fileName,
          overallAdDataRows: [],
          overallAdDataStatus: "failed",
          overallAdDataError: error instanceof Error ? error.message : "Overall 所有日期广告数据 CSV 解析失败。",
          overallAdDataMatchSummary: emptyOverallAdDataMatchSummary,
        };
      }
    }),
  activateOverallAdDataForScope: (scopeCampaignGroupIds) => {
    const upload = findOverallAdDataUploadForScope(get().overallAdDataUploads, scopeCampaignGroupIds);

    if (!upload) {
      return false;
    }

    const scopeSet = new Set(scopeCampaignGroupIds);
    const scopedRows = upload.rows.filter((row) => row.campaignGroupId && scopeSet.has(row.campaignGroupId));

    set({
      overallAdDataFileName: upload.fileName,
      overallAdDataRows: scopedRows,
      overallAdDataStatus: upload.status,
      overallAdDataError: upload.error,
      overallAdDataMatchSummary: summarizeOverallRows(scopedRows, scopeCampaignGroupIds.length),
    });
    return true;
  },
  recordExportHistory: (fileName, drafts) =>
    set((state) => {
      const selectedDrafts = state.adjustmentDrafts.filter((draft) => state.selectedDraftIds.includes(draft.id));
      const sourceDrafts = drafts ?? (selectedDrafts.length ? selectedDrafts : state.adjustmentDrafts);
      const campaignGroupIds = Array.from(new Set(sourceDrafts.map((draft) => draft.campaignGroupId)));
      const exportedRunHistoryIds = new Set(
        sourceDrafts.flatMap((draft) => draft.runHistoryId ? [draft.runHistoryId] : []),
      );
      const exportedAt = new Date().toISOString();
      const records: ExportHistoryRecord[] = campaignGroupIds.map((campaignGroupId) => {
        const campaignGroup = state.campaignGroups.find((group) => group.id === campaignGroupId);
        const groupDrafts = sourceDrafts.filter((draft) => draft.campaignGroupId === campaignGroupId);
        const upload = state.overallAdDataUploads.find((item) => item.scopeCampaignGroupIds.includes(campaignGroupId));
        const lifecycleGroupId = campaignGroup?.lifecycleGroupId;
        const lifecycleGroupName =
          lifecycleGroupId === "launch"
            ? "新品组"
            : lifecycleGroupId === "mature"
              ? "成熟组"
              : lifecycleGroupId === "decline"
                ? "衰退组"
                : lifecycleGroupId === "clearance"
                  ? "清库存组"
                  : undefined;

        return {
          id: `export-${Date.now()}-${campaignGroupId}-${Math.random().toString(36).slice(2, 8)}`,
          exportedAt,
          fileName,
          bulkFileName: state.uploadedFileName,
          overallFileName: upload?.fileName ?? state.overallAdDataFileName,
          lifecycleGroupId,
          lifecycleGroupName,
          campaignGroupIds: [campaignGroupId],
          campaignGroupNames: [campaignGroup?.adGroupName ?? campaignGroupId],
          keywordNames: Array.from(new Set(groupDrafts.map((draft) => draft.keyword || draft.target).filter(Boolean))).slice(0, 80),
          overallAdDataRows: (upload?.rows ?? state.overallAdDataRows).filter((row) => row.campaignGroupId === campaignGroupId),
          overallAdDataMatchSummary: upload?.matchSummary ?? state.overallAdDataMatchSummary,
          adjustmentDrafts: groupDrafts,
          selectedDraftIds: groupDrafts.map((draft) => draft.id),
          draftRunId: state.activeDraftRunId,
          datasetId: state.workspaceDatasetId,
          fileId: state.sourceFileId,
          jobId: state.importJobId,
        };
      });
      const exportedGroupIds = new Set(campaignGroupIds);

      return {
        exportHistoryRecords: [...records, ...state.exportHistoryRecords].slice(0, 100),
        ruleRunHistoryRecords: state.ruleRunHistoryRecords.map((runRecord) =>
          exportedRunHistoryIds.has(runRecord.id)
            ? { ...runRecord, exportedAt, exportFileName: fileName }
            : runRecord,
        ),
        overallAdDataUploads: state.overallAdDataUploads.filter(
          (upload) => !upload.scopeCampaignGroupIds.some((id) => exportedGroupIds.has(id)),
        ),
        overallAdDataFileName: undefined,
        overallAdDataRows: [],
        overallAdDataStatus: "idle",
        overallAdDataError: undefined,
        overallAdDataMatchSummary: emptyOverallAdDataMatchSummary,
      };
    }),
  reuseExportHistory: (recordId) =>
    set((state) => {
      const record = state.exportHistoryRecords.find((item) => item.id === recordId);

      if (!record) {
        return {};
      }

      return {
        overallAdDataFileName: record.overallFileName,
        overallAdDataRows: record.overallAdDataRows,
        overallAdDataStatus: record.overallAdDataRows.length ? "matched" : "idle",
        overallAdDataError: undefined,
        overallAdDataMatchSummary: record.overallAdDataMatchSummary,
        adjustmentDrafts: record.adjustmentDrafts,
        selectedDraftIds: record.selectedDraftIds,
        activeLifecycleGroupId: record.lifecycleGroupId ?? state.activeLifecycleGroupId,
        activeCampaignGroupId: record.campaignGroupIds[0] ?? state.activeCampaignGroupId,
        workspaceMode: record.lifecycleGroupId ? "lifecycle" : state.workspaceMode,
      };
    }),
  reuseRuleRunHistory: (recordId) =>
    set((state) => {
      const record = state.ruleRunHistoryRecords.find((item) => item.id === recordId);

      if (!record) {
        return {};
      }

      return {
        overallAdDataFileName: record.overallFileName,
        overallAdDataRows: record.overallAdDataRows,
        overallAdDataStatus: record.overallAdDataRows.length ? "matched" : "idle",
        overallAdDataError: undefined,
        overallAdDataMatchSummary: record.overallAdDataMatchSummary,
        adjustmentDrafts: record.adjustmentDrafts,
        pendingAdjustmentDrafts: replacePendingDraftsForCampaignGroups(
          state.pendingAdjustmentDrafts,
          record.campaignGroupIds,
          record.adjustmentDrafts,
        ),
        selectedDraftIds: record.adjustmentDrafts.map((draft) => draft.id),
        activeCampaignGroupId: record.campaignGroupIds[0] ?? state.activeCampaignGroupId,
        activeLifecycleGroupId: undefined,
        activeWorkspaceUnitId: undefined,
        workspaceMode: "campaign",
      };
    }),
  hydratePersistedWorkspace: async () => {
    try {
      const persisted = await readWorkspaceSnapshot<LegacyWorkspaceSnapshot>();

      if (!persisted?.snapshot) {
        set({ persistenceStatus: "ready", persistenceError: undefined });
        return;
      }

      const snapshot = migrateWorkspaceSnapshot(persisted.snapshot, emptyOverallAdDataMatchSummary);
      const overallMatch = snapshot.overallAdDataRows.length
        ? matchOverallAdDataRows(
            snapshot.overallAdDataRows,
            snapshot.overallAdDataRows[0]?.scopeCampaignGroupIds ?? snapshot.campaignGroups.map((group) => group.id),
            snapshot.performanceRows,
            snapshot.overallAdDataFileName ?? "",
          )
        : undefined;

      set({
        ...snapshot,
        parseStatus: snapshot.parseStatus === "parsing" ? "completed" : snapshot.parseStatus,
        parseProgress: snapshot.parseStatus === "parsing" ? 100 : snapshot.parseProgress,
        campaignSheetGroups: buildSheetGroups(snapshot.campaignGroups),
        overallAdDataRows: overallMatch?.rows ?? snapshot.overallAdDataRows,
        overallAdDataMatchSummary: overallMatch?.summary ?? snapshot.overallAdDataMatchSummary,
        persistenceStatus: "ready",
        persistenceError: undefined,
      });
    } catch (error) {
      set({
        persistenceStatus: "failed",
        persistenceError: error instanceof Error ? error.message : "恢复本地工作区失败。",
      });
    }
  },
  clearPersistedWorkspace: async () => {
    try {
      const exportHistoryRecords = get().exportHistoryRecords;
      const ruleRunHistoryRecords = get().ruleRunHistoryRecords;
      const blockedCampaignIdentities = get().blockedCampaignIdentities;

      await deleteWorkspaceSnapshot();
      set({
        campaignGroups,
        campaignSheetGroups: buildSheetGroups(campaignGroups),
        workspaceUnits: [],
        rules: defaultRules,
        performanceRows: mockPerformanceRows,
        activeCampaignGroupId: initialActiveId,
        activeWorkspaceUnitId: undefined,
        activeLifecycleGroupId: undefined,
        workspaceMode: "campaign",
        openTabIds: campaignGroups.slice(0, 4).map((group) => group.id),
        selectedDraftIds: [],
        parseStatus: "idle",
        parseProgress: 0,
        uploadedFileName: undefined,
        originalWorkbookBuffer: undefined,
        activeBatchId: undefined,
        parsedRowCount: 0,
        parsedSheets: [],
        parseError: undefined,
        parseDiagnostics: emptyDiagnostics,
        overallAdDataFileName: undefined,
        overallAdDataRows: [],
        overallAdDataStatus: "idle",
        overallAdDataError: undefined,
        overallAdDataMatchSummary: emptyOverallAdDataMatchSummary,
        overallAdDataUploads: [],
        adjustmentDrafts: [],
        pendingAdjustmentDrafts: [],
        exportHistoryRecords,
        ruleRunHistoryRecords,
        blockedCampaignIdentities,
        workspaceDatasetId: undefined,
        sourceFileId: undefined,
        importJobId: undefined,
        sourceParserVersion: undefined,
        sourceDatasetCreatedAt: undefined,
        activeDraftRunId: undefined,
        persistenceStatus: "ready",
        persistenceError: undefined,
      });
    } catch (error) {
      set({
        persistenceStatus: "failed",
        persistenceError: error instanceof Error ? error.message : "清空本地工作区失败。",
      });
    }
  },
}));

let saveTimer: ReturnType<typeof setTimeout> | undefined;
let hydrated = false;

if (typeof window !== "undefined") {
  useWorkspaceStore.getState().hydratePersistedWorkspace().finally(() => {
    hydrated = true;
  });

  useWorkspaceStore.subscribe((state, previousState) => {
    if (!hydrated || state.persistenceStatus === "loading") {
      return;
    }

    const shouldSave =
      state.campaignGroups !== previousState.campaignGroups ||
      state.rules !== previousState.rules ||
      state.workspaceUnits !== previousState.workspaceUnits ||
      state.performanceRows !== previousState.performanceRows ||
      state.activeCampaignGroupId !== previousState.activeCampaignGroupId ||
      state.activeLifecycleGroupId !== previousState.activeLifecycleGroupId ||
      state.workspaceMode !== previousState.workspaceMode ||
      state.openTabIds !== previousState.openTabIds ||
      state.selectedDraftIds !== previousState.selectedDraftIds ||
      state.parseStatus !== previousState.parseStatus ||
      state.parseProgress !== previousState.parseProgress ||
      state.uploadedFileName !== previousState.uploadedFileName ||
      state.originalWorkbookBuffer !== previousState.originalWorkbookBuffer ||
      state.activeBatchId !== previousState.activeBatchId ||
      state.parsedRowCount !== previousState.parsedRowCount ||
      state.parsedSheets !== previousState.parsedSheets ||
      state.parseError !== previousState.parseError ||
      state.parseDiagnostics !== previousState.parseDiagnostics ||
      state.overallAdDataFileName !== previousState.overallAdDataFileName ||
      state.overallAdDataRows !== previousState.overallAdDataRows ||
      state.overallAdDataStatus !== previousState.overallAdDataStatus ||
      state.overallAdDataError !== previousState.overallAdDataError ||
      state.overallAdDataMatchSummary !== previousState.overallAdDataMatchSummary ||
      state.overallAdDataUploads !== previousState.overallAdDataUploads ||
      state.adjustmentDrafts !== previousState.adjustmentDrafts ||
      state.pendingAdjustmentDrafts !== previousState.pendingAdjustmentDrafts ||
      state.exportHistoryRecords !== previousState.exportHistoryRecords ||
      state.ruleRunHistoryRecords !== previousState.ruleRunHistoryRecords ||
      state.blockedCampaignIdentities !== previousState.blockedCampaignIdentities ||
      state.workspaceDatasetId !== previousState.workspaceDatasetId ||
      state.sourceFileId !== previousState.sourceFileId ||
      state.importJobId !== previousState.importJobId ||
      state.sourceParserVersion !== previousState.sourceParserVersion ||
      state.sourceDatasetCreatedAt !== previousState.sourceDatasetCreatedAt ||
      state.activeDraftRunId !== previousState.activeDraftRunId;

    if (!shouldSave) {
      return;
    }

    if (saveTimer) {
      clearTimeout(saveTimer);
    }

    saveTimer = setTimeout(() => {
      useWorkspaceStore.setState({ persistenceStatus: "saving", persistenceError: undefined });
      writeWorkspaceSnapshot(takeWorkspaceSnapshot(useWorkspaceStore.getState()))
        .then(() => {
          useWorkspaceStore.setState({ persistenceStatus: "saved", persistenceError: undefined });
        })
        .catch((error) => {
          useWorkspaceStore.setState({
            persistenceStatus: "failed",
            persistenceError: error instanceof Error ? error.message : "自动保存失败。",
          });
        });
    }, 500);
  });
}
