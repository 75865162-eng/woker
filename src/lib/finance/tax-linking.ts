import { createHash } from 'node:crypto';

/** 财税联动内核（报告3 P3-2）：涉税费用溯源 + 纳税期↔总账凭证勾稽 + 多主体利润划分。
 * 红线：不臆造税额；勾稽差额显式列出；多主体划分权重须显式且合计=1；不跨币种混算。 */
const S = 1_000_000n, Z = 0n;
export type TaxLinkError = Error & { code: string };
function fail(code: string, msg: string): never { const e = new Error(msg) as TaxLinkError; e.code = code; throw e; }
function dec(v: unknown, label: string): bigint {
  if (typeof v !== 'string' || !/^-?\d+(\.\d{1,6})?$/.test(v.trim())) fail('INVALID_AMOUNT', `${label} 须为 6 位定点字符串`);
  const neg = v.trim().startsWith('-'), [i, f = ''] = v.trim().replace('-', '').split('.');
  const x = BigInt(i) * S + BigInt(f.padEnd(6, '0')); return neg ? -x : x;
}
const fmt = (v: bigint) => { const neg = v < Z, a = neg ? -v : v; return `${neg ? '-' : ''}${a / S}.${(a % S).toString().padStart(6, '0')}`; };

/** 涉税费用溯源条目：18+ 费用类型 → 凭证行 → 依据。缺凭证/依据则不视为可抵扣，绝不默认计入。 */
export type TaxTraceItem = {
  feeType: string; currency: string; amount: string;
  voucherLineId: string | null; evidenceId: string | null; deductionEligible: boolean;
};
export type LedgerTaxLine = { subjectCode: string; currency: string; amount: string; voucherId: string; period: string };
export type EntityShare = { entityId: string; weight: string };

export function linkTaxToLedger(input: {
  period: string; currency: string;
  traces: readonly TaxTraceItem[];
  ledgerLines: readonly LedgerTaxLine[];
  entities: readonly EntityShare[];
  profitAmount: string;
}) {
  if (!/^\d{4}-\d{2}$/.test(input.period)) fail('INVALID_PERIOD', '纳税期须为 YYYY-MM');
  if (!/^[A-Z]{3}$/.test(input.currency)) fail('INVALID_CURRENCY', '币种无效');
  // 币种隔离：仅纳入同币种记录，跨币种记录显式排除
  const crossCurrency = [
    ...input.traces.filter(t => t.currency !== input.currency).map(t => `trace:${t.feeType}`),
    ...input.ledgerLines.filter(l => l.currency !== input.currency).map(l => `ledger:${l.voucherId}`),
  ];
  const traces = input.traces.filter(t => t.currency === input.currency);
  const ledger = input.ledgerLines.filter(l => l.currency === input.currency && l.period === input.period);
  // 溯源缺口：可抵扣但缺凭证行/依据 → 阻断，不臆造抵扣
  const blocked = traces.filter(t => t.deductionEligible && (!t.voucherLineId || !t.evidenceId)).map(t => t.feeType);
  const traceTotal = traces.filter(t => t.deductionEligible && t.voucherLineId && t.evidenceId)
    .reduce((s, t) => s + dec(t.amount, t.feeType), Z);
  const ledgerTotal = ledger.reduce((s, l) => s + dec(l.amount, l.subjectCode), Z);
  const diff = traceTotal - ledgerTotal;
  const reconciled = blocked.length === 0 && diff === Z && crossCurrency.length === 0;
  // 多主体利润划分：权重显式且合计=1（1.000000）
  const weightSum = input.entities.reduce((s, e) => s + dec(e.weight, `weight:${e.entityId}`), Z);
  if (weightSum !== S) fail('WEIGHT_SUM', `主体利润划分权重合计须为 1.000000，实际 ${fmt(weightSum)}`);
  const profit = dec(input.profitAmount, 'profitAmount');
  const shares = input.entities.map((e, idx) => {
    const w = dec(e.weight, `weight:${e.entityId}`);
    const amt = profit * w / S;
    return { entityId: e.entityId, weight: fmt(w), amount: fmt(amt) };
  });
  // 尾差归最后一主体（沿用水位尾差红线，保证合计精确）
  const allocated = shares.reduce((s, x) => s + dec(x.amount, 'share'), Z);
  const residual = profit - allocated;
  if (residual !== Z && shares.length) shares[shares.length - 1].amount = fmt(dec(shares[shares.length - 1].amount, 'share') + residual);
  const digest = createHash('sha256').update(JSON.stringify({
    period: input.period, currency: input.currency, traceTotal: fmt(traceTotal),
    ledgerTotal: fmt(ledgerTotal), entities: shares,
  })).digest('hex');
  return {
    status: reconciled ? 'RECONCILED' as const : 'NEEDS_DATA' as const,
    period: input.period, currency: input.currency,
    traceTotal: fmt(traceTotal), ledgerTotal: fmt(ledgerTotal), difference: fmt(diff),
    blockedDeductions: blocked, crossCurrencyExcluded: crossCurrency,
    profitShares: shares, digest,
  };
}
