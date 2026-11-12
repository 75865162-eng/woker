import {Prisma} from '@prisma/client';
import type {Tx} from './repository';
import type {WmsScope} from './contracts';
/** Ledger valuation by original currency. A partly priced balance has no total. */
export async function presentInventoryValuation(tx:Tx,scope:WmsScope,balances:readonly {id:string;onHand:number;stock:unknown}[]){
 if(!balances.length)return [];
 const totals=await tx.$queryRaw<{balanceId:string;ledgerQty:string;unvalued:string}[]>(Prisma.sql`
 SELECT m."balanceId",SUM(m."deltaOnHand")::text AS "ledgerQty",COUNT(*) FILTER(WHERE e.id IS NULL)::text AS unvalued
 FROM "WmsMovement" m LEFT JOIN "WmsCostEntry" e ON e."movementId"=m.id AND e."organizationId"=m."organizationId" AND e."workspaceId"=m."workspaceId"
 WHERE m."organizationId"=${scope.organizationId} AND m."workspaceId"=${scope.workspaceId} AND m."balanceId" IN (${Prisma.join(balances.map(row=>row.id))}) AND m."deltaOnHand"<>0 GROUP BY m."balanceId"`);
 const values=await tx.$queryRaw<{balanceId:string;currency:string;amount:string}[]>(Prisma.sql`
 SELECT m."balanceId",e.currency,SUM(CASE WHEN e.quantity>0 THEN e.amount+COALESCE(a.delta,0) ELSE -e.amount-COALESCE(a.delta,0) END)::text AS amount
 FROM "WmsCostEntry" e LEFT JOIN (
 SELECT "organizationId","workspaceId","costEntryId",SUM(delta) AS delta FROM "WmsCostAdjustment" WHERE status='REVIEWED' GROUP BY "organizationId","workspaceId","costEntryId"
 ) a ON a."organizationId"=e."organizationId" AND a."workspaceId"=e."workspaceId" AND a."costEntryId"=e.id JOIN "WmsMovement" m ON m.id=e."movementId" AND m."organizationId"=e."organizationId" AND m."workspaceId"=e."workspaceId"
 WHERE e."organizationId"=${scope.organizationId} AND e."workspaceId"=${scope.workspaceId} AND m."balanceId" IN (${Prisma.join(balances.map(row=>row.id))}) GROUP BY m."balanceId",e.currency`);
 return balances.map(balance=>{const total=totals.find(row=>row.balanceId===balance.id),complete=String(balance.onHand)===(total?.ledgerQty??'0')&&(total?.unvalued??'0')==='0';return {id:balance.id,stock:balance.stock,onHand:balance.onHand,dataStatus:complete?'COMPLETE':'NEEDS_DATA',unvaluedMovements:total?.unvalued??'0',values:complete?values.filter(row=>row.balanceId===balance.id).map(({currency,amount})=>({currency,amount})):null,basis:'EXPLICIT_APPROVED_STANDARD_COST_LEDGER',postingExecuted:false};});
}
