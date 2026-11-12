import assert from 'node:assert/strict';
import {test} from 'node:test';
import ExcelJS from 'exceljs';
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

test('financial formulas evaluate exact six-decimal arithmetic and reject executable/cyclic expressions',async()=>{
 const {evaluateReportFormula}=await import('../src/lib/finance/report-formula'),{parseReportDefinition,renderFinancialReport}=await import('../src/lib/finance/report-rules');
 assert.equal(evaluateReportFormula('([R] - [E]) / 3',code=>code==='R'?BigInt(10000000):BigInt(2000000)),BigInt(2666667));
 const definition=parseReportDefinition({rows:[{code:'NET',label:'Net',formula:'[R] - [E]'},{code:'R',label:'Revenue',metric:'CREDIT',factor:'1',subjectIds:['r']},{code:'E',label:'Expense',metric:'DEBIT',factor:'1',subjectIds:['e']}],closing:null});
 assert.equal(renderFinancialReport(definition,[{accountId:'r',openingSigned:'0',debit:'0',credit:'12.123456',closingSigned:'-12.123456'},{accountId:'e',openingSigned:'0',debit:'2.000001',credit:'0',closingSigned:'2.000001'}],['r','e'])[0].amount,'10.123455');
 assert.throws(()=>parseReportDefinition({rows:[{code:'A',label:'A',formula:'[B]'},{code:'B',label:'B',formula:'[A]'}]}));
 assert.throws(()=>evaluateReportFormula('process.exit()',()=>BigInt(0)));assert.throws(()=>evaluateReportFormula('1 / 0',()=>BigInt(0)));assert.throws(()=>evaluateReportFormula('1 2',()=>BigInt(0)));
});
