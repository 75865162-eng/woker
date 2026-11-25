import test from "node:test";
import assert from "node:assert/strict";
import { pickReviewedRates, salesFxProjectionEnabled } from "../src/lib/sellfox/sales-fx-projection";

const row = (source: string, target: string, rate: string | number, reference: string, observedAt: string) => ({
  sourceCurrency: source, targetCurrency: target, rate, reference, observedAt,
});

test("无账套基准币种 / 非法币种 → 不投影", () => {
  assert.equal(pickReviewedRates([], ""), null);
  assert.equal(pickReviewedRates([], "cny"), null, "基准币种须三位大写");
  assert.equal(pickReviewedRates([row("USD", "CNY", "7.1", "r", "2026-01-01")], "US"), null);
});

test("只接纳 target=base、source≠base、reference 非空、rate 正的已复核汇率", () => {
  const rows = [
    row("USD", "CNY", "7.12", "rev-1", "2026-11-20"),
    row("EUR", "CNY", "7.80", "rev-2", "2026-11-20"),
    row("JPY", "USD", "0.05", "rev-3", "2026-11-20"), // target≠base → 排除
    row("CNY", "CNY", "1", "rev-4", "2026-11-20"),     // source=base → 排除
    row("GBP", "CNY", "9.1", "", "2026-11-20"),         // 无来源 → 排除（草稿）
    row("AUD", "CNY", "-4.5", "rev-5", "2026-11-20"),   // rate<0 → 排除
  ];
  const out = pickReviewedRates(rows, "CNY");
  assert.ok(out);
  assert.equal(out!.baseCurrency, "CNY");
  assert.deepEqual(new Set(out!.rates.map((r) => r.sourceCurrency)), new Set(["USD", "EUR"]));
  assert.equal(out!.rates.find((r) => r.sourceCurrency === "USD")?.rate, 7.12);
});

test("同一币种对多快照取观测时间最新一条（输入须按 observedAt desc）", () => {
  const rows = [
    row("USD", "CNY", "7.20", "rev-new", "2026-11-22"),
    row("USD", "CNY", "7.10", "rev-old", "2026-11-20"),
  ];
  const out = pickReviewedRates(rows, "CNY");
  assert.equal(out!.rates.length, 1);
  assert.equal(out!.rates[0].rate, 7.2);
  assert.equal(out!.rates[0].reference, "rev-new");
});

test("全部为草稿/未复核/无来源时 → 不投影（绝不臆造）", () => {
  const rows = [
    row("USD", "CNY", "7.1", "", "2026-11-20"),
    row("EUR", "CNY", "0", "rev", "2026-11-20"),
    row("JPY", "CNY", "NaN", "rev", "2026-11-20"),
  ];
  assert.equal(pickReviewedRates(rows, "CNY"), null);
});

test("投影开关默认关闭", () => {
  // 测试环境下未显式设置时为 false
  const prev = process.env.SELLFOX_AGG_FX_ENABLED;
  delete process.env.SELLFOX_AGG_FX_ENABLED;
  assert.equal(salesFxProjectionEnabled(), false);
  process.env.SELLFOX_AGG_FX_ENABLED = "true";
  assert.equal(salesFxProjectionEnabled(), true);
  if (prev === undefined) delete process.env.SELLFOX_AGG_FX_ENABLED;
  else process.env.SELLFOX_AGG_FX_ENABLED = prev;
});
