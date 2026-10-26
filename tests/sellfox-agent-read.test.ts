import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { inventoryNarrow, listingNarrow } from "@/lib/sellfox/narrow-contracts";
import { parseSellfoxAdProductReport, sellfoxReportDownloadUrl } from "@/lib/sellfox/ads-report-contract";
import type { Prisma, PrismaClient } from "@prisma/client";
import { sellfoxBrowseQuery } from "@/lib/sellfox/browse-query";
import { readSellfoxAgentRows, sellfoxAgentCsv, sellfoxAgentColumns } from "@/lib/sellfox/agent-read";
import { defaultSellfoxBackfillStart, sellfoxBackfillWindow, nextSellfoxScheduleAt } from "@/lib/sellfox/schedule-time";
import { syncSellfoxListings, type ListingCheckpoint } from "@/lib/sellfox/listing-sync";
import listing from "./fixtures/sellfox/listing-page.json";
import type { sellfoxPost } from "@/lib/sellfox/client";
const headers = ["店铺", "日期", "asin", "sku", "广告活动ID", "广告组ID", "广告产品ID", "广告曝光量", "广告点击量", "广告花费", "广告订单量", "广告销售额"];
async function report(rows: unknown[][], columns = headers) {
  const workbook = new ExcelJS.Workbook(); const sheet = workbook.addWorksheet("sheet");
  sheet.addRow(columns); rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
const values = ["fixture-store", new Date("2026-10-24T00:00:00Z"), "asin", "msku", "campaign", "group", "product", 100, 0, 0, null, null];
const scope = { storeName: "fixture-store", startDate: "2026-10-24", endDate: "2026-10-24" };
test("narrow mappings preserve missing vs zero and never mistake listing quantity for FBA available", () => {
  assert.equal(inventoryNarrow({ totalInventory: "0" }).totalInventory, 0);
  assert.equal(inventoryNarrow({}).inTransit, null);
  assert.throws(() => inventoryNarrow({ inTransit: "unknown" }));
  const row = listingNarrow(listing.rows[0], "shop-fixture");
  assert.equal(row.fulfillable, 0); assert.equal(row.msku, "MSKU-FIXTURE"); assert.equal(row.sales7, 2);
  assert.equal(listingNarrow({ ...listing.rows[0], inventoryManage: null }, "shop-fixture").fulfillable, null);
  assert.throws(() => listingNarrow(listing.rows[0], "foreign"));
});
test("verified product report columns retain null conversions, reject scope drift, duplicate identities and formulas", async () => {
  const [row] = await parseSellfoxAdProductReport(await report([values]), scope);
  assert.equal(row.cost, 0); assert.equal(row.adOrders, null); assert.equal(row.adSales, null); assert.equal(row.currency, null);
  await assert.rejects(async () => parseSellfoxAdProductReport(await report([values]), { ...scope, storeName: "foreign" }), /店铺/);
  await assert.rejects(async () => parseSellfoxAdProductReport(await report([values, values]), scope), /重复实体/);
  await assert.rejects(async () => parseSellfoxAdProductReport(await report([[...values.slice(0, 9), { formula: "1+1", result: 2 }, null, null]]), scope), /公式/);
  await assert.rejects(async () => parseSellfoxAdProductReport(await report([values], headers.slice(1)), scope), /缺少/);
  await assert.rejects(async () => parseSellfoxAdProductReport(await report([values]), { ...scope, endDate: "2026-10-23" }), /日期/);
});
test("verified deleted Listing keeps missing MSKU null while active rows and foreign identities still fail closed", () => {
  const row = { ...listing.rows[0], sku: "", onlineStatus: "delete" };
  const deleted = listingNarrow(row, "shop-fixture");
  assert.equal(deleted.msku, null); assert.equal(deleted.asin, "ASIN-FIXTURE");
  assert.equal(deleted.sourceKey, "listing-fixture");
  for (const patch of [{ onlineStatus: "Active" }, { onlineStatus: "Incomplete" }, { asin: "" }, { id: "" }, { shopId: "foreign" }]) assert.throws(() => listingNarrow({ ...row, ...patch }, "shop-fixture"));
});
test("download URLs cannot redirect into credentials, local addresses or an unverified host", () => {
  assert.equal(sellfoxReportDownloadUrl("https://s1.sellfox.com/file.xlsx").hostname, "s1.sellfox.com");
  for (const url of ["http://s1.sellfox.com/a", "https://127.0.0.1/a", "https://s1.sellfox.com.evil.test/a", "https://user:secret@s1.sellfox.com/a", "https://s1.sellfox.com:444/a"]) assert.throws(() => sellfoxReportDownloadUrl(url));
});
test("SB/SD uppercase identity columns preserve raw headers, accept empty exports, reject ambiguous aliases", async () => {
  const uppercase = headers.map((key) => key === "asin" || key === "sku" ? key.toUpperCase() : key);
  const [row] = await parseSellfoxAdProductReport(await report([values], uppercase), scope);
  assert.equal(row.asin, "asin"); assert.equal(row.msku, "msku");
  assert.equal(row.payload.ASIN, "asin"); assert.equal(row.payload.asin, undefined);
  assert.deepEqual(await parseSellfoxAdProductReport(await report([], uppercase), scope), []);
  await assert.rejects(async () => parseSellfoxAdProductReport(await report([values], [...uppercase, "asin"]), scope), /重复列/);
});
test("agent CSV has stable narrow headers, escapes formulas, and never emits payload", () => {
  const csv = sellfoxAgentCsv("sales", [{ msku: "=formula", payload: { token: "secret" }, quantity: 0, complete: false }]);
  assert.match(csv, /'=formula/); assert.doesNotMatch(csv, /payload|secret/);
  assert.ok(sellfoxAgentColumns.sales.includes("complete"));
});
test("winter backfill is bounded and persistent, while all new daily plans share Shanghai 06:30", () => {
  assert.equal(defaultSellfoxBackfillStart(new Date("2026-10-25T00:00:00Z")), "2025-11-01");
  assert.equal(defaultSellfoxBackfillStart(new Date("2026-01-10T00:00:00Z")), "2024-11-01");
  assert.deepEqual(sellfoxBackfillWindow("2025-11-01", "2026-10-24"), { backfillFrom: "2025-11-01", backfillTo: "2025-11-07" });
  assert.deepEqual(sellfoxBackfillWindow("2026-10-23", "2026-10-24", 90), { backfillFrom: "2026-10-23", backfillTo: "2026-10-24" });
  assert.deepEqual(sellfoxBackfillWindow("2026-10-25", "2026-10-24"), {});
  assert.throws(() => sellfoxBackfillWindow("2025-11-01", "2026-10-24", 91));
  for (const resource of ["listings", "ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"]) assert.equal(nextSellfoxScheduleAt({ resource, intervalMinutes: 1440, lastEnqueuedAt: null }, new Date("2026-10-24T22:29:00Z")).toISOString(), "2026-10-24T22:30:00.000Z");
});
test("listing transaction failure cannot publish current; retry reuses capture and complete empty capture clears current", async () => {
  let head: string | null = null; let count = 0; let fail = true; let empty = false; let checkpoint: ListingCheckpoint | undefined;
  const db = { sellfoxStore: { findMany: async () => [{ id: "store", externalId: "shop-fixture" }] }, $transaction: async (callback: (tx: unknown) => Promise<void>) => {
    let pending = 0; let published = head;
    await callback({ sellfoxListingSnapshot: { upsert: async () => { pending++; } }, sellfoxSnapshotHead: { upsert: async ({ create }: { create: { capturedAt: Date } }) => { published = create.capturedAt.toISOString(); } } });
    if (fail) { fail = false; throw Error("private database details"); }
    count += pending; head = published;
  } } as unknown as NonNullable<Parameters<typeof syncSellfoxListings>[1]>["db"];
  const post = (async () => empty ? { pageNo: 1, pageSize: 100, totalPage: 0, totalSize: 0, rows: [] } : listing) as typeof sellfoxPost;
  const input = { organizationId: "org", workspaceId: "workspace", shopExternalIds: ["shop-fixture"], capturedAt: "2026-10-25T00:00:00Z", onProgress: async (state: ListingCheckpoint, tx?: unknown) => { if (!tx) checkpoint = structuredClone(state); } };
  await assert.rejects(() => syncSellfoxListings(input, { db, post }));
  assert.equal(head, null); assert.equal(count, 0); assert.doesNotMatch(JSON.stringify(checkpoint), /private/);
  await syncSellfoxListings({ ...input, checkpoint }, { db, post }); assert.equal(head, new Date(input.capturedAt).toISOString()); assert.equal(count, 1);
  empty = true;
  await syncSellfoxListings({ ...input, capturedAt: "2026-10-25T03:00:00Z" }, { db, post }); assert.equal(head, "2026-10-25T03:00:00.000Z"); assert.equal(count, 1);
});

// Sales metadata adds a scoped lateral join; compare only the outer fact predicates.
function factWhere(sql: Prisma.Sql) {
  const marker = " l ON TRUE WHERE ";
  const start = sql.text.includes(marker) ? sql.text.indexOf(marker) + marker.length : sql.text.indexOf(" WHERE ") + 7;
  const end = sql.text.startsWith("SELECT count") ? -1 : sql.text.lastIndexOf(" ORDER BY ");
  return sql.text.slice(start, end > start ? end : undefined).replace(/\$\d+/g, "?");
}

test("agent listings rows, counts and export use optional openDate ranges; sales keeps reportDate and inventory ignores ranges", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const calls: Prisma.Sql[] = [];
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => { calls.push(sql); return sql.text.startsWith("SELECT count") ? [{ total: 0 }] : []; } } as unknown as PrismaClient;
  try {
    for (const domain of ["listings", "sales", "inventory"] as const) {
      for (const range of ["", "from=2024-01-15", "to=2024-02-20", "from=2024-01-15&to=2024-02-20"]) {
        const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}`), domain);
        calls.length = 0;
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" });
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" }, true);
        assert.equal(calls.length, 3);
        assert.equal(factWhere(calls[0]), factWhere(calls[1]));
        assert.equal(factWhere(calls[0]), factWhere(calls[2]));
        for (const sql of calls) {
          for (const [date, operator] of [[query.from, ">="], [query.to, "<="]] as const) {
            const openDate = new RegExp(`s\\."openDate"${operator}\\$(\\d+)`);
            const reportDate = new RegExp(`"reportDate"${operator}\\$(\\d+)`);
            if (domain === "inventory" || !date) {
              assert.doesNotMatch(sql.text, openDate);
              assert.doesNotMatch(sql.text, reportDate);
              continue;
            }
            const match = sql.text.match(domain === "listings" ? openDate : reportDate);
            assert.ok(match);
            assert.equal(sql.values[Number(match[1]) - 1], date);
            assert.doesNotMatch(sql.text, domain === "listings" ? reportDate : openDate);
          }
        }
      }
    }
  } finally { globals.prisma = previous; }
});

test("agent rows, pagination counts and long-table export honor current Listing fulfillment", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const calls: Prisma.Sql[] = [];
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => { calls.push(sql); return sql.text.startsWith("SELECT count") ? [{ total: 0 }] : []; } } as unknown as PrismaClient;
  try {
    for (const domain of ["sales", "performance", "listings"] as const) {
      for (const fulfillment of ["AFN", "MFN"]) {
        const query = sellfoxBrowseQuery(new URL(`http://localhost/?fulfillment=${fulfillment}&onlySettle=1`));
        calls.length = 0;
        const result = await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" });
        assert.equal(result.pagination.total, 0);
        assert.equal(calls.length, 2);
        assert.equal(factWhere(calls[0]), factWhere(calls[1]));
        assert.deepEqual(calls[0].values.slice(domain === "sales" ? 2 : 0, -2), calls[1].values);
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" }, true);
        for (const sql of calls) {
          if (domain === "listings") {
            assert.doesNotMatch(sql.text, /payload|candidate/);
            assert.ok(sql.text.includes("s.fulfillment="));
            assert.ok(sql.values.includes(fulfillment));
            continue;
          }
          assert.match(sql.text, /FROM sellfox_listing_current candidate/); assert.doesNotMatch(sql.text, /payload|JOIN "SellfoxListingSnapshot"/);
          assert.match(sql.text, /candidate\."organizationId"=[\s\S]*candidate\."workspaceId"=/);
          assert.match(sql.text, /candidate\."storeId"=s\."storeId"/);
          assert.match(sql.text, /LIMIT 1\)=\$\d+/);
          assert.ok(sql.values.includes(fulfillment));
          assert.match(sql.text, /candidate.msku=s.msku[\s\S]*candidate.asin=s.asin/);
        }
      }
    }
  } finally { globals.prisma = previous; }
});

test("agent Buy Box rows, counts and export match only real booleans on the chosen current Listing", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const calls: Prisma.Sql[] = [];
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => { calls.push(sql); return sql.text.startsWith("SELECT count") ? [{ total: 0 }] : []; } } as unknown as PrismaClient;
  try {
    for (const domain of ["sales", "performance", "listings"] as const) {
      for (const buyBox of ["yes", "no"] as const) {
        const query = sellfoxBrowseQuery(new URL(`http://localhost/?buyBox=${buyBox}&onlySettle=1`));
        calls.length = 0;
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" });
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" }, true);
        assert.equal(calls.length, 3);
        for (const sql of calls) {
          if (domain === "listings") {
            assert.doesNotMatch(sql.text, /payload|candidate/);
            assert.ok(sql.text.includes("s.\"buyBoxWinner\"="));
            assert.ok(sql.values.includes(buyBox === "yes" ? "是" : "否"));
            continue;
          }
          assert.match(sql.text, /SELECT candidate\."buyBoxWinner"/);
          assert.doesNotMatch(sql.text, /p.payload->>'buyBoxWinner'/);
          assert.match(sql.text, /FROM sellfox_listing_current candidate/); assert.doesNotMatch(sql.text, /payload|JOIN "SellfoxListingSnapshot"/);
          assert.match(sql.text, /candidate\."organizationId"=[\s\S]*candidate\."workspaceId"=/);
          assert.match(sql.text, /candidate\."storeId"=s\."storeId"/);
          const parameter = sql.text.match(/ORDER BY CASE WHEN s.msku IS NOT NULL AND candidate.msku=s.msku THEN 0 ELSE 1 END,candidate.msku NULLS LAST,candidate.asin,candidate.id LIMIT 1\)=\$(\d+)/);
          assert.ok(parameter); assert.equal(sql.values[Number(parameter[1]) - 1], buyBox === "yes" ? "是" : "否");
          assert.ok(sql.values.includes("org") && sql.values.includes("ws"));
          assert.match(sql.text, /candidate.msku=s.msku[\s\S]*candidate.asin=s.asin/);
        }
        assert.equal(factWhere(calls[0]), factWhere(calls[1]));
        assert.deepEqual(calls[0].values.slice(domain === "sales" ? 2 : 0, -2), calls[1].values);
      }
      calls.length = 0;
      await readSellfoxAgentRows(domain, sellfoxBrowseQuery(new URL("http://localhost/?buyBox=")), { organizationId: "org", workspaceId: "ws" });
      for (const sql of calls) assert.doesNotMatch(factWhere(sql), /buyBoxWinner|sellfox_listing_current candidate/);
    }
    for (const domain of ["inventory", "ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"] as const) {
      calls.length = 0;
      await readSellfoxAgentRows(domain, sellfoxBrowseQuery(new URL("http://localhost/?buyBox=yes")), { organizationId: "org", workspaceId: "ws" });
      for (const sql of calls) { assert.doesNotMatch(sql.text, /buyBoxWinner/); assert.ok(!sql.values.includes("yes")); }
    }
  } finally { globals.prisma = previous; }
});

test("agent brand matches the selected scoped current Listing after MSKU-first/ASIN-fallback selection", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const calls: Prisma.Sql[] = [];
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => { calls.push(sql); return sql.text.startsWith("SELECT count") ? [{ total: 0 }] : []; } } as unknown as PrismaClient;
  try {
    for (const domain of ["sales", "performance", "listings"] as const) {
      for (const brand of ["Goghost-乐器", "Nvaav", "%' OR TRUE--"]) {
        calls.length = 0;
        const query = sellfoxBrowseQuery(new URL(`http://localhost/?${new URLSearchParams({ brand: ` ${brand} ` })}`));
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" });
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" }, true);
        assert.equal(calls.length, 3);
        for (const sql of calls) {
          if (domain === "listings") {
            assert.doesNotMatch(sql.text, /payload|candidate/);
            assert.ok(sql.text.includes("s.brand="));
            assert.ok(sql.values.includes(brand));
            continue;
          }
          assert.match(sql.text, /SELECT candidate.brand/);
          assert.match(sql.text, /FROM sellfox_listing_current candidate/); assert.doesNotMatch(sql.text, /payload|JOIN "SellfoxListingSnapshot"/);
          assert.match(sql.text, /candidate\."organizationId"=\$\d+ AND candidate\."workspaceId"=\$\d+/);
          assert.match(sql.text, /candidate\."storeId"=s\."storeId"/);
          const parameter = sql.text.match(/ORDER BY CASE WHEN s.msku IS NOT NULL AND candidate.msku=s.msku THEN 0 ELSE 1 END,candidate.msku NULLS LAST,candidate.asin,candidate.id LIMIT 1\)=\$(\d+)/);
          assert.ok(parameter); assert.equal(sql.values[Number(parameter[1]) - 1], brand);
          assert.ok(sql.values.includes("org") && sql.values.includes("ws"));
          assert.match(sql.text, /candidate.msku=s.msku[\s\S]*candidate.asin=s.asin/);
          assert.doesNotMatch(sql.text, /amazonBrand|btrim\(p.payload->>'brand'\)\s*=/);
          assert.ok(!sql.values.includes(`%${brand}%`));
        }
        assert.equal(factWhere(calls[0]), factWhere(calls[1]));
        assert.deepEqual(calls[0].values.slice(domain === "sales" ? 2 : 0, -2), calls[1].values);
      }
      for (const brand of ["", "   "]) {
        calls.length = 0;
        await readSellfoxAgentRows(domain, sellfoxBrowseQuery(new URL(`http://localhost/?brand=${brand}`)), { organizationId: "org", workspaceId: "ws" });
        for (const sql of calls) assert.doesNotMatch(factWhere(sql), /payload->>'brand'|sellfox_listing_current candidate/);
      }
    }
    for (const domain of ["inventory", "ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"] as const) {
      calls.length = 0;
      await readSellfoxAgentRows(domain, sellfoxBrowseQuery(new URL("http://localhost/?brand=ignored")), { organizationId: "org", workspaceId: "ws" });
      for (const sql of calls) { assert.doesNotMatch(sql.text, /payload->>'brand'/); assert.ok(!sql.values.includes("ignored")); }
    }
  } finally { globals.prisma = previous; }
});

test("agent productTag membership uses the selected scoped Listing before matching exact label names", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const calls: Prisma.Sql[] = [];
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => { calls.push(sql); return sql.text.startsWith("SELECT count") ? [{ total: 0 }] : []; } } as unknown as PrismaClient;
  try {
    for (const domain of ["sales", "performance", "listings"] as const) {
      calls.length = 0;
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?${new URLSearchParams({ productTag: "1年以内产品、完整标签" })}`));
      await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" });
      await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" }, true);
      assert.equal(calls.length, 3);
      for (const sql of calls) {
          if (domain === "listings") {
            assert.doesNotMatch(sql.text, /payload|candidate/);
            assert.ok(sql.text.includes("s.\"productTagNames\" @> ARRAY["));
            assert.ok(sql.values.includes(query.productTag));
            continue;
          }
        assert.match(sql.text, /SELECT candidate\."productTagNames"/); assert.doesNotMatch(sql.text, /payload|JOIN "SellfoxListingSnapshot"/);
        assert.match(sql.text, /LIMIT 1\) @> ARRAY\[\$\d+\]::text\[\]/);
        assert.match(sql.text, /candidate\."storeId"=s\."storeId"/);
        assert.ok(sql.values.includes("org")); assert.ok(sql.values.includes("ws"));
        assert.ok(sql.values.includes(query.productTag)); assert.ok(!sql.values.includes(`%${query.productTag}%`));
        assert.match(sql.text, /candidate.msku=s.msku[\s\S]*candidate.asin=s.asin/);
      }
      assert.equal(factWhere(calls[0]), factWhere(calls[1]));
      assert.deepEqual(calls[0].values.slice(domain === "sales" ? 2 : 0, -2), calls[1].values);
    }
  } finally { globals.prisma = previous; }
});

test("inventory current sorts in SQL before pagination and rejects unavailable narrow fields", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }; const previous = globals.prisma;
  const calls: Prisma.Sql[] = [];
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => { calls.push(sql); return sql.text.includes("count(*)") ? [{ total: 51 }] : []; } } as unknown as PrismaClient;
  try {
    const query = sellfoxBrowseQuery(new URL("http://localhost/?sortBy=quantity&sortOrder=desc&page=2&pageSize=20&site=US"), "inventory");
    await readSellfoxAgentRows("inventory", query, { organizationId: "org", workspaceId: "ws" });
    assert.match(calls[0].text, /ORDER BY "quantity" DESC NULLS LAST, id ASC LIMIT/);
    assert.deepEqual(calls[0].values.slice(-2), [20, 20]);
    assert.ok(calls[0].values.includes("US"));
    await assert.rejects(() => readSellfoxAgentRows("inventory", { ...query, sortBy: "payload" }, { organizationId: "org", workspaceId: "ws" }), /排序/);
  } finally { globals.prisma = previous; }
});


test("agent salesperson containment uses only typed performance column including export and count", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const calls: Prisma.Sql[] = [];
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => { calls.push(sql); return sql.text.startsWith("SELECT count") ? [{ total: 0 }] : []; } } as unknown as PrismaClient;
  try {
    const query = sellfoxBrowseQuery(new URL("http://localhost/?salesperson=" + encodeURIComponent("温见清")));
    for (const domain of ["performance", "sales", "listings", "ads_report"] as const) {
      calls.length = 0;
      await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" });
      await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" }, true);
      for (const sql of calls) {
        if (domain === "performance") { assert.match(sql.text, /s\."userNameList" @> ARRAY\[\$\d+\]::text\[\]/); assert.ok(sql.values.includes("温见清")); }
        else { assert.doesNotMatch(sql.text, /userNameList/); assert.ok(!sql.values.includes("温见清")); }
        assert.doesNotMatch(sql.text, /payload/);
      }
    }
  } finally { globals.prisma = previous; }
});

test("Agent extra performance fees use typed profit view columns, numeric CSV and safe sorting", async () => {
  const keys = ["headTripPrice", "avgPurchaseCost", "amazonCommissionPrice"];
  assert.deepEqual(sellfoxAgentColumns.performance.slice(-76, -73), keys);
  const csv = sellfoxAgentCsv("performance", [{ headTripPrice: 0, avgPurchaseCost: 2.5, amazonCommissionPrice: -3 }, {}]);
  assert.ok(csv.split("\r\n")[0].includes('"headTripPrice","avgPurchaseCost","amazonCommissionPrice","evaluationSaleNum","channelSaleNum",'));
  assert.ok(csv.split("\r\n")[1].endsWith('0,2.5,-3,"","","","","","","","","","","","","","","","",""' + "," + Array(56).fill('""').join(",")));
  assert.ok(csv.split("\r\n")[2].endsWith('"","","","","","","","",""' + "," + Array(56).fill('""').join(",")));
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => {
    assert.match(sql.text, /FROM sellfox_profit_daily s/);
    assert.doesNotMatch(sql.text, /payload|headTripCost|purchaseCost|referralFee/);
    if (!sql.text.includes("count(*)")) assert.match(sql.text, /ORDER BY "(?:headTripPrice|avgPurchaseCost|amazonCommissionPrice)" DESC NULLS LAST, id ASC LIMIT/);
    if (!sql.text.includes("count(*)")) for (const key of keys) assert.ok(sql.text.includes(`"${key}"`));
    return sql.text.includes("count(*)") ? [{ total: 1 }] : [{ headTripPrice: 0, avgPurchaseCost: 2.5, amazonCommissionPrice: -3 }];
  } } as unknown as PrismaClient;
  try {
    for (const key of keys) for (const exporting of [false, true]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?sortBy=${key}&sortOrder=desc&reportDate=2026-10-25`), "performance");
      const result = await readSellfoxAgentRows("performance", query, { organizationId: "org", workspaceId: "ws" }, exporting);
      assert.equal(result.rows[0][key], key === "headTripPrice" ? 0 : key === "avgPurchaseCost" ? 2.5 : -3);
    }
  } finally { globals.prisma = previous; }
});

test("sales Agent appends typed current catalog columns with stable MSKU-first selection and SQL sorting", async () => {
  assert.deepEqual(sellfoxAgentColumns.sales.slice(-4), ["orders", "brand", "productTags", "price"]);
  const csv = sellfoxAgentCsv("sales", [{ brand: "品牌", productTags: "新品、重点", price: 0 }, {}]);
  assert.ok(csv.split("\r\n")[0].endsWith('"orders","brand","productTags","price"'));
  assert.ok(csv.split("\r\n")[1].endsWith('"品牌","新品、重点",0'));
  assert.ok(csv.split("\r\n")[2].endsWith('"","",""'));
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const calls: Prisma.Sql[] = [];
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => { calls.push(sql); return sql.text.startsWith("SELECT count") ? [{ total: 1 }] : [{ brand: "品牌", productTags: "新品、重点", price: 0 }]; } } as unknown as PrismaClient;
  try {
    for (const key of ["brand", "productTags", "price"]) for (const exporting of [false, true]) {
      calls.length = 0;
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?from=2026-10-24&to=2026-10-24&sortBy=${key}&sortOrder=desc`), "sales");
      const result = await readSellfoxAgentRows("sales", query, { organizationId: "org", workspaceId: "ws" }, exporting);
      assert.equal(result.rows[0].price, 0);
      const sql = calls[0];
      assert.match(sql.text, /LEFT JOIN LATERAL[\s\S]*candidate\."storeId"=s\."storeId"/);
      assert.match(sql.text, /candidate\."organizationId"=\$\d+ AND candidate\."workspaceId"=\$\d+/);
      assert.match(sql.text, /ORDER BY CASE WHEN s.msku IS NOT NULL AND candidate.msku=s.msku THEN 0 ELSE 1 END,candidate.msku NULLS LAST,candidate.asin,candidate.id LIMIT 1/);
      assert.ok(sql.text.includes(`ORDER BY "${key}" DESC NULLS LAST, id ASC LIMIT`));
      assert.doesNotMatch(sql.text, /payload|userNameList/);
    }
  } finally { globals.prisma = previous; }
});

test("Agent appends profit evaluation and channel quantities with null empty, zero preserved and safe sort", async () => {
  const keys = ["evaluationSaleNum", "channelSaleNum"];
  assert.deepEqual(sellfoxAgentColumns.performance.slice(-73, -71), keys);
  assert.ok(keys.every(key => !(sellfoxAgentColumns.sales as readonly string[]).includes(key)));
  const csv = sellfoxAgentCsv("performance", [{ evaluationSaleNum: 0, channelSaleNum: 1 }, { evaluationSaleNum: 2, channelSaleNum: 0 }, { evaluationSaleNum: null, channelSaleNum: null }]);
  assert.ok(csv.split("\r\n")[0].includes('"evaluationSaleNum","channelSaleNum",'));
  assert.ok(csv.split("\r\n")[1].endsWith('0,1,"","","","","","","","","","","","","","",""' + "," + Array(56).fill('""').join(",")));
  assert.ok(csv.split("\r\n")[2].endsWith('2,0,"","","","","","","","","","","","","","",""' + "," + Array(56).fill('""').join(",")));
  assert.ok(csv.split("\r\n")[3].endsWith('"","","","","","","",""' + "," + Array(56).fill('""').join(",")));
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => {
    assert.match(sql.text, /FROM sellfox_profit_daily s/);
    assert.doesNotMatch(sql.text, /payload/);
    if (!sql.text.includes("count(*)")) assert.match(sql.text, /ORDER BY "(?:evaluationSaleNum|channelSaleNum)" (?:ASC|DESC) NULLS LAST, id ASC LIMIT/);
    return sql.text.includes("count(*)") ? [{ total: 2 }] : [{ evaluationSaleNum: 0, channelSaleNum: 1 }, { evaluationSaleNum: null, channelSaleNum: null }];
  } } as unknown as PrismaClient;
  try {
    for (const key of keys) for (const exporting of [false, true]) for (const sortOrder of ["asc", "desc"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?sortBy=${key}&sortOrder=${sortOrder}&reportDate=2026-10-25`), "performance");
      const result = await readSellfoxAgentRows("performance", query, { organizationId: "org", workspaceId: "ws" }, exporting);
      assert.deepEqual(result.rows.map(row => keys.map(key => row[key])), [[0, 1], [null, null]]);
    }
  } finally { globals.prisma = previous; }
});

test("Agent appends optional ad channel costs with typed sorting, zero and NULL CSV", async () => {
  const keys = ["adSpCost", "adSdCost", "adSbCost", "adSbvCost", "adSbsCost"];
  assert.deepEqual(sellfoxAgentColumns.performance.slice(-71, -66), keys);
  assert.ok(keys.every(key => !(sellfoxAgentColumns.sales as readonly string[]).includes(key)));
  assert.ok(!(sellfoxAgentColumns.performance as readonly string[]).includes("adTotalCost"));
  const rows = [{ adSpCost: 0, adSdCost: 2.5, adSbCost: 4, adSbvCost: 5, adSbsCost: 6.75 }, {}];
  const csv = sellfoxAgentCsv("performance", rows).split("\r\n");
  assert.ok(csv[0].includes(keys.map(key => `"${key}"`).join(",")));
  assert.ok(csv[1].endsWith('0,2.5,4,5,6.75,"","","","","","","","","",""' + "," + Array(56).fill('""').join(",")));
  assert.ok(csv[2].endsWith('"","","","","","","","","","",""' + "," + Array(56).fill('""').join(",")));
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => {
    assert.match(sql.text, /FROM sellfox_profit_daily s/);
    assert.doesNotMatch(sql.text, /payload|adTotalCost/);
    if (!sql.text.includes("count(*)")) {
      for (const key of keys) assert.ok(sql.text.includes(`"${key}"`));
      assert.match(sql.text, /ORDER BY "ad(?:Sp|Sd|Sb|Sbv|Sbs)Cost" (?:ASC|DESC) NULLS LAST, id ASC LIMIT/);
    }
    return sql.text.includes("count(*)") ? [{ total: 2 }] : rows;
  } } as unknown as PrismaClient;
  try {
    for (const key of keys) for (const exporting of [false, true]) for (const sortOrder of ["asc", "desc"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?sortBy=${key}&sortOrder=${sortOrder}&reportDate=2026-10-25`), "performance");
      assert.deepEqual((await readSellfoxAgentRows("performance", query, { organizationId: "org", workspaceId: "ws" }, exporting)).rows, rows);
    }
  } finally { globals.prisma = previous; }
});

test("Agent appends optional FBA storage/removal/disposal fees with typed sorting, zero and NULL CSV", async () => {
  const keys = ["fbaStorageFeeAmount", "fbaLongTermStorageFeeAmount", "fbaRemovalFeeAmount", "fbaDisposalFeeAmount"];
  assert.deepEqual(sellfoxAgentColumns.performance.slice(-66, -62), keys);
  assert.ok(keys.every(key => !(sellfoxAgentColumns.sales as readonly string[]).includes(key)));
  assert.ok(!(sellfoxAgentColumns.performance as readonly string[]).includes("adTotalCost"));
  const rows = [{ fbaStorageFeeAmount: 0, fbaLongTermStorageFeeAmount: 2.5, fbaRemovalFeeAmount: 4, fbaDisposalFeeAmount: 5 }, {}];
  const csv = sellfoxAgentCsv("performance", rows).split("\r\n");
  assert.ok(csv[0].includes(keys.map(key => `"${key}"`).join(",")));
  assert.ok(csv[1].endsWith("0,2.5,4,5,\"\",\"\",\"\",\"\",\"\",\"\"" + "," + Array(56).fill('""').join(",")));
  assert.ok(csv[2].endsWith('"","","","","","","","","",""' + "," + Array(56).fill('""').join(",")));
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => {
    assert.match(sql.text, /FROM sellfox_profit_daily s/);
    assert.doesNotMatch(sql.text, /payload|adTotalCost/);
    if (!sql.text.includes("count(*)")) {
      for (const key of keys) assert.ok(sql.text.includes(`"${key}"`));
      assert.match(sql.text, /ORDER BY "fba(?:Storage|LongTermStorage|Removal|Disposal)FeeAmount" (?:ASC|DESC) NULLS LAST, id ASC LIMIT/);
    }
    return sql.text.includes("count(*)") ? [{ total: 2 }] : rows;
  } } as unknown as PrismaClient;
  try {
    for (const key of keys) for (const exporting of [false, true]) for (const sortOrder of ["asc", "desc"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?sortBy=${key}&sortOrder=${sortOrder}&reportDate=2026-10-25`), "performance");
      assert.deepEqual((await readSellfoxAgentRows("performance", query, { organizationId: "org", workspaceId: "ws" }, exporting)).rows, rows);
    }
  } finally { globals.prisma = previous; }
});

test("Agent appends optional custom/service/storage/compensation/evaluation fees with typed sorting, zero and NULL CSV", async () => {
  const keys = ["customAsinFee", "customShopFee", "serviceFeeAmount", "storageFeeAmount", "compensationAmount", "evaluationFee"];
  assert.deepEqual(sellfoxAgentColumns.performance.slice(-62, -56), keys);
  assert.ok(keys.every(key => !(sellfoxAgentColumns.sales as readonly string[]).includes(key)));
  assert.ok(!(sellfoxAgentColumns.performance as readonly string[]).includes("adTotalCost"));
  const rows = [Object.fromEntries(keys.map((key, i) => [key, [0, 2.5, 4, 5, 6, 7][i]])), Object.fromEntries(keys.map(key => [key, null]))];
  const csv = sellfoxAgentCsv("performance", rows).split("\r\n");
  assert.ok(csv[0].includes(keys.map(key => `"${key}"`).join(",")));
  assert.ok(csv[1].endsWith("0,2.5,4,5,6,7" + "," + Array(56).fill('""').join(",")));
  assert.ok(csv[2].endsWith('"","","","","",""' + "," + Array(56).fill('""').join(",")));
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => {
    assert.match(sql.text, /FROM sellfox_profit_daily s/);
    assert.doesNotMatch(sql.text, /payload|adTotalCost/);
    if (!sql.text.includes("count(*)")) {
      for (const key of keys) assert.ok(sql.text.includes(`"${key}"`));
      assert.match(sql.text, /ORDER BY "(?:customAsinFee|customShopFee|serviceFeeAmount|storageFeeAmount|compensationAmount|evaluationFee)" (?:ASC|DESC) NULLS LAST, id ASC LIMIT/);
    }
    return sql.text.includes("count(*)") ? [{ total: 2 }] : rows;
  } } as unknown as PrismaClient;
  try {
    for (const key of keys) for (const exporting of [false, true]) for (const sortOrder of ["asc", "desc"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?sortBy=${key}&sortOrder=${sortOrder}&reportDate=2026-10-25`), "performance");
      assert.deepEqual((await readSellfoxAgentRows("performance", query, { organizationId: "org", workspaceId: "ws" }, exporting)).rows, rows);
    }
  } finally { globals.prisma = previous; }
});

test("Agent appends optional promo/overage/chargeback/claim/dsf/other/buyer/regulatory fees with typed sorting, zero and NULL CSV", async () => {
  const keys = ["promotionTotalAmount", "fbaOverageFeeAmount", "chargebackAmount", "guaranteeClaimAmount", "digitalServicesFeeAmount", "otherPriceAmount", "shippingChargeAmount", "regulatoryFeeAmount"];
  assert.deepEqual(sellfoxAgentColumns.performance.slice(-56, -48), keys);
  assert.ok(keys.every(key => !(sellfoxAgentColumns.sales as readonly string[]).includes(key)));
  assert.ok(!(sellfoxAgentColumns.performance as readonly string[]).includes("adTotalCost"));
  const rows = [Object.fromEntries(keys.map((key, i) => [key, [0, 2.5, 4, 5, 6, 7, 8, 9][i]])), Object.fromEntries(keys.map(key => [key, null]))];
  const csv = sellfoxAgentCsv("performance", rows).split("\r\n");
  assert.ok(csv[0].endsWith(keys.map(key => `"${key}"`).join(",") + "," + sellfoxAgentColumns.performance.slice(-48).map(key => `"${key}"`).join(",")));
  assert.ok(csv[1].endsWith("0,2.5,4,5,6,7,8,9" + "," + Array(48).fill('""').join(",")));
  assert.ok(csv[2].endsWith(Array(56).fill('""').join(",")));
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => {
    assert.match(sql.text, /FROM sellfox_profit_daily s/);
    assert.doesNotMatch(sql.text, /payload|adTotalCost/);
    if (!sql.text.includes("count(*)")) {
      for (const key of keys) assert.ok(sql.text.includes(`"${key}"`));
      assert.match(sql.text, /ORDER BY "(?:promotionTotalAmount|fbaOverageFeeAmount|chargebackAmount|guaranteeClaimAmount|digitalServicesFeeAmount|otherPriceAmount|shippingChargeAmount|regulatoryFeeAmount)" (?:ASC|DESC) NULLS LAST, id ASC LIMIT/);
    }
    return sql.text.includes("count(*)") ? [{ total: 2 }] : rows;
  } } as unknown as PrismaClient;
  try {
    for (const key of keys) for (const exporting of [false, true]) for (const sortOrder of ["asc", "desc"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?sortBy=${key}&sortOrder=${sortOrder}&reportDate=2026-10-25`), "performance");
      assert.deepEqual((await readSellfoxAgentRows("performance", query, { organizationId: "org", workspaceId: "ws" }, exporting)).rows, rows);
    }
  } finally { globals.prisma = previous; }
});

test("Agent appends contiguous coupon/deal/vine/star/sub/return/inbound and companion fees with typed sorting, zero and NULL CSV", async () => {
  const keys = ["couponPaymentAmount", "sellerDealPaymentAmount", "vineFeeAmount", "starStorageFeeAmount", "subscriptionAmount", "fbaCustomerReturnAmount", "fbaInboundConvenienceFeeAmount", "inboundTransportationFeeAmount", "shippingChargebackAmount", "giftwrapChargebackAmount", "costOfPointsGrantedAmount", "orderOtherPriceAmount"];
  assert.deepEqual(sellfoxAgentColumns.performance.slice(-48, -36), keys);
  assert.ok(keys.every(key => !(sellfoxAgentColumns.sales as readonly string[]).includes(key)));
  assert.ok(!(sellfoxAgentColumns.performance as readonly string[]).includes("adTotalCost"));
  const rows = [Object.fromEntries(keys.map((key, i) => [key, [0, 2.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13][i]])), Object.fromEntries(keys.map(key => [key, null]))];
  const csv = sellfoxAgentCsv("performance", rows).split("\r\n");
  assert.ok(csv[0].endsWith([...keys, ...sellfoxAgentColumns.performance.slice(-36)].map(key => `"${key}"`).join(",")));
  assert.ok(csv[1].endsWith("0,2.5,4,5,6,7,8,9,10,11,12,13," + Array(36).fill('""').join(",")));
  assert.ok(csv[2].endsWith(keys.map(() => '""').join(",")));
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => {
    assert.match(sql.text, /FROM sellfox_profit_daily s/);
    assert.doesNotMatch(sql.text, /payload|adTotalCost/);
    if (!sql.text.includes("count(*)")) {
      for (const key of keys) assert.ok(sql.text.includes(`"${key}"`));
      assert.match(sql.text, /ORDER BY "(?:couponPaymentAmount|sellerDealPaymentAmount|vineFeeAmount|starStorageFeeAmount|subscriptionAmount|fbaCustomerReturnAmount|fbaInboundConvenienceFeeAmount|inboundTransportationFeeAmount|shippingChargebackAmount|giftwrapChargebackAmount|costOfPointsGrantedAmount|orderOtherPriceAmount)" (?:ASC|DESC) NULLS LAST, id ASC LIMIT/);
    }
    return sql.text.includes("count(*)") ? [{ total: 2 }] : rows;
  } } as unknown as PrismaClient;
  try {
    for (const key of keys) for (const exporting of [false, true]) for (const sortOrder of ["asc", "desc"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?sortBy=${key}&sortOrder=${sortOrder}&reportDate=2026-10-25`), "performance");
      assert.deepEqual((await readSellfoxAgentRows("performance", query, { organizationId: "org", workspaceId: "ws" }, exporting)).rows, rows);
    }
  } finally { globals.prisma = previous; }
});

test("Agent appends next inbound/agl/paid/hrr/upstream/mfn/adjustment/other/avg/refund/liquidation fees with typed sorting, zero and NULL CSV", async () => {
  const keys = ["fbaInboundTransportationProgramFee", "aglFeeAmount", "paidServicesFeeAmount", "customerReturnHrrUnitFeeAmount", "amazonUpstreamStorageTransportationFeeAmount", "amazonUpstreamProcessingFeeAmount", "mfnPostageFeeAmount", "adjustmentFeeAmount", "otherServiceFeeAmount", "avgHeadTripPrice", "purchaseRefundPrice", "revenueAmount"];
  assert.deepEqual(sellfoxAgentColumns.performance.slice(-36, -24), keys);
  assert.ok(keys.every(key => !(sellfoxAgentColumns.sales as readonly string[]).includes(key)));
  assert.ok(!(sellfoxAgentColumns.performance as readonly string[]).includes("adTotalCost"));
  const rows = [Object.fromEntries(keys.map((key, i) => [key, [0, 2.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13][i]])), Object.fromEntries(keys.map(key => [key, null]))];
  const csv = sellfoxAgentCsv("performance", rows).split("\r\n");
  assert.ok(csv[0].endsWith([...keys, ...sellfoxAgentColumns.performance.slice(-24)].map(key => `"${key}"`).join(",")));
  assert.ok(csv[1].endsWith("0,2.5,4,5,6,7,8,9,10,11,12,13," + Array(24).fill('""').join(",")));
  assert.ok(csv[2].endsWith(keys.map(() => '""').join(",")));
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => {
    assert.match(sql.text, /FROM sellfox_profit_daily s/);
    assert.doesNotMatch(sql.text, /payload|adTotalCost/);
    if (!sql.text.includes("count(*)")) {
      for (const key of keys) assert.ok(sql.text.includes(`"${key}"`));
      assert.match(sql.text, /ORDER BY "(?:fbaInboundTransportationProgramFee|aglFeeAmount|paidServicesFeeAmount|customerReturnHrrUnitFeeAmount|amazonUpstreamStorageTransportationFeeAmount|amazonUpstreamProcessingFeeAmount|mfnPostageFeeAmount|adjustmentFeeAmount|otherServiceFeeAmount|avgHeadTripPrice|purchaseRefundPrice|revenueAmount)" (?:ASC|DESC) NULLS LAST, id ASC LIMIT/);
    }
    return sql.text.includes("count(*)") ? [{ total: 2 }] : rows;
  } } as unknown as PrismaClient;
  try {
    for (const key of keys) for (const exporting of [false, true]) for (const sortOrder of ["asc", "desc"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?sortBy=${key}&sortOrder=${sortOrder}&reportDate=2026-10-25`), "performance");
      assert.deepEqual((await readSellfoxAgentRows("performance", query, { organizationId: "org", workspaceId: "ws" }, exporting)).rows, rows);
    }
  } finally { globals.prisma = previous; }
});

test("Agent appends service refund/Tl deferred/tax/income/payment/closing/imaging/netCo/vat/cod fees with typed sorting, zero and NULL CSV", async () => {
  const keys = ["fbaPerUnitFulfillmentFeeRefundAmount", "fbaWeightBasedFeeRefundAmount", "deferredAmount", "withheldTaxAmount", "otherPriceIncomeAmount", "paymentMethodFeeAmount", "fixedClosingFeeAmount", "variableClosingFeeAmount", "imagingServicesFeeAmount", "netCoAmount", "comminglingVatAmount", "codFeeAmount"];
  assert.deepEqual(sellfoxAgentColumns.performance.slice(-24, -12), keys);
  assert.ok(keys.every(key => !(sellfoxAgentColumns.sales as readonly string[]).includes(key)));
  assert.ok(!(sellfoxAgentColumns.performance as readonly string[]).includes("adTotalCost"));
  const rows = [Object.fromEntries(keys.map((key, i) => [key, [0, 2.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13][i]])), Object.fromEntries(keys.map(key => [key, null]))];
  const csv = sellfoxAgentCsv("performance", rows).split("\r\n");
  assert.ok(csv[0].endsWith([...keys, ...sellfoxAgentColumns.performance.slice(-12)].map(key => `"${key}"`).join(",")));
  assert.ok(csv[1].endsWith("0,2.5,4,5,6,7,8,9,10,11,12,13," + Array(12).fill('""').join(",")));
  assert.ok(csv[2].endsWith(keys.map(() => '""').join(",")));
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => {
    assert.match(sql.text, /FROM sellfox_profit_daily s/);
    assert.doesNotMatch(sql.text, /payload|adTotalCost/);
    if (!sql.text.includes("count(*)")) {
      for (const key of keys) assert.ok(sql.text.includes(`"${key}"`));
      assert.match(sql.text, /ORDER BY "(?:fbaPerUnitFulfillmentFeeRefundAmount|fbaWeightBasedFeeRefundAmount|deferredAmount|withheldTaxAmount|otherPriceIncomeAmount|paymentMethodFeeAmount|fixedClosingFeeAmount|variableClosingFeeAmount|imagingServicesFeeAmount|netCoAmount|comminglingVatAmount|codFeeAmount)" (?:ASC|DESC) NULLS LAST, id ASC LIMIT/);
    }
    return sql.text.includes("count(*)") ? [{ total: 2 }] : rows;
  } } as unknown as PrismaClient;
  try {
    for (const key of keys) for (const exporting of [false, true]) for (const sortOrder of ["asc", "desc"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?sortBy=${key}&sortOrder=${sortOrder}&reportDate=2026-10-25`), "performance");
      assert.deepEqual((await readSellfoxAgentRows("performance", query, { organizationId: "org", workspaceId: "ws" }, exporting)).rows, rows);
    }
  } finally { globals.prisma = previous; }
});

test("Agent appends fee-wrap eval/deal/coupon/SAFE-T/income/promotion fees with typed sorting, zero and NULL CSV", async () => {
  const keys = ["evaluationCapital", "evaluationCommission", "dealPerformanceFeeAmount", "couponParticipationFeeAmount", "safetReimbursedAmount", "affordabilityExpenseAmount", "withheldFeeAmount", "chargebackIncomeAmount", "guaranteeClaimIncomeAmount", "promotionSalesAmount", "promotionShippingAmount", "promotionTaxAmount"];
  assert.deepEqual(sellfoxAgentColumns.performance.slice(-12), keys);
  assert.ok(keys.every(key => !(sellfoxAgentColumns.sales as readonly string[]).includes(key)));
  assert.ok(!(sellfoxAgentColumns.performance as readonly string[]).includes("adTotalCost"));
  const rows = [Object.fromEntries(keys.map((key, i) => [key, [0, 2.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13][i]])), Object.fromEntries(keys.map(key => [key, null]))];
  const csv = sellfoxAgentCsv("performance", rows).split("\r\n");
  assert.ok(csv[0].endsWith(keys.map(key => `"${key}"`).join(",")));
  assert.ok(csv[1].endsWith("0,2.5,4,5,6,7,8,9,10,11,12,13"));
  assert.ok(csv[2].endsWith(keys.map(() => '""').join(",")));
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => {
    assert.match(sql.text, /FROM sellfox_profit_daily s/);
    assert.doesNotMatch(sql.text, /payload|adTotalCost/);
    if (!sql.text.includes("count(*)")) {
      for (const key of keys) assert.ok(sql.text.includes(`"${key}"`));
      assert.match(sql.text, /ORDER BY "(?:evaluationCapital|evaluationCommission|dealPerformanceFeeAmount|couponParticipationFeeAmount|safetReimbursedAmount|affordabilityExpenseAmount|withheldFeeAmount|chargebackIncomeAmount|guaranteeClaimIncomeAmount|promotionSalesAmount|promotionShippingAmount|promotionTaxAmount)" (?:ASC|DESC) NULLS LAST, id ASC LIMIT/);
    }
    return sql.text.includes("count(*)") ? [{ total: 2 }] : rows;
  } } as unknown as PrismaClient;
  try {
    for (const key of keys) for (const exporting of [false, true]) for (const sortOrder of ["asc", "desc"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?sortBy=${key}&sortOrder=${sortOrder}&reportDate=2026-10-25`), "performance");
      assert.deepEqual((await readSellfoxAgentRows("performance", query, { organizationId: "org", workspaceId: "ws" }, exporting)).rows, rows);
    }
  } finally { globals.prisma = previous; }
});

test("agent DXM publish state filters listings rows/count/export exactly; other domains ignore it", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const calls: Prisma.Sql[] = [];
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => { calls.push(sql); return sql.text.startsWith("SELECT count") ? [{ total: 0 }] : []; } } as unknown as PrismaClient;
  try {
    for (const domain of ["listings", "sales", "inventory", "performance", "ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"] as const) {
      for (const dxmPublishState of ["", "   ", "delete", "future-state", "%' OR TRUE--"]) {
        const query = sellfoxBrowseQuery(new URL(`http://localhost/?${new URLSearchParams({ dxmPublishState: ` ${dxmPublishState} ` })}`), domain);
        calls.length = 0;
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" });
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" }, true);
        assert.equal(calls.length, 3);
        assert.equal(factWhere(calls[0]), factWhere(calls[1]));
        assert.equal(factWhere(calls[0]), factWhere(calls[2]));
        for (const sql of calls) {
          const match = sql.text.match(/s\."dxmPublishState"=\$(\d+)/);
          if (domain === "listings" && dxmPublishState.trim()) {
            assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], dxmPublishState);
            assert.ok(!sql.text.includes(dxmPublishState));
          } else { assert.equal(match, null); assert.ok(!sql.values.includes(dxmPublishState)); }
        }
      }
    }
  } finally { globals.prisma = previous; }
});

test("agent firstSaleDate ranges affect listings rows/count/export only and preserve other date semantics", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const calls: Prisma.Sql[] = [];
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => { calls.push(sql); return sql.text.startsWith("SELECT count") ? [{ total: 0 }] : []; } } as unknown as PrismaClient;
  try {
    for (const domain of ["listings", "sales", "inventory", "performance", "ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"] as const) {
      for (const range of ["", "firstSaleFrom=2024-02-01", "firstSaleTo=2024-03-01", "firstSaleFrom=2024-02-01&firstSaleTo=2024-03-01"]) {
        const query = sellfoxBrowseQuery(new URL(`http://localhost/?from=2023-01-01&to=2023-12-31&${range}`), domain);
        calls.length = 0;
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" });
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" }, true);
        assert.equal(calls.length, 3);
        assert.equal(factWhere(calls[0]), factWhere(calls[1]));
        assert.equal(factWhere(calls[0]), factWhere(calls[2]));
        for (const sql of calls) {
          for (const [value, pattern] of [[query.firstSaleFrom, /s\."firstSaleDate">=\$(\d+)/], [query.firstSaleTo, /s\."firstSaleDate"<=\$(\d+)/]] as const) {
            const match = sql.text.match(pattern);
            if (domain === "listings" && value) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
            else assert.equal(match, null);
          }
          assert.doesNotMatch(sql.text, /payload|firstOrderDate|COALESCE\(s\."firstSaleDate"|"firstSaleDate" IS NULL/);
          for (const [value, pattern] of domain === "listings"
            ? [[query.from, /s\."openDate">=\$(\d+)/], [query.to, /s\."openDate"<=\$(\d+)/]] as const
            : domain === "inventory" ? []
            : [[query.from, /"reportDate">=\$(\d+)/], [query.to, /"reportDate"<=\$(\d+)/]] as const) {
            const match = sql.text.match(pattern); assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value);
          }
          if (domain === "inventory") assert.doesNotMatch(sql.text, /"(?:openDate|reportDate)"[<>]=/);
        }
      }
    }
  } finally { globals.prisma = previous; }
});

test("agent totalInventory min/max affect listings rows/count/export only via inventory_current sum", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const calls: Prisma.Sql[] = [];
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => { calls.push(sql); return sql.text.startsWith("SELECT count") ? [{ total: 0 }] : []; } } as unknown as PrismaClient;
  try {
    for (const domain of ["listings", "sales", "inventory", "performance", "ads_report"] as const) {
      for (const range of ["", "totalInventoryMin=0", "totalInventoryMax=100", "totalInventoryMin=0&totalInventoryMax=100"]) {
        const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}`), domain);
        calls.length = 0;
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" });
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" }, true);
        assert.equal(calls.length, 3);
        for (const sql of calls) {
          const hasRange = domain === "listings" && (query.totalInventoryMin != null || query.totalInventoryMax != null);
          if (hasRange) {
            assert.match(sql.text, /EXISTS \(SELECT 1 FROM \(SELECT CASE WHEN count\(i\."totalInventory"\)=count\(\*\) THEN sum\(i\."totalInventory"\) END AS inv FROM sellfox_inventory_current i/);
            assert.match(sql.text, /stock\.inv IS NOT NULL/);
            for (const [value, pattern] of [[query.totalInventoryMin, /stock\.inv>=\$(\d+)/], [query.totalInventoryMax, /stock\.inv<=\$(\d+)/]] as const) {
              const match = sql.text.match(pattern);
              if (value != null) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
              else assert.equal(match, null);
            }
          } else {
            assert.doesNotMatch(sql.text, /stock\.inv|EXISTS \(SELECT 1 FROM \(SELECT CASE WHEN count\(i\."totalInventory"\)/);
          }
          assert.doesNotMatch(sql.text, /awd|AWD/);
        }
      }
    }
  } finally { globals.prisma = previous; }
});

test("agent bsrRank min/max affect listings rows/count/export only via typed bsrRank", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const calls: Prisma.Sql[] = [];
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => { calls.push(sql); return sql.text.startsWith("SELECT count") ? [{ total: 0 }] : []; } } as unknown as PrismaClient;
  try {
    for (const domain of ["listings", "sales", "inventory", "performance", "ads_report"] as const) {
      for (const range of ["", "bsrRankMin=0", "bsrRankMax=10000", "bsrRankMin=1&bsrRankMax=5000"]) {
        const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}`), domain);
        calls.length = 0;
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" });
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" }, true);
        assert.equal(calls.length, 3);
        for (const sql of calls) {
          const hasRange = domain === "listings" && (query.bsrRankMin != null || query.bsrRankMax != null);
          if (hasRange) {
            assert.match(sql.text, /s\."bsrRank" IS NOT NULL/);
            for (const [value, pattern] of [[query.bsrRankMin, /s\."bsrRank">=\$(\d+)/], [query.bsrRankMax, /s\."bsrRank"<=\$(\d+)/]] as const) {
              const match = sql.text.match(pattern);
              if (value != null) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
              else assert.equal(match, null);
            }
          } else {
            assert.doesNotMatch(sql.text, /s\."bsrRank" IS NOT NULL|s\."bsrRank">=|s\."bsrRank"<=/);
          }
        }
      }
    }
  } finally { globals.prisma = previous; }
});

test("agent listingQuantity min/max affect listings rows/count/export only via typed listingQuantity", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const calls: Prisma.Sql[] = [];
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => { calls.push(sql); return sql.text.startsWith("SELECT count") ? [{ total: 0 }] : []; } } as unknown as PrismaClient;
  try {
    for (const domain of ["listings", "sales", "inventory", "performance", "ads_report"] as const) {
      for (const range of ["", "listingQuantityMin=0", "listingQuantityMax=10000", "listingQuantityMin=1&listingQuantityMax=5000"]) {
        const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}`), domain);
        calls.length = 0;
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" });
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" }, true);
        assert.equal(calls.length, 3);
        for (const sql of calls) {
          const hasRange = domain === "listings" && (query.listingQuantityMin != null || query.listingQuantityMax != null);
          if (hasRange) {
            assert.match(sql.text, /s\."listingQuantity" IS NOT NULL/);
            for (const [value, pattern] of [[query.listingQuantityMin, /s\."listingQuantity">=\$(\d+)/], [query.listingQuantityMax, /s\."listingQuantity"<=\$(\d+)/]] as const) {
              const match = sql.text.match(pattern);
              if (value != null) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
              else assert.equal(match, null);
            }
          } else {
            assert.doesNotMatch(sql.text, /s\."listingQuantity" IS NOT NULL|s\."listingQuantity">=|s\."listingQuantity"<=/);
          }
        }
      }
    }
  } finally { globals.prisma = previous; }
});


test("agent price min/max affect listings rows/count/export only via typed price", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const calls: Prisma.Sql[] = [];
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => { calls.push(sql); return sql.text.startsWith("SELECT count") ? [{ total: 0 }] : []; } } as unknown as PrismaClient;
  try {
    for (const domain of ["listings", "sales", "inventory", "performance", "ads_report"] as const) {
      for (const range of ["", "priceMin=0", "priceMax=10000", "priceMin=1&priceMax=5000"]) {
        const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}`), domain);
        calls.length = 0;
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" });
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" }, true);
        assert.equal(calls.length, 3);
        for (const sql of calls) {
          const hasRange = domain === "listings" && (query.priceMin != null || query.priceMax != null);
          if (hasRange) {
            assert.match(sql.text, /s\.price IS NOT NULL/);
            for (const [value, pattern] of [[query.priceMin, /s\.price>=\$(\d+)/], [query.priceMax, /s\.price<=\$(\d+)/]] as const) {
              const match = sql.text.match(pattern);
              if (value != null) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
              else assert.equal(match, null);
            }
          } else {
            assert.doesNotMatch(sql.text, /s\.price IS NOT NULL|s\.price>=|s\.price<=/);
          }
        }
      }
    }
  } finally { globals.prisma = previous; }
});

test("agent reservedQty min/max affect listings rows/count/export only via typed reservedQty", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const calls: Prisma.Sql[] = [];
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => { calls.push(sql); return sql.text.startsWith("SELECT count") ? [{ total: 0 }] : []; } } as unknown as PrismaClient;
  try {
    for (const domain of ["listings", "sales", "inventory", "performance", "ads_report"] as const) {
      for (const range of ["", "reservedQtyMin=0", "reservedQtyMax=10000", "reservedQtyMin=1&reservedQtyMax=5000"]) {
        const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}`), domain);
        calls.length = 0;
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" });
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" }, true);
        assert.equal(calls.length, 3);
        for (const sql of calls) {
          const hasRange = domain === "listings" && (query.reservedQtyMin != null || query.reservedQtyMax != null);
          if (hasRange) {
            assert.match(sql.text, /s\."reservedQty" IS NOT NULL/);
            for (const [value, pattern] of [[query.reservedQtyMin, /s\."reservedQty">=\$(\d+)/], [query.reservedQtyMax, /s\."reservedQty"<=\$(\d+)/]] as const) {
              const match = sql.text.match(pattern);
              if (value != null) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
              else assert.equal(match, null);
            }
          } else {
            assert.doesNotMatch(sql.text, /s\."reservedQty" IS NOT NULL|s\."reservedQty">=|s\."reservedQty"<=/);
          }
        }
      }
    }
  } finally { globals.prisma = previous; }
});

test("agent unsellable min/max affect listings rows/count/export only via typed unsellable", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const calls: Prisma.Sql[] = [];
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => { calls.push(sql); return sql.text.startsWith("SELECT count") ? [{ total: 0 }] : []; } } as unknown as PrismaClient;
  try {
    for (const domain of ["listings", "sales", "inventory", "performance", "ads_report"] as const) {
      for (const range of ["", "unsellableMin=0", "unsellableMax=10000", "unsellableMin=1&unsellableMax=5000"]) {
        const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}`), domain);
        calls.length = 0;
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" });
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" }, true);
        assert.equal(calls.length, 3);
        for (const sql of calls) {
          const hasRange = domain === "listings" && (query.unsellableMin != null || query.unsellableMax != null);
          if (hasRange) {
            assert.match(sql.text, /s\."unsellable" IS NOT NULL/);
            for (const [value, pattern] of [[query.unsellableMin, /s\."unsellable">=\$(\d+)/], [query.unsellableMax, /s\."unsellable"<=\$(\d+)/]] as const) {
              const match = sql.text.match(pattern);
              if (value != null) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
              else assert.equal(match, null);
            }
          } else {
            assert.doesNotMatch(sql.text, /s\."unsellable" IS NOT NULL|s\."unsellable">=|s\."unsellable"<=/);
          }
        }
      }
    }
  } finally { globals.prisma = previous; }
});

test("agent warehousing min/max affect listings rows/count/export only via typed warehousing", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const calls: Prisma.Sql[] = [];
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => { calls.push(sql); return sql.text.startsWith("SELECT count") ? [{ total: 0 }] : []; } } as unknown as PrismaClient;
  try {
    for (const domain of ["listings", "sales", "inventory", "performance", "ads_report"] as const) {
      for (const range of ["", "warehousingMin=0", "warehousingMax=10000", "warehousingMin=1&warehousingMax=5000"]) {
        const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}`), domain);
        calls.length = 0;
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" });
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" }, true);
        assert.equal(calls.length, 3);
        for (const sql of calls) {
          const hasRange = domain === "listings" && (query.warehousingMin != null || query.warehousingMax != null);
          if (hasRange) {
            assert.match(sql.text, /s\."warehousing" IS NOT NULL/);
            for (const [value, pattern] of [[query.warehousingMin, /s\."warehousing">=\$(\d+)/], [query.warehousingMax, /s\."warehousing"<=\$(\d+)/]] as const) {
              const match = sql.text.match(pattern);
              if (value != null) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
              else assert.equal(match, null);
            }
          } else {
            assert.doesNotMatch(sql.text, /s\."warehousing" IS NOT NULL|s\."warehousing">=|s\."warehousing"<=/);
          }
        }
      }
    }
  } finally { globals.prisma = previous; }
});

test("agent cost min/max affect ads rows/count/export via typed cost; non-ads ignore", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const calls: Prisma.Sql[] = [];
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => { calls.push(sql); return sql.text.startsWith("SELECT count") ? [{ total: 0 }] : []; } } as unknown as PrismaClient;
  try {
    const ads = ["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"] as const;
    for (const domain of [...ads, "listings", "sales", "inventory", "performance"] as const) {
      for (const range of ["", "costMin=0", "costMax=10000", "costMin=1&costMax=5000"]) {
        const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}`), domain);
        calls.length = 0;
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" });
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" }, true);
        assert.equal(calls.length, 3);
        for (const sql of calls) {
          const hasRange = (ads as readonly string[]).includes(domain) && (query.costMin != null || query.costMax != null);
          if (hasRange) {
            assert.match(sql.text, /cost IS NOT NULL/);
            for (const [value, pattern] of [[query.costMin, /cost>=\$(\d+)/], [query.costMax, /cost<=\$(\d+)/]] as const) {
              const match = sql.text.match(pattern);
              if (value != null) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
              else assert.equal(match, null);
            }
          } else {
            assert.doesNotMatch(sql.text, /cost IS NOT NULL|cost>=|cost<=/);
          }
        }
      }
    }
  } finally { globals.prisma = previous; }
});


test("agent adSales min/max affect ads rows/count/export via typed adSales; non-ads ignore", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const calls: Prisma.Sql[] = [];
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => { calls.push(sql); return sql.text.startsWith("SELECT count") ? [{ total: 0 }] : []; } } as unknown as PrismaClient;
  try {
    const ads = ["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"] as const;
    for (const domain of [...ads, "listings", "sales", "inventory", "performance"] as const) {
      for (const range of ["", "adSalesMin=0", "adSalesMax=10000", "adSalesMin=1&adSalesMax=5000"]) {
        const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}`), domain);
        calls.length = 0;
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" });
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" }, true);
        assert.equal(calls.length, 3);
        for (const sql of calls) {
          const hasRange = (ads as readonly string[]).includes(domain) && (query.adSalesMin != null || query.adSalesMax != null);
          if (hasRange) {
            assert.match(sql.text, /"adSales" IS NOT NULL/);
            for (const [value, pattern] of [[query.adSalesMin, /"adSales">=\$(\d+)/], [query.adSalesMax, /"adSales"<=\$(\d+)/]] as const) {
              const match = sql.text.match(pattern);
              if (value != null) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
              else assert.equal(match, null);
            }
          } else {
            assert.doesNotMatch(sql.text, /"adSales" IS NOT NULL|"adSales">=|"adSales"<=/);
          }
        }
      }
    }
  } finally { globals.prisma = previous; }
});


test("agent impressions min/max affect ads rows/count/export via typed impressions; non-ads ignore", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const calls: Prisma.Sql[] = [];
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => { calls.push(sql); return sql.text.startsWith("SELECT count") ? [{ total: 0 }] : []; } } as unknown as PrismaClient;
  try {
    const ads = ["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"] as const;
    for (const domain of [...ads, "listings", "sales", "inventory", "performance"] as const) {
      for (const range of ["", "impressionsMin=0", "impressionsMax=10000", "impressionsMin=1&impressionsMax=5000"]) {
        const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}`), domain);
        calls.length = 0;
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" });
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" }, true);
        assert.equal(calls.length, 3);
        for (const sql of calls) {
          const hasRange = (ads as readonly string[]).includes(domain) && (query.impressionsMin != null || query.impressionsMax != null);
          if (hasRange) {
            assert.match(sql.text, /impressions IS NOT NULL/);
            for (const [value, pattern] of [[query.impressionsMin, /impressions>=\$(\d+)/], [query.impressionsMax, /impressions<=\$(\d+)/]] as const) {
              const match = sql.text.match(pattern);
              if (value != null) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
              else assert.equal(match, null);
            }
          } else {
            assert.doesNotMatch(sql.text, /impressions IS NOT NULL|impressions>=|impressions<=/);
          }
        }
      }
    }
  } finally { globals.prisma = previous; }
});


test("agent clicks min/max affect ads rows/count/export via typed clicks; non-ads ignore", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const calls: Prisma.Sql[] = [];
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => { calls.push(sql); return sql.text.startsWith("SELECT count") ? [{ total: 0 }] : []; } } as unknown as PrismaClient;
  try {
    const ads = ["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"] as const;
    for (const domain of [...ads, "listings", "sales", "inventory", "performance"] as const) {
      for (const range of ["", "clicksMin=0", "clicksMax=10000", "clicksMin=1&clicksMax=5000"]) {
        const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}`), domain);
        calls.length = 0;
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" });
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" }, true);
        assert.equal(calls.length, 3);
        for (const sql of calls) {
          const hasRange = (ads as readonly string[]).includes(domain) && (query.clicksMin != null || query.clicksMax != null);
          if (hasRange) {
            assert.match(sql.text, /clicks IS NOT NULL/);
            for (const [value, pattern] of [[query.clicksMin, /clicks>=\$(\d+)/], [query.clicksMax, /clicks<=\$(\d+)/]] as const) {
              const match = sql.text.match(pattern);
              if (value != null) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
              else assert.equal(match, null);
            }
          } else {
            assert.doesNotMatch(sql.text, /clicks IS NOT NULL|clicks>=|clicks<=/);
          }
        }
      }
    }
  } finally { globals.prisma = previous; }
});


test("agent adOrders min/max affect ads rows/count/export via typed adOrders; non-ads ignore", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const calls: Prisma.Sql[] = [];
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => { calls.push(sql); return sql.text.startsWith("SELECT count") ? [{ total: 0 }] : []; } } as unknown as PrismaClient;
  try {
    const ads = ["ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"] as const;
    for (const domain of [...ads, "listings", "sales", "inventory", "performance"] as const) {
      for (const range of ["", "adOrdersMin=0", "adOrdersMax=10000", "adOrdersMin=1&adOrdersMax=5000"]) {
        const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}`), domain);
        calls.length = 0;
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" });
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" }, true);
        assert.equal(calls.length, 3);
        for (const sql of calls) {
          const hasRange = (ads as readonly string[]).includes(domain) && (query.adOrdersMin != null || query.adOrdersMax != null);
          if (hasRange) {
            assert.match(sql.text, /"adOrders" IS NOT NULL/);
            for (const [value, pattern] of [[query.adOrdersMin, /"adOrders">=\$(\d+)/], [query.adOrdersMax, /"adOrders"<=\$(\d+)/]] as const) {
              const match = sql.text.match(pattern);
              if (value != null) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
              else assert.equal(match, null);
            }
          } else {
            assert.doesNotMatch(sql.text, /"adOrders" IS NOT NULL|"adOrders">=|"adOrders"<=/);
          }
        }
      }
    }
  } finally { globals.prisma = previous; }
});

test("agent bsrCategory filters listings rows/count/export exactly; other domains ignore it", async () => {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const calls: Prisma.Sql[] = [];
  globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => { calls.push(sql); return sql.text.startsWith("SELECT count") ? [{ total: 0 }] : []; } } as unknown as PrismaClient;
  try {
    for (const domain of ["listings", "sales", "inventory", "performance", "ads_report"] as const) {
      for (const value of ["", "Baby", "Musical Instruments", "%' OR TRUE--"]) {
        const query = sellfoxBrowseQuery(new URL(`http://localhost/?${new URLSearchParams(value ? { bsrCategory: value } : {})}`), domain);
        calls.length = 0;
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" });
        await readSellfoxAgentRows(domain, query, { organizationId: "org", workspaceId: "ws" }, true);
        assert.equal(calls.length, 3);
        for (const sql of calls) {
          const match = sql.text.match(/s\."bsrCategory"=\$(\d+)/);
          if (domain === "listings" && value) {
            assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value);
            assert.ok(!sql.text.includes(value));
          } else {
            assert.equal(match, null);
            assert.ok(!sql.values.includes(value || undefined));
          }
        }
      }
    }
  } finally { globals.prisma = previous; }
});
