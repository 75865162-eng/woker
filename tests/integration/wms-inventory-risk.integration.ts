import * as riskRoute from '../../src/app/api/operations/wms-inventory-risk/route';
import * as printRoute from '../../src/app/api/operations/wms-stocktake-print/route';
import {createSession} from '../../src/lib/auth/session';
import assert from 'node:assert/strict';
import {prisma} from '../../src/lib/db/prisma';
import {mutateInventoryRisk,readWmsInventoryRiskSource,queryInventoryRisk} from '../../src/lib/wms/inventory-risk-service';
import {exportStocktakePrint} from '../../src/lib/wms/stocktake-print-service';
import type {WmsScope} from '../../src/lib/wms/contracts';
export async function verifyInventoryRisk(scope:WmsScope,reviewer:WmsScope,snapshotId:string,blindStocktakeId:string){
 const snapshot=await prisma.wmsAgingSnapshot.findUniqueOrThrow({where:{id:snapshotId}}),day=snapshot.snapshotDate.toISOString().slice(0,10),from=new Date(snapshot.snapshotDate.getTime()-30*86400000).toISOString().slice(0,10),stocks=snapshot.records as unknown as {productRecordId:string;dataStatus:string}[];
 const policy={reference:'Fixture target risk policy',currency:'USD',windowDays:30,maximumSoldQty:'1',expenseAccount:'IMPAIRMENT',allowanceAccount:'ALLOWANCE'},evidence=stocks.map(row=>({productRecordId:row.productRecordId,salesFrom:from,salesTo:day,soldQty:'0',salesCoverage:'COMPLETE',salesReference:'Synthetic full SKU window evidence',carryingAmount:'10.123456',netRealizableAmount:'2.000001',existingProvision:'1.000001',valuationReference:'Synthetic target cost and NRV evidence'}));
 const input={action:'create',snapshotId,idempotencyKey:'RISK-FULL',policy,evidence};
 const drafts=await Promise.all(Array.from({length:6},()=>mutateInventoryRisk(scope,input)));assert.equal(new Set(drafts.map(row=>row.item.id)).size,1);const item=drafts[0].item;
 await assert.rejects(()=>mutateInventoryRisk(scope,{...input,evidence:evidence.map(row=>({...row,soldQty:'1'}))}));await assert.rejects(()=>mutateInventoryRisk({...scope,workspaceId:'other'},input));
 const review={action:'review',id:item.id,revision:1,approve:true,decisionEvidence:'Independent evidence check'};await assert.rejects(()=>mutateInventoryRisk(scope,review));await assert.rejects(()=>readWmsInventoryRiskSource(prisma,scope,item.id));
 await Promise.all(Array.from({length:6},()=>mutateInventoryRisk(reviewer,review)));const source=await prisma.$transaction(tx=>readWmsInventoryRiskSource(tx,scope,item.id));assert.equal(source.sourceKey,`WMS-INVENTORY-RISK:${snapshotId}`);assert.equal(source.lines.length,2);
 await assert.rejects(()=>prisma.wmsInventoryRiskAssessment.update({where:{id:item.id},data:{evidence:[]}}));await assert.rejects(()=>prisma.wmsInventoryRiskAssessment.delete({where:{id:item.id}}));
 const duplicate=await mutateInventoryRisk(scope,{...input,idempotencyKey:'RISK-DUPLICATE'});await assert.rejects(()=>mutateInventoryRisk(reviewer,{...review,id:duplicate.item.id}));
 const missing=await mutateInventoryRisk(scope,{...input,idempotencyKey:'RISK-MISSING',evidence:evidence.map(row=>({...row,salesCoverage:'MISSING',soldQty:null,netRealizableAmount:null}))});await assert.rejects(()=>mutateInventoryRisk(reviewer,{...review,id:missing.item.id}));
 await prisma.user.update({where:{id:reviewer.actorUserId},data:{status:'disabled'}});try{await assert.rejects(()=>prisma.$transaction(tx=>readWmsInventoryRiskSource(tx,scope,item.id)));}finally{await prisma.user.update({where:{id:reviewer.actorUserId},data:{status:'active'}});}
 assert.equal((await queryInventoryRisk({...scope,workspaceId:'other'},new URLSearchParams({id:item.id}))).items.length,0);
 const html=await exportStocktakePrint(scope,blindStocktakeId);assert.ok(html.includes('盲盘'));assert.ok(!html.includes('<th>账面</th>'));assert.ok(!html.includes('<th>差异</th>'));await assert.rejects(()=>exportStocktakePrint({...scope,workspaceId:'other'},blindStocktakeId));
 const {sessionCookie}=await createSession(scope.actorUserId),headers={cookie:`${sessionCookie.name}=${sessionCookie.value}`,'x-workspace-id':scope.workspaceId};
 assert.equal((await riskRoute.GET(new Request('http://127.0.0.1/api/operations/wms-inventory-risk')))?.status,401);
 const csv=await riskRoute.GET(new Request('http://127.0.0.1/api/operations/wms-inventory-risk?'+new URLSearchParams({id:item.id,format:'csv'}),{headers}));assert.ok(csv);assert.equal(csv.status,200);assert.ok((await csv.text()).includes('postingExecuted'));
 const printable=await printRoute.GET(new Request('http://127.0.0.1/api/operations/wms-stocktake-print?'+new URLSearchParams({id:blindStocktakeId}),{headers}));assert.ok(printable);assert.equal(printable.status,200);assert.ok(printable.headers.get('content-security-policy')?.includes('sandbox'));assert.ok(!(await printable.text()).includes('<th>账面</th>'));
 assert.equal((await riskRoute.GET(new Request('http://127.0.0.1/api/operations/wms-inventory-risk?'+new URLSearchParams({id:item.id,format:'csv'}),{headers:{...headers,'x-workspace-id':'other'}})))?.status,404);
 console.log('PASS: immutable risk evidence, target policy/exact provision, six-way replay/review, no self review, unknown data rejected, stable snapshot source key, revoked reviewer and blind print scope');
}
