import assert from "node:assert/strict";
import test from "node:test";

import { canAgentUseTool } from "@/lib/agent-platform/permissions";
import { createAgentRuntime } from "@/lib/agent-platform/runtime";
import {
  createListingAgentExecutionExecutor,
  createListingMcpAdapter,
  listingAgentDefinition,
  listingEvaluationCases,
  listingToolDefinitions,
} from "@/lib/agent-platform/listing";

test("listing agent has a full tool surface and evaluation cases", () => {
  assert.equal(listingToolDefinitions.length, 7);
  assert.equal(listingAgentDefinition.tools.length, listingToolDefinitions.length);
  assert.equal(listingEvaluationCases.length, 10);
  assert.ok(canAgentUseTool(listingAgentDefinition, listingToolDefinitions[0]));
});

test("listing agent runtime turns product and keyword evidence into a listing draft", async () => {
  const clock = () => new Date("2026-09-03T00:00:00.000Z");
  const runtime = createAgentRuntime({
    definitions: [listingAgentDefinition],
    tools: listingToolDefinitions,
    adapters: [createListingMcpAdapter(clock)],
    clock,
  });

  const productReport = {
    summary: "Portable desk organizer",
    marketplace: "US",
    category: "Office Products",
    prd: {
      summary: "Portable desk organizer",
      userProblem: "Users need a compact organizer",
      targetCustomer: "Home office buyers",
      mustHave: ["Compact footprint"],
      shouldHave: ["Cable slot"],
      acceptanceCriteria: ["Fits desk drawer"],
      launchRisks: ["Keyword competition"],
    },
    competitorPainPoints: [],
    differentiation: [],
    costTarget: {
      targetRetailPrice: "$29.99",
      targetLandedCost: "$11.50",
      maxLandedCost: "$12.50",
      targetMargin: 30,
      rationale: "Synthetic",
    },
    projectDraft: {
      projectName: "Portable desk organizer project",
      objective: "Draft listing",
      stages: [],
      nextStep: "Review listing",
      risks: [],
    },
    scores: {
      productReadiness: 80,
      differentiation: 72,
      costFit: 68,
      executionConfidence: 78,
    },
    evidence: [],
    summary: "Portable desk organizer product report",
    recommendation: "Proceed",
    generatedAt: "2026-09-03T00:00:00.000Z",
  };

  const result = await runtime.run({
    agentId: listingAgentDefinition.id,
    context: {
      company: { organizationId: "org-listing" },
      workspace: { workspaceId: "default", accountId: "", marketplace: "US" },
      user: { id: "user-listing", email: "listing@example.com" },
      marketplace: "US",
      currentData: {
        goal: "把产品计划转成 listing draft",
        marketplace: "US",
        category: "Office Products",
        productReport,
      },
    },
    input: {
      naturalLanguageGoal: "把产品计划转成 listing draft",
      marketplace: "US",
      category: "Office Products",
      productReport,
      sellerSpriteKeywords: {
        primaryKeywords: ["desk organizer", "desktop organizer"],
        secondaryKeywords: ["office organizer", "compact desk storage"],
        longTailKeywords: ["portable desk organizer for home office"],
        backendSearchTerms: ["desk organizer", "desktop organizer", "office organizer"],
        competitorGaps: ["Weak title structure", "Thin benefit story"],
      },
      competitors: [
        { name: "Competitor A", weakness: "Generic title", opportunity: "Sharper keyword hierarchy" },
        { name: "Competitor B", weakness: "Weak benefits", opportunity: "Conversion-led bullets" },
      ],
    },
    requestedByUserId: "user-listing",
    workspaceId: "default",
    accountId: "",
    marketplace: "US",
    executor: createListingAgentExecutionExecutor({
      request: {
        naturalLanguageGoal: "把产品计划转成 listing draft",
        marketplace: "US",
        category: "Office Products",
        productReport,
        sellerSpriteKeywords: {
          primaryKeywords: ["desk organizer", "desktop organizer"],
          secondaryKeywords: ["office organizer", "compact desk storage"],
          longTailKeywords: ["portable desk organizer for home office"],
          backendSearchTerms: ["desk organizer", "desktop organizer", "office organizer"],
          competitorGaps: ["Weak title structure", "Thin benefit story"],
        },
        competitors: [
          { name: "Competitor A", weakness: "Generic title", opportunity: "Sharper keyword hierarchy" },
          { name: "Competitor B", weakness: "Weak benefits", opportunity: "Conversion-led bullets" },
        ],
      },
      requestedByUserId: "user-listing",
      clock,
    }),
  });

  assert.equal(result.execution.status, "COMPLETED");
  assert.ok(result.toolCalls.length >= 6);
  assert.ok(result.memoryItems.length >= 1);
  assert.ok(result.traces.some((trace) => trace.type === "recommendation"));
  assert.ok(result.execution.output && typeof result.execution.output === "object");
});
