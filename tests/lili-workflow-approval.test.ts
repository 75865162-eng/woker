import test from "node:test";
import assert from "node:assert/strict";
import { listSkills, listWorkflows } from "@/lib/lili/catalog";
import { executeSyncChat, syncSourcesWithinScope, type SyncChatPreview } from "@/lib/lili/sync-chat-tools";
import { runCatalogTool } from "@/lib/lili/tool-execution";

test("every shipped skill and workflow uses single-task Codex chat approval without rewriting SOP bodies", () => {
 for (const entry of [...listSkills(),...listWorkflows()]) {
  assert.match(entry.promptZh,/审批统一在 Codex 对话中完成/);
  assert.match(entry.promptEn,/All Lili approvals happen in Codex chat/);
  assert.match(entry.promptZh,/不重复索要批准/);
 }
 assert.equal(listWorkflows().length,12);
});
function setup(status="REQUESTED") {
 let row:SyncChatPreview={id:"request-1",operation:"run",requestedByUserId:"owner",changeDigest:"a".repeat(64),baseRevision:4,status,expiresAt:new Date(Date.now()+60_000)};
 let approvals=0,applications=0,quote="";
 const deps={async inspect(){return structuredClone(row);},async approve(text:string){approvals++;quote=text;row={...row,status:"APPROVED"};return structuredClone(row);},async apply(){applications++;row={...row,status:"APPLIED"};return {queued:true};}};
 return {deps,get:()=>({approvals,applications,quote}),set:(patch:Partial<SyncChatPreview>)=>{row={...row,...patch};}};
}
const args={workspaceId:"own",requestId:"request-1",expectedDigest:"a".repeat(64),expectedRevision:4,userConfirmation:"批准这份同步方案并执行"};
test("one chat confirmation approves and applies the bounded plan; reads and repeated submission never dispatch",async()=>{
 const f=setup();
 const preview=await executeSyncChat("workflow_sync_review",{workspaceId:"own",requestId:"request-1"},f.deps);
 assert.equal(preview.nextAction?.kind,"CHAT_CONFIRM");assert.equal(f.get().applications,0);
 await executeSyncChat("workflow_sync_confirm",args,f.deps);
 assert.deepEqual(f.get(),{approvals:1,applications:1,quote:args.userConfirmation});
 const again=await executeSyncChat("workflow_sync_confirm",args,f.deps);
 assert.equal(again.alreadyApplied,true);assert.equal(f.get().applications,1);
});
test("interrupted approved plan can apply without a second decision; stale/expired/unsupported plans cannot",async()=>{
 const resumed=setup("APPROVED");await executeSyncChat("workflow_sync_confirm",args,resumed.deps);assert.equal(resumed.get().approvals,0);assert.equal(resumed.get().applications,1);
 for(const patch of [{changeDigest:"b".repeat(64)},{baseRevision:5},{expiresAt:new Date(0)},{operation:"save-authorization"},{status:"REJECTED"}]) {
  const f=setup();f.set(patch);
  await assert.rejects(executeSyncChat("workflow_sync_confirm",args,f.deps));assert.equal(f.get().applications,0);assert.equal(f.get().approvals,0);
 }
 const f=setup();await assert.rejects(executeSyncChat("workflow_sync_confirm",{...args,userConfirmation:" "},f.deps));assert.equal(f.get().approvals,0);
 const changed=setup();changed.deps.approve=async()=>({id:"request-1",operation:"run",requestedByUserId:"owner",changeDigest:args.expectedDigest,baseRevision:4,status:"STALE",expiresAt:new Date()});
 await assert.rejects(executeSyncChat("workflow_sync_confirm",args,changed.deps),/NOT_APPROVED/);assert.equal(changed.get().applications,0);
});
test("unmapped catalog execution explicitly stays in chat and never reports success",async()=>{
 const r=await runCatalogTool("ads_generate_recommendations",{store_scope:"fixture-profile"});
 assert.equal(r.status,501);assert.equal(r.body.ok,false);assert.equal(r.body.nextAction?.browserRequired,false);
});

test("chat confirmation supports one scoped first-batch recovery, never other task controls", async () => {
 const retry = { operation: "control-task", targetId: "failed-order-task", afterSummary: { id: "failed-order-task", control: "retry" }, domains: ["orders"], sourceIds: ["source"], marketplaceIds: ["US"] };
 const f = setup(); f.set(retry);
 await executeSyncChat("workflow_sync_confirm", args, f.deps);
 assert.equal(f.get().applications, 1);
 const paused = setup(); paused.set({ ...retry, afterSummary: { id: retry.targetId, control: "resume" } });
 await executeSyncChat("workflow_sync_confirm", args, paused.deps);
 assert.equal(paused.get().applications, 1);
 for (const resource of ["finance", "returns", "reimbursements", "inventory_events", "fulfillment", "catalog_items", "listing_details"]) {
  const supported = setup(); supported.set({ ...retry, domains: [resource] });
  await executeSyncChat("workflow_sync_confirm", args, supported.deps);
  assert.equal(supported.get().applications, 1);
 }
 for (const patch of [{ afterSummary: { id: "other", control: "retry" } }, { afterSummary: { id: "failed-order-task", control: "cancel" } }, { domains: ["pricing"] }, { sourceIds: ["a", "b"] }, { marketplaceIds: ["US", "CA"] }]) {
  const rejected = setup(); rejected.set({ ...retry, ...patch });
  await assert.rejects(executeSyncChat("workflow_sync_confirm", args, rejected.deps), /UNSUPPORTED/);
  assert.equal(rejected.get().approvals, 0); assert.equal(rejected.get().applications, 0);
 }
});

test("sync execution requires the intersection of explicit credential and current sync grants",()=>{
 const sources=[{id:"source-1",sellerAccountId:"seller-a",marketplaceId:"US"}];
 const scopes=[{sellerAccountId:"seller-a",marketplaceIds:["US"]}];
 assert.equal(syncSourcesWithinScope(sources,["source-1"],scopes,scopes),true);
 for(const [rows,ids,credential,access] of [
  [sources,["source-1"],scopes,[]], [sources,["source-1"],[],scopes],
  [sources,["source-1"],[{sellerAccountId:"seller-a",marketplaceIds:["CA"]}],scopes],
  [sources,["source-1"],scopes,[{sellerAccountId:"seller-b",marketplaceIds:["US"]}]],
  [[],["source-1"],scopes,scopes], [sources,["other"],scopes,scopes],
 ] as const) assert.equal(syncSourcesWithinScope([...rows],[...ids],[...credential],[...access]),false);
});
