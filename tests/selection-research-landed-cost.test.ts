import test from "node:test";
import assert from "node:assert/strict";
import { calculateLandedCostScenario, landedCostEvidenceIds, type LandedCostScenario } from "@/lib/selection-research/landed-cost";
import { renderResearchStageReport } from "@/lib/selection-research/report";
import type { Run } from "@/lib/selection-research/types";

function scenario(): LandedCostScenario {
  const costs = { fob: 10, freight: 2, insurance: 0.5, brokerage: 0.2, warehouseInbound: 0.3, otherFees: 0, customsValue: 10 };
  return { name: "Isolated pressure scenario", currency: "USD", originCountry: "CN", destinationCountry: "US", asOf: "2026-11-07", quantity: 100,
    classification: { code: "4202.92", status: "candidate", evidenceIds: [], sourceUrl: null, applicableDate: null, note: "Test candidate only, not real classification" },
    method: "ad_valorem_additive", costs,
    basis: Object.fromEntries(Object.keys(costs).map(field => [field, { kind: "assumption", evidenceIds: [], note: "Isolated arithmetic fixture, not a quote" }])),
    rates: [{ name: "test base", kind: "base", rate: 0.1, status: "stress_test", evidenceIds: [], sourceUrl: null, applicableDate: null, note: "Test rate, not real tariff" },
      { name: "test additional", kind: "additional", rate: 0.25, status: "stress_test", evidenceIds: [], sourceUrl: null, applicableDate: null, note: "Test pressure rate only" }],
  };
}

test("landed cost calculates base/additional taxes separately and does not double-count customs value", () => {
  const result = calculateLandedCostScenario(scenario());
  assert.equal(result.calculation?.baseDuty, 1);
  assert.equal(result.calculation?.additionalDuty, 2.5);
  assert.equal(result.calculation?.unitLandedCost, 16.5);
  assert.equal(result.calculation?.batchLandedCost, 1650);
  assert.equal(result.calculation?.hasUnverifiedInputs, true);
  assert.equal(result.calculation?.taxes[1].status, "stress_test");
});

test("unknown or unsupported taxes remain unknown, and no batch quantity is invented", () => {
  const data = scenario(); data.rates[0].rate = null; data.rates[0].status = "pending";
  assert.equal(calculateLandedCostScenario(data).calculation, null);
  assert.deepEqual(calculateLandedCostScenario(data).missing, ["rate:test base"]);
  data.rates[0].rate = 0.1; data.costs.insurance = null;
  assert.deepEqual(calculateLandedCostScenario(data).missing, ["insurance"]);
  data.costs.insurance = 0.5; data.method = "unsupported";
  assert.deepEqual(calculateLandedCostScenario(data).missing, ["unsupported_tax_method"]);
  data.method = "ad_valorem_additive"; data.quantity = null;
  assert.equal(calculateLandedCostScenario(data).calculation?.batchLandedCost, null);
});

test("verified source metadata and applicability cannot be replaced by an old URL alone", () => {
  const data = scenario(); data.rates[0].status = "verified";
  assert.throws(() => calculateLandedCostScenario(data), /VERIFIED_TARIFF_SOURCE_REQUIRED/);
  Object.assign(data.rates[0], { sourceUrl: "https://isolated.invalid/tax", applicableDate: "2026-11-08", evidenceIds: ["isolated-call"] });
  assert.throws(() => calculateLandedCostScenario(data), /INVALID_TARIFF_APPLICABILITY/);
  data.rates[0].applicableDate = "2026-02-30";
  assert.throws(() => calculateLandedCostScenario(data), /INVALID_TARIFF_SOURCE/);
  data.rates[0].applicableDate = "2026-01-01";
  assert.equal(calculateLandedCostScenario(data).calculation?.hasUnverifiedInputs, true);
});

test("tariff arithmetic rejects invalid amounts, duplicate tax lines and overflow", () => {
  const data = scenario(); data.costs.freight = -1;
  assert.throws(() => calculateLandedCostScenario(data), /INVALID_LANDED_COST_INPUT/);
  data.costs.freight = 2; data.rates.push({ ...data.rates[1] });
  assert.throws(() => calculateLandedCostScenario(data), /INVALID_LANDED_COST_SCENARIO/);
  data.rates.pop(); delete data.basis.fob;
  assert.throws(() => calculateLandedCostScenario(data), /COST_BASIS_REQUIRED/);
  data.basis.fob = { kind: "assumption", evidenceIds: [], note: "test" };
  data.costs.customsValue = Number.MAX_VALUE; data.rates[0].rate = 10;
  assert.throws(() => calculateLandedCostScenario(data), /LANDED_COST_OVERFLOW/);
});

test("stage HTML preserves assumptions, tax formulas and all referenced cost evidence", () => {
  const data = scenario(); data.basis.freight!.evidenceIds = ["freight-evidence"];
  assert.deepEqual(landedCostEvidenceIds([data]), ["freight-evidence"]);
  const run = { id: "isolated", revision: 1, mode: "fixture", requirement: "Test only", marketplace: "US", skills: [], policies: {}, limits: {}, registry: [],
    calls: [{ id: "freight-evidence", status: "SUCCEEDED", tool: "test", rawResponse: { quote: "Isolated source, not market data" } }],
    results: [1, 2, 3, 4].map(stage => ({ summary: `Test ${stage}`, claims: [], ...(stage === 4 ? { landedCostScenarios: [data] } : {}) })),
  } as unknown as Run;
  const html = renderResearchStageReport(run, 4);
  assert.match(html, /stress_test/); assert.match(html, /customsValue \* rate/);
  assert.match(html, /Isolated source, not market data/); assert.match(html, /1650/);
});

test("the engine needs host verification even when the model supplies a source URL and date", async () => {
  const { mkdtemp, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { LocalResearchStore } = await import("@/lib/selection-research/file-store");
  const { ResearchEngine } = await import("@/lib/selection-research/engine");
  const { SKILLS } = await import("@/lib/selection-research/types");
  const root = await mkdtemp(`${tmpdir()}/tariff-isolated-`);
  try {
    const store = new LocalResearchStore(root);
    const scope = { organizationId: "isolated", workspaceId: "isolated", ownerId: "isolated" };
    const data = scenario();
    Object.assign(data.rates[0], { status: "verified", evidenceIds: ["test-source"], sourceUrl: "https://isolated.invalid/tariff", applicableDate: "2026-01-01" });
    let permitted = false, checks = 0;
    const engine = new ResearchEngine(store, scope, { async listTools() { return []; }, async callTool() { throw new Error("UNEXPECTED_DISPATCH"); } },
      { async next({ run }) { if (permitted) assert.equal(run.validationFeedback?.code, "CURRENT_TARIFF_VERIFICATION_REQUIRED"); return { type: "complete", result: { summary: "Isolated tariff test", claims: [{ text: "归类待核实", kind: "assumption", evidenceIds: [], topic: "tariff" }], landedCostScenarios: [data] } }; } },
      { mode: "live", authorizeLive: async () => true, verifyTariffEvidence: claim => { checks++; assert.match(claim.text, /4202.92/); return permitted; } });
    const run = await engine.create({ requirement: "Isolated source check", marketplace: "US", skills: SKILLS.map(name => ({ name, markdown: "test", path: "test", sha256: "test", tools: [] })), policies: {}, limits: {} });
    await store.transaction(run.id, async (state, save) => {
      state.stage = 4;
      state.calls = [{ id: "test-source", projectId: run.id, stage: 4, skill: SKILLS[3], service: "lili", provider: "isolated", tool: "test", arguments: {}, requestedAt: run.createdAt, status: "SUCCEEDED", paid: false, reservedUnits: 0, billing: "FREE", retryCount: 0, inputSchema: {}, rawResponse: { source: "https://isolated.invalid/tariff", date: "2026-01-01" } }];
      await save();
    });
    assert.equal((await engine.step(run.id)).failure, "CURRENT_TARIFF_VERIFICATION_REQUIRED");
    assert.equal(checks, 1);
    await engine.recover(run.id); permitted = true;
    assert.equal((await engine.step(run.id)).status, "RESUMABLE");
    assert.equal(checks, 2);
    assert.equal((await engine.inspect(run.id)).validationFeedback, undefined);
  } finally { await rm(root, { recursive: true, force: true }); }
});
