import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { processSellfoxSyncRun } from "@/lib/sellfox/sync-service";

test("stores resume the failed page and final run summary keeps transactional progress", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globals.prisma; const previousFetch = globalThis.fetch;
  const env = { DATABASE_URL: process.env.DATABASE_URL, SELLFOX_CLIENT_ID: process.env.SELLFOX_CLIENT_ID, SELLFOX_CLIENT_SECRET: process.env.SELLFOX_CLIENT_SECRET };
  delete process.env.DATABASE_URL;
  process.env.SELLFOX_CLIENT_ID = "fixture-id"; process.env.SELLFOX_CLIENT_SECRET = "fixture-secret";
  let run: Record<string, unknown> = { id: "run", organizationId: "org", workspaceId: "workspace", userId: "user", resource: "stores", status: "queued", summary: {}, startedAt: new Date("2026-10-23T16:00:00Z") };
  let stores = new Map<string, unknown>(); let failPageTwo = true;
  const pages: number[] = [];
  function runs(get: () => Record<string, unknown>, put: (value: Record<string, unknown>) => void) {
    return { findUnique: async () => structuredClone(get()), update: async ({ data }: { data: Record<string, unknown> }) => { put({ ...get(), ...data }); return get(); } };
  }
  globals.prisma = {
    sellfoxSyncRun: runs(() => run, (value) => { run = value; }),
    $transaction: async (callback: (tx: unknown) => Promise<void>) => {
      let pendingRun = structuredClone(run); const pendingStores = new Map(stores);
      await callback({
        sellfoxSyncRun: runs(() => pendingRun, (value) => { pendingRun = value; }),
        sellfoxStore: { upsert: async ({ create }: { create: { externalId: string; organizationId: string; workspaceId: string } }) => {
          assert.equal(create.organizationId, "org"); assert.equal(create.workspaceId, "workspace");
          pendingStores.set(create.externalId, create);
        } },
      });
      if (pendingStores.size === 101 && failPageTwo) { failPageTwo = false; throw new Error("SQL private data"); }
      run = pendingRun; stores = pendingStores;
    },
  } as unknown as PrismaClient;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("/oauth/")) return Response.json({ data: { access_token: "fixture-token", expires_in: 86400000 } });
    const pageNo = Number(JSON.parse(String(init?.body)).pageNo); pages.push(pageNo);
    return Response.json({ data: { rows: pageNo === 1 ? Array.from({ length: 100 }, (_, i) => ({ shopId: `shop-${i}` })) : [{ shopId: "last-shop" }], totalPage: 2 } });
  };
  try {
    await assert.rejects(() => processSellfoxSyncRun("run"), /SQL private data/);
    assert.equal(run.status, "failed"); assert.doesNotMatch(String(run.error), /SQL private data/);
    assert.equal(stores.size, 100);
    const progress = () => (run.summary as { progress: { count: number; cursor: { pageNo: number; done: boolean } } }).progress;
    assert.deepEqual(progress().cursor, { pageNo: 2, done: false });
    await processSellfoxSyncRun("run");
    assert.equal(run.status, "done"); assert.equal(stores.size, 101);
    assert.deepEqual(pages, [1, 2, 2]);
    assert.equal(progress().count, 101); assert.equal(progress().cursor.done, true);
    assert.deepEqual((run.summary as { result: unknown }).result, { count: 101 });
    run.status = "queued";
    await processSellfoxSyncRun("run");
    assert.deepEqual(pages, [1, 2, 2]);
  } finally {
    globals.prisma = previous; globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("legacy performance runs freeze dates from creation and keep completed checkpoints", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }; const previous = globals.prisma;
  let run: Record<string, unknown> = {
    id: "legacy", organizationId: "org", workspaceId: "workspace", userId: "user", resource: "performance", status: "queued",
    startedAt: new Date("2026-10-23T16:00:00Z"),
    summary: { shopExternalIds: ["shop-a"], progress: { performance: { "2026-10-23": { stores: { "shop-a": { pageNo: 1, synced: 12, done: true } } } } } },
  };
  globals.prisma = {
    sellfoxStore: { findMany: async () => [{ id: "store-a", externalId: "shop-a" }] },
    sellfoxSyncRun: { findUnique: async () => structuredClone(run), update: async ({ data }: { data: Record<string, unknown> }) => { run = { ...run, ...data }; return run; } },
  } as unknown as PrismaClient;
  try {
    await processSellfoxSyncRun("legacy");
    assert.equal(run.status, "done");
    const summary = run.summary as Record<string, unknown>;
    assert.equal(summary.startDate, "2026-10-23"); assert.equal(summary.datesFrozen, true);
    assert.deepEqual(summary.result, { startDate: "2026-10-23", endDate: "2026-10-23", storeCount: 1, synced: 12 });
    assert.ok(summary.progress);
  } finally { globals.prisma = previous; }
});
