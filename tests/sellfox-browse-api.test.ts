import test from "node:test";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import { GET as browse } from "@/app/api/sellfox/[domain]/route";
import { GET as csv } from "@/app/api/sellfox/[domain]/export/route";
import { GET as performanceCsv } from "@/app/api/sellfox/performance/export/route";
import { GET as detail } from "@/app/api/sellfox/[domain]/[id]/route";
import { createLocalSession } from "@/lib/auth/session";

test("list/export filters agree, cross-workspace stores fail and exports never silently truncate", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }; const previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const queries: Array<{ where: unknown; take?: number }> = []; let overflow = false; let foreign = false;
  const snapshot = { id: "row", reportDate: "2026-10-24", capturedAt: new Date("2026-10-24T00:00:00Z"), sku: "=formula", msku: "sku", quantity: null, SellfoxStore: { name: "Test", externalId: "shop-a", marketplace: "US" } };
  const snapshotTable = {
    count: async () => 1,
    findMany: async (args: { where: unknown; take?: number }) => { queries.push(args); return overflow ? Array.from({ length: 10001 }, () => snapshot) : [snapshot]; },
    findFirst: async (args: { where: { organizationId: string; workspaceId: string; id: string } }) => {
      assert.equal(args.where.organizationId, "org-a"); assert.equal(args.where.workspaceId, "workspace-a");
      return args.where.id === "missing" ? null : { payload: { token: "private", msku: "sku" } };
    },
  };
  globals.prisma = {
    $queryRaw: async () => overflow ? Array.from({ length: 10001 }, () => snapshot) : [snapshot],
    workspaceScope: { findUnique: async () => ({ id: "workspace-a" }) },
    sellfoxStore: { findMany: async () => foreign ? [] : [{ id: "store-a" }] },
    sellfoxFbaInventorySnapshot: snapshotTable, sellfoxProductDailySnapshot: snapshotTable,
    sellfoxSyncRun: snapshotTable,
  } as unknown as PrismaClient;
  async function request(path: string, role = "owner") {
    const session = await createLocalSession({ id: "actor", organizationId: "org-a", organizationName: "Fixture", role, email: "actor@example.test", name: "Actor" });
    return new Request(`http://localhost/api/sellfox/${path}`, { headers: { "x-workspace-id": "workspace-a", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
  }
  const context = (domain: string) => ({ params: Promise.resolve({ domain }) });
  const filters = "from=2026-10-01&to=2026-10-24&site=US&search=sku&shopExternalId=a&shopExternalId=a";
  try {
    assert.equal((await browse(await request(`inventory?${filters}`), context("inventory"))).status, 200);
    const exported = await csv(await request(`inventory/export?${filters}`), context("inventory"));
    assert.equal(exported.status, 200); assert.match(await exported.text(), /'=formula/);
    assert.deepEqual(queries[0].where, queries[1].where);
    assert.equal(queries[0].take, 50); assert.equal(queries[1].take, 10001);
    assert.equal((await browse(await request("inventory?page=1.5"), context("inventory"))).status, 400);
    foreign = true;
    assert.equal((await browse(await request("inventory?shopExternalId=other"), context("inventory"))).status, 403);
    assert.equal((await csv(await request("inventory/export?shopExternalId=other"), context("inventory"))).status, 403);
    foreign = false; overflow = true;
    const tooMany = await csv(await request("inventory/export"), context("inventory"));
    assert.equal(tooMany.status, 413); assert.match(await tooMany.text(), /缩小.*范围/);
    assert.equal((await performanceCsv(await request("performance/export?allDates=1&format=csv"))).status, 413);
    assert.equal((await csv(await request("inventory/export", "designer"), context("inventory"))).status, 403);
    const detailResponse = await detail(await request("inventory/row"), { params: Promise.resolve({ domain: "inventory", id: "row" }) });
    assert.equal(detailResponse.status, 200); assert.doesNotMatch(await detailResponse.text(), /private/);
    assert.equal((await detail(await request("inventory/missing"), { params: Promise.resolve({ domain: "inventory", id: "missing" }) })).status, 404);
    queries.length = 0; overflow = false;
    await browse(await request("runs?from=2026-10-24&to=2026-10-24&search=failed"), context("runs"));
    await csv(await request("runs/export?from=2026-10-24&to=2026-10-24&search=failed"), context("runs"));
    assert.deepEqual(queries[0].where, queries[1].where);
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
