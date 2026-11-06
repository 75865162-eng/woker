import type { Decision, Run, Scope } from "./types";
import type { ResearchEngine } from "./engine";

/** Kept separate from Next/Prisma so authorization is exercised with isolated repositories. */
export function requireOwnedRun(run: Run, scope: Scope) {
  if (run.scope.organizationId !== scope.organizationId || run.scope.workspaceId !== scope.workspaceId || run.scope.ownerId !== scope.ownerId) throw new Error("RESEARCH_SCOPE_DENIED");
}
export async function executeResearchCommand(engine: ResearchEngine, id: string, body: Record<string, unknown>, approvalAuthorized: boolean) {
  if (body.operation === "step") return engine.step(id);
  if (body.operation === "cancel") return engine.cancel(id);
  if (body.operation === "recover") return engine.recover(id);
  if (body.operation === "decide") {
    if (!approvalAuthorized) throw new Error("RESEARCH_APPROVAL_PERMISSION_REQUIRED");
    const decision = body.decision as Decision;
    if (decision?.kind === "AUTHORIZE_TOOL" && (!decision.callId || !decision.gateId)) throw new Error("PENDING_TOOL_CALL_MISMATCH");
    return engine.decide(id, decision);
  }
  throw new Error("UNKNOWN_RESEARCH_COMMAND");
}
