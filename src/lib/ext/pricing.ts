import {
  priceForMargin,
  quoteFbaFee,
  quoteProfit,
  requireInt,
  requireMoney,
  type FeeInput,
  type ProfitInput,
} from './rules';

export const moneyInput = (row: Record<string, unknown>, key: string, label: string, options?: { min?: number }) =>
  requireMoney(row[key], label, options);

function feeInputFrom(row: Record<string, unknown>): FeeInput {
  return {
    price: moneyInput(row, 'price', '售价'),
    shipping: moneyInput(row, 'shipping', '买家运费'),
    weightOz: requireMoney(row.weightOz, '单件重量（oz）'),
    lengthIn: requireMoney(row.lengthIn, '长度（in）'),
    widthIn: requireMoney(row.widthIn, '宽度（in）'),
    heightIn: requireMoney(row.heightIn, '高度（in）'),
    oversize: row.oversize === true || row.oversize === 'true',
    referralRateBp: row.referralRateBp === undefined || row.referralRateBp === '' ? undefined : requireInt(row.referralRateBp, '佣金比例（万分比）', { max: 10_000 }),
    storageDays: row.storageDays === undefined || row.storageDays === '' ? 30 : requireInt(row.storageDays, '仓储天数', { max: 365 }),
  };
}

function profitInputFrom(row: Record<string, unknown>): ProfitInput {
  return {
    ...feeInputFrom(row),
    unitCost: moneyInput(row, 'unitCost', '采购成本'),
    inboundCost: moneyInput(row, 'inboundCost', '头程成本'),
    adCost: moneyInput(row, 'adCost', '广告费'),
    otherCost: moneyInput(row, 'otherCost', '其它费用'),
    returnRateBp: row.returnRateBp === undefined || row.returnRateBp === '' ? 0 : requireInt(row.returnRateBp, '退货率（万分比）', { max: 10_000 }),
  };
}

export function quoteOnly(kind: string, body: Record<string, unknown>) {
  if (kind === 'fee') return quoteFbaFee(feeInputFrom(body));
  const input = profitInputFrom(body);
  const result = quoteProfit(input);
  const targetMarginBp = requireInt(body.targetMarginBp ?? 2000, '目标毛利率（万分比）', { max: 9000 });
  return { ...result, targetMarginBp, targetPrice: priceForMargin(input, targetMarginBp) };
}
