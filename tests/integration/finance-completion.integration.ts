import assert from 'node:assert/strict';
import {prisma} from '../../src/lib/db/prisma';
import {mutateFinanceLedger} from '../../src/lib/finance/ledger-service';
import {mutateFinanceReports,queryFinanceReports} from '../../src/lib/finance/report-service';
import {mutateFinanceCatalog} from '../../src/lib/finance/catalog-service';
import {mutateFinanceBank,queryFinanceBank} from '../../src/lib/finance/bank-service';
import type {WmsScope} from '../../src/lib/wms/contracts';
type Row={id:string;revision:number};
function entity(value:unknown,key:string){const row=(value as Record<string,Row>)[key];assert.ok(row);return row;}
export async function financeCompletionFixture(scope:WmsScope,reviewer:WmsScope,third:WmsScope){
 const book=entity(await mutateFinanceLedger(scope,{action:'create-book',code:'BANK',name:'Bank fixture',currency:'USD'}),'book');
 const period=entity(await mutateFinanceLedger(scope,{action:'create-period',bookId:book.id,code:'2026-11',start:'2026-11-01',end:'2026-11-30'}),'period');await mutateFinanceLedger(reviewer,{action:'open-period',periodId:period.id,revision:1});
 const bankSubject=entity(await mutateFinanceLedger(scope,{action:'create-subject',bookId:book.id,code:'BANK',name:'Bank',normalSide:'DEBIT'}),'subject'),expense=entity(await mutateFinanceLedger(scope,{action:'create-subject',bookId:book.id,code:'EXP',name:'Expense',normalSide:'DEBIT'}),'subject');
 const category=entity(await mutateFinanceCatalog(reviewer,{action:'create-category',bookId:book.id,code:'ASSET',name:'Target assets',categoryType:'ASSET',parentId:null,sortOrder:1}),'category');await mutateFinanceCatalog(reviewer,{action:'classify-subject',bookId:book.id,subjectId:bankSubject.id,categoryId:category.id,revision:1});
 for(const code of ['USD','CNY'])await mutateFinanceCatalog(reviewer,{action:'create-currency',bookId:book.id,code,name:code});
 const snapshot={sourceCurrency:'CNY',targetCurrency:'USD',rate:'0.140000000001',observedAt:'2026-11-12T00:00:00Z',reference:'FX-FIXTURE',evidence:'Target supplied rate'};
 const rate=entity(await mutateFinanceCatalog(reviewer,{action:'record-rate',bookId:book.id,snapshot}),'rate');await assert.rejects(()=>mutateFinanceCatalog(reviewer,{action:'review-rate',bookId:book.id,rateId:rate.id}));await mutateFinanceCatalog(third,{action:'review-rate',bookId:book.id,rateId:rate.id});
 const conversion=await mutateFinanceCatalog(scope,{action:'preview-conversion',bookId:book.id,rateId:rate.id,lines:[{lineId:'L',allocatedAmount:'100'}]}) as {conversion:{amount:string}};assert.equal(conversion.conversion.amount,'14.000000');await assert.rejects(()=>prisma.financeExchangeRate.update({where:{id:rate.id},data:{rate:'1'}}));
 const report=entity(await mutateFinanceReports(scope,{action:'create-template',bookId:book.id,code:'FORMULA',version:1,kind:'CUSTOM',policyReference:'Target formula basis',definition:{rows:[{code:'BANK',label:'Bank',metric:'CLOSING',factor:'1',subjectIds:[bankSubject.id]},{code:'NET',label:'Net',formula:'[BANK] * 2'}],closing:null}}),'template');await mutateFinanceReports(reviewer,{action:'review-template',bookId:book.id,templateId:report.id});
 const reportResult=await queryFinanceReports(scope,new URLSearchParams({bookId:book.id,periodId:period.id,templateId:report.id}));assert.equal(reportResult.report?.rows[1].amount,'0.000000');
 const account=entity(await mutateFinanceBank(reviewer,{action:'create-account',bookId:book.id,subjectId:bankSubject.id,code:'BANK-1',name:'Target bank',maskedNumber:'****1234',policyReference:'Bank policy v1'}),'account');
 const voucher=entity(await mutateFinanceLedger(scope,{action:'create-voucher',periodId:period.id,idempotencyKey:'BANK-PAY',sourceKey:'BANK-PAY',date:'2026-11-12',lines:[{subjectId:expense.id,debit:'12.123456',credit:'0'},{subjectId:bankSubject.id,debit:'0',credit:'12.123456'}]}),'voucher');await mutateFinanceLedger(reviewer,{action:'review-voucher',voucherId:voucher.id,revision:1});await mutateFinanceLedger(reviewer,{action:'post-voucher',voucherId:voucher.id,revision:2});
 const rows=[{reference:'BANK-REF',date:'2026-11-12',amount:'-12.123456',evidence:'Actual bank evidence fixture',sourceSheet:'Statement',sourceRow:2}];
 const imported=await mutateFinanceBank(scope,{action:'import-statements',bookId:book.id,accountId:account.id,rows}) as {statementIds:string[]};assert.deepEqual((await mutateFinanceBank(scope,{action:'import-statements',bookId:book.id,accountId:account.id,rows}) as {statementIds:string[]}).statementIds,imported.statementIds);
 await assert.rejects(()=>mutateFinanceBank(scope,{action:'import-statements',bookId:book.id,accountId:account.id,rows:[{...rows[0],amount:'-13'}]}));
 const data=await queryFinanceBank(scope,new URLSearchParams({bookId:book.id,accountId:account.id,periodId:period.id}));assert.equal(data.journal.length,1);assert.equal(data.candidates[0].voucherLineIds.length,1);
 const match={action:'match-statement',bookId:book.id,statementId:imported.statementIds[0],periodId:period.id,voucherLineIds:data.candidates[0].voucherLineIds,evidence:'Independent bank tie out'};await assert.rejects(()=>mutateFinanceBank(scope,match));
 const matches=await Promise.all(Array.from({length:6},()=>mutateFinanceBank(reviewer,match)));const m=entity(matches[0],'match');matches.forEach(row=>assert.equal(entity(row,'match').id,m.id));
 await assert.rejects(()=>mutateFinanceLedger(scope,{action:'reverse-voucher',voucherId:voucher.id,periodId:period.id,idempotencyKey:'BLOCKED',sourceKey:'BLOCKED',date:'2026-11-13'}));
 await assert.rejects(()=>prisma.financeBankStatement.delete({where:{id:imported.statementIds[0]}}));await assert.rejects(()=>prisma.financeBankMatchEntry.deleteMany({where:{matchId:m.id}}));
 await assert.rejects(()=>mutateFinanceBank({...reviewer,workspaceId:'other'},match));
 await mutateFinanceBank(third,{action:'reverse-match',bookId:book.id,matchId:m.id,evidence:'Independent correction'});await mutateFinanceLedger(scope,{action:'reverse-voucher',voucherId:voucher.id,periodId:period.id,idempotencyKey:'UNBLOCKED',sourceKey:'UNBLOCKED',date:'2026-11-13'});
 console.log('PASS: target currency/rate review, exact conversion, category binding, posted bank journal, immutable bank source/replay, candidates only, six-way independent match, reversal guard and released evidence');
}
