import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { POST as sync } from "@/app/api/sellfox/sync/route";
import { POST as schedule } from "@/app/api/sellfox/schedules/route";
import { GET as snapshots } from "@/app/api/sellfox/[domain]/route";
import { processSellfoxSyncRun } from "@/lib/sellfox/sync-service";
import { createLocalSession } from "@/lib/auth/session";

// Exercise real route and service entry points with an isolated in-memory DB stub.
test("Sellfox permissions, configuration and response-contract gates reject before transport", async () => {
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER, SELLFOX_CLIENT_ID: process.env.SELLFOX_CLIENT_ID, SELLFOX_CLIENT_SECRET: process.env.SELLFOX_CLIENT_SECRET, QUEUE_DRIVER: process.env.QUEUE_DRIVER };
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previousPrisma = globals.prisma;
  const previousFetch = globalThis.fetch;
  delete process.env.DATABASE_URL;
  process.env.AUTH_DRIVER = "local";
  process.env.QUEUE_DRIVER = "redis";
  let networkCalls = 0;
  let runWrites = 0;
  let lastError: string | undefined;
  let status: string | undefined;
  globals.prisma = {
    organizationMember: { findUnique: async () => ({ role: "owner", user: { status: "active" } }) },
    workspaceScope: { findUnique: async () => ({ id: "workspace" }) },
    sellfoxSyncRun: {
      create: async () => { runWrites += 1; return {}; },
      findUnique: async () => ({ id: "old-run", resource: "invalid", organizationId: "org-a", workspaceId: "default", userId: "actor", status: "queued", summary: {} }),
      update: async ({ data }: { data: { status?: string; error?: string } }) => { status = data.status; lastError = data.error; return {}; },
      updateMany: async ({ data }: { data: { status?: string; error?: string } }) => { status = data.status; lastError = data.error; return { count: 1 }; },
    },
  } as unknown as PrismaClient;
  globalThis.fetch = async () => { networkCalls += 1; throw new Error("No transport allowed in this test"); };
  async function request(role: string, body: unknown) {
    const session = await createLocalSession({ id: "actor", organizationId: "org-a", organizationName: "Fixture", role, email: "actor@example.test", name: "Actor" });
    return new Request("http://localhost/api/sellfox/sync", { method: "POST", headers: { "Content-Type": "application/json", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` }, body: JSON.stringify(body) });
  }
  try {
    assert.equal((await sync(new Request("http://localhost/api/sellfox/sync", { method: "POST" }))).status, 401);
    assert.equal((await sync(await request("designer", { resource: "stores" }))).status, 403);
    assert.equal((await schedule(await request("designer", { resource: "stores", enabled: true }))).status, 403);
    delete process.env.SELLFOX_CLIENT_ID;
    delete process.env.SELLFOX_CLIENT_SECRET;
    const missingPlan = await schedule(await request("owner", { resource: "inventory", enabled: true }));
    assert.equal(missingPlan.status, 503);
    assert.match((await missingPlan.json()).error, /服务端未配置赛狐凭据/);
    const missing = await sync(await request("owner", { resource: "stores" }));
    assert.equal(missing.status, 503);
    assert.match((await missing.json()).error, /服务端未配置赛狐凭据/);
    process.env.SELLFOX_CLIENT_ID = "fixture-id";
    process.env.SELLFOX_CLIENT_SECRET = "fixture-secret";
    assert.equal((await sync(await request("owner", { resource: "invalid" }))).status, 400);
    for (const body of [
      { resource: "performance", startDate: "2026-01-01", endDate: "2026-04-01" },
      { resource: "performance", dateRange: { from: "2026-10-24", to: "2026-10-23" } },
      { resource: "inventory", reportDate: "2000-01-01" },
      { resource: "hourly", reportDate: "2000-01-01" },
    ]) assert.equal((await sync(await request("owner", body))).status, 400);
    for (const adTypes of [[], ["invalid"], "sp"]) assert.equal((await sync(await request("owner", { resource: "ads_report", adTypes }))).status, 400);
    assert.equal(runWrites, 0);
    await assert.rejects(() => processSellfoxSyncRun("old-run"), /有效的赛狐同步资源/);
    assert.equal(status, "failed");
    assert.ok(lastError);
    assert.equal(networkCalls, 0);
  } finally {
    globals.prisma = previousPrisma;
    globalThis.fetch = previousFetch;
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("snapshot browsing remains an independent authenticated route", async () => {
  const response = await snapshots(new Request("http://localhost/api/sellfox/inventory"), { params: Promise.resolve({ domain: "inventory" }) });
  assert.equal(response.status, 401);
});

test("manual sync rejects an active resource without losing the requested scope or sending transport", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient };
  const previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER, SELLFOX_CLIENT_ID: process.env.SELLFOX_CLIENT_ID, SELLFOX_CLIENT_SECRET: process.env.SELLFOX_CLIENT_SECRET, QUEUE_DRIVER: process.env.QUEUE_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local"; process.env.QUEUE_DRIVER = "redis";
  process.env.SELLFOX_CLIENT_ID = "fixture-id"; process.env.SELLFOX_CLIENT_SECRET = "fixture-secret";
  let lockAcquired = false;
  globals.prisma = {
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({
      $executeRaw: async () => { lockAcquired = true; },
      sellfoxSyncRun: { findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        assert.equal(lockAcquired, true); assert.equal(where.organizationId, "org-a");
        assert.equal(where.workspaceId, "default"); assert.equal(where.resource, "sales");
        return { id: "existing-run" };
      }, create: async () => { throw new Error("Must not create duplicate run"); } },
    }),
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org-a", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    const response = await sync(new Request("http://localhost/api/sellfox/sync", { method: "POST", headers: { "Content-Type": "application/json", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` }, body: JSON.stringify({ resource: "sales", reportDate: "2026-10-24" }) }));
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.equal(payload.runId, "existing-run"); assert.match(payload.error, /等待完成/);
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
