import assert from 'node:assert/strict';
import {test} from 'node:test';
import {parseVoucherImportRows,groupVoucherImportRows} from '../src/lib/finance/voucher-import-rules';
const records=[{sourceRow:2,sourceSheet:'Sheet1',voucherKey:'V1',date:'2026-11-12',subjectCode:'EXP',debit:'12.123456',credit:'0',memo:''},{sourceRow:3,sourceSheet:'Sheet1',voucherKey:'V1',date:'2026-11-12',subjectCode:'BANK',debit:'0',credit:'12.123456',memo:'Payment'}];
test('structured voucher source preserves sheet/row, decimal amounts and balanced grouping',()=>{
 const parsed=parseVoucherImportRows(records);assert.equal(parsed[0].debit,'12.123456');assert.deepEqual(parseVoucherImportRows(parsed),parsed);assert.equal(groupVoucherImportRows(parsed).errors.length,0);
 assert.ok(groupVoucherImportRows(parseVoucherImportRows([records[0],{...records[1],credit:'12'}])).errors.length);
 assert.ok(groupVoucherImportRows(parseVoucherImportRows([records[0],{...records[1],date:'2026-11-13'}])).errors.length);
 assert.ok(groupVoucherImportRows(parseVoucherImportRows([records[0]])).errors.length);
});
test('import source rejects duplicate provenance, guessed fields, unsafe numbers and invalid dates',()=>{
 assert.throws(()=>parseVoucherImportRows([records[0],records[0]]));
 for(const update of [{debit:12},{date:'2026-02-30'},{credit:'1'},{debit:'-1'},{sourceRow:0},{currency:'USD'}])assert.throws(()=>parseVoucherImportRows([{...records[0],...update}]));
 assert.throws(()=>parseVoucherImportRows([]));
});
