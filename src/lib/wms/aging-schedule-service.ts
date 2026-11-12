import {prisma} from '@/lib/db/prisma';
import {authorizeWms,scoped,auditWms} from './access';
import {WmsError,type WmsScope} from './contracts';
import {requireText,strictKeys} from './rules';
import {captureAgingSnapshot} from './aging-snapshot-service';

export async function queryAgingSchedules(scope:WmsScope){
 return prisma.$transaction(async tx=>{await authorizeWms(tx,scope,'view');return tx.wmsAgingSchedule.findMany({where:scoped(scope),orderBy:{id:'asc'},take:100});});
}
/** Explicitly opt in per warehouse; the designated user's permissions are checked again on each capture. */
export async function configureAgingSchedule(scope:WmsScope,body:Record<string,unknown>){
 strictKeys(body,['warehouseId','policyReference','enabled','revision']);
 const warehouseId=requireText(body.warehouseId,'仓库 ID'),policyReference=requireText(body.policyReference,'库龄口径依据',1000);
 if(typeof body.enabled!=='boolean'||!Number.isSafeInteger(body.revision)||Number(body.revision)<0)throw new WmsError('计划启用状态或版本无效。',400);
 const enabled=body.enabled;
 return prisma.$transaction(async tx=>{
  await authorizeWms(tx,scope,'approve');
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${JSON.stringify(['aging-schedule',scope.organizationId,scope.workspaceId,warehouseId])},0))`;
  if(!await tx.wmsWarehouse.findFirst({where:{...scoped(scope),id:warehouseId,enabled:true}}))throw new WmsError('仓库不存在或已停用。',404);
  const prior=await tx.wmsAgingSchedule.findFirst({where:{...scoped(scope),warehouseId}});
  if((prior?.revision??0)!==body.revision)throw new WmsError('库龄计划已变更，请重新读取。',409);
  const values={actorUserId:scope.actorUserId,policyReference,enabled,nextRunAt:new Date(),lastError:null};
  const result=prior?await tx.wmsAgingSchedule.update({where:{id:prior.id},data:{...values,revision:{increment:1}}}):await tx.wmsAgingSchedule.create({data:{id:crypto.randomUUID(),...scoped(scope),warehouseId,...values}});
  await auditWms(tx,scope,'aging.schedule',result.id,{warehouseId,enabled:result.enabled,revision:result.revision,policyReference});return result;
 });
}
/** Persisted lease via nextRunAt, bounded scan, crash retry and idempotent daily capture. No historical backfill. */
export async function runDueAgingSchedules(limit=5){
 if(!Number.isSafeInteger(limit)||limit<1||limit>20)throw new Error('Invalid aging schedule scan limit');
 const now=new Date(),rows=await prisma.wmsAgingSchedule.findMany({where:{enabled:true,nextRunAt:{lte:now}},orderBy:[{nextRunAt:'asc'},{id:'asc'}],take:limit});
 const results: {id:string;status:'SUCCEEDED'|'RETRY'|'SKIPPED'}[]=[];
 for(const row of rows){
  const lease=new Date(Date.now()+5*60_000);
  const claim=await prisma.wmsAgingSchedule.updateMany({where:{id:row.id,revision:row.revision,enabled:true,nextRunAt:row.nextRunAt},data:{nextRunAt:lease}});
  if(!claim.count){results.push({id:row.id,status:'SKIPPED'});continue;}
  try{
   // Confirm the claimed revision remains enabled before starting the bounded capture.
   if(!await prisma.wmsAgingSchedule.findFirst({where:{id:row.id,revision:row.revision,enabled:true,nextRunAt:lease}})){results.push({id:row.id,status:'SKIPPED'});continue;}
   await captureAgingSnapshot({organizationId:row.organizationId,workspaceId:row.workspaceId,actorUserId:row.actorUserId},{warehouseId:row.warehouseId,policyReference:row.policyReference});
   const next=new Date();next.setUTCHours(24,0,0,0);
   await prisma.wmsAgingSchedule.updateMany({where:{id:row.id,revision:row.revision,nextRunAt:lease},data:{nextRunAt:next,lastSucceededAt:new Date(),lastError:null}});
   results.push({id:row.id,status:'SUCCEEDED'});
  }catch(error){
   // Authorization failures remain visible and retriable after permission/configuration repair.
   await prisma.wmsAgingSchedule.updateMany({where:{id:row.id,revision:row.revision,nextRunAt:lease},data:{nextRunAt:new Date(Date.now()+60*60_000),lastError:error instanceof WmsError?error.message.slice(0,1000):'快照失败；检查权限、仓库和口径配置。'}});
   results.push({id:row.id,status:'RETRY'});
  }
 }
 return results;
}
