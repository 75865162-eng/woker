import type { FbaLocalPlansResult } from "./service";

type Plan = FbaLocalPlansResult["items"][number];
export type PlanBatchAction = "REQUEST" | "APPROVE" | "EXECUTE";

export function batchLines(plan: Plan, action: PlanBatchAction, userId: string, canEdit: boolean, now = Date.now()) {
  if (plan.status === "CANCELLED") return [];
  return plan.lines.filter(line => {
    if (line.reservationId) return false;
    const approval = line.approval;
    const stale = !!approval && approval.balanceRevision !== line.balance.revision;
    const expired = !!approval && new Date(String(approval.expiresAt)).getTime() <= now;
    if (action === "REQUEST") return canEdit && plan.createdBy === userId && (!approval || stale || expired || approval.status === "REJECTED");
    if (!approval || stale || expired) return false;
    return action === "APPROVE" ? approval.canDecide : canEdit && plan.createdBy === userId && approval.canExecute;
  });
}

/** Sequential single-line commands retain the existing atomic boundary and revision checks. */
export async function runPlanBatch(input: {
  plan: Plan; action: PlanBatchAction; userId: string; canEdit: boolean;
  read: () => Promise<Plan>; send: (path: string, body: unknown) => Promise<void>;
  active: () => boolean; progress: (completed: number, total: number) => void;
}) {
  const targets = batchLines(input.plan, input.action, input.userId, input.canEdit);
  let completed = 0;
  input.progress(0, targets.length);
  for (const target of targets) {
    if (!input.active()) return;
    const plan = await input.read();
    if (!input.active()) return;
    if (plan.id !== input.plan.id) throw Error("计划范围已变化，请重新读取。");
    const line = batchLines(plan, input.action, input.userId, input.canEdit).find(line => line.id === target.id);
    if (!line || (input.action !== "REQUEST" && line.approval?.id !== target.approval?.id)) throw Error("明细或审批已变化，已停止后续操作，请刷新核对。");
    if (input.action === "APPROVE") {
      await input.send("/api/operations/wms/approvals", { approvalId: line.approval!.id, revision: line.approval!.revision, decision: "APPROVE" });
    } else {
      await input.send("/api/operations/fba-local-plans", { action: input.action === "REQUEST" ? "REQUEST_RESERVATION" : "EXECUTE_RESERVATION",
        id: plan.id, expectedRevision: plan.revision, lineId: line.id,
        balanceRevision: input.action === "REQUEST" ? line.balance.revision : line.approval!.balanceRevision,
        ...(input.action === "EXECUTE" ? { approvalId: line.approval!.id } : {}) });
    }
    input.progress(++completed, targets.length);
  }
}
