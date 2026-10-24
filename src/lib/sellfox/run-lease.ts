import { randomUUID } from "node:crypto";
import { type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export const sellfoxLeaseMs = 120_000;
export const sellfoxMaxRunAttempts = 4;
export class SellfoxLeaseLostError extends Error {
  constructor() { super("同步执行租约已失效，当前执行器停止提交，等待有效执行器接管。"); }
}
type RunClient = Pick<Prisma.TransactionClient, "sellfoxSyncRun">;
export type SellfoxRunLease = { runId: string; token: string };

export async function claimSellfoxRun(runId: string, db: RunClient = prisma, now = new Date()) {
  const token = randomUUID();
  const claimed = await db.sellfoxSyncRun.updateMany({ where: {
    id: runId, executionAttempts: { lt: sellfoxMaxRunAttempts },
    OR: [{ status: { in: ["queued", "failed"] } }, { status: "running", OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] }],
  }, data: { status: "running", executionToken: token, leaseExpiresAt: new Date(now.getTime() + sellfoxLeaseMs), executionAttempts: { increment: 1 }, error: null, finishedAt: null } });
  if (!claimed.count) {
    await db.sellfoxSyncRun.updateMany({ where: { id: runId, executionAttempts: { gte: sellfoxMaxRunAttempts }, OR: [{ status: "queued" }, { status: "running", OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] }] }, data: { status: "failed", error: "同步连续中断或失败已达重试上限，请检查 Worker 后重新发起同步。", finishedAt: now, executionToken: null, leaseExpiresAt: null } });
    return null;
  }
  return { runId, token };
}

/** CAS acquires the run row lock inside the page transaction. Losing owners roll back the entire page. */
export async function fenceSellfoxRun(lease: SellfoxRunLease, db: RunClient = prisma, now = new Date()) {
  const result = await db.sellfoxSyncRun.updateMany({ where: { id: lease.runId, status: "running", executionToken: lease.token, leaseExpiresAt: { gt: now } }, data: { leaseExpiresAt: new Date(now.getTime() + sellfoxLeaseMs) } });
  if (result.count !== 1) throw new SellfoxLeaseLostError();
}

export async function finishSellfoxRun(lease: SellfoxRunLease, data: Prisma.SellfoxSyncRunUpdateManyMutationInput, db: RunClient = prisma) {
  const result = await db.sellfoxSyncRun.updateMany({ where: { id: lease.runId, status: "running", executionToken: lease.token, leaseExpiresAt: { gt: new Date() } }, data: { ...data, executionToken: null, leaseExpiresAt: null, finishedAt: new Date() } });
  if (result.count !== 1) throw new SellfoxLeaseLostError();
}

export async function recoverExpiredSellfoxRuns(db: RunClient = prisma, now = new Date()) {
  // Conditional update also waits for in-flight page transactions, then rechecks expiry.
  return db.sellfoxSyncRun.updateMany({ where: { status: "running", OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: now } }] }, data: { status: "queued", executionToken: null, leaseExpiresAt: null, finishedAt: null, error: "上次执行中断，正在从已提交断点恢复。" } });
}
