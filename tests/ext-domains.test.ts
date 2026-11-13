import assert from 'node:assert/strict';
import test from 'node:test';
import {
  cheapestQuotation, defaultRateCard, forecastQty, parseExchangeLines, performanceVerdict,
  priceForMargin, quoteFbaFee, quoteProfit, sentimentOf, suggestPrice, taxAmountOf, taxPeriodOf,
} from '../src/lib/ext/rules';

const baseFee = {
  price: 29.99, shipping: 0, weightOz: 12, lengthIn: 10, widthIn: 8, heightIn: 2, oversize: false,
};
const baseProfit = { ...baseFee, unitCost: 6.5, inboundCost: 1.2, adCost: 2, otherCost: 0.4, returnRateBp: 300 };

test('FBA 费用：佣金按比例且不低于最低佣金，费用合计等于各项之和', () => {
  const result = quoteFbaFee(baseFee);
  assert.equal(result.revenue, 29.99);
  assert.equal(result.referralFee, 4.4985);
  // 体积重 10×8×2/139×16 ≈ 18.4oz 高于实重 12oz，按 19oz 计费：16oz 档 3.33 + 1 个 4oz 步长 0.08
  assert.equal(result.billableWeightOz, 19);
  assert.equal(result.fulfillmentFee, 3.41);
  assert.equal(result.totalFee, Math.round((result.referralFee + result.fulfillmentFee + result.storageFee) * 1e6) / 1e6);
  assert.equal(result.netProceeds, Math.round((result.revenue - result.totalFee) * 1e6) / 1e6);
  assert.equal(result.sizeTier, 'STANDARD');
});

test('FBA 费用：低价单触发最低佣金，大件走大件费率并按体积重计费', () => {
  const cheap = quoteFbaFee({ ...baseFee, price: 1 });
  assert.equal(cheap.referralFee, defaultRateCard.minReferral);
  const oversize = quoteFbaFee({ ...baseFee, oversize: true, weightOz: 320, lengthIn: 40, widthIn: 30, heightIn: 20 });
  assert.equal(oversize.sizeTier, 'OVERSIZE');
  assert.ok(oversize.dimensionalWeightOz > 0);
  assert.ok(oversize.fulfillmentFee > defaultRateCard.oversizeBase);
});

test('利润测算：净利、毛利率、ROI 与保本价口径一致', () => {
  const result = quoteProfit(baseProfit);
  const expectedProfit = Math.round((result.netProceeds - result.costTotal - Math.round(result.netProceeds * 0.03 * 1e6) / 1e6) * 1e6) / 1e6;
  assert.equal(result.profit, expectedProfit);
  assert.equal(result.costTotal, 10.1);
  assert.equal(result.marginBp, Math.round((result.profit / result.revenue) * 10_000));
  assert.equal(result.roiBp, Math.round((result.profit / result.costTotal) * 10_000));
  assert.ok(result.breakevenPrice > 0);
});

test('按目标毛利率反算售价：反算价代入后毛利率不低于目标', () => {
  const target = priceForMargin(baseProfit, 2000);
  const check = quoteProfit({ ...baseProfit, price: target, shipping: 0 });
  assert.ok(target > 0);
  assert.ok(check.marginBp >= 1990, `实际毛利率 ${check.marginBp} 应接近 2000`);
});

test('评论情绪按星级归档', () => {
  assert.equal(sentimentOf(5), 'POSITIVE');
  assert.equal(sentimentOf(4), 'POSITIVE');
  assert.equal(sentimentOf(3), 'NEUTRAL');
  assert.equal(sentimentOf(1), 'NEGATIVE');
});

test('绩效判定：超阈值要列出来，未超阈值全部达标', () => {
  const ok = performanceVerdict({ totalOrders: 100, orderDefectRateBp: 50, lateShipmentRateBp: 100, cancellationRateBp: 100, validTrackingRateBp: 9900, negativeFeedbackRateBp: 20 });
  assert.equal(ok.ok, true);
  const bad = performanceVerdict({ totalOrders: 100, orderDefectRateBp: 150, lateShipmentRateBp: 500, cancellationRateBp: 300, validTrackingRateBp: 9000, negativeFeedbackRateBp: 200 });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.breached, ['订单缺陷率', '迟发率', '取消率', '有效追踪率', '差评率']);
});

test('调价建议：不破地板价、不越天花板、盯住竞争价', () => {
  const rule = { strategy: 'MATCH_LOWEST' as const, floorPrice: 10, ceilingPrice: 30, stepAmount: 0.01, minMarginBp: 0 };
  const matched = suggestPrice({ myPrice: 25, buyBoxPrice: 24, lowestCompetitorPrice: 20, rule });
  assert.equal(matched.price, 20);
  assert.equal(matched.blocked, false);
  const floored = suggestPrice({ myPrice: 25, buyBoxPrice: 24, lowestCompetitorPrice: 5, rule });
  assert.equal(floored.price, 10);
  assert.equal(floored.blocked, true);
  const ceiling = suggestPrice({ myPrice: 25, buyBoxPrice: 24, lowestCompetitorPrice: 40, rule });
  assert.equal(ceiling.price, 30);
  const margin = suggestPrice({ myPrice: 25, buyBoxPrice: 24, lowestCompetitorPrice: 8, rule: { ...rule, minMarginBp: 3000 }, unitCost: 7 });
  assert.equal(margin.price, 10);
});

test('调价建议：低于最低价一个步长时不允许负价', () => {
  const result = suggestPrice({ myPrice: 5, buyBoxPrice: 5, lowestCompetitorPrice: 0.005, rule: { strategy: 'BEAT_LOWEST', floorPrice: 0, ceilingPrice: 10, stepAmount: 0.01, minMarginBp: 0 } });
  assert.ok(result.price >= 0);
});

test('销售预测：日均 × 天数 × 季节系数，向下取整', () => {
  assert.equal(forecastQty(10, 30, 10_000), 300);
  assert.equal(forecastQty(10, 30, 12_000), 360);
  assert.equal(forecastQty(0, 30), 0);
  assert.equal(forecastQty(10, 0), 0);
});

test('税务：税额按万分比换算，申报期取自然月', () => {
  assert.equal(taxAmountOf(1000, 1900), 190);
  assert.equal(taxAmountOf(100, 700), 7);
  assert.equal(taxPeriodOf(new Date('2026-11-13T00:00:00Z')), '2026-11');
});

test('换货明细必须带 SKU 与正整数数量', () => {
  const lines = parseExchangeLines([{ sellerSku: ' A-1 ', quantity: 2, replacementQty: 2, note: '破损' }]);
  assert.deepEqual(lines, [{ sellerSku: 'A-1', quantity: 2, replacementQty: 2, note: '破损' }]);
  assert.throws(() => parseExchangeLines([]), /至少/);
  assert.throws(() => parseExchangeLines([{ quantity: 1 }]), /SKU/);
  assert.throws(() => parseExchangeLines([{ sellerSku: 'A', quantity: 0 }]), /换货数量/);
});

test('报价比价：单价最低优先，同价取交期短', () => {
  const best = cheapestQuotation([
    { id: 'a', unitPrice: 12, leadTimeDays: 20 },
    { id: 'b', unitPrice: 11, leadTimeDays: 30 },
    { id: 'c', unitPrice: 11, leadTimeDays: 12 },
  ]);
  assert.equal(best?.id, 'c');
  assert.equal(cheapestQuotation([]), null);
});
