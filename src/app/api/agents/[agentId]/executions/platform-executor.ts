import type { AgentRuntimeExecutor, AgentRuntimeExecutorResult, JsonValue } from "@/lib/agent-platform/types";

export function createPlatformExecutionExecutor(
  body: Record<string, unknown>, agentId: string, userId: string,
  requestedToolId: string, requestedToolInput: JsonValue, requiresApproval: boolean,
): AgentRuntimeExecutor {
  return async ({ execution, callTool, requestApproval, recordTrace, emitEvent }): Promise<AgentRuntimeExecutorResult> => {
    const toolResult = await callTool(requestedToolId, requestedToolInput);
    const summary = typeof body.message === "string" && body.message.trim()
      ? body.message.trim() : "Platform runtime core dry run.";
    recordTrace("decision", "Runtime decision made", { summary, toolStatus: toolResult.status });
    emitEvent("decision.made", { executionId: execution.id, summary, toolStatus: toolResult.status });
    const recommendation = {
      summary,
      evidence: toolResult.output ?? null,
      risks: requiresApproval ? ["Human approval requested by operator."] : [],
      confidence: toolResult.status === "SUCCEEDED" ? 0.9 : 0.5,
      nextAction: requiresApproval ? "Wait for approval" : "Persist observation",
    };
    recordTrace("recommendation", "Recommendation drafted", recommendation);
    emitEvent("recommendation.created", recommendation);
    if (toolResult.status === "APPROVAL_REQUIRED" && toolResult.approval) {
      return {
        recommendation,
        decision: { summary, rationale: "Tool call requires human approval before execution.", confidence: 0.9, nextStep: "Await human approval" },
        approvals: [toolResult.approval],
        output: { state: "waiting_approval", recommendation, approval: toolResult.approval as unknown as JsonValue },
        tokenUsage: 0, costCents: 0,
      };
    }
    if (requiresApproval) {
      const approval = await requestApproval({
        executionId: execution.id, riskLevel: "HIGH", recommendation,
        action: { type: "platform.runtime.execute", target: agentId, payload: toolResult.output ?? {} },
        requestedByUserId: userId,
      });
      return {
        recommendation,
        decision: { summary, rationale: "Approval required before action.", confidence: 0.9, nextStep: "Await human approval" },
        approvals: [approval], output: { state: "waiting_approval", recommendation },
        tokenUsage: 0, costCents: 0,
      };
    }
    return {
      recommendation,
      decision: { summary, rationale: "Dry run completed without side effects.", confidence: 0.9, nextStep: "Review execution trace" },
      output: { state: "completed", recommendation, toolOutput: toolResult.output ?? null },
      tokenUsage: 0, costCents: 0,
    };
  };
}
