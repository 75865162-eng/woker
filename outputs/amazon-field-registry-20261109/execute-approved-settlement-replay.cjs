// Operator execution of the exact 2026-11-09 approved local settlement plan.
// Preload root runtime configuration. All mutations use existing approval services.
const fs = require('node:fs');
const { createHash } = require('node:crypto');
const { prisma } = require('../../src/lib/db/prisma');
const { requestChange, decideChange, applyChange } = require('../../src/lib/amazon-sync/change-approval');
const { readSettlementCurrencyRepairPreview } = require('../../src/lib/amazon-sync/settlement-currency-repair');
const { readActualFieldCoverage } = require('../../src/lib/amazon-sync/actual-field-coverage');
const { readDomainReports } = require('../../src/lib/amazon-sync/domain-reports-query');
const { activeTaskStatuses } = require('../../src/lib/amazon-sync/policy');
const { digest } = require('../../src/lib/amazon-sync/approval-policy');
const base = __dirname;
const plan = JSON.parse(fs.readFileSync(`${base}/settlement-live-replay-plan.json`, 'utf8'));
const supplement = JSON.parse(fs.readFileSync(`${base}/settlement-migration-approval-supplement.json`, 'utf8'));
const file = `${base}/settlement-live-execution.json`;
const scope = { organizationId: 'amazon-live-local', workspaceId: 'default' };
const actor = 'cmw1ml22b0000208ov5k9954k';
const ids = plan.sources.map(s => s.sourceId);
const docIds = plan.sources.flatMap(s => s.reportDocumentIds);
const sha = text => createHash('sha256').update(text).digest('hex');
let httpAttempts = 0;
globalThis.fetch = async () => { httpAttempts++; throw Error('HTTP_FORBIDDEN_IN_ARCHIVE_REPAIR'); };
let state;
function save() { state.updatedAt = new Date().toISOString(); state.httpAttempts = httpAttempts; fs.writeFileSync(file, JSON.stringify(state, null, 2)+'\n', {mode:0o600}); }
function check(value, message) { if (!value) throw Error(message); }
async function target() {
 const u = new URL(process.env.DATABASE_URL);
 check(u.hostname==='127.0.0.1' && u.port==='55439' && u.pathname==='/amazon_sync_live_local', 'TARGET_CHANGED');
 for (const m of supplement.migrations) check(sha(fs.readFileSync(m.path))===m.sha256,'MIGRATION_SQL_CHANGED');
 const db = await prisma.$queryRaw`SELECT current_database() AS name, inet_server_port() AS port`;
 check(db[0].name==='amazon_sync_live_local' && db[0].port===5432,'DATABASE_IDENTITY_CHANGED');
 const sources = await prisma.amazonSyncDataSource.findMany({where:{...scope,id:{in:ids}},select:{id:true,revision:true,authorizationId:true,authorization:{select:{revision:true,status:true}}}});
 check(sources.length===4 && sources.every(s=>plan.sources.some(p=>p.sourceId===s.id && p.revision===s.revision && p.authorizationId===s.authorizationId && p.authorizationRevision===s.authorization.revision && s.authorization.status==='CONFIGURED')),'SOURCE_OR_AUTH_CHANGED');
}
async function snapshot() {
 return prisma.$transaction(async tx=>{
  await tx.$executeRaw`SET TRANSACTION READ ONLY`;
  const documents=await tx.amazonSyncReportDocument.findMany({where:{...scope,id:{in:docIds}},orderBy:{id:'asc'}});
  check(documents.length===8,'DOCUMENT_COUNT_CHANGED');
  const select={id:true,sourceId:true,reportDocumentId:true,rowNumber:true,rowHash:true,amountOriginal:true};
  const site=await tx.amazonSyncReportRow.findMany({where:{...scope,reportDocumentId:{in:docIds}},select,orderBy:{id:'asc'}});
  const reports=await tx.amazonSettlementReport.findMany({where:{...scope,authorizationId:plan.sources[0].authorizationId,reportId:{in:documents.map(d=>d.reportId)}},orderBy:{id:'asc'}});
  const canonical=await tx.amazonSettlementRow.findMany({where:{...scope,sourceId:{in:ids},reportDocumentId:{in:reports.map(r=>r.id)}},select,orderBy:{id:'asc'}});
  const raws=await tx.amazonSyncRawPage.findMany({where:{...scope,resource:'settlements',bodySha256:{in:documents.map(d=>d.contentSha256)},task:{source:{authorizationId:plan.sources[0].authorizationId}}},select:{taskId:true,page:true,bodySha256:true,rawCiphertext:true,requestMetadata:true},orderBy:[{taskId:'asc'},{page:'asc'}]});
  return {siteRows:site.length,canonicalRows:canonical.length,siteIdentityAmountDigest:digest(site),canonicalIdentityAmountDigest:digest(canonical),siteDocumentDigest:digest(documents),canonicalDocumentDigest:digest(reports),rawDigest:digest(raws),rawCount:raws.length};
 },{timeout:30000,isolationLevel:'RepeatableRead'});
}
async function noActive() { check(await prisma.amazonSyncRun.count({where:{...scope,sourceId:{in:ids},status:{in:activeTaskStatuses}}})===0,'ACTIVE_TASKS_PRESENT'); }
async function change(key,command) {
 let entry=state.changes[key];
 if (!entry) {
  const row=await requestChange(scope,actor,command);
  entry=state.changes[key]={id:row.id,commandDigest:digest(command),status:row.status};save();
 }
 check(entry.commandDigest===digest(command),'COMMAND_CHANGED');
 let row=await prisma.amazonDataCenterChangeRequest.findFirstOrThrow({where:{...scope,id:entry.id}});
 if(row.status==='REQUESTED') { await decideChange(scope,actor,row.id,'APPROVED','用户在 Codex 明确回复“批准”：按补充清单执行本机三项迁移及八份结算原件币种修复，完成后恢复四计划。');row=await prisma.amazonDataCenterChangeRequest.findUniqueOrThrow({where:{id:row.id}}); }
 check(['APPROVED','APPLIED'].includes(row.status),'APPROVAL_NOT_APPLICABLE');
 if(row.status==='APPROVED') await applyChange(scope,actor,row.id);
 row=await prisma.amazonDataCenterChangeRequest.findUniqueOrThrow({where:{id:row.id}});
 check(row.status==='APPLIED','CHANGE_NOT_APPLIED');entry.status=row.status;save();
}
function command(p,enabled) {return {action:'save-plan',id:p.id,revision:p.revision,name:p.name,resource:p.resource,enabled,mode:p.mode,intervalMinutes:p.intervalMinutes,priority:p.priority,maxAttempts:p.maxAttempts,retentionDays:p.retentionDays,sourceIds:p.targets.map(t=>t.sourceId)};}
async function main() {
 const mode=process.argv[2]; check(['pause','repair','verify','resume'].includes(mode),'MODE_REQUIRED');
 await target();
 if(fs.existsSync(file)) state=JSON.parse(fs.readFileSync(file,'utf8'));
 else {
  check(mode==='pause','PAUSE_FIRST');
  await noActive();
  const plans=await prisma.amazonSyncSchedule.findMany({where:{...scope,id:{in:plan.relatedPlans.map(p=>p.id)}},include:{targets:{select:{sourceId:true}}},orderBy:{id:'asc'}});
  check(plans.length===4 && plans.every(p=>p.enabled && p.revision===6 && p.targets.length===1 && ids.includes(p.targets[0].sourceId)),'PLAN_CHANGED');
  state={startedAt:new Date().toISOString(),status:'PREFLIGHT_PASSED',target:supplement.target,scope,actor,approvalQuote:'批准',approvedMigrationSha256:supplement.migrations.map(m=>({name:m.name,sha256:m.sha256})),originalPlans:plans,changes:{},pre:await snapshot(),repairs:[],httpAttempts:0};
  check(state.pre.siteRows===16757,'EXPECTED_SITE_ROWS_CHANGED');save();
 }
 if(mode==='pause') {
  for(const p of state.originalPlans) {const current=await prisma.amazonSyncSchedule.findUniqueOrThrow({where:{id:p.id}});check((current.revision===6&&current.enabled)||(current.revision===7&&!current.enabled),'PLAN_CHANGED');await change(`pause:${p.id}`,command(p,false));}
  await noActive();state.status='PLANS_PAUSED';save();
 }
 if(mode==='repair') {
  check(state.status==='PLANS_PAUSED','REPAIR_STAGE_MISMATCH');await noActive();
  const migrated=await prisma.$queryRaw`SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
  check(supplement.migrations.every(m=>migrated.some(r=>r.migration_name===m.name)),'MIGRATION_NOT_APPLIED');
  check(digest(await snapshot())===digest(state.pre),'PRE_REPAIR_INVARIANT_CHANGED');
  for(const s of plan.sources) {
   const preview=await readSettlementCurrencyRepairPreview(scope,actor,new URLSearchParams({sourceId:s.sourceId,reportDocumentIds:s.reportDocumentIds.join(',')}));
   const planned=preview.manifest.documents.reduce((n,d)=>n+d.currencyPatches,0);
   const repair={sourceId:s.sourceId,manifest:preview.manifest,recoveryDigest:preview.recoveryDigest,plannedSiteRows:planned,plannedCanonicalRows:preview.manifest.documents.reduce((n,d)=>n+d.canonicalCurrencyPatches,0)};
   state.repairs.push(repair);save();
   await change(`repair:${s.sourceId}`,preview.command);
   const after=await readSettlementCurrencyRepairPreview(scope,actor,new URLSearchParams({sourceId:s.sourceId,reportDocumentIds:s.reportDocumentIds.join(',')}));
   check(after.manifest.documents.every(d=>d.currencyPatches===0 && d.canonicalCurrencyPatches===0),'RESIDUAL_RECOVERABLE_CURRENCY');
   repair.applied=true;save();
  }
  state.status='REPAIRED';save();
 }
 if(mode==='verify') {
  check(['REPAIRED','VERIFIED'].includes(state.status),'VERIFY_STAGE_MISMATCH');await noActive();
  state.post=await snapshot();check(digest(state.post)===digest(state.pre),'POST_REPAIR_INVARIANT_CHANGED');
  const rows=await prisma.amazonSyncReportRow.findMany({where:{...scope,reportDocumentId:{in:docIds}},select:{id:true,currencyCode:true,currencySource:true,currencySourceRowNumber:true,amountOriginal:true,businessDate:true}});
  state.verification={invariantsPreserved:true,siteRows:rows.length,siteMissingCurrency:rows.filter(r=>!r.currencyCode).length,siteAmountMissingCurrency:rows.filter(r=>r.amountOriginal!==null&&!r.currencyCode).length,targetBusinessDateRows:rows.filter(r=>r.businessDate>='2026-10-10'&&r.businessDate<='2026-11-08').length,currencyCounts:rows.reduce((a,r)=>(a[r.currencyCode??'NULL']=(a[r.currencyCode??'NULL']??0)+1,a),{}),headerProvenanceRows:rows.filter(r=>r.currencySource==='SETTLEMENT_HEADER'&&r.currencySourceRowNumber>0).length};
  check(state.verification.siteMissingCurrency===0,'SITE_CURRENCY_STILL_MISSING');
  const scopedDocuments=await prisma.amazonSyncReportDocument.findMany({where:{...scope,id:{in:docIds}},select:{reportId:true}});
  const canonicalDocuments=await prisma.amazonSettlementReport.findMany({where:{...scope,authorizationId:plan.sources[0].authorizationId,reportId:{in:scopedDocuments.map(d=>d.reportId)}},select:{id:true}});
  const canonicalRows=await prisma.amazonSettlementRow.findMany({where:{...scope,sourceId:{in:ids},reportDocumentId:{in:canonicalDocuments.map(d=>d.id)}},select:{currencyCode:true,currencySource:true,currencySourceRowNumber:true}});
  state.verification.canonicalRows=canonicalRows.length;
  state.verification.canonicalMissingCurrency=canonicalRows.filter(r=>!r.currencyCode).length;
  state.verification.canonicalHeaderProvenanceRows=canonicalRows.filter(r=>r.currencySource==='SETTLEMENT_HEADER'&&r.currencySourceRowNumber>0).length;
  check(canonicalRows.length===16757&&state.verification.canonicalMissingCurrency===0,'CANONICAL_CURRENCY_STILL_MISSING');
  state.verification.allSettlementSiteRows=await prisma.amazonSyncReportRow.count({where:{...scope,sourceId:{in:ids}}});
  state.verification.allSettlementSiteRowsMissingCurrency=await prisma.amazonSyncReportRow.count({where:{...scope,sourceId:{in:ids},OR:[{currencyCode:null},{currencyCode:''}]}});
  state.persistenceEvents=await prisma.auditLog.groupBy({by:['action'],where:{organizationId:scope.organizationId,action:{in:['amazon.sync.fields.persistence-checked','amazon.sync.settlement.currency-reparsed','amazon.sync.quality.checked']},AND:[{metadata:{path:['workspaceId'],equals:scope.workspaceId}},{OR:ids.map(id=>({metadata:{path:['sourceId'],equals:id}}))}]},_count:true});

  state.coverage=[];state.businessQueries=[];
  for(const s of plan.sources) {
   for(const documentId of s.reportDocumentIds) {
    const doc=await prisma.amazonSyncReportDocument.findUniqueOrThrow({where:{id:documentId},select:{reportId:true}});
    const q=await readDomainReports(scope,new URLSearchParams({resource:'settlements',sourceId:s.sourceId,reportId:doc.reportId,pageSize:'50'}),actor);
    let checked=0,missing=0;
    for(let page=1;page<=q.pagination.pageCount;page++) {
     const result=page===1?q:await readDomainReports(scope,new URLSearchParams({resource:'settlements',sourceId:s.sourceId,reportId:doc.reportId,pageSize:'50',page:String(page)}),actor);
     checked+=result.rows.length;missing+=result.rows.filter(r=>!r.currencyCode).length;
    }
    check(checked===q.pagination.total&&missing===0,'BUSINESS_QUERY_FAILED');state.businessQueries.push({sourceId:s.sourceId,documentId,visibleRows:q.pagination.total,checkedRows:checked,missingCurrency:missing});
   }
   state.coverage.push(await readActualFieldCoverage(scope,new URLSearchParams({sourceId:s.sourceId,from:'2026-10-10',to:'2026-11-08'}),actor));save();
  }
  check(state.businessQueries.reduce((n,q)=>n+q.checkedRows,0)===16757,'BUSINESS_TOTAL_CHANGED');
  state.status='VERIFIED';save();
 }
 if(mode==='resume') {
  check(state.status==='VERIFIED','RESUME_REQUIRES_VERIFICATION');
  for(const p of state.originalPlans) {const current=await prisma.amazonSyncSchedule.findUniqueOrThrow({where:{id:p.id}});check((current.revision===7&&!current.enabled)||(current.revision===8&&current.enabled),'PLAN_CHANGED_BEFORE_RESUME');await change(`resume:${p.id}`,command({...p,revision:7},true));}
  state.finalPlans=await prisma.amazonSyncSchedule.findMany({where:{...scope,id:{in:state.originalPlans.map(p=>p.id)}},select:{id:true,revision:true,enabled:true}});
  check(state.finalPlans.every(p=>p.enabled&&p.revision===8),'PLAN_RESTORE_FAILED');state.status='COMPLETE';save();
 }
 console.log(JSON.stringify({status:state.status,pre:state.pre,verification:state.verification,appliedRepairs:state.repairs.map(r=>({sourceId:r.sourceId,siteRows:r.plannedSiteRows,canonicalRows:r.plannedCanonicalRows,applied:r.applied})),finalPlans:state.finalPlans,httpAttempts},null,2));
}
main().catch(e=>{if(state){state.lastFailure={at:new Date().toISOString(),name:e.name,code:e.code??null,message:/^[A-Z_]+$/.test(e.message)?e.message:'SERVICE_REJECTED_REVIEW_REQUIRED'};save();} console.error(e instanceof Error?e.message:'Execution failed');process.exitCode=1;}).finally(()=>prisma.$disconnect());
