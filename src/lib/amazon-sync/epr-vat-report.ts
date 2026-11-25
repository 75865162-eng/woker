import { createHash } from 'node:crypto';

/** EPR/VAT 合规报告解析内核（报告2 P3）：补齐 GET_EPR_MONTHLY_REPORTS / GET_VAT_TRANSACTION_DATA 等报告类型。
 * 红线：字段缺值不补零；覆盖率显式审计；金额分币种隔离；注册国家/税号须明确，不臆造。 */
export type ComplianceReportType =
  | 'GET_EPR_MONTHLY_REPORTS' | 'GET_VAT_TRANSACTION_DATA'
  | 'GET_EPR_LICENSING_DATA' | 'GET_VAT_WITHHOLDING_TAX';

export const COMPLIANCE_REPORT_TYPES: ComplianceReportType[] = [
  'GET_EPR_MONTHLY_REPORTS', 'GET_VAT_TRANSACTION_DATA', 'GET_EPR_LICENSING_DATA', 'GET_VAT_WITHHOLDING_TAX',
];

/** 每类报告的必需字段（亚马逊 SP-API 合规报告通用列名，别名用于容错）。 */
const REQUIRED_FIELDS: Record<ComplianceReportType, { key: string; aliases: string[] }[]> = {
  GET_EPR_MONTHLY_REPORTS: [
    { key: 'reportingCountry', aliases: ['ReportingCountry', 'CountryCode', 'country'] },
    { key: 'registrationNumber', aliases: ['RegistrationNumber', 'EPRRegistrationNumber', 'uin'] },
    { key: 'reportingPeriod', aliases: ['ReportingPeriod', 'Period', 'month'] },
    { key: 'category', aliases: ['Category', 'EPRCategory', 'materialCategory'] },
    { key: 'unitsSold', aliases: ['UnitsSold', 'units', 'quantity'] },
    { key: 'amount', aliases: ['Amount', 'FeeAmount', 'totalAmount'] },
    { key: 'currency', aliases: ['Currency', 'CurrencyCode', 'currencyCode'] },
  ],
  GET_VAT_TRANSACTION_DATA: [
    { key: 'transactionId', aliases: ['TransactionId', 'TransactionID', 'txnId'] },
    { key: 'transactionDate', aliases: ['TransactionDate', 'Date', 'postedDate'] },
    { key: 'countryCode', aliases: ['CountryCode', 'Country', 'country'] },
    { key: 'vatRate', aliases: ['VatRate', 'VATRate', 'taxRate'] },
    { key: 'taxAmount', aliases: ['TaxAmount', 'VATAmount', 'tax'] },
    { key: 'baseAmount', aliases: ['BaseAmount', 'NetAmount', 'taxableAmount'] },
    { key: 'currency', aliases: ['Currency', 'CurrencyCode'] },
  ],
  GET_EPR_LICENSING_DATA: [
    { key: 'registrationNumber', aliases: ['RegistrationNumber', 'LicenseNumber'] },
    { key: 'reportingCountry', aliases: ['ReportingCountry', 'CountryCode'] },
    { key: 'category', aliases: ['Category', 'EPRCategory'] },
    { key: 'validFrom', aliases: ['ValidFrom', 'StartDate'] },
    { key: 'validTo', aliases: ['ValidTo', 'EndDate'] },
  ],
  GET_VAT_WITHHOLDING_TAX: [
    { key: 'transactionId', aliases: ['TransactionId', 'TransactionID'] },
    { key: 'countryCode', aliases: ['CountryCode', 'Country'] },
    { key: 'withheldAmount', aliases: ['WithheldAmount', 'WithholdingTaxAmount'] },
    { key: 'currency', aliases: ['Currency', 'CurrencyCode'] },
  ],
};

export type ParsedComplianceRow = {
  values: Record<string, string | null>;
  present: string[]; missing: string[]; coverage: number;
};

function pick(row: Record<string, unknown>, aliases: string[]): string | null {
  // 大小写不敏感匹配，空字符串视为缺失（不补零）
  const norm = new Map(Object.entries(row).map(([k, v]) => [k.trim().toLowerCase(), v]));
  for (const a of aliases) {
    const v = norm.get(a.trim().toLowerCase());
    if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
  }
  return null;
}

export function parseComplianceReport(type: ComplianceReportType, rows: readonly Record<string, unknown>[]) {
  if (!COMPLIANCE_REPORT_TYPES.includes(type)) throw new Error('INVALID_COMPLIANCE_REPORT_TYPE');
  if (!Array.isArray(rows)) throw new Error('INVALID_ROWS');
  const spec = REQUIRED_FIELDS[type];
  const parsed: ParsedComplianceRow[] = rows.map(row => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('INVALID_ROW');
    const values: Record<string, string | null> = {};
    const present: string[] = [], missing: string[] = [];
    for (const f of spec) {
      const v = pick(row, f.aliases);
      values[f.key] = v;
      if (v === null) missing.push(f.key); else present.push(f.key);
    }
    return { values, present, missing, coverage: present.length / spec.length };
  });
  const byCurrency = new Map<string, number>();
  for (const r of parsed) {
    const cur = r.values.currency;
    if (cur && /^[A-Z]{3}$/.test(cur)) byCurrency.set(cur, (byCurrency.get(cur) ?? 0) + 1);
  }
  const overall = parsed.length ? parsed.reduce((s, r) => s + r.coverage, 0) / parsed.length : 0;
  const digest = createHash('sha256').update(JSON.stringify({ type, rows: parsed.map(r => r.values) })).digest('hex');
  return {
    type, rowCount: parsed.length,
    status: parsed.length === 0 ? 'NEEDS_DATA' as const : overall < 0.9 ? 'INCOMPLETE' as const : 'PARSED' as const,
    rows: parsed, coverage: Number(overall.toFixed(4)),
    currencyDistribution: Object.fromEntries(byCurrency),
    digest,
    note: '金额按原币保留，跨币种不混算；缺字段保持 null 不补零。',
  };
}

/** 合规报告类型是否已纳入同步注册表（供同步层判断是否支持）。 */
export function isComplianceReportType(type: string): type is ComplianceReportType {
  return COMPLIANCE_REPORT_TYPES.includes(type as ComplianceReportType);
}
