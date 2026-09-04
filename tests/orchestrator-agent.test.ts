import assert from "node:assert/strict";
import test from "node:test";

import { canAgentUseTool } from "@/lib/agent-platform/permissions";
import { createAgentRuntime } from "@/lib/agent-platform/runtime";
import { marketToolDefinitions } from "@/lib/agent-platform/market";
import {
  createOrchestratorExecutionExecutor,
  createOrchestratorInternalAdapter,
  orchestratorAgentDefinition,
  orchestratorEvaluationCases,
  orchestratorToolDefinitions,
} from "@/lib/agent-platform/orchestrator";

test("orchestrator agent has its own tool surface and evaluation cases", () => {
  assert.equal(orchestratorToolDefinitions.length, 5);
  assert.equal(orchestratorAgentDefinition.tools.length, orchestratorToolDefinitions.length);
  assert.equal(orchestratorEvaluationCases.length, 12);
  assert.ok(orchestratorToolDefinitions.every((tool) => canAgentUseTool(orchestratorAgentDefinition, tool)));
});

test("orchestrator runtime creates the market to ppc commerce chain", async () => {
  const clock = () => new Date("2026-09-03T00:00:00.000Z");
  const runtime = createAgentRuntime({
    definitions: [orchestratorAgentDefinition],
    tools: orchestratorToolDefinitions,
    adapters: [createOrchestratorInternalAdapter(clock)],
    clock,
  });

  const result = await runtime.run({
    agentId: orchestratorAgentDefinition.id,
    context: {
      company: { organizationId: "org-orchestrator" },
      workspace: { workspaceId: "default", accountId: "", marketplace: "US" },
      user: { id: "user-orchestrator", email: "orchestrator@example.com" },
      marketplace: "US",
      currentData: {
        goal: "串联 Market 到 PPC",
        marketplace: "US",
      },
    },
    input: {
      naturalLanguageGoal: "串联 Market 到 PPC",
      marketplace: "US",
    },
    requestedByUserId: "user-orchestrator",
    workspaceId: "default",
    accountId: "",
    marketplace: "US",
    executor: createOrchestratorExecutionExecutor({
      request: {
        naturalLanguageGoal: "串联 Market 到 PPC",
        marketplace: "US",
      },
      requestedByUserId: "user-orchestrator",
      clock,
    }),
  });

  const output = result.execution.output as Record<string, unknown>;
  const plan = output.plan as Record<string, unknown>;
  const stages = plan.stages as Array<Record<string, unknown>>;
  const handoffs = output.handoffs as Array<Record<string, unknown>>;

  assert.equal(result.execution.status, "WAITING_APPROVAL");
  assert.deepEqual(stages.map((stage) => stage.id), ["market", "product", "supplier", "listing", "launch", "ppc"]);
  assert.equal(stages.length, 6);
  assert.equal(handoffs.length, 6);
  assert.equal((stages.find((stage) => stage.id === "ppc") as Record<string, unknown>).status, "blocked_until_launch");
  assert.ok(result.approvals.length >= 1);
  assert.ok(result.traces.some((trace) => trace.type === "approval requested"));
});

test("orchestrator prepares ppc handoff after launch approval", async () => {
  const clock = () => new Date("2026-09-03T00:00:00.000Z");
  const runtime = createAgentRuntime({
    definitions: [orchestratorAgentDefinition],
    tools: orchestratorToolDefinitions,
    adapters: [createOrchestratorInternalAdapter(clock)],
    clock,
  });

  const result = await runtime.run({
    agentId: orchestratorAgentDefinition.id,
    context: {
      company: { organizationId: "org-orchestrator" },
      workspace: { workspaceId: "default", accountId: "", marketplace: "US" },
      marketplace: "US",
      sku: "SKU-001",
      asin: "B000TEST01",
      currentData: {
        goal: "Launch 通过后交给 PPC",
        marketplace: "US",
        launchApproved: true,
      },
    },
    input: {
      naturalLanguageGoal: "Launch 通过后交给 PPC",
      marketplace: "US",
      launchApproved: true,
    },
    requestedByUserId: "user-orchestrator",
    workspaceId: "default",
    accountId: "",
    marketplace: "US",
    executor: createOrchestratorExecutionExecutor({
      request: {
        naturalLanguageGoal: "Launch 通过后交给 PPC",
        marketplace: "US",
        sku: "SKU-001",
        asin: "B000TEST01",
        launchApproved: true,
      },
      requestedByUserId: "user-orchestrator",
      clock,
    }),
  });

  const output = result.execution.output as Record<string, unknown>;
  const plan = output.plan as Record<string, unknown>;
  const stages = plan.stages as Array<Record<string, unknown>>;
  const ppcStage = stages.find((stage) => stage.id === "ppc") as Record<string, unknown>;

  assert.equal(result.execution.status, "COMPLETED");
  assert.equal(ppcStage.status, "ready");
  assert.equal(plan.marketplace, "US");
  assert.equal(plan.sku, "SKU-001");
  assert.equal(plan.asin, "B000TEST01");
  assert.equal(result.toolCalls.length, 5);
});

test("orchestrator cannot call downstream business tools directly", () => {
  assert.equal(canAgentUseTool(orchestratorAgentDefinition, marketToolDefinitions[0]), false);
  assert.equal(
    canAgentUseTool(orchestratorAgentDefinition, {
      ...orchestratorToolDefinitions[0],
      toolId: "sellerSprite.market.search",
      permission: ["sellerSprite.market.read"],
    }),
    false,
  );
});
