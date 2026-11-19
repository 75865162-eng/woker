import assert from "node:assert/strict";
import test from "node:test";
import { sellfoxKnownEndpoints } from "../src/lib/sellfox/known-endpoints";

/**
 * 结算中心 V2 两条通用端点种子的契约校验。
 * 契约来源：docs/sellfox-api-docs/API.md 的 api-399397941（明细）/ api-399397942（汇总），
 * 2026-11-19 逐字段核对，路径、参数、rowsPath、唯一键均来自文档，未猜测。
 */
const seeds = () => sellfoxKnownEndpoints();
const find = (code: string) => {
  const seed = seeds().find((item) => item.code === code);
  assert.ok(seed, `缺少种子 ${code}`);
  return seed!;
};

test("结算明细 V2 种子路径与真实文档一致", () => {
  const seed = find("fin_settlement_detail_v2");
  assert.equal(seed.path, "/api/financial/v2/settlementSummary/detailPage.json");
  assert.equal(seed.dateMode, "range");
  assert.equal(seed.scopeMode, "store");
  assert.equal(seed.dateFormat, "yyyy-MM-dd");
  assert.equal(seed.rowsPath, "detailPageVoList", "sellfoxPost 已解包 payload.data，行键在顶层");
  assert.equal(seed.idFields, "id");
  assert.equal(seed.deprecated, undefined, "V2 接口未标注下线，不应带 deprecated");
});

test("结算明细 V2 参数模板覆盖文档必填与店铺/日期/分页占位符", () => {
  const params = JSON.parse(find("fin_settlement_detail_v2").params);
  assert.equal(params.startTime, "${startDate}", "文档必填 startTime");
  assert.equal(params.endTime, "${endDate}", "文档必填 endTime");
  assert.deepEqual(params.shopIds, ["${shopIdNumeric}"], "文档 shopIds 为 int32 店铺 ID");
  assert.equal(params.pageNo, "${pageNo}");
  assert.equal(params.pageSize, "${pageSize}");
});

test("结算汇总 V2 种子路径与真实文档一致", () => {
  const seed = find("fin_settlement_summary_v2");
  assert.equal(seed.path, "/api/financial/v2/settlementSummary/groupPage.json");
  assert.equal(seed.dateMode, "range");
  assert.equal(seed.scopeMode, "store");
  assert.equal(seed.dateFormat, "yyyy-MM-dd");
  assert.equal(seed.rowsPath, "groupVoList", "sellfoxPost 已解包 payload.data，行键在顶层");
  assert.equal(seed.idFields, "groupId");
});

test("结算汇总 V2 参数模板带文档必填 timeType", () => {
  const params = JSON.parse(find("fin_settlement_summary_v2").params);
  assert.equal(params.timeType, "settlementStartTime", "文档必填 timeType");
  assert.equal(params.startTime, "${startDate}");
  assert.equal(params.endTime, "${endDate}");
  assert.deepEqual(params.shopIds, ["${shopIdNumeric}"]);
});

test("两条结算 V2 种子默认不老化和下线接口冲突，且 code 唯一", () => {
  const all = seeds();
  const codes = all.map((item) => item.code);
  assert.equal(new Set(codes).size, codes.length, "种子 code 必须唯一");
  for (const code of ["fin_settlement_detail_v2", "fin_settlement_summary_v2"]) {
    assert.ok(all.find((item) => item.code === code));
  }
  // 老的 fin_settlement_overview 仍保留 deprecated 标记，不与 V2 混淆
  assert.equal(find("fin_settlement_overview").deprecated, true);
});
