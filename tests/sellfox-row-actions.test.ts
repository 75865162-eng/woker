import test from "node:test";
import assert from "node:assert/strict";
import {
  sellfoxAsinHref, sellfoxRowTrend, sellfoxTrendAverage, sellfoxTrendChange, sellfoxDrillHref,
} from "@/lib/sellfox/row-actions";

test("ASIN 外链：合法 ASIN 生成 amazon.com/dp 链接，非法/空返回 null（禁用不跳空链）", () => {
  assert.equal(sellfoxAsinHref("B0ABC12345"), "https://www.amazon.com/dp/B0ABC12345");
  assert.equal(sellfoxAsinHref(" b0abc12345 "), "https://www.amazon.com/dp/B0ABC12345");
  for (const bad of ["", "  ", "SHORT", "B0ABC1234", "B0ABC123456", "B0ABC1234!", null, 123, {}, ["B0ABC12345"]]) {
    assert.equal(sellfoxAsinHref(bad), null, `非法 ASIN 应禁用: ${String(bad)}`);
  }
});

test("趋势点：缺日保留 null，不补零；day 列与 dailyQuantity 映射都可读", () => {
  const dates = ["2026-01-01", "2026-01-02", "2026-01-03"];
  const fromDayCols = sellfoxRowTrend({ "day:2026-01-01": 3, "day:2026-01-03": 7 }, dates);
  assert.deepEqual(fromDayCols, [
    { date: "2026-01-01", value: 3 },
    { date: "2026-01-02", value: null },
    { date: "2026-01-03", value: 7 },
  ]);
  const fromDaily = sellfoxRowTrend({ dailyQuantity: { "2026-01-01": 2, "2026-01-02": "" } }, dates);
  assert.equal(fromDaily[0].value, 2);
  assert.equal(fromDaily[1].value, null);
});

test("均值与环比：仅对真实点计算，除零/缺值返回 null", () => {
  const points = [
    { date: "d1", value: 10 }, { date: "d2", value: null },
    { date: "d3", value: 20 }, { date: "d4", value: 30 },
  ];
  assert.equal(sellfoxTrendAverage(points, 7), 20, "10/20/30 的均值=20，忽略 null");
  assert.equal(sellfoxTrendAverage([{ date: "d", value: null }], 7), null);
  assert.deepEqual(sellfoxTrendChange(points), { latest: 30, previous: 20, ratio: 0.5 });
  assert.equal(sellfoxTrendChange([{ date: "a", value: 0 }, { date: "b", value: 5 }]).ratio, null, "上一为 0 不除");
  assert.equal(sellfoxTrendChange([{ date: "a", value: 5 }, { date: "b", value: null }]).ratio, null);
});

test("下钻链接：带全当前筛选与实体身份，白名单外参数不透传", () => {
  const current = new URLSearchParams(
    "from=2026-01-01&to=2026-01-31&sites=US,CA&shopExternalIds=s1&salespersons=张三&grain=week&evil=drop&token=secret",
  );
  const href = sellfoxDrillHref("listings", current, { asin: "B0ABC12345", msku: "MSKU-1" });
  assert.ok(href.startsWith("/sellfox/listings?"));
  const params = new URLSearchParams(href.split("?")[1]);
  assert.equal(params.get("from"), "2026-01-01");
  assert.equal(params.get("to"), "2026-01-31");
  assert.equal(params.get("sites"), "US,CA");
  assert.equal(params.get("grain"), "week");
  assert.equal(params.get("asin"), "B0ABC12345");
  assert.equal(params.get("msku"), "MSKU-1");
  assert.equal(params.has("evil"), false);
  assert.equal(params.has("token"), false);
});

test("下钻链接：无筛选无实体时返回干净路径", () => {
  assert.equal(sellfoxDrillHref("insight", new URLSearchParams(), {}), "/sellfox/insight");
});
