import assert from 'node:assert/strict';
import {prisma} from '../../src/lib/db/prisma';
import {mutateFinanceLedger} from '../../src/lib/finance/ledger-service';
import {uploadFinanceAttachment,queryFinanceAttachments,downloadFinanceAttachment} from '../../src/lib/finance/attachment-service';
import type {WmsScope} from '../../src/lib/wms/contracts';
import type {StorageDriver} from '../../src/lib/storage/types';
type Row={id:string;revision:number};
function entity(value:unknown,key:string){const row=(value as Record<string,Row>)[key];assert.ok(row);return row;}
export async function financeAttachmentFixture(scope:WmsScope,reviewer:WmsScope,third:WmsScope){
 const book=entity(await mutateFinanceLedger(scope,{action:'create-book',code:'FILES',name:'Synthetic evidence',currency:'USD'}),'book');
 const period=entity(await mutateFinanceLedger(scope,{action:'create-period',bookId:book.id,code:'2026-11',start:'2026-11-01',end:'2026-11-30'}),'period');
 await mutateFinanceLedger(reviewer,{action:'open-period',periodId:period.id,revision:1});
 const debit=entity(await mutateFinanceLedger(scope,{action:'create-subject',bookId:book.id,code:'EXP',name:'Expense',normalSide:'DEBIT'}),'subject'),credit=entity(await mutateFinanceLedger(scope,{action:'create-subject',bookId:book.id,code:'BANK',name:'Bank',normalSide:'DEBIT'}),'subject');
 const voucher=entity(await mutateFinanceLedger(scope,{action:'create-voucher',periodId:period.id,idempotencyKey:'FILES',sourceKey:'FILES',date:'2026-11-12',lines:[{subjectId:debit.id,debit:'1',credit:'0'},{subjectId:credit.id,debit:'0',credit:'1'}]}),'voucher');
 // In-memory storage only; actual PostgreSQL transactions, constraints and handlers remain real.
 const objects=new Map<string,Buffer>();
 const storage:StorageDriver={putFile:async()=>{throw Error('Not used');},putBuffer:async({key,buffer})=>{objects.set(key,Buffer.from(buffer));return {key,size:buffer.length};},getBuffer:async key=>{assert.ok(objects.has(key));return Buffer.from(objects.get(key)!);},getBoundedBuffer:async(key,max)=>{const value=objects.get(key);assert.ok(value);assert.ok(value.length<=max);return Buffer.from(value);},delete:async key=>{objects.delete(key);}};
 const input={voucherId:voucher.id,revision:1,evidence:'Synthetic receipt retained',name:'receipt.pdf',buffer:Buffer.from('%PDF-1.7 Synthetic fixture evidence')};
 const outputs=await Promise.allSettled(Array.from({length:6},()=>uploadFinanceAttachment(reviewer,input,storage,'local')));
 assert.equal(outputs.filter(value=>value.status==='fulfilled').length,1);assert.equal(objects.size,1,'all definitively uncommitted uploads compensated');
 const current=await queryFinanceAttachments(scope,voucher.id);assert.equal(current.attachments.length,1);const attachment=current.attachments[0];
 assert.equal((await downloadFinanceAttachment(scope,attachment.id,storage,'local')).buffer.toString(),input.buffer.toString());
 await assert.rejects(()=>downloadFinanceAttachment({...scope,workspaceId:'other'},attachment.id,storage,'local'));
 assert.equal((await queryFinanceAttachments({...scope,workspaceId:'other'},voucher.id)).attachments.length,0);
 await assert.rejects(()=>uploadFinanceAttachment(scope,{...input,revision:2},storage,'local'));assert.equal(objects.size,1);
 const row=await prisma.financeVoucherAttachment.findUniqueOrThrow({where:{id:attachment.id}});
 await assert.rejects(()=>prisma.fileObject.update({where:{id:row.fileId},data:{contentHash:'tamper'}}));
 await assert.rejects(()=>prisma.financeVoucherAttachment.delete({where:{id:row.id}}));
 await assert.rejects(()=>mutateFinanceLedger(reviewer,{action:'review-voucher',voucherId:voucher.id,revision:2}),'attachment author cannot review another creator voucher');
 await mutateFinanceLedger(third,{action:'review-voucher',voucherId:voucher.id,revision:2});
 await mutateFinanceLedger(third,{action:'post-voucher',voucherId:voucher.id,revision:3});
 await assert.rejects(()=>uploadFinanceAttachment(scope,{...input,revision:4},storage,'local'));
 const reversal=entity(await mutateFinanceLedger(scope,{action:'reverse-voucher',voucherId:voucher.id,periodId:period.id,idempotencyKey:'FILES-REV',sourceKey:'FILES-REV',date:'2026-11-13'}),'voucher');
 assert.equal((await queryFinanceAttachments(scope,reversal.id)).attachments[0].contentHash,attachment.contentHash);
 const stored=await prisma.fileObject.findUniqueOrThrow({where:{id:row.fileId}});objects.set(stored.storageKey,Buffer.from('corrupted'));
 await assert.rejects(()=>downloadFinanceAttachment(scope,attachment.id,storage,'local'));
 console.log('PASS: receipt upload with real DB, six-way revisions and orphan compensation, scoped bounded download/hash validation, immutable evidence, editor independence, posted rejection and reversal inheritance; storage bytes use isolated in-memory adapter');
}
