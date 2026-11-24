import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRowLevelIssues, hasRowLevelIssues } from "../src/lib/jobs/row-level-issues";
import type { AdjustmentDraft, DraftValidationResult } from "../src/lib/types";

function draft(id: string, overrides: Partial<AdjustmentDraft> = {}): AdjustmentDraft {
  return {
    id,
    batchId: "batch-1",
    campaignGroupId: "cg-1",
    rowId: "row-1",
    keyword: "running shoes",
    target: "",
    currentBid: 1,
    suggestedBid: 2,
    deltaPercent: 100,
    reason: "规则生成",
    matchedRule: "r1",
    selected: true,
    sourceRowNumber: 12,
    ...overrides,
  };
}

function validation(draftId: string, status: "blocked" | "conflict" | "valid", message: string, sourceRowIndex?: number): DraftValidationResult {
  return { draftId, valid: status === "valid", status, message, sourceRowIndex };
}

test("行级错误：只保留失败项，映射 rowNo/sku/reason 并按行号升序", () => {
  const drafts = [
    draft("d1", { keyword: "sku-a", sourceRowNumber: 30 }),
    draft("d2", { keyword: "sku-b", sourceRowNumber: 10 }),
    draft("d3", { keyword: "", target: "target-c", sourceRowNumber: 20 }),
  ];
  const validations = [
    validation("d1", "blocked", "缺少写回列", 30),
    validation("d2", "conflict", "竞价冲突", 10),
    validation("d3", "valid", "通过", 20),
  ];
  const issues = buildRowLevelIssues(drafts, validations);
  assert.deepEqual(issues, [
    { rowNo: 10, sku: "sku-b", reason: "竞价冲突" },
    { rowNo: 30, sku: "sku-a", reason: "缺少写回列" },
  ]);
});

test("行级错误：校验无行号时回退到草稿行号；sku 用 keyword 回退 target；reason 回退草稿", () => {
  const drafts = [draft("d1", { keyword: "", target: "  target-x  ", sourceRowIndex: 7, reason: "草稿原因" })];
  const issues = buildRowLevelIssues(drafts, [validation("d1", "blocked", "", undefined)]);
  assert.deepEqual(issues, [{ rowNo: 7, sku: "target-x", reason: "草稿原因" }]);
});

test("行级错误：无匹配草稿时 rowNo/sku 留空字符串占位但行号为 0", () => {
  const issues = buildRowLevelIssues([], [validation("missing", "blocked", "未知行", undefined)]);
  assert.deepEqual(issues, [{ rowNo: 0, sku: "", reason: "未知行" }]);
});

test("hasRowLevelIssues：仅数组且非空为真", () => {
  assert.equal(hasRowLevelIssues(undefined), false);
  assert.equal(hasRowLevelIssues({}), false);
  assert.equal(hasRowLevelIssues({ rowLevelIssues: [] }), false);
  assert.equal(hasRowLevelIssues({ rowLevelIssues: [{ rowNo: 1, sku: "x", reason: "y" }] }), true);
});
