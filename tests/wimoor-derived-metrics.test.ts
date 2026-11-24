import assert from "node:assert/strict";
import test from "node:test";
import {
  buildAdsMetrics,
  buildProfitMetrics,
  WIMOOR_ACOS_SENTINEL,
  ADS_METRIC_BASIS,
  PROFIT_METRIC_BASIS,
} from "../src/lib/amazon-sync/wimoor-derived-metrics";

// ===== 广告派生（Wimoor Mapper.xml:211-221）=====

test("广告：CTR/avgcost/ROAS/CSRT 按 Wimoor 公式计算", () => {
  const m = buildAdsMetrics({ cost: 10, clicks: 5, impressions: 100, attributedSales7d: 50, attributedConversions7d: 2 });
  assert.equal(m.CTR, "0.05");        // 5/100
  assert.equal(m.avgcost, "2");       // 10/5
  assert.equal(m.ROAS, "5");          // 50/10
  assert.equal(m.CSRT, "0.4");        // 2/5
  assert.equal(m.ACOS, "0.2");        // 10/50
  assert.equal(m.acosSpecial, false);
});

test("广告：ACOS 特殊分支——cost>0 且 sales=0 走 Wimoor 哨兵值", () => {
  const m = buildAdsMetrics({ cost: 3, clicks: 2, impressions: 10, attributedSales7d: 0, attributedConversions7d: 0 });
  assert.equal(m.ACOS, String(WIMOOR_ACOS_SENTINEL));
  assert.equal(m.acosSpecial, true);
});

test("广告：分母为 0 时各比率返回 null，不臆造（cost=0 不触发 ACOS 哨兵）", () => {
  const m = buildAdsMetrics({ cost: 0, clicks: 0, impressions: 0, attributedSales7d: 0, attributedConversions7d: 0 });
  assert.equal(m.CTR, null);
  assert.equal(m.avgcost, null);
  assert.equal(m.ROAS, null);
  assert.equal(m.CSRT, null);
  assert.equal(m.ACOS, null);
  assert.equal(m.acosSpecial, false, "cost=0 不应触发 Wimoor 哨兵分支");
});

test("广告：字符串数字与无效值健壮处理", () => {
  const m = buildAdsMetrics({ cost: "10.5", clicks: "3", impressions: "abc", attributedSales7d: "21", attributedConversions7d: "1" });
  assert.equal(m.avgcost, "3.5");
  assert.equal(m.CTR, null, "无效展示数按 0 → 分母 0 → null");
  assert.equal(m.ROAS, "2");
});

test("广告：口径来源标注齐全（含 ACOS 特殊分支说明）", () => {
  const keys = ["CTR", "avgcost", "ACOS", "ROAS", "CSRT"] as const;
  for (const k of keys) {
    assert.ok(ADS_METRIC_BASIS[k].formula.length > 0);
    assert.ok(ADS_METRIC_BASIS[k].source.includes("Mapper.xml"));
  }
  assert.ok(ADS_METRIC_BASIS.ACOS.specialCase?.includes("10000000000"));
});

// ===== 利润派生（Wimoor ServiceImpl:1739-1762）=====

test("利润：setincome = 8 类之和（Wimoor Mapper.xml:298-300）", () => {
  const m = buildProfitMetrics({ principal: 100, commission: 5, fbafee: 3, refund: -2, otherfee: 1, tax: 0.5, shipping: 2, promotion: 1.5 });
  assert.equal(m.setincome, "111"); // 100+5+3-2+1+0.5+2+1.5
});

test("利润：扣减项逐项扣减，退税为加项", () => {
  const m = buildProfitMetrics(
    { principal: 100 },
    { local_price: 20, profit_vat: 5, local_return_tax: 2 },
    { salenum: 10, ordernum: 4, refundorder: 1 },
  );
  // setincome=100; profit=100 +2(退税) -20 -5 = 77
  assert.equal(m.profit, "77");
  assert.equal(m.profitrate, "0.77");       // HALF_UP 2 位
  assert.equal(m.avgprice, "10");           // 100/10
  assert.equal(m.refundrate, "0.25");       // 1/4
});

test("利润：未传入的扣减项列入 missingDeductions（诚实标注，不静默补0）", () => {
  const m = buildProfitMetrics({ principal: 100 }, { local_price: 20 });
  assert.ok(m.missingDeductions.includes("profit_vat"));
  assert.ok(m.missingDeductions.includes("profit_exchangelost"));
  assert.ok(m.missingDeductions.includes("profit_companytax"));
  assert.ok(!m.missingDeductions.includes("local_price"), "已传入的项不应列入缺失");
  assert.equal(m.profit, "80", "只对传入项扣减");
});

test("利润：principal=0 时 profitrate 为 null；salenum=0 时 avgprice=0（Wimoor 口径）", () => {
  const m = buildProfitMetrics({ principal: 0 }, {}, { salenum: 0, ordernum: 0 });
  assert.equal(m.profitrate, null);
  assert.equal(m.avgprice, "0");
  assert.equal(m.refundrate, null);
});

test("利润：HALF_UP 2 位精度（0.005 进位）", () => {
  const m = buildProfitMetrics({ principal: 1000 }, {}, { salenum: 1, ordernum: 200, refundorder: 1 });
  // profit=1000, profitrate=1; refundrate=1/200=0.005 → HALF_UP → 0.01
  assert.equal(m.refundrate, "0.01");
});

test("利润：口径来源标注齐全", () => {
  assert.ok(PROFIT_METRIC_BASIS.formula.includes("setincome"));
  assert.ok(PROFIT_METRIC_BASIS.source.includes("handlerSettlementSKURowData"));
});
