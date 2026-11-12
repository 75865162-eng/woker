import assert from 'node:assert/strict';
import {test} from 'node:test';
import {validateFinanceAttachment,financeAttachmentMaxBytes} from '../src/lib/finance/attachment-rules';
test('voucher evidence requires bounded matching signatures and safe original names',()=>{
 assert.equal(validateFinanceAttachment('invoice.pdf',Buffer.from('%PDF-1.7 fixture')).mimeType,'application/pdf');
 assert.equal(validateFinanceAttachment('scan.png',Buffer.from([137,80,78,71,13,10,26,10])).extension,'png');
 assert.equal(validateFinanceAttachment('scan.jpeg',Buffer.from([255,216,255])).extension,'jpg');
 for(const name of ['../bill.pdf','a\\bill.pdf','bad\nbill.pdf','bill.html','bill.png'])assert.throws(()=>validateFinanceAttachment(name,Buffer.from('%PDF-fixture')));
 assert.throws(()=>validateFinanceAttachment('bill.pdf',Buffer.alloc(0)));
 assert.throws(()=>validateFinanceAttachment('bill.pdf',Buffer.alloc(financeAttachmentMaxBytes+1)));
});
