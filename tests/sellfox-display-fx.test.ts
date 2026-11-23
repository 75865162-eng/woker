import test from "node:test";
import assert from "node:assert/strict";
import { buildFxMap, availableDisplayCurrencies, convertForDisplay, type ReviewedFxRate } from "@/lib/sellfox/display-fx";

const approved: ReviewedFxRate[] = [
  { sourceCurrency: "USD", targetCurrency: "CNY", rate: 7.25, reference: "FX-2026-11-01", observedAt: "2026-11-01T00:00:00.000Z" },
  { sourceCurrency: "EUR", targetCurrency: "CNY", rate: 7.9, reference: "FX-2026-11-02", observedAt: "2026-11-02T00:00:00.000Z" },
];

test("展示币种只接纳已复核汇率条目，非法来源/数值一律丢弃", () => {
  const map = buildFxMap([
    ...approved,
    { sourceCurrency: "JPY", targetCurrency: "CNY", rate: 0.05 }, // 缺 reference
    { sourceCurrency: "GBP", targetCurrency: "CNY", rate: -1, reference: "bad" }, // 非正
    { sourceCurrency: "CAD", targetCurrency: "CNY", rate: "NaN", reference: "bad" }, // 非法数值
    null,
  ]);
  assert.equal(map.size, 2);
  assert.deepEqual(availableDisplayCurrencies(map), ["CNY"]);
});

test("命中已复核汇率才换算，未命中/同币种/缺值保留原值不臆造", () => {
  const map = buildFxMap(approved);
  const hit = convertForDisplay(100, "USD", "CNY", map);
  assert.equal(hit.converted, true);
  assert.equal(hit.currency, "CNY");
  assert.equal(hit.value, 725);
  assert.match(hit.audit ?? "", /FX-2026-11-01/);

  const noRate = convertForDisplay(100, "JPY", "CNY", map);
  assert.equal(noRate.converted, false);
  assert.equal(noRate.currency, "JPY");
  assert.equal(noRate.value, 100);

  const same = convertForDisplay(100, "USD", "USD", map);
  assert.equal(same.converted, false);

  const missing = convertForDisplay(null, "USD", "CNY", map);
  assert.equal(missing.converted, false);
  assert.equal(missing.value, 0);
});

test("目标币为空（原币显示）永不换算", () => {
  const map = buildFxMap(approved);
  assert.equal(convertForDisplay(100, "USD", "", map).converted, false);
});
