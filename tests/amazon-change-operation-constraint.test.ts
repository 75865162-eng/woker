import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Authoritative allow-list keys from the code. Parse the source rather than
// importing to avoid pulling runtime crypto/env dependencies into this DDL test.
async function codeOperations(): Promise<string[]> {
  const src = await readFile(resolve(root, "src/lib/amazon-sync/approval-policy.ts"), "utf8");
  const block = /export const operationTypes = \{([\s\S]*?)\} as const;/.exec(src);
  assert.ok(block, "operationTypes block not found");
  return [...block![1].matchAll(/"([a-z-]+)"\s*:/g)].map(m => m[1]);
}

// The constraint value immediately before the fix (11 values, missing enable-authorization).
const oldConstraint = `'save-authorization','disable-authorization','save-source','save-plan','run','control-task','validate-authorization','save-access-grant','adopt-identity','recover-finance-window','recover-report'`;

async function withPglite(fn: (q: (sql: string) => Promise<unknown>, exec: (sql: string) => Promise<unknown>) => Promise<void>) {
  const { PGlite } = await import("@electric-sql/pglite") as {
    PGlite: new () => { query: (sql: string) => Promise<unknown>; exec: (sql: string) => Promise<unknown[]>; close: () => Promise<void> };
  };
  const db = new PGlite();
  try { await fn((sql) => db.query(sql), async (sql) => { await db.exec(sql); }); }
  finally { await db.close(); }
}

test("change-request operation CHECK constraint covers every code allow-list operation", async () => {
  const ops = await codeOperations();
  assert.ok(ops.includes("enable-authorization"), "code allow-list must contain enable-authorization");

  const migration = await readFile(
    resolve(root, "prisma/migrations/20261227000000_amazon_change_request_enable_operation/migration.sql"), "utf8");

  await withPglite(async (_q, exec) => {
    await exec(`
      CREATE TABLE "AmazonDataCenterChangeRequest" (
        "id" text PRIMARY KEY,
        "operation" text NOT NULL,
        "baseRevision" integer NOT NULL DEFAULT 0,
        CONSTRAINT "AmazonDataCenterChangeRequest_operation_check" CHECK ("operation" IN (${oldConstraint}))
      );`);

    // Reproduce the production bug: the old constraint rejects enable-authorization.
    await assert.rejects(
      () => exec(`INSERT INTO "AmazonDataCenterChangeRequest" ("id","operation") VALUES ('x','enable-authorization');`),
      /check_violation|violates check constraint/);

    // Apply the fix migration verbatim.
    await exec(migration);

    // Every code operation must now be accepted by the database constraint.
    for (const op of ops) {
      await exec(`INSERT INTO "AmazonDataCenterChangeRequest" ("id","operation") VALUES ('${op}','${op}');`);
    }
    // Sanity: an unknown operation is still rejected.
    await assert.rejects(
      () => exec(`INSERT INTO "AmazonDataCenterChangeRequest" ("id","operation") VALUES ('bad','not-a-real-operation');`),
      /check_violation|violates check constraint/);
  });
});
