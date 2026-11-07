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

test("live rejects unlimited budgets, requires exact approval, counts calls and stops at finite cap", async () => {
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
  const input = { requirement: "Isolated protocol test", marketplace: "US", skills: SKILLS.map(name => ({ name, markdown: "test", path: "test", sha256: "test", tools: [] })),
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
    assert.equal(dispatches, 1); assert.equal(run.gate?.kind, "BILLING");
    assert.equal(run.calls[0].billing, "UNKNOWN"); assert.equal(run.calls[0].knownUnits, undefined);
    await engine.step(run.id); assert.equal(dispatches, 1);
    run = await engine.decide(run.id, { kind: "RECONCILE", gateId: run.gate!.id, callId: run.calls[0].id, units: 1, receipt: "Isolated test receipt" });
    run = await engine.step(run.id);
    run = await engine.decide(run.id, { kind: "AUTHORIZE_TOOL", gateId: run.gate!.id, callId: run.pendingActionId });
    run = await engine.step(run.id);
    assert.equal(run.gate?.kind, "BUDGET"); assert.equal(dispatches, 1);
    // Legacy persisted live mock runs remain readable, but cannot dispatch.
    const legacy = await engine.create(input);
    await store.transaction(legacy.id, async (saved, save) => { saved.budgetMode = "mock_unlimited"; await save(); });
    assert.equal((await engine.inspect(legacy.id)).budgetMode, "mock_unlimited");
    await assert.rejects(engine.step(legacy.id), /LIVE_BUDGET_REVIEW_REQUIRED/);
    assert.equal(dispatches, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
