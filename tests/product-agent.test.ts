import assert from "node:assert/strict";
import test from "node:test";

import { canAgentUseTool } from "@/lib/agent-platform/permissions";
import { createAgentRuntime } from "@/lib/agent-platform/runtime";
import {
  createProductAgentExecutionExecutor,
  createProductMcpAdapter,
  productAgentDefinition,
  productEvaluationCases,
  productToolDefinitions,
} from "@/lib/agent-platform/product";

test("product agent has a full tool surface and evaluation cases", () => {
  assert.equal(productToolDefinitions.length, 6);
  assert.equal(productAgentDefinition.tools.length, productToolDefinitions.length);
  assert.equal(productEvaluationCases.length, 12);
  assert.ok(canAgentUseTool(productAgentDefinition, productToolDefinitions[0]));
});

test("product agent runtime turns a market opportunity into a PRD and project draft", async () => {
  const clock = () => new Date("2026-09-02T00:00:00.000Z");
  const runtime = createAgentRuntime({
    definitions: [productAgentDefinition],
    tools: productToolDefinitions,
    adapters: [createProductMcpAdapter(clock)],
    clock,
  });

  const marketOpportunity = {
    opportunityId: "opportunity-1",
    productIdea: "Adjustable desk organizer",
    marketplace: "US",
    category: "Home & Kitchen",
    targetPrice: "$29.99",
    estimatedDemand: 72,
    competitionScore: 44,
    reviewBarrier: 32,
    keywordOpportunity: 68,
    trendScore: 61,
    differentiationOpportunity: 70,
    estimatedMargin: 31,
    riskScore: 29,
    opportunityScore: 77,
    confidence: 0.84,
    evidence: [],
    recommendation: "Strong opportunity",
  };

  const result = await runtime.run({
    agentId: productAgentDefinition.id,
    context: {
      company: { organizationId: "org-product" },
      workspace: { workspaceId: "default", accountId: "", marketplace: "US" },
      user: { id: "user-product", email: "product@example.com" },
      marketplace: "US",
      currentData: {
        goal: "把 market opportunity 转成 PRD",
        marketplace: "US",
        category: "Home & Kitchen",
        marketOpportunity,
        marketReport: {
          marketplace: "US",
          category: "Home & Kitchen",
          summary: "Market report summary",
          productOpportunities: [marketOpportunity],
        },
      },
    },
    input: {
      naturalLanguageGoal: "把 market opportunity 转成 PRD 和成本目标",
      marketplace: "US",
      category: "Home & Kitchen",
      targetMargin: 30,
      marketOpportunity,
      marketReport: {
        marketplace: "US",
        category: "Home & Kitchen",
        summary: "Market report summary",
        productOpportunities: [marketOpportunity],
      },
    },
    requestedByUserId: "user-product",
    workspaceId: "default",
    accountId: "",
    marketplace: "US",
    executor: createProductAgentExecutionExecutor({
      request: {
        naturalLanguageGoal: "把 market opportunity 转成 PRD 和成本目标",
        marketplace: "US",
        category: "Home & Kitchen",
        targetMargin: 30,
        marketOpportunity,
        marketReport: {
          marketplace: "US",
          category: "Home & Kitchen",
          summary: "Market report summary",
          productOpportunities: [marketOpportunity],
        },
      },
      requestedByUserId: "user-product",
      clock,
    }),
  });

  assert.equal(result.execution.status, "COMPLETED");
  assert.ok(result.toolCalls.length >= 5);
  assert.ok(result.memoryItems.length >= 1);
  assert.ok(result.traces.some((trace) => trace.type === "recommendation"));
  assert.ok(result.execution.output && typeof result.execution.output === "object");
});
