import { runStore } from "./helpers/sellfox-run-store";
import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { Client } from "pg";
import { encryptSellfoxCredentials } from "@/lib/sellfox/credential-crypto";
import { processSellfoxSyncRun } from "@/lib/sellfox/sync-service";

test("stores resume the failed page and final run summary keeps transactional progress", async (t) => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globals.prisma; const previousFetch = globalThis.fetch;
  const env = { DATABASE_URL: process.env.DATABASE_URL, SELLFOX_CLIENT_ID: process.env.SELLFOX_CLIENT_ID, SELLFOX_CLIENT_SECRET: process.env.SELLFOX_CLIENT_SECRET, SELLFOX_CREDENTIAL_ENCRYPTION_KEY: process.env.SELLFOX_CREDENTIAL_ENCRYPTION_KEY, SELLFOX_RATE_LIMIT_MODE: process.env.SELLFOX_RATE_LIMIT_MODE, SELLFOX_REQUEST_SPACING_MS: process.env.SELLFOX_REQUEST_SPACING_MS, AUTH_SECRET: process.env.AUTH_SECRET };
  process.env.DATABASE_URL = "postgresql://fixture:fixture@127.0.0.1:1/fixture";
  delete process.env.SELLFOX_CLIENT_ID; delete process.env.SELLFOX_CLIENT_SECRET;
  process.env.SELLFOX_CREDENTIAL_ENCRYPTION_KEY = randomBytes(32).toString("base64");
  process.env.SELLFOX_RATE_LIMIT_MODE = "path"; process.env.SELLFOX_REQUEST_SPACING_MS = "1050";
  process.env.AUTH_SECRET = "sellfox-sync-run-fixture-auth-secret-at-least-32-characters";
  t.mock.method(Client.prototype, "connect", async () => undefined);
  t.mock.method(Client.prototype, "query", async () => ({ rows: [{ ok: true }] }));
  t.mock.method(Client.prototype, "end", async () => undefined);
  let run: Record<string, unknown> = { id: "run", organizationId: "org", workspaceId: "workspace", userId: "user", resource: "stores", executionAttempts: 0, status: "queued", summary: {}, startedAt: new Date("2026-10-23T16:00:00Z") };
  const runScope = { organizationId: "org", workspaceId: "workspace" };
  let includeCredential = true;
  const credentialsCiphertext = encryptSellfoxCredentials({ clientId: "scoped-fixture-id", clientSecret: "scoped-fixture-secret" }, runScope);
  let stores = new Map<string, unknown>(); let failPageTwo = true;
  const pages: number[] = [];
  let requests = 0;
  const shards: Record<string, unknown>[] = [];
  globals.prisma = {
    sellfoxSyncShard: { upsert: async ({ create }: { create: Record<string, unknown> }) => { shards.push(create); return create; } },
    organizationMember: { findUnique: async () => ({ role: "owner", user: { status: "active" } }) },
    workspaceScope: { findUnique: async () => ({ id: "workspace" }) },
    sellfoxIntegrationCredential: { findUnique: async ({ where }: { where: { organizationId_workspaceId: typeof runScope } }) => includeCredential && where.organizationId_workspaceId.organizationId === runScope.organizationId && where.organizationId_workspaceId.workspaceId === runScope.workspaceId ? { credentialsCiphertext, revision: 1 } : null },
    organizationRosterRole: { findMany: async () => [{ id: "owner", name: "Owner", description: "fixture", sortOrder: 0, updatedAt: new Date(0), permissions: { sellfox: ["view", "create"], settings: ["edit"] } }], count: async () => 1, createMany: async () => ({ count: 0 }) },
    sellfoxSyncRun: runStore(() => run, (value) => { run = value; }),
    $transaction: async (callback: (tx: unknown) => Promise<void>) => {
      let pendingRun = structuredClone(run); const pendingStores = new Map(stores);
      await callback({
        sellfoxSyncRun: runStore(() => pendingRun, (value) => { pendingRun = value; }),
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
    requests++;
    const requestUrl = new URL(String(url));
    if (requestUrl.pathname.includes("/oauth/")) {
      assert.equal(requestUrl.searchParams.get("client_id"), "scoped-fixture-id");
      assert.equal(requestUrl.searchParams.get("client_secret"), "scoped-fixture-secret");
      return Response.json({ data: { access_token: "fixture-token", expires_in: 86400000 } });
    }
    const pageNo = Number(JSON.parse(String(init?.body)).pageNo); pages.push(pageNo);
    return Response.json({ data: { rows: pageNo === 1 ? Array.from({ length: 100 }, (_, i) => ({ shopId: `shop-${i}` })) : [{ shopId: "last-shop" }], totalPage: 2 } });
  };
  try {
    includeCredential = false;
    await assert.rejects(() => processSellfoxSyncRun("run"), /凭据作用域未配置或不可用/);
    assert.equal(requests, 0);
    includeCredential = true;
    run.status = "queued";
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
    assert.ok(shards.length > 0);
    assert.ok(shards.every(shard => shard.organizationId === "org" && shard.workspaceId === "workspace" && shard.runId === "run"));
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
  const previousDatabaseUrl = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  let run: Record<string, unknown> = {
    id: "legacy", organizationId: "org", workspaceId: "workspace", userId: "user", resource: "performance", executionAttempts: 0, status: "queued",
    startedAt: new Date("2026-10-23T16:00:00Z"),
    summary: { shopExternalIds: ["shop-a"], progress: { performance: { "2026-10-23": { stores: { "shop-a": { pageNo: 1, synced: 12, done: true } } } }, performanceSettled: { "2026-10-23": { stores: { "shop-a": { pageNo: 1, synced: 3, done: true } } } } } },
  };
  const shards: Record<string, unknown>[] = [];
  let coverageCleared = false;
  globals.prisma = {
    sellfoxSyncShard: { upsert: async ({ create }: { create: Record<string, unknown> }) => { shards.push(create); return create; } },
    $queryRawUnsafe: async (_sql: string, organizationId: string, workspaceId: string) => { assert.equal(organizationId, "org"); assert.equal(workspaceId, "workspace"); return []; },
    organizationMember: { findUnique: async () => ({ role: "owner", user: { status: "active" } }) },
    workspaceScope: { findUnique: async () => ({ id: "workspace" }) },
    sellfoxStore: { findMany: async () => [{ id: "store-a", externalId: "shop-a" }] },
    sellfoxSyncRun: runStore(() => run, (value) => { run = value; }),
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({ sellfoxSyncRun: runStore(() => run, (value) => { run = value; }), sellfoxCoverage: { deleteMany: async () => { coverageCleared = true; return { count: 0 }; } } }),
  } as unknown as PrismaClient;
  try {
    await processSellfoxSyncRun("legacy");
    assert.equal(run.status, "done");
    const summary = run.summary as Record<string, unknown>;
    assert.equal(summary.startDate, "2026-10-23"); assert.equal(summary.datesFrozen, true);
    assert.deepEqual(summary.result, { startDate: "2026-10-23", endDate: "2026-10-23", storeCount: 1, synced: 15, onlySettleModes: [false, true] });
    assert.ok(summary.progress);
    assert.ok(shards.length > 0);
    assert.ok(shards.every(shard => shard.organizationId === "org" && shard.workspaceId === "workspace" && shard.runId === "legacy"));
    assert.equal(coverageCleared, true);
  } finally {
    globals.prisma = previous;
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
});
