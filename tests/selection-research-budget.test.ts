import test from "node:test";
import assert from "node:assert/strict";
import { researchBudgetPreview, researchUsage } from "@/lib/selection-research/budget";
import { researchFixture } from "@/lib/selection-research/fixture";
import type { Run } from "@/lib/selection-research/types";

test("unlimited budget preview never invents forecasts, credits or free provider pricing", async () => {
  const fixture = researchFixture();
  const preview = researchBudgetPreview({ skills: [{ name: "amazon-niche-finder", markdown: "test", path: "test", sha256: "test", tools: [] }],
    registry: await fixture.transport.listTools(), policies: fixture.policies, limits: { fixture: 3 }, budgetMode: "mock_unlimited" });
  assert.equal(preview.simulated, true);
  assert.equal(preview.providerLimits.fixture, null);
  assert.equal(preview.stages[0].estimatedCalls, null);
  assert.equal(preview.stages[0].credits, null);
  assert.ok(preview.stages[0].tools.every(tool => tool.callLimit === null));
  assert.match(preview.message, /不代表免费/);
});

test("request usage cannot turn call units or legacy receipts into confirmed credits", () => {
  const base = { provider: "isolated", paid: true, billing: "CONFIRMED", knownUnits: 2, dispatch: "ATTEMPTED" };
  const usage = researchUsage({ calls: [base, { ...base, billingUnit: "calls" }, { ...base, billingUnit: "credits" },
    { ...base, billing: "UNKNOWN", billingUnit: "credits" }, { ...base, dispatch: "NOT_SENT" }] } as unknown as Run);
  assert.deepEqual(usage.isolated, { calls: 4, unknownBillingCalls: 1, confirmedCredits: 2, unknownCreditCalls: 3 });
});

test("live rejects unlimited budgets, applies first task approval and stops at its finite cap", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { LocalResearchStore } = await import("@/lib/selection-research/file-store");
  const { ResearchEngine } = await import("@/lib/selection-research/engine");
  const { SKILLS } = await import("@/lib/selection-research/types");
  const root = await mkdtemp(tmpdir() + "/budget-isolated-");
  let dispatches = 0;
  const definition = { name: "market_find_products", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } };
  const store = new LocalResearchStore(root);
  const scope = { organizationId: "isolated", workspaceId: "isolated", ownerId: "isolated" };
  const engine = new ResearchEngine(store, scope, {
    async listTools() { return [definition]; }, async callTool() { dispatches++; return { note: "Isolated protocol response; no market facts" }; },
  }, { async next() { return { type: "call", tool: definition.name, arguments: { query: "isolated-" + dispatches } }; } }, { mode: "live", authorizeLive: async () => true });
  const input = { requirement: "Isolated protocol test。付费请求必须先批准。", marketplace: "US", skills: SKILLS.map(name => ({ name, markdown: "test", path: "test", sha256: "test", tools: [] })),
    policies: { [definition.name]: { provider: "isolated", paid: true, unit: "calls" as const, units: 1, maxCalls: 3, stages: [1], pricingSource: "unknown" } }, limits: { isolated: 1 } };
  try {
    await assert.rejects(engine.create({ ...input, budgetMode: "mock_unlimited" }), /LIVE_BUDGET_REVIEW_REQUIRED/);
    let run = await engine.create(input);
    run = await engine.step(run.id);
    assert.equal(run.gate?.kind, "MCP_CALL"); assert.equal(dispatches, 0);
    await engine.step(run.id); assert.equal(dispatches, 0);
    await assert.rejects(engine.decide(run.id, { kind: "AUTHORIZE_TOOL", gateId: run.gate!.id, callId: "wrong" }), /PENDING_TOOL_CALL_MISMATCH/);
    run = await engine.decide(run.id, { kind: "AUTHORIZE_TOOL", gateId: run.gate!.id, callId: run.pendingActionId });
    run = await engine.step(run.id);
    assert.equal(dispatches, 1); assert.equal(run.gate, undefined);
    assert.equal(run.calls[0].billing, "UNKNOWN"); assert.equal(run.calls[0].knownUnits, undefined);
    assert.ok(run.paidCallAuthorization); assert.equal(run.calls[0].authorizationId, run.paidCallAuthorization?.id);
    run = await engine.step(run.id); assert.equal(run.gate?.kind, "BUDGET"); assert.equal(dispatches, 1);
    // Legacy persisted live mock runs remain readable, but cannot dispatch.
    const legacy = await engine.create(input);
    await store.transaction(legacy.id, async (saved, save) => { saved.budgetMode = "mock_unlimited"; await save(); });
    assert.equal((await engine.inspect(legacy.id)).budgetMode, "mock_unlimited");
    await assert.rejects(engine.step(legacy.id), /LIVE_BUDGET_REVIEW_REQUIRED/);
    assert.equal(dispatches, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Codex actions never invoke server AI, require current revision and retain paid approval", async () => {
 const { mkdtemp, rm } = await import("node:fs/promises"); const { tmpdir } = await import("node:os");
 const { LocalResearchStore } = await import("@/lib/selection-research/file-store"); const { ResearchEngine } = await import("@/lib/selection-research/engine"); const { SKILLS } = await import("@/lib/selection-research/types");
 const root = await mkdtemp(tmpdir()+"/codex-action-"); let modelCalls=0, dispatches=0;
 const store=new LocalResearchStore(root); const tool={name:"market_find_products",inputSchema:{type:"object",properties:{query:{type:"string"}},required:["query"]}};
 const engine=new ResearchEngine(store,{organizationId:"isolated",workspaceId:"isolated",ownerId:"isolated"},{async listTools(){return [tool];},async callTool(){dispatches++;return {records:[]};}},{async next(){modelCalls++;throw new Error("SERVER_MODEL_MUST_NOT_RUN");}},{mode:"live",authorizeLive:async()=>true});
 try {
  let run=await engine.create({executionMode:"codex",requirement:"Isolated Codex client test。付费请求必须先批准。",marketplace:"US",skills:SKILLS.map(name=>({name,path:"test",markdown:"test",sha256:"test",tools:[]})),policies:{market_find_products:{provider:"isolated",paid:true,unit:"calls",units:1,maxCalls:1,stages:[1],pricingSource:"unknown"}},limits:{isolated:1}});
  const action={type:"call" as const,tool:"market_find_products",arguments:{query:"isolated"}};
  await assert.rejects(engine.step(run.id,{action,revision:run.revision+1}),/STALE_EXTERNAL_RESEARCH_ACTION/);
  run=await engine.step(run.id,{action,revision:run.revision});assert.equal(run.gate?.kind,"MCP_CALL");assert.equal(dispatches,0);assert.equal(modelCalls,0);
  run=await engine.decide(run.id,{kind:"AUTHORIZE_TOOL",gateId:run.gate!.id,callId:run.pendingActionId});
  await assert.rejects(engine.step(run.id,{action,revision:run.revision}),/EXTERNAL_ACTION_CANNOT_REPLACE_APPROVAL/);
  run=await engine.step(run.id);assert.equal(dispatches,1);assert.equal(modelCalls,0);assert.equal(run.gate,undefined);assert.ok(run.paidCallAuthorization);
 }finally{await rm(root,{recursive:true,force:true});}
});

test("first paid approval is saved as a run-scoped grant and later calls continue within frozen limits", async () => {
 const { mkdtemp, rm } = await import("node:fs/promises"); const { tmpdir } = await import("node:os");
 const { LocalResearchStore } = await import("@/lib/selection-research/file-store"); const { ResearchEngine } = await import("@/lib/selection-research/engine"); const { SKILLS } = await import("@/lib/selection-research/types");
 const root=await mkdtemp(tmpdir()+"/research-standing-approval-");let dispatches=0;
 const tools=["market_find_products","market_research_keyword"].map(name=>({name,inputSchema:{type:"object",properties:{query:{type:"string"}},required:["query"]}}));
 const policies=Object.fromEntries(tools.map(tool=>[tool.name,{provider:"sellersprite",paid:true,unit:"calls" as const,units:1,maxCalls:3,stages:[1],pricingSource:"unknown"}]));
 const engine=new ResearchEngine(new LocalResearchStore(root),{organizationId:"isolated",workspaceId:"isolated",ownerId:"isolated"},{async listTools(){return tools;},async callTool(){dispatches++;return {records:[]};}},{async next(){throw new Error("SERVER_MODEL_MUST_NOT_RUN");}},{mode:"live",authorizeLive:async()=>true});
 try {
  let run=await engine.create({executionMode:"codex",requirement:"Isolated task-level paid approval。付费请求必须先批准。",marketplace:"US",skills:SKILLS.map(name=>({name,path:"test",markdown:"test",sha256:"test",tools:[]})),policies,limits:{sellersprite:2},registry:tools});
  const action=(tool:string,query:string)=>({type:"call" as const,tool,arguments:{query}});
  run=await engine.step(run.id,{action:action(tools[0].name,"first"),revision:run.revision});
  assert.equal(run.gate?.kind,"MCP_CALL");assert.equal(dispatches,0);
  run=await engine.decide(run.id,{kind:"AUTHORIZE_TOOL",gateId:run.gate!.id,callId:run.pendingActionId});
  assert.ok(run.paidCallAuthorization?.id);assert.equal(run.decisions.at(-1)?.decision.authorizationId,run.paidCallAuthorization?.id);
  run=await engine.step(run.id);
  assert.equal(dispatches,1);assert.equal(run.gate,undefined);assert.equal(run.calls[0].billing,"UNKNOWN");
  assert.equal(run.calls[0].authorizationMode,"FIRST_APPROVAL");assert.equal(run.calls[0].authorizationId,run.paidCallAuthorization?.id);
  run=await engine.step(run.id,{action:action(tools[1].name,"second"),revision:run.revision});
  assert.equal(dispatches,2);assert.equal(run.gate,undefined);assert.equal(run.status,"RESUMABLE");
  assert.equal(run.calls[1].authorizationMode,"TASK_APPROVAL");assert.equal(run.calls[1].authorizationId,run.calls[0].authorizationId);
  run=await engine.step(run.id,{action:action(tools[0].name,"third"),revision:run.revision});
  assert.equal(dispatches,2);assert.equal(run.gate?.kind,"BUDGET");assert.match(run.gate!.reason,/will not request an automatic increase/);
  await assert.rejects(engine.decide(run.id,{kind:"INCREASE_BUDGET",gateId:run.gate!.id,limits:{sellersprite:3}}),/BUDGET_INCREASE_NOT_ALLOWED_AFTER_RESEARCH_AUTHORIZATION/);
  assert.equal((await engine.inspect(run.id)).limits.sellersprite,2);
 }finally{await rm(root,{recursive:true,force:true});}
});

test("a task-level grant continues past unknown charges without replay", async () => {
 const { mkdtemp, rm } = await import("node:fs/promises"); const { tmpdir } = await import("node:os");
 const { LocalResearchStore } = await import("@/lib/selection-research/file-store"); const { ResearchEngine } = await import("@/lib/selection-research/engine"); const { SKILLS } = await import("@/lib/selection-research/types");
 const root=await mkdtemp(tmpdir()+"/research-standing-unknown-");let dispatches=0;
 const tool={name:"market_find_products",inputSchema:{type:"object",properties:{query:{type:"string"}},required:["query"]}};
 const engine=new ResearchEngine(new LocalResearchStore(root),{organizationId:"isolated",workspaceId:"isolated",ownerId:"isolated"},{async listTools(){return [tool];},async callTool(){dispatches++;throw new Error("isolated transport outcome unknown");}},{async next(){throw new Error("SERVER_MODEL_MUST_NOT_RUN");}},{mode:"live",authorizeLive:async()=>true});
 try {
  let run=await engine.create({executionMode:"codex",requirement:"Isolated unknown billing behavior。付费请求必须先批准。",marketplace:"US",skills:SKILLS.map(name=>({name,path:"test",markdown:"test",sha256:"test",tools:[]})),policies:{[tool.name]:{provider:"sellersprite",paid:true,unit:"calls",units:1,maxCalls:3,stages:[1],pricingSource:"unknown"}},limits:{sellersprite:3},registry:[tool]});
  run=await engine.step(run.id,{action:{type:"call",tool:tool.name,arguments:{query:"first"}},revision:run.revision});
  run=await engine.decide(run.id,{kind:"AUTHORIZE_TOOL",gateId:run.gate!.id,callId:run.pendingActionId});
  run=await engine.step(run.id);
  assert.equal(dispatches,1);assert.equal(run.gate,undefined);assert.equal(run.status,"RESUMABLE");assert.equal(run.calls[0].status,"FAILED");assert.equal(run.calls[0].billing,"UNKNOWN");
  assert.equal(run.calls[0].authorizationId,run.paidCallAuthorization?.id);
  await engine.step(run.id);assert.equal(dispatches,1);
 }finally{await rm(root,{recursive:true,force:true});}
});

test("saved owner consent executes new and already pending paid requests without a page decision", async () => {
 const { mkdtemp, rm } = await import("node:fs/promises"); const { tmpdir } = await import("node:os");
 const { LocalResearchStore } = await import("@/lib/selection-research/file-store"); const { ResearchEngine } = await import("@/lib/selection-research/engine"); const { SKILLS } = await import("@/lib/selection-research/types");
 const root = await mkdtemp(tmpdir()+"/saved-paid-consent-"); let dispatches = 0;
 const store = new LocalResearchStore(root), scope = {organizationId:"isolated",workspaceId:"isolated",ownerId:"owner"};
 const tool = {name:"market_find_products",inputSchema:{type:"object",properties:{query:{type:"string"}},required:["query"]}};
 const transport = {async listTools(){return [tool];},async callTool(){dispatches++;return {records:[]};}};
 const agent = {async next(){return {type:"call" as const,tool:tool.name,arguments:{query:"query-"+dispatches}};}};
 const consent = {id:"saved-consent",approvedAt:new Date().toISOString(),approvedByUserId:scope.ownerId};
 const make = (paidCallConsent?: typeof consent) => new ResearchEngine(store,scope,transport,agent,{mode:"live",authorizeLive:async()=>true,paidCallConsent});
 const input = {requirement:"Isolated saved consent。付费请求必须先批准。",marketplace:"US",skills:SKILLS.map(name=>({name,path:"test",markdown:"test",sha256:"test",tools:[]})),registry:[tool],policies:{[tool.name]:{provider:"sellersprite",paid:true,unit:"calls" as const,units:1,maxCalls:2,stages:[1],pricingSource:"unknown"}},limits:{sellersprite:2}};
 try {
  let pending = await make().create(input); pending = await make().step(pending.id);
  assert.equal(pending.gate?.kind,"MCP_CALL"); assert.equal(dispatches,0);
  const wrong = await make({...consent,approvedByUserId:"other"}).step(pending.id);
  assert.equal(wrong.gate?.kind,"MCP_CALL"); assert.equal(dispatches,0);
  pending = await make(consent).step(pending.id);
  assert.equal(dispatches,1); assert.equal(pending.gate,undefined);
  assert.equal(pending.paidCallAuthorization?.consentId,consent.id);
  pending = await make(consent).step(pending.id); assert.equal(dispatches,2);
  pending = await make(consent).step(pending.id); assert.equal(pending.gate?.kind,"BUDGET"); assert.equal(dispatches,2);
  let fresh = await make(consent).create(input); fresh = await make(consent).step(fresh.id);
  assert.equal(dispatches,3); assert.equal(fresh.gate,undefined); assert.equal(fresh.decisions.length,1);
  await store.transaction(fresh.id,async(run,save)=>{run.status="WAITING_FOR_USER";run.gate={id:"business",kind:"NICHE",reason:"select"};await save();});
  fresh = await make(consent).step(fresh.id); assert.equal(fresh.gate?.kind,"NICHE"); assert.equal(dispatches,3);
 } finally {await rm(root,{recursive:true,force:true});}
});

test("chat decisions preserve the human quote and reject stale or replayed decisions", async () => {
 const {mkdtemp,rm}=await import("node:fs/promises");const {tmpdir}=await import("node:os");
 const {LocalResearchStore}=await import("@/lib/selection-research/file-store");const {ResearchEngine}=await import("@/lib/selection-research/engine");const {SKILLS}=await import("@/lib/selection-research/types");
 const root=await mkdtemp(tmpdir()+"/chat-decision-");const store=new LocalResearchStore(root);
 const engine=new ResearchEngine(store,{organizationId:"test",workspaceId:"test",ownerId:"test"},{async listTools(){return[];},async callTool(){throw new Error("NO_DISPATCH");}},{async next(){throw new Error("NO_MODEL");}},{mode:"fixture"});
 try {
  let run=await engine.create({requirement:"Isolated confirmation。付费请求必须先批准。",marketplace:"US",skills:SKILLS.map(name=>({name,path:"test",markdown:"test",sha256:"test",tools:[]})),policies:{},limits:{}});
  await store.transaction(run.id,async(saved,save)=>{saved.status="WAITING_FOR_USER";saved.gate={id:"select-gate",kind:"NICHE",reason:"select"};saved.results=[{summary:"test",claims:[],candidates:[{id:"a",name:"A"},{id:"b",name:"B"},{id:"c",name:"C"}]}];await save();});
  run=await engine.inspect(run.id);
  const decision={gateId:"select-gate",kind:"SELECT" as const,candidateId:"b",confirmation:{channel:"chat" as const,text:"选第二个"}};
  await assert.rejects(engine.decide(run.id,decision,run.revision-1),/STALE_RESEARCH_DECISION/);
  run=await engine.decide(run.id,decision,run.revision);
  assert.equal(run.selectedCandidateId,"b");assert.equal(run.decisions.at(-1)?.decision.confirmation?.text,"选第二个");
  await assert.rejects(engine.decide(run.id,decision,run.revision),/STALE_OR_MISSING_GATE/);
  await store.transaction(run.id,async(saved,save)=>{saved.status="WAITING_FOR_USER";saved.gate={id:"final-gate",kind:"FINAL",reason:"confirm"};await save();});
  run=await engine.inspect(run.id);
  run=await engine.decide(run.id,{gateId:"final-gate",kind:"CONFIRM",confirmation:{channel:"chat",text:"确认结论，生成文档"}},run.revision);
  assert.equal(run.status,"COMPLETED");assert.equal(run.decisions.length,2);
 }finally{await rm(root,{recursive:true,force:true});}
});
