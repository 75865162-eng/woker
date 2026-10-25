import assert from "node:assert/strict";
import test from "node:test";
import { buildSupplierEvidenceReport, supplierSelectionSource } from "@/lib/agent-platform/supplier-evidence";
import { createSupplierAgentExecutionExecutor, createSupplierMcpAdapter, supplierAgentDefinition, supplierToolDefinitions, type SupplierAnalysisReport } from "@/lib/agent-platform/supplier";
import { createAgentRuntime } from "@/lib/agent-platform/runtime";
import type { ProductDevelopmentReport } from "@/lib/agent-platform/product";
import type { AgentToolAdapter } from "@/lib/agent-platform/types";

const clock = () => new Date("2026-10-25T00:00:00Z");
const source = { schemaVersion: 1, fileId: "file-evidence", sha256: "a".repeat(64), slug: "cover", importedAt: "2026-10-24T00:00:00Z", stale: false,
  suppliers: [{ title: "Cover lead", shopName: "", url: "https://detail.1688.com/offer/123456.html", price: "", moq: "" }] };
const product = (selectionSource: unknown) => ({ summary: "Cover PRD draft", sourceMarketReport: { selectionSource } }) as unknown as ProductDevelopmentReport;

async function run(selectionSource: unknown, adapter: AgentToolAdapter = createSupplierMcpAdapter(clock)) {
  const productReport = product(selectionSource);
  const runtime = createAgentRuntime({ definitions: [supplierAgentDefinition], tools: supplierToolDefinitions, adapters: [adapter], clock });
  return runtime.run({ agentId: "supplier", context: { company: { organizationId: "org" }, workspace: { workspaceId: "workspace" }, user: { id: "user" } },
    input: {}, workspaceId: "workspace", requestedByUserId: "user",
    executor: createSupplierAgentExecutionExecutor({ request: { productReport, marketplace: "US" }, clock }) });
}

test("Round B source validation fails closed, including malformed and foreign URLs", () => {
  assert.equal(supplierSelectionSource({}), undefined);
  assert.throws(() => supplierSelectionSource(product(null)), /来源无效/);
  assert.throws(() => supplierSelectionSource(product({ ...source, sha256: "invalid" })), /来源无效/);
  assert.throws(() => supplierSelectionSource(product({ ...source, suppliers: [{ ...source.suppliers[0], url: "https://evil.test/123" }] })), /线索无效/);
  assert.throws(() => supplierSelectionSource(product({ ...source, importedAt: "invalid" })), /来源无效/);
});

test("Round B Supplier runtime preserves provenance and unknowns through all six tools", async () => {
  const result = await run(source);
  assert.equal(result.execution.status, "COMPLETED");
  assert.equal(result.toolCalls.length, 6);
  const { report, evidence } = result.execution.output as unknown as { report: SupplierAnalysisReport; evidence: unknown[] };
  assert.equal(report.sourcingStatus, "NEEDS_VERIFICATION");
  assert.equal(report.evidence[0].toolCallId, result.toolCalls.find((call) => call.toolId === "supplier.database.search")?.id);
  assert.deepEqual(report.selectionSource, source);
  assert.equal(report.supplierRecommendations[0].sourceUrl, source.suppliers[0].url);
  assert.equal(report.supplierRecommendations[0].confidence, 0);
  assert.equal(report.quotationAnalysis[0].score, null);
  assert.equal(report.quotationAnalysis[0].contactEmail, "");
  assert.equal(report.quotationAnalysis[0].unitPrice, "未报价");
  assert.equal(report.quotationAnalysis[0].moq, "待核实");
  assert.equal(report.rfqDraft.targetPrice, "待确认");
  assert.equal(report.rfqDraft.targetLeadTime, "待确认");
  assert.deepEqual(evidence, report.evidence);
  assert.equal(result.memoryItems[0].confidence, 0);
  assert.doesNotMatch(JSON.stringify(report), /sales@example|\$5\.00|18-24 days/);
});

test("empty evidence shortlist remains NEEDS_DATA, never synthetic candidates", async () => {
  const result = await run({ ...source, suppliers: [] });
  assert.equal(result.execution.status, "COMPLETED");
  const { report } = result.execution.output as unknown as { report: SupplierAnalysisReport };
  assert.equal(report.sourcingStatus, "NEEDS_DATA");
  assert.deepEqual(report.supplierRecommendations, []);
  assert.deepEqual(report.quotationAnalysis, []);
  assert.match(report.recommendation, /补充短名单/);
});

test("page prices and MOQ remain literal; staleness and unverified quote conditions are explicit", () => {
  const report = buildSupplierEvidenceReport({ ...source, importedAt: "2026-10-01T00:00:00Z", suppliers: [{ ...source.suppliers[0], price: "¥0 / 100件起", moq: "100件" }] }, "goal", "US", "draft", clock().toISOString());
  assert.equal(report.quotationAnalysis[0].unitPrice, "¥0 / 100件起");
  assert.equal(report.quotationAnalysis[0].moq, "100件");
  assert.equal(report.selectionSource?.stale, true);
  assert.match(report.quotationAnalysis[0].notes, /非正式报价/);
});

test("failed evidence tool stops execution without synthetic fallback", async () => {
  const adapter = createSupplierMcpAdapter(clock);
  const result = await run(source, { ...adapter, execute: async (input) => {
    if (input.toolId === "supplier.quotation.analyze") throw new Error("Quote tool unavailable");
    return adapter.execute(input);
  } });
  assert.equal(result.execution.status, "FAILED");
  assert.equal(result.execution.output, undefined);
  assert.equal(result.toolCalls.some((call) => call.toolId === "supplier.rfq.draft"), false);
});

test("evidence tools cannot silently substitute a legacy or different-source report", async () => {
  const adapter = createSupplierMcpAdapter(clock);
  const result = await run(source, { ...adapter, execute: async (input) => {
    if (input.toolId === "supplier.database.search") return { output: { suppliers: [] }, latencyMs: 1 };
    return adapter.execute(input);
  } });
  assert.equal(result.execution.status, "FAILED");
  assert.equal(result.toolCalls.some((call) => call.toolId === "supplier.quotation.analyze"), false);
});
