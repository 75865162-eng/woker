import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma, PrismaClient } from "@prisma/client";
import { createLocalSession } from "@/lib/auth/session";
import { GET as browse } from "@/app/api/sellfox/[domain]/route";
import { GET as exportRows } from "@/app/api/sellfox/[domain]/export/route";
import { GET as detail } from "@/app/api/sellfox/[domain]/[id]/route";
import { GET as schedules, POST as schedule } from "@/app/api/sellfox/schedules/route";
import { POST as sync } from "@/app/api/sellfox/sync/route";

test("new CPC domains browse/export/detail with authenticated workspace scope and expose opt-in daily schedules", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { AUTH_DRIVER: process.env.AUTH_DRIVER, DATABASE_URL: process.env.DATABASE_URL, QUEUE_DRIVER: process.env.QUEUE_DRIVER, SELLFOX_CLIENT_ID: process.env.SELLFOX_CLIENT_ID, SELLFOX_CLIENT_SECRET: process.env.SELLFOX_CLIENT_SECRET };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local"; process.env.QUEUE_DRIVER = "redis";
  process.env.SELLFOX_CLIENT_ID = "fixture"; process.env.SELLFOX_CLIENT_SECRET = "fixture";
  const sqlCalls: Prisma.Sql[] = []; let expectedDomain = ""; let overflow = false;
  const row = { id: "row", targetingId: "target", searchTerm: "customer query", currency: null, cost: 2, adSales: 10 };
  const payloadModel = { findFirst: async ({ where }: { where: Record<string, unknown> }) => {
    assert.deepEqual(where, { id: "row", organizationId: "org", workspaceId: "ws" }); return { payload: { token: "private", 投放: "keyword" } };
  } };
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    sellfoxStore: { findMany: async () => [], findFirst: async () => null },
    sellfoxAdsTargetingDaily: payloadModel, sellfoxAdsSearchTermDaily: payloadModel,
    sellfoxSyncSchedule: { findMany: async () => [] }, workerHeartbeat: { findFirst: async () => null },
    $queryRaw: async (sql: Prisma.Sql) => {
      sqlCalls.push(sql); assert.ok(sql.text.includes(`FROM sellfox_${expectedDomain}_daily`));
      assert.ok(sql.values.includes("org")); assert.ok(sql.values.includes("ws"));
      if (sql.text.startsWith("WITH")) return [{ total: overflow ? 10001 : 1, rows: [row], totals: [], dates: [] }];
      if (sql.text.startsWith("SELECT count")) return [{ total: 1 }];
      return [row];
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({
      $executeRaw: async () => undefined,
      sellfoxSyncRun: { findFirst: async ({ where }: { where: Record<string, unknown> }) => { assert.equal(where.resource, expectedDomain); return { id: "existing" }; } },
      sellfoxSyncSchedule: { findUnique: async () => null, upsert: async ({ create }: { create: Record<string, unknown> }) => {
        assert.equal(create.organizationId, "org"); assert.equal(create.workspaceId, "ws"); assert.equal(create.resource, expectedDomain); assert.equal(create.enabled, true);
        return { ...create, lastEnqueuedAt: null };
      } },
    }),
  } as unknown as PrismaClient;
  const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
  const headers = { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}`, "Content-Type": "application/json" };
  const request = (path: string, body?: unknown) => new Request(`http://localhost/api/sellfox/${path}`, { headers, ...(body ? { method: "POST", body: JSON.stringify(body) } : {}) });
  try {
    const plans = await (await schedules(request("schedules"))).json();
    for (const domain of ["ads_targeting", "ads_search_term"]) {
      expectedDomain = domain;
      const plan = plans.schedules.find((item: { resource: string }) => item.resource === domain);
      assert.equal(plan.enabled, false); assert.equal(plan.intervalMinutes, 1440); assert.equal(plan.disabledReason, null);
      const context = { params: Promise.resolve({ domain }) };
      assert.equal((await browse(new Request(`http://localhost/api/sellfox/${domain}`), context)).status, 401);
      assert.equal((await browse(request(`${domain}?shopExternalId=foreign`), context)).status, 403);
      const response = await browse(request(`${domain}?layout=workbench&search=needle&adType=sp`), context);
      assert.equal(response.status, 200); assert.equal((await response.json()).rows[0].targetingId, "target");
      const csv = await exportRows(request(`${domain}/export?layout=workbench`), context);
      assert.equal(csv.status, 200); assert.match(await csv.text(), domain === "ads_targeting" ? /投放ID/ : /用户搜索词/);
      const agent = await exportRows(request(`${domain}/export?agent=1&quickFilter=spend&adType=sp`), context);
      assert.equal(agent.status, 200); assert.match(await agent.text(), /targetingId/); assert.match(sqlCalls.at(-1)!.text, /cost>0/);
      const raw = await detail(request(`${domain}/row`), { params: Promise.resolve({ domain, id: "row" }) });
      assert.equal(raw.status, 200); const text = await raw.text(); assert.match(text, /keyword/); assert.doesNotMatch(text, /private/);
      overflow = true; assert.equal((await exportRows(request(`${domain}/export?layout=workbench`), context)).status, 413); overflow = false;
      const enabled = await schedule(request("schedules", { resource: domain, enabled: true }));
      assert.equal(enabled.status, 200); assert.equal((await enabled.json()).enabled, true);
      // Existing run short-circuits before Redis: proves valid adTypes pass validation without live transport.
      assert.equal((await sync(request("sync", { resource: domain, adTypes: ["sp", "sb"], startDate: "2026-10-24", endDate: "2026-10-24" }))).status, 409);
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
