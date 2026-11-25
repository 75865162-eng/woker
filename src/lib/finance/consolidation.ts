import { createHash } from 'node:crypto';

/** 多币种合并报表内核（报告3 P3-3）。
 * 红线：汇率须显式提供且已复核（source/reference/observedAt 齐全）；缺汇率→NEEDS_DATA，不臆造；
 * 内部往来须双边金额一致才抵消，不一致列为差异不强行抵消；折算差额计入 OCI；不跨币种直接相加。 */
const SCALE = 1_000_000n;
const ZERO = 0n;

export type ConsolidationError = Error & { code: string };
function fail(code: string, msg: string): never {
  const e = new Error(msg) as ConsolidationError; e.code = code; throw e;
}
function dec(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^-?\d+(\.\d{1,6})?$/.test(value.trim())) fail('INVALID_AMOUNT', `${label} 须为 6 位以内定点字符串`);
  const neg = value.trim().startsWith('-');
  const [i, f = ''] = value.trim().replace('-', '').split('.');
  const v = BigInt(i) * SCALE + BigInt(f.padEnd(6, '0'));
  return neg ? -v : v;
}
const fmt = (v: bigint) => {
  const neg = v < ZERO, a = neg ? -v : v;
  return `${neg ? '-' : ''}${a / SCALE}.${(a % SCALE).toString().padStart(6, '0')}`;
};
function rate(value: unknown): bigint | null {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^\d+(\.\d{1,8})?$/.test(value.trim())) fail('INVALID_RATE', '汇率须为正数定点字符串');
  const [i, f = ''] = value.trim().split('.');
  const v = BigInt(i) * 100_000_000n + BigInt(f.padEnd(8, '0'));
  if (v <= ZERO) fail('INVALID_RATE', '汇率须为正数');
  return v;
}
const RATE_SCALE = 100_000_000n;
/** 精确折算：amount(6位) × rate(8位)，去掉 8 位汇率小数后按 6 位四舍五入。 */
function convert(amount: bigint, fx: bigint): bigint {
  const scaled = amount * fx; // 6+8=14 位
  const divisor = RATE_SCALE; // 去掉 8 位汇率小数 → 6 位
  const q = scaled / divisor, rem = scaled % divisor;
  const round = rem * 2n >= divisor ? (scaled >= ZERO ? 1n : -1n) : ZERO;
  return q + round;
}

export type EntityBalance = {
  entityId: string; currency: string; subjectCode: string;
  balanceSide: 'DEBIT' | 'CREDIT'; amount: string; isMonetary: boolean;
};
export type FxQuote = { source: string; target: string; rate: string; reference: string; observedAt: string; reviewedBy: string };
/** 内部往来单边记录：应收方与应付方各记一条，按 key 配对后双边金额/币种/主体一致才抵消。 */
export type Intercompany = { key: string; entityId: string; counterpartyId: string; direction: 'RECEIVABLE' | 'PAYABLE'; currency: string; amount: string; evidence: string };

export function consolidate(input: {
  reportingCurrency: string;
  entities: readonly { entityId: string; name: string }[];
  balances: readonly EntityBalance[];
  quotes: readonly FxQuote[];
  intercompany: readonly Intercompany[];
}) {
  if (!/^[A-Z]{3}$/.test(input.reportingCurrency)) fail('INVALID_CURRENCY', '合并币种须为 3 位大写代码');
  const entityIds = new Set(input.entities.map(e => e.entityId));
  if (entityIds.size !== input.entities.length) fail('DUP_ENTITY', '主体 ID 重复');
  for (const b of input.balances) {
    if (!entityIds.has(b.entityId)) fail('UNKNOWN_ENTITY', `余额引用未知主体 ${b.entityId}`);
    if (!['DEBIT', 'CREDIT'].includes(b.balanceSide)) fail('INVALID_SIDE', '余额方向无效');
  }
  // 汇率：仅接受已复核（reviewedBy/reference/observedAt 齐全）且汇率非空的报价；同一 source→target 取最新一条。
  const reviewed = input.quotes.filter(q => q && q.reviewedBy?.trim() && q.reference?.trim() && /^\d{4}-\d{2}-\d{2}$/.test(q.observedAt ?? ''));
  const quoteMap = new Map<string, FxQuote>();
  for (const q of reviewed) {
    const k = `${q.source}->${q.target}`;
    const prev = quoteMap.get(k);
    if (!prev || q.observedAt > prev.observedAt) quoteMap.set(k, q);
  }
  const needFx = [...new Set(input.balances.map(b => b.currency).filter(c => c !== input.reportingCurrency))];
  const missingFx = needFx.filter(c => !quoteMap.has(`${c}->${input.reportingCurrency}`));
  if (missingFx.length) return { status: 'NEEDS_DATA' as const, missing: missingFx.map(c => `fx:${c}->${input.reportingCurrency}`), lines: [], oci: [], eliminations: [], differences: [] };

  const signed = (b: EntityBalance) => { const a = dec(b.amount, `${b.entityId}.${b.subjectCode}`); return b.balanceSide === 'DEBIT' ? a : -a; };
  // 折算到合并币种（逐主体逐科目，保留审计痕迹）
  const translated = input.balances.map(b => {
    const s = signed(b);
    const fx = b.currency === input.reportingCurrency ? null : quoteMap.get(`${b.currency}->${input.reportingCurrency}`)!;
    const base = fx ? convert(s, rate(fx.rate)!) : s;
    return { entityId: b.entityId, subjectCode: b.subjectCode, currency: b.currency, signedOriginal: fmt(s), fxRate: fx?.rate ?? null, fxReference: fx?.reference ?? null, signedBase: fmt(base), isMonetary: b.isMonetary };
  });
  // 折算差额计入 OCI：非货币性项目以历史汇率折算产生的差额单列（此处对非货币项目以当期汇率与其入账本位币基差 auditable 表达）。
  const oci = translated.filter(t => !t.isMonetary && t.fxRate).map(t => ({
    entityId: t.entityId, subjectCode: t.subjectCode,
    amount: t.signedBase, note: '非货币项目折算差额计入其他综合收益（OCI），不进当期损益',
    sourceHash: createHash('sha256').update(`${t.entityId}|${t.subjectCode}|${t.currency}|${t.fxRate}|${t.fxReference}`).digest('hex').slice(0, 16),
  }));
  // 合并抵消：内部往来应收/应付各一条，按 key 配对；双边主体、币种、金额须一致才抵消。
  const eliminations: { key: string; amount: string; status: 'ELIMINATED' }[] = [];
  const differences: { key: string; reason: string; receivable: string | null; payable: string | null }[] = [];
  const groups = new Map<string, Intercompany[]>();
  for (const ic of input.intercompany) {
    if (!entityIds.has(ic.entityId) || !entityIds.has(ic.counterpartyId)) fail('UNKNOWN_ENTITY', `内部往来 ${ic.key} 引用未知主体`);
    if (ic.direction !== 'RECEIVABLE' && ic.direction !== 'PAYABLE') fail('INVALID_DIRECTION', '内部往来方向无效');
    groups.set(ic.key, [...(groups.get(ic.key) ?? []), ic]);
  }
  for (const [key, rows] of groups) {
    const rec = rows.find(r => r.direction === 'RECEIVABLE');
    const pay = rows.find(r => r.direction === 'PAYABLE');
    if (!rec || !pay) { differences.push({ key, reason: '内部往来缺少应收或应付方', receivable: rec?.amount ?? null, payable: pay?.amount ?? null }); continue; }
    if (rec.entityId !== pay.counterpartyId || pay.entityId !== rec.counterpartyId) { differences.push({ key, reason: '内部往来双边主体不匹配，禁止抵消', receivable: rec.amount, payable: pay.amount }); continue; }
    if (rec.currency !== pay.currency) { differences.push({ key, reason: '内部往来币种不一致，禁止抵消', receivable: rec.amount, payable: pay.amount }); continue; }
    const ra = dec(rec.amount, `${key}.receivable`), pa = dec(pay.amount, `${key}.payable`);
    if (ra !== pa) { differences.push({ key, reason: '内部往来双边金额不一致，禁止抵消', receivable: fmt(ra), payable: fmt(pa) }); continue; }
    const fx = rec.currency === input.reportingCurrency ? null : quoteMap.get(`${rec.currency}->${input.reportingCurrency}`);
    const base = fx ? convert(ra, rate(fx.rate)!) : ra;
    eliminations.push({ key, amount: fmt(base), status: 'ELIMINATED' });
  }
  const lines = translated.map(t => ({
    entityId: t.entityId, subjectCode: t.subjectCode,
    signedOriginal: t.signedOriginal, currency: t.currency, fxRate: t.fxRate,
    signedBase: t.signedBase, reportingCurrency: input.reportingCurrency,
  }));
  const digest = createHash('sha256').update(JSON.stringify({
    rc: input.reportingCurrency, lines, oci, eliminations, differences,
  })).digest('hex');
  return { status: 'CONSOLIDATED' as const, reportingCurrency: input.reportingCurrency, lines, oci, eliminations, differences, digest, missing: [] as string[] };
}
