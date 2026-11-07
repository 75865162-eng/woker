import test from "node:test";
import assert from "node:assert/strict";
import { liveMarketTransport, marketAccessSummary } from "@/lib/lili/market-access";
import { ToolNotDispatchedError, type Transport } from "@/lib/selection-research/types";
import { researchBudgetPreview } from "@/lib/selection-research/budget";

test("market revocation between discovery and dispatch prevents external requests", async () => {
 let enabled = true, sent = 0;
 const provider: Transport = { listTools: async () => [{ name: "actual_registry_tool", inputSchema: { type: "object" } }], callTool: async () => { sent++; return { ok: true }; } };
 const transport = liveMarketTransport(async () => enabled ? provider : undefined);
 assert.equal((await transport.listTools()).length, 1);
 enabled = false;
 await assert.rejects(transport.callTool("actual_registry_tool", {}, new AbortController().signal), ToolNotDispatchedError);
 assert.equal(sent, 0);
 await assert.rejects(transport.listTools(), ToolNotDispatchedError);
});
test("market settings rotate before dispatch and use the current adapter only", async () => {
 let revision = 1;
 const transport = liveMarketTransport(async () => { const current = revision; return { listTools: async () => [], callTool: async () => ({ revision: current }) }; });
 await transport.listTools(); revision = 2;
 assert.deepEqual(await transport.callTool("read", {}, new AbortController().signal), { revision: 2 });
});
test("market summary separates research permission, configured status and actual registry", () => {
 const configured = [{ provider: "sellersprite" as const, configured: true, status: "configured_not_probed" as const }];
 assert.equal(marketAccessSummary(true, false, configured).research_access, false);
 const result = marketAccessSummary(true, true, configured);
 assert.equal(result.research_access, true); assert.equal(result.direct_market_access, false);
 assert.equal(result.registry_checked, false); assert.equal(result.estimated_cost, null);
 assert.equal(marketAccessSummary(true, true, []).research_access, false);
});
test("pending paid call displays one request and unknown cost before approval", () => {
 const preview = researchBudgetPreview({ skills: [], registry: [], policies: { actual: { provider: "xiyou", paid: true, units: 1, unit: "calls", pricingSource: "unknown", maxCalls: 3, stages: [1] } }, limits: {}, pendingAction: { type: "call", tool: "actual", arguments: { asin: "B000000001" } } });
 assert.equal(preview.pendingCall?.estimatedCalls, 1);
 assert.equal(preview.pendingCall?.estimatedCost, null);
 assert.equal(preview.pendingCall?.approved, false);
 assert.deepEqual(preview.pendingCall?.arguments, { asin: "B000000001" });
});

test("permission/configuration failures are explicitly NOT_SENT, provider dispatch failures remain uncertain", async () => {
 const denied = liveMarketTransport(async () => { throw new Error("private configuration failure"); });
 await assert.rejects(denied.callTool("read", {}, new AbortController().signal), error => error instanceof ToolNotDispatchedError && !error.message.includes("private"));
 const dispatched = liveMarketTransport(async () => ({ listTools: async () => [], callTool: async () => { throw new Error("provider timeout"); } }));
 await assert.rejects(dispatched.callTool("read", {}, new AbortController().signal), error => error instanceof Error && !(error instanceof ToolNotDispatchedError));
});
