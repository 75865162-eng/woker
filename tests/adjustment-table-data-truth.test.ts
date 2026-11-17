import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import * as React from "react";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import type { AdjustmentDraft, OverallAdDataRow, PerformanceRow } from "../src/lib/types";

const source = readFileSync(new URL("../src/components/workspace/adjustment-table.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source.replace(/^import .*;\r?\n/gm, ""), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
}).outputText;

function renderRows(input: { performanceRows?: PerformanceRow[]; overallAdDataRows?: OverallAdDataRow[]; adjustmentDrafts?: AdjustmentDraft[] }) {
  const state = { performanceRows: [], overallAdDataRows: [], adjustmentDrafts: [], selectedDraftIds: [], ...input };
  const AdjustmentTable = runInNewContext(`${compiled}; exports.AdjustmentTable`, {
    exports: {},
    require: (name: string) => {
      assert.equal(name, "react/jsx-runtime");
      return jsxRuntime;
    },
    useMemo: React.useMemo,
    useState: React.useState,
    useWorkspaceStore: () => state,
    useVirtualRows: () => ({ startIndex: 0, endIndex: 20, beforeHeight: 0, afterHeight: 0 }),
    Button: ({ children }: { children: React.ReactNode }) => React.createElement("button", null, children),
    Play: () => null,
    Download: () => null,
  }) as React.ComponentType;
  const markup = renderToStaticMarkup(React.createElement(AdjustmentTable));
  const body = markup.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/)?.[1];
  assert.ok(body);
  return [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(row =>
    [...row[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(cell => cell[1]),
  );
}

const text = (cell: string) => cell.replace(/<[^>]*>/g, "");
const current = (cell: string) => cell.match(/text-foreground">([^<]*)<\/div>/)?.[1];
const overall = (overrides: Partial<OverallAdDataRow> = {}): OverallAdDataRow => ({
  id: "overall", fileId: "fixture", campaignGroupId: "group", keyword: "keyword", target: "keyword", matchType: "exact",
  impressions: 100, clicks: 10, orders: 2, sales: 40, spend: 4, matchStatus: "matched", ...overrides,
});
const performance = (overrides: Partial<PerformanceRow> = {}): PerformanceRow => ({
  id: "bulk", campaignGroupId: "group", batchId: "fixture", campaignName: "campaign", adGroupName: "group", keyword: "keyword", target: "keyword", matchType: "exact",
  currentBid: 1, impressions: 100, clicks: 10, orders: 2, sales: 40, spend: 4, topOfSearchShare: 0, advertisedProductOrders: 0, otherProductOrders: 0, viewableImpressions: 0, status: "enabled", ...overrides,
});
const draft = (overrides: Partial<AdjustmentDraft> = {}): AdjustmentDraft => ({
  id: "draft", campaignGroupId: "group", rowId: "bulk", keyword: "keyword", target: "keyword", currentBid: 1, suggestedBid: 2, deltaPercent: 100, reason: "fixture", matchedRule: "fixture", selected: false, ...overrides,
});

test("缺失 Bulk 行时三个比率显示无数据，不覆盖已匹配 Overall 指标", () => {
  const [cells] = renderRows({ overallAdDataRows: [overall()] });
  for (const index of [8, 9, 10, 11, 12, 13, 14]) assert.equal(current(cells[index]), "无数据");
  assert.match(cells[10], />10\.0%<\/div>/);
  assert.match(cells[12], />\$0\.40<\/div>/);
  assert.match(cells[14], />10\.0%<\/div>/);
  assert.equal(text(cells[15]), "无数据");
});

test("草稿与 Bulk 当前竞价均缺失时不伪造零，空字符串也保持未知", () => {
  for (const oldValue of [undefined, null, ""]) {
    const [cells] = renderRows({ adjustmentDrafts: [draft({ oldValue, currentBid: undefined })] });
    assert.equal(text(cells[15]), "无数据");
    for (const index of [10, 12, 14]) assert.equal(current(cells[index]), "无数据");
  }
});

test("真实零比率和零竞价保持零，旧值零不被后续竞价覆盖", () => {
  const [cells] = renderRows({
    performanceRows: [performance({ clicks: 0, orders: 0, spend: 0, currentBid: 0 })],
    overallAdDataRows: [overall({ clicks: 0, orders: 0, spend: 0, cpc: 0, acos: 0 })],
    adjustmentDrafts: [draft({ oldValue: 0, currentBid: 3 })],
  });
  assert.equal(current(cells[10]), "0.0%");
  assert.equal(current(cells[12]), "$0.00");
  assert.equal(current(cells[14]), "0.0%");
  assert.equal(text(cells[15]), "$0.00");
  for (const index of [10, 12, 14]) assert.doesNotMatch(cells[index], /无数据/);
  const [bulkOnly] = renderRows({ performanceRows: [performance({ currentBid: 0 })], overallAdDataRows: [overall()] });
  assert.equal(text(bulkOnly[15]), "$0.00");
});

test("零分母沿指标合同：CTR和CPC为零，未显式观测的ACOS未知", () => {
  const [cells] = renderRows({
    performanceRows: [performance({ impressions: 0, clicks: 0, orders: 0, sales: 0, spend: 0 })],
    overallAdDataRows: [overall({ impressions: 0, clicks: 0, orders: 0, sales: 0, spend: 0 })],
  });
  assert.equal(current(cells[10]), "0.0%");
  assert.equal(current(cells[12]), "$0.00");
  assert.equal(current(cells[14]), "无数据");
  assert.doesNotMatch(cells[14], /0\.0%/);
  const [explicit] = renderRows({ overallAdDataRows: [overall({ sales: 0, acos: 0, cpc: 0 })] });
  assert.match(explicit[14], />0\.0%<\/div>/);
  assert.match(explicit[12], />\$0\.00<\/div>/);
});

test("完整正数观测保留原有比率和竞价格式及草稿优先级", () => {
  const [cells] = renderRows({ performanceRows: [performance()], overallAdDataRows: [overall()], adjustmentDrafts: [draft({ oldValue: "1.25" })] });
  assert.equal(current(cells[10]), "10.0%");
  assert.equal(current(cells[12]), "$0.40");
  assert.equal(current(cells[14]), "10.0%");
  assert.equal(text(cells[15]), "$1.25");
});
