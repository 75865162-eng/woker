"use client";

import { create } from "zustand";
import { campaignGroups, dataBatches, defaultRules, performanceRows as mockPerformanceRows } from "@/data/mock-data";
import {
  runBulkOptimizationForCampaignGroup,
  runBulkOptimizationForLifecycleGroup,
  runBulkOptimizationForWorkspaceUnit,
} from "@/lib/bulk/optimization";
import {
  buildOverallAdDataRows,
  matchOverallAdDataRows,
  normalizeHeader,
  normalizeMatchValue,
  parseCsv,
  type SheetRow,
} from "@/lib/bulk/overall-data";
import {
  buildGroupsFromRows,
  buildParseFailureMessage,
  buildSheetGroups,
  buildWorkspaceUnitName,
  collectDiagnostics,
  toPerformanceRow,
  type ParseDiagnostics,
} from "@/lib/bulk/workspace-builders";
import {
  deleteWorkspaceSnapshot,
  readWorkspaceSnapshot,
  writeWorkspaceSnapshot,
} from "@/lib/repositories/workspace-repository";
import type {
  AdjustmentDraft,
  CampaignGroup,
  CampaignSheetGroup,
  ConditionGroup,
  LifecycleGroupId,
  ParseJobStatus,
  PerformanceRow,
  OverallAdDataMatchSummary,
  OverallAdDataRow,
  OverallAdDataStatus,
  Rule,
  WorkspaceUnit,
} from "@/lib/types";
type LegacyWorkspaceSnapshot = WorkspaceSnapshot &
  Partial<{
    recentAdDataFileName: string;
    recentAdDataRows: OverallAdDataRow[];
    recentAdDataStatus: OverallAdDataStatus;
    recentAdDataError: string;
    recentAdDataMatchSummary: OverallAdDataMatchSummary;
  }>;

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
  adjustmentDrafts: AdjustmentDraft[];
  pendingAdjustmentDrafts: AdjustmentDraft[];
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
  importGroupingStatusCsv: (fileName: string, text: string) => { importedRows: number; workspaceUnitCount: number };
  runRulesForActiveGroup: () => void;
  runRulesForActiveLifecycleGroup: () => void;
  runRulesForActiveWorkspaceUnit: () => void;
  toggleDraft: (draftId: string) => void;
  setDraftSelected: (draftId: string, selected: boolean) => void;
  selectAllDrafts: () => void;
  invertDraftSelection: () => void;
  clearDraftSelection: () => void;
  removePendingDraftsForCampaignGroup: (campaignGroupId: string) => void;
  clearPendingAdjustmentDrafts: () => void;
  recordExportHistory: (fileName: string, drafts?: AdjustmentDraft[]) => void;
  setParseStarted: (fileName: string, originalWorkbookBuffer: ArrayBuffer) => void;
  setParseProgress: (progress: number, sheets?: string[]) => void;
  ingestParsedRows: (sheetName: string, rows: SheetRow[], startRowIndex: number) => void;
  setParseCompleted: (rowCount: number, sheets: string[]) => void;
  setParseFailed: (message: string) => void;
  ingestOverallAdDataCsv: (fileName: string, text: string, scopeCampaignGroupIds: string[]) => void;
  hydratePersistedWorkspace: () => Promise<void>;
  clearPersistedWorkspace: () => Promise<void>;
}

type WorkspaceSnapshot = Pick<
  WorkspaceState,
  | "rules"
  | "campaignGroups"
  | "campaignSheetGroups"
  | "workspaceUnits"
  | "performanceRows"
  | "activeCampaignGroupId"
  | "activeWorkspaceUnitId"
  | "activeLifecycleGroupId"
  | "workspaceMode"
  | "openTabIds"
  | "selectedDraftIds"
  | "parseStatus"
  | "parseProgress"
  | "uploadedFileName"
  | "originalWorkbookBuffer"
  | "activeBatchId"
  | "parsedRowCount"
  | "parsedSheets"
  | "parseError"
  | "parseDiagnostics"
  | "overallAdDataFileName"
  | "overallAdDataRows"
  | "overallAdDataStatus"
  | "overallAdDataError"
  | "overallAdDataMatchSummary"
  | "adjustmentDrafts"
  | "pendingAdjustmentDrafts"
>;

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

function takeWorkspaceSnapshot(state: WorkspaceState): WorkspaceSnapshot {
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
    originalWorkbookBuffer: state.originalWorkbookBuffer,
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
    adjustmentDrafts: state.adjustmentDrafts,
    pendingAdjustmentDrafts: state.pendingAdjustmentDrafts,
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

function mergeDefaultRulesWithPersistedRules(rules: Rule[]) {
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

function migrateWorkspaceSnapshot(snapshot: LegacyWorkspaceSnapshot): WorkspaceSnapshot {
  return {
    ...snapshot,
    rules: mergeDefaultRulesWithPersistedRules(snapshot.rules ?? defaultRules),
    overallAdDataFileName: snapshot.overallAdDataFileName ?? snapshot.recentAdDataFileName,
    overallAdDataRows: snapshot.overallAdDataRows ?? snapshot.recentAdDataRows ?? [],
    overallAdDataStatus: snapshot.overallAdDataStatus ?? snapshot.recentAdDataStatus ?? "idle",
    overallAdDataError: snapshot.overallAdDataError ?? snapshot.recentAdDataError,
    overallAdDataMatchSummary:
      snapshot.overallAdDataMatchSummary ?? snapshot.recentAdDataMatchSummary ?? emptyOverallAdDataMatchSummary,
    pendingAdjustmentDrafts: snapshot.pendingAdjustmentDrafts ?? [],
  };
}

function readLooseColumn(row: SheetRow, candidates: string[]) {
  const entries = Object.entries(row).filter(([key]) => !key.startsWith("__"));
  const normalizedEntries = entries.map(([key, value]) => [normalizeHeader(key), value] as const);

  for (const candidate of candidates.map(normalizeHeader)) {
    const entry = normalizedEntries.find(([key]) => key === candidate);

    if (entry) {
      const value = entry[1];
      return value === null || value === undefined ? "" : String(value).trim();
    }
  }

  return "";
}

function createWorkspaceUnitId() {
  return `workspace-unit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function upsertWorkspaceUnitForCampaign(
  workspaceUnits: WorkspaceUnit[],
  campaignGroups: CampaignGroup[],
  campaignGroupId: string,
  workspaceUnitId: string,
) {
  const groupIds = new Set<string>();

  return workspaceUnits.map((unit) => {
    if (unit.id === workspaceUnitId) {
      unit.campaignGroupIds.forEach((id) => groupIds.add(id));
      groupIds.add(campaignGroupId);
      const nextCampaignGroupIds = Array.from(groupIds);
      const nextGroups = campaignGroups.filter((group) => nextCampaignGroupIds.includes(group.id));

      return {
        ...unit,
        campaignGroupIds: nextCampaignGroupIds,
        name: buildWorkspaceUnitName(nextGroups),
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      ...unit,
      campaignGroupIds: unit.campaignGroupIds.filter((id) => id !== campaignGroupId),
    };
  }).filter((unit) => unit.campaignGroupIds.length > 0);
}

function detachCampaignGroupFromWorkspaceUnits(workspaceUnits: WorkspaceUnit[], campaignGroupId: string) {
  return workspaceUnits
    .map((unit) => {
      const nextCampaignGroupIds = unit.campaignGroupIds.filter((id) => id !== campaignGroupId);

      return {
        ...unit,
        campaignGroupIds: nextCampaignGroupIds,
      };
    })
    .filter((unit) => unit.campaignGroupIds.length > 0);
}

function rebuildWorkspaceUnits(workspaceUnits: WorkspaceUnit[], campaignGroups: CampaignGroup[]) {
  return workspaceUnits
    .map((unit) => {
      const groups = campaignGroups.filter((group) => unit.campaignGroupIds.includes(group.id));

      return {
        ...unit,
        name: buildWorkspaceUnitName(groups),
        updatedAt: new Date().toISOString(),
      };
    })
    .filter((unit) => unit.campaignGroupIds.length > 1);
}

function isLifecycleGroupId(value: string): value is LifecycleGroupId {
  return ["launch", "mature", "decline", "clearance"].includes(value);
}

function buildCampaignGroupLookup(groups: CampaignGroup[]) {
  return groups.reduce<Map<string, string>>((lookup, group) => {
    [
      group.id,
      group.adGroupName,
      `${group.sheetName ?? ""}::${group.adGroupName}`,
      `${group.campaignName}::${group.adGroupName}`,
    ].forEach((value) => {
      const normalized = normalizeMatchValue(value);

      if (normalized) {
        lookup.set(normalized, group.id);
      }
    });

    return lookup;
  }, new Map());
}

function buildWorkspaceUnitsFromGroupingRows(rows: SheetRow[], groups: CampaignGroup[]) {
  const groupLookup = buildCampaignGroupLookup(groups);
  const unitRows = new Map<string, string[]>();
  const lifecycleByCampaignGroupId = new Map<string, LifecycleGroupId | undefined>();
  let importedRows = 0;

  rows.forEach((row) => {
    const campaignGroupKey =
      readLooseColumn(row, ["campaignGroupId", "campaign_group_id", "id"]) ||
      readLooseColumn(row, ["adGroupName", "ad_group_name", "Ad Group Name"]) ||
      readLooseColumn(row, ["campaignName", "campaign_name", "Campaign Name"]);
    const campaignGroupId = groupLookup.get(normalizeMatchValue(campaignGroupKey));

    if (!campaignGroupId) {
      return;
    }

    importedRows += 1;

    const rawLifecycle = readLooseColumn(row, ["lifecycleGroup", "lifecycleGroupId", "lifecycle", "产品周期分组"]).toLowerCase();
    lifecycleByCampaignGroupId.set(campaignGroupId, isLifecycleGroupId(rawLifecycle) ? rawLifecycle : undefined);

    const workspaceUnitName = readLooseColumn(row, ["workspaceUnit", "workspaceUnitId", "workspace", "分组"]);

    if (!workspaceUnitName) {
      return;
    }

    const workspaceUnitKey = normalizeMatchValue(workspaceUnitName);
    const currentIds = unitRows.get(workspaceUnitKey) ?? [];
    unitRows.set(workspaceUnitKey, Array.from(new Set([...currentIds, campaignGroupId])));
  });

  const now = new Date().toISOString();
  const workspaceUnits = Array.from(unitRows.entries()).flatMap(([key, campaignGroupIds], index): WorkspaceUnit[] => {
    const validIds = campaignGroupIds.filter((id) => groups.some((group) => group.id === id));

    if (validIds.length < 2) {
      return [];
    }

    const unitGroups = groups.filter((group) => validIds.includes(group.id));

    return [
      {
        id: `imported-workspace-unit-${index + 1}-${key.replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").slice(0, 32)}`,
        name: buildWorkspaceUnitName(unitGroups),
        campaignGroupIds: validIds,
        createdAt: now,
        updatedAt: now,
      },
    ];
  });

  return { importedRows, lifecycleByCampaignGroupId, workspaceUnits };
}

function findWorkspaceUnitByCampaignGroupId(workspaceUnits: WorkspaceUnit[], campaignGroupId: string) {
  return workspaceUnits.find((unit) => unit.campaignGroupIds.includes(campaignGroupId));
}

function replacePendingDraftsForCampaignGroups(
  pendingDrafts: AdjustmentDraft[],
  campaignGroupIds: string[],
  drafts: AdjustmentDraft[],
) {
  const groupIdSet = new Set(campaignGroupIds);

  return [
    ...pendingDrafts.filter((draft) => !groupIdSet.has(draft.campaignGroupId)),
    ...drafts,
  ];
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
  adjustmentDrafts: [],
  pendingAdjustmentDrafts: [],
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
      return;
    }

    const drafts = runBulkOptimizationForCampaignGroup({
      campaignGroup,
      rows: state.performanceRows,
      dataBatches,
      activeBatchId: state.activeBatchId,
      overallAdDataRows: state.overallAdDataRows,
      rules,
    });

    set((current) => ({
      rules,
      adjustmentDrafts: drafts,
      pendingAdjustmentDrafts: replacePendingDraftsForCampaignGroups(
        current.pendingAdjustmentDrafts,
        [campaignGroup.id],
        drafts,
      ),
      selectedDraftIds: drafts.filter((draft) => draft.selected).map((draft) => draft.id),
    }));
  },
  runRulesForActiveLifecycleGroup: () => {
    const state = get();
    const lifecycleGroupId = state.activeLifecycleGroupId;
    const rules = mergeDefaultRulesWithPersistedRules(state.rules);

    if (!lifecycleGroupId) {
      return;
    }

    const drafts = runBulkOptimizationForLifecycleGroup({
      lifecycleGroupId,
      campaignGroups: state.campaignGroups,
      rows: state.performanceRows,
      dataBatches,
      activeBatchId: state.activeBatchId,
      overallAdDataRows: state.overallAdDataRows,
      rules,
    });

    const lifecycleCampaignGroupIds = state.campaignGroups
      .filter((group) => group.lifecycleGroupId === lifecycleGroupId)
      .map((group) => group.id);

    set((current) => ({
      rules,
      adjustmentDrafts: drafts,
      pendingAdjustmentDrafts: replacePendingDraftsForCampaignGroups(
        current.pendingAdjustmentDrafts,
        lifecycleCampaignGroupIds,
        drafts,
      ),
      selectedDraftIds: drafts.filter((draft) => draft.selected).map((draft) => draft.id),
    }));
  },
  runRulesForActiveWorkspaceUnit: () => {
    const state = get();
    const workspaceUnit = state.workspaceUnits.find((unit) => unit.id === state.activeWorkspaceUnitId);
    const rules = mergeDefaultRulesWithPersistedRules(state.rules);

    if (!workspaceUnit) {
      return;
    }

    const drafts = runBulkOptimizationForWorkspaceUnit({
      workspaceUnit,
      campaignGroups: state.campaignGroups,
      rows: state.performanceRows,
      dataBatches,
      activeBatchId: state.activeBatchId,
      overallAdDataRows: state.overallAdDataRows,
      rules,
    });

    set((current) => ({
      rules,
      adjustmentDrafts: drafts,
      pendingAdjustmentDrafts: replacePendingDraftsForCampaignGroups(
        current.pendingAdjustmentDrafts,
        workspaceUnit.campaignGroupIds,
        drafts,
      ),
      selectedDraftIds: drafts.filter((draft) => draft.selected).map((draft) => draft.id),
    }));
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
  recordExportHistory: (_fileName, drafts) =>
    set((state) => {
      const exportedDrafts = drafts ?? state.pendingAdjustmentDrafts;
      const exportedDraftIds = new Set(exportedDrafts.map((draft) => draft.id));

      return {
        pendingAdjustmentDrafts: state.pendingAdjustmentDrafts.filter(
          (draft) => !exportedDraftIds.has(draft.id),
        ),
      };
    }),
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
    });
  },
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
        ? matchOverallAdDataRows({
            rows: state.overallAdDataRows,
            scopeCampaignGroupIds: state.overallAdDataRows[0]?.scopeCampaignGroupIds ?? state.campaignGroups.map((group) => group.id),
            performanceRows: state.performanceRows,
            fileName: state.overallAdDataFileName ?? "",
          })
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
        const result = buildOverallAdDataRows({
          fileName,
          text,
          scopeCampaignGroupIds,
          performanceRows: state.performanceRows,
        });
        const hasFatalMismatch = result.summary.totalRows > 0 && result.summary.matchedRows === 0;

        return {
          overallAdDataFileName: result.fileName,
          overallAdDataRows: result.rows,
          overallAdDataStatus: hasFatalMismatch ? "failed" : "matched",
          overallAdDataError: hasFatalMismatch ? "Overall 所有日期广告数据未匹配到任何 Bulk 行，请检查关键词和匹配类型是否完全一致。" : undefined,
        overallAdDataMatchSummary: result.summary,
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
  hydratePersistedWorkspace: async () => {
    try {
      const persisted = await readWorkspaceSnapshot<LegacyWorkspaceSnapshot>();

      if (!persisted?.snapshot) {
        set({ persistenceStatus: "ready", persistenceError: undefined });
        return;
      }

      const snapshot = migrateWorkspaceSnapshot(persisted.snapshot);

      set({
        ...snapshot,
        parseStatus: snapshot.parseStatus === "parsing" ? "completed" : snapshot.parseStatus,
        parseProgress: snapshot.parseStatus === "parsing" ? 100 : snapshot.parseProgress,
        campaignSheetGroups: buildSheetGroups(snapshot.campaignGroups),
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
        adjustmentDrafts: [],
        pendingAdjustmentDrafts: [],
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
      state.adjustmentDrafts !== previousState.adjustmentDrafts ||
      state.pendingAdjustmentDrafts !== previousState.pendingAdjustmentDrafts;

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
