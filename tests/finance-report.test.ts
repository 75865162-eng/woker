import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseReportDefinition, renderFinancialReport, profitLossClosingLines } from '../src/lib/finance/report-rules';
const definition={rows:[{code:'R',label:'Revenue',metric:'CLOSING',factor:'-1',subjectIds:['revenue']},{code:'E',label:'Expense',metric:'DEBIT',factor:'1',subjectIds:['expense']}],closing:{subjectIds:['revenue','expense'],destinationSubjectId:'retained'}};
const trial=[{accountId:'revenue',openingSigned:'0',debit:'0',credit:'100.123456',closingSigned:'-100.123456'},{accountId:'expense',openingSigned:'0',debit:'30.000001',credit:'0',closingSigned:'30.000001'}];
test('target report mapping renders posted signed balances and explicit direction',()=>{
 const parsed=parseReportDefinition(definition);const rows=renderFinancialReport(parsed,trial,['revenue','expense','retained']);
 assert.equal(rows[0].amount,'100.123456');assert.equal(rows[1].amount,'30.000001');
 assert.throws(()=>renderFinancialReport(parsed,trial,['revenue']));
 assert.throws(()=>parseReportDefinition({...definition,rows:[definition.rows[0],definition.rows[0]]}));
});
test('target profit-loss closing zeroes source balances and balances the destination',()=>{
 assert.deepEqual(profitLossClosingLines(parseReportDefinition(definition),trial),[{subjectId:'revenue',debit:'100.123456',credit:'0.000000'},{subjectId:'expense',debit:'0.000000',credit:'30.000001'},{subjectId:'retained',debit:'0.000000',credit:'70.123455'}]);
 assert.deepEqual(profitLossClosingLines(parseReportDefinition(definition),[]),[]);
 assert.throws(()=>parseReportDefinition({...definition,closing:{subjectIds:['revenue'],destinationSubjectId:'revenue'}}));
});
