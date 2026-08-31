import type {
  AdjustmentDraft,
  ExportHistoryRecord,
  OverallAdDataMatchSummary,
  OverallAdDataRow,
  Rule,
  RuleRunHistoryRecord,
  WorkspaceSnapshotRecord,
} from "@/lib/types";

const arrayBufferMarker = "__workspaceArrayBufferBase64";

type WorkspaceSnapshotApiRecord<T> = WorkspaceSnapshotRecord & { snapshot: T };

type DraftRunApiRecord = {
  id: string;
  scopeType: string;
  campaignGroupIds: unknown;
  campaignGroupNames: unknown;
  rulesSnapshot: unknown;
  overallAdDataRows: unknown;
  overallAdDataMatchSummary: unknown;
  drafts: unknown;
  selectedDraftIds: unknown;
  summary: unknown;
  createdAt: string;
  exportedAt?: string | null;
  exportFileName?: string | null;
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

function base64ToArrayBuffer(value: string) {
  const binary = window.atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes.buffer;
}

function encodeSnapshotForJson<T>(snapshot: T): T {
  if (!snapshot || typeof snapshot !== "object") {
    return snapshot;
  }

  const record = { ...(snapshot as Record<string, unknown>) };

  if (record.originalWorkbookBuffer instanceof ArrayBuffer) {
    record.originalWorkbookBuffer = {
      [arrayBufferMarker]: arrayBufferToBase64(record.originalWorkbookBuffer),
    };
  }

  return record as T;
}

function decodeSnapshotFromJson<T>(snapshot: T): T {
  if (!snapshot || typeof snapshot !== "object") {
    return snapshot;
  }

  const record = { ...(snapshot as Record<string, unknown>) };
  const encodedBuffer = record.originalWorkbookBuffer;

  if (
    encodedBuffer &&
    typeof encodedBuffer === "object" &&
    !Array.isArray(encodedBuffer) &&
    typeof (encodedBuffer as Record<string, unknown>)[arrayBufferMarker] === "string"
  ) {
    record.originalWorkbookBuffer = base64ToArrayBuffer(
      (encodedBuffer as Record<string, string>)[arrayBufferMarker],
    );
  }

  return record as T;
}

export async function readWorkspaceSnapshot<T>(): Promise<WorkspaceSnapshotRecord & { snapshot: T } | undefined> {
  return readRemoteWorkspaceSnapshot<T>();
}

export async function writeWorkspaceSnapshot<T>(snapshot: T) {
  await writeRemoteWorkspaceSnapshot(snapshot);
}

export async function deleteWorkspaceSnapshot() {
  await deleteRemoteWorkspaceSnapshot();
}

export async function readWorkspaceDraftRunHistory(): Promise<{
  exportHistoryRecords: ExportHistoryRecord[];
  ruleRunHistoryRecords: RuleRunHistoryRecord[];
}> {
  try {
    const response = await fetch("/api/workspace/draft-runs?limit=100", { cache: "no-store" });

    if (response.status === 401 || response.status === 404) {
      return { exportHistoryRecords: [], ruleRunHistoryRecords: [] };
    }

    if (!response.ok) {
      throw new Error("读取数据库草稿运行历史失败。");
    }

    const data = (await response.json()) as { draftRuns?: DraftRunApiRecord[] };
    const draftRuns = data.draftRuns ?? [];

    return {
      ruleRunHistoryRecords: draftRuns.map(draftRunToRuleRunHistoryRecord),
      exportHistoryRecords: draftRuns.flatMap(draftRunToExportHistoryRecord),
    };
  } catch {
    return { exportHistoryRecords: [], ruleRunHistoryRecords: [] };
  }
}

export async function writeWorkspaceDraftRun(input: {
  record: RuleRunHistoryRecord;
  rules: Rule[];
  selectedDraftIds?: string[];
  exportFileName?: string;
  exportedAt?: string;
}) {
  const response = await fetch("/api/workspace/draft-runs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      id: input.record.id,
      ranAt: input.record.ranAt,
      scopeType: "campaign",
      campaignGroupIds: input.record.campaignGroupIds,
      campaignGroupNames: input.record.campaignGroupNames,
      rulesSnapshot: input.rules,
      overallAdDataRows: input.record.overallAdDataRows,
      overallAdDataMatchSummary: input.record.overallAdDataMatchSummary,
      drafts: input.record.adjustmentDrafts,
      selectedDraftIds: input.selectedDraftIds ?? input.record.adjustmentDrafts.map((draft) => draft.id),
      summary: {
        draftCount: input.record.adjustmentDrafts.length,
        campaignGroupCount: input.record.campaignGroupIds.length,
      },
      exportFileName: input.exportFileName,
      exportedAt: input.exportedAt,
    }),
  });

  if (response.status === 401) {
    return;
  }

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "保存数据库草稿运行历史失败。");
  }
}

async function readRemoteWorkspaceSnapshot<T>(): Promise<WorkspaceSnapshotApiRecord<T> | undefined> {
  try {
    const response = await fetch("/api/workspace/snapshot");

    if (response.status === 401 || response.status === 404) {
      return undefined;
    }

    if (!response.ok) {
      throw new Error("读取数据库 Workspace Snapshot 失败。");
    }

    const data = (await response.json()) as {
      version?: number;
      savedAt?: string;
      snapshot?: T | null;
    };

    if (!data.snapshot) {
      return undefined;
    }

    const snapshot = decodeSnapshotFromJson(data.snapshot);
    const hydratedSnapshot = await hydrateWorkspaceSnapshotBuffer(snapshot);

    return {
      version: data.version ?? 1,
      savedAt: data.savedAt ?? new Date().toISOString(),
      snapshot: hydratedSnapshot,
    };
  } catch {
    return undefined;
  }
}

async function writeRemoteWorkspaceSnapshot<T>(snapshot: T) {
  const response = await fetch("/api/workspace/snapshot", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      version: 1,
      snapshot: encodeSnapshotForJson(snapshot),
    }),
  });

  if (response.status === 401) {
    return;
  }

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "保存数据库 Workspace Snapshot 失败。");
  }
}

async function deleteRemoteWorkspaceSnapshot() {
  const response = await fetch("/api/workspace/snapshot", {
    method: "DELETE",
  });

  if (response.status === 401) {
    return;
  }

  if (!response.ok) {
    const data = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(data.error || "删除数据库 Workspace Snapshot 失败。");
  }
}

async function hydrateWorkspaceSnapshotBuffer<T>(snapshot: T): Promise<T> {
  if (!snapshot || typeof snapshot !== "object") {
    return snapshot;
  }

  const record = { ...(snapshot as Record<string, unknown>) };

  if (!(record.originalWorkbookBuffer instanceof ArrayBuffer) && typeof record.originalWorkbookFileId === "string" && record.originalWorkbookFileId) {
    try {
      const response = await fetch(`/api/workspace/workbook-files/${encodeURIComponent(record.originalWorkbookFileId)}/download`);
      if (response.ok) {
        record.originalWorkbookBuffer = await response.arrayBuffer();
      }
    } catch {
      // fall back to a snapshot without workbook bytes
    }
  }

  return record as T;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function draftArray(value: unknown): AdjustmentDraft[] {
  return Array.isArray(value) ? (value as AdjustmentDraft[]) : [];
}

function overallRows(value: unknown): OverallAdDataRow[] {
  return Array.isArray(value) ? (value as OverallAdDataRow[]) : [];
}

function overallSummary(value: unknown): OverallAdDataMatchSummary {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as OverallAdDataMatchSummary)
    : {
        totalRows: 0,
        matchedRows: 0,
        unmatchedRows: 0,
        ambiguousRows: 0,
        matchedCampaignGroups: 0,
        scopedCampaignGroups: 0,
      };
}

function draftRunToRuleRunHistoryRecord(run: DraftRunApiRecord): RuleRunHistoryRecord {
  return {
    id: run.id,
    ranAt: run.createdAt,
    exportedAt: run.exportedAt ?? undefined,
    exportFileName: run.exportFileName ?? undefined,
    campaignGroupIds: stringArray(run.campaignGroupIds),
    campaignGroupNames: stringArray(run.campaignGroupNames),
    overallAdDataRows: overallRows(run.overallAdDataRows),
    overallAdDataMatchSummary: overallSummary(run.overallAdDataMatchSummary),
    adjustmentDrafts: draftArray(run.drafts),
  };
}

function draftRunToExportHistoryRecord(run: DraftRunApiRecord): ExportHistoryRecord[] {
  if (!run.exportFileName || !run.exportedAt) {
    return [];
  }

  const adjustmentDrafts = draftArray(run.drafts);
  const selectedDraftIds = stringArray(run.selectedDraftIds);

  return [{
    id: `export-${run.id}`,
    exportedAt: run.exportedAt,
    fileName: run.exportFileName,
    campaignGroupIds: stringArray(run.campaignGroupIds),
    campaignGroupNames: stringArray(run.campaignGroupNames),
    keywordNames: Array.from(new Set(adjustmentDrafts.map((draft) => draft.keyword || draft.target).filter(Boolean))).slice(0, 80),
    overallAdDataRows: overallRows(run.overallAdDataRows),
    overallAdDataMatchSummary: overallSummary(run.overallAdDataMatchSummary),
    adjustmentDrafts,
    selectedDraftIds: selectedDraftIds.length ? selectedDraftIds : adjustmentDrafts.map((draft) => draft.id),
  }];
}
