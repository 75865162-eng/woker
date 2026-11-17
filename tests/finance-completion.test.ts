import assert from 'node:assert/strict';
import {test} from 'node:test';
import ExcelJS from 'exceljs';
import { Prisma, type PrismaClient } from '@prisma/client';
import { queryFinanceLedger } from '../src/lib/finance/ledger-service';
import {parseBankStatementRows,validateBankMatch} from '../src/lib/finance/bank-rules';
import {parseVoucherWorkbook} from '../src/lib/finance/voucher-workbook';
test('bank evidence keeps signed six-decimal amounts and unique source references',()=>{
 const rows=parseBankStatementRows([{reference:'B1',date:'2026-11-12',amount:'-12.123456',evidence:'Statement',sourceSheet:'Bank',sourceRow:2}]);assert.equal(rows[0].amount,'-12.123456');
 assert.equal(validateBankMatch('-12.123456',[{debit:'0',credit:'10'},{debit:'0',credit:'2.123456'}]),'-12.123456');
 assert.throws(()=>validateBankMatch('-12.123456',[{debit:'12.123456',credit:'0'}]));assert.throws(()=>parseBankStatementRows([rows[0],rows[0]]));assert.throws(()=>parseBankStatementRows([{...rows[0],amount:'0'}]));
});
test('XLSX voucher template retains exact text values and rejects formulas or number money',async()=>{
 const wb=new ExcelJS.Workbook(),sheet=wb.addWorksheet('Source');sheet.addRow(['voucherKey','date','subjectCode','debit','credit','memo']);sheet.addRow(['V1','2026-11-12','EXP','12.123456','0','']);sheet.addRow(['V1','2026-11-12','BANK','0','12.123456','receipt']);
 const rows=await parseVoucherWorkbook(Buffer.from(await wb.xlsx.writeBuffer()));assert.equal(rows[0].sourceSheet,'Source');assert.equal(rows[0].sourceRow,2);assert.equal(rows[0].debit,'12.123456');
 sheet.getCell('D2').value=12.123456;await assert.rejects(()=>wb.xlsx.writeBuffer().then(buffer=>parseVoucherWorkbook(Buffer.from(buffer))));
 sheet.getCell('D2').value={formula:'1+1',result:2};await assert.rejects(()=>wb.xlsx.writeBuffer().then(buffer=>parseVoucherWorkbook(Buffer.from(buffer))));
});

test('总账先按账套和期间过滤再截取凭证，旧期间列表与试算一致且拒绝串账套', async () => {
 const globals = globalThis as unknown as { prisma?: PrismaClient };
 const previous = globals.prisma;
 const scope = { organizationId: 'fixture-org', workspaceId: 'fixture-ws', actorUserId: 'fixture-user' };
 const identity = { organizationId: scope.organizationId, workspaceId: scope.workspaceId, bookId: 'book' };
 const book = { ...identity, id: 'book', currency: 'CNY', enabled: true };
 const period = { ...identity, id: 'old', start: new Date('2026-10-01'), end: new Date('2026-10-31'), status: 'OPEN', book };
 const subjects = ['cash', 'income'].map(id => ({ ...identity, id, enabled: true, leaf: true, normalSide: id === 'cash' ? 'DEBIT' : 'CREDIT' }));
 const voucher = { ...identity, id: 'old-voucher', periodId: 'old', sourceKey: 'fixture-source', date: new Date('2026-10-02'), status: 'POSTED', kind: 'STANDARD', reversalOf: null, lines: [
  { subjectId: 'cash', debit: new Prisma.Decimal('12.123456'), credit: new Prisma.Decimal(0) },
  { subjectId: 'income', debit: new Prisma.Decimal(0), credit: new Prisma.Decimal('12.123456') },
 ] };
 const allVouchers = [...Array.from({ length: 101 }, (_, index) => ({ ...voucher, id: `new-${index}`, periodId: 'new', date: new Date('2026-11-01') })), voucher,
  { ...voucher, id: 'foreign-org', organizationId: 'other' }, { ...voucher, id: 'foreign-ws', workspaceId: 'other' }, { ...voucher, id: 'foreign-book', bookId: 'other' }];
 type Query = { where: Record<string, unknown>; take?: number };
 const queries: Query[] = [];
 const matches = (row: object, where: Record<string, unknown>) => Object.entries(where).every(([key, value]) => (row as Record<string, unknown>)[key] === value);
 const tx = {
  $queryRaw: async () => [{ permissions: { operations: ['view'] }, status: 'active' }],
  organizationMember: { findUnique: async () => ({ role: 'owner', user: { status: 'active' } }) },
  workspaceScope: { findUnique: async () => ({ id: scope.workspaceId }) },
  financeBook: { findMany: async () => [book] },
  financePeriod: { findMany: async () => [period], findFirst: async ({ where }: Query) => matches(period, Object.fromEntries(Object.entries(where).filter(([key]) => key !== 'book'))) ? period : null },
  financeSubject: { findMany: async () => subjects },
  financeOpeningBalance: { findMany: async () => [] },
  financeVoucher: { findMany: async (query: Query) => {
   queries.push(query);
   const rows = allVouchers.filter(row => matches(row, query.where)).sort((left, right) => right.date.getTime() - left.date.getTime());
   return query.take === undefined ? rows : rows.slice(0, query.take);
  } },
 };
 globals.prisma = { $transaction: async (fn: (client: unknown) => unknown) => fn(tx) } as unknown as PrismaClient;
 try {
  const result = await queryFinanceLedger(scope, new URLSearchParams({ bookId: 'book', periodId: 'old' }));
  assert.deepEqual(result.vouchers.map(row => row.id), ['old-voucher']);
  assert.deepEqual(queries[0].where, { ...identity, periodId: 'old' });
  assert.equal(queries[0].take, 100);
  assert.deepEqual(queries[1].where, { ...identity, periodId: 'old', status: 'POSTED' });
  assert.equal(result.trial?.rows.find(row => row.accountId === 'cash')?.debit, result.vouchers[0].lines[0].debit);
  assert.equal(result.trial?.balanced, true);
  await assert.rejects(queryFinanceLedger(scope, new URLSearchParams({ bookId: 'other', periodId: 'old' })), /会计期间不存在或不属于当前账套/);
  queries.length = 0;
  const unfiltered = await queryFinanceLedger(scope, new URLSearchParams({ bookId: 'book' }));
  assert.equal(unfiltered.vouchers.length, 100);
  assert.deepEqual(queries[0].where, identity);
  assert.equal(unfiltered.trial, null);
 } finally { globals.prisma = previous; }
});

test('financial formulas evaluate exact six-decimal arithmetic and reject executable/cyclic expressions',async()=>{
 const {evaluateReportFormula}=await import('../src/lib/finance/report-formula'),{parseReportDefinition,renderFinancialReport}=await import('../src/lib/finance/report-rules');
 assert.equal(evaluateReportFormula('([R] - [E]) / 3',code=>code==='R'?BigInt(10000000):BigInt(2000000)),BigInt(2666667));
 const definition=parseReportDefinition({rows:[{code:'NET',label:'Net',formula:'[R] - [E]'},{code:'R',label:'Revenue',metric:'CREDIT',factor:'1',subjectIds:['r']},{code:'E',label:'Expense',metric:'DEBIT',factor:'1',subjectIds:['e']}],closing:null});
 assert.equal(renderFinancialReport(definition,[{accountId:'r',openingSigned:'0',debit:'0',credit:'12.123456',closingSigned:'-12.123456'},{accountId:'e',openingSigned:'0',debit:'2.000001',credit:'0',closingSigned:'2.000001'}],['r','e'])[0].amount,'10.123455');
 assert.throws(()=>parseReportDefinition({rows:[{code:'A',label:'A',formula:'[B]'},{code:'B',label:'B',formula:'[A]'}]}));
 assert.throws(()=>evaluateReportFormula('process.exit()',()=>BigInt(0)));assert.throws(()=>evaluateReportFormula('1 / 0',()=>BigInt(0)));assert.throws(()=>evaluateReportFormula('1 2',()=>BigInt(0)));
});
