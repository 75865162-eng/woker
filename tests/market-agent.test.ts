import assert from "node:assert/strict";
import test from "node:test";

import { canAgentUseTool } from "@/lib/agent-platform/permissions";
import { createAgentRuntime } from "@/lib/agent-platform/runtime";
import { createMarketAgentExecutionExecutor, createSellerSpriteMcpAdapter, marketAgentDefinition, marketEvaluationCases, marketToolDefinitions } from "@/lib/agent-platform/market";

test("market agent has a full tool surface and 20 evaluation cases", () => {
  assert.equal(marketToolDefinitions.length, 9);
  assert.equal(marketAgentDefinition.tools.length, marketToolDefinitions.length);
  assert.equal(marketEvaluationCases.length, 20);
  assert.ok(canAgentUseTool(marketAgentDefinition, marketToolDefinitions[0]));
});

test("market agent runtime produces an evidence-backed research report", async () => {
  const clock = () => new Date("2026-09-02T00:00:00.000Z");
  const runtime = createAgentRuntime({
    definitions: [marketAgentDefinition],
    tools: marketToolDefinitions,
    adapters: [createSellerSpriteMcpAdapter(clock)],
    clock,
  });

  const result = await runtime.run({
    agentId: marketAgentDefinition.id,
    context: {
      company: { organizationId: "org-market" },
      workspace: { workspaceId: "default", accountId: "", marketplace: "US" },
      user: { id: "user-market", email: "market@example.com" },
      marketplace: "US",
      currentData: {
        category: "Home & Kitchen",
        keyword: "desk organizer",
      },
    },
    input: {
      naturalLanguageGoal: "寻找美国站 desk organizer 机会",
      marketplace: "US",
      category: "Home & Kitchen",
      keyword: "desk organizer",
      priceRange: { min: 20, max: 50 },
      targetMargin: 25,
    },
    requestedByUserId: "user-market",
    workspaceId: "default",
    accountId: "",
    marketplace: "US",
    executor: createMarketAgentExecutionExecutor({
      request: {
        naturalLanguageGoal: "寻找美国站 desk organizer 机会",
        marketplace: "US",
        category: "Home & Kitchen",
        keyword: "desk organizer",
        priceRange: { min: 20, max: 50 },
        targetMargin: 25,
      },
      requestedByUserId: "user-market",
      clock,
    }),
  });

  assert.equal(result.execution.status, "COMPLETED");
  assert.ok(result.toolCalls.length >= 8);
  assert.ok(result.traces.some((trace) => trace.type === "recommendation"));
  assert.ok(result.memoryItems.length >= 1);
  assert.ok(result.execution.output && typeof result.execution.output === "object");
});
