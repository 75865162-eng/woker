import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { parseSellfoxAdTargetingReport } from "@/lib/sellfox/ads-targeting-contract";
import { parseSellfoxAdSearchTermReport } from "@/lib/sellfox/ads-search-term-contract";
const scope = { storeName: "Fixture", startDate: "2026-10-24", endDate: "2026-10-24" };
const base = { 店铺: "Fixture", 日期: "2026-10-24", 广告活动ID: "campaign", 广告组ID: "group", 广告曝光量: 10, 广告点击量: 2, 广告花费: 1.5, 广告订单量: 0, 广告销售额: 0 };
async function xlsx(rows: Record<string, unknown>[], headers = Object.keys(rows[0]), extraSheet = false) {
  const book = new ExcelJS.Workbook(), sheet = book.addWorksheet("report");
  sheet.addRow(headers); for (const row of rows) sheet.addRow(headers.map(key => row[key] ?? null));
  if (extraSheet) book.addWorksheet("other");
  return Buffer.from(await book.xlsx.writeBuffer());
}
test("targeting contract retains legacy IDs, optional uppercase ASIN/SKU, raw evidence and null currency", async () => {
  const raw = { ...base, 投放ID: "target", 投放: "关键词", 匹配类型: "EXACT", ASIN: "B0TEST", SKU: "MSKU", 币种: "USD" };
  const [row] = await parseSellfoxAdTargetingReport(await xlsx([raw]), scope);
  assert.equal(row.targetingId, "target"); assert.equal(row.targetingText, "关键词"); assert.equal(row.matchType, "EXACT");
  assert.equal(row.asin, "B0TEST"); assert.equal(row.msku, "MSKU"); assert.equal(row.currency, null);
  assert.equal(row.adOrders, 0); assert.equal(row.adSales, 0); assert.deepEqual(row.payload, raw);
  assert.deepEqual(await parseSellfoxAdTargetingReport(await xlsx([], Object.keys(raw)), scope), []);
});
for (const [name, parse] of [["targeting", parseSellfoxAdTargetingReport], ["search term", parseSellfoxAdSearchTermReport]] as const) {
  test(`${name} reads live 广告投放ID, trims either ID alias, rejects blank IDs and ambiguous aliases`, async () => {
    const raw = { ...base, 用户搜索词: "query", 投放: "关键词", 匹配类型: "EXACT", 币种: "USD" };
    for (const column of ["广告投放ID", "投放ID"]) {
      const rows = await parse(await xlsx([
        { ...raw, [column]: " 120449591864118 " },
        { ...raw, [column]: "120449591864119" },
      ]), scope);
      assert.deepEqual(rows.map(row => row.targetingId), ["120449591864118", "120449591864119"]);
      assert.equal(rows[0].currency, null);
      assert.equal(rows[0].payload[column], " 120449591864118 ");
      for (const blank of ["", "   ", null]) {
        await assert.rejects(async () => parse(await xlsx([{ ...raw, [column]: blank }]), scope), /身份/);
      }
      await assert.rejects(async () => parse(await xlsx([
        { ...raw, [column]: "120449591864118" },
        { ...raw, [column]: " 120449591864118 " },
      ]), scope), /重复实体/);
    }
    const ambiguous = { ...raw, 广告投放ID: "120449591864118", 投放ID: "120449591864118" };
    await assert.rejects(async () => parse(await xlsx([ambiguous]), scope), /重复列/);
    await assert.rejects(async () => parse(await xlsx([], Object.keys(ambiguous)), scope), /重复列/);
  });
}
test("targeting text fallback is deterministic across dates, includes campaign/group/match, and never replaces blank explicit IDs", async () => {
  const raw = { ...base, 投放: "关键词", 匹配类型: "EXACT" };
  const parse = async (rows: Record<string, unknown>[]) => parseSellfoxAdTargetingReport(await xlsx(rows), scope);
  const [a] = await parse([raw]), [b] = await parse([raw]), [c] = await parse([{ ...raw, 匹配类型: "BROAD" }]);
  assert.match(a.targetingId, /^text:[0-9a-f]{64}$/); assert.equal(a.targetingId, b.targetingId); assert.notEqual(a.targetingId, c.targetingId);
  await assert.rejects(() => parse([{ ...raw, 投放ID: "" }]), /身份/);
  await assert.rejects(() => parse([{ ...base }]), /缺少/);
  await assert.rejects(() => parse([{ ...raw, 投放: "" }]), /身份/);
  await assert.rejects(() => parse([raw, raw]), /重复实体/);
});
test("search-term identity includes optional targeting ID, absent IDs use non-null sentinel and optional metrics stay unknown", async () => {
  const raw = { ...base, 用户搜索词: "用户 query", 投放: "关键词", 广告花费: null };
  const [row] = await parseSellfoxAdSearchTermReport(await xlsx([raw]), scope);
  assert.equal(row.searchTerm, "用户 query"); assert.equal(row.targetingId, ""); assert.equal(row.targetingText, "关键词");
  assert.equal(row.cost, null); assert.equal(row.asin, null); assert.equal(row.currency, null);
  const rows = await parseSellfoxAdSearchTermReport(await xlsx([{ ...raw, 投放ID: "a" }, { ...raw, 投放ID: "b" }]), scope);
  assert.equal(rows.length, 2);
  await assert.rejects(async () => parseSellfoxAdSearchTermReport(await xlsx([raw, raw]), scope), /重复实体/);
  await assert.rejects(async () => parseSellfoxAdSearchTermReport(await xlsx([{ ...raw, 用户搜索词: " " }]), scope), /身份/);
  await assert.rejects(async () => parseSellfoxAdSearchTermReport(await xlsx([{ ...raw, 投放ID: "" }]), scope), /身份/);
});
for (const [name, parse, identity] of [["targeting", parseSellfoxAdTargetingReport, { 投放ID: "t" }], ["search term", parseSellfoxAdSearchTermReport, { 用户搜索词: "query" }]] as const) {
  test(`${name} rejects foreign/date/ID/column/formula/duplicate-alias errors and unsafe XLSX envelopes`, async () => {
    const raw = { ...base, ...identity };
    for (const patch of [{ 店铺: "foreign" }, { 日期: "2026-02-29" }, { 日期: "2026-10-23" }, { 广告活动ID: "" }, { 广告组ID: "" }, { 广告点击量: 1.5 }, { 广告花费: { formula: "1+1", result: 2 } }]) {
      await assert.rejects(async () => parse(await xlsx([{ ...raw, ...patch }]), scope));
    }
    await assert.rejects(async () => parse(await xlsx([raw], Object.keys(raw).filter(key => key !== "广告花费")), scope), /缺少/);
    await assert.rejects(async () => parse(await xlsx([raw], [...Object.keys(raw), "广告花费"]), scope), /重复列/);
    await assert.rejects(async () => parse(await xlsx([raw], [...Object.keys(raw), "asin", "ASIN"]), scope), /重复列/);
    await assert.rejects(async () => parse(await xlsx([raw], Object.keys(raw), true), scope), /工作表/);
    await assert.rejects(() => parse(Buffer.from("not xlsx"), scope), /XLSX/);
    await assert.rejects(() => parse(Buffer.alloc(25 * 1024 * 1024 + 1), scope), /25MB/);
    const oversized = await xlsx([raw]);
    oversized.writeUInt32LE(101 * 1024 * 1024, oversized.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02])) + 24);
    await assert.rejects(() => parse(oversized, scope), /解压/);
  });
}
