import test from "node:test";
import assert from "node:assert/strict";
import { evaluateResearchEconomics, evaluateProductScorecard, type ResearchEconomicsScenario } from "@/lib/selection-research/economics";
import { parseResearchBrief } from "@/lib/selection-research/brief";

const scenario = (): ResearchEconomicsScenario => {
  const input = { currency: "USD", price: 30, procurement: 5, internationalFreight: 2, importCharges: 1, referralFee: 4, fbaFee: 5, advertising: 3, storage: 1, returnsAllowance: 1 };
  return { name: "Isolated cost assumptions", input, quantity: 100, fixedCosts: 80,
    basis: Object.fromEntries(Object.keys(input).filter(key => key !== "currency").map(key => [key, { kind: "assumption", evidenceIds: [], note: "Isolated arithmetic fixture" }])) };
};

test("decision economics calculates contribution, batch landed costs and fixed-cost break-even", () => {
  const result = evaluateResearchEconomics(scenario());
  assert.equal(result.status, "CALCULATED");
  assert.equal(result.calculation?.contribution, 8);
  assert.equal(result.calculation?.contributionRate, 8 / 30);
  assert.equal(result.calculation?.batchLandedCost, 800);
  assert.equal(result.calculation?.batchAfterFixedCosts, 720);
  assert.equal(result.calculation?.breakEvenUnits, 10);
  assert.equal(result.calculation?.breakEvenPrice, 22);
});

test("unknown fees, quantity and fixed costs never become zero-cost profitable defaults", () => {
  const data = scenario(); data.input.fbaFee = null;
  assert.deepEqual(evaluateResearchEconomics(data), { status: "NEEDS_DATA", missing: ["fbaFee"], calculation: null });
  data.input.fbaFee = 5; data.quantity = null; data.fixedCosts = null;
  assert.equal(evaluateResearchEconomics(data).calculation?.batchLandedCost, null);
  assert.equal(evaluateResearchEconomics(data).calculation?.breakEvenUnits, null);
  data.input.price = 1; data.fixedCosts = 80;
  assert.equal(evaluateResearchEconomics(data).calculation?.breakEvenUnits, null);
  data.quantity = -1;
  assert.throws(() => evaluateResearchEconomics(data), /INVALID_BATCH/);
});

test("cost facts need evidence and explicitly named basis; overflow cannot escape as a financial result", () => {
  const data = scenario(); delete data.basis.procurement;
  assert.throws(() => evaluateResearchEconomics(data), /COST_BASIS/);
  data.basis.procurement = { kind: "supplier_quote", evidenceIds: [], note: "Unverified quote" };
  assert.throws(() => evaluateResearchEconomics(data), /COST_BASIS/);
  data.basis.procurement.evidenceIds = ["isolated-call"];
  data.input.procurement = Number.MAX_VALUE; data.input.internationalFreight = Number.MAX_VALUE;
  assert.throws(() => evaluateResearchEconomics(data), /OVERFLOW/);
});

test("weighted scores require sum-one weights and do not hide missing dimensions", () => {
  const card = { candidateId: "test", dimensions: [
    { name: "Demand", weight: 0.6, score: 80, evidenceIds: ["isolated-call"], rationale: "test" },
    { name: "Competition", weight: 0.4, score: 50, evidenceIds: ["isolated-call"], rationale: "test" },
  ] };
  assert.equal(evaluateProductScorecard(card).total, 68);
  const missing = { ...card, dimensions: [card.dimensions[0], { ...card.dimensions[1], score: null, evidenceIds: [] }] };
  assert.equal(evaluateProductScorecard(missing).total, null);
  assert.equal(evaluateProductScorecard(missing).observedWeight, 0.6);
  assert.throws(() => evaluateProductScorecard({ ...card, dimensions: [{ ...card.dimensions[0], weight: 0.9 }] }), /WEIGHTS/);
  assert.throws(() => evaluateProductScorecard({ ...card, dimensions: [{ ...card.dimensions[0], weight: 1, evidenceIds: [] }] }), /INVALID_SCORE/);
});

test("intake preserves the original request and quotes explicit constraints without inventing defaults", () => {
  const request = "帮我研究 camping pouch，目标用户：hikers，采购500件，目标售价：USD 30，成本上限：USD 8，研究深度：深入";
  const brief = parseResearchBrief(request, "US");
  assert.equal(brief.originalRequirement, request);
  assert.equal(brief.productDirection?.value, "camping pouch");
  assert.equal(brief.procurementQuantity?.value, 500);
  assert.equal(brief.targetPrice?.value, "USD 30");
  assert.equal(brief.unresolved.length, 0);
  assert.equal(parseResearchBrief("Research any category", "CA").procurementQuantity, null);
  assert.equal(parseResearchBrief("采购500件，采购1000件", "US").procurementQuantity, null);
  assert.equal(parseResearchBrief("采购500件，purchase quantity:1000 units", "US").procurementQuantity, null);
});

test("live final GO cannot bypass deterministic analysis or hide assumed cost sources", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { ResearchEngine } = await import("@/lib/selection-research/engine");
  const { LocalResearchStore } = await import("@/lib/selection-research/file-store");
  const { SKILLS } = await import("@/lib/selection-research/types");
  const root = await mkdtemp(`${tmpdir()}/decision-isolated-`);
  try {
    const store = new LocalResearchStore(root);
    let analysis: import("@/lib/selection-research/economics").DecisionAnalysis | undefined = undefined;
    const engine = new ResearchEngine(store, { organizationId: "isolated", workspaceId: "isolated", ownerId: "isolated" },
      { async listTools() { return []; }, async callTool() { throw new Error("UNEXPECTED_DISPATCH"); } },
      { async next() { return { type: "complete", result: { summary: "test", claims: [{ text: "Test metadata only", kind: "observed", evidenceIds: ["isolated-call"] }], verdict: "GO", ...(analysis ? { decisionAnalysis: analysis } : {}) } }; } },
      { mode: "live", authorizeLive: async () => true });
    const run = await engine.create({ budgetMode: "reviewed", requirement: "Isolated final gate", marketplace: "US", skills: SKILLS.map(name => ({ name, markdown: "test", path: "test", sha256: "test", tools: [] })), policies: {}, limits: {} });
    await store.transaction(run.id, async (state, save) => {
      state.stage = 5;
      state.results = [{ summary: "test", claims: [], candidates: [{ id: "test", name: "test" }] }];
      state.calls = [{ id: "isolated-call", projectId: state.id, stage: 1, skill: SKILLS[0], service: "lili", provider: "isolated", tool: "market_find_products", arguments: {}, requestedAt: state.createdAt,
        status: "SUCCEEDED", paid: false, reservedUnits: 0, billing: "FREE", retryCount: 0, inputSchema: { type: "object" }, rawResponse: { note: "test evidence" } }];
      await save();
    });
    assert.equal((await engine.step(run.id)).failure, "GO_REQUIRES_RESOLVED_ASSUMPTIONS");
    await engine.recover(run.id);
    analysis = { scenarios: [scenario()], scorecards: [{ candidateId: "test", dimensions: [{ name: "test", weight: 1, score: 80, evidenceIds: ["isolated-call"], rationale: "test" }] }] };
    assert.equal((await engine.step(run.id)).failure, "GO_REQUIRES_RESOLVED_ASSUMPTIONS");
    await engine.recover(run.id);
    for (const basis of Object.values(analysis.scenarios[0].basis)) { basis!.kind = "observed"; basis!.evidenceIds = ["isolated-call"]; }
    const ready = await engine.step(run.id);
    assert.equal(ready.gate?.kind, "FINAL");
    assert.equal(ready.status, "WAITING_FOR_USER");
    await store.transaction(run.id, async (state, save) => {
      state.status = "RESUMABLE"; delete state.gate;
      const costs = { fob: 5, freight: 1, insurance: 0, brokerage: 0, warehouseInbound: 0, otherFees: 0, customsValue: 5 };
      state.results.push({ summary: "Unverified tax scenario", claims: [], landedCostScenarios: [{
        name: "Pressure only", currency: "USD", originCountry: "CN", destinationCountry: "US", asOf: "2026-11-07", quantity: 100,
        classification: { code: "4202.92", status: "candidate", evidenceIds: [], sourceUrl: null, applicableDate: null, note: "Test candidate" },
        method: "ad_valorem_additive", costs,
        basis: Object.fromEntries(Object.keys(costs).map(key => [key, { kind: "assumption", evidenceIds: [], note: "Test only" }])),
        rates: [{ name: "Test rate", kind: "base", rate: 0.1, status: "stress_test", evidenceIds: [], sourceUrl: null, applicableDate: null, note: "Not a verified real rate" }],
      }] });
      await save();
    });
    assert.equal((await engine.step(run.id)).failure, "GO_REQUIRES_RESOLVED_ASSUMPTIONS");
  } finally { await rm(root, { recursive: true, force: true }); }
});
