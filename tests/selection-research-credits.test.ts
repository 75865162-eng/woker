import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { ResearchEngine } from "@/lib/selection-research/engine";
import { LocalResearchStore } from "@/lib/selection-research/file-store";
import { SKILLS } from "@/lib/selection-research/types";
import { parseResearchBrief } from "@/lib/selection-research/brief";
import { researchChargeCredits, researchCreditUsage, type ResearchCharge } from "@/lib/selection-research/credits";
import { researchBudgetPreview } from "@/lib/selection-research/budget";
import { executeResearchCommand } from "@/lib/selection-research/http";
import { callResearchMcpTool } from "@/lib/lili/research-tools";
import { researchToolActions } from "@/lib/lili/research-grants";

const receipt: ResearchCharge = { amount: 2, unit: "USD", cnyPerUnit: 7, rateDate: "2026-11-08", rateSource: "Isolated fixture conversion, not live FX", receipt: "fixture receipt", status: "confirmed" };
const scope = { organizationId: "isolated", workspaceId: "isolated", ownerId: "owner" };
const tool = { name: "market_find_products", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } };
const input = { executionMode: "codex" as const, budgetMode: "uncapped" as const, requirement: "产品方向：arrow bag quiver。付费请求必须先批准。", marketplace: "US", registry: [tool],
  skills: SKILLS.map(name => ({ name, path: "fixture", markdown: "fixture", sha256: "fixture", tools: [] })),
  policies: { [tool.name]: { provider: "sellersprite", paid: true, unit: "calls" as const, units: 1, maxCalls: 1, stages: [1], pricingSource: "unknown" } }, limits: { sellersprite: 0 } };
const action = (query: string) => ({ type: "call" as const, tool: tool.name, arguments: { query } });

test("explicit bilingual directions survive Skill mentions, ambiguity remains unresolved", () => {
  for (const req of ["我想做的方向是：【arrow bag quiver】。用 amazon-product-research", "Starting direction: arrow bag quiver. Then research and amazon-review-analyzer"]) {
    assert.equal(parseResearchBrief(req, "US").productDirection?.value, "arrow bag quiver");
  }
  assert.equal(parseResearchBrief("research and amazon-review-analyzer", "US").productDirection, null);
  assert.equal(parseResearchBrief("产品方向：a，产品方向：b", "US").productDirection, null);
});

test("planning forecast is neither a quota nor a provider price", () => {
  const preview = researchBudgetPreview(input);
  assert.deepEqual(preview.stages.map(stage => stage.estimatedCalls && [stage.estimatedCalls.min, stage.estimatedCalls.max]), [[8,10],[6,10],[4,8],[0,0],[0,2]]);
  assert.deepEqual(preview.planning.calls, { min: 18, max: 30 });
  assert.equal(preview.simulated, false); assert.equal(preview.providerLimits.sellersprite, null);
  assert.equal(preview.stages[0].credits, null); assert.equal(preview.creditRule.cnyPerCredit, 0.01);
});

test("research credits convert real prices and supplier units, preserve estimates and unknowns", () => {
  assert.equal(researchChargeCredits(receipt), 1400);
  assert.equal(researchChargeCredits({ ...receipt, unit: "CNY", amount: 0.01, cnyPerUnit: 1 }), 1);
  const supplier = { ...receipt, unit: "supplier_credits" as const, amount: 3, cnyPerUnit: 0.25, status: "estimated" as const };
  assert.equal(researchChargeCredits(supplier), 75);
  const paid = { paid: true, dispatch: "ATTEMPTED" };
  const usage = researchCreditUsage({ calls: [{ ...paid, researchCharge: receipt }, { ...paid, researchCharge: supplier }, paid, { ...paid, dispatch: "NOT_SENT" }] });
  assert.equal(usage.confirmed, 1400); assert.equal(usage.estimated, 75); assert.equal(usage.pendingCalls, 2); assert.equal(usage.total, null);
  assert.equal(researchCreditUsage({ calls: [{ ...paid, researchCharge: receipt }] }).total, 1400);
  for (const patch of [{ amount: -1 }, { amount: Infinity }, { cnyPerUnit: 0 }, { unit: "CNY", cnyPerUnit: 7 }, { rateDate: "2026-02-30" }, { rateSource: " " }, { receipt: "" }]) assert.throws(() => researchChargeCredits({ ...receipt, ...patch } as ResearchCharge), /INVALID_RESEARCH_CHARGE/);
});

test("uncapped tasks require explicit scope approval, pass 30 calls, never pause for pending charges and retain charge audit", async () => {
  const root = await mkdtemp(tmpdir() + "/uncapped-research-");
  let dispatches = 0, reservations = 0;
  const store = new LocalResearchStore(root);
  const transport = { async listTools() { return [tool]; }, async callTool() { dispatches++; return { records: [] }; } };
  const engine = new ResearchEngine(store, scope, transport, { async next(): Promise<never> { throw new Error("NO_MODEL"); } }, {
    mode: "live", authorizeLive: async () => true,
    paidCallConsent: { id: "old-finite-consent", approvedAt: "2026-11-08", approvedByUserId: scope.ownerId },
    marketQuota: { async reserve() { reservations++; }, async settle() {} },
  });
  try {
    let run = await engine.create(input);
    run = await engine.step(run.id, { action: action("first"), revision: run.revision });
    assert.equal(run.gate?.kind, "MCP_CALL"); assert.equal(dispatches, 0, "old standing consent must not silently widen");
    run = await engine.decide(run.id, { gateId: run.gate!.id, kind: "AUTHORIZE_TOOL", callId: run.pendingActionId });
    run = await engine.step(run.id);
    assert.equal(run.paidCallAuthorization?.budgetMode, "uncapped");
    for (let n = 1; n < 35; n++) {
      run = await engine.step(run.id, { action: action(`query-${n}`), revision: run.revision });
      assert.equal(run.pausedAt, undefined);
      assert.equal(run.gate, undefined);
    }
    assert.equal(dispatches, 35); assert.equal(reservations, 35, "account ledger must remain enforced");
    assert.equal(researchCreditUsage(run).pendingCalls, 35);
    const command = { operation: "record-charge", callId: run.calls[0].id, charge: receipt, confirmation: "fixture human receipt confirmation", expectedRevision: run.revision };
    await assert.rejects(executeResearchCommand(engine, run.id, command, false), /APPROVAL_PERMISSION/);
    await assert.rejects(engine.recordCharge(run.id, { ...command, expectedRevision: -1 }), /STALE_RESEARCH_DECISION/);
    run = await executeResearchCommand(engine, run.id, command, true);
    assert.equal(researchCreditUsage(run).confirmed, 1400); assert.equal(run.creditAdjustments?.length, 1);
    const correction = { ...receipt, amount: 1 };
    run = await engine.recordCharge(run.id, { ...command, expectedRevision: run.revision, charge: correction });
    assert.equal(researchCreditUsage(run).confirmed, 700); assert.equal(run.creditAdjustments?.length, 2);
    assert.equal(run.creditAdjustments?.[0].charge.amount, 2, "correction preserves original receipt");
    assert.equal(dispatches, 35);
    const outsider = new ResearchEngine(store, { ...scope, ownerId: "other" }, transport, { async next(): Promise<never> { throw new Error("NO_MODEL"); } }, { mode: "live" });
    await assert.rejects(outsider.recordCharge(run.id, { ...command, expectedRevision: run.revision }), /SCOPE_DENIED/);
    await store.transaction(run.id, async (saved, save) => { saved.status = "WAITING_FOR_USER"; saved.gate = { id: "unresolved", kind: "BILLING", reason: "unknown outcome" }; await save(); });
    run = await engine.inspect(run.id);
    run = await engine.recordCharge(run.id, { ...command, expectedRevision: run.revision, charge: receipt });
    assert.equal(run.gate?.kind, "BILLING", "cost entry remains separate from recovery");
    run = await engine.resume(run.id);
    assert.equal(run.gate, undefined); assert.equal(dispatches, 35);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("MCP defaults to uncapped, accepts optional larger caps, and cost command requires approve", async () => {
  const request = new Request("http://localhost/api/lili/mcp");
  for (const maxMarketCalls of [undefined, 100]) {
    await callResearchMcpTool(request, "research_start", { requirement: "fixture", marketplace: "US", workspaceId: "isolated", ...(maxMarketCalls ? { maxMarketCalls } : {}) }, async child => {
      const body = await child.json(); assert.equal(body.budgetMode, maxMarketCalls ? "reviewed" : "uncapped");
      return Response.json({});
    });
  }
  assert.equal(researchToolActions.research_record_charge, "approve");
  await callResearchMcpTool(request, "research_record_charge", { workspaceId: "isolated", runId: "fixture", callId: "fixture-call", charge: { ...receipt }, userConfirmation: "确认测试凭据", expectedRevision: 1 }, async child => {
    const body = await child.json(); assert.equal(body.operation, "record-charge"); assert.deepEqual(body.charge, receipt); assert.equal(body.confirmation, "确认测试凭据");
    return Response.json({});
  });
});

test("final HTML retains both human gates and renders converted credits with escaped receipts", async () => {
  const { researchFixture } = await import("@/lib/selection-research/fixture");
  const { renderResearchReport } = await import("@/lib/selection-research/report");
  const root = await mkdtemp(tmpdir() + "/credit-report-");
  const fixture = researchFixture();
  const engine = new ResearchEngine(new LocalResearchStore(root), scope, fixture.transport, fixture.agent, { mode: "fixture" });
  try {
    let run = await engine.create({ requirement: "Isolated report", marketplace: "US", skills: input.skills, policies: fixture.policies, limits: {} });
    while (run.status !== "WAITING_FOR_USER") run = await engine.step(run.id);
    assert.throws(() => renderResearchReport(run), /REPORT_REQUIRES/);
    run = await engine.decide(run.id, { kind: "SELECT", gateId: run.gate!.id, candidateId: "fixture-1" });
    while (run.status !== "WAITING_FOR_USER") run = await engine.step(run.id);
    assert.equal(run.gate?.kind, "FINAL");
    run = await engine.decide(run.id, { kind: "CONFIRM", gateId: run.gate!.id });
    // In-memory fixture only, representing a historical paid response with retained receipt.
    run.calls[0].paid = true; run.calls[0].researchCharge = { ...receipt, receipt: "<script>unsafe()</script>" };
    run.budgetMode = "uncapped";
    const html = renderResearchReport(run);
    assert.match(html, /已确认 1400 积分/); assert.match(html, /2 USD/);
    assert.match(html, /&lt;script&gt;unsafe\(\)&lt;\/script&gt;/); assert.ok(!html.includes("<script>unsafe()"));
    assert.match(html, /AI模型费用尚未取得凭据/);
    assert.equal(html, renderResearchReport(run), "approved snapshot renders deterministically");
    await assert.rejects(engine.recordCharge(run.id, { callId: run.calls[0].id, charge: receipt, expectedRevision: run.revision, confirmation: "fixture" }), /TERMINAL_RUN/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
