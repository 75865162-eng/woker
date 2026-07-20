import { exportSelectedDrafts } from "@/lib/excel/bulk-export";
import type { AdjustmentDraft } from "@/lib/types";

export type BulkDraftExportInput = {
  workbookBuffer: ArrayBuffer;
  drafts: AdjustmentDraft[];
  fileName?: string;
};

export async function exportBulkDrafts(input: BulkDraftExportInput) {
  return exportSelectedDrafts(input);
}
