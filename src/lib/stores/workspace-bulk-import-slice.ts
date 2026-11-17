"use client";

import { defaultRules } from "@/data/default-rules";
import { buildGroupsFromRows, buildParseFailureMessage, buildSheetGroups, collectDiagnostics, matchOverallAdDataRows, toPerformanceRow } from "@/lib/workspace/workspace-import";
import type { PerformanceRow } from "@/lib/types";
import { emptyDiagnostics, emptyOverallAdDataMatchSummary } from "./workspace-store-defaults";
import type { WorkspaceSlice } from "./workspace-state";
export const createBulkImportSlice: WorkspaceSlice<"parseStatus" | "parseProgress" | "uploadedFileName" | "originalWorkbookFileId" | "originalWorkbookFileName" | "originalWorkbookBuffer" | "activeBatchId" | "parsedRowCount" | "parsedSheets" | "parseError" | "parseDiagnostics" | "setParseStarted" | "setParseProgress" | "ingestParsedRows" | "setParseCompleted" | "setParseFailed"> = (set) => ({
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
setParseStarted: (fileName, originalWorkbookBuffer, originalWorkbookFileId) => {
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
      originalWorkbookFileId,
      originalWorkbookFileName: fileName,
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
    })
});
