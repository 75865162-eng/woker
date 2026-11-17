"use client";

import { defaultRules } from "@/data/default-rules";
import { deleteWorkspaceSnapshot, readWorkspaceDraftRunHistory, readWorkspaceSnapshot } from "@/lib/repositories/workspace-repository";
import { buildSheetGroups, matchOverallAdDataRows } from "@/lib/workspace/workspace-import";
import { migrateWorkspaceSnapshot, type LegacyWorkspaceSnapshot } from "@/lib/workspace/workspace-snapshot";
import { initialCampaignGroups, initialPerformanceRows, initialActiveId, emptyDiagnostics, emptyOverallAdDataMatchSummary } from "./workspace-store-defaults";
import type { WorkspaceSlice } from "./workspace-state";
export const createPersistenceSlice: WorkspaceSlice<"persistenceStatus" | "persistenceError" | "hydratePersistedWorkspace" | "clearPersistedWorkspace"> = (set, get) => {
let hydrationRevision = 0;
return {
persistenceStatus: "loading",
persistenceError: undefined,
hydratePersistedWorkspace: async (signal) => {
    const revision = ++hydrationRevision;
    try {
      const [persisted, draftRunHistory] = await Promise.all([
        readWorkspaceSnapshot<LegacyWorkspaceSnapshot>(),
        readWorkspaceDraftRunHistory(),
      ]);
      if (signal?.aborted || revision !== hydrationRevision) return;

      if (!persisted?.snapshot) {
        set({
          exportHistoryRecords: draftRunHistory.exportHistoryRecords,
          ruleRunHistoryRecords: draftRunHistory.ruleRunHistoryRecords,
          persistenceStatus: "ready",
          persistenceError: undefined,
        });
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
        exportHistoryRecords: draftRunHistory.exportHistoryRecords.length
          ? draftRunHistory.exportHistoryRecords
          : snapshot.exportHistoryRecords,
        ruleRunHistoryRecords: draftRunHistory.ruleRunHistoryRecords.length
          ? draftRunHistory.ruleRunHistoryRecords
          : snapshot.ruleRunHistoryRecords,
        persistenceStatus: "ready",
        persistenceError: undefined,
      });
    } catch (error) {
      if (signal?.aborted || revision !== hydrationRevision) return;
      set({
        persistenceStatus: "failed",
        persistenceError: error instanceof Error ? error.message : "恢复本地工作区失败。",
      });
    }
  },
clearPersistedWorkspace: async () => {
    const revision = ++hydrationRevision;
    try {
      const exportHistoryRecords = get().exportHistoryRecords;
      const ruleRunHistoryRecords = get().ruleRunHistoryRecords;
      const blockedCampaignIdentities = get().blockedCampaignIdentities;

      await deleteWorkspaceSnapshot();
      if (revision !== hydrationRevision) return;
      set({
        campaignGroups: initialCampaignGroups,
        campaignSheetGroups: buildSheetGroups(initialCampaignGroups),
        workspaceUnits: [],
        rules: defaultRules,
        performanceRows: initialPerformanceRows,
        activeCampaignGroupId: initialActiveId,
        activeWorkspaceUnitId: undefined,
        activeLifecycleGroupId: undefined,
        workspaceMode: "campaign",
        openTabIds: [],
        selectedDraftIds: [],
        parseStatus: "idle",
        parseProgress: 0,
        uploadedFileName: undefined,
        originalWorkbookFileId: undefined,
        originalWorkbookFileName: undefined,
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
        persistenceStatus: "ready",
        persistenceError: undefined,
      });
    } catch (error) {
      if (revision !== hydrationRevision) return;
      set({
        persistenceStatus: "failed",
        persistenceError: error instanceof Error ? error.message : "清空本地工作区失败。",
      });
    }
  }
};
};
