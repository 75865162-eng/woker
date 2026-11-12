/** Wimoor finance rule port. Pure calculations only: these functions grant no authority to post. */
export class FinanceRuleError extends Error {}
const zero = BigInt(0);
const scale = BigInt(1000000);
function requireRule(condition: unknown, message: string): asserts condition {
  if (!condition) throw new FinanceRuleError(message);
}
function text(value: string) { requireRule(typeof value === 'string' && value.trim() === value && value.length > 0, '标识不能为空或包含首尾空格。'); }
function money(value: string): bigint {
  requireRule(typeof value === 'string' && /^-?\d{1,24}(?:\.\d{1,6})?$/.test(value), '金额须为最多六位小数的十进制字符串。');
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  const result = BigInt(whole) * scale + BigInt(fraction.padEnd(6, '0'));
  return negative ? -result : result;
}
function amount(value: bigint) {
  const absolute = value < zero ? -value : value;
  return `${value < zero ? '-' : ''}${absolute / scale}.${String(absolute % scale).padStart(6, '0')}`;
}
function nonnegative(value: string) { const result = money(value); requireRule(result >= zero, '金额不能为负。'); return result; }
function date(value: string) {
  requireRule(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value), '须提供核算时区下的会计日期 YYYY-MM-DD。');
  requireRule(Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value, '会计日期无效。');
}

export type FinanceScope = { organizationId: string; workspaceId: string; bookId: string; currency: string };
export type AccountingPeriod = FinanceScope & { id: string; start: string; end: string; status: 'NOT_OPEN' | 'OPEN' | 'CLOSED' };
export type AccountingSubject = FinanceScope & { id: string; enabled: boolean; leaf: boolean; normalSide: 'DEBIT' | 'CREDIT' };
export type VoucherLine = { accountId: string; debit: string; credit: string };
export type Voucher = FinanceScope & {
  id: string; sourceKey: string; periodId: string; date: string;
  status: 'DRAFT' | 'REVIEWED' | 'POSTED'; kind: 'STANDARD' | 'REVERSAL';
  reversalOf: string | null; lines: readonly VoucherLine[];
};
function scope(value: FinanceScope) {
  text(value.organizationId); text(value.workspaceId); text(value.bookId);
  requireRule(/^[A-Z]{3}$/.test(value.currency), '须显式提供账套本位币。');
}
function sameScope(expected: FinanceScope, actual: FinanceScope) {
  scope(expected); scope(actual);
  requireRule(expected.organizationId === actual.organizationId && expected.workspaceId === actual.workspaceId && expected.bookId === actual.bookId && expected.currency === actual.currency, '组织、工作区、账套或币种不一致。');
}
function periodValid(period: AccountingPeriod) {
  scope(period); text(period.id); date(period.start); date(period.end);
  requireRule(period.start <= period.end, '期间日期范围无效。');
}
function subjectsById(expected: FinanceScope, subjects: readonly AccountingSubject[]) {
  const result = new Map<string, AccountingSubject>();
  for (const subject of subjects) {
    sameScope(expected, subject); text(subject.id);
    requireRule(!result.has(subject.id), '科目 ID 重复。');
    requireRule(subject.normalSide === 'DEBIT' || subject.normalSide === 'CREDIT', '科目余额方向无效。');
    result.set(subject.id, subject);
  }
  return result;
}

/** All entries are already in the explicitly selected book currency; no implicit FX conversion. */
export function validateVoucher(voucher: Voucher, period: AccountingPeriod, subjects: readonly AccountingSubject[]) {
  sameScope(period, voucher); periodValid(period);
  text(voucher.id); text(voucher.sourceKey); date(voucher.date);
  requireRule(voucher.periodId === period.id && voucher.date >= period.start && voucher.date <= period.end, '凭证日期或期间不匹配。');
  requireRule(['DRAFT', 'REVIEWED', 'POSTED'].includes(voucher.status), '凭证状态无效。');
  requireRule(voucher.kind === 'STANDARD' || voucher.kind === 'REVERSAL', '凭证类型无效。');
  requireRule(voucher.kind === 'REVERSAL' ? !!voucher.reversalOf && voucher.reversalOf !== voucher.id : voucher.reversalOf === null, '冲销关联无效。');
  requireRule(voucher.lines.length >= 2, '凭证至少须有两条分录。');
  const accounts = subjectsById(voucher, subjects);
  let debit = zero; let credit = zero;
  for (const line of voucher.lines) {
    const account = accounts.get(line.accountId);
    requireRule(account?.enabled && account.leaf, '凭证只能使用当前账套启用的末级科目。');
    const dr = money(line.debit); const cr = money(line.credit);
    requireRule((dr !== zero) !== (cr !== zero), '每条分录须且只能有一侧非零金额。');
    requireRule(voucher.kind === 'STANDARD' ? dr >= zero && cr >= zero : dr <= zero && cr <= zero, '普通凭证须为正数，红字冲销须为原方向负数。');
    debit += dr; credit += cr;
  }
  requireRule(debit === credit, '凭证借贷不平衡。');
  return { debit: amount(debit), credit: amount(credit) };
}

export function reviewVoucher(voucher: Voucher, period: AccountingPeriod, subjects: readonly AccountingSubject[]) {
  requireRule(period.status === 'OPEN' && voucher.status === 'DRAFT', '仅开放期间的草稿可以审核。');
  validateVoucher(voucher, period, subjects);
  return { ...voucher, status: 'REVIEWED' as const };
}

/** Planning a transition is not a persisted posting. Caller must lock and enforce uniqueness in its transaction. */
export function planVoucherPosting(voucher: Voucher, period: AccountingPeriod, subjects: readonly AccountingSubject[], postedSourceKeys: readonly string[], reversal?: { original: Voucher; period: AccountingPeriod; existingReversalIds: readonly string[] }) {
  requireRule(period.status === 'OPEN' && voucher.status === 'REVIEWED', '仅开放期间的已审核凭证可以过账。');
  requireRule(!postedSourceKeys.includes(voucher.sourceKey), '来源单据已过账。');
  const totals = validateVoucher(voucher, period, subjects);
  if (voucher.kind === 'REVERSAL') {
    requireRule(reversal, '红字过账须校验原凭证及既有冲销记录。');
    const expected = reversalDraft(reversal.original, reversal.period, period, subjects, { id: voucher.id, sourceKey: voucher.sourceKey, date: voucher.date, existingReversalIds: reversal.existingReversalIds });
    requireRule(voucher.reversalOf === expected.reversalOf && voucher.lines.length === expected.lines.length && voucher.lines.every((line, index) => line.accountId === expected.lines[index].accountId && money(line.debit) === money(expected.lines[index].debit) && money(line.credit) === money(expected.lines[index].credit)), '红字分录必须完整冲销原凭证。');
  }
  return { ...voucher, status: 'POSTED' as const, totals };
}

/** Signed balance convention from Wimoor detail ledger: debit positive, credit negative. */
export function rollForwardBalance(opening: { amount: string; side: 'DEBIT' | 'CREDIT' }, debit: string, credit: string) {
  requireRule(opening.side === 'DEBIT' || opening.side === 'CREDIT', '期初余额方向无效。');
  const initial = nonnegative(opening.amount) * (opening.side === 'DEBIT' ? BigInt(1) : BigInt(-1));
  const closing = initial + money(debit) - money(credit);
  return { amount: amount(closing < zero ? -closing : closing), side: closing < zero ? 'CREDIT' as const : 'DEBIT' as const };
}

export type OpeningBalance = FinanceScope & { accountId: string; amount: string; side: 'DEBIT' | 'CREDIT' };
export function trialBalance(period: AccountingPeriod, subjects: readonly AccountingSubject[], opening: readonly OpeningBalance[], vouchers: readonly Voucher[]) {
  periodValid(period);
  const accounts = subjectsById(period, subjects);
  const balances = new Map<string, { opening: bigint; debit: bigint; credit: bigint }>();
  const row = (id: string) => { let value = balances.get(id); if (!value) { value = { opening: zero, debit: zero, credit: zero }; balances.set(id, value); } return value; };
  const seenOpening = new Set<string>();
  for (const balance of opening) {
    sameScope(period, balance);
    requireRule(accounts.has(balance.accountId) && !seenOpening.has(balance.accountId), '期初科目缺失或重复。');
    requireRule(balance.side === 'DEBIT' || balance.side === 'CREDIT', '期初方向无效。');
    seenOpening.add(balance.accountId);
    row(balance.accountId).opening = nonnegative(balance.amount) * (balance.side === 'DEBIT' ? BigInt(1) : BigInt(-1));
  }
  const ids = new Set<string>(); const sources = new Set<string>();
  for (const voucher of vouchers) {
    requireRule(voucher.status === 'POSTED', '试算只接受已过账凭证，不能静默忽略草稿。');
    validateVoucher(voucher, period, subjects);
    requireRule(!ids.has(voucher.id) && !sources.has(voucher.sourceKey), '凭证或来源重复。');
    ids.add(voucher.id); sources.add(voucher.sourceKey);
    for (const line of voucher.lines) { row(line.accountId).debit += money(line.debit); row(line.accountId).credit += money(line.credit); }
  }
  const totals = { opening: zero, debit: zero, credit: zero, closing: zero };
  const rows = [...balances].sort(([a], [b]) => a.localeCompare(b)).map(([accountId, value]) => {
    const closing = value.opening + value.debit - value.credit;
    totals.opening += value.opening; totals.debit += value.debit; totals.credit += value.credit; totals.closing += closing;
    return { accountId, openingSigned: amount(value.opening), debit: amount(value.debit), credit: amount(value.credit), closingSigned: amount(closing) };
  });
  return { organizationId: period.organizationId, workspaceId: period.workspaceId, bookId: period.bookId, currency: period.currency, periodId: period.id, rows, openingDifference: amount(totals.opening), movementDifference: amount(totals.debit - totals.credit), closingDifference: amount(totals.closing), balanced: totals.opening === zero && totals.debit === totals.credit && totals.closing === zero };
}

export function reversalDraft(original: Voucher, sourcePeriod: AccountingPeriod, target: AccountingPeriod, subjects: readonly AccountingSubject[], input: { id: string; sourceKey: string; date: string; existingReversalIds: readonly string[] }) {
  sameScope(original, target);
  requireRule(original.status === 'POSTED' && original.kind === 'STANDARD', '只能冲销已过账普通凭证。');
  validateVoucher(original, sourcePeriod, subjects);
  requireRule(input.existingReversalIds.length === 0 && target.status === 'OPEN', '已存在冲销记录或目标期间未开放。');
  requireRule(input.sourceKey !== original.sourceKey, '冲销须有独立来源标识。');
  date(input.date);
  requireRule(input.date >= original.date, '冲销日期不能早于原凭证。');
  const draft: Voucher = { ...original, id: input.id, sourceKey: input.sourceKey, date: input.date, periodId: target.id, status: 'DRAFT', kind: 'REVERSAL', reversalOf: original.id,
    lines: original.lines.map(line => ({ accountId: line.accountId, debit: amount(-money(line.debit)), credit: amount(-money(line.credit)) })) };
  validateVoucher(draft, target, subjects);
  return draft;
}

export type LedgerCloseEvidence = { unpostedVouchers: number; trial: ReturnType<typeof trialBalance> };
export type CloseEvidence = LedgerCloseEvidence & { unreconciledDocuments: number; missingCostDocuments: number };
/** Locks the registered ledger only; this does not assert external business reconciliation. */
export function planRegisteredLedgerClose(period: AccountingPeriod, evidence: LedgerCloseEvidence) {
  periodValid(period);
  if (period.status === 'CLOSED') return { status: 'CLOSED' as const, changed: false, coverage: 'REGISTERED_LEDGER_ONLY' as const };
  requireRule(period.status === 'OPEN', '只有开放期间可以结账。');
  sameScope(period, evidence.trial);
  requireRule(period.id === evidence.trial.periodId, '试算报告期间不匹配。');
  requireRule(Number.isSafeInteger(evidence.unpostedVouchers) && evidence.unpostedVouchers === 0, '存在待过账凭证，不能结账。');
  requireRule(evidence.trial.balanced && money(evidence.trial.openingDifference) === zero && money(evidence.trial.movementDifference) === zero && money(evidence.trial.closingDifference) === zero, '试算不平衡，不能结账。');
  return { status: 'CLOSED' as const, changed: true, coverage: 'REGISTERED_LEDGER_ONLY' as const };
}
/** Business close additionally requires real source reconciliation and cost completeness. */
export function planPeriodClose(period: AccountingPeriod, evidence: CloseEvidence) {
  const ledger = planRegisteredLedgerClose(period, evidence);
  if (!ledger.changed) return { status: ledger.status, changed: false };
  for (const count of [evidence.unreconciledDocuments, evidence.missingCostDocuments]) requireRule(Number.isSafeInteger(count) && count === 0, '存在未对账或缺失成本单据，不能结账。');
  return { status: ledger.status, changed: true };
}

export function planPeriodReopen(period: AccountingPeriod, subsequentPeriods: readonly AccountingPeriod[]) {
  periodValid(period);
  requireRule(period.status === 'CLOSED', '只有已结账期间可以反结账。');
  for (const next of subsequentPeriods) {
    sameScope(period, next); periodValid(next);
    requireRule(next.start > period.end, '后续期间范围重叠或顺序无效。');
    requireRule(next.status !== 'CLOSED', '后续期间已结账，不能反结账。');
  }
  return { status: 'OPEN' as const };
}

/** Reconcile immutable estimate/actual snapshots by the same plan line IDs, never by array position. */
export function reconcileCosts(estimate: { currency: string; lines: readonly { lineId: string; allocatedAmount: string }[] }, actual: { currency: string; lines: readonly { lineId: string; allocatedAmount: string }[] }) {
  requireRule(/^[A-Z]{3}$/.test(estimate.currency) && estimate.currency === actual.currency, '费用币种不一致，须先显式换汇。');
  const indexed = (lines: typeof estimate.lines) => {
    const result = new Map<string, bigint>();
    requireRule(lines.length > 0, '费用明细不能为空。');
    for (const line of lines) { text(line.lineId); requireRule(!result.has(line.lineId), '费用明细重复。'); result.set(line.lineId, nonnegative(line.allocatedAmount)); }
    return result;
  };
  const before = indexed(estimate.lines); const after = indexed(actual.lines);
  requireRule(before.size === after.size && [...before.keys()].every(id => after.has(id)), '预估与实际须覆盖同一组计划明细。');
  let difference = zero;
  const lines = [...before].sort(([a], [b]) => a.localeCompare(b)).map(([lineId, estimated]) => {
    const actualAmount = after.get(lineId)!; const delta = actualAmount - estimated; difference += delta;
    return { lineId, estimatedAmount: amount(estimated), actualAmount: amount(actualAmount), difference: amount(delta) };
  });
  return { currency: estimate.currency, lines, difference: amount(difference) };
}

/** Explicit account mapping only. Negative differences reverse debit/credit; no company defaults. */
export function costAdjustmentDraft(period: AccountingPeriod, subjects: readonly AccountingSubject[], input: {
  id: string; sourceKey: string; date: string; costAccountId: string; payableAccountId: string;
  estimate: Parameters<typeof reconcileCosts>[0]; actual: Parameters<typeof reconcileCosts>[1];
}) {
  periodValid(period);
  requireRule(period.status === 'OPEN', '费用调整只能生成在开放期间。');
  requireRule(input.estimate.currency === period.currency && input.actual.currency === period.currency, '费用须先显式换算为本位币。');
  requireRule(input.costAccountId !== input.payableAccountId, '成本与应付科目不能相同。');
  const reconciliation = reconcileCosts(input.estimate, input.actual);
  const delta = money(reconciliation.difference);
  const value = amount(delta < zero ? -delta : delta);
  const draft: Voucher = { organizationId: period.organizationId, workspaceId: period.workspaceId, bookId: period.bookId, currency: period.currency,
    id: input.id, sourceKey: input.sourceKey, periodId: period.id, date: input.date, status: 'DRAFT', kind: 'STANDARD', reversalOf: null,
    lines: [
      { accountId: input.costAccountId, debit: delta >= zero ? value : '0.000000', credit: delta < zero ? value : '0.000000' },
      { accountId: input.payableAccountId, debit: delta < zero ? value : '0.000000', credit: delta >= zero ? value : '0.000000' },
    ] };
  if (delta === zero) {
    text(input.id); text(input.sourceKey); date(input.date);
    requireRule(input.date >= period.start && input.date <= period.end, '调整日期不属于当前期间。');
    const accounts = subjectsById(period, subjects);
    for (const id of [input.costAccountId, input.payableAccountId]) requireRule(accounts.get(id)?.enabled && accounts.get(id)?.leaf, '费用调整须显式映射启用的末级科目。');
  } else validateVoucher(draft, period, subjects);
  return { reconciliation, draft: delta === zero ? null : draft };
}

/** Preserve per-SKU redistribution even when the document's net difference is zero. */
export function lineCostAdjustmentDraft(period:AccountingPeriod,subjects:readonly AccountingSubject[],input:{id:string;sourceKey:string;date:string;payableAccountId:string;costAccounts:readonly{lineId:string;accountId:string}[];estimate:Parameters<typeof reconcileCosts>[0];actual:Parameters<typeof reconcileCosts>[1]}){
 periodValid(period);requireRule(period.status==='OPEN','费用调整只能生成在开放期间。');
 requireRule(input.estimate.currency===period.currency&&input.actual.currency===period.currency,'费用须先显式换算为本位币。');
 const reconciliation=reconcileCosts(input.estimate,input.actual),mapping=new Map<string,string>();
 for(const row of input.costAccounts){text(row.lineId);text(row.accountId);requireRule(!mapping.has(row.lineId)&&row.accountId!==input.payableAccountId,'成本映射重复或与应付科目相同。');mapping.set(row.lineId,row.accountId);}
 requireRule(mapping.size===reconciliation.lines.length&&reconciliation.lines.every(row=>mapping.has(row.lineId)),'须为全部费用明细显式映射成本科目。');
 const entries:VoucherLine[]=[];
 for(const row of reconciliation.lines){const delta=money(row.difference);if(delta===zero)continue;const value=amount(delta<zero?-delta:delta);
  entries.push({accountId:mapping.get(row.lineId)!,debit:delta>zero?value:'0.000000',credit:delta<zero?value:'0.000000'},{accountId:input.payableAccountId,debit:delta<zero?value:'0.000000',credit:delta>zero?value:'0.000000'});
 }
 const draft:Voucher={organizationId:period.organizationId,workspaceId:period.workspaceId,bookId:period.bookId,currency:period.currency,id:input.id,sourceKey:input.sourceKey,periodId:period.id,date:input.date,status:'DRAFT',kind:'STANDARD',reversalOf:null,lines:entries};
 // Validate the explicit mapping even for zero movements, without emitting a zero voucher.
 const accounts=subjectsById(period,subjects);for(const id of [...mapping.values(),input.payableAccountId])requireRule(accounts.get(id)?.enabled&&accounts.get(id)?.leaf,'须显式映射启用的末级科目。');
 text(input.id);text(input.sourceKey);date(input.date);requireRule(input.date>=period.start&&input.date<=period.end,'调整日期不属于当前期间。');
 if(entries.length)validateVoucher(draft,period,subjects);
 return {reconciliation,draft:entries.length?draft:null};
}
