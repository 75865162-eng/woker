import assert from "node:assert/strict";
import test from "node:test";
import sample from "./fixtures/selection/evidence.json";
import { buildSelectionMarketOutput, parseSelectionEvidence } from "@/lib/agent-platform/selection-evidence";
import { createAgentRuntime } from "@/lib/agent-platform/runtime";
import { createSelectionAdapter } from "@/lib/agent-platform/selection";
import { createMarketAgentExecutionExecutor, marketAgentDefinition, marketToolDefinitions } from "@/lib/agent-platform/market";

const now = new Date("2026-10-25T00:00:00Z");
test("imported evidence retains real zero, missing metrics, source time and quotes without synthesizing market signals", () => {
  const output = buildSelectionMarketOutput(sample, { fileId: "file", sha256: "hash" }, now);
  assert.equal(output.report.blueOceanRadar.blueOceanIndex, null);
  assert.equal(output.productOpportunities[0].estimatedMargin, null);
  assert.equal(output.productOpportunities[0].estimatedDemand, null);
  assert.equal(output.productOpportunities[0].opportunityScore, null);
  assert.equal(output.productOpportunities[0].evidenceCompleteness, 75);
  assert.equal(output.productOpportunities[0].scoreBasis, "evidence_completeness");
  const evidence = output.evidence[0];
  assert.equal((evidence.value as { price: number }).price, 0);
  assert.equal(evidence.timestamp, sample.competitors[0].capturedAt);
  assert.equal(evidence.dataSource, sample.competitors[0].url);
  assert.equal((output.evidence[1].value as { quote: string }).quote, "poor fit");
  assert.equal(output.report.selectionSource?.fileId, "file");
  assert.equal(buildSelectionMarketOutput(sample, { fileId: "file", sha256: "hash" }, new Date("2026-11-02")).report.selectionSource?.stale, true);
});
test("evidence rejects fixture/future schemas, duplicate identities, foreign URLs, orphaned quotes and invalid measurements", () => {
  for (const patch of [{ fixture: true }, { fixture: undefined }, { schemaVersion: 2 }, { competitors: [] }, { competitors: [...sample.competitors, ...sample.competitors] }]) {
    assert.throws(() => parseSelectionEvidence({ ...sample, ...patch }, now));
  }
  for (const patch of [{ price: -1 }, { rating: 6 }, { reviewsCount: 1.5 }, { capturedAt: "tomorrow" }, { capturedAt: "2099-01-01" }, { url: "https://evil.test/dp/B012345678" }, { url: "https://www.amazon.com/dp/B099999999" }]) {
    assert.throws(() => parseSelectionEvidence({ ...sample, competitors: [{ ...sample.competitors[0], ...patch }] }, now));
  }
  assert.throws(() => parseSelectionEvidence({ ...sample, tags: { matches: [{ ...sample.tags.matches[0], asin: "B099999999" }] } }, now));
  assert.throws(() => parseSelectionEvidence({ ...sample, suppliers: [{ title: "bad", shopName: "bad", price: "", moq: "", url: "https://localhost/offer/1" }] }, now));
});
test("Market Runtime consumes uploaded evidence exclusively, creates handoff output and refuses mismatched goals without fallback", async () => {
  let reads = 0;
  const runtime = createAgentRuntime({ definitions: [marketAgentDefinition], tools: marketToolDefinitions,
    adapters: [createSelectionAdapter({ loadEvidence: async (id) => { assert.equal(id, "file"); reads++; return { value: sample, source: { fileId: id, sha256: "hash" } }; } })] });
  const run = (keyword: string) => runtime.run({ agentId: "market", context: {}, input: {}, executor: createMarketAgentExecutionExecutor({ request: { selectionRun: true, selectionFileId: "file", marketplace: "US", keyword } }) });
  const accepted = await run("kayak cover");
  assert.equal(accepted.execution.status, "COMPLETED");
  assert.equal(accepted.toolCalls.length, 1);
  assert.equal(accepted.toolCalls[0].toolId, "market.selection.run");
  assert.ok((accepted.execution.output as { report: unknown }).report);
  const rejected = await run("unrelated goal");
  assert.equal(rejected.execution.status, "FAILED");
  assert.equal(rejected.execution.error?.code, "INVALID_EVIDENCE");
  assert.equal(rejected.execution.output, undefined);
  assert.equal(reads, 2);
});
