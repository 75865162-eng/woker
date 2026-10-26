import test from "node:test";
import assert from "node:assert/strict";
import type { Prisma, PrismaClient } from "@prisma/client";
import { GET as browse } from "@/app/api/sellfox/[domain]/route";
import { GET as performanceBrowse } from "@/app/api/sellfox/performance/route";
import { GET as salesBrowse } from "@/app/api/sellfox/sales/route";
import { GET as csv } from "@/app/api/sellfox/[domain]/export/route";
import { GET as performanceCsv } from "@/app/api/sellfox/performance/export/route";
import { GET as detail } from "@/app/api/sellfox/[domain]/[id]/route";
import { createLocalSession } from "@/lib/auth/session";

test("sales always browses workbench aggregates, preserving scope, permissions and CSV export", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }; const previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const scope = { organizationId: "org-a", workspaceId: "workspace-a" };
  const sqlCalls: Prisma.Sql[] = [];
  let overflow = false; let failRead = false; let legacyReads = 0;
  const date = "2026-10-25";
  const totals = [{ currency: "USD", subtotal: 109, daily: { [date]: 109 } }];
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: scope.workspaceId }) },
    sellfoxStore: {
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        assert.equal(where.organizationId, scope.organizationId); assert.equal(where.workspaceId, scope.workspaceId);
        return [];
      },
      findFirst: async ({ where }: { where: Record<string, unknown> }) => {
        assert.equal(where.organizationId, scope.organizationId); assert.equal(where.workspaceId, scope.workspaceId);
        return null;
      },
    },
    sellfoxSalesDailySnapshot: {
      findFirst: async () => ({ reportDate: date }),
      count: async () => { legacyReads++; return 281; },
      findMany: async () => { legacyReads++; return []; },
    },
    $queryRaw: async (sql: Prisma.Sql) => {
      sqlCalls.push(sql);
      if (failRead) throw new Error("private database failure");
      if (!sql.text.includes("FROM sellfox_sales_daily")) return [];
      return [{ total: overflow ? 10001 : 1, totals, rows: [{ id: "aggregate", storeId: "store-a", name: "GG", identity: "store-a", currency: "USD", members: ["sku-a", "sku-b"], subtotal: 109, daily: { [date]: 109 }, dailyQuantity: { [date]: 109 } }] }];
    },
  } as unknown as PrismaClient;
  const context = () => ({ params: Promise.resolve({ domain: "sales" }) });
  const handlers = [salesBrowse, (request: Request) => browse(request, context())];
  async function request(params = "", role = "owner") {
    const session = await createLocalSession({ id: "actor", ...scope, organizationName: "Fixture", role, email: "actor@example.test", name: "Actor" });
    return new Request(`http://localhost/api/sellfox/sales?${params}`, { headers: { "x-workspace-id": scope.workspaceId, cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
  }
  try {
    for (const handler of handlers) {
      assert.equal((await handler(new Request("http://localhost/api/sellfox/sales"))).status, 401);
      assert.equal((await handler(await request("", "warehouse"))).status, 403);
      assert.equal((await handler(await request("shopExternalId=foreign"))).status, 403);
      assert.equal((await handler(await request("storeId=foreign"))).status, 403);
      assert.equal((await handler(await request("page=1.5"))).status, 400);
      for (const params of ["", "dimension=store", "dimension=store&layout=workbench"]) {
        const response = await handler(await request(params));
        assert.equal(response.status, 200);
        const data = await response.json();
        assert.deepEqual(data.pagination, { page: 1, pageSize: 50, total: 1 });
        assert.deepEqual(data.dates, [date]); assert.deepEqual(data.totals, totals);
        assert.equal(data.rows.length, 1); assert.equal(data.rows[0].subtotal, 109);
        assert.equal(data.rows[0][`day:${date}`], 109); assert.equal(data.rows[0].msku, null);
        if (params.includes("dimension=store")) {
          assert.equal(data.rows[0].identity, "GG");
          assert.match(sqlCalls.at(-2)!.text, /COALESCE\(NULLIF\(s\."storeId",''\)/);
        }
      }
    }
    assert.equal(legacyReads, 0);
    assert.equal(sqlCalls.length, 12);
    for (const sql of sqlCalls) {
      assert.ok(sql.values.includes(scope.organizationId)); assert.ok(sql.values.includes(scope.workspaceId));
    }
    const exportParams = "layout=workbench&dimension=store&format=csv";
    const exported = await csv(await request(exportParams), context());
    assert.equal(exported.status, 200); assert.match(exported.headers.get("Content-Type")!, /text\/csv/);
    assert.match(await exported.text(), /GG/);
    assert.equal((await csv(await request(exportParams, "designer"), context())).status, 403);
    assert.equal((await csv(await request(`${exportParams}&storeId=foreign`), context())).status, 403);
    assert.equal((await csv(await request(`${exportParams}&shopExternalId=foreign`), context())).status, 403);
    overflow = true;
    assert.equal((await csv(await request(exportParams), context())).status, 413);
    assert.equal(legacyReads, 0);
    failRead = true;
    const failed = await salesBrowse(await request());
    assert.equal(failed.status, 500);
    assert.deepEqual(await failed.json(), { error: "读取赛狐销量统计失败，请稍后重试。" });
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

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

test("fulfillment reaches browse and CSV/XLSX/Agent export SQL, including without layout", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [];
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => {
      calls.push(sql);
      return sql.text.startsWith("WITH") ? [{ rows: [], total: 0, totals: [] }] : sql.text.startsWith("SELECT count") ? [{ total: 0 }] : [];
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    for (const domain of ["sales", "performance", "listings"]) {
      for (const fulfillment of ["AFN", "MFN"]) {
        const context = { params: Promise.resolve({ domain }) };
        const request = (extra = "") => new Request(`http://localhost/api/sellfox/${domain}?from=2026-10-25&to=2026-10-25&fulfillment=${fulfillment}${extra}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
        const browseHandler = domain === "sales" ? salesBrowse : domain === "performance" ? performanceBrowse : (r: Request) => browse(r, context);
        const handlers = [
          () => browseHandler(request()),
          () => browseHandler(request("&layout=workbench")),
          ...["&format=csv", "&layout=workbench&format=csv", "&layout=workbench&format=xlsx", "&agent=1"].map(extra => () => csv(request(extra), context)),
          ...(domain === "performance" ? ["&format=csv", "&format=xlsx", "&agent=1"].map(extra => () => performanceCsv(request(extra))) : []),
        ];
        for (const handler of handlers) {
          calls.length = 0;
          const response = await handler();
          assert.equal(response.status, 200);
          assert.ok(calls.length > 0);
          for (const sql of calls) {
            assert.ok(sql.values.includes(fulfillment));
            assert.match(sql.text, domain === "listings" ? /s.fulfillment=/ : /switchFulfillmentTo/);
          }
        }
      }
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("buyBox reaches browse and CSV/XLSX/Agent export SQL, including without layout", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [];
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => {
      calls.push(sql);
      return sql.text.startsWith("WITH") ? [{ rows: [], total: 0, totals: [] }] : sql.text.startsWith("SELECT count") ? [{ total: 0 }] : [];
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    for (const domain of ["sales", "performance", "listings"]) {
      for (const buyBox of ["yes", "no"]) {
        const context = { params: Promise.resolve({ domain }) };
        const request = (extra = "") => new Request(`http://localhost/api/sellfox/${domain}?from=2026-10-25&to=2026-10-25&buyBox=${buyBox}${extra}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
        const browseHandler = domain === "sales" ? salesBrowse : domain === "performance" ? performanceBrowse : (r: Request) => browse(r, context);
        const handlers = [
          () => browseHandler(request()),
          () => browseHandler(request("&layout=workbench")),
          ...["&format=csv", "&layout=workbench&format=csv", "&layout=workbench&format=xlsx", "&agent=1"].map(extra => () => csv(request(extra), context)),
          ...(domain === "performance" ? ["&format=csv", "&format=xlsx", "&agent=1"].map(extra => () => performanceCsv(request(extra))) : []),
        ];
        for (const handler of handlers) {
          calls.length = 0;
          const response = await handler();
          assert.equal(response.status, 200);
          assert.ok(calls.length > 0);
          for (const sql of calls) {
            if (domain === "listings") {
              assert.doesNotMatch(sql.text, /payload/);
              assert.match(sql.text, /s\."buyBoxWinner"=/);
              assert.ok(sql.values.includes(buyBox === "yes" ? "是" : "否"));
              continue;
            }
            const workbench = sql.text.startsWith("WITH");
            assert.ok(sql.values.includes(workbench ? buyBox === "yes" ? "是" : "否" : buyBox));
            assert.match(sql.text, /p.payload->'buyBoxWinner' = 'true'::jsonb/);
            assert.match(sql.text, /p.payload->'buyBoxWinner' = 'false'::jsonb/);
            assert.match(sql.text, workbench ? /AND l\."buyBoxWinner"=\$\d+/ : /LIMIT 1\)=\$\d+/);
          }
        }
      }
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("productTag reaches browse facets and CSV/XLSX/Agent export with and without layout", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [], facets = { productTags: ["1年以内产品", "新标签、完整"], brands: ["Goghost-乐器", "Nvaav"] };
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => {
      calls.push(sql);
      return sql.text.startsWith("WITH") ? [{ rows: [], total: 0, totals: [], facets }] : sql.text.startsWith("SELECT count") ? [{ total: 0 }] : [];
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    for (const domain of ["sales", "performance", "listings"]) {
      const context = { params: Promise.resolve({ domain }) };
      const request = (extra = "") => new Request(`http://localhost/api/sellfox/${domain}?from=2026-10-25&to=2026-10-25&${new URLSearchParams({ productTag: "新标签、完整" })}${extra}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
      const browseHandler = domain === "sales" ? salesBrowse : domain === "performance" ? performanceBrowse : (r: Request) => browse(r, context);
      for (const extra of ["", "&layout=workbench"]) {
        const response = await browseHandler(request(extra));
        assert.equal(response.status, 200); assert.deepEqual((await response.json()).facets, facets);
      }
      const handlers = [
        ...["&format=csv", "&layout=workbench&format=csv", "&layout=workbench&format=xlsx", "&agent=1"].map(extra => () => csv(request(extra), context)),
        ...(domain === "performance" ? ["&format=csv", "&format=xlsx", "&agent=1"].map(extra => () => performanceCsv(request(extra))) : []),
      ];
      for (const handler of handlers) {
        calls.length = 0;
        assert.equal((await handler()).status, 200);
        assert.ok(calls.length > 0);
        for (const sql of calls) {
          if (domain === "listings") {
            assert.doesNotMatch(sql.text, /payload/);
            assert.match(sql.text, /s\."productTagNames" @> ARRAY\[/);
          } else if (sql.text.startsWith("WITH")) {
            assert.match(sql.text, /EXISTS \(SELECT 1 FROM jsonb_array_elements/);
            assert.match(sql.text, /AND btrim\(label\.value->>'labelName'\)=\$\d+\) AS "matchesProductTag"/);
            assert.match(sql.text, /AND l\."matchesProductTag"\)/);
          } else {
            assert.match(sql.text, /EXISTS \(SELECT 1 FROM unnest/);
            assert.match(sql.text, /WHERE tag\."labelName"=\$\d+/);
          }
          assert.ok(sql.values.includes("新标签、完整")); assert.ok(!sql.values.includes("%新标签、完整%"));
        }
      }
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("brand reaches browse facets and CSV/XLSX/Agent export with and without layout", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [], facets = { productTags: ["1年以内产品", "新标签、完整"], brands: ["Goghost-乐器", "Nvaav"] };
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => {
      calls.push(sql);
      return sql.text.startsWith("WITH") ? [{ rows: [], total: 0, totals: [], facets }] : sql.text.startsWith("SELECT count") ? [{ total: 0 }] : [];
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    for (const domain of ["sales", "performance", "listings"]) {
      const context = { params: Promise.resolve({ domain }) };
      const request = (extra = "") => new Request(`http://localhost/api/sellfox/${domain}?from=2026-10-25&to=2026-10-25&${new URLSearchParams({ brand: "  Goghost-乐器  " })}${extra}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
      const browseHandler = domain === "sales" ? salesBrowse : domain === "performance" ? performanceBrowse : (r: Request) => browse(r, context);
      for (const extra of ["", "&layout=workbench"]) {
        calls.length = 0;
        const response = await browseHandler(request(extra));
        assert.equal(response.status, 200); assert.deepEqual((await response.json()).facets, facets);
        assert.ok(calls.some(sql => /AND [ls].brand=\$\d+/.test(sql.text) && sql.values.includes("Goghost-乐器")));
      }
      const handlers = [
        ...["&format=csv", "&format=xlsx", "&layout=workbench&format=csv", "&layout=workbench&format=xlsx", "&agent=1", "&layout=workbench&agent=1"].map(extra => () => csv(request(extra), context)),
        ...(domain === "performance" ? ["&format=csv", "&format=xlsx", "&agent=1"].map(extra => () => performanceCsv(request(extra))) : []),
      ];
      for (const handler of handlers) {
        calls.length = 0;
        assert.equal((await handler()).status, 200);
        assert.ok(calls.length > 0);
        for (const sql of calls) {
          if (domain === "listings") {
            assert.doesNotMatch(sql.text, /payload/);
            assert.match(sql.text, /s.brand=/);
          } else if (sql.text.startsWith("WITH")) {
            assert.match(sql.text, /AND l.brand=\$\d+/);
            assert.match(sql.text, /NULLIF\(btrim\(p.payload->>'brand'\),''\) AS brand/);
            assert.doesNotMatch(sql.text, /AS facets/);
          } else {
            assert.match(sql.text, /SELECT btrim\(p.payload->>'brand'\)/);
            assert.match(sql.text, /LIMIT 1\)=\$\d+/);
          }
          if (domain !== "listings") assert.doesNotMatch(sql.text, /amazonBrand/);
          assert.doesNotMatch(sql.text, /l\."amazonBrand"\s*=/);
          assert.ok(sql.values.includes("Goghost-乐器")); assert.ok(!sql.values.includes("%Goghost-乐器%"));
        }
      }
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("legacy browse shells apply validated server ordering with filters and pagination", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }; const previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Array<{ where: Record<string, unknown>; orderBy: unknown; skip: number; take: number }> = [];
  const sortedSql: Prisma.Sql[] = [];
  const model = { count: async () => 51, findMany: async (args: typeof calls[number]) => { calls.push(args); return []; } };
  globals.prisma = { workspaceScope: { findUnique: async () => ({ id: "ws" }) }, sellfoxStore: model, sellfoxSyncRun: model, sellfoxHourlyMetric: model, sellfoxFbaInventorySnapshot: model,
    $queryRaw: async (sql: Prisma.Sql) => { sortedSql.push(sql); return [{ total: 0, rows: [], totals: [] }]; },
  } as unknown as PrismaClient;
  const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
  function request(domain: string, params: string) { return new Request(`http://localhost/api/sellfox/${domain}?${params}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } }); }
  try {
    for (const [domain, key] of [["stores", "name"], ["inventory", "quantity"], ["hourly", "cost"], ["runs", "startedAt"]]) {
      for (const sortOrder of ["asc", "desc"]) {
        const response = await browse(request(domain, `from=2026-10-24&to=2026-10-24&search=needle&page=2&pageSize=20&sortBy=${key}&sortOrder=${sortOrder}`), { params: Promise.resolve({ domain }) });
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).pagination, { page: 2, pageSize: 20, total: 51 });
        const args = calls.at(-1)!;
        assert.deepEqual(args.orderBy, [{ [key]: sortOrder }, { id: "asc" }]);
        assert.equal(args.skip, 20); assert.equal(args.take, 20);
        assert.equal(args.where.organizationId, "org"); assert.equal(args.where.workspaceId, "ws");
        assert.match(JSON.stringify(args.where), /needle/);
      }
      const before = calls.length;
      assert.equal((await browse(request(domain, "sortBy=payload"), { params: Promise.resolve({ domain }) })).status, 400);
      assert.equal(calls.length, before);
    }
    const response = await browse(request("inventory", "allDates=1&sortBy=name&sortOrder=desc"), { params: Promise.resolve({ domain: "inventory" }) });
    assert.equal(response.status, 200);
    assert.deepEqual(calls.at(-1)!.orderBy, [{ SellfoxStore: { name: "desc" } }, { id: "asc" }]);
    // No-layout requests still need derived workbench columns, including exports.
    for (const [domain, sortBy] of [["listings", "rating"], ["ads_report", "acos"], ["ads_campaign", "campaignName"]]) {
      const context = { params: Promise.resolve({ domain }) };
      const params = `sortBy=${sortBy}&sortOrder=desc`;
      assert.equal((await browse(request(domain, params), context)).status, 200);
      assert.match(sortedSql.at(-1)!.text, /FROM filtered ORDER BY .* DESC NULLS LAST, id ASC\s+LIMIT/);
      assert.equal((await csv(request(domain, params), context)).status, 200);
      assert.match(sortedSql.at(-1)!.text, /FROM filtered ORDER BY .* DESC NULLS LAST, id ASC\s+LIMIT/);
    }
    await browse(request("stores", ""), { params: Promise.resolve({ domain: "stores" }) });
    assert.deepEqual(calls.at(-1)!.orderBy, [{ name: "asc" }, { id: "asc" }]);
  } finally { globals.prisma = previous; Object.assign(process.env, env); if (env.DATABASE_URL === undefined) delete process.env.DATABASE_URL; if (env.AUTH_DRIVER === undefined) delete process.env.AUTH_DRIVER; }
});
