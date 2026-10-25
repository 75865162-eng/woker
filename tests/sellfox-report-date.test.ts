import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma, PrismaClient } from "@prisma/client";
import { sellfoxBrowseQuery } from "@/lib/sellfox/browse-query";
import { resolveEffectiveReportDate } from "@/lib/sellfox/browse-report-date";
import { readSellfoxWorkbench } from "@/lib/sellfox/workbench-read";
import { defaultSellfoxView, sellfoxViewParams } from "@/lib/sellfox/workbench-view";
import { sellfoxDateAt } from "@/lib/sellfox/sync-contract";
import { GET as browse } from "@/app/api/sellfox/[domain]/route";
import { GET as performanceBrowse } from "@/app/api/sellfox/performance/route";
import { GET as salesExport } from "@/app/api/sellfox/[domain]/export/route";
import { GET as performanceExport } from "@/app/api/sellfox/performance/export/route";
import { createLocalSession } from "@/lib/auth/session";

const scope = { organizationId: "org-a", workspaceId: "workspace-a" };
const query = (params = "") => sellfoxBrowseQuery(new URL(`http://localhost/?${params}`));

test("implicit sales/profit dates use one scoped latest-day lookup; explicit dates and history never move", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const yesterday = sellfoxDateAt(new Date(), -1);
  let latest: string | null = "2026-10-16";
  const calls: { domain: string; args: Record<string, unknown> }[] = [];
  const table = (domain: string) => ({ findFirst: async (args: Record<string, unknown>) => {
    calls.push({ domain, args }); return latest ? { reportDate: latest } : null;
  } });
  globals.prisma = { sellfoxSalesDailySnapshot: table("sales"), sellfoxProductDailySnapshot: table("performance") } as unknown as PrismaClient;
  try {
    for (const domain of ["sales", "performance"] as const) {
      const input = query("storeId=store-a&shopExternalId=shop-a&site=US&currency=USD&onlySettle=1&search=missing&hideZero=1");
      const resolved = await resolveEffectiveReportDate(domain, input, scope);
      assert.equal(resolved.reportDate, "2026-10-16"); assert.equal(input.reportDate, undefined);
      assert.deepEqual(calls.at(-1), { domain, args: {
        where: { ...scope, reportDate: { lte: yesterday }, storeId: "store-a", SellfoxStore: { ...scope, externalId: { in: ["shop-a"] }, marketplace: "US" }, currency: "USD", ...(domain === "performance" ? { onlySettle: true } : {}) },
        select: { reportDate: true }, orderBy: { reportDate: "desc" },
      } });
      latest = yesterday;
      assert.equal((await resolveEffectiveReportDate(domain, query(), scope)).reportDate, yesterday);
      latest = null;
      assert.equal((await resolveEffectiveReportDate(domain, query(), scope)).reportDate, yesterday);
      latest = "2026-10-16";
      const count = calls.length;
      for (const params of ["from=2026-10-25", "to=2026-10-25", `reportDate=${yesterday}`, "reportDate=2026-10-20", "allDates=1"]) {
        const explicit = query(params);
        assert.equal(await resolveEffectiveReportDate(domain, explicit, scope), explicit);
      }
      assert.equal(calls.length, count);
    }
  } finally { globals.prisma = previous; }
});

test("UI leaves sales/profit defaults implicit while keeping today's inventory date", () => {
  for (const domain of ["sales", "performance"] as const) {
    const params = sellfoxViewParams({ ...defaultSellfoxView, domain }, true);
    assert.equal(params.has("reportDate"), false);
    const explicit = sellfoxViewParams({ ...defaultSellfoxView, domain, from: "2026-10-25" }, true);
    assert.equal(explicit.get("from"), "2026-10-25");
  }
  assert.equal(sellfoxViewParams({ ...defaultSellfoxView, domain: "inventory" }, true).get("reportDate"), sellfoxDateAt(new Date()));
});

test("workbench SQL, matrix metadata and exports use the effective date for both domains", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  let latestLookups = 0;
  const table = { findFirst: async () => { latestLookups++; return { reportDate: "2026-10-16" }; } };
  const sqlCalls: Prisma.Sql[] = [];
  globals.prisma = {
    sellfoxSalesDailySnapshot: table, sellfoxProductDailySnapshot: table,
    $queryRaw: async (sql: Prisma.Sql) => { sqlCalls.push(sql); return [{ rows: [], total: 0, totals: [] }]; },
  } as unknown as PrismaClient;
  try {
    for (const domain of ["sales", "performance"] as const) {
      for (const exporting of [false, true]) {
        const result = await readSellfoxWorkbench(domain, query(), scope, exporting);
        assert.deepEqual(result.dates, ["2026-10-16"]);
        assert.ok(sqlCalls.at(-1)?.values.includes("2026-10-16"));
      }
      const explicit = await readSellfoxWorkbench(domain, query("reportDate=2026-10-25"), scope);
      assert.deepEqual(explicit.dates, ["2026-10-25"]);
      assert.ok(sqlCalls.at(-1)?.values.includes("2026-10-25"));
    }
    assert.equal(latestLookups, 4);
  } finally { globals.prisma = previous; }
});

test("Prisma sales/profit browse and export share fallback filters and expose the effective date", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const filters: unknown[] = [];
  const table = {
    findFirst: async () => ({ reportDate: "2026-10-16" }),
    count: async ({ where }: { where: unknown }) => { filters.push(where); return 0; },
    findMany: async ({ where }: { where: unknown }) => { filters.push(where); return []; },
    aggregate: async ({ where }: { where: unknown }) => { filters.push(where); return { _sum: {} }; },
  };
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: scope.workspaceId }) },
    sellfoxSalesDailySnapshot: table, sellfoxProductDailySnapshot: table,
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", ...scope, organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    const request = (path: string) => new Request(`http://localhost/api/sellfox/${path}`, { headers: { "x-workspace-id": scope.workspaceId, cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
    const context = { params: Promise.resolve({ domain: "sales" }) };
    for (const response of [await browse(request("sales"), context), await performanceBrowse(request("performance"))]) {
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).dates, ["2026-10-16"]);
    }
    assert.equal((await salesExport(request("sales/export"), context)).status, 200);
    const exported = await performanceExport(request("performance/export?format=csv"));
    assert.equal(exported.status, 200); assert.match(exported.headers.get("Content-Disposition")!, /2026-10-16/);
    assert.ok(filters.length >= 7);
    for (const where of filters) {
      assert.equal((where as Record<string, unknown>).reportDate, "2026-10-16");
      assert.equal((where as Record<string, unknown>).organizationId, scope.organizationId);
      assert.equal((where as Record<string, unknown>).workspaceId, scope.workspaceId);
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
