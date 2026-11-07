import type { Decision, Run, Scope, Store } from "./types";
import { ResearchEngine } from "./engine";

/** History, approvals and export need saved evidence, never a working external connection. */
export function storedResearchEngine(store: Store, scope: Scope, mode: "fixture" | "live") {
  const unavailable = async (): Promise<never> => { throw new Error("LIVE_EXECUTION_NOT_INITIALIZED"); };
  return new ResearchEngine(store, scope, { listTools: unavailable, callTool: unavailable }, { next: unavailable }, { mode, authorizeLive: async () => false });
}

/** Kept separate from Next/Prisma so authorization is exercised with isolated repositories. */
export function requireOwnedRun(run: Run, scope: Scope) {
  if (run.scope.organizationId !== scope.organizationId || run.scope.workspaceId !== scope.workspaceId || run.scope.ownerId !== scope.ownerId) throw new Error("RESEARCH_SCOPE_DENIED");
}
export async function executeResearchCommand(engine: ResearchEngine, id: string, body: Record<string, unknown>, approvalAuthorized: boolean) {
  if (body.operation === "step") return engine.step(id);
  if (body.operation === "pause") return engine.pause(id);
  if (body.operation === "resume") return engine.resume(id);
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
