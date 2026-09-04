import assert from "node:assert/strict";
import test from "node:test";

import { createApprovalRequest, resolveApproval } from "@/lib/agent-platform/approval";
import { createEvaluationRun, normalizeEvaluationScore } from "@/lib/agent-platform/evaluation";
import { canAgentUseTool } from "@/lib/agent-platform/permissions";
import { createAgentRuntime } from "@/lib/agent-platform/runtime";
import { createToolGateway } from "@/lib/agent-platform/tool-gateway";
import { createTraceEvent } from "@/lib/agent-platform/trace";
import { createPlatformToolAdapter, defaultAgentDefinitions, defaultToolDefinitions } from "@/lib/agent-platform/defaults";
import type { AgentDefinition, AgentToolDefinition } from "@/lib/agent-platform";

function createAgent(overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return {
    ...defaultAgentDefinitions[0],
    ...overrides,
  };
}

function createTool(overrides: Partial<AgentToolDefinition> = {}): AgentToolDefinition {
  return {
    ...defaultToolDefinitions[0],
    ...overrides,
  };
}

test("agent permissions restrict tool access", () => {
  const agent = createAgent();
  const tool = createTool();

  assert.equal(canAgentUseTool(agent, tool), true);
  assert.equal(canAgentUseTool({ ...agent, permissions: [] }, tool), false);
});

test("tool gateway executes low-risk tools and redacts secret fields", async () => {
  const agent = createAgent();
  const tool = createTool();
  const gateway = createToolGateway({
    tools: [tool],
    adapters: [createPlatformToolAdapter(() => new Date("2026-09-02T00:00:00.000Z"))],
    clock: () => new Date("2026-09-02T00:00:00.000Z"),
  });

  const result = await gateway.invoke({
    agent,
    executionId: "exec-1",
    context: {
      sku: "SKU-1",
      marketplace: "US",
      token: "secret-token",
    },
    toolId: "platform.context.snapshot",
    input: {
      includeKeys: ["sku", "marketplace", "token"],
      apiKey: "super-secret",
    },
    traceRedactionKeys: ["token"],
  });

  assert.equal(result.status, "SUCCEEDED");
  assert.ok(result.toolCall);
  assert.equal((result.toolCall?.redactedInput as Record<string, unknown>).apiKey, "[REDACTED]");
  assert.equal(((result.output as Record<string, unknown>).context as Record<string, unknown>).sku, "SKU-1");
});

test("tool gateway requests approval for critical tools", async () => {
  const agent = createAgent({
    approvalPolicy: { requiredForRiskLevels: ["HIGH", "CRITICAL"] },
    tools: ["critical.tool"],
    permissions: ["agent.platform.read", "critical.permission"],
  });
  const tool = createTool({
    toolId: "critical.tool",
    name: "Critical Tool",
    permission: ["critical.permission"],
    riskLevel: "CRITICAL",
  });
  const gateway = createToolGateway({
    tools: [tool],
    adapters: [
      {
        adapterId: "critical-adapter",
        async execute() {
          return { output: { ok: true }, latencyMs: 1 };
        },
      },
    ],
  });

  const result = await gateway.invoke({
    agent,
    executionId: "exec-2",
    context: {},
    toolId: "critical.tool",
    input: {},
  });

  assert.equal(result.status, "APPROVAL_REQUIRED");
  assert.equal(result.approval?.status, "REQUESTED");
  assert.equal(result.approval?.riskLevel, "CRITICAL");
});

test("runtime executes a full run with trace and tool calls", async () => {
  const agent = createAgent();
  const runtime = createAgentRuntime({
    definitions: [agent],
    tools: [createTool()],
    adapters: [createPlatformToolAdapter(() => new Date("2026-09-02T00:00:00.000Z"))],
    clock: () => new Date("2026-09-02T00:00:00.000Z"),
  });

  const result = await runtime.run({
    agentId: agent.id,
    context: {
      company: { organizationId: "org-1" },
      workspace: { workspaceId: "default", accountId: "", marketplace: "US" },
      user: { id: "user-1", email: "user@example.com" },
      sku: "SKU-1",
      marketplace: "US",
      currentData: { note: "runtime" },
    },
    input: { message: "dry run" },
    requestedByUserId: "user-1",
    workspaceId: "default",
    accountId: "",
    marketplace: "US",
    executor: async ({ callTool, recordTrace }) => {
      const toolResult = await callTool("platform.context.snapshot", { includeKeys: ["sku"] });
      recordTrace("decision", "runtime decision", { toolStatus: toolResult.status });

      return {
        recommendation: {
          summary: "Dry run completed",
          evidence: toolResult.output,
          confidence: 0.91,
        },
        decision: {
          summary: "Dry run completed",
          confidence: 0.91,
        },
        output: { ok: true },
        tokenUsage: 88,
        costCents: 0,
      };
    },
  });

  assert.equal(result.execution.status, "COMPLETED");
  assert.equal(result.execution.tokenUsage, 88);
  assert.equal(result.toolCalls.length, 1);
  assert.ok(result.traces.some((trace) => trace.type === "tool called"));
  assert.ok(result.events.some((event) => event.type === "completed"));
});

test("runtime preserves approval requests in waiting state", async () => {
  const agent = createAgent();
  const runtime = createAgentRuntime({
    definitions: [agent],
    tools: [createTool()],
    adapters: [createPlatformToolAdapter(() => new Date("2026-09-02T00:00:00.000Z"))],
    clock: () => new Date("2026-09-02T00:00:00.000Z"),
  });

  const result = await runtime.run({
    agentId: agent.id,
    context: {
      company: { organizationId: "org-1" },
      workspace: { workspaceId: "default", accountId: "", marketplace: "US" },
      user: { id: "user-1", email: "user@example.com" },
    },
    input: { message: "needs approval" },
    requestedByUserId: "user-1",
    workspaceId: "default",
    accountId: "",
    marketplace: "US",
    executor: async ({ requestApproval }) => {
      const approval = await requestApproval({
        executionId: "exec-approval",
        riskLevel: "HIGH",
        recommendation: {
          summary: "Approve before action",
          confidence: 0.8,
        },
        action: {
          type: "agent.action.execute",
          payload: { dryRun: true },
        },
        requestedByUserId: "user-1",
      });

      return {
        recommendation: approval.recommendation,
        approvals: [approval],
        output: { state: "waiting_approval" },
      };
    },
  });

  assert.equal(result.execution.status, "WAITING_APPROVAL");
  assert.equal(result.approvals[0]?.status, "REQUESTED");
});

test("trace redaction and evaluation scoring stay bounded", () => {
  const trace = createTraceEvent({
    executionId: "exec-redact",
    sequence: 1,
    type: "tool input",
    payload: {
      apiKey: "secret",
      nested: {
        token: "top-secret",
      },
    },
  });

  const approval = createApprovalRequest({
    executionId: "exec-approve",
    riskLevel: "HIGH",
    recommendation: {
      summary: "Approve",
    },
    action: {
      type: "noop",
    },
  });
  const resolved = resolveApproval({
    approval,
    decision: "APPROVED",
  });
  const evaluation = createEvaluationRun({
    id: "eval-1",
    evaluationCaseId: "case-1",
    payload: {
      input: { sku: "SKU-1" },
      expectedBehavior: { shouldApprove: true },
      actualBehavior: { shouldApprove: true },
      toolCalls: [],
      finalOutput: { ok: true },
      score: 112,
    },
  });

  assert.equal((trace.redactedPayload as Record<string, unknown>).apiKey, "[REDACTED]");
  assert.equal(((trace.redactedPayload as Record<string, unknown>).nested as Record<string, unknown>).token, "[REDACTED]");
  assert.equal(resolved.status, "APPROVED");
  assert.equal(normalizeEvaluationScore(112), 100);
  assert.equal(evaluation.score, 100);
});
