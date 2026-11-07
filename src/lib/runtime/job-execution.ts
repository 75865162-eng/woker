import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

export type ExecutionKind = "import" | "image-upscale";
const tables = { import: Prisma.raw('"ImportJob"'), "image-upscale": Prisma.raw('"ImageUpscaleJob"') };
const leaseSeconds = 120;
export class ExecutionLostError extends Error {
  constructor() { super("Task execution ownership expired or changed."); }
}

export async function claimExecution(kind: ExecutionKind, id: string) {
  const table = tables[kind], token = randomUUID();
  const claimed = await prisma.$executeRaw`UPDATE ${table}
    SET status = 'running', "executionToken" = ${token},
      "leaseExpiresAt" = clock_timestamp() + ${leaseSeconds} * interval '1 second',
      "executionAttempts" = "executionAttempts" + 1, "updatedAt" = clock_timestamp()
    WHERE id = ${id} AND status IN ('queued', 'failed') AND "executionAttempts" < "maxAttempts"`;
  if (!claimed) return null;
  let lost = false, renewing = false;
  const timer = setInterval(() => {
    if (renewing || lost) return;
    renewing = true;
    void prisma.$executeRaw`UPDATE ${table} SET "leaseExpiresAt" = clock_timestamp() + ${leaseSeconds} * interval '1 second'
      WHERE id = ${id} AND status = 'running' AND "executionToken" = ${token} AND "leaseExpiresAt" > clock_timestamp()`
      .then(count => { if (!count) lost = true; })
      .catch(() => { /* A failed renewal never extends the database lease. Publication still checks it. */ })
      .finally(() => { renewing = false; });
  }, 20_000);
  timer.unref();
  return {
    token,
    dispose() { clearInterval(timer); },
    async write<T>(publish: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
      if (lost) throw new ExecutionLostError();
      return prisma.$transaction(async tx => {
        // Lock before testing expiry, so time spent waiting cannot validate an expired owner.
        await tx.$queryRaw`SELECT id FROM ${table} WHERE id = ${id} FOR UPDATE`;
        const owned = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM ${table}
          WHERE id = ${id} AND status = 'running' AND "executionToken" = ${token}
          AND "leaseExpiresAt" > clock_timestamp()`;
        if (!owned.length) { lost = true; throw new ExecutionLostError(); }
        return publish(tx);
      });
    },
  };
}
export type JobExecution = NonNullable<Awaited<ReturnType<typeof claimExecution>>>;

/** Legacy running rows without a token require review; never adopt them automatically. */
export async function recoverExpiredExecutions(kind: ExecutionKind, limit = 50) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Invalid recovery batch limit.");
  const table = tables[kind];
  return prisma.$transaction(async tx => {
  const rows = await tx.$queryRaw<Array<{ id: string; status: string }>>`WITH expired AS (
    SELECT id FROM ${table} WHERE status = 'running' AND "executionToken" IS NOT NULL
      AND "leaseExpiresAt" < clock_timestamp()
    ORDER BY "leaseExpiresAt" LIMIT ${limit} FOR UPDATE SKIP LOCKED
  ) UPDATE ${table} AS job SET status = CASE WHEN job."executionAttempts" < job."maxAttempts"
      THEN 'queued' ELSE 'failed' END::${kind === "import" ? Prisma.raw('"ImportJobStatus"') : Prisma.raw('"ImageUpscaleJobStatus"')},
    "leaseExpiresAt" = NULL, progress = 0, "updatedAt" = clock_timestamp(),
    error = CASE WHEN job."executionAttempts" >= job."maxAttempts" THEN 'Execution lease expired; retry limit reached.' ELSE NULL END
    FROM expired WHERE job.id = expired.id RETURNING job.id, job.status`;
  if (kind === "import") {
    for (const row of rows) {
      if (row.status !== "failed") continue;
      const job = await tx.importJob.findUniqueOrThrow({ where: { id: row.id }, select: { fileId: true } });
      await tx.fileObject.update({ where: { id: job.fileId }, data: { status: "failed" } });
    }
  }
  return rows.length;
  });
}
