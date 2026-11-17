"use client";

import { findOverallAdDataUploadForScope, summarizeOverallRows, upsertOverallAdDataUpload } from "@/lib/workspace/workspace-drafts";
import { buildOverallAdDataRows, buildOverallAdDataRowsFromFiles } from "@/lib/workspace/workspace-import";
import type { OverallAdDataStatus, OverallAdDataUpload } from "@/lib/types";
import { emptyOverallAdDataMatchSummary } from "./workspace-store-defaults";
import type { WorkspaceSlice } from "./workspace-state";
export const createOverallAdDataSlice: WorkspaceSlice<"overallAdDataFileName" | "overallAdDataRows" | "overallAdDataStatus" | "overallAdDataError" | "overallAdDataMatchSummary" | "overallAdDataUploads" | "ingestOverallAdDataCsv" | "ingestOverallAdDataCsvFiles" | "activateOverallAdDataForScope"> = (set, get) => ({
overallAdDataFileName: undefined,
overallAdDataRows: [],
overallAdDataStatus: "idle",
overallAdDataError: undefined,
overallAdDataMatchSummary: emptyOverallAdDataMatchSummary,
overallAdDataUploads: [],
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
  }
});
