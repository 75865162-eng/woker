import { writeWorkspaceDraftRun } from "@/lib/repositories/workspace-repository";
import { type ParseDiagnostics } from "@/lib/workspace/workspace-import";
import type { CampaignGroup, PerformanceRow, OverallAdDataMatchSummary, OverallAdDataRow, Rule, RuleRunHistoryRecord } from "@/lib/types";

export const initialCampaignGroups: CampaignGroup[] = [];

export const initialPerformanceRows: PerformanceRow[] = [];

export const initialActiveId = "";

export const emptyDiagnostics: ParseDiagnostics = {
  totalRows: 0,
  sponsoredProductRows: 0,
  rowsWithAdGroup: 0,
  keywordRows: 0,
  rowsWithBid: 0,
  executableRows: 0,
  sampleHeaders: [],
  sampleEntities: [],
};

export const emptyOverallAdDataMatchSummary: OverallAdDataMatchSummary = {
  totalRows: 0,
  matchedRows: 0,
  unmatchedRows: 0,
  ambiguousRows: 0,
  matchedCampaignGroups: 0,
  scopedCampaignGroups: 0,
};

export function countMatchedOverallRowsForCampaignGroups(rows: OverallAdDataRow[], campaignGroupIds: string[]) {
  const scopeIds = new Set(campaignGroupIds);

  return rows.filter((row) => row.matchStatus !== "unmatched" && row.campaignGroupId && scopeIds.has(row.campaignGroupId)).length;
}

export function persistExportedRuleRunRecords(input: {
  records: RuleRunHistoryRecord[];
  rules: Rule[];
  fileName: string;
  exportedAt: string;
  selectedDraftIdsByRecordId: Map<string, string[]>;
}) {
  if (!input.records.length) return;
  void Promise.all(input.records.map((record) => writeWorkspaceDraftRun({
    record: { ...record, exportedAt: input.exportedAt, exportFileName: input.fileName },
    rules: input.rules,
    selectedDraftIds: input.selectedDraftIdsByRecordId.get(record.id) ?? [],
    exportFileName: input.fileName,
    exportedAt: input.exportedAt,
  }))).catch((error) => {
    console.warn("Failed to persist exported workspace draft runs.", error);
  });
}

export function persistRuleRunHistoryRecords(records: RuleRunHistoryRecord[], rules: Rule[]) {
  if (!records.length) {
    return;
  }

  void Promise.all(records.map((record) => writeWorkspaceDraftRun({ record, rules }))).catch((error) => {
    console.warn("Failed to persist workspace draft runs.", error);
  });
}
