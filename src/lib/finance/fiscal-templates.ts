import { createHash } from 'node:crypto';

/** 会计模板内核（报告3 P1-3 损益结转 + P1-4 标准财报模板 + P2-2 三态计价）。
 * 复用 report-formula 的安全表达式约束（这里只校验模板配置，不执行任意代码）。
 * 红线：模板须显式配置科目与公式；缺配置不臆造默认科目；计价方法一经封存不可变。 */
export type ValuationMethod = 'FIFO' | 'MOVING_WEIGHTED' | 'MONTHLY_WEIGHTED';
export const VALUATION_METHODS: ValuationMethod[] = ['FIFO', 'MOVING_WEIGHTED', 'MONTHLY_WEIGHTED'];
export type ReportKind = 'STANDARD_BS' | 'STANDARD_IS' | 'STANDARD_CF' | 'STANDARD_EQUITY';
export const REPORT_KINDS: ReportKind[] = ['STANDARD_BS', 'STANDARD_IS', 'STANDARD_CF', 'STANDARD_EQUITY'];

export class FiscalTemplateError extends Error { constructor(msg: string) { super(msg); this.name = 'FiscalTemplateError'; } }

/** 三态计价决策：给定规则配置返回方法；已封存期间锁定原方法，不允许变更。 */
export function resolveValuationMethod(input: {
  configured: ValuationMethod; periodClosed: boolean; sealedMethod: ValuationMethod | null;
}) {
  if (!VALUATION_METHODS.includes(input.configured)) throw new FiscalTemplateError('计价方法无效');
  if (input.periodClosed && input.sealedMethod && input.sealedMethod !== input.configured) {
    return { status: 'LOCKED' as const, effective: input.sealedMethod,
      reason: '期间已封存，计价方法锁定为封存值，不得随新配置或新入库变动' };
  }
  return { status: 'ACTIVE' as const, effective: input.configured, reason: '采用当前配置的计价方法' };
}

/** 损益结转模板校验：目标科目须显式且与来源科目不同，方向明确。 */
export function validateClosingTemplate(tpl: {
  code: string; profitSubjectCode: string; currentYearProfitSubjectCode: string;
  priorYearAdjustSubjectCode: string | null; transferCycle: 'MONTHLY' | 'YEARLY'; directionHandling: 'SIGNED' | 'ABSOLUTE';
}) {
  if (!tpl.code?.trim()) throw new FiscalTemplateError('结转模板 code 必填');
  if (!tpl.profitSubjectCode?.trim() || !tpl.currentYearProfitSubjectCode?.trim()) throw new FiscalTemplateError('损益类科目与本年利润科目须显式配置，不臆造');
  if (tpl.profitSubjectCode === tpl.currentYearProfitSubjectCode) throw new FiscalTemplateError('来源与目标科目不可相同');
  if (tpl.priorYearAdjustSubjectCode && tpl.priorYearAdjustSubjectCode === tpl.currentYearProfitSubjectCode) throw new FiscalTemplateError('以前年度调整科目不可与本年利润科目相同');
  if (!['MONTHLY', 'YEARLY'].includes(tpl.transferCycle) || !['SIGNED', 'ABSOLUTE'].includes(tpl.directionHandling)) throw new FiscalTemplateError('结转周期或方向处理无效');
  return { valid: true as const, digest: createHash('sha256').update(JSON.stringify(tpl)).digest('hex') };
}

/** 标准财报模板校验：每类报表须有 >=1 行、公式行引用的变量在模板内定义、无循环（ simplistic 检查）。 */
export function validateReportTemplate(tpl: {
  kind: ReportKind; version: number; rows: { code: string; label: string; formula?: string; subjectCodes?: string[] }[];
}) {
  if (!REPORT_KINDS.includes(tpl.kind)) throw new FiscalTemplateError('报表类型无效');
  if (!Number.isInteger(tpl.version) || tpl.version < 1) throw new FiscalTemplateError('模板版本无效');
  if (!Array.isArray(tpl.rows) || tpl.rows.length === 0) throw new FiscalTemplateError('报表模板须至少一行');
  const codes = new Set<string>();
  for (const row of tpl.rows) {
    if (!row.code?.trim() || codes.has(row.code)) throw new FiscalTemplateError('报表行 code 缺失或重复');
    codes.add(row.code);
    if (!row.formula && (!Array.isArray(row.subjectCodes) || row.subjectCodes.length === 0)) throw new FiscalTemplateError(`行 ${row.code} 须配置公式或科目`);
  }
  // 公式引用校验：仅允许引用本模板内定义的行 code，且不得引用自身
  const ident = /[A-Za-z_][A-Za-z0-9_]*/g;
  for (const row of tpl.rows) {
    if (!row.formula) continue;
    if (/[()*{}\[\];!=<>]|[^+\-*/.\dA-Za-z_\s]/.test(row.formula)) throw new FiscalTemplateError(`行 ${row.code} 公式含非法字符（仅四则运算与变量）`);
    for (const ref of row.formula.match(ident) ?? []) {
      if (!codes.has(ref)) throw new FiscalTemplateError(`行 ${row.code} 公式引用未定义变量 ${ref}`);
      if (ref === row.code) throw new FiscalTemplateError(`行 ${row.code} 公式自引用`);
    }
  }
  return {
    valid: true as const, kind: tpl.kind, version: tpl.version, rowCount: tpl.rows.length,
    digest: createHash('sha256').update(JSON.stringify({ kind: tpl.kind, version: tpl.version, rows: tpl.rows })).digest('hex'),
  };
}
