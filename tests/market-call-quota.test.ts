import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { ResearchEngine } from "@/lib/selection-research/engine";
import { LocalResearchStore } from "@/lib/selection-research/file-store";
import { SKILLS, ToolNotDispatchedError } from "@/lib/selection-research/types";
import { MarketQuotaError, type MarketCallOutcome } from "@/lib/lili/call-quota";

for (const outcome of ["success", "not-sent", "timeout", "exhausted", "store-unavailable"] as const) {
  test(`paid engine quota: ${outcome}; approval precedes reservation and dispatch`, async () => {
    const root = await mkdtemp(tmpdir() + "/market-quota-engine-");
    const store = new LocalResearchStore(root);
    const events: string[] = [];
    const tool = { name: "xiyou__get_asin_info", inputSchema: { type: "object", properties: {} } };
    const scope = { organizationId: "fixture", workspaceId: "fixture", ownerId: "fixture" };
    const engine = new ResearchEngine(store, scope, {
      async listTools() { return [tool]; }, async callTool() {
        events.push("dispatch");
        if (outcome === "not-sent") throw new ToolNotDispatchedError("APPROVED_SCHEMA_CHANGED");
        if (outcome === "timeout") return new Promise(() => {});
        return { ok: true };
      },
    }, { async next() { return { type: "call", tool: tool.name, arguments: {} }; } }, {
      mode: "live", authorizeLive: async () => true, timeoutMs: 5,
      marketQuota: {
        async reserve(input) {
          assert.equal(input.provider, "xiyou"); assert.equal(input.workspaceId, "fixture"); events.push("reserve");
          if (outcome === "exhausted") throw new MarketQuotaError("MARKET_QUOTA_EXHAUSTED");
          if (outcome === "store-unavailable") throw new Error("database unreachable");
        },
        async settle(_callId: string, status: MarketCallOutcome) { events.push(status); },
      },
    });
    try {
      let run = await engine.create({ requirement: "Isolated quota protocol。付费请求必须先批准。", marketplace: "US",
        skills: SKILLS.map(name => ({ name, markdown: "fixture", path: "fixture", sha256: "fixture", tools: [] })),
        policies: { [tool.name]: { provider: "xiyou", paid: true, units: 1, unit: "calls", maxCalls: 1, stages: [1], pricingSource: "unknown" } }, limits: { xiyou: 1 } });
      run = await engine.step(run.id);
      assert.equal(run.gate?.kind, "MCP_CALL"); assert.deepEqual(events, []);
      await engine.decide(run.id, { kind: "AUTHORIZE_TOOL", gateId: run.gate!.id, callId: run.pendingActionId });
      run = await engine.step(run.id);
      assert.deepEqual(events, outcome === "exhausted" || outcome === "store-unavailable" ? ["reserve"] : ["reserve", "dispatch", outcome === "not-sent" ? "REFUNDED" : outcome === "timeout" ? "UNKNOWN" : "COMPLETED"]);
      if (outcome === "exhausted" || outcome === "store-unavailable" || outcome === "not-sent") assert.equal(run.calls[0].dispatch, "NOT_SENT");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
