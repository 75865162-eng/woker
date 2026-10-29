import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma, PrismaClient } from "@prisma/client";
import { sellfoxBrowseQuery } from "@/lib/sellfox/browse-query";
import { resolveEffectiveReportDate } from "@/lib/sellfox/browse-report-date";
import { readSellfoxWorkbench } from "@/lib/sellfox/workbench-read";
import { defaultSellfoxView, sellfoxViewParams } from "@/lib/sellfox/workbench-view";
import { sellfoxDateAt } from "@/lib/sellfox/sync-contract";
import { GET as salesBrowse } from "@/app/api/sellfox/sales/route";
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

test("sales browse/export and both performance browse layouts share scoped effective dates", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const filters: unknown[] = [];
  const sqlCalls: Prisma.Sql[] = [];
  const table = {
    findFirst: async () => ({ reportDate: "2026-10-16" }),
    count: async ({ where }: { where: unknown }) => { filters.push(where); return 0; },
    findMany: async ({ where }: { where: unknown }) => { filters.push(where); return []; },
    aggregate: async ({ where }: { where: unknown }) => { filters.push(where); return { _sum: {} }; },
  };
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: scope.workspaceId }) },
    sellfoxStore: { findMany: async () => [], findFirst: async () => null },
    sellfoxSalesDailySnapshot: table, sellfoxProductDailySnapshot: table,
    $queryRaw: async (sql: Prisma.Sql) => { sqlCalls.push(sql); return [{ rows: [], total: 0, totals: [{ currency: "USD", promotionDiscount: 0, giftWrapFee: 0 }] }]; },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", ...scope, organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    const request = (path: string) => new Request(`http://localhost/api/sellfox/${path}`, { headers: { "x-workspace-id": scope.workspaceId, cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
    const context = { params: Promise.resolve({ domain: "sales" }) };
    assert.equal((await performanceBrowse(new Request("http://localhost/api/sellfox/performance"))).status, 401);
    assert.equal((await performanceBrowse(request("performance?shopExternalId=foreign"))).status, 403);
    assert.equal((await performanceBrowse(request("performance?storeId=foreign"))).status, 403);
    for (const response of [await salesBrowse(request("sales")), await performanceBrowse(request("performance")), await performanceBrowse(request("performance?layout=workbench")), await performanceBrowse(request("performance?onlySettle=1"))]) {
      assert.equal(response.status, 200);
      const data = await response.json();
      assert.deepEqual(data.dates, ["2026-10-16"]);
      assert.deepEqual(data.totals, [{ currency: "USD", promotionDiscount: 0, giftWrapFee: 0 }]);
    }
    assert.equal(filters.length, 0);
    assert.equal(sqlCalls.length, 4);
    assert.equal(sqlCalls[1].text, sqlCalls[2].text);
    assert.deepEqual(sqlCalls[1].values, sqlCalls[2].values);
    for (const sql of sqlCalls) {
      for (const value of [scope.organizationId, scope.workspaceId, "2026-10-16"]) assert.ok(sql.values.includes(value));
    }
    assert.match(sqlCalls[0].text, /FROM sellfox_sales_daily/);
    for (const sql of sqlCalls.slice(1)) {
      assert.match(sql.text, /"promotionDiscount"/); assert.match(sql.text, /"giftWrapFee"/); assert.match(sql.text, /"mainImageCandidate"/);
    }
    assert.ok(sqlCalls[1].values.includes(false)); assert.ok(sqlCalls[3].values.includes(true));
    assert.equal((await salesExport(request("sales/export"), context)).status, 200);
    const exported = await performanceExport(request("performance/export?format=csv"));
    assert.equal(exported.status, 200); assert.match(exported.headers.get("Content-Disposition")!, /2026-10-16/);
    assert.equal(filters.length, 2);
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
