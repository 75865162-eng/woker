import { createHash } from 'node:crypto';

/** 财务 BI 异常检测内核（报告3 P3-4）：识别费用漏算/成本异常/对账差异。
 * 红线：规则阈值显式配置；每条异常带证据与可追溯规则；不自动修正账目；缺数据标 NEEDS_DATA 而非臆断。 */
const S = 1_000_000n;
export type AnomalyError = Error & { code: string };
function fail(code: string, msg: string): never { const e = new Error(msg) as AnomalyError; e.code = code; throw e; }
function dec(v: unknown, label: string): bigint {
  if (typeof v !== 'string' || !/^-?\d+(\.\d{1,6})?$/.test(v.trim())) fail('INVALID_AMOUNT', `${label} 须为定点字符串`);
  const neg = v.trim().startsWith('-'), [i, f = ''] = v.trim().replace('-', '').split('.');
  const x = BigInt(i) * S + BigInt(f.padEnd(6, '0')); return neg ? -x : x;
}
const fmt = (v: bigint) => { const neg = v < 0n, a = neg ? -v : v; return `${neg ? '-' : ''}${a / S}.${(a % S).toString().padStart(6, '0')}`; };

export type CostObservation = { sku: string; period: string; unitCost: string; currency: string; evidenceId: string };
export type FeeObservation = { scope: string; period: string; category: string; amount: string | null; expected: boolean; evidenceId: string | null };

export type Thresholds = {
  costDeviationBp: number;   // 单位成本偏离中位数超阈值（万分之一）告警，如 3000 = 30%
  minSamples: number;        // 判定成本异常所需最小样本数
};

export function detectFinanceAnomalies(input: {
  thresholds: Thresholds;
  costs: readonly CostObservation[];
  fees: readonly FeeObservation[];
  reconciliationGaps: readonly { key: string; amount: string; currency: string; evidenceId: string }[];
}) {
  const t = input.thresholds;
  if (!Number.isInteger(t.costDeviationBp) || t.costDeviationBp < 0 || t.costDeviationBp > 10000) fail('INVALID_THRESHOLD', '成本偏离阈值须为 0–10000 bp');
  if (!Number.isInteger(t.minSamples) || t.minSamples < 2) fail('INVALID_THRESHOLD', '最小样本数须 ≥2');
  const anomalies: { code: string; severity: 'HIGH' | 'MEDIUM' | 'LOW'; scope: string; detail: string; evidenceId: string; rule: string }[] = [];
  const needsData: string[] = [];

  // 规则1：费用漏算——expected 且金额缺失/无依据
  for (const fee of input.fees) {
    if (fee.expected && (fee.amount === null || !fee.evidenceId)) {
      anomalies.push({ code: 'FEE_MISSING', severity: 'HIGH', scope: `${fee.scope}|${fee.period}|${fee.category}`,
        detail: '应计费用缺失或无依据，可能低估利润', evidenceId: fee.evidenceId ?? '', rule: 'R1_FEE_COMPLETENESS' });
    }
  }
  // 规则2：成本异常——按 (sku,currency) 分组，单位成本偏离中位数超阈值
  const groups = new Map<string, CostObservation[]>();
  for (const c of input.costs) { const k = `${c.sku}|${c.currency}`; groups.set(k, [...(groups.get(k) ?? []), c]); }
  for (const [key, rows] of groups) {
    if (rows.length < t.minSamples) { needsData.push(`cost:${key}:样本不足`); continue; }
    const vals = rows.map(r => dec(r.unitCost, 'unitCost')).sort((a, b) => a > b ? 1 : a < b ? -1 : 0);
    const mid = vals[Math.floor(vals.length / 2)];
    if (mid === 0n) { needsData.push(`cost:${key}:中位数为0`); continue; }
    for (const r of rows) {
      const v = dec(r.unitCost, 'unitCost');
      const devBp = Number((v - mid > 0n ? v - mid : mid - v) * 10000n / (mid > 0n ? mid : -mid));
      if (devBp > t.costDeviationBp) {
        anomalies.push({ code: 'COST_OUTLIER', severity: devBp > t.costDeviationBp * 2 ? 'HIGH' : 'MEDIUM',
          scope: `${key}|${r.period}`, detail: `单位成本偏离中位数 ${devBp}bp（阈值 ${t.costDeviationBp}bp）`,
          evidenceId: r.evidenceId, rule: 'R2_COST_DEVIATION' });
      }
    }
  }
  // 规则3：对账差异——显式列出，不自动核销
  for (const g of input.reconciliationGaps) {
    anomalies.push({ code: 'RECON_GAP', severity: 'MEDIUM', scope: g.key,
      detail: `对账差异 ${fmt(dec(g.amount, 'gap'))} ${g.currency}，需人工核对`, evidenceId: g.evidenceId, rule: 'R3_RECONCILIATION' });
  }
  const digest = createHash('sha256').update(JSON.stringify(anomalies.map(a => [a.code, a.scope, a.detail]))).digest('hex');
  return {
    status: needsData.length && anomalies.length === 0 ? 'NEEDS_DATA' as const : 'ANALYZED' as const,
    anomalies: anomalies.sort((a, b) => a.code.localeCompare(b.code)),
    needsData, digest, rules: ['R1_FEE_COMPLETENESS', 'R2_COST_DEVIATION', 'R3_RECONCILIATION'],
    autoCorrected: 0, // 红线：从不自动修正
  };
}
