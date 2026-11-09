import type { Prisma, PrismaClient } from "@prisma/client";

/** Called inside the membership transaction; existing balances and entries are preserved. */
export async function ensureMemberCallAccount(client: Pick<Prisma.TransactionClient, "$executeRaw">, scope: { organizationId: string; userId: string }) {
  // Raw SQL also works with a running development process's previously cached Prisma client.
  await client.$executeRaw`INSERT INTO "MarketCallAccount" ("organizationId","userId","balance","updatedAt")
    VALUES (${scope.organizationId},${scope.userId},0,CURRENT_TIMESTAMP) ON CONFLICT DO NOTHING`;
}

/** UI callers reuse their transaction; standalone roster tools get an atomic member + ledger write. */
export async function upsertMemberWithCallAccount(client: Prisma.TransactionClient | PrismaClient,
  input: Pick<Prisma.OrganizationMemberUpsertArgs, "where" | "update" | "create">) {
  const write = async (tx: Prisma.TransactionClient) => {
    const member = await tx.organizationMember.upsert(input);
    await ensureMemberCallAccount(tx, member);
    return member;
  };
  return "$transaction" in client ? client.$transaction(write) : write(client);
}
