import {Prisma} from '@prisma/client';
import type {Tx} from './repository';
import type {WmsScope} from './contracts';
import {agingWindows,stockAgeEstimate} from './stock-aging-rules';
type Group={id:string;warehouseId:string;productRecordId:string;warehouseCode:string;sku:string;quantity:string;availableQty:string};
export async function queryStockAging(tx:Tx,scope:WmsScope,filters:Record<string,string>,limit:number,fingerprint:string,afterId?:string,asOf:Date=new Date()){
 const groups=await tx.$queryRaw<Group[]>(Prisma.sql`
 SELECT jsonb_build_array(b."warehouseId",l."productRecordId")::text AS id,b."warehouseId",l."productRecordId",w.code AS "warehouseCode",p.sku,
 SUM(b."onHand")::text AS quantity,SUM(b."onHand"::bigint-b."pendingQc"-b."pendingPutaway"-b.rejected-b.reserved)::text AS "availableQty"
 FROM "WmsStockBalance" b JOIN "WmsLot" l ON l.id=b."lotId" AND l."organizationId"=b."organizationId" AND l."workspaceId"=b."workspaceId"
 JOIN "WmsWarehouse" w ON w.id=b."warehouseId" AND w."organizationId"=b."organizationId" AND w."workspaceId"=b."workspaceId"
 JOIN "ProductRecord" p ON p.id=l."productRecordId" AND p."organizationId"=b."organizationId" AND p."workspaceId"=b."workspaceId"
 WHERE b."organizationId"=${scope.organizationId} AND b."workspaceId"=${scope.workspaceId}
 ${filters.warehouseId?Prisma.sql`AND b."warehouseId"=${filters.warehouseId}`:Prisma.empty}
 ${filters.productRecordId?Prisma.sql`AND l."productRecordId"=${filters.productRecordId}`:Prisma.empty}
 GROUP BY b."warehouseId",l."productRecordId",w.code,p.sku
 ${afterId?Prisma.sql`HAVING jsonb_build_array(b."warehouseId",l."productRecordId")::text COLLATE "C">${afterId}`:Prisma.empty}
 ORDER BY jsonb_build_array(b."warehouseId",l."productRecordId")::text COLLATE "C" LIMIT ${limit+1}`);
 const page=groups.slice(0,limit);
 if(!page.length)return {items:[],nextCursor:null};
 const evidence=await tx.$queryRaw<Array<Record<string,string>>>(Prisma.sql`
 WITH net AS (
 SELECT b."warehouseId",l."productRecordId",m."commandId",MIN(m."occurredAt") AS at,SUM(m."deltaOnHand") AS quantity
 FROM "WmsMovement" m JOIN "WmsStockBalance" b ON b.id=m."balanceId" AND b."organizationId"=m."organizationId" AND b."workspaceId"=m."workspaceId"
 JOIN "WmsLot" l ON l.id=b."lotId" AND l."organizationId"=b."organizationId" AND l."workspaceId"=b."workspaceId"
 WHERE m."organizationId"=${scope.organizationId} AND m."workspaceId"=${scope.workspaceId}
 AND (${Prisma.join(page.map(group=>Prisma.sql`(b."warehouseId"=${group.warehouseId} AND l."productRecordId"=${group.productRecordId})`),' OR ')})
 GROUP BY b."warehouseId",l."productRecordId",m."commandId")
 SELECT "warehouseId","productRecordId",SUM(quantity)::text AS "ledgerQty",
 ${Prisma.join(agingWindows.flatMap(days=>{
  const cutoff=new Date(asOf.getTime()-days*86400000);
  return [Prisma.sql`COALESCE(SUM(quantity) FILTER(WHERE at<${cutoff}),0)::text AS ${Prisma.raw(`"snapshot${days}"`)}`,Prisma.sql`COALESCE(-SUM(quantity) FILTER(WHERE at>=${cutoff} AND quantity<0),0)::text AS ${Prisma.raw(`"outbound${days}"`)}`];
 }))} FROM net GROUP BY "warehouseId","productRecordId"`);
 const byGroup=new Map(evidence.map(row=>[JSON.stringify([row.warehouseId,row.productRecordId]),row]));
 const items=page.map(group=>{const data=byGroup.get(JSON.stringify([group.warehouseId,group.productRecordId])),complete=(data?.ledgerQty??'0')===group.quantity&&agingWindows.every(days=>/^\d+$/.test(data?.[`snapshot${days}`]??'0'));
 const windows=agingWindows.map(days=>({days,snapshotQty:complete?(data?.[`snapshot${days}`]??'0'):null,outboundQty:complete?(data?.[`outbound${days}`]??'0'):null}));
 const estimate=stockAgeEstimate({quantity:group.quantity,windows});return {...group,asOf:asOf.toISOString(),basis:'WMS_NET_COMMAND_OUTBOUND',dataStatus:estimate?'COMPLETE':'NEEDS_DATA',windows,estimate};});
 const last=page.at(-1)!;
 return {items,nextCursor:groups.length>limit?Buffer.from(JSON.stringify({fingerprint,id:last.id,time:'1970-01-01T00:00:00.000Z'})).toString('base64url'):null};
}
