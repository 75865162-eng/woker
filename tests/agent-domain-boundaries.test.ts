import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import ts from "typescript";
import { createPpcAnalyticsAdapter } from "@/lib/agent-platform/ppc";
import { normalizeOverallRows, normalizePerformanceRows } from "@/lib/agent-platform/ppc-normalization";
import { buildAdjustmentDrafts } from "@/lib/agent-platform/ppc-reporting";

const domainDirectory = path.resolve("src/lib/agent-platform");

test("领域职责模块的运行时依赖无环且不反向引用编排入口", () => {
  const files = fs.readdirSync(domainDirectory).filter((file) => /^(market|listing|supplier|ppc)(-|\.)/.test(file) && file.endsWith(".ts"));
  const graph = new Map<string, string[]>();
  for (const file of files) {
    const source = ts.createSourceFile(file, fs.readFileSync(path.join(domainDirectory, file), "utf8"), ts.ScriptTarget.Latest, true);
    const imports = source.statements.filter(ts.isImportDeclaration).filter((statement) => {
      const clause = statement.importClause;
      return clause && !clause.isTypeOnly && (!clause.namedBindings || !ts.isNamedImports(clause.namedBindings) || clause.namedBindings.elements.some((item) => !item.isTypeOnly));
    }).map((statement) => (statement.moduleSpecifier as ts.StringLiteral).text).filter((name) => name.startsWith("./")).map((name) => `${name.slice(2)}.ts`);
    if (file.includes("-")) assert.ok(imports.every((name) => !/^(market|listing|supplier|ppc)\.ts$/.test(name)), `${file} 不应反向加载入口`);
    graph.set(file, imports);
  }
  const complete = new Set<string>();
  function visit(file: string, stack: string[]) {
    assert.ok(!stack.includes(file), `循环依赖：${[...stack, file].join(" -> ")}`);
    if (complete.has(file)) return;
    for (const dependency of graph.get(file) ?? []) if (graph.has(dependency)) visit(dependency, [...stack, file]);
    complete.add(file);
  }
  for (const file of files) visit(file, []);
});

const metrics = { currentBid: 1, impressions: 0, clicks: 0, orders: 0, sales: 0, spend: 0, topOfSearchShare: 0, advertisedProductOrders: 0, otherProductOrders: 0, viewableImpressions: 0 };

test("PPC 归一化保留已观测零值并拒绝所有缺失必需指标", () => {
  assert.equal(normalizePerformanceRows([metrics])[0].orders, 0);
  for (const field of Object.keys(metrics)) {
    for (const invalid of [undefined, null, "", " ", false, NaN, Infinity]) {
      assert.throws(() => normalizePerformanceRows([{ ...metrics, [field]: invalid }]), /NEEDS_DATA/);
    }
  }
  for (const field of ["impressions", "clicks", "orders", "sales", "spend"]) {
    assert.throws(() => normalizeOverallRows([{ ...metrics, [field]: null }]), /NEEDS_DATA/);
  }
});

test("PPC 工具适配器不得把缺失花费转换为零值分析", async () => {
  await assert.rejects(() => createPpcAnalyticsAdapter().execute({ executionId: "isolated-domain-test", toolId: "ppc.ads.snapshot", input: { performanceRows: [{ ...metrics, spend: null }] }, context: {} }), /NEEDS_DATA/);
});

test("PPC 草稿保留竞价身份且不修改分析输入", () => {
  const recommendation = { rowId: "row-1", campaignGroupId: "group-1", keyword: "desk", target: "desk", currentBid: 1, suggestedBid: 0.8, deltaPercent: -20, recommendation: "人工复核后降价", confidence: 0.8, evidence: [] };
  const before = structuredClone(recommendation);
  const [draft] = buildAdjustmentDrafts([recommendation]);
  assert.equal(draft.rowId, "row-1");
  assert.equal(draft.campaignGroupId, "group-1");
  assert.equal(draft.oldValue, 1);
  assert.equal(draft.newValue, 0.8);
  assert.equal(draft.matchedRule, "PPC Agent");
  assert.deepEqual(recommendation, before);
});
