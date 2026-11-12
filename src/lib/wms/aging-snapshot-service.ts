import {Prisma} from '@prisma/client';
import {prisma} from '@/lib/db/prisma';
import {authorizeWms,scoped,json} from './access';
import {WmsError,type WmsScope} from './contracts';
import {requireText,strictKeys} from './rules';
import {queryStockAging} from './stock-aging-query';
import {closeDigest} from '@/lib/finance/close-rules';
export async function queryAgingSnapshots(scope:WmsScope,params:URLSearchParams){
 return prisma.$transaction(async tx=>{await authorizeWms(tx,scope,'view');const warehouseId=params.get('warehouseId');return {snapshots:await tx.wmsAgingSnapshot.findMany({where:{...scoped(scope),...(warehouseId?{warehouseId}:{})},orderBy:[{snapshotDate:'desc'},{id:'asc'}],take:30}),limit:30};});
}
/** One consistent repeatable-read capture; no historical backfill fabricated from current balances. */
export async function captureAgingSnapshot(scope:WmsScope,body:Record<string,unknown>){
 strictKeys(body,['warehouseId','policyReference']);const warehouseId=requireText(body.warehouseId,'仓库 ID'),policyReference=requireText(body.policyReference,'库龄口径依据',1000),capturedAt=new Date(),day=capturedAt.toISOString().slice(0,10),snapshotDate=new Date(day+'T00:00:00Z');
 for(let attempt=0;attempt<4;attempt++){try{return await prisma.$transaction(async tx=>{
  await authorizeWms(tx,scope,'create');await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify([scope.organizationId,scope.workspaceId,warehouseId,day])},0))`;
  if(!await tx.wmsWarehouse.findFirst({where:{...scoped(scope),id:warehouseId,enabled:true}}))throw new WmsError('仓库不存在或已停用。',404);
  const prior=await tx.wmsAgingSnapshot.findFirst({where:{...scoped(scope),warehouseId,snapshotDate}});if(prior){if(prior.policyReference!==policyReference)throw new WmsError('当日库龄快照口径不可覆盖。',409);return {snapshot:prior,reused:true};}
  const fingerprint=closeDigest({warehouseId,day}),records:unknown[]=[];let afterId:string|undefined;
  for(let page=0;page<100;page++){
   const result=await queryStockAging(tx,scope,{warehouseId},100,fingerprint,afterId,capturedAt);records.push(...result.items);
   if(!result.nextCursor)break;
   if(page===99)throw new WmsError('单仓快照超过 10000 个商品组合，须采用专用批任务。',422);
   afterId=(JSON.parse(Buffer.from(result.nextCursor,'base64url').toString()) as {id:string}).id;
  }
  const status=records.some(row=>(row as {dataStatus:string}).dataStatus!=='COMPLETE')?'NEEDS_DATA':'COMPLETE';
  const snapshot=await tx.wmsAgingSnapshot.create({data:{id:crypto.randomUUID(),...scoped(scope),warehouseId,snapshotDate,capturedAt,policyReference,status,records:json(records),recordCount:records.length,sourceHash:closeDigest(records),createdBy:scope.actorUserId}});
  await tx.auditLog.create({data:{organizationId:scope.organizationId,userId:scope.actorUserId,action:'wms.aging.capture',entityType:'WmsAgingSnapshot',entityId:snapshot.id,metadata:{workspaceId:scope.workspaceId,warehouseId,day,recordCount:records.length,status,sourceHash:snapshot.sourceHash}}});return {snapshot,reused:false};
 },{isolationLevel:'RepeatableRead',timeout:20000});}catch(error){if(attempt===3||!(error instanceof Prisma.PrismaClientKnownRequestError)||!['P2002','P2034'].includes(error.code))throw error;}}
 throw new WmsError('库龄快照并发冲突，请重试。',409);
}
