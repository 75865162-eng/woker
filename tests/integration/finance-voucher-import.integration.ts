import assert from 'node:assert/strict';
import {prisma} from '../../src/lib/db/prisma';
import {mutateFinanceLedger} from '../../src/lib/finance/ledger-service';
import {mutateVoucherImport,queryVoucherImports} from '../../src/lib/finance/voucher-import-service';
import type {WmsScope} from '../../src/lib/wms/contracts';
type Row={id:string;revision:number;status:string;requestHash:string;voucherIds:string[]};
function entity(value:unknown,key:string){const row=(value as Record<string,Row>)[key];assert.ok(row);return row;}
export async function financeVoucherImportFixture(scope:WmsScope,reviewer:WmsScope){
 const book=entity(await mutateFinanceLedger(scope,{action:'create-book',code:'IMPORT',name:'Synthetic import',currency:'USD'}),'book');
 const period=entity(await mutateFinanceLedger(scope,{action:'create-period',bookId:book.id,code:'2026-11',start:'2026-11-01',end:'2026-11-30'}),'period');await mutateFinanceLedger(reviewer,{action:'open-period',periodId:period.id,revision:1});
 await mutateFinanceLedger(scope,{action:'create-subject',bookId:book.id,code:'EXP',name:'Expense',normalSide:'DEBIT'});await mutateFinanceLedger(scope,{action:'create-subject',bookId:book.id,code:'BANK',name:'Bank',normalSide:'DEBIT'});
 const records=[{sourceSheet:'Sheet1',sourceRow:2,voucherKey:'V1',date:'2026-11-12',subjectCode:'EXP',debit:'1.123456',credit:'0'},{sourceSheet:'Sheet1',sourceRow:3,voucherKey:'V1',date:'2026-11-12',subjectCode:'BANK',debit:'0',credit:'1.123456'}];
 const input={action:'stage-import',bookId:book.id,idempotencyKey:'IMPORT-1',sourceName:'Synthetic workbook',evidence:'Target import mapping',records};
 const staged=entity(await mutateVoucherImport(scope,input),'import');assert.equal(staged.status,'VALIDATED');assert.equal(entity(await mutateVoucherImport(scope,input),'import').id,staged.id);
 const wrong=entity(await mutateVoucherImport(scope,{...input,idempotencyKey:'IMPORT-INVALID',records:[records[0],{...records[1],subjectCode:'UNKNOWN'}]}),'import');assert.equal(wrong.status,'NEEDS_REVIEW');
 await assert.rejects(()=>mutateVoucherImport(scope,{action:'import-drafts',bookId:book.id,importId:wrong.id,periodId:period.id,requestHash:wrong.requestHash}));
 await assert.rejects(()=>prisma.financeVoucherImport.update({where:{id:wrong.id},data:{status:'VALIDATED'}}));
 const batch={action:'import-drafts',bookId:book.id,importId:staged.id,periodId:period.id,requestHash:staged.requestHash};
 await assert.rejects(()=>mutateVoucherImport({...scope,workspaceId:'other'},batch));
 const results=await Promise.all(Array.from({length:6},()=>mutateVoucherImport(scope,batch)));const imported=entity(results[0],'import');assert.equal(imported.voucherIds.length,1);for(const result of results)assert.deepEqual(entity(result,'import').voucherIds,imported.voucherIds);
 const voucher=await prisma.financeVoucher.findUniqueOrThrow({where:{id:imported.voucherIds[0]},include:{lines:{orderBy:{lineNumber:'asc'}}}});assert.equal(voucher.status,'DRAFT');assert.equal(voucher.lines[0].debit.toFixed(6),'1.123456');
 await assert.rejects(()=>prisma.financeVoucherImport.update({where:{id:staged.id},data:{sourceName:'Replacement'}}));
 const duplicate=entity(await mutateVoucherImport(scope,{...input,idempotencyKey:'IMPORT-DUPLICATE'}),'import');
 await assert.rejects(()=>mutateVoucherImport(scope,{...batch,importId:duplicate.id,requestHash:duplicate.requestHash}));
 assert.equal(await prisma.financeVoucher.count({where:{bookId:book.id}}),1,'separate batches cannot duplicate the same named source voucher');
 const atomic=entity(await mutateVoucherImport(scope,{...input,idempotencyKey:'IMPORT-ATOMIC',sourceName:'Synthetic atomic',records:[...records,...records.map(row=>({...row,sourceRow:row.sourceRow+2,voucherKey:'V2',date:'2026-12-01'}))]}),'import');
 await assert.rejects(()=>mutateVoucherImport(scope,{...batch,importId:atomic.id,requestHash:atomic.requestHash}));assert.equal(await prisma.financeVoucher.count({where:{bookId:book.id}}),1,'out-of-period second voucher rolls back the entire batch');assert.equal((await prisma.financeVoucherImport.findUniqueOrThrow({where:{id:atomic.id}})).status,'VALIDATED');
 await mutateFinanceLedger(reviewer,{action:'review-voucher',voucherId:voucher.id,revision:1});await mutateFinanceLedger(reviewer,{action:'post-voucher',voucherId:voucher.id,revision:2});
 assert.equal((await queryVoucherImports({...scope,workspaceId:'other'},new URLSearchParams({bookId:book.id}))).imports.length,0);
 console.log('PASS: structured import provenance, validation errors, atomic draft batch, six-way replay, cross-batch source duplication guard, immutable evidence, scope and independent posting');
}
