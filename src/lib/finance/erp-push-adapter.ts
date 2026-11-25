import { createHash } from 'node:crypto';

/** 外部财务系统对接框架（报告3 P3-1）：金蝶 / Oracle NetSuite / SAP 单据推送的 dry-run 映射。
 * 复用 FinanceExternalSourceClaim 的幂等模型（economicKey = 系统前缀 + 摘要）。
 * 红线：仅 dry-run 生成 payload，绝不实际过账；科目/币种须显式提供，缺则不臆造；
 * 每次推送带幂等键和来源指纹，重复推送返回同一 economicKey。 */
export type ErpTarget = 'KINGDEE' | 'NETSUITE' | 'SAP';
const TARGETS: ErpTarget[] = ['KINGDEE', 'NETSUITE', 'SAP'];
export type PushLine = { subjectCode: string; debit: string; credit: string; currency: string; memo?: string };
export type PushDocument = {
  target: ErpTarget; docType: 'VOUCHER' | 'AR' | 'AP'; date: string;
  bookCurrency: string; lines: readonly PushLine[]; claimId: string; reference: string;
};

export type PushError = Error & { code: string };
function fail(code: string, msg: string): never { const e = new Error(msg) as PushError; e.code = code; throw e; }
function dec(v: string, label: string): bigint {
  if (!/^-?\d+(\.\d{1,6})?$/.test(v?.trim() ?? '')) fail('INVALID_AMOUNT', `${label} 须为 6 位定点字符串`);
  const neg = v.trim().startsWith('-'), [i, f = ''] = v.trim().replace('-', '').split('.');
  const x = BigInt(i) * 1_000_000n + BigInt(f.padEnd(6, '0')); return neg ? -x : x;
}
const fp = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

/** 生成幂等键：同一单据重复调用得到同一键，跨目标系统隔离。 */
export function pushEconomicKey(doc: Pick<PushDocument, 'target' | 'docType' | 'date' | 'bookCurrency' | 'claimId'>) {
  if (!TARGETS.includes(doc.target)) fail('INVALID_TARGET', '不支持的目标财务系统');
  return `${doc.target}:${doc.docType}:${fp([doc.claimId, doc.date, doc.bookCurrency]).slice(0, 24)}`;
}

/** 各目标系统的字段映射约定（dry-run 输出，不实际发送）。 */
const FIELD_MAP: Record<ErpTarget, { voucherNo: string; date: string; lines: string; account: string; debit: string; credit: string }> = {
  KINGDEE: { voucherNo: 'FNumber', date: 'FDate', lines: 'FEntries', account: 'FAccountID', debit: 'FDebit', credit: 'FCredit' },
  NETSUITE: { voucherNo: 'tranId', date: 'tranDate', lines: 'lineitems', account: 'account', debit: 'debit', credit: 'credit' },
  SAP: { voucherNo: 'BELNR', date: 'BUDAT', lines: 'ITEMS', account: 'HKONT', debit: 'DMBTR_H', credit: 'DMBTR_S' },
};

/** 生成 dry-run 载荷（含借贷平衡校验、币种一致性、幂等键与来源指纹）。绝不返回可执行的网络请求。 */
export function buildErpPushPayload(doc: PushDocument) {
  if (!TARGETS.includes(doc.target)) fail('INVALID_TARGET', '不支持的目标财务系统');
  if (!['VOUCHER', 'AR', 'AP'].includes(doc.docType)) fail('INVALID_DOCTYPE', '单据类型无效');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(doc.date)) fail('INVALID_DATE', '单据日期须为 YYYY-MM-DD');
  if (!/^[A-Z]{3}$/.test(doc.bookCurrency)) fail('INVALID_CURRENCY', '账套本位币无效');
  if (!doc.claimId?.trim() || !doc.reference?.trim()) fail('MISSING_CLAIM', '须提供来源申领 ID 与依据');
  if (!doc.lines.length || doc.lines.length > 200) fail('INVALID_LINES', '分录须为 1–200 行');
  let debit = 0n, credit = 0n;
  const mappedLines = doc.lines.map((l, idx) => {
    if (!l.subjectCode?.trim()) fail('MISSING_SUBJECT', `第 ${idx + 1} 行缺科目编码，不臆造默认科目`);
    if (l.currency !== doc.bookCurrency) fail('CROSS_CURRENCY', `第 ${idx + 1} 行币种与账套本位币不同，须先显式汇率核算`);
    const d = dec(l.debit, `line${idx}.debit`), c = dec(l.credit, `line${idx}.credit`);
    if (d < 0n || c < 0n) fail('NEGATIVE_ENTRY', '借贷额不得为负');
    if (d !== 0n && c !== 0n) fail('BOTH_SIDES', '同一分录不可同时借贷');
    debit += d; credit += c;
    return { line: idx + 1, [FIELD_MAP[doc.target].account]: l.subjectCode, [FIELD_MAP[doc.target].debit]: l.debit, [FIELD_MAP[doc.target].credit]: l.credit };
  });
  if (debit !== credit) fail('UNBALANCED', `借贷不平：借 ${debit} 贷 ${credit}`);
  if (debit === 0n) fail('ZERO_DOCUMENT', '零金额单据不推送');
  const economicKey = pushEconomicKey(doc);
  const fields = FIELD_MAP[doc.target];
  return {
    mode: 'DRY_RUN' as const,
    target: doc.target,
    economicKey,
    sourceFingerprint: fp(doc.lines),
    payload: {
      [fields.voucherNo]: doc.claimId,
      [fields.date]: doc.date,
      [fields.lines]: mappedLines,
      currency: doc.bookCurrency,
      reference: doc.reference,
    },
    totals: { debit: (debit / 1_000_000n).toString(), credit: (credit / 1_000_000n).toString(), balanced: true },
    note: '仅生成映射载荷供审阅；实际推送需单独审批与凭据，本内核不发起网络请求。',
  };
}
