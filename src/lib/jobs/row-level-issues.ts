import type { AdjustmentDraft, DraftValidationResult } from "@/lib/types";

/**
 * 导入结果的行号级错误：把导出校验失败项映射为 { rowNo, sku, reason }[]，
 * 让前端能定位到原始工作簿的具体行，而不是只看到汇总级错误字符串。
 */
export type RowLevelIssue = {
  rowNo: number;
  sku: string;
  reason: string;
};

/**
 * 从草稿与校验结果生成行级错误。
 * - rowNo 优先取校验结果的 sourceRowIndex，其次取草稿的 sourceRowNumber/sourceRowIndex；
 * - sku 取草稿的 keyword / target（Bulk 表以关键词或投放标识定位实体），无则留空字符串；
 * - reason 取校验结果的 message，无则取草稿的 reason；
 * - 只保留 valid=false 的项；按 rowNo 升序稳定排序。
 */
export function buildRowLevelIssues(
  drafts: readonly AdjustmentDraft[],
  validations: readonly DraftValidationResult[],
): RowLevelIssue[] {
  const draftById = new Map(drafts.map((draft) => [draft.id, draft]));
  const issues: RowLevelIssue[] = [];

  for (const validation of validations) {
    if (validation.valid) continue;
    const draft = draftById.get(validation.draftId);
    const rowNo = validation.sourceRowIndex ?? draft?.sourceRowIndex ?? draft?.sourceRowNumber ?? 0;
    const sku = (draft?.keyword?.trim() || draft?.target?.trim() || "");
    const reason = validation.message || draft?.reason || "校验未通过";
    issues.push({ rowNo, sku, reason });
  }

  return issues.sort((a, b) => a.rowNo - b.rowNo);
}

/** 校验载荷里是否含有可展示的行级错误。 */
export function hasRowLevelIssues(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const issues = (payload as { rowLevelIssues?: unknown }).rowLevelIssues;
  return Array.isArray(issues) && issues.length > 0;
}
