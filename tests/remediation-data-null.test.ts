import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import vm from "node:vm";

const read = (path: string) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const invoiceService = read("src/lib/procurement/invoice-service.ts");
const taxWorkbench = read("src/components/operations/ext/tax-workbench.tsx");
const adjustmentTable = read("src/components/workspace/adjustment-table.tsx");
const syncCenter = read("src/components/operations/sync-center-workbench.tsx");
const researchServer = read("src/lib/selection-research/server.ts");

test("采购对账金额缺失返回 null，不再补造字符串 0", () => {
  assert.ok(invoiceService.includes("amount: row.amount ?? null"), "开票金额缺失必须保留 null");
  assert.ok(invoiceService.includes("invoicedAmount: invoicedRow?.amount ?? null"), "无发票行时开票金额必须保留 null");
  assert.ok(!invoiceService.includes("amount: row.amount ?? '0'"), "金额字段不得再补造字符串 0");
  assert.ok(!invoiceService.includes("invoicedAmount: invoicedRow?.amount ?? '0'"), "开票金额不得再补造字符串 0");
});

test("税务汇总缺失显示无数据，不再补造 0", () => {
  assert.ok(taxWorkbench.includes('value === null || value === undefined ? "无数据" : money(value)'), "汇总缺失必须显示无数据");
  for (const expression of ["summary?.OUTPUT.tax ?? 0", "summary?.OUTPUT.taxable ?? 0", "summary?.INPUT.tax ?? 0", "summary?.INPUT.taxable ?? 0", "summary?.payable ?? 0"]) {
    assert.ok(!taxWorkbench.includes(expression), `${expression} 不得再补 0`);
  }
});

test("广告对比表指标缺失显示无数据，不再补造 0", () => {
  for (const field of ["impressions", "clicks", "spend", "orders"]) {
    assert.ok(!adjustmentTable.includes(`performanceRow?.${field} ?? 0`), `${field} 不得再补 0`);
  }
  assert.ok(adjustmentTable.includes('current === null || current === undefined ? "无数据" : formatValue(current)'), "缺失指标必须显示无数据");
});

test("快照在途合计缺任一分项时未知，完整零仍显示 0", () => {
  const match = syncCenter.match(/function formatInboundQuantity\([^)]*\): string \{([\s\S]*?)\n}/);
  assert.ok(match, "必须用专门函数处理在途数量求和");
  const formatInboundQuantity = vm.runInNewContext(`(row) => {${match[1].replace(/: value is number/g, "")}\n}`);
  const row = (working: number | null | undefined, shipped: number | null | undefined, receiving: number | null | undefined) => ({
    inboundWorkingQuantity: working,
    inboundShippedQuantity: shipped,
    inboundReceivingQuantity: receiving,
  });

  assert.equal(formatInboundQuantity(row(3, null, 2)), "—", "已知两项不能冒充完整合计");
  assert.equal(formatInboundQuantity(row(3, undefined, 2)), "—", "未提供分项不能当作零");
  assert.equal(formatInboundQuantity(row(0, 0, 0)), "0", "完整观测到的零合计必须显示 0");
  assert.equal(formatInboundQuantity(row(null, null, null)), "—", "全部缺失必须显示未知");
});

test("快照预留数量缺失显示占位符", () => {
  assert.ok(syncCenter.includes("row.reservedQuantity === undefined ?"), "预留数量缺失必须显示占位符");
});

test("研究任务读取仅记录不存在返回 404，其他异常向上暴露", () => {
  assert.ok(researchServer.includes('cause.message === "RESEARCH_NOT_FOUND"'), "只有记录不存在才能降级为 404");
  assert.ok(researchServer.includes("throw cause;"), "其他异常必须重新抛出，保留 500 可观测性");
  assert.ok(!researchServer.includes("catch { return { ok: false as const"), "不得再用空 catch 吞掉所有异常");
});
