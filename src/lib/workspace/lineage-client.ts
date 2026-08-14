import { useWorkspaceStore } from "@/lib/stores/workspace-store";
import { scopedFetch } from "@/lib/workspace/scoped-fetch";

type DraftRunScopeType = "campaign" | "lifecycle" | "workspace-unit" | "matched-overall";

type ExportValidationSummary = {
  writableCount: number;
  conflictCount: number;
  blockedCount: number;
};

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";

  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.slice(index, index + chunkSize));
  }

  return window.btoa(binary);
}

export async function recordCurrentDraftRun(scopeType: DraftRunScopeType) {
  const state = useWorkspaceStore.getState();
  const drafts = state.adjustmentDrafts;

  if (!drafts.length) {
    useWorkspaceStore.getState().setActiveDraftRunId(undefined);
    return undefined;
  }

  const campaignGroupIds = Array.from(new Set(drafts.map((draft) => draft.campaignGroupId)));
  const campaignGroups = campaignGroupIds
    .map((id) => state.campaignGroups.find((group) => group.id === id))
    .filter(Boolean);

  const response = await scopedFetch("/api/workspace/draft-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      datasetId: state.workspaceDatasetId,
      fileId: state.sourceFileId,
      scopeType,
      campaignGroupIds,
      campaignGroupNames: campaignGroups.map((group) => group?.adGroupName ?? ""),
      rulesSnapshot: state.rules,
      overallAdDataRows: state.overallAdDataRows,
      overallAdDataMatchSummary: state.overallAdDataMatchSummary,
      drafts,
      selectedDraftIds: state.selectedDraftIds,
      summary: {
        draftCount: drafts.length,
        selectedDraftCount: state.selectedDraftIds.length,
        uploadedFileName: state.uploadedFileName,
        overallAdDataFileName: state.overallAdDataFileName,
        parserVersion: state.sourceParserVersion,
      },
    }),
  });
  const data = (await response.json().catch(() => ({}))) as { draftRun?: { id: string }; error?: string };

  if (!response.ok || !data.draftRun?.id) {
    throw new Error(data.error || "记录规则运行失败。");
  }

  useWorkspaceStore.getState().setActiveDraftRunId(data.draftRun.id);
  return data.draftRun.id;
}

export async function recordReviewedExport(input: {
  fileName: string;
  data: ArrayBuffer;
  selectedDraftIds: string[];
  validation: ExportValidationSummary;
}) {
  const state = useWorkspaceStore.getState();

  if (!state.sourceFileId || !state.importJobId) {
    return undefined;
  }

  const response = await scopedFetch("/api/workspace/exports", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      datasetId: state.workspaceDatasetId,
      fileId: state.sourceFileId,
      jobId: state.importJobId,
      draftRunId: state.activeDraftRunId,
      sourceFileName: state.uploadedFileName,
      fileName: input.fileName,
      contentBase64: arrayBufferToBase64(input.data),
      draftIds: input.selectedDraftIds,
      validation: input.validation,
    }),
  });
  const data = (await response.json().catch(() => ({}))) as { exportRecord?: { id: string }; error?: string };

  if (!response.ok) {
    throw new Error(data.error || "记录导出文件失败。");
  }

  return data.exportRecord;
}
