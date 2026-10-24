import { isObject, parseLaunchApproval } from "./handoff";
import type { OrchestratorExecutionOutput } from "./orchestrator";

export interface LaunchApprovalRecord {
  id: string; organizationId: string; executionId: string; status: string;
  decidedAt: Date | null; decidedByUserId: string | null; expiresAt: Date | null; action: unknown;
  execution: { organizationId: string; workspaceId: string; agentDefinitionId: string; output: unknown };
}

/** Only the persisted approval of this exact launch plan grants chain admission. */
export function verifyLaunchApproval(reference: unknown, record: LaunchApprovalRecord | null, scope: { organizationId: string; workspaceId: string }) {
  const ref = parseLaunchApproval(reference);
  if (!ref || !record || record.id !== ref.approvalId || record.executionId !== ref.executionId || record.organizationId !== scope.organizationId || record.execution.organizationId !== scope.organizationId || record.execution.workspaceId !== scope.workspaceId || record.execution.agentDefinitionId !== "orchestrator") return false;
  if (record.status !== "APPROVED" || !record.decidedAt || !record.decidedByUserId || (record.expiresAt && record.decidedAt >= record.expiresAt)) return false;
  const action = isObject(record.action) ? record.action : {};
  const payload = isObject(action.payload) ? action.payload : {};
  const output = isObject(record.execution.output) ? record.execution.output : {};
  const plan = isObject(output.plan) ? output.plan : {};
  return action.type === "orchestrator.launch.approve" && action.target === "launch" && payload.planId === ref.planId && plan.planId === ref.planId;
}

export function resolveLaunchOutput(output: unknown, approved: boolean, reference: { approvalId: string; executionId: string; planId: string }) {
  if (!isObject(output) || !isObject(output.plan) || !Array.isArray(output.handoffs)) throw new Error("Launch execution has no valid plan.");
  const value = output as unknown as OrchestratorExecutionOutput;
  if (value.plan.planId !== reference.planId) throw new Error("Launch plan does not match approval.");
  return {
    ...value,
    plan: {
      ...value.plan,
      launchGate: { ...value.plan.launchGate, status: approved ? "approved" : "waiting_approval", approvalRequired: !approved },
      stages: value.plan.stages.map((stage) => stage.id === "launch" ? { ...stage, status: approved ? "completed" : "waiting_approval" } : stage.id === "ppc" ? { ...stage, status: approved ? "ready" : "blocked_until_launch" } : stage),
    },
    handoffs: value.handoffs.map((handoff) => handoff.to === "ppc" ? {
      ...handoff, contractVersion: 1, kind: approved ? "LaunchTicket" : "PpcPlan", requiredApproval: !approved,
      payload: { ...handoff.payload, status: approved ? "ready" : "blocked_until_launch", launchApproved: approved, launchApproval: approved ? reference : null },
    } : handoff),
    currentStage: approved ? "ppc" : "launch",
    nextAction: approved ? "Launch approved; open PPC for suggestions. Advertising writes require separate approval." : "Launch not approved; PPC remains blocked_until_launch.",
  };
}
