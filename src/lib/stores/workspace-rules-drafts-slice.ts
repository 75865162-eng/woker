"use client";

import { defaultRules } from "@/data/default-rules";
import { runRuleEngine } from "@/lib/rule-engine/engine";
import { buildNoDraftMessage, createRuleRunHistory, getRunnableRowsForCampaignGroup, replacePendingDraftsForCampaignGroups } from "@/lib/workspace/workspace-drafts";
import { mergeDefaultRulesWithPersistedRules } from "@/lib/workspace/workspace-snapshot";
import type { CampaignGroup, ExportHistoryRecord, OverallAdDataRow } from "@/lib/types";
import { persistExportedRuleRunRecords, emptyOverallAdDataMatchSummary, countMatchedOverallRowsForCampaignGroups, persistRuleRunHistoryRecords } from "./workspace-store-defaults";
import type { WorkspaceSlice } from "./workspace-state";
export const createRulesDraftsSlice: WorkspaceSlice<"rules" | "selectedDraftIds" | "adjustmentDrafts" | "pendingAdjustmentDrafts" | "exportHistoryRecords" | "ruleRunHistoryRecords" | "setRules" | "upsertRule" | "deleteRule" | "runRulesForActiveGroup" | "runRulesForActiveLifecycleGroup" | "runRulesForActiveWorkspaceUnit" | "runRulesForMatchedOverallGroups" | "toggleDraft" | "setDraftSelected" | "selectAllDrafts" | "invertDraftSelection" | "clearDraftSelection" | "queueApprovedAgentDrafts" | "removePendingDraftsForCampaignGroup" | "clearPendingAdjustmentDrafts" | "recordExportHistory" | "reuseExportHistory" | "reuseRuleRunHistory"> = (set, get) => ({
rules: defaultRules,
selectedDraftIds: [],
adjustmentDrafts: [],
pendingAdjustmentDrafts: [],
exportHistoryRecords: [],
ruleRunHistoryRecords: [],
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
          mockBatchIds: [],
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
    persistRuleRunHistoryRecords(runHistory.records, rules);
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
          mockBatchIds: [],
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
    persistRuleRunHistoryRecords(runHistory.records, rules);
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
        mockBatchIds: [],
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
    persistRuleRunHistoryRecords(runHistory.records, rules);
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
        mockBatchIds: [],
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
    persistRuleRunHistoryRecords(runHistory.records, rules);
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
queueApprovedAgentDrafts: (drafts) => {
    const sanitizedDrafts = drafts
      .filter((draft) => draft.campaignGroupId && draft.rowId)
      .map((draft) => ({
        ...draft,
        selected: true,
        matchedRule: draft.matchedRule || "PPC Agent",
      }));
    const campaignGroupIds = Array.from(new Set(sanitizedDrafts.map((draft) => draft.campaignGroupId)));

    if (!sanitizedDrafts.length) {
      return { draftCount: 0, campaignGroupCount: 0 };
    }

    set((state) => ({
      pendingAdjustmentDrafts: replacePendingDraftsForCampaignGroups(
        state.pendingAdjustmentDrafts,
        campaignGroupIds,
        sanitizedDrafts,
      ),
    }));

    return {
      draftCount: sanitizedDrafts.length,
      campaignGroupCount: campaignGroupIds.length,
    };
  },
removePendingDraftsForCampaignGroup: (campaignGroupId) =>
    set((state) => ({
      pendingAdjustmentDrafts: state.pendingAdjustmentDrafts.filter(
        (draft) => draft.campaignGroupId !== campaignGroupId,
      ),
    })),
clearPendingAdjustmentDrafts: () => set({ pendingAdjustmentDrafts: [] }),
recordExportHistory: (fileName, drafts) =>
    set((state) => {
      const selectedDrafts = state.adjustmentDrafts.filter((draft) => state.selectedDraftIds.includes(draft.id));
      const sourceDrafts = drafts ?? (selectedDrafts.length ? selectedDrafts : state.adjustmentDrafts);
      const campaignGroupIds = Array.from(new Set(sourceDrafts.map((draft) => draft.campaignGroupId)));
      const exportedRunHistoryIds = new Set(
        sourceDrafts.flatMap((draft) => draft.runHistoryId ? [draft.runHistoryId] : []),
      );
      const exportedAt = new Date().toISOString();
      const selectedDraftIdsByRecordId = sourceDrafts.reduce<Map<string, string[]>>((map, draft) => {
        if (!draft.runHistoryId) {
          return map;
        }

        map.set(draft.runHistoryId, [...(map.get(draft.runHistoryId) ?? []), draft.id]);
        return map;
      }, new Map());
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
        };
      });
      const exportedGroupIds = new Set(campaignGroupIds);
      persistExportedRuleRunRecords({
        records: state.ruleRunHistoryRecords.filter((runRecord) => exportedRunHistoryIds.has(runRecord.id)),
        rules: state.rules,
        fileName,
        exportedAt,
        selectedDraftIdsByRecordId,
      });

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
    })
});
