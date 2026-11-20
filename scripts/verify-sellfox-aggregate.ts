/**
 * 赛狐聚合口径离线校验（只读，不连库、不猜字段、不造数）。
 *
 * 依据 v4 M2 验收：同一筛选下「维度明细之和 = 汇总行」；跨币种不相加；缺日不补 0；
 * 周/月按 ISO 桶重采样不串周。本脚本用固定样例调用生产纯函数（browse-grain）与
 * 字段契约（field-registry），把五条铁律变成可重复执行的断言。
 *
 * 用法：
 *   node --import ./scripts/runtime/database-bootstrap.mjs \
 *     node_modules/tsx/dist/cli.mjs scripts/verify-sellfox-aggregate.ts
 * 通过输出 VERIFY_OK；任一断言失败抛错并以非零码退出。
 */
import assert from "node:assert/strict";
import {
  regroupSellfoxDaily, regroupSellfoxSummaryDaily, sellfoxBucketKey, sellfoxIsoMonday,
} from "@/lib/sellfox/browse-grain";
import { SELLFOX_FIELD_CONTRACTS, sellfoxField } from "@/lib/sellfox/field-registry";

function main() {
  // 1) 日明细之和 = 汇总；缺日不补 0（桶内缺任一业务日则整桶 null）。
  const dates = ["2026-01-05", "2026-01-06", "2026-01-07", "2026-01-08"];
  const daily = { "2026-01-05": 3, "2026-01-06": 2, "2026-01-07": 5, "2026-01-08": 4 };
  const day = regroupSellfoxDaily(daily, dates, "day");
  assert.equal(Object.values(day.daily).reduce<number>((sum, v) => sum + (v ?? 0), 0), 14, "日明细之和必须等于汇总");
  const missing = regroupSellfoxDaily({ "2026-01-05": 3, "2026-01-06": 2 }, dates, "day");
  assert.equal(missing.daily["2026-01-07"], null, "缺日必须为 null，不补 0");

  // 2) ISO 周跨年不串周：同一 ISO 周映射到唯一周一。
  assert.equal(sellfoxIsoMonday("2026-01-01"), "2025-12-29");
  assert.equal(sellfoxIsoMonday("2026-01-04"), "2025-12-29");
  assert.equal(sellfoxBucketKey("2026-01-01", "week"), "2025-12-29");
  assert.equal(sellfoxBucketKey("2026-01-31", "month"), "2026-01-01");
  const week = regroupSellfoxDaily(daily, dates, "week");
  assert.equal(week.daily["2026-01-05"], 14, "周桶内四日齐全应求和");

  // 3) summary.daily 重采样：value 桶内求和，entities 取桶内最大不累加。
  const summaryDaily = {
    "2026-01-05": { value: 3, entities: 10 },
    "2026-01-06": { value: 2, entities: 12 },
  };
  const regrouped = regroupSellfoxSummaryDaily(summaryDaily, dates, "week");
  const w = regrouped[sellfoxBucketKey("2026-01-05", "week")];
  assert.equal(w.value, null, "summary 桶内缺业务日则 value 为 null");
  assert.equal(w.entities, 12, "entities 取桶内最大值，不跨日累加");

  // 4) 跨币种不相加：金额/售价字段必须标 currencyScoped。
  for (const key of ["mskuPrice", "revenue", "subtotal"]) {
    assert.equal(sellfoxField(key)?.currencyScoped, true, `${key} 必须标 currencyScoped，禁止跨币种相加`);
  }

  // 5) 不造数：所有 NEEDS_DATA 字段禁用且无表列；业务员不作维度。
  for (const field of SELLFOX_FIELD_CONTRACTS.filter((f) => f.needsData)) {
    assert.equal(field.enabled, false, `${field.key} NEEDS_DATA 不可启用`);
    assert.equal(field.table, null, `${field.key} NEEDS_DATA 不可声明表`);
  }
  assert.equal(sellfoxField("salesperson")?.enabled, false, "业务员不可作为可切维度（无单值落点）");

  console.log("VERIFY_OK 赛狐聚合口径校验通过：明细=汇总、缺日不补零、ISO 周不串周、跨币种不相加、不造数");
}
main();
