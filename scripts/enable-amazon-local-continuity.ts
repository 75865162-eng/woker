import { targetEnvironment } from '../src/lib/amazon-sync/approval-policy';
import { prisma } from '../src/lib/db/prisma';
import { assertAmazonScopeAdmin, assertAmazonAction } from '../src/lib/amazon-sync/data-access';
import { continuityAction, continuityPolicyDigest, continuitySites } from '../src/lib/amazon-sync/continuity-policy';
import { scopeLock } from '../src/lib/amazon-sync/service';
const scope={organizationId:'amazon-live-local',workspaceId:'default'};
async function main(){
 const url=new URL(process.env.DATABASE_URL??'invalid:');
 if(process.argv[2]!=='--apply-approved-local'||url.hostname!=='127.0.0.1'||url.port!=='55439'||url.pathname!=='/amazon_sync_live_local'||targetEnvironment()!=='local')throw Error('Reviewed local target required');
 const auth=await prisma.amazonSpApiAuthorization.findUniqueOrThrow({where:{id:'3895911f-89c4-4ebd-8212-dc58bede447e'}});
 if(auth.revision!==3||auth.status!=='CONFIGURED'||auth.organizationId!==scope.organizationId||auth.workspaceId!==scope.workspaceId)throw Error('Authorization changed');
 await assertAmazonScopeAdmin(scope,auth.updatedByUserId);await assertAmazonAction(scope,auth.updatedByUserId,'approve');
 const sources=await prisma.amazonSyncDataSource.findMany({where:{...scope,authorizationId:auth.id,marketplaceId:{in:continuitySites},resource:{in:['orders','listing_details','inventory_age']},enabled:true}});
 if(sources.length!==12)throw Error('Reviewed twelve sources required');
 await prisma.$transaction(async tx=>{await scopeLock(tx,scope);for(const s of sources){const key='amazon-continuity-v1:'+s.id;const existing=await tx.auditLog.findUnique({where:{idempotencyKey:key}});if(existing)continue;await tx.auditLog.create({data:{idempotencyKey:key,organizationId:scope.organizationId,userId:auth.updatedByUserId,action:continuityAction,entityType:'AmazonSyncDataSource',entityId:s.id,metadata:{...scope,enabled:true,authorizationId:auth.id,authorizationRevision:auth.revision,marketplaceId:s.marketplaceId,resource:s.resource,resumePlan:true,policyDigest:continuityPolicyDigest(s.resource==='orders'?s.orderPolicy:s.domainPolicy),approvedAt:new Date().toISOString(),approval:'User explicitly approved local long-term repair and controlled execution, 2026-11-07',nextCheckAt:new Date(0).toISOString()}}});}});
 console.log(JSON.stringify({enabled:true,sources:sources.length,credentialsChanged:false,cursorsReset:false}));
}
main().catch(e=>{console.error(e.name, e.message==='Reviewed local target required'||e.message==='Authorization changed'||e.message==='Reviewed twelve sources required'?e.message:'Controlled enablement failed');process.exitCode=1}).finally(()=>prisma.$disconnect());
