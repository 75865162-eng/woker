import { assertAmazonScopeAdmin, assertAmazonAction } from "./data-access";
import type { Prisma } from '@prisma/client';
import type { SyncScope } from './policy';
import { continuityAction, continuityPolicyDigest, continuityTargetAllowed } from './continuity-policy';
type Source = SyncScope & { id: string; marketplaceId: string; resource: string; authorizationId: string; authorization: { revision: number }; orderPolicy: unknown; domainPolicy: unknown };
/** A persisted, explicit local grant authorizes renewal, never a role claim. */
export async function continuityGrant(db: Prisma.TransactionClient, source: Source) {
  if (!continuityTargetAllowed(source, source.marketplaceId, source.resource)) return null;
  const grant = await db.auditLog.findUnique({ where: { idempotencyKey: 'amazon-continuity-v1:' + source.id } });
  const m = grant?.metadata as Prisma.JsonObject | null;
  if (!grant || grant.action !== continuityAction || grant.organizationId !== source.organizationId || grant.entityId !== source.id || m?.enabled !== true || m.workspaceId !== source.workspaceId || m.authorizationId !== source.authorizationId || m.authorizationRevision !== source.authorization.revision || m.marketplaceId !== source.marketplaceId || m.resource !== source.resource) return null;
  return { grant, metadata: m };
}
export async function continuityEvidence(db: Prisma.TransactionClient, source: Source) {
  const grant = await continuityGrant(db,source); if (!grant) return undefined;
  if (!grant.grant.userId) return undefined;
  try { await assertAmazonScopeAdmin(source, grant.grant.userId, db); await assertAmazonAction(source, grant.grant.userId, 'approve', db); } catch { return undefined; }
  const m=grant.metadata;
  if (m.policyDigest !== continuityPolicyDigest(source.resource==='orders'?source.orderPolicy:source.domainPolicy)) return undefined;
  return typeof m.accessEvidence === 'string' ? m.accessEvidence : undefined;
}
/** Oldest actual search call wins; a waiting source cannot repeatedly lose to
 * a newly-created empty window. Caller holds the seller operation bucket lock. */
export async function continuityOrderTurn(db: Prisma.TransactionClient, source: Source, runId: string) {
  if (!await continuityGrant(db,source)) return true;
  const peers=await db.amazonSyncRun.findMany({where:{organizationId:source.organizationId,workspaceId:source.workspaceId,resource:'orders',status:{in:['WAITING','QUEUED','RUNNING','RETRY_WAIT']},source:{authorizationId:source.authorizationId,enabled:true,resourceCursor:{listComplete:false}},stage:{not:'FETCHING_DETAILS'}},select:{id:true,sourceId:true,startedAt:true},take:20});
  const activity=await Promise.all(peers.map(async p=>({...p,last:await db.amazonSyncTaskLog.findFirst({where:{organizationId:source.organizationId,workspaceId:source.workspaceId,task:{sourceId:p.sourceId},event:'searchOrders'},orderBy:{createdAt:'desc'},select:{createdAt:true}})})));
  activity.sort((a,b)=>(a.last?.createdAt.getTime()??0)-(b.last?.createdAt.getTime()??0)||a.startedAt.getTime()-b.startedAt.getTime()||a.id.localeCompare(b.id));
  return !activity.length||activity[0].id===runId;
}
/** A due capability probe gets the next shared slot instead of starving behind
 * continuous detail work. Other tenants/operations keep their existing behavior. */
export async function continuityProbeDue(db: Prisma.TransactionClient, source: Source, now = new Date()) {
  if(source.resource==='listing_details'||source.resource==='orders'){
    const peers=await db.amazonSyncDataSource.findMany({where:{organizationId:source.organizationId,workspaceId:source.workspaceId,authorizationId:source.authorizationId,enabled:true,resource:source.resource},include:{authorization:{select:{revision:true}}},take:20});
    for(const peer of peers){
      const g=await continuityGrant(db,peer);
      if(!g||g.metadata.policyDigest!==continuityPolicyDigest(peer.resource==='orders'?peer.orderPolicy:peer.domainPolicy)||!g.grant.userId)continue;
      try{await assertAmazonScopeAdmin(peer,g.grant.userId,db);await assertAmazonAction(peer,g.grant.userId,'approve',db);}catch{continue;}
      if(typeof g.metadata.accessEvidence==='string'&&typeof g.metadata.proofExpiresAt==='string'&&Date.parse(g.metadata.proofExpiresAt)>=now.getTime()+3600000)continue;
      if(source.resource==='orders'){if(await db.amazonOrderRecord.count({where:{organizationId:peer.organizationId,workspaceId:peer.workspaceId,sourceId:peer.id}}))return true;continue;}
      const policy=peer.domainPolicy as Prisma.JsonObject|null;
      if(Array.isArray(policy?.sellerSkus)&&policy.sellerSkus.length)return true;
      const discovery=policy?.discovery as Prisma.JsonObject|undefined;
      if(typeof discovery?.sourceId==='string'){
        const head=await db.amazonSyncDataSource.findFirst({where:{id:discovery.sourceId,organizationId:peer.organizationId,workspaceId:peer.workspaceId,authorizationId:peer.authorizationId,marketplaceId:peer.marketplaceId,resource:'catalog'},select:{activeRunId:true}});
        if(head?.activeRunId&&await db.amazonCatalogSnapshot.count({where:{organizationId:peer.organizationId,workspaceId:peer.workspaceId,sellerAccountId:peer.sellerAccountId,marketplaceId:peer.marketplaceId,sourceRunId:head.activeRunId}}))return true;
      }
    }
    return false;
  }
  const g=await continuityGrant(db,source);
  return !!g && source.resource!=='inventory_age' && (typeof g.metadata.accessEvidence!=='string'||typeof g.metadata.proofExpiresAt!=='string'||Date.parse(g.metadata.proofExpiresAt)<now.getTime()+3600000);
}
