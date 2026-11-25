import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveValuationMethod, validateClosingTemplate, validateReportTemplate, type ReportKind } from '../src/lib/finance/fiscal-templates';

test('计价：未封存采用当前配置', () => {
  const r = resolveValuationMethod({ configured: 'FIFO', periodClosed: false, sealedMethod: null });
  assert.equal(r.status, 'ACTIVE');
  assert.equal(r.effective, 'FIFO');
});

test('计价：已封存期间锁定为封存方法，不被新配置覆盖', () => {
  const r = resolveValuationMethod({ configured: 'MOVING_WEIGHTED', periodClosed: true, sealedMethod: 'FIFO' });
  assert.equal(r.status, 'LOCKED');
  assert.equal(r.effective, 'FIFO');
});

test('计价：无效方法被拒绝', () => {
  assert.throws(() => resolveValuationMethod({ configured: 'LIFO' as any, periodClosed: false, sealedMethod: null }), /无效/);
});

test('结转模板：来源与目标科目相同被拒绝', () => {
  assert.throws(() => validateClosingTemplate({
    code: 'PL', profitSubjectCode: '6001', currentYearProfitSubjectCode: '6001',
    priorYearAdjustSubjectCode: null, transferCycle: 'MONTHLY', directionHandling: 'SIGNED',
  }), /不可相同/);
});

test('结转模板：合法配置通过', () => {
  const r = validateClosingTemplate({
    code: 'PL', profitSubjectCode: '6001', currentYearProfitSubjectCode: '4103',
    priorYearAdjustSubjectCode: '4104', transferCycle: 'MONTHLY', directionHandling: 'SIGNED',
  });
  assert.equal(r.valid, true);
});

test('财报模板：合法 BS 模板通过', () => {
  const r = validateReportTemplate({ kind: 'STANDARD_BS', version: 1, rows: [
    { code: 'ASSETS', label: '资产总计', subjectCodes: ['1001', '1002'] },
    { code: 'LIAB', label: '负债', subjectCodes: ['2001'] },
    { code: 'EQ', label: '权益', formula: 'ASSETS-LIAB' },
  ] });
  assert.equal(r.valid, true);
  assert.equal(r.rowCount, 3);
});

test('财报模板：公式引用未定义变量被拒绝', () => {
  assert.throws(() => validateReportTemplate({ kind: 'STANDARD_IS', version: 1, rows: [
    { code: 'REV', label: '收入', subjectCodes: ['6001'] },
    { code: 'NET', label: '净利', formula: 'REV-UNKNOWN' },
  ] }), /未定义变量/);
});

test('财报模板：公式含非法字符（防 RCE）被拒绝', () => {
  assert.throws(() => validateReportTemplate({ kind: 'STANDARD_CF', version: 1, rows: [
    { code: 'A', label: 'A', subjectCodes: ['1001'] },
    { code: 'B', label: 'B', formula: 'eval(A)' },
  ] }), /非法字符/);
});

test('财报模板：自引用被拒绝', () => {
  assert.throws(() => validateReportTemplate({ kind: 'STANDARD_EQUITY', version: 1, rows: [
    { code: 'A', label: 'A', formula: 'A+1' },
  ] }), /自引用/);
});
