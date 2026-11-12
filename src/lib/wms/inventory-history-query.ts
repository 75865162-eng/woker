import {Prisma} from '@prisma/client';
import {WmsError,type WmsScope} from './contracts';
import type {Tx} from './repository';
export function inventoryHistoryRange(from:unknown,to:unknown){
 const date=(value:unknown)=>{if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)||!Number.isFinite(Date.parse(value)))throw new WmsError('库存期间须为明确 UTC 时间。',400);const parsed=new Date(value);if(parsed.toISOString()!==(value.length===20?value.replace("Z",".000Z"):value))throw new WmsError("库存期间日期无效。",400);return parsed;};
 const start=date(from),end=date(to);
 if(start>=end||end.getTime()>Date.now()+1000||end.getTime()-start.getTime()>366*86400000)throw new WmsError('库存期间须为已发生的时间，起止间隔不超过 366 天。',400);
 return {from:start,to:end};
}
export async function presentInventoryHistory(tx:Tx,scope:WmsScope,balances:readonly {id:string;onHand:number;pendingQc:number;pendingPutaway:number;rejected:number;reserved:number;stock:unknown}[],from:Date,to:Date){
 if(!balances.length)return [];
 const quantities=await tx.$queryRaw<Array<{balanceId:string;openingQty:string;incomingQty:string;outgoingQty:string;closingQty:string;closingReserved:string;closingPendingQc:string;closingPendingPutaway:string;closingRejected:string;movementCount:string;ledgerOnHand:string;ledgerQc:string;ledgerPutaway:string;ledgerRejected:string;ledgerReserved:string;missingVolume:boolean;openingVolume:string;incomingVolume:string;outgoingVolume:string;closingVolume:string}>>(Prisma.sql`
 SELECT "balanceId",
 BOOL_OR("deltaOnHand"<>0 AND "deltaVolumeCubicMeters" IS NULL AND "occurredAt"<${to}) AS "missingVolume",
 COALESCE(SUM("deltaVolumeCubicMeters") FILTER(WHERE "occurredAt"<${from}),0)::text AS "openingVolume",
 COALESCE(SUM("deltaVolumeCubicMeters") FILTER(WHERE "occurredAt">=${from} AND "occurredAt"<${to} AND "deltaOnHand">0),0)::text AS "incomingVolume",
 COALESCE(-SUM("deltaVolumeCubicMeters") FILTER(WHERE "occurredAt">=${from} AND "occurredAt"<${to} AND "deltaOnHand"<0),0)::text AS "outgoingVolume",
 COALESCE(SUM("deltaVolumeCubicMeters") FILTER(WHERE "occurredAt"<${to}),0)::text AS "closingVolume",
 COALESCE(SUM("deltaOnHand") FILTER(WHERE "occurredAt"<${from}),0)::text AS "openingQty",
 COALESCE(SUM("deltaOnHand") FILTER(WHERE "occurredAt">=${from} AND "occurredAt"<${to} AND "deltaOnHand">0),0)::text AS "incomingQty",
 COALESCE(-SUM("deltaOnHand") FILTER(WHERE "occurredAt">=${from} AND "occurredAt"<${to} AND "deltaOnHand"<0),0)::text AS "outgoingQty",
 COALESCE(SUM("deltaOnHand") FILTER(WHERE "occurredAt"<${to}),0)::text AS "closingQty",
 COALESCE(SUM("deltaReserved") FILTER(WHERE "occurredAt"<${to}),0)::text AS "closingReserved",
 COALESCE(SUM("deltaPendingQc") FILTER(WHERE "occurredAt"<${to}),0)::text AS "closingPendingQc",
 COALESCE(SUM("deltaPendingPutaway") FILTER(WHERE "occurredAt"<${to}),0)::text AS "closingPendingPutaway",
 COALESCE(SUM("deltaRejected") FILTER(WHERE "occurredAt"<${to}),0)::text AS "closingRejected",
 COUNT(*) FILTER(WHERE "occurredAt"<${to})::text AS "movementCount",
 COALESCE(SUM("deltaOnHand"),0)::text AS "ledgerOnHand",
 COALESCE(SUM("deltaPendingQc"),0)::text AS "ledgerQc",
 COALESCE(SUM("deltaPendingPutaway"),0)::text AS "ledgerPutaway",
 COALESCE(SUM("deltaRejected"),0)::text AS "ledgerRejected",
 COALESCE(SUM("deltaReserved"),0)::text AS "ledgerReserved"
 FROM "WmsMovement" WHERE "organizationId"=${scope.organizationId} AND "workspaceId"=${scope.workspaceId}
 AND "balanceId" IN (${Prisma.join(balances.map(row=>row.id))})
 GROUP BY "balanceId"`);
 const byId=new Map(quantities.map(row=>[row.balanceId,row]));
 return balances.map(balance=>{
  const totals=byId.get(balance.id);
  const complete=String(balance.onHand)===(totals?.ledgerOnHand??'0')&&String(balance.pendingQc)===(totals?.ledgerQc??'0')&&String(balance.pendingPutaway)===(totals?.ledgerPutaway??'0')&&String(balance.rejected)===(totals?.ledgerRejected??'0')&&String(balance.reserved)===(totals?.ledgerReserved??'0');
  const result={id:balance.id,stock:balance.stock,from:from.toISOString(),to:to.toISOString(),basis:'WMS_POSTED_MOVEMENTS',dataStatus:complete?'COMPLETE':'NEEDS_DATA',movementCount:totals?.movementCount??'0'};
  return {...result,volumeStatus:complete&&!totals?.missingVolume?'COMPLETE':'NEEDS_DATA',...Object.fromEntries(['openingVolume','incomingVolume','outgoingVolume','closingVolume'].map(key=>[key,complete&&!totals?.missingVolume?(totals?.[key as keyof typeof totals]??'0'):null])),...Object.fromEntries(['openingQty','incomingQty','outgoingQty','closingQty','closingReserved','closingPendingQc','closingPendingPutaway','closingRejected'].map(key=>[key,complete?(totals?.[key as keyof typeof totals]??'0'):null]))};
 });
}
