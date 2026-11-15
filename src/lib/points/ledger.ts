import type { Prisma } from "@prisma/client";

export type LedgerKind = "GRANT" | "RESERVE" | "SETTLE" | "RELEASE" | "OVERSHOOT" | "EXPIRE" | "ADJUST";

export type LedgerWriteInput = {
  organizationId: string;
  userId: string;
  requestKey: string;
  kind: LedgerKind;
  operationCode?: string | null;
  delta: number;
  status?: string;
  balanceAfter: number;
  reservedAfter?: number;
  grantId?: string | null;
  priceRuleVersion?: number | null;
  unitCost?: number | null;
  runId?: string | null;
  requestId?: string | null;
  note: string;
  createdById?: string | null;
};

function isUniqueViolation(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

/**
 * 写一条流水。命中 (org,user,requestKey,kind) 唯一键时视为重复调用，静默忽略。
 * 这是幂等的唯一落点：调用方不需要自己查重。
 */
export async function writeLedger(tx: Prisma.TransactionClient, input: LedgerWriteInput): Promise<void> {
  try {
    await tx.pointsLedger.create({
      data: {
        organizationId: input.organizationId,
        userId: input.userId,
        requestKey: input.requestKey,
        kind: input.kind,
        operationCode: input.operationCode ?? null,
        delta: input.delta,
        status: input.status ?? "POSTED",
        balanceAfter: input.balanceAfter,
        reservedAfter: input.reservedAfter ?? 0,
        grantId: input.grantId ?? null,
        priceRuleVersion: input.priceRuleVersion ?? null,
        unitCost: input.unitCost ?? null,
        runId: input.runId ?? null,
        requestId: input.requestId ?? null,
        note: input.note,
        createdById: input.createdById ?? null,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return;
    throw error;
  }
}

export async function findLedgerEntry(
  tx: Prisma.TransactionClient,
  scope: { organizationId: string; userId: string; requestKey: string; kind: LedgerKind },
) {
  return tx.pointsLedger.findUnique({
    where: {
      organizationId_userId_requestKey_kind: {
        organizationId: scope.organizationId,
        userId: scope.userId,
        requestKey: scope.requestKey,
        kind: scope.kind,
      },
    },
  });
}
