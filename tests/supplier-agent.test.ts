import assert from "node:assert/strict";
import test from "node:test";

import { canAgentUseTool } from "@/lib/agent-platform/permissions";
import { createAgentRuntime } from "@/lib/agent-platform/runtime";
import {
  createSupplierAgentExecutionExecutor,
  createSupplierMcpAdapter,
  supplierAgentDefinition,
  supplierEvaluationCases,
  supplierToolDefinitions,
} from "@/lib/agent-platform/supplier";

test("supplier agent has a full tool surface and evaluation cases", () => {
  assert.equal(supplierToolDefinitions.length, 6);
  assert.equal(supplierAgentDefinition.tools.length, supplierToolDefinitions.length);
  assert.equal(supplierEvaluationCases.length, 10);
  assert.ok(canAgentUseTool(supplierAgentDefinition, supplierToolDefinitions[0]));
});

test("supplier agent runtime turns a product plan into a sourcing report", async () => {
  const clock = () => new Date("2026-09-02T00:00:00.000Z");
  const runtime = createAgentRuntime({
    definitions: [supplierAgentDefinition],
    tools: supplierToolDefinitions,
    adapters: [createSupplierMcpAdapter(clock)],
    clock,
  });

  const report = {
    summary: "Portable drawer organizer",
    marketplace: "US",
    category: "Home & Kitchen",
    prd: {
      summary: "Portable drawer organizer",
      userProblem: "Customers need a compact organizer",
      targetCustomer: "US home organizers",
      mustHave: ["Compact shape"],
      shouldHave: ["Custom labeling"],
      acceptanceCriteria: ["Fits in standard drawer"],
      launchRisks: ["MOQ pressure"],
    },
    supplierProjectDraft: {
      projectName: "Portable drawer organizer Sourcing Project",
      objective: "Turn supplier recommendations into a sourcing-ready project for human review.",
      stages: [],
      nextStep: "Review supplier shortlist and RFQ draft before approval.",
      risks: [],
    },
    supplierRecommendations: [],
    quotationAnalysis: [],
    rfqDraft: {
      subject: "RFQ for Portable drawer organizer",
      objective: "Request quotation, sample, lead time, and production capability details.",
      productSummary: "Validated product concept with differentiated requirements.",
      requiredCapabilities: ["Amazon-ready packaging"],
      targetPrice: "$5.00 - $5.50",
      targetLeadTime: "18-24 days",
      questions: ["What is the MOQ per SKU?"],
    },
    evidence: [],
    recommendation: "Review sourcing plan",
    generatedAt: "2026-09-02T00:00:00.000Z",
  };

  const result = await runtime.run({
    agentId: supplierAgentDefinition.id,
    context: {
      company: { organizationId: "org-supplier" },
      workspace: { workspaceId: "default", accountId: "", marketplace: "US" },
      user: { id: "user-supplier", email: "supplier@example.com" },
      marketplace: "US",
      currentData: {
        goal: "把产品计划转成供应商推荐",
        marketplace: "US",
        category: "Home & Kitchen",
        productReport: report,
      },
    },
    input: {
      naturalLanguageGoal: "把产品计划转成供应商推荐和 RFQ",
      marketplace: "US",
      category: "Home & Kitchen",
      productReport: report,
      productHandoff: {
        goal: "把产品计划转成供应商推荐",
        marketplace: "US",
        category: "Home & Kitchen",
        productReport: report,
        prd: report.prd,
      },
    },
    requestedByUserId: "user-supplier",
    workspaceId: "default",
    accountId: "",
    marketplace: "US",
    executor: createSupplierAgentExecutionExecutor({
      request: {
        naturalLanguageGoal: "把产品计划转成供应商推荐和 RFQ",
        marketplace: "US",
        category: "Home & Kitchen",
        productReport: report,
        productHandoff: {
          goal: "把产品计划转成供应商推荐",
          marketplace: "US",
          category: "Home & Kitchen",
          productReport: report,
          prd: report.prd,
        },
      },
      requestedByUserId: "user-supplier",
      clock,
    }),
  });

  assert.equal(result.execution.status, "COMPLETED");
  assert.ok(result.toolCalls.length >= 5);
  assert.ok(result.memoryItems.length >= 1);
  assert.ok(result.traces.some((trace) => trace.type === "recommendation"));
  assert.ok(result.execution.output && typeof result.execution.output === "object");
});
