import { AsyncLocalStorage } from "node:async_hooks";
import type { Prisma } from "@prisma/client";
import { SyncInputError, type SyncScope } from "./policy";
import type { ChangeOperation } from "./approval-policy";
type Context = { tx: Prisma.TransactionClient; scope: SyncScope; action: ChangeOperation; approvalId: string; commandSourceIds?: string[] };
const context = new AsyncLocalStorage<Context>();
export function withApprovedChange<T>(value: Context, apply: () => Promise<T>) { return context.run(value, apply); }
export function approvedContext(scope: SyncScope, action: ChangeOperation) {
  const current = context.getStore();
  if (!current || current.action !== action || current.scope.organizationId !== scope.organizationId || current.scope.workspaceId !== scope.workspaceId) throw new SyncInputError("APPROVAL_REQUIRED：只能通过受控审批应用服务执行。", 428);
  return current;
}
