import assert from "node:assert/strict";
import test from "node:test";
import { forecastFromRows } from "../src/lib/amazon-sync/sales-query";
import type { SalesRow } from "../src/lib/amazon-sync/sales-query";

function row(date: string, units: string | null, seller = "seller1", marketplace = "ATVPDKIKX0DER"): SalesRow {
  return {
    id: crypto.randomUUID(), organizationId: "org", workspaceId: "ws", sourceId: "src1", syncRunId: "run1",
    sellerAccountId: seller, marketplaceId: marketplace, businessDate: date, reportId: "r", documentId: "d",
    metrics: units === null ? {} : { unitsOrdered: units }, quality: "VALID", capturedAt: new Date(), publishedAt: new Date(),
    amazonSellerId: "A1", sellerName: "店铺", frozenScope: null, summary: null,
  } as SalesRow;
}

// 60 天连续完整发布日，level≈10、无缺日，足以支撑预测与走前回测。
function historyRows(days = 60): SalesRow[] {
  const out: SalesRow[] = [];
  const start = new Date("2026-09-01T00:00:00Z");
  for (let i = 0; i < days; i++) {
    const d = new Date(start.getTime() + i * 86_400_000).toISOString().slice(0, 10);
    out.push(row(d, "10"));
  }
  return out;
}

test("预测对象独立、含模型/版本/窗口/置信，不与真实混排", () => {
  const f = forecastFromRows(historyRows(), 30, 14);
  assert.equal(f.status, "READY");
  assert.equal(f.version, "forecast-v1");
  assert.equal(f.horizonDays, 30);
  assert.ok(f.model, "应有模型标识");
  assert.ok(["HIGH", "MEDIUM", "LOW"].includes(f.confidence));
  assert.equal(f.asOf, "2026-10-30"); // 最新完整发布日，非今日
  assert.equal(f.points.length, 30);
  assert.ok(f.points.every(p => p.p90 >= p.p50), "P90 必须 >= P50");
  assert.ok(f.horizonP50Total !== null && f.horizonP90Total !== null);
  assert.ok(Number(f.horizonP90Total) >= Number(f.horizonP50Total));
  assert.ok(f.historyDays >= 28);
});

test("走前回测存在且含误差指标（MAPE/WAPE/偏差/P90覆盖）", () => {
  const f = forecastFromRows(historyRows(75), 14, 7);
  assert.equal(f.status, "READY");
  assert.ok(f.backtest, "历史足够时应产生回测");
  assert.equal(f.backtest.version, "forecast-backtest-v1");
  assert.ok(f.backtest.evaluatedPoints > 0);
  assert.equal(typeof f.backtest.mape, "number");
  assert.equal(typeof f.backtest.wape, "number");
  assert.ok(f.backtest.p90Coverage !== null && f.backtest.p90Coverage >= 0 && f.backtest.p90Coverage <= 1);
});

test("历史不足时不臆造回测误差，返回 null 并给缺失原因", () => {
  const f = forecastFromRows(historyRows(20), 30, 14);
  assert.equal(f.status, "NEEDS_DATA");
  assert.equal(f.backtest, null);
  assert.ok(f.missingInputs.length > 0);
  assert.equal(f.points.length, 0);
});

test("缺日不补零：销售缺失日不计入历史，序列缺口阻断预测", () => {
  const rows = historyRows(40);
  // 挖掉中间一天，形成缺口；该日不再有完整发布行。
  const withGap = rows.filter(r => r.businessDate !== "2026-09-20");
  const f = forecastFromRows(withGap, 30, 14);
  // 引擎 buildDenseWindow 检测到连续缺口 → NEEDS_DATA，绝不把缺日当 0 外推。
  assert.equal(f.status, "NEEDS_DATA");
  assert.ok(f.missingInputs.some(m => m.includes("连续销量日") || m.includes("完整销量历史")), JSON.stringify(f.missingInputs));
});

test("某日销量为 null 时整日不完整，不进入历史", () => {
  const rows = historyRows(40);
  const withNull = rows.map(r => r.businessDate === "2026-09-15" ? row("2026-09-15", null) : r);
  const f = forecastFromRows(withNull, 30, 14);
  assert.equal(f.status, "NEEDS_DATA");
});

test("空数据返回 NEEDS_DATA 独立对象，不崩溃、不造数", () => {
  const f = forecastFromRows([], 30, 14);
  assert.equal(f.status, "NEEDS_DATA");
  assert.equal(f.historyDays, 0);
  assert.equal(f.asOf, "");
  assert.deepEqual(f.points, []);
  assert.deepEqual(f.missingInputs, ["完整发布日的真实销量历史"]);
});

test("窗口参数收敛到 1-90，非法值回退 30", () => {
  assert.equal(forecastFromRows(historyRows(), 999, 14).horizonDays, 90);
  assert.equal(forecastFromRows(historyRows(), 0, 14).horizonDays, 30);
});
