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
      return [{ total: overflow ? 10001 : 1, totals, rows: [{ id: "aggregate", storeId: "store-a", name: "GG", identity: "store-a", currency: "USD", members: ["sku-a", "sku-b"], subtotal: 109, brand: "品牌", productTags: "新品、重点", price: 0, daily: { [date]: 109 }, dailyQuantity: { [date]: 109 } }] }];
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
        assert.equal(data.rows[0].brand, "品牌"); assert.equal(data.rows[0].productTags, "新品、重点"); assert.equal(data.rows[0].price, 0);
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
    // Explicit selections use the wide-table export even without a layout flag.
    for (const layout of ["", "layout=workbench&"]) for (const format of ["csv", "xlsx"]) {
      const response = await csv(await request(`${layout}from=${date}&to=${date}&column=brand&column=productTags&column=price&format=${format}`), context());
      assert.equal(response.status, 200);
      if (format === "csv") assert.equal((await response.text()).trim(), '"商品品牌","产品标签","售价"\r\n"品牌","新品、重点",0');
      else {
        const { default: ExcelJS } = await import("exceljs");
        const book = new ExcelJS.Workbook(); await book.xlsx.load(await response.arrayBuffer());
        assert.deepEqual([1, 2, 3].map(i => book.worksheets[0].getRow(1).getCell(i).value), ["商品品牌", "产品标签", "售价"]);
        assert.deepEqual([1, 2, 3].map(i => book.worksheets[0].getRow(2).getCell(i).value), ["品牌", "新品、重点", 0]);
      }
    }
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
            assert.doesNotMatch(sql.text, /payload/);
            assert.match(sql.text, domain === "listings" ? /s.fulfillment=/ : sql.text.startsWith("WITH") ? /AND l.fulfillment=/ : /SELECT candidate.fulfillment/);
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
            assert.ok(sql.values.includes(buyBox === "yes" ? "是" : "否"));
            assert.doesNotMatch(sql.text, /payload/);
            assert.match(sql.text, /\."buyBoxWinner"/);
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
            assert.doesNotMatch(sql.text, /payload/);
            assert.match(sql.text, /l\."productTagNames" @> ARRAY\[\$\d+\]::text\[\] AS "matchesProductTag"/);
            assert.match(sql.text, /AND l\."matchesProductTag"\)/);
          } else {
            assert.doesNotMatch(sql.text, /payload/);
            assert.match(sql.text, /SELECT candidate\."productTagNames"/);
            assert.match(sql.text, /LIMIT 1\) @> ARRAY\[\$\d+\]::text\[\]/);
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
            assert.doesNotMatch(sql.text, /payload/);
            assert.match(sql.text, /l.brand/);
            assert.doesNotMatch(sql.text, /AS facets/);
          } else {
            assert.doesNotMatch(sql.text, /payload/);
            assert.match(sql.text, /SELECT candidate.brand/);
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

test("ads current Listing columns reach browse and selected CSV/XLSX exports with or without layout", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [];
  const rows = [{ id: "matched", rating: "4.4", productTags: "新品、重点", mainImage: "https://example.test/product.jpg" }, { id: "unmatched", rating: null, productTags: null, mainImage: null }];
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => { calls.push(sql); return [{ total: 2, totals: [], rows: structuredClone(rows) }]; },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    const request = (domain: string, params: string) => new Request(`http://localhost/api/sellfox/${domain}?from=2026-10-25&to=2026-10-25&${params}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
    for (const domain of ["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"]) {
      const context = { params: Promise.resolve({ domain }) };
      for (const layout of ["", "layout=workbench&"]) {
        for (const sortBy of ["rating", "productTags"]) {
          const response = await browse(request(domain, `${layout}sortBy=${sortBy}&sortOrder=desc`), context);
          assert.equal(response.status, 200);
          const data = await response.json();
          assert.deepEqual(data.rows.map((r: Record<string, unknown>) => [r.rating, r.productTags, r.mainImage]), rows.map(r => [r.rating, r.productTags, r.mainImage]));
          assert.ok(calls.at(-1)!.text.includes(`ORDER BY "${sortBy}" DESC NULLS LAST, id ASC`));
        }
        for (const format of ["csv", "xlsx"]) {
          const response = await csv(request(domain, `${layout}column=rating&column=productTags&column=image&format=${format}`), context);
          assert.equal(response.status, 200);
          assert.match(calls.at(-1)!.text, /min\(NULLIF\("listingMainImage",''\)\) AS "mainImage"/);
          if (format === "csv") assert.equal((await response.text()).trim(), '"星级","标签","图片"\r\n"4.4","新品、重点","https://example.test/product.jpg"\r\n"","",""');
          else {
            const { default: ExcelJS } = await import("exceljs");
            const book = new ExcelJS.Workbook(); await book.xlsx.load(await response.arrayBuffer());
            const sheet = book.worksheets[0];
            assert.deepEqual([1, 2, 3].map(i => sheet.getRow(1).getCell(i).value), ["星级", "标签", "图片"]);
            assert.deepEqual([1, 2, 3].map(i => sheet.getRow(2).getCell(i).value), ["4.4", "新品、重点", "https://example.test/product.jpg"]);
            for (const i of [1, 2, 3]) assert.ok([null, ""].includes(sheet.getRow(3).getCell(i).value as null | string));
          }
        }
      }
    }
    for (const sql of calls) { assert.ok(sql.values.includes("org")); assert.ok(sql.values.includes("ws")); }
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


test("salesperson reaches performance browse and CSV/XLSX/Agent exports; sales ignores it", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [], facets = { productTags: [], brands: [], salespersons: ["温见清", "陈馨"] };
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => {
      calls.push(sql);
      return sql.text.startsWith("WITH") ? [{ rows: [], total: 0, totals: [], facets }] : sql.text.startsWith("SELECT count") ? [{ total: 0 }] : [];
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    for (const domain of ["performance", "sales"]) {
      const context = { params: Promise.resolve({ domain }) };
      const request = (extra = "") => new Request(`http://localhost/api/sellfox/${domain}?from=2026-10-25&to=2026-10-25&${new URLSearchParams({ salesperson: " 温见清 " })}${extra}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
      const browseHandler = domain === "performance" ? performanceBrowse : salesBrowse;
      for (const extra of ["", "&layout=workbench"]) {
        calls.length = 0;
        const response = await browseHandler(request(extra)); assert.equal(response.status, 200);
        if (domain === "performance") assert.deepEqual((await response.json()).facets, facets);
        assert.ok(calls.length > 0);
        for (const sql of calls) assert.equal(sql.values.includes("温见清"), domain === "performance");
      }
      const handlers = [
        ...(domain === "performance" ? ["&format=csv", "&format=xlsx", "&layout=workbench&format=csv", "&layout=workbench&format=xlsx", "&agent=1", "&layout=workbench&agent=1"] : ["&layout=workbench&format=csv", "&layout=workbench&format=xlsx", "&agent=1"]).map(extra => () => csv(request(extra), context)),
        ...(domain === "performance" ? ["&format=csv", "&format=xlsx", "&agent=1"].map(extra => () => performanceCsv(request(extra))) : []),
      ];
      for (const handler of handlers) {
        calls.length = 0; assert.equal((await handler()).status, 200); assert.ok(calls.length > 0);
        for (const sql of calls) {
          assert.doesNotMatch(sql.text, /payload/);
          if (domain === "performance") assert.match(sql.text, /s\."userNameList" @> ARRAY\[\$\d+\]::text\[\]/);
          else assert.doesNotMatch(sql.text, /userNameList/);
          assert.equal(sql.values.includes("温见清"), domain === "performance");
        }
      }
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("selected profit quantity and ad channel exports reach typed workbench CSV/XLSX with or without layout", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [];
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    sellfoxStore: { findMany: async () => [] },
    $queryRaw: async (sql: Prisma.Sql) => {
      calls.push(sql);
      return [{ rows: [{ evaluationSaleNum: 0, channelSaleNum: 1, adSpCost: 0, adSdCost: 2.5, adSbCost: 4, adSbvCost: 5, adSbsCost: 6.75, fbaStorageFeeAmount: 0, fbaLongTermStorageFeeAmount: 2.5, fbaRemovalFeeAmount: 4, fbaDisposalFeeAmount: 5, customAsinFee: 0, customShopFee: 2.5, serviceFeeAmount: 4, storageFeeAmount: 5, compensationAmount: 6, evaluationFee: 7, promotionTotalAmount: 0, fbaOverageFeeAmount: 2.5, chargebackAmount: 4, guaranteeClaimAmount: 5, digitalServicesFeeAmount: 6, otherPriceAmount: 7, shippingChargeAmount: 8, regulatoryFeeAmount: 9, couponPaymentAmount: 0, sellerDealPaymentAmount: 2.5, vineFeeAmount: 4, starStorageFeeAmount: 5, subscriptionAmount: 6, fbaCustomerReturnAmount: 7, fbaInboundConvenienceFeeAmount: 8, inboundTransportationFeeAmount: 9, shippingChargebackAmount: 10, giftwrapChargebackAmount: 11, costOfPointsGrantedAmount: 12, orderOtherPriceAmount: 13, fbaInboundTransportationProgramFee: 0, aglFeeAmount: 2.5, paidServicesFeeAmount: 4, customerReturnHrrUnitFeeAmount: 5, amazonUpstreamStorageTransportationFeeAmount: 6, amazonUpstreamProcessingFeeAmount: 7, mfnPostageFeeAmount: 8, adjustmentFeeAmount: 9, otherServiceFeeAmount: 10, avgHeadTripPrice: 11, purchaseRefundPrice: 12, revenueAmount: 13, fbaPerUnitFulfillmentFeeRefundAmount: 0, fbaWeightBasedFeeRefundAmount: 2.5, deferredAmount: 4, withheldTaxAmount: 5, otherPriceIncomeAmount: 6, paymentMethodFeeAmount: 7, fixedClosingFeeAmount: 8, variableClosingFeeAmount: 9, imagingServicesFeeAmount: 10, netCoAmount: 11, comminglingVatAmount: 12, codFeeAmount: 13, evaluationCapital: 0, evaluationCommission: 2.5, dealPerformanceFeeAmount: 4, couponParticipationFeeAmount: 5, safetReimbursedAmount: 6, affordabilityExpenseAmount: 7, withheldFeeAmount: 8, chargebackIncomeAmount: 9, guaranteeClaimIncomeAmount: 10, promotionSalesAmount: 11, promotionShippingAmount: 12, promotionTaxAmount: 13 }], total: 1, totals: [] }];
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    const selections = [
      { keys: ["evaluationCapital", "evaluationCommission", "dealPerformanceFeeAmount", "couponParticipationFeeAmount", "safetReimbursedAmount", "affordabilityExpenseAmount", "withheldFeeAmount", "chargebackIncomeAmount", "guaranteeClaimIncomeAmount", "promotionSalesAmount", "promotionShippingAmount", "promotionTaxAmount"], labels: ["测评本金", "测评佣金", "Deal表现费", "优惠券参与费", "SAFE-T赔偿", "可负担性费用", "预扣费用", "拒付收入", "A-Z索赔收入", "促销销售额", "促销运费", "促销税费"], values: [0, 2.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] },
      { keys: ["fbaPerUnitFulfillmentFeeRefundAmount", "fbaWeightBasedFeeRefundAmount", "deferredAmount", "withheldTaxAmount", "otherPriceIncomeAmount", "paymentMethodFeeAmount", "fixedClosingFeeAmount", "variableClosingFeeAmount", "imagingServicesFeeAmount", "netCoAmount", "comminglingVatAmount", "codFeeAmount"], labels: ["FBA按件履约费退款", "FBA重量费退款", "延期金额", "商城代扣税", "其他收入", "支付方式费", "固定成交费", "可变成交费", "影像服务费", "净Co金额", "混卖VAT", "COD费用"], values: [0, 2.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] },
      { keys: ["fbaInboundTransportationProgramFee", "aglFeeAmount", "paidServicesFeeAmount", "customerReturnHrrUnitFeeAmount", "amazonUpstreamStorageTransportationFeeAmount", "amazonUpstreamProcessingFeeAmount", "mfnPostageFeeAmount", "adjustmentFeeAmount", "otherServiceFeeAmount", "avgHeadTripPrice", "purchaseRefundPrice", "revenueAmount"], labels: ["FBA入库运输计划费", "AGL费用", "付费服务费", "HRR退货单位费", "上游仓储运输费", "上游处理费", "MFN邮资", "调整费", "其他服务费", "平均头程", "订单内退款", "清算费"], values: [0, 2.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] },
      { keys: ["couponPaymentAmount", "sellerDealPaymentAmount", "vineFeeAmount", "starStorageFeeAmount", "subscriptionAmount", "fbaCustomerReturnAmount", "fbaInboundConvenienceFeeAmount", "inboundTransportationFeeAmount", "shippingChargebackAmount", "giftwrapChargebackAmount", "costOfPointsGrantedAmount", "orderOtherPriceAmount"], labels: ["优惠券支付", "Deal费用", "Vine费用", "星级仓储费", "订阅费", "FBA买家退货费", "FBA入库配置费", "入库运输费", "买家运费扣除", "礼品包装费扣除", "积分费用", "订单其他费"], values: [0, 2.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] },
      { keys: ["fbaStorageFeeAmount", "fbaLongTermStorageFeeAmount", "fbaRemovalFeeAmount", "fbaDisposalFeeAmount"], labels: ["FBA仓储费", "长期仓储费", "FBA移除费", "FBA弃置费"], values: [0, 2.5, 4, 5] },
      { keys: ["customAsinFee", "customShopFee", "serviceFeeAmount", "storageFeeAmount", "compensationAmount", "evaluationFee"], labels: ["产品自定义费用", "店铺自定义费用", "服务费", "仓储费", "赔偿金", "测评费"], values: [0, 2.5, 4, 5, 6, 7] },
      { keys: ["promotionTotalAmount", "fbaOverageFeeAmount", "chargebackAmount", "guaranteeClaimAmount", "digitalServicesFeeAmount", "otherPriceAmount", "shippingChargeAmount", "regulatoryFeeAmount"], labels: ["促销费", "FBA超量仓储费", "拒付退款", "A-Z索赔退款", "数字服务费", "其他费用", "买家运费", "监管费"], values: [0, 2.5, 4, 5, 6, 7, 8, 9] },
      { keys: ["evaluationSaleNum", "channelSaleNum"], labels: ["测评销量", "多渠道销量"], values: [0, 1] },
      { keys: ["adSpCost", "adSdCost", "adSbCost", "adSbvCost", "adSbsCost"], labels: ["SP广告费", "SD广告费", "SB广告费", "SBV广告费", "SBS广告费"], values: [0, 2.5, 4, 5, 6.75] },
    ];
    for (const { keys, labels, values } of selections) for (const layout of ["", "layout=workbench&"]) for (const format of ["csv", "xlsx"]) for (const handler of [performanceCsv, (r: Request) => csv(r, { params: Promise.resolve({ domain: "performance" }) })]) {
      const request = new Request(`http://localhost/api/sellfox/performance/export?${layout}from=2026-10-25&to=2026-10-25&${keys.map(key => `column=${key}`).join("&")}&format=${format}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
      const response = await handler(request);
      assert.equal(response.status, 200);
      if (format === "csv") assert.equal((await response.text()).trim(), labels.map(label => `"${label}"`).join(",") + "\r\n" + values.join(","));
      else {
        const { default: ExcelJS } = await import("exceljs");
        const book = new ExcelJS.Workbook(); await book.xlsx.load(await response.arrayBuffer());
        assert.deepEqual(keys.map((_, i) => book.worksheets[0].getRow(1).getCell(i + 1).value), labels);
        assert.deepEqual(keys.map((_, i) => book.worksheets[0].getRow(2).getCell(i + 1).value), values);
      }
    }
    assert.equal(calls.length, selections.length * 8);
    for (const sql of calls) {
      assert.doesNotMatch(sql.text, /payload/);
      for (const key of selections.flatMap(selection => selection.keys)) {
        assert.ok(sql.text.includes(`s."${key}"`));
        assert.ok(sql.text.includes(`COALESCE(sum("${key}"),0)::float`));
      }
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});
