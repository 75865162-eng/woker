import assert from "node:assert/strict";
import test from "node:test";
import { createHandoff, handoffSchemas, validateHandoff, type ChainStage, type HandoffKind } from "@/lib/agent-platform/handoff";
import { resolveLaunchOutput, verifyLaunchApproval, type LaunchApprovalRecord } from "@/lib/agent-platform/launch-gate";
import { createAgentRuntime } from "@/lib/agent-platform/runtime";
import { createMarketAgentExecutionExecutor, marketAgentDefinition, marketToolDefinitions } from "@/lib/agent-platform/market";
import { createSelectionAdapter } from "@/lib/agent-platform/selection";
import { createOrchestratorExecutionExecutor, createOrchestratorInternalAdapter, orchestratorAgentDefinition, orchestratorToolDefinitions } from "@/lib/agent-platform/orchestrator";

const identity = { organizationId: "org", userId: "actor", workspaceId: "workspace" };
const reference = { approvalId: "approval", executionId: "execution", planId: "plan" };
function approvedRecord(): LaunchApprovalRecord {
  return {
    id: "approval", organizationId: "org", executionId: "execution", status: "APPROVED",
    decidedAt: new Date("2026-10-25T01:00:00Z"), decidedByUserId: "reviewer", expiresAt: new Date("2026-10-25T02:00:00Z"),
    action: { type: "orchestrator.launch.approve", target: "launch", payload: { planId: "plan" } },
    execution: { organizationId: "org", workspaceId: "workspace", agentDefinitionId: "orchestrator", output: { plan: { planId: "plan" } } },
  };
}

test("all six v1 contracts round trip while versions, destinations, scope and malformed fields fail", () => {
  assert.deepEqual(Object.keys(handoffSchemas).sort(), ["Opportunity", "PRD", "SupplierShortlist", "ListingDraft", "LaunchTicket", "PpcPlan"].sort());
  for (const [kind, to] of [["Opportunity", "product"], ["PRD", "supplier"], ["SupplierShortlist", "listing"], ["ListingDraft", "launch"], ["LaunchTicket", "ppc"], ["PpcPlan", "ppc"]] as [HandoffKind, ChainStage][]) {
    const payload = createHandoff({ goal: "test", marketplace: "US", launchApproval: reference, status: "ready" }, { ...identity, kind, from: "orchestrator", to, sourceExecutionId: "execution" });
    assert.equal(validateHandoff(JSON.parse(JSON.stringify(payload)), to, identity)._handoff?.kind, kind);
    assert.throws(() => validateHandoff(payload, to, { ...identity, workspaceId: "other" }), /工作区/);
    assert.throws(() => validateHandoff(payload, to, { ...identity, organizationId: "other" }), /组织/);
    assert.throws(() => validateHandoff(payload, to, { ...identity, userId: "other" }), /用户/);
    assert.throws(() => validateHandoff({ ...payload, _handoff: { ...payload._handoff, version: 99 } }, to, identity), /版本/);
    assert.throws(() => validateHandoff({ ...payload, supplierReport: [] }, to, identity), /格式/);
  }
  assert.equal(validateHandoff({ goal: "legacy", marketplace: "US" }, "product", identity).goal, "legacy");
  assert.throws(() => validateHandoff({ goal: "legacy", launchApproved: true }, "ppc", identity), /审批/);
  assert.throws(() => createHandoff({ goal: "test", marketplace: "US" }, { ...identity, kind: "PRD", from: "market", to: "supplier", sourceExecutionId: "execution" }), /顺序/);
});

test("Launch authority is bound to persisted action, execution, organization, workspace and plan", () => {
  assert.equal(verifyLaunchApproval(reference, approvedRecord(), identity), true);
  for (const status of ["REQUESTED", "REJECTED", "EXPIRED"]) assert.equal(verifyLaunchApproval(reference, { ...approvedRecord(), status }, identity), false);
  for (const key of ["approvalId", "executionId", "planId"]) assert.equal(verifyLaunchApproval({ ...reference, [key]: "other" }, approvedRecord(), identity), false);
  assert.equal(verifyLaunchApproval(reference, approvedRecord(), { ...identity, workspaceId: "other" }), false);
  assert.equal(verifyLaunchApproval(reference, approvedRecord(), { ...identity, organizationId: "other" }), false);
  assert.equal(verifyLaunchApproval(reference, { ...approvedRecord(), decidedAt: new Date("2026-10-25T03:00:00Z") }, identity), false);
  assert.equal(verifyLaunchApproval(reference, { ...approvedRecord(), decidedByUserId: null }, identity), false);
  assert.equal(verifyLaunchApproval(reference, { ...approvedRecord(), action: { type: "amazon.ads.apply", payload: { planId: "plan" } } }, identity), false);
  assert.equal(verifyLaunchApproval({ launchApproved: true }, null, identity), false);
});

test("approved Launch updates only the original plan and PPC handoff; rejection stays blocked", async () => {
  const runtime = createAgentRuntime({ definitions: [orchestratorAgentDefinition], tools: orchestratorToolDefinitions, adapters: [createOrchestratorInternalAdapter()] });
  const result = await runtime.run({ agentId: "orchestrator", context: {}, input: {}, executor: createOrchestratorExecutionExecutor({ request: { listingDraft: { title: "Draft" } } }) });
  const output = result.execution.output as unknown as { plan: { planId: string } };
  const ref = { ...reference, executionId: result.execution.id, planId: output.plan.planId };
  const approved = resolveLaunchOutput(output, true, ref);
  assert.equal(approved.plan.launchGate.status, "approved");
  assert.equal(approved.plan.stages.find((stage) => stage.id === "ppc")?.status, "ready");
  assert.deepEqual(approved.handoffs.find((handoff) => handoff.to === "ppc")?.payload.launchApproval, ref);
  assert.equal(resolveLaunchOutput(output, false, ref).plan.stages.find((stage) => stage.id === "ppc")?.status, "blocked_until_launch");
  assert.throws(() => resolveLaunchOutput(output, true, { ...ref, planId: "other" }), /match/);
  // Pure output transform cannot silently rewrite the original snapshot.
  assert.notEqual((output as unknown as typeof approved).plan.launchGate.status, "approved");
});

test("selection tool is registered but missing Round B yields explicit failure with zero fabricated evidence", async () => {
  const runtime = createAgentRuntime({ definitions: [marketAgentDefinition], tools: marketToolDefinitions, adapters: [createSelectionAdapter()] });
  const result = await runtime.run({ agentId: "market", context: {}, input: {}, executor: createMarketAgentExecutionExecutor({ request: { selectionRun: true, marketplace: "US", keyword: "test" } }) });
  assert.equal(result.execution.status, "FAILED");
  assert.equal(result.toolCalls.length, 1);
  assert.equal(result.toolCalls[0].toolId, "market.selection.run");
  assert.equal(result.execution.error?.code, "NOT_IMPLEMENTED");
  assert.equal(result.execution.output, undefined);
});
