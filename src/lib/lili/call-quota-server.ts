import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";
import { MarketQuotaError, type MarketCallOutcome, type MarketCallQuota, type MarketCallReservation } from "./call-quota";

type AccountScope = { organizationId: string; userId: string };
type Account = { balance: number };
export type QuotaEntry = {
  id: string; kind: string; delta: number; status: string; balanceAfter: number;
  provider: string | null; tool: string | null; workspaceId: string | null;
  runId: string | null; callId: string | null; note: string; createdAt: Date; updatedAt: Date;
};
type Database = Pick<typeof prisma, "$transaction">;

async function lockAccount(tx: Prisma.TransactionClient, scope: AccountScope) {
  const rows = await tx.$queryRaw<Account[]>`SELECT "balance" FROM "MarketCallAccount"
    WHERE "organizationId"=${scope.organizationId} AND "userId"=${scope.userId} FOR UPDATE`;
  return rows[0];
}

/** The same account row serializes both providers across devices, runs and workspaces. */
export function marketCallQuota(scope: AccountScope, db: Database = prisma): MarketCallQuota {
  return {
    async reserve(input: MarketCallReservation) {
      try {
        await db.$transaction(async tx => {
          const account = await lockAccount(tx, scope);
          if (!account || account.balance < 1) throw new MarketQuotaError("MARKET_QUOTA_EXHAUSTED");
          const previous = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "MarketCallEntry"
            WHERE "organizationId"=${scope.organizationId} AND "userId"=${scope.userId} AND "requestKey"=${input.callId}`;
          if (previous.length) throw new MarketQuotaError("MARKET_QUOTA_REPLAY_BLOCKED");
          const balance = account.balance - 1;
          await tx.$executeRaw`UPDATE "MarketCallAccount" SET "balance"=${balance}, "updatedAt"=CURRENT_TIMESTAMP
            WHERE "organizationId"=${scope.organizationId} AND "userId"=${scope.userId}`;
          await tx.$executeRaw`INSERT INTO "MarketCallEntry"
            ("id","organizationId","userId","requestKey","kind","delta","status","balanceAfter","provider","tool","workspaceId","runId","callId","note","updatedAt")
            VALUES (${randomUUID()},${scope.organizationId},${scope.userId},${input.callId},'CALL',-1,'RESERVED',${balance},${input.provider},${input.tool},${input.workspaceId},${input.runId},${input.callId},'市场请求预扣 1 次',CURRENT_TIMESTAMP)`;
        });
      } catch (error) {
        if (error instanceof MarketQuotaError) throw error;
        throw new MarketQuotaError("MARKET_QUOTA_UNAVAILABLE");
      }
    },
    async settle(callId: string, outcome: MarketCallOutcome) {
      await db.$transaction(async tx => {
        const account = await lockAccount(tx, scope);
        if (!account) throw new MarketQuotaError("MARKET_QUOTA_UNAVAILABLE");
        const rows = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "MarketCallEntry"
          WHERE "organizationId"=${scope.organizationId} AND "userId"=${scope.userId}
          AND "requestKey"=${callId} AND "kind"='CALL' AND "status"='RESERVED'`;
        if (!rows.length) return; // Repeated settlement cannot refund or debit twice.
        if (outcome === "REFUNDED") {
          await tx.$executeRaw`UPDATE "MarketCallAccount" SET "balance"="balance"+1,"updatedAt"=CURRENT_TIMESTAMP
            WHERE "organizationId"=${scope.organizationId} AND "userId"=${scope.userId}`;
          await tx.$executeRaw`UPDATE "MarketCallEntry" SET "status"='REFUNDED',"delta"=0,"balanceAfter"=${account.balance + 1},
            "note"='已确认未发送，退回 1 次',"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${rows[0].id}`;
        } else {
          await tx.$executeRaw`UPDATE "MarketCallEntry" SET "status"=${outcome},"updatedAt"=CURRENT_TIMESTAMP WHERE "id"=${rows[0].id}`;
        }
      });
    },
  };
}

/** Only a verified owner/database_admin maintenance command may grant an allowance. */
export async function setMarketCallBalance(scope: AccountScope, input: { actorUserId: string; balance: number; expectedBalance: number; requestKey: string; note: string }, db: Database = prisma) {
  if (!Number.isSafeInteger(input.balance) || input.balance < 0 || input.balance > 1_000_000 || !Number.isSafeInteger(input.expectedBalance) || input.expectedBalance < 0 || !input.requestKey || input.requestKey.length > 200 || !input.note.trim() || input.note.length > 500) throw new Error("INVALID_QUOTA_GRANT");
  return db.$transaction(async tx => {
    const actor = await tx.organizationMember.findUnique({ where: { organizationId_userId: { organizationId: scope.organizationId, userId: input.actorUserId } }, select: { role: true, user: { select: { status: true } } } });
    const target = await tx.organizationMember.findUnique({ where: { organizationId_userId: scope }, select: { user: { select: { status: true } } } });
    if (!actor || !["owner", "database_admin"].includes(actor.role) || actor.user.status !== "active" || target?.user.status !== "active") throw new Error("QUOTA_GRANT_FORBIDDEN");
    await tx.$executeRaw`INSERT INTO "MarketCallAccount" ("organizationId","userId","balance","updatedAt")
      VALUES (${scope.organizationId},${scope.userId},0,CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING`;
    const account = (await lockAccount(tx, scope))!;
    const existing = await tx.$queryRaw<{ id: string }[]>`SELECT "id" FROM "MarketCallEntry"
      WHERE "organizationId"=${scope.organizationId} AND "userId"=${scope.userId} AND "requestKey"=${input.requestKey}`;
    if (existing.length) return { balance: account.balance, applied: false };
    if (account.balance !== input.expectedBalance) throw new Error("STALE_QUOTA_BALANCE");
    const id = randomUUID(), delta = input.balance - account.balance;
    await tx.$executeRaw`UPDATE "MarketCallAccount" SET "balance"=${input.balance},"updatedAt"=CURRENT_TIMESTAMP
      WHERE "organizationId"=${scope.organizationId} AND "userId"=${scope.userId}`;
    await tx.$executeRaw`INSERT INTO "MarketCallEntry"
      ("id","organizationId","userId","requestKey","kind","delta","status","balanceAfter","note","updatedAt")
      VALUES (${id},${scope.organizationId},${scope.userId},${input.requestKey},'ADJUSTMENT',${delta},'COMPLETED',${input.balance},${input.note},CURRENT_TIMESTAMP)`;
    await tx.auditLog.create({ data: { organizationId: scope.organizationId, userId: input.actorUserId,
      action: "market_call_balance_set", entityType: "MarketCallAccount", entityId: scope.userId,
      metadata: { entryId: id, previousBalance: account.balance, balance: input.balance, delta, reason: input.note } }, select: { id: true } });
    return { balance: input.balance, applied: true };
  });
}

/** Account identity is supplied by server authentication, never by a query parameter. */
export async function readMarketCallQuota(scope: AccountScope, page = 1, db: Database = prisma) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 10_000) throw new Error("INVALID_QUOTA_PAGE");
  const pageSize = 30;
  return db.$transaction(async tx => {
    const accounts = await tx.$queryRaw<Account[]>`SELECT "balance" FROM "MarketCallAccount"
      WHERE "organizationId"=${scope.organizationId} AND "userId"=${scope.userId}`;
    const entries = await tx.$queryRaw<QuotaEntry[]>`SELECT "id","kind","delta","status","balanceAfter","provider","tool","workspaceId","runId","callId","note","createdAt","updatedAt"
      FROM "MarketCallEntry" WHERE "organizationId"=${scope.organizationId} AND "userId"=${scope.userId}
      ORDER BY "createdAt" DESC,"id" DESC LIMIT ${pageSize + 1} OFFSET ${(page - 1) * pageSize}`;
    const totals = await tx.$queryRaw<{ used: number; pending: number }[]>`SELECT
      count(*) FILTER (WHERE "kind"='CALL' AND "delta"=-1)::int AS used,
      count(*) FILTER (WHERE "kind"='CALL' AND "status" IN ('RESERVED','UNKNOWN'))::int AS pending
      FROM "MarketCallEntry" WHERE "organizationId"=${scope.organizationId} AND "userId"=${scope.userId}`;
    return { balance: accounts[0]?.balance ?? 0, used: totals[0]?.used ?? 0, pending: totals[0]?.pending ?? 0,
      entries: entries.slice(0, pageSize), page, hasNext: entries.length > pageSize };
  }, { isolationLevel: "RepeatableRead" });
}
