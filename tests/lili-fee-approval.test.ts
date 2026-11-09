import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { ResearchEngine } from '@/lib/selection-research/engine';
import { LocalResearchStore } from '@/lib/selection-research/file-store';
import { SKILLS } from '@/lib/selection-research/types';
import { researchFeeReviewRequired } from '@/lib/selection-research/fee-policy';

async function fixture(skill = 'Research using real evidence.') {
 const root = await mkdtemp(tmpdir() + '/fee-policy-');
 const store = new LocalResearchStore(root);
 const tool = { name: 'market_research_keyword', inputSchema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } };
 let sent = 0;
 const engine = new ResearchEngine(store, {organizationId:'test',workspaceId:'test',ownerId:'owner'}, {async listTools(){return [tool];},async callTool(){sent++;if(sent===1)throw new Error('unsafe response');return {records:[]};}}, {async next(){return {type:'call' as const,tool:tool.name,arguments:{query:'next-'+sent}};}}, {mode:'live',authorizeLive:async()=>true});
 const run = await engine.create({requirement:'Research back quiver',marketplace:'US',budgetMode:'uncapped',skills:SKILLS.map(name=>({name,path:'fixture',markdown:skill,sha256:'fixture',tools:[]})),policies:{[tool.name]:{provider:'sellersprite',paid:true,units:1,unit:'calls',pricingSource:'unknown',maxCalls:3,stages:[1]}},limits:{sellersprite:3}});
 return {root,store,engine,run,sent:()=>sent};
}
test('unknown fees do not create approval gates, retries stay blocked, other queries can continue',async()=>{
 const f=await fixture();try {
 let r=await f.engine.step(f.run.id);assert.equal(f.sent(),1);assert.equal(r.gate,undefined);assert.equal(r.status,'RESUMABLE');assert.equal(r.calls[0].billing,'UNKNOWN');assert.equal(r.calls[0].knownUnits,undefined);assert.equal(r.calls[0].status,'FAILED');
 r=await f.engine.step(r.id);assert.equal(f.sent(),2);assert.equal(r.gate,undefined);assert.equal(r.calls[0].billing,'UNKNOWN');assert.equal(r.decisions.length,0);
 await f.store.transaction(r.id,async(saved,save)=>{saved.executionMode='codex';await save();});r=await f.engine.inspect(r.id);
 r=await f.engine.step(r.id,{action:{type:'call',tool:'market_research_keyword',arguments:{query:'next-0'}},revision:r.revision});assert.equal(r.failure,'DUPLICATE_CALL_REQUIRES_REVIEW');assert.equal(f.sent(),2);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('fee policy respects explicit English and Chinese instructions, negation and active stage',()=>{
 const run={requirement:'Research products',stage:1,skills:SKILLS.map(name=>({name,path:'fixture',markdown:'Research only',sha256:'fixture',tools:[]}))};
 assert.equal(researchFeeReviewRequired(run),false);
 assert.equal(researchFeeReviewRequired({...run,requirement:'付费请求必须先批准。'}),true);
 assert.equal(researchFeeReviewRequired({...run,requirement:'Paid calls require approval before execution.'}),true);
 assert.equal(researchFeeReviewRequired({...run,requirement:'不要发起费用审批。'}),false);
 assert.equal(researchFeeReviewRequired({...run,requirement:'Do not require paid call approval.'}),false);
 run.skills[1].markdown='付费请求必须先批准。';
 assert.equal(researchFeeReviewRequired(run),false);
 assert.equal(researchFeeReviewRequired({...run,stage:2}),true);
});
test('explicit Skill fee approval remains and does not dispatch before confirmation',async()=>{
 const f=await fixture('任何会产生费用或修改店铺的步骤，先把预览给运营确认。');try{const r=await f.engine.step(f.run.id);assert.equal(r.gate?.kind,'MCP_CALL');assert.equal(f.sent(),0);}finally{await rm(f.root,{recursive:true,force:true});}
});
test('legacy billing pause can resume with unknown fees, no forged receipt and no dispatch',async()=>{
 const f=await fixture();try{let r=await f.engine.step(f.run.id);await f.store.transaction(r.id,async(saved,save)=>{saved.status='WAITING_FOR_USER';saved.gate={id:'legacy',kind:'BILLING',reason:'unknown fee'};saved.skills[0].markdown='费用核对必须先确认。';saved.calls[0].status='UNKNOWN';await save();});r=await f.engine.resume(r.id);assert.equal(r.gate,undefined);assert.equal(r.status,'RESUMABLE');assert.equal(r.calls[0].billing,'UNKNOWN');assert.equal(r.calls[0].knownUnits,undefined);assert.equal(f.sent(),1);assert.equal(r.decisions.length,0);}finally{await rm(f.root,{recursive:true,force:true});}
});

test('explicit Skill approval never reintroduces billing pauses after an unsafe paid response', async()=>{
 const f=await fixture('任何会产生费用或修改店铺的步骤，先把预览给运营确认。');try{
 let r=await f.engine.step(f.run.id);
 r=await f.engine.decide(r.id,{kind:'AUTHORIZE_TOOL',gateId:r.gate!.id,callId:r.pendingActionId});
 r=await f.engine.step(r.id);assert.equal(r.gate,undefined);assert.equal(r.status,'RESUMABLE');assert.equal(r.calls[0].billing,'UNKNOWN');assert.equal(r.calls[0].errorCode,'TRANSPORT_OR_UNSAFE_RESPONSE');
 r=await f.engine.step(r.id);assert.equal(f.sent(),2);assert.equal(r.gate,undefined);assert.equal(r.calls[1].status,'SUCCEEDED');assert.equal(r.calls[1].billing,'UNKNOWN');assert.equal(r.decisions.length,1);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
test('step releases historical billing gates even under explicit Skill requirements',async()=>{
 const f=await fixture();try{
 let r=await f.engine.step(f.run.id);
 await f.store.transaction(r.id,async(saved,save)=>{saved.skills[0].markdown='费用核对必须先确认。';saved.status='WAITING_FOR_USER';saved.gate={id:'legacy',kind:'BILLING',reason:'unknown'};saved.calls[0].status='IN_FLIGHT';await save();});
 r=await f.engine.step(r.id);assert.notEqual(r.gate?.kind,'BILLING');assert.equal(r.calls[0].billing,'UNKNOWN');assert.equal(r.calls[0].errorCode,'OUTCOME_UNVERIFIED_NOT_REPLAYED');assert.equal(f.sent(),1);assert.equal(r.decisions.length,0);
 }finally{await rm(f.root,{recursive:true,force:true});}
});
