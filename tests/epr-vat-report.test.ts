import test from 'node:test';
import assert from 'node:assert/strict';
import { parseComplianceReport, isComplianceReportType, COMPLIANCE_REPORT_TYPES } from '../src/lib/amazon-sync/epr-vat-report';

test('四类合规报告类型已注册', () => {
  assert.equal(COMPLIANCE_REPORT_TYPES.length, 4);
  assert.equal(isComplianceReportType('GET_EPR_MONTHLY_REPORTS'), true);
  assert.equal(isComplianceReportType('GET_ORDERS'), false);
});

test('EPR 月报完整解析，coverage=1', () => {
  const rows = [{
    ReportingCountry: 'DE', RegistrationNumber: 'DE-123', ReportingPeriod: '2026-11',
    Category: 'PACKAGING', UnitsSold: '100', Amount: '12.5', Currency: 'EUR',
  }];
  const r = parseComplianceReport('GET_EPR_MONTHLY_REPORTS', rows);
  assert.equal(r.status, 'PARSED');
  assert.equal(r.coverage, 1);
  assert.equal(r.rows[0].values.registrationNumber, 'DE-123');
  assert.deepEqual(r.rows[0].missing, []);
});

test('缺字段保持 null，不补零，coverage 反映缺口', () => {
  const r = parseComplianceReport('GET_EPR_MONTHLY_REPORTS', [{ ReportingCountry: 'DE' }]);
  assert.equal(r.status, 'INCOMPLETE');
  assert.equal(r.rows[0].values.amount, null);
  assert.equal(r.rows[0].values.unitsSold, null);
  assert.ok(r.rows[0].missing.includes('amount'));
});

test('大小写不敏感 + 别名容错', () => {
  const r = parseComplianceReport('GET_VAT_TRANSACTION_DATA', [{
    transactionid: 'T1', date: '2026-11-01', country: 'FR', taxRate: '0.2', tax: '2.00', netamount: '10.00', currencycode: 'EUR',
  }]);
  assert.equal(r.status, 'PARSED');
  assert.equal(r.rows[0].values.transactionId, 'T1');
  assert.equal(r.rows[0].values.baseAmount, '10.00');
});

test('分币种统计，跨币种不混算', () => {
  const rows = [
    { ReportingCountry: 'DE', RegistrationNumber: 'A', ReportingPeriod: '11', Category: 'C', UnitsSold: '1', Amount: '1', Currency: 'EUR' },
    { ReportingCountry: 'FR', RegistrationNumber: 'B', ReportingPeriod: '11', Category: 'C', UnitsSold: '1', Amount: '1', Currency: 'EUR' },
    { ReportingCountry: 'PL', RegistrationNumber: 'C', ReportingPeriod: '11', Category: 'C', UnitsSold: '1', Amount: '1', Currency: 'PLN' },
  ];
  const r = parseComplianceReport('GET_EPR_MONTHLY_REPORTS', rows);
  assert.equal(r.currencyDistribution.EUR, 2);
  assert.equal(r.currencyDistribution.PLN, 1);
});

test('空行 → NEEDS_DATA', () => {
  const r = parseComplianceReport('GET_EPR_MONTHLY_REPORTS', []);
  assert.equal(r.status, 'NEEDS_DATA');
});
