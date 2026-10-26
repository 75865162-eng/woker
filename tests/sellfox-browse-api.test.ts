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
  const calls: Prisma.Sql[] = [], facets = { productTags: ["新品"], brands: ["品牌"] };
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
      for (const buyBox of ["yes", "no"]) {
        const context = { params: Promise.resolve({ domain }) };
        const request = (extra = "") => new Request(`http://localhost/api/sellfox/${domain}?from=2026-10-25&to=2026-10-25&buyBox=${buyBox}${extra}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
        const browseHandler = domain === "sales" ? salesBrowse : domain === "performance" ? performanceBrowse : (r: Request) => browse(r, context);
        for (const extra of ["", "&layout=workbench"]) {
          calls.length = 0;
          const response = await browseHandler(request(extra));
          assert.equal(response.status, 200);
          if (domain === "listings") assert.deepEqual((await response.json()).facets, facets);
          assert.ok(calls.some(sql => /[ls]\."buyBoxWinner"=\$\d+/.test(sql.text) && sql.values.includes(buyBox === "yes" ? "是" : "否")));
        }
        const handlers = [
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

test("ads productTag alone reaches browse/facets and CSV/XLSX; explicit Agent export keeps its narrow contract", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [], facets = { productTags: ["新品", "标签、完整"] };
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => {
      calls.push(sql);
      return sql.text.startsWith("WITH") ? [{ rows: [], total: 0, totals: [], facets }] : sql.text.startsWith("SELECT count") ? [{ total: 0 }] : [];
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    const request = (domain: string, extra = "") => new Request(`http://localhost/api/sellfox/${domain}?${new URLSearchParams({ productTag: " 标签、完整 " })}${extra}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
    for (const domain of ["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"]) {
      const context = { params: Promise.resolve({ domain }) };
      for (const layout of ["", "&layout=workbench"]) {
        const response = await browse(request(domain, layout), context);
        assert.equal(response.status, 200); assert.deepEqual((await response.json()).facets, facets);
        assert.match(calls.at(-1)!.text, /AS facets/);
        for (const format of ["csv", "xlsx"]) {
          const exported = await csv(request(domain, `${layout}&format=${format}`), context);
          assert.equal(exported.status, 200);
          const sql = calls.at(-1)!;
          assert.match(sql.text, /l\."productTagNames" @> ARRAY\[/); assert.ok(sql.values.includes("标签、完整"));
          assert.doesNotMatch(sql.text, /AS facets/);
          assert.match(exported.headers.get("Content-Type")!, format === "csv" ? /text\/csv/ : /spreadsheetml/);
        }
      }
      const start = calls.length;
      const agent = await csv(request(domain, "&agent=1&layout=workbench"), context);
      assert.equal(agent.status, 200); assert.match(agent.headers.get("Content-Disposition")!, /-agent\.csv/);
      assert.ok(calls.length > start);
      for (const sql of calls.slice(start)) {
        assert.doesNotMatch(sql.text, /productTagNames|productTags|sellfox_listing_current|AS facets/);
        assert.ok(!sql.values.includes("标签、完整"));
      }
      const guarded = await csv(request(domain, "&agent=1&sortBy=productTags"), context);
      assert.equal(guarded.status, 400); assert.match((await guarded.json()).error, /workbench/);
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("ads fulfillment alone reaches six-tab browse and CSV/XLSX without changing Agent exports", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [];
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => {
      calls.push(sql);
      return sql.text.startsWith("WITH") ? [{ rows: [], total: 0, totals: [], facets: { productTags: ["新品"] } }] : sql.text.startsWith("SELECT count") ? [{ total: 0 }] : [];
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    const request = (domain: string, params: string) => new Request(`http://localhost/api/sellfox/${domain}?${params}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
    for (const domain of ["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"]) {
      const context = { params: Promise.resolve({ domain }) };
      for (const fulfillment of ["AFN", "MFN"]) {
        for (const layout of ["", "&layout=workbench"]) {
          for (const tag of ["", "&productTag=新品"]) {
            const params = `fulfillment=${fulfillment}${layout}${tag}`;
            for (const format of ["browse", "csv", "xlsx"]) {
              const response = format === "browse" ? await browse(request(domain, params), context) : await csv(request(domain, `${params}&format=${format}`), context);
              assert.equal(response.status, 200);
              const sql = calls.at(-1)!;
              assert.match(sql.text, /LIMIT 1\) l ON TRUE WHERE [\s\S]*AND l.fulfillment=\$\d+/);
              assert.ok(sql.values.includes(fulfillment)); assert.ok(sql.values.includes("org")); assert.ok(sql.values.includes("ws"));
              assert.doesNotMatch(sql.text, /payload|AND l\.(?:brand|"buyBoxWinner")=/);
              if (tag) { assert.match(sql.text, /AND l\."matchesProductTag"/); assert.ok(sql.values.includes("新品")); }
              if (format === "browse") assert.deepEqual((await response.json()).facets, { productTags: ["新品"] });
              else { assert.doesNotMatch(sql.text, /AS facets/); assert.match(response.headers.get("Content-Type")!, format === "csv" ? /text\/csv/ : /spreadsheetml/); }
            }
          }
        }
        const start = calls.length;
        const agent = await csv(request(domain, `fulfillment=${fulfillment}&agent=1&layout=workbench`), context);
        assert.equal(agent.status, 200); assert.match(agent.headers.get("Content-Disposition")!, /-agent\.csv/);
        assert.ok(calls.length > start);
        for (const sql of calls.slice(start)) {
          assert.doesNotMatch(sql.text, /fulfillment|sellfox_listing_current/);
          assert.ok(!sql.values.includes(fulfillment));
        }
        const guarded = await csv(request(domain, `fulfillment=${fulfillment}&agent=1&sortBy=fulfillment`), context);
        assert.equal(guarded.status, 400); assert.match((await guarded.json()).error, /workbench/);
      }
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("ads brand alone routes six-tab browse and CSV/XLSX through workbench while Agent exports keep their guards", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [], facets = { productTags: ["新品"], brands: ["00123", "品牌"] };
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => {
      calls.push(sql);
      return sql.text.startsWith("WITH") ? [{ rows: [], total: 0, totals: [], facets }] : sql.text.startsWith("SELECT count") ? [{ total: 0 }] : [];
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    const request = (domain: string, brand: string, extra = "") => new Request(`http://localhost/api/sellfox/${domain}?${new URLSearchParams({ brand: ` ${brand} ` })}${extra}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
    for (const domain of ["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"]) {
      const context = { params: Promise.resolve({ domain }) };
      for (const brand of ["品牌", "00123", "%' OR TRUE--"]) {
        for (const extra of ["", "&layout=workbench", "&productTag=新品&fulfillment=AFN"]) {
          for (const format of ["browse", "csv", "xlsx"]) {
            const response = format === "browse" ? await browse(request(domain, brand, extra), context) : await csv(request(domain, brand, `${extra}&format=${format}`), context);
            assert.equal(response.status, 200);
            const sql = calls.at(-1)!;
            const parameter = sql.text.match(/LIMIT 1\) l ON TRUE WHERE [\s\S]*AND l.brand=\$(\d+)/);
            assert.ok(parameter); assert.equal(sql.values[Number(parameter[1]) - 1], brand);
            if (extra.includes("productTag")) {
              assert.match(sql.text, /AND l\."matchesProductTag"/); assert.match(sql.text, /AND l.fulfillment=/);
            }
            if (format === "browse") assert.deepEqual((await response.json()).facets, facets);
            else {
              assert.doesNotMatch(sql.text, /AS facets/);
              assert.match(response.headers.get("Content-Type")!, format === "csv" ? /text\/csv/ : /spreadsheetml/);
            }
          }
        }
        for (const extra of ["", "&layout=workbench", "&productTag=新品&fulfillment=AFN"]) {
          const start = calls.length;
          const agent = await csv(request(domain, brand, `&agent=1${extra}`), context);
          assert.equal(agent.status, 200); assert.match(agent.headers.get("Content-Disposition")!, /-agent\.csv/);
          assert.ok(calls.length > start);
          for (const sql of calls.slice(start)) {
            assert.doesNotMatch(sql.text, /brand|fulfillment|productTag|sellfox_listing_current|AS facets/);
            assert.ok(!sql.values.includes(brand));
          }
        }
        const guarded = await csv(request(domain, brand, "&agent=1&sortBy=brand"), context);
        assert.equal(guarded.status, 400); assert.match((await guarded.json()).error, /workbench/);
      }
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("ads Buy Box alone routes six-tab browse and CSV/XLSX before rollup while Agent exports ignore it", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [], facets = { productTags: ["新品"], brands: ["00123", "品牌"] };
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => {
      calls.push(sql);
      return sql.text.startsWith("WITH") ? [{ rows: [], total: 0, totals: [], facets }] : sql.text.startsWith("SELECT count") ? [{ total: 0 }] : [];
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    const request = (domain: string, buyBox: string, extra = "") => new Request(`http://localhost/api/sellfox/${domain}?${new URLSearchParams({ buyBox })}${extra}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
    for (const domain of ["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"]) {
      const context = { params: Promise.resolve({ domain }) };
      for (const buyBox of ["yes", "no"]) {
        for (const extra of ["", "&layout=workbench", "&brand=品牌&productTag=新品&fulfillment=AFN"]) {
          for (const format of ["browse", "csv", "xlsx"]) {
            const response = format === "browse" ? await browse(request(domain, buyBox, extra), context) : await csv(request(domain, buyBox, `${extra}&format=${format}`), context);
            assert.equal(response.status, 200);
            const sql = calls.at(-1)!;
            const parameter = sql.text.match(/LIMIT 1\) l ON TRUE WHERE [\s\S]*AND l\."buyBoxWinner"=\$(\d+)/);
            assert.ok(parameter); assert.equal(sql.values[Number(parameter[1]) - 1], buyBox === "yes" ? "是" : "否");
            if (extra.includes("productTag")) {
              assert.match(sql.text, /AND l\."matchesProductTag"/); assert.match(sql.text, /AND l.fulfillment=/); assert.match(sql.text, /AND l.brand=/);
            }
            if (format === "browse") assert.deepEqual((await response.json()).facets, facets);
            else {
              assert.doesNotMatch(sql.text, /AS facets/);
              assert.match(response.headers.get("Content-Type")!, format === "csv" ? /text\/csv/ : /spreadsheetml/);
            }
          }
        }
        for (const extra of ["", "&layout=workbench", "&brand=品牌&productTag=新品&fulfillment=AFN"]) {
          const start = calls.length;
          const agent = await csv(request(domain, buyBox, `&agent=1${extra}`), context);
          assert.equal(agent.status, 200); assert.match(agent.headers.get("Content-Disposition")!, /-agent\.csv/);
          assert.ok(calls.length > start);
          for (const sql of calls.slice(start)) {
            assert.doesNotMatch(sql.text, /buyBoxWinner|brand|fulfillment|productTag|sellfox_listing_current|AS facets/);
            assert.ok(!sql.values.includes("是") && !sql.values.includes("否"));
          }
        }
        const guarded = await csv(request(domain, buyBox, "&agent=1&sortBy=buyBoxWinner"), context);
        assert.equal(guarded.status, 400); assert.match((await guarded.json()).error, /workbench/);
      }
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("listings Buy Box alone routes browse and CSV/XLSX through workbench; NULL/missing stay in 全部", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [], facets = { productTags: ["新品"], brands: ["品牌"] };
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => {
      calls.push(sql);
      return sql.text.startsWith("WITH") ? [{ rows: [], total: 0, totals: [], facets }] : sql.text.startsWith("SELECT count") ? [{ total: 0 }] : [];
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    const context = { params: Promise.resolve({ domain: "listings" }) };
    const request = (buyBox: string, extra = "") => new Request(`http://localhost/api/sellfox/listings?${new URLSearchParams({ buyBox })}${extra}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
    for (const buyBox of ["yes", "no"]) {
      for (const extra of ["", "&layout=workbench", "&brand=品牌&productTag=新品&fulfillment=AFN"]) {
        for (const format of ["browse", "csv", "xlsx"] as const) {
          calls.length = 0;
          const response = format === "browse" ? await browse(request(buyBox, extra), context) : await csv(request(buyBox, `${extra}&format=${format}`), context);
          assert.equal(response.status, 200);
          const sql = calls.find(s => s.text.startsWith("WITH"))!;
          assert.ok(sql);
          assert.match(sql.text, /s\."buyBoxWinner"=/);
          assert.ok(sql.values.includes(buyBox === "yes" ? "是" : "否"));
          assert.ok(!sql.values.includes("yes") && !sql.values.includes("no"));
          if (extra.includes("productTag")) {
            assert.match(sql.text, /s\."productTagNames" @>/);
            assert.match(sql.text, /s\.fulfillment=/);
            assert.match(sql.text, /s\.brand=/);
          }
          if (format === "browse") {
            assert.match(sql.text, /AS facets/);
            assert.deepEqual((await response.json()).facets, facets);
          } else {
            assert.doesNotMatch(sql.text, /AS facets/);
            assert.match(response.headers.get("Content-Type")!, format === "csv" ? /text\/csv/ : /spreadsheetml/);
          }
        }
      }
      // Explicit agent export still applies typed Buy Box on listings current rows.
      calls.length = 0;
      const agent = await csv(request(buyBox, "&agent=1"), context);
      assert.equal(agent.status, 200);
      assert.match(agent.headers.get("Content-Disposition")!, /-agent\.csv/);
      assert.ok(calls.some(sql => /s\."buyBoxWinner"=/.test(sql.text) && sql.values.includes(buyBox === "yes" ? "是" : "否")));
    }
    // blank / unknown buyBox params are treated as 全部 — no Buy Box predicate.
    for (const value of ["", "maybe", "true", "false", "是", "否"]) {
      calls.length = 0;
      const response = await browse(new Request(`http://localhost/api/sellfox/listings?${value ? `buyBox=${encodeURIComponent(value)}&` : ""}layout=workbench`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } }), context);
      assert.equal(response.status, 200);
      for (const sql of calls) {
        assert.doesNotMatch(sql.text, /buyBoxWinner=/);
        assert.ok(!sql.values.includes("是") && !sql.values.includes("否"));
      }
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("ads default image and selected Listing columns reach CSV/XLSX exports across six tabs with or without layout", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [];
  const rows = [{ id: "matched", rating: "4.4", ratingCount: 128, productTags: "新品、重点", brand: "品牌", fulfillment: "AFN", buyBoxWinner: "是", mainImage: "https://example.test/product.jpg" }, { id: "unmatched", rating: null, ratingCount: null, productTags: null, brand: null, fulfillment: null, buyBoxWinner: null, mainImage: null }, { id: "zero", rating: null, ratingCount: 0, productTags: null, brand: "00123", fulfillment: "MFN", buyBoxWinner: "否", mainImage: null }, { id: "unknown", rating: null, ratingCount: null, productTags: null, brand: "", fulfillment: "未知", buyBoxWinner: null, mainImage: null }];
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => { calls.push(sql); return [{ total: rows.length, totals: [], rows: structuredClone(rows) }]; },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    const request = (domain: string, params: string) => new Request(`http://localhost/api/sellfox/${domain}?from=2026-10-25&to=2026-10-25&${params}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
    for (const domain of ["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"]) {
      const context = { params: Promise.resolve({ domain }) };
      for (const layout of ["", "layout=workbench&"]) {
        for (const sortBy of ["rating", "ratingCount", "productTags", "brand", "fulfillment", "buyBoxWinner"]) {
          const response = await browse(request(domain, `${layout}sortBy=${sortBy}&sortOrder=desc&buyBox=yes&brand=00123&fulfillment=AFN&productTag=标签`), context);
          assert.equal(response.status, 200);
          const data = await response.json();
          assert.deepEqual(data.rows.map((r: Record<string, unknown>) => [r.rating, r.ratingCount, r.productTags, r.mainImage, r.brand, r.fulfillment, r.buyBoxWinner]), rows.map(r => [r.rating, r.ratingCount, r.productTags, r.mainImage, r.brand, r.fulfillment, r.buyBoxWinner]));
          assert.ok(calls.at(-1)!.text.includes(`ORDER BY "${sortBy}" DESC NULLS LAST, id ASC`));
        }
        for (const format of ["csv", "xlsx"]) {
          const defaults = await csv(request(domain, `${layout}buyBox=yes&brand=00123&fulfillment=AFN&productTag=标签&format=${format}`), context);
          assert.equal(defaults.status, 200);
          if (format === "csv") {
            const lines = (await defaults.text()).trim().split("\r\n");
            const headers = lines[0].split(",");
            const imageIndex = headers.indexOf('"图片"');
            assert.ok(imageIndex >= 0);
            assert.equal(headers[imageIndex + 1], '"产品信息"');
            assert.deepEqual(headers.slice(headers.indexOf('"价格"'), headers.indexOf('"价格"') + 3), ['"价格"', '"星级"', '"评论数"']);
            assert.deepEqual(headers.filter(label => ['"星级"', '"评论数"', '"标签"', '"品牌"', '"发货方式"', '"Buy Box"'].includes(label)), ['"星级"', '"评论数"', '"标签"', '"品牌"', '"发货方式"', '"Buy Box"']);
            if (domain === "ads_report") assert.equal(imageIndex, 0);
            assert.equal(lines[1].split(",")[imageIndex], '"https://example.test/product.jpg"');
            assert.equal(lines[2].split(",")[imageIndex], '""');
            for (const label of ["MSKU", "标题", "店铺", "站点"]) assert.ok(!headers.includes(`"${label}"`));
          } else {
            const { default: ExcelJS } = await import("exceljs");
            const book = new ExcelJS.Workbook(); await book.xlsx.load(await defaults.arrayBuffer());
            const sheet = book.worksheets[0];
            const headers = Array.from({ length: sheet.columnCount }, (_, i) => sheet.getRow(1).getCell(i + 1).value);
            const imageIndex = headers.indexOf("图片");
            assert.ok(imageIndex >= 0);
            assert.equal(headers[imageIndex + 1], "产品信息");
            assert.deepEqual(headers.slice(headers.indexOf("价格"), headers.indexOf("价格") + 3), ["价格", "星级", "评论数"]);
            assert.deepEqual(headers.filter(label => ["星级", "评论数", "标签", "品牌", "发货方式", "Buy Box"].includes(String(label))), ["星级", "评论数", "标签", "品牌", "发货方式", "Buy Box"]);
            if (domain === "ads_report") assert.equal(imageIndex, 0);
            assert.equal(sheet.getRow(2).getCell(imageIndex + 1).value, "https://example.test/product.jpg");
            assert.ok([null, ""].includes(sheet.getRow(3).getCell(imageIndex + 1).value as null | string));
            for (const label of ["MSKU", "标题", "店铺", "站点"]) assert.ok(!headers.includes(label));
          }
          // Keep the no-layout/no-sort selected-column route covered too.
          const sort = layout ? `sortBy=buyBoxWinner&sortOrder=asc&` : "";
          const response = await csv(request(domain, `${layout}${sort}buyBox=yes&brand=00123&fulfillment=AFN&productTag=标签&column=rating&column=ratingCount&column=productTags&column=brand&column=fulfillment&column=buyBoxWinner&column=image&format=${format}`), context);
          assert.equal(response.status, 200);
          assert.match(calls.at(-1)!.text, /min\(NULLIF\("listingMainImage",''\)\) AS "mainImage"/);
          if (layout) assert.ok(calls.at(-1)!.text.includes(`ORDER BY "buyBoxWinner" ASC NULLS LAST, id ASC`));
          if (format === "csv") assert.equal((await response.text()).trim(), '"图片","星级","评论数","标签","品牌","发货方式","Buy Box"\r\n"https://example.test/product.jpg","4.4",128,"新品、重点","品牌","AFN","是"\r\n"","","","","","",""\r\n"","",0,"","00123","MFN","否"\r\n"","","","","","未知",""');
          else {
            const { default: ExcelJS } = await import("exceljs");
            const book = new ExcelJS.Workbook(); await book.xlsx.load(await response.arrayBuffer());
            const sheet = book.worksheets[0];
            assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(i => sheet.getRow(1).getCell(i).value), ["图片", "星级", "评论数", "标签", "品牌", "发货方式", "Buy Box"]);
            assert.deepEqual([1, 2, 3, 4, 5, 6, 7].map(i => sheet.getRow(2).getCell(i).value), ["https://example.test/product.jpg", "4.4", 128, "新品、重点", "品牌", "AFN", "是"]);
            assert.equal(sheet.getRow(4).getCell(3).value, 0);
            assert.equal(sheet.getRow(4).getCell(5).value, "00123");
            assert.equal(sheet.getRow(4).getCell(6).value, "MFN");
            assert.equal(sheet.getRow(4).getCell(7).value, "否");
            assert.equal(sheet.getRow(5).getCell(7).value, null);
            assert.equal(sheet.getRow(5).getCell(6).value, "未知");
            assert.ok([null, ""].includes(sheet.getRow(5).getCell(5).value as null | string));
            for (const i of [1, 2, 3, 4, 5, 6, 7]) assert.ok([null, ""].includes(sheet.getRow(3).getCell(i).value as null | string));
          }
        }
      }
    }
    for (const sql of calls) {
      assert.ok(sql.values.includes("org")); assert.ok(sql.values.includes("ws"));
      assert.match(sql.text, /l\."buyBoxWinner" AS "listingBuyBoxWinner"/);
      assert.match(sql.text, /AND l\."buyBoxWinner"=/); assert.ok(sql.values.includes("是"));
      assert.match(sql.text, /AND l.brand=/);
      assert.match(sql.text, /AND l.fulfillment=/); assert.ok(sql.values.includes("AFN"));
      assert.ok(sql.values.includes("00123"));
      assert.match(sql.text, /l\."productTagNames" @> ARRAY\[/); assert.ok(sql.values.includes("标签"));
      if (sql.text.includes("AS facets")) {
        const facets = sql.text.slice(sql.text.indexOf("jsonb_build_object('productTags'"));
        assert.match(facets, /'brands'/); assert.doesNotMatch(facets, /salespersons/);
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
      { keys: ["promotionTotalAmount", "fbaOverageFeeAmount", "chargebackAmount", "guaranteeClaimAmount", "digitalServicesFeeAmount", "otherPriceAmount", "shippingChargeAmount", "regulatoryFeeAmount"], labels: ["FBA超量仓储费", "促销费", "拒付退款", "A-Z索赔退款", "数字服务费", "其他费用", "买家运费", "监管费"], values: [2.5, 0, 4, 5, 6, 7, 8, 9] },
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

test("listings DXM publish state alone routes browse/facets and CSV/XLSX through workbench; Agent export still filters", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [], facets = { productTags: ["新品"], brands: ["品牌"], dxmPublishStates: ["delete", "raw-state"] };
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => {
      calls.push(sql);
      return sql.text.startsWith("WITH") ? [{ rows: [], total: 0, totals: [], facets }] : sql.text.startsWith("SELECT count") ? [{ total: 0 }] : [];
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    const context = { params: Promise.resolve({ domain: "listings" }) };
    const request = (dxmPublishState: string, extra = "") => new Request(`http://localhost/api/sellfox/listings?${new URLSearchParams({ dxmPublishState: ` ${dxmPublishState} ` })}${extra}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
    for (const dxmPublishState of ["delete", "raw-state", "%' OR TRUE--"]) {
      for (const extra of ["", "&layout=workbench", "&layout=legacy", "&brand=品牌&buyBox=yes&productTag=新品&fulfillment=AFN&from=2024-01-15"]) {
        for (const format of ["browse", "csv", "xlsx"] as const) {
          calls.length = 0;
          const response = format === "browse" ? await browse(request(dxmPublishState, extra), context) : await csv(request(dxmPublishState, `${extra}&format=${format}`), context);
          assert.equal(response.status, 200);
          assert.equal(calls.length, 1);
          const sql = calls[0]; assert.ok(sql.text.startsWith("WITH"));
          const match = sql.text.match(/s\."dxmPublishState"=\$(\d+)/);
          assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], dxmPublishState);
          if (extra.includes("brand")) {
            assert.match(sql.text, /s\.brand=|s\."buyBoxWinner"=|s\."productTagNames" @>/);
            assert.match(sql.text, /s\."openDate">=/);
          }
          if (format === "browse") {
            assert.match(sql.text, /'dxmPublishStates',ARRAY\(SELECT DISTINCT "dxmPublishState"/);
            assert.deepEqual((await response.json()).facets, facets);
          } else {
            assert.doesNotMatch(sql.text, /AS facets/);
            assert.match(response.headers.get("Content-Type")!, format === "csv" ? /text\/csv/ : /spreadsheetml/);
          }
        }
        calls.length = 0;
        const agent = await csv(request(dxmPublishState, `${extra}&agent=1`), context);
        assert.equal(agent.status, 200);
        assert.match(agent.headers.get("Content-Disposition")!, /-agent\.csv/);
        assert.equal(calls.length, 1);
        const sql = calls[0]; assert.ok(sql.text.startsWith("SELECT"));
        const match = sql.text.match(/s\."dxmPublishState"=\$(\d+)/);
        assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], dxmPublishState);
        assert.doesNotMatch(sql.text, /AS facets/);
      }
    }
    for (const value of ["", "   "]) {
      calls.length = 0;
      const response = await browse(request(value, "&layout=workbench"), context);
      assert.equal(response.status, 200);
      assert.doesNotMatch(calls[0].text, /s\."dxmPublishState"=/);
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("listings firstSale bounds reach workbench and Agent browse/exports without overloading openDate or adding a gate", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [];
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => {
      calls.push(sql);
      return sql.text.startsWith("WITH") ? [{ rows: [], total: 0, totals: [], facets: {} }] : sql.text.startsWith("SELECT count") ? [{ total: 0 }] : [];
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    const context = { params: Promise.resolve({ domain: "listings" }) };
    for (const range of ["firstSaleFrom=2024-02-01", "firstSaleTo=2024-03-01", "firstSaleFrom=2024-02-01&firstSaleTo=2024-03-01"]) {
      for (const open of ["", "&from=2023-01-01&to=2023-12-31"]) {
        for (const layout of ["", "&layout=workbench"]) {
          for (const format of ["browse", "csv", "xlsx", "agent"] as const) {
            if (format === "xlsx" && !layout) continue;
            calls.length = 0;
            const params = new URLSearchParams(`${range}${open}${layout}${format === "agent" ? "&agent=1" : `&format=${format}`}`);
            const request = new Request(`http://localhost/api/sellfox/listings?${params}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
            const response = await (format === "browse" ? browse : csv)(request, context);
            assert.equal(response.status, 200);
            assert.equal(calls.length, format === "browse" && !layout ? 2 : 1);
            for (const sql of calls) {
              assert.equal(sql.text.startsWith("WITH"), Boolean(layout) && format !== "agent");
              for (const [key, pattern] of [
                ["firstSaleFrom", /s\."firstSaleDate">=\$(\d+)/], ["firstSaleTo", /s\."firstSaleDate"<=\$(\d+)/],
                ["from", /s\."openDate">=\$(\d+)/], ["to", /s\."openDate"<=\$(\d+)/],
              ] as const) {
                const match = sql.text.match(pattern);
                if (params.has(key)) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], params.get(key)); }
                else assert.equal(match, null);
              }
              assert.doesNotMatch(sql.text, /payload|firstOrderDate|"reportDate"[<>]=/);
            }
          }
        }
      }
    }
    for (const range of ["firstSaleFrom=2026-02-29", "firstSaleTo=invalid", "firstSaleFrom=2024-03-01&firstSaleTo=2024-02-01"]) {
      for (const handler of [browse, csv]) {
        calls.length = 0;
        const response = await handler(new Request(`http://localhost/api/sellfox/listings?${range}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } }), context);
        assert.equal(response.status, 400); assert.equal(calls.length, 0);
      }
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("listings bsrCategory alone routes browse/facets and CSV/XLSX through workbench; Agent export still filters", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [], facets = { productTags: ["新品"], brands: ["品牌"], dxmPublishStates: ["delete"], bsrCategories: ["Baby", "Musical Instruments"] };
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => {
      calls.push(sql);
      return sql.text.startsWith("WITH") ? [{ rows: [], total: 0, totals: [], facets }] : sql.text.startsWith("SELECT count") ? [{ total: 0 }] : [];
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    const context = { params: Promise.resolve({ domain: "listings" }) };
    const request = (bsrCategory: string, extra = "") => new Request(`http://localhost/api/sellfox/listings?${new URLSearchParams({ bsrCategory: ` ${bsrCategory} ` })}${extra}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
    for (const bsrCategory of ["Baby", "Musical Instruments", "%' OR TRUE--"]) {
      for (const extra of ["", "&layout=workbench", "&layout=legacy", "&brand=品牌&buyBox=yes&productTag=新品&fulfillment=AFN&from=2024-01-15"]) {
        for (const format of ["browse", "csv", "xlsx"] as const) {
          calls.length = 0;
          const response = format === "browse" ? await browse(request(bsrCategory, extra), context) : await csv(request(bsrCategory, `${extra}&format=${format}`), context);
          assert.equal(response.status, 200);
          assert.equal(calls.length, 1);
          const sql = calls[0]; assert.ok(sql.text.startsWith("WITH"));
          const match = sql.text.match(/s\."bsrCategory"=\$(\d+)/);
          assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], bsrCategory);
          if (extra.includes("brand")) {
            assert.match(sql.text, /s\.brand=|s\."buyBoxWinner"=|s\."productTagNames" @>/);
            assert.match(sql.text, /s\."openDate">=/);
          }
          if (format === "browse") {
            assert.match(sql.text, /'bsrCategories',ARRAY\(SELECT DISTINCT "bsrCategory"/);
            assert.deepEqual((await response.json()).facets, facets);
          } else {
            assert.doesNotMatch(sql.text, /AS facets/);
            assert.match(response.headers.get("Content-Type")!, format === "csv" ? /text\/csv/ : /spreadsheetml/);
          }
        }
        calls.length = 0;
        const agent = await csv(request(bsrCategory, `${extra}&agent=1`), context);
        assert.equal(agent.status, 200);
        assert.match(agent.headers.get("Content-Disposition")!, /-agent\.csv/);
        assert.equal(calls.length, 1);
        const sql = calls[0]; assert.ok(sql.text.startsWith("SELECT"));
        const match = sql.text.match(/s\."bsrCategory"=\$(\d+)/);
        assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], bsrCategory);
        assert.doesNotMatch(sql.text, /AS facets/);
      }
    }
    for (const value of ["", "   "]) {
      calls.length = 0;
      const response = await browse(request(value, "&layout=workbench"), context);
      assert.equal(response.status, 200);
      assert.doesNotMatch(calls[0].text, /s\."bsrCategory"=/);
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("listings totalInventory min/max browse and export use inventory_current sum SQL and reject bad bounds", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [];
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => {
      calls.push(sql);
      return sql.text.startsWith("WITH") ? [{ rows: [], total: 0, totals: [], facets: {} }] : sql.text.startsWith("SELECT count") ? [{ total: 0 }] : [];
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    const context = { params: Promise.resolve({ domain: "listings" }) };
    for (const range of ["totalInventoryMin=0", "totalInventoryMax=100", "totalInventoryMin=0&totalInventoryMax=100"]) {
      for (const layout of ["", "&layout=workbench"]) {
        for (const format of ["browse", "csv", "agent"] as const) {
          calls.length = 0;
          const params = new URLSearchParams(`${range}${layout}${format === "agent" ? "&agent=1" : format === "csv" ? "&format=csv" : ""}`);
          const request = new Request(`http://localhost/api/sellfox/listings?${params}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
          const response = await (format === "browse" ? browse : csv)(request, context);
          assert.equal(response.status, 200);
          assert.ok(calls.length >= 1);
          const listingSql = calls.filter(sql => /sellfox_listing_current|EXISTS \(SELECT 1 FROM \(SELECT CASE WHEN count\(i\."totalInventory"\)/.test(sql.text) && !sql.text.startsWith('SELECT "storeId",msku'));
          assert.ok(listingSql.length >= 1);
          for (const sql of listingSql) {
            assert.match(sql.text, /EXISTS \(SELECT 1 FROM \(SELECT CASE WHEN count\(i\."totalInventory"\)=count\(\*\) THEN sum\(i\."totalInventory"\) END AS inv FROM sellfox_inventory_current i/);
            assert.match(sql.text, /stock\.inv IS NOT NULL/);
            for (const [key, pattern] of [["totalInventoryMin", /stock\.inv>=\$(\d+)/], ["totalInventoryMax", /stock\.inv<=\$(\d+)/]] as const) {
              const match = sql.text.match(pattern);
              if (params.has(key)) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get(key))); }
              else assert.equal(match, null);
            }
          }
        }
      }
    }
    for (const range of ["totalInventoryMin=1.5", "totalInventoryMax=abc", "totalInventoryMin=10&totalInventoryMax=1"]) {
      for (const handler of [browse, csv]) {
        calls.length = 0;
        const response = await handler(new Request(`http://localhost/api/sellfox/listings?${range}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } }), context);
        assert.equal(response.status, 400); assert.equal(calls.length, 0);
      }
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("listings bsrRank min/max browse and export use typed bsrRank SQL and reject bad bounds", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [];
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => {
      calls.push(sql);
      return sql.text.startsWith("WITH") ? [{ rows: [], total: 0, totals: [], facets: {} }] : sql.text.startsWith("SELECT count") ? [{ total: 0 }] : [];
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    const context = { params: Promise.resolve({ domain: "listings" }) };
    for (const range of ["bsrRankMin=0", "bsrRankMax=10000", "bsrRankMin=1&bsrRankMax=5000"]) {
      for (const layout of ["", "&layout=workbench"]) {
        for (const format of ["browse", "csv", "agent"] as const) {
          calls.length = 0;
          const params = new URLSearchParams(`${range}${layout}${format === "agent" ? "&agent=1" : format === "csv" ? "&format=csv" : ""}`);
          const request = new Request(`http://localhost/api/sellfox/listings?${params}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
          const response = await (format === "browse" ? browse : csv)(request, context);
          assert.equal(response.status, 200);
          assert.ok(calls.length >= 1);
          const listingSql = calls.filter(sql => /sellfox_listing_current/.test(sql.text) && !sql.text.startsWith('SELECT "storeId",msku'));
          assert.ok(listingSql.length >= 1);
          for (const sql of listingSql) {
            assert.match(sql.text, /s\."bsrRank" IS NOT NULL/);
            for (const [key, pattern] of [["bsrRankMin", /s\."bsrRank">=\$(\d+)/], ["bsrRankMax", /s\."bsrRank"<=\$(\d+)/]] as const) {
              const match = sql.text.match(pattern);
              if (params.has(key)) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get(key))); }
              else assert.equal(match, null);
            }
          }
        }
      }
    }
    for (const range of ["bsrRankMin=1.5", "bsrRankMax=abc", "bsrRankMin=10&bsrRankMax=1"]) {
      for (const handler of [browse, csv]) {
        calls.length = 0;
        const response = await handler(new Request(`http://localhost/api/sellfox/listings?${range}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } }), context);
        assert.equal(response.status, 400); assert.equal(calls.length, 0);
      }
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("listings listingQuantity min/max browse and export use typed listingQuantity SQL and reject bad bounds", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [];
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => {
      calls.push(sql);
      return sql.text.startsWith("WITH") ? [{ rows: [], total: 0, totals: [], facets: {} }] : sql.text.startsWith("SELECT count") ? [{ total: 0 }] : [];
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    const context = { params: Promise.resolve({ domain: "listings" }) };
    for (const range of ["listingQuantityMin=0", "listingQuantityMax=100", "listingQuantityMin=1.5&listingQuantityMax=48"]) {
      for (const layout of ["", "&layout=workbench"]) {
        for (const format of ["browse", "csv", "agent"] as const) {
          calls.length = 0;
          const params = new URLSearchParams(`${range}${layout}${format === "agent" ? "&agent=1" : format === "csv" ? "&format=csv" : ""}`);
          const request = new Request(`http://localhost/api/sellfox/listings?${params}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
          const response = await (format === "browse" ? browse : csv)(request, context);
          assert.equal(response.status, 200);
          assert.ok(calls.length >= 1);
          const listingSql = calls.filter(sql => /sellfox_listing_current/.test(sql.text) && !sql.text.startsWith('SELECT "storeId",msku'));
          assert.ok(listingSql.length >= 1);
          for (const sql of listingSql) {
            assert.match(sql.text, /s\."listingQuantity" IS NOT NULL/);
            for (const [key, pattern] of [["listingQuantityMin", /s\."listingQuantity">=\$(\d+)/], ["listingQuantityMax", /s\."listingQuantity"<=\$(\d+)/]] as const) {
              const match = sql.text.match(pattern);
              if (params.has(key)) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get(key))); }
              else assert.equal(match, null);
            }
          }
        }
      }
    }
    for (const range of ["listingQuantityMin=1e2", "listingQuantityMax=abc", "listingQuantityMin=10&listingQuantityMax=1"]) {
      for (const handler of [browse, csv]) {
        calls.length = 0;
        const response = await handler(new Request(`http://localhost/api/sellfox/listings?${range}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } }), context);
        assert.equal(response.status, 400); assert.equal(calls.length, 0);
      }
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("listings reservedQty min/max browse and export use typed reservedQty SQL and reject bad bounds", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [];
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => {
      calls.push(sql);
      return sql.text.startsWith("WITH") ? [{ rows: [], total: 0, totals: [], facets: {} }] : sql.text.startsWith("SELECT count") ? [{ total: 0 }] : [];
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    const context = { params: Promise.resolve({ domain: "listings" }) };
    for (const range of ["reservedQtyMin=0", "reservedQtyMax=100", "reservedQtyMin=1.5&reservedQtyMax=48"]) {
      for (const layout of ["", "&layout=workbench"]) {
        for (const format of ["browse", "csv", "agent"] as const) {
          calls.length = 0;
          const params = new URLSearchParams(`${range}${layout}${format === "agent" ? "&agent=1" : format === "csv" ? "&format=csv" : ""}`);
          const request = new Request(`http://localhost/api/sellfox/listings?${params}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
          const response = await (format === "browse" ? browse : csv)(request, context);
          assert.equal(response.status, 200);
          assert.ok(calls.length >= 1);
          const listingSql = calls.filter(sql => /sellfox_listing_current/.test(sql.text) && !sql.text.startsWith('SELECT "storeId",msku'));
          assert.ok(listingSql.length >= 1);
          for (const sql of listingSql) {
            assert.match(sql.text, /s\."reservedQty" IS NOT NULL/);
            for (const [key, pattern] of [["reservedQtyMin", /s\."reservedQty">=\$(\d+)/], ["reservedQtyMax", /s\."reservedQty"<=\$(\d+)/]] as const) {
              const match = sql.text.match(pattern);
              if (params.has(key)) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get(key))); }
              else assert.equal(match, null);
            }
          }
        }
      }
    }
    for (const range of ["reservedQtyMin=1e2", "reservedQtyMax=abc", "reservedQtyMin=10&reservedQtyMax=1"]) {
      for (const handler of [browse, csv]) {
        calls.length = 0;
        const response = await handler(new Request(`http://localhost/api/sellfox/listings?${range}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } }), context);
        assert.equal(response.status, 400); assert.equal(calls.length, 0);
      }
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("listings unsellable min/max browse and export use typed unsellable SQL and reject bad bounds", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [];
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => {
      calls.push(sql);
      return sql.text.startsWith("WITH") ? [{ rows: [], total: 0, totals: [], facets: {} }] : sql.text.startsWith("SELECT count") ? [{ total: 0 }] : [];
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    const context = { params: Promise.resolve({ domain: "listings" }) };
    for (const range of ["unsellableMin=0", "unsellableMax=100", "unsellableMin=1.5&unsellableMax=48"]) {
      for (const layout of ["", "&layout=workbench"]) {
        for (const format of ["browse", "csv", "agent"] as const) {
          calls.length = 0;
          const params = new URLSearchParams(`${range}${layout}${format === "agent" ? "&agent=1" : format === "csv" ? "&format=csv" : ""}`);
          const request = new Request(`http://localhost/api/sellfox/listings?${params}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
          const response = await (format === "browse" ? browse : csv)(request, context);
          assert.equal(response.status, 200);
          assert.ok(calls.length >= 1);
          const listingSql = calls.filter(sql => /sellfox_listing_current/.test(sql.text) && !sql.text.startsWith('SELECT "storeId",msku'));
          assert.ok(listingSql.length >= 1);
          for (const sql of listingSql) {
            assert.match(sql.text, /s\."unsellable" IS NOT NULL/);
            for (const [key, pattern] of [["unsellableMin", /s\."unsellable">=\$(\d+)/], ["unsellableMax", /s\."unsellable"<=\$(\d+)/]] as const) {
              const match = sql.text.match(pattern);
              if (params.has(key)) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get(key))); }
              else assert.equal(match, null);
            }
          }
        }
      }
    }
    for (const range of ["unsellableMin=1e2", "unsellableMax=abc", "unsellableMin=10&unsellableMax=1"]) {
      for (const handler of [browse, csv]) {
        calls.length = 0;
        const response = await handler(new Request(`http://localhost/api/sellfox/listings?${range}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } }), context);
        assert.equal(response.status, 400); assert.equal(calls.length, 0);
      }
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("listings warehousing min/max browse and export use typed warehousing SQL and reject bad bounds", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [];
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => {
      calls.push(sql);
      return sql.text.startsWith("WITH") ? [{ rows: [], total: 0, totals: [], facets: {} }] : sql.text.startsWith("SELECT count") ? [{ total: 0 }] : [];
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    const context = { params: Promise.resolve({ domain: "listings" }) };
    for (const range of ["warehousingMin=0", "warehousingMax=100", "warehousingMin=1.5&warehousingMax=48"]) {
      for (const layout of ["", "&layout=workbench"]) {
        for (const format of ["browse", "csv", "agent"] as const) {
          calls.length = 0;
          const params = new URLSearchParams(`${range}${layout}${format === "agent" ? "&agent=1" : format === "csv" ? "&format=csv" : ""}`);
          const request = new Request(`http://localhost/api/sellfox/listings?${params}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
          const response = await (format === "browse" ? browse : csv)(request, context);
          assert.equal(response.status, 200);
          assert.ok(calls.length >= 1);
          const listingSql = calls.filter(sql => /sellfox_listing_current/.test(sql.text) && !sql.text.startsWith('SELECT "storeId",msku'));
          assert.ok(listingSql.length >= 1);
          for (const sql of listingSql) {
            assert.match(sql.text, /s\."warehousing" IS NOT NULL/);
            for (const [key, pattern] of [["warehousingMin", /s\."warehousing">=\$(\d+)/], ["warehousingMax", /s\."warehousing"<=\$(\d+)/]] as const) {
              const match = sql.text.match(pattern);
              if (params.has(key)) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get(key))); }
              else assert.equal(match, null);
            }
          }
        }
      }
    }
    for (const range of ["warehousingMin=1e2", "warehousingMax=abc", "warehousingMin=10&warehousingMax=1"]) {
      for (const handler of [browse, csv]) {
        calls.length = 0;
        const response = await handler(new Request(`http://localhost/api/sellfox/listings?${range}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } }), context);
        assert.equal(response.status, 400); assert.equal(calls.length, 0);
      }
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("ads rating min/max routes six-tab browse and CSV/XLSX through workbench while Agent exports ignore it", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [], facets = { productTags: ["新品"], brands: ["00123", "品牌"] };
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => {
      calls.push(sql);
      return sql.text.startsWith("WITH") ? [{ rows: [], total: 0, totals: [], facets }] : sql.text.startsWith("SELECT count") ? [{ total: 0 }] : [];
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    const request = (domain: string, range: string, extra = "") => new Request(`http://localhost/api/sellfox/${domain}?${range}${extra}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
    for (const domain of ["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"]) {
      const context = { params: Promise.resolve({ domain }) };
      for (const range of ["ratingMin=4.5", "ratingMax=5", "ratingMin=4&ratingMax=5"]) {
        const params = new URLSearchParams(range);
        for (const extra of ["", "&layout=workbench", "&brand=品牌&productTag=新品&fulfillment=AFN"]) {
          for (const format of ["browse", "csv", "xlsx"]) {
            const response = format === "browse" ? await browse(request(domain, range, extra), context) : await csv(request(domain, range, `${extra}&format=${format}`), context);
            assert.equal(response.status, 200);
            const sql = calls.at(-1)!;
            assert.match(sql.text, /l\."ratingValue" IS NOT NULL/);
            if (params.has("ratingMin")) {
              const match = sql.text.match(/l\."ratingValue">=\$(\d+)/);
              assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get("ratingMin")));
            }
            if (params.has("ratingMax")) {
              const match = sql.text.match(/l\."ratingValue"<=\$(\d+)/);
              assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get("ratingMax")));
            }
            if (extra.includes("productTag")) {
              assert.match(sql.text, /AND l\."matchesProductTag"/); assert.match(sql.text, /AND l.fulfillment=/); assert.match(sql.text, /AND l.brand=/);
            }
            if (format === "browse") assert.deepEqual((await response.json()).facets, facets);
            else {
              assert.doesNotMatch(sql.text, /AS facets/);
              assert.match(response.headers.get("Content-Type")!, format === "csv" ? /text\/csv/ : /spreadsheetml/);
            }
          }
        }
        for (const extra of ["", "&layout=workbench", "&brand=品牌"]) {
          const start = calls.length;
          const agent = await csv(request(domain, range, `&agent=1${extra}`), context);
          assert.equal(agent.status, 200); assert.match(agent.headers.get("Content-Disposition")!, /-agent\.csv/);
          assert.ok(calls.length > start);
          for (const sql of calls.slice(start)) {
            assert.doesNotMatch(sql.text, /ratingValue|ratingMin|sellfox_listing_current|AS facets/);
            assert.ok(!sql.values.includes(4.5));
          }
        }
      }
      for (const range of ["ratingMin=abc", "ratingMax=1e2", "ratingMin=5&ratingMax=4"]) {
        for (const handler of [browse, csv]) {
          calls.length = 0;
          const response = await handler(request(domain, range), context);
          assert.equal(response.status, 400); assert.equal(calls.length, 0);
        }
      }
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("ads cost min/max routes six-tab browse and CSV/XLSX through workbench; Agent exports apply typed cost", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [], facets = { productTags: ["新品"], brands: ["00123", "品牌"] };
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => {
      calls.push(sql);
      return sql.text.startsWith("WITH") ? [{ rows: [], total: 0, totals: [], facets }] : sql.text.startsWith("SELECT count") ? [{ total: 0 }] : [];
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    const request = (domain: string, range: string, extra = "") => new Request(`http://localhost/api/sellfox/${domain}?${range}${extra}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
    for (const domain of ["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"]) {
      const context = { params: Promise.resolve({ domain }) };
      for (const range of ["costMin=1.5", "costMax=48", "costMin=0&costMax=100"]) {
        const params = new URLSearchParams(range);
        for (const extra of ["", "&layout=workbench", "&brand=品牌&productTag=新品&fulfillment=AFN"]) {
          for (const format of ["browse", "csv", "xlsx"]) {
            const response = format === "browse" ? await browse(request(domain, range, extra), context) : await csv(request(domain, range, `${extra}&format=${format}`), context);
            assert.equal(response.status, 200);
            const sql = calls.at(-1)!;
            assert.match(sql.text, /s\.cost IS NOT NULL/);
            if (params.has("costMin")) {
              const match = sql.text.match(/s\.cost>=\$(\d+)/);
              assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get("costMin")));
            }
            if (params.has("costMax")) {
              const match = sql.text.match(/s\.cost<=\$(\d+)/);
              assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get("costMax")));
            }
            if (extra.includes("productTag")) {
              assert.match(sql.text, /AND l\."matchesProductTag"/); assert.match(sql.text, /AND l.fulfillment=/); assert.match(sql.text, /AND l.brand=/);
            }
            if (format === "browse") assert.deepEqual((await response.json()).facets, facets);
            else {
              assert.doesNotMatch(sql.text, /AS facets/);
              assert.match(response.headers.get("Content-Type")!, format === "csv" ? /text\/csv/ : /spreadsheetml/);
            }
          }
        }
        for (const extra of ["", "&layout=workbench", "&brand=品牌"]) {
          const start = calls.length;
          const agent = await csv(request(domain, range, `&agent=1${extra}`), context);
          assert.equal(agent.status, 200); assert.match(agent.headers.get("Content-Disposition")!, /-agent\.csv/);
          assert.ok(calls.length > start);
          for (const sql of calls.slice(start)) {
            assert.match(sql.text, /cost IS NOT NULL/);
            if (params.has("costMin")) {
              const match = sql.text.match(/cost>=\$(\d+)/);
              assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get("costMin")));
            }
            if (params.has("costMax")) {
              const match = sql.text.match(/cost<=\$(\d+)/);
              assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get("costMax")));
            }
            assert.doesNotMatch(sql.text, /AS facets/);
          }
        }
      }
      for (const range of ["costMin=abc", "costMax=1e2", "costMin=10&costMax=1"]) {
        for (const handler of [browse, csv]) {
          calls.length = 0;
          const response = await handler(request(domain, range), context);
          assert.equal(response.status, 400); assert.equal(calls.length, 0);
        }
      }
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("ads adSales min/max routes six-tab browse and CSV/XLSX through workbench; Agent exports apply typed adSales", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [], facets = { productTags: ["新品"], brands: ["00123", "品牌"] };
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => {
      calls.push(sql);
      return sql.text.startsWith("WITH") ? [{ rows: [], total: 0, totals: [], facets }] : sql.text.startsWith("SELECT count") ? [{ total: 0 }] : [];
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    const request = (domain: string, range: string, extra = "") => new Request(`http://localhost/api/sellfox/${domain}?${range}${extra}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
    for (const domain of ["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"]) {
      const context = { params: Promise.resolve({ domain }) };
      for (const range of ["adSalesMin=1.5", "adSalesMax=48", "adSalesMin=0&adSalesMax=100"]) {
        const params = new URLSearchParams(range);
        for (const extra of ["", "&layout=workbench", "&brand=品牌&productTag=新品&fulfillment=AFN"]) {
          for (const format of ["browse", "csv", "xlsx"]) {
            const response = format === "browse" ? await browse(request(domain, range, extra), context) : await csv(request(domain, range, `${extra}&format=${format}`), context);
            assert.equal(response.status, 200);
            const sql = calls.at(-1)!;
            assert.match(sql.text, /s\."adSales" IS NOT NULL/);
            if (params.has("adSalesMin")) {
              const match = sql.text.match(/s\."adSales">=\$(\d+)/);
              assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get("adSalesMin")));
            }
            if (params.has("adSalesMax")) {
              const match = sql.text.match(/s\."adSales"<=\$(\d+)/);
              assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get("adSalesMax")));
            }
            if (extra.includes("productTag")) {
              assert.match(sql.text, /AND l\."matchesProductTag"/); assert.match(sql.text, /AND l.fulfillment=/); assert.match(sql.text, /AND l.brand=/);
            }
            if (format === "browse") assert.deepEqual((await response.json()).facets, facets);
            else {
              assert.doesNotMatch(sql.text, /AS facets/);
              assert.match(response.headers.get("Content-Type")!, format === "csv" ? /text\/csv/ : /spreadsheetml/);
            }
          }
        }
        for (const extra of ["", "&layout=workbench", "&brand=品牌"]) {
          const start = calls.length;
          const agent = await csv(request(domain, range, `&agent=1${extra}`), context);
          assert.equal(agent.status, 200); assert.match(agent.headers.get("Content-Disposition")!, /-agent\.csv/);
          assert.ok(calls.length > start);
          for (const sql of calls.slice(start)) {
            assert.match(sql.text, /"adSales" IS NOT NULL/);
            if (params.has("adSalesMin")) {
              const match = sql.text.match(/"adSales">=\$(\d+)/);
              assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get("adSalesMin")));
            }
            if (params.has("adSalesMax")) {
              const match = sql.text.match(/"adSales"<=\$(\d+)/);
              assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get("adSalesMax")));
            }
            assert.doesNotMatch(sql.text, /AS facets/);
          }
        }
      }
      for (const range of ["adSalesMin=abc", "adSalesMax=1e2", "adSalesMin=10&adSalesMax=1"]) {
        for (const handler of [browse, csv]) {
          calls.length = 0;
          const response = await handler(request(domain, range), context);
          assert.equal(response.status, 400); assert.equal(calls.length, 0);
        }
      }
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("ads impressions min/max routes six-tab browse and CSV/XLSX through workbench; Agent exports apply typed impressions", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [], facets = { productTags: ["新品"], brands: ["00123", "品牌"] };
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => {
      calls.push(sql);
      return sql.text.startsWith("WITH") ? [{ rows: [], total: 0, totals: [], facets }] : sql.text.startsWith("SELECT count") ? [{ total: 0 }] : [];
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    const request = (domain: string, range: string, extra = "") => new Request(`http://localhost/api/sellfox/${domain}?${range}${extra}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
    for (const domain of ["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"]) {
      const context = { params: Promise.resolve({ domain }) };
      for (const range of ["impressionsMin=15", "impressionsMax=480", "impressionsMin=0&impressionsMax=100"]) {
        const params = new URLSearchParams(range);
        for (const extra of ["", "&layout=workbench", "&brand=品牌&productTag=新品&fulfillment=AFN"]) {
          for (const format of ["browse", "csv", "xlsx"]) {
            const response = format === "browse" ? await browse(request(domain, range, extra), context) : await csv(request(domain, range, `${extra}&format=${format}`), context);
            assert.equal(response.status, 200);
            const sql = calls.at(-1)!;
            assert.match(sql.text, /s\.impressions IS NOT NULL/);
            if (params.has("impressionsMin")) {
              const match = sql.text.match(/s\.impressions>=\$(\d+)/);
              assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get("impressionsMin")));
            }
            if (params.has("impressionsMax")) {
              const match = sql.text.match(/s\.impressions<=\$(\d+)/);
              assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get("impressionsMax")));
            }
            if (extra.includes("productTag")) {
              assert.match(sql.text, /AND l\."matchesProductTag"/); assert.match(sql.text, /AND l.fulfillment=/); assert.match(sql.text, /AND l.brand=/);
            }
            if (format === "browse") assert.deepEqual((await response.json()).facets, facets);
            else {
              assert.doesNotMatch(sql.text, /AS facets/);
              assert.match(response.headers.get("Content-Type")!, format === "csv" ? /text\/csv/ : /spreadsheetml/);
            }
          }
        }
        for (const extra of ["", "&layout=workbench", "&brand=品牌"]) {
          const start = calls.length;
          const agent = await csv(request(domain, range, `&agent=1${extra}`), context);
          assert.equal(agent.status, 200); assert.match(agent.headers.get("Content-Disposition")!, /-agent\.csv/);
          assert.ok(calls.length > start);
          for (const sql of calls.slice(start)) {
            assert.match(sql.text, /impressions IS NOT NULL/);
            if (params.has("impressionsMin")) {
              const match = sql.text.match(/impressions>=\$(\d+)/);
              assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get("impressionsMin")));
            }
            if (params.has("impressionsMax")) {
              const match = sql.text.match(/impressions<=\$(\d+)/);
              assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get("impressionsMax")));
            }
            assert.doesNotMatch(sql.text, /AS facets/);
          }
        }
      }
      for (const range of ["impressionsMin=abc", "impressionsMax=1e2", "impressionsMin=1.5", "impressionsMin=10&impressionsMax=1"]) {
        for (const handler of [browse, csv]) {
          calls.length = 0;
          const response = await handler(request(domain, range), context);
          assert.equal(response.status, 400); assert.equal(calls.length, 0);
        }
      }
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("ads clicks min/max routes six-tab browse and CSV/XLSX through workbench; Agent exports apply typed clicks", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [], facets = { productTags: ["新品"], brands: ["00123", "品牌"] };
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => {
      calls.push(sql);
      return sql.text.startsWith("WITH") ? [{ rows: [], total: 0, totals: [], facets }] : sql.text.startsWith("SELECT count") ? [{ total: 0 }] : [];
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    const request = (domain: string, range: string, extra = "") => new Request(`http://localhost/api/sellfox/${domain}?${range}${extra}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
    for (const domain of ["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"]) {
      const context = { params: Promise.resolve({ domain }) };
      for (const range of ["clicksMin=15", "clicksMax=480", "clicksMin=0&clicksMax=100"]) {
        const params = new URLSearchParams(range);
        for (const extra of ["", "&layout=workbench", "&brand=品牌&productTag=新品&fulfillment=AFN"]) {
          for (const format of ["browse", "csv", "xlsx"]) {
            const response = format === "browse" ? await browse(request(domain, range, extra), context) : await csv(request(domain, range, `${extra}&format=${format}`), context);
            assert.equal(response.status, 200);
            const sql = calls.at(-1)!;
            assert.match(sql.text, /s\.clicks IS NOT NULL/);
            if (params.has("clicksMin")) {
              const match = sql.text.match(/s\.clicks>=\$(\d+)/);
              assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get("clicksMin")));
            }
            if (params.has("clicksMax")) {
              const match = sql.text.match(/s\.clicks<=\$(\d+)/);
              assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get("clicksMax")));
            }
            if (extra.includes("productTag")) {
              assert.match(sql.text, /AND l\."matchesProductTag"/); assert.match(sql.text, /AND l.fulfillment=/); assert.match(sql.text, /AND l.brand=/);
            }
            if (format === "browse") assert.deepEqual((await response.json()).facets, facets);
            else {
              assert.doesNotMatch(sql.text, /AS facets/);
              assert.match(response.headers.get("Content-Type")!, format === "csv" ? /text\/csv/ : /spreadsheetml/);
            }
          }
        }
        for (const extra of ["", "&layout=workbench", "&brand=品牌"]) {
          const start = calls.length;
          const agent = await csv(request(domain, range, `&agent=1${extra}`), context);
          assert.equal(agent.status, 200); assert.match(agent.headers.get("Content-Disposition")!, /-agent\.csv/);
          assert.ok(calls.length > start);
          for (const sql of calls.slice(start)) {
            assert.match(sql.text, /clicks IS NOT NULL/);
            if (params.has("clicksMin")) {
              const match = sql.text.match(/clicks>=\$(\d+)/);
              assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get("clicksMin")));
            }
            if (params.has("clicksMax")) {
              const match = sql.text.match(/clicks<=\$(\d+)/);
              assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get("clicksMax")));
            }
            assert.doesNotMatch(sql.text, /AS facets/);
          }
        }
      }
      for (const range of ["clicksMin=abc", "clicksMax=1e2", "clicksMin=1.5", "clicksMin=10&clicksMax=1"]) {
        for (const handler of [browse, csv]) {
          calls.length = 0;
          const response = await handler(request(domain, range), context);
          assert.equal(response.status, 400); assert.equal(calls.length, 0);
        }
      }
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("ads adOrders min/max routes six-tab browse and CSV/XLSX through workbench; Agent exports apply typed adOrders", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [], facets = { productTags: ["新品"], brands: ["00123", "品牌"] };
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => {
      calls.push(sql);
      return sql.text.startsWith("WITH") ? [{ rows: [], total: 0, totals: [], facets }] : sql.text.startsWith("SELECT count") ? [{ total: 0 }] : [];
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    const request = (domain: string, range: string, extra = "") => new Request(`http://localhost/api/sellfox/${domain}?${range}${extra}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
    for (const domain of ["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"]) {
      const context = { params: Promise.resolve({ domain }) };
      for (const range of ["adOrdersMin=15", "adOrdersMax=480", "adOrdersMin=0&adOrdersMax=100"]) {
        const params = new URLSearchParams(range);
        for (const extra of ["", "&layout=workbench", "&brand=品牌&productTag=新品&fulfillment=AFN"]) {
          for (const format of ["browse", "csv", "xlsx"]) {
            const response = format === "browse" ? await browse(request(domain, range, extra), context) : await csv(request(domain, range, `${extra}&format=${format}`), context);
            assert.equal(response.status, 200);
            const sql = calls.at(-1)!;
            assert.match(sql.text, /s\."adOrders" IS NOT NULL/);
            if (params.has("adOrdersMin")) {
              const match = sql.text.match(/s\."adOrders">=\$(\d+)/);
              assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get("adOrdersMin")));
            }
            if (params.has("adOrdersMax")) {
              const match = sql.text.match(/s\."adOrders"<=\$(\d+)/);
              assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get("adOrdersMax")));
            }
            if (extra.includes("productTag")) {
              assert.match(sql.text, /AND l\."matchesProductTag"/); assert.match(sql.text, /AND l.fulfillment=/); assert.match(sql.text, /AND l.brand=/);
            }
            if (format === "browse") assert.deepEqual((await response.json()).facets, facets);
            else {
              assert.doesNotMatch(sql.text, /AS facets/);
              assert.match(response.headers.get("Content-Type")!, format === "csv" ? /text\/csv/ : /spreadsheetml/);
            }
          }
        }
        for (const extra of ["", "&layout=workbench", "&brand=品牌"]) {
          const start = calls.length;
          const agent = await csv(request(domain, range, `&agent=1${extra}`), context);
          assert.equal(agent.status, 200); assert.match(agent.headers.get("Content-Disposition")!, /-agent\.csv/);
          assert.ok(calls.length > start);
          for (const sql of calls.slice(start)) {
            assert.match(sql.text, /"adOrders" IS NOT NULL/);
            if (params.has("adOrdersMin")) {
              const match = sql.text.match(/"adOrders">=\$(\d+)/);
              assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get("adOrdersMin")));
            }
            if (params.has("adOrdersMax")) {
              const match = sql.text.match(/"adOrders"<=\$(\d+)/);
              assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get("adOrdersMax")));
            }
            assert.doesNotMatch(sql.text, /AS facets/);
          }
        }
      }
      for (const range of ["adOrdersMin=abc", "adOrdersMax=1e2", "adOrdersMin=1.5", "adOrdersMin=10&adOrdersMax=1"]) {
        for (const handler of [browse, csv]) {
          calls.length = 0;
          const response = await handler(request(domain, range), context);
          assert.equal(response.status, 400); assert.equal(calls.length, 0);
        }
      }
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("ads ratingCount min/max routes six-tab browse and CSV/XLSX through workbench while Agent exports ignore it", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const env = { DATABASE_URL: process.env.DATABASE_URL, AUTH_DRIVER: process.env.AUTH_DRIVER };
  delete process.env.DATABASE_URL; process.env.AUTH_DRIVER = "local";
  const calls: Prisma.Sql[] = [], facets = { productTags: ["新品"], brands: ["00123", "品牌"] };
  globals.prisma = {
    workspaceScope: { findUnique: async () => ({ id: "ws" }) },
    $queryRaw: async (sql: Prisma.Sql) => {
      calls.push(sql);
      return sql.text.startsWith("WITH") ? [{ rows: [], total: 0, totals: [], facets }] : sql.text.startsWith("SELECT count") ? [{ total: 0 }] : [];
    },
  } as unknown as PrismaClient;
  try {
    const session = await createLocalSession({ id: "actor", organizationId: "org", organizationName: "Fixture", role: "owner", email: "actor@example.test", name: "Actor" });
    const request = (domain: string, range: string, extra = "") => new Request(`http://localhost/api/sellfox/${domain}?${range}${extra}`, { headers: { "x-workspace-id": "ws", cookie: `${session.sessionCookie.name}=${session.sessionCookie.value}` } });
    for (const domain of ["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"]) {
      const context = { params: Promise.resolve({ domain }) };
      for (const range of ["ratingCountMin=0", "ratingCountMax=100", "ratingCountMin=10&ratingCountMax=50"]) {
        const params = new URLSearchParams(range);
        for (const extra of ["", "&layout=workbench", "&brand=品牌&productTag=新品&fulfillment=AFN"]) {
          for (const format of ["browse", "csv", "xlsx"]) {
            const response = format === "browse" ? await browse(request(domain, range, extra), context) : await csv(request(domain, range, `${extra}&format=${format}`), context);
            assert.equal(response.status, 200);
            const sql = calls.at(-1)!;
            assert.match(sql.text, /l\."ratingCount" IS NOT NULL/);
            if (params.has("ratingCountMin")) {
              const match = sql.text.match(/l\."ratingCount">=\$(\d+)/);
              assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get("ratingCountMin")));
            }
            if (params.has("ratingCountMax")) {
              const match = sql.text.match(/l\."ratingCount"<=\$(\d+)/);
              assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], Number(params.get("ratingCountMax")));
            }
            if (extra.includes("productTag")) {
              assert.match(sql.text, /AND l\."matchesProductTag"/); assert.match(sql.text, /AND l.fulfillment=/); assert.match(sql.text, /AND l.brand=/);
            }
            if (format === "browse") assert.deepEqual((await response.json()).facets, facets);
            else {
              assert.doesNotMatch(sql.text, /AS facets/);
              assert.match(response.headers.get("Content-Type")!, format === "csv" ? /text\/csv/ : /spreadsheetml/);
            }
          }
        }
        for (const extra of ["", "&layout=workbench", "&brand=品牌"]) {
          const start = calls.length;
          const agent = await csv(request(domain, range, `&agent=1${extra}`), context);
          assert.equal(agent.status, 200); assert.match(agent.headers.get("Content-Disposition")!, /-agent\.csv/);
          assert.ok(calls.length > start);
          for (const sql of calls.slice(start)) {
            assert.doesNotMatch(sql.text, /ratingCount" IS NOT NULL|ratingCountMin|sellfox_listing_current|AS facets/);
          }
        }
      }
      for (const range of ["ratingCountMin=1.5", "ratingCountMax=abc", "ratingCountMin=10&ratingCountMax=1"]) {
        for (const handler of [browse, csv]) {
          calls.length = 0;
          const response = await handler(request(domain, range), context);
          assert.equal(response.status, 400); assert.equal(calls.length, 0);
        }
      }
    }
  } finally {
    globals.prisma = previous;
    for (const [key, value] of Object.entries(env)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

