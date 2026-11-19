import test from "node:test";
import assert from "node:assert/strict";
import {
  sellfoxGrain, sellfoxIsoMonday, sellfoxBucketKey,
  regroupSellfoxDaily, regroupSellfoxSummaryDaily, sellfoxWeekdayColumns,
} from "@/lib/sellfox/browse-grain";
import { sellfoxBrowseQuery } from "@/lib/sellfox/browse-query";
import { readSellfoxView, sellfoxViewParams } from "@/lib/sellfox/workbench-view";

const query = (params: string) => sellfoxBrowseQuery(new URL(`http://localhost/?${params}`));

test("grain 解析：非法值回落 day，仅 week/month 生效", () => {
  assert.equal(sellfoxGrain("week"), "week");
  assert.equal(sellfoxGrain("month"), "month");
  assert.equal(sellfoxGrain("day"), "day");
  for (const bad of ["", "YEAR", "weeks", null, undefined, "quarter"]) assert.equal(sellfoxGrain(bad), "day");
  assert.equal(query("grain=week").grain, "week");
  assert.equal(query("grain=BOGUS").grain, "day");
});

test("ISO 周一分桶跨年不串周：2026-01-01(周四)归属 2025-12-29 那一周", () => {
  assert.equal(sellfoxIsoMonday("2026-01-01"), "2025-12-29");
  assert.equal(sellfoxIsoMonday("2026-01-04"), "2025-12-29"); // 周日仍属上周
  assert.equal(sellfoxIsoMonday("2026-01-05"), "2026-01-05"); // 周一进入新周
  assert.equal(sellfoxIsoMonday("2027-01-01"), "2026-12-28"); // 跨年回溯
  assert.equal(sellfoxIsoMonday("2024-12-30"), "2024-12-30");
  // 非法日期原样返回，不抛错、不伪造
  assert.equal(sellfoxIsoMonday("not-a-date"), "not-a-date");
});

test("bucket key 为合法 YYYY-MM-DD，前端可直接解析星期", () => {
  assert.equal(sellfoxBucketKey("2026-11-19", "day"), "2026-11-19");
  assert.equal(sellfoxBucketKey("2026-11-19", "month"), "2026-11-01");
  assert.equal(sellfoxBucketKey("2026-11-19", "week"), sellfoxIsoMonday("2026-11-19"));
  for (const grain of ["day", "week", "month"] as const) {
    const key = sellfoxBucketKey("2026-11-19", grain);
    assert.ok(!Number.isNaN(new Date(`${key}T00:00:00Z`).getTime()), `${grain} key 必须是合法日期: ${key}`);
  }
});

test("day 粒度重分桶：零改动，逐日原值", () => {
  const dates = ["2026-11-17", "2026-11-18", "2026-11-19"];
  const daily = { "2026-11-17": 3, "2026-11-18": 5, "2026-11-19": 7 };
  const r = regroupSellfoxDaily(daily, dates, "day");
  assert.deepEqual(r.buckets, dates);
  assert.deepEqual(r.daily, daily);
});

test("week 粒度重分桶：同周求和，桶 key 为周一", () => {
  // 11-16 周一, 11-17 周二, 11-22 周日 -> 同一周; 11-23 周一 -> 新周
  const dates = ["2026-11-16", "2026-11-17", "2026-11-22", "2026-11-23"];
  const daily = { "2026-11-16": 2, "2026-11-17": 3, "2026-11-22": 5, "2026-11-23": 7 };
  const r = regroupSellfoxDaily(daily, dates, "week");
  assert.deepEqual(r.buckets, ["2026-11-16", "2026-11-23"]);
  assert.equal(r.daily["2026-11-16"], 10); // 2+3+5
  assert.equal(r.daily["2026-11-23"], 7);
});

test("month 粒度重分桶：跨月分离", () => {
  const dates = ["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"];
  const daily = { "2026-10-30": 1, "2026-10-31": 2, "2026-11-01": 4, "2026-11-02": 8 };
  const r = regroupSellfoxDaily(daily, dates, "month");
  assert.deepEqual(r.buckets, ["2026-10-01", "2026-11-01"]);
  assert.equal(r.daily["2026-10-01"], 3);
  assert.equal(r.daily["2026-11-01"], 12);
});

test("分桶缺日不补零：桶内任一业务日缺值/为null，整桶为 null（禁 COALESCE 0）", () => {
  const dates = ["2026-11-16", "2026-11-17", "2026-11-18"];
  // 11-17 缺失 -> 整周桶必须 null，不得用 2+4=6 冒充
  assert.equal(regroupSellfoxDaily({ "2026-11-16": 2, "2026-11-18": 4 }, dates, "week").daily["2026-11-16"], null);
  // 显式 null 同样判缺
  assert.equal(regroupSellfoxDaily({ "2026-11-16": 2, "2026-11-17": null, "2026-11-18": 4 }, dates, "week").daily["2026-11-16"], null);
  // 字符串数值被安全转换
  assert.equal(regroupSellfoxDaily({ "2026-11-16": "2", "2026-11-17": "3", "2026-11-18": "4" }, dates, "week").daily["2026-11-16"], 9);
  // NaN/垃圾值判缺，不污染求和
  assert.equal(regroupSellfoxDaily({ "2026-11-16": 2, "2026-11-17": "x", "2026-11-18": 4 }, dates, "week").daily["2026-11-16"], null);
});

test("summary.daily 分桶：value 缺日不补零，entities 取桶内最大值不重复累加", () => {
  const dates = ["2026-11-16", "2026-11-17", "2026-11-18"]; // 同一周
  const summary = {
    "2026-11-16": { value: 2, entities: 5 },
    "2026-11-17": { value: 3, entities: 8 },
    "2026-11-18": { value: 4, entities: 6 },
  };
  const r = regroupSellfoxSummaryDaily(summary, dates, "week");
  assert.deepEqual(r["2026-11-16"], { value: 9, entities: 8 }); // value 求和, entities 取 max
  // 缺一日 -> value null（不补零），entities 仍取已观测最大值
  const partial = { "2026-11-16": { value: 2, entities: 5 }, "2026-11-18": { value: 4, entities: 6 } };
  assert.deepEqual(regroupSellfoxSummaryDaily(partial, dates, "week")["2026-11-16"], { value: null, entities: 6 });
  // day 粒度原样返回
  assert.deepEqual(regroupSellfoxSummaryDaily(summary, dates, "day"), summary);
});

test("星期分布列：仅 grain=day 且 ≤62 天生成，按 UTC dow 聚合，缺日不补零", () => {
  // 2026-11-16 周一 dow=1; 11-17 周二 dow=2; 11-23 周一 dow=1
  const dates = ["2026-11-16", "2026-11-17", "2026-11-23"];
  const daily = { "2026-11-16": 2, "2026-11-17": 3, "2026-11-23": 5 };
  const dow = sellfoxWeekdayColumns(daily, dates, "day");
  assert.ok(dow);
  assert.equal(dow!["dow1"], 7); // 两个周一 2+5
  assert.equal(dow!["dow2"], 3);
  assert.equal(dow!["dow0"], null); // 无周日业务日 -> null 而非 0
  // week/month 粒度不生成
  assert.equal(sellfoxWeekdayColumns(daily, dates, "week"), null);
  assert.equal(sellfoxWeekdayColumns(daily, dates, "month"), null);
  // >62 天不生成（防列爆炸）
  const long = Array.from({ length: 63 }, (_, i) => `2026-01-${String(i + 1).padStart(2, "0")}`);
  assert.equal(sellfoxWeekdayColumns({}, long, "day"), null);
  // 缺该星期任一业务日 -> null
  assert.equal(sellfoxWeekdayColumns({ "2026-11-16": 2 }, dates, "day")!["dow1"], null);
});

test("grain URL 往返：仅 sales 非 day 写出，读回一致", () => {
  const view = { ...readSellfoxView(new URLSearchParams()), domain: "sales" as const, grain: "week" as const };
  const params = sellfoxViewParams(view);
  assert.equal(params.get("grain"), "week");
  const back = readSellfoxView(params);
  assert.equal(back.grain, "week");
  // 请求参数（forRequest）不写 grain 展示态时也不影响解析
  assert.equal(readSellfoxView(new URLSearchParams("domain=sales&grain=month")).grain, "month");
});
