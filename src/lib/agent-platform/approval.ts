import type { AgentApproval, AgentAction, AgentRecommendation, AgentToolRiskLevel, ApprovalPolicy } from "./types";

export function requiresApproval(policy: ApprovalPolicy, riskLevel: AgentToolRiskLevel) {
  return policy.requiredForRiskLevels.includes(riskLevel);
}

export function createApprovalRequest(input: {
  executionId: string;
  riskLevel: AgentToolRiskLevel;
  recommendation: AgentRecommendation;
  action: AgentAction;
  requestedByUserId?: string;
  requestedAt?: Date;
  expiresAt?: Date;
  toolCallId?: string;
}): AgentApproval {
  const requestedAt = input.requestedAt ?? new Date();

  return {
    id: `approval-${input.executionId}-${requestedAt.getTime()}`,
    executionId: input.executionId,
    toolCallId: input.toolCallId,
    riskLevel: input.riskLevel,
    status: "REQUESTED",
    recommendation: input.recommendation,
    action: input.action,
    requestedByUserId: input.requestedByUserId,
    requestedAt: requestedAt.toISOString(),
    expiresAt: input.expiresAt?.toISOString(),
  };
}

export function resolveApproval(input: {
  approval: AgentApproval;
  decision: "APPROVED" | "REJECTED" | "EXPIRED";
  decidedByUserId?: string;
  reason?: string;
  decidedAt?: Date;
}): AgentApproval {
  const decidedAt = input.decidedAt ?? new Date();

  return {
    ...input.approval,
    status: input.decision === "APPROVED" ? "APPROVED" : input.decision === "REJECTED" ? "REJECTED" : "EXPIRED",
    decidedByUserId: input.decidedByUserId,
    decidedAt: decidedAt.toISOString(),
    humanDecision: {
      decision: input.decision,
      decidedByUserId: input.decidedByUserId,
      decidedAt: decidedAt.toISOString(),
      reason: input.reason,
    },
  };
}

