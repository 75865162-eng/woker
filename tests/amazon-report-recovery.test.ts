import { encryptCheckpoint } from "@/lib/amazon-sync/checkpoint";
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Prisma } from '@prisma/client';
import { previewReportRecovery } from '@/lib/amazon-sync/report-recovery';
import { normalizeCommand } from '@/lib/amazon-sync/approval-policy';
import { nextAutomaticReimbursementWindow } from '@/lib/amazon-sync/automatic-schedule';
const scope = { organizationId: 'fixture-org', workspaceId: 'fixture-workspace' };
function fixture() {
  const state = { active: 0, raw: 0, enabled: 0, source: { id: 'source', revision: 1, resource: 'reimbursements', marketplaceId: 'ATVPDKIKX0DER', lastSuccessAt: null, authorization: { revision: 2 }, resourceCursor: { id: 'cursor', activeRunId: 'old-failed', status: 'FAILED', lastSuccessAt: null, nextTokenCiphertext: null, reportStateCiphertext: null as string | null } }, run: { id: 'old-failed', status: 'FAILED', pagesCompleted: 0, processedCount: 0, insertedCount: 0, skippedCount: 0, checkpointCiphertext: null as string | null, updatedAt: new Date('2026-11-06T00:00:00Z') } };
  const tx = { amazonSyncDataSource: { findFirstOrThrow: async () => state.source }, amazonSyncReportDocument: { findFirst: async () => ({id:'document',status:'STAGED',rowCount:0}) }, amazonSyncReportRow: { count: async () => 0 }, amazonSyncRun: { findFirstOrThrow: async () => state.run, count: async () => state.active }, amazonSyncRawPage: { count: async () => state.raw, findFirst: async () => ({taskId:'old-failed',page:1,bodySha256:'hash'}) }, amazonSyncSchedule: { count: async () => state.enabled } } as unknown as Prisma.TransactionClient;
  return { state, tx };
}
test('report recovery preview binds original evidence and never mutates the failed task', async () => {
  const { state, tx } = fixture(); const before = JSON.stringify(state);
  const window = nextAutomaticReimbursementWindow(new Date('2026-11-06T12:00:00Z'));
  const p = await previewReportRecovery(tx, scope, 'source', window);
  assert.equal(JSON.stringify(state), before);
  assert.equal(p.run.id, 'old-failed'); assert.equal(p.proposed?.from, '2024-11-06');
  state.run.updatedAt = new Date('2026-11-06T00:01:00Z');
  assert.notEqual((await previewReportRecovery(tx, scope, 'source', window)).recoveryDigest, p.recoveryDigest);
  const cmd = normalizeCommand({ action: 'recover-report', id: 'source', revision: 1, recoveryDigest: p.recoveryDigest, reportWindow: window });
  assert.deepEqual(cmd.reportWindow, window);
});
for (const block of ['active', 'raw', 'enabled'] as const) test('report recovery rejects '+block+' progress or scheduling', async () => {
  const { state, tx } = fixture(); state[block] = 1;
  await assert.rejects(() => previewReportRecovery(tx, scope, 'source', nextAutomaticReimbursementWindow(new Date())));
});
test('report recovery rejects committed rows and successful history', async () => {
  const { state, tx } = fixture(); state.run.pagesCompleted = 1;
  await assert.rejects(() => previewReportRecovery(tx, scope, 'source', nextAutomaticReimbursementWindow(new Date())));
});
test('inventory event reconciliation keeps its dated DONE report checkpoint intact', async t => {
  const priorKey = process.env.AMAZON_SP_API_ENCRYPTION_KEY;
  process.env.AMAZON_SP_API_ENCRYPTION_KEY = Buffer.alloc(32, 73).toString('base64');
  t.after(() => { if (priorKey === undefined) delete process.env.AMAZON_SP_API_ENCRYPTION_KEY; else process.env.AMAZON_SP_API_ENCRYPTION_KEY = priorKey; });
  const { state, tx } = fixture();
  state.source.resource = 'inventory_events';
  state.source.marketplaceId = 'A2Q3Y263D00KWC';
  state.source.resourceCursor.reportStateCiphertext = encryptCheckpoint(JSON.stringify({ reportId: 'fixture-report', documentId: 'fixture-document', archiveTaskId:'old-failed', archivePage:1, rows:0, documentSaved:true, offset:0 }), scope, 'cursor')!;
  state.run.status = 'BLOCKED';
  state.run.checkpointCiphertext = state.source.resourceCursor.reportStateCiphertext;
  state.run.pagesCompleted = 1;
  state.run.checkpointCiphertext = state.source.resourceCursor.reportStateCiphertext;
  state.run.processedCount = 0;
  state.run.insertedCount = 0;
  state.run.skippedCount = 0;
  state.raw = 1;
  const before = JSON.stringify(state);
  const p = await previewReportRecovery(tx, scope, 'source');
  assert.equal(p.proposed, null);
  assert.equal(JSON.stringify(state), before);
});

test('inventory event apply accepts verified zero and partial progress without changing checkpoints', async t => {
  const { applyReportRecovery } = await import('@/lib/amazon-sync/report-recovery');
  const { withApprovedChange } = await import('@/lib/amazon-sync/approved-context');
  const { encryptAmazonSpApiCredentials } = await import('@/lib/amazon/integration-secrets');
  const { AmazonSpApiClient } = await import('@/lib/amazon/sp-api-client');
  const keys=['DATABASE_URL','AMAZON_DATA_CENTER_ENVIRONMENT','AMAZON_SP_API_ENCRYPTION_KEY'] as const;
  const prior=Object.fromEntries(keys.map(k=>[k,process.env[k]]));
  process.env.DATABASE_URL='postgresql://fixture:fixture@127.0.0.1:55439/amazon_sync_live_local';
  process.env.AMAZON_DATA_CENTER_ENVIRONMENT='local';
  process.env.AMAZON_SP_API_ENCRYPTION_KEY=Buffer.alloc(32,73).toString('base64');
  const getReport=AmazonSpApiClient.prototype.getReport;
  t.after(()=>{for(const k of keys){if(prior[k]===undefined)delete process.env[k];else process.env[k]=prior[k];}AmazonSpApiClient.prototype.getReport=getReport;});
  const local={organizationId:'amazon-live-local',workspaceId:'default'};
  for(const partial of [false,true]){
    const {state,tx}=fixture();state.source.resource='inventory_events';
    Object.assign(state.source,{authorizationId:'auth',authorization:{revision:2,awsRegion:'us-east-1',endpoint:'https://sellingpartnerapi-na.amazon.com',credentialsCiphertext:encryptAmazonSpApiCredentials({lwaClientId:'fixture',lwaClientSecret:'fixture',refreshToken:'fixture',awsAccessKeyId:'',awsSecretAccessKey:''},{...local,authorizationId:'auth'})}});
    const checkpoint=encryptCheckpoint(JSON.stringify({reportId:'fixture-report',documentId:'fixture-document',...(partial?{archiveTaskId:'old-failed',archivePage:1,rows:0,documentSaved:true,offset:0}:{})}),local,'cursor')!;
    state.source.resourceCursor.reportStateCiphertext=checkpoint;
    state.run.checkpointCiphertext=checkpoint;state.run.status='BLOCKED';
    if(partial){state.run.pagesCompleted=1;state.raw=1;}
    let audits=0,updates=0;
    Object.assign(tx,{auditLog:{create:async()=>{audits++;}},amazonSyncDataSource:{...tx.amazonSyncDataSource,update:async()=>{updates++;}}});
    AmazonSpApiClient.prototype.getReport=async()=>({reportId:'fixture-report',reportType:'GET_LEDGER_DETAIL_VIEW_DATA',marketplaceIds:[state.source.marketplaceId],processingStatus:'DONE',reportDocumentId:'fixture-document'});
    const p=await previewReportRecovery(tx,local,'source');
    const before=JSON.stringify(state);
    const result=await withApprovedChange({tx,scope:local,action:'recover-report',approvalId:'fixture-approval'},()=>applyReportRecovery(local,'fixture-actor',{id:'source',revision:1,recoveryDigest:p.recoveryDigest}));
    assert.equal(result.oldTaskPreserved,true);assert.equal(audits,1);assert.equal(updates,1);assert.equal(JSON.stringify(state),before);
  }
});
