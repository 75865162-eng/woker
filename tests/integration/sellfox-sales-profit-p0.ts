/** Optional local PostgreSQL regression. DDL/data live in a disposable schema. */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { workbenchReadSql } from "@/lib/sellfox/workbench-read";
import { sellfoxColumnValue, visibleColumns } from "@/components/sellfox/workbench-types";
import { readSellfoxAgentRows } from "@/lib/sellfox/agent-read";
import type { Prisma, PrismaClient } from "@prisma/client";
import { sellfoxBrowseQuery } from "@/lib/sellfox/browse-query";

type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
export async function verifySellfoxP0Sql(query: Query) {
  const schema = `sellfox_p0_${randomUUID().replaceAll("-", "")}`;
  try {
    // Migrations own their transactions, so keep the isolated path across COMMIT.
    await query(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}"`);
    await query(`CREATE TABLE "SellfoxStore" (id text PRIMARY KEY,"organizationId" text,"workspaceId" text,"externalId" text,name text,marketplace text);
      INSERT INTO "SellfoxStore" VALUES ('s','org','ws','shop','店铺','US'),('foreign','other','ws','foreign-shop','其他组织','US');
      CREATE TABLE "SellfoxSalesDayCoverage" ("storeId" text,"reportDate" text,"capturedAt" timestamp);
      CREATE TABLE sellfox_listing_current ("storeId" text,msku text,"parentAsin" text,title text,price float,"mainImage" text,"organizationId" text,"workspaceId" text,
        id text,asin text,brand text,rating text,"buyBoxWinner" text,fulfillment text,developer text,spu text,"productTagNames" text[]);`);
    const prior = await readFile("prisma/migrations/20261025020000_sellfox_agent_read_models/migration.sql", "utf8");
    const sales = await readFile("prisma/migrations/20261024020000_add_sellfox_snapshots_sync_schedule/migration.sql", "utf8");
    await query(sales.slice(sales.indexOf('CREATE TABLE "SellfoxSalesDailySnapshot"'), sales.indexOf('CREATE TABLE "SellfoxSyncSchedule"')));
    await query(await readFile("prisma/migrations/20260807060000_add_sellfox_product_daily_snapshots/migration.sql", "utf8"));
    await query(prior.slice(prior.indexOf('ALTER TABLE "SellfoxProductDailySnapshot"'), prior.indexOf(';') + 1));
    for (const view of ["sellfox_sales_daily", "sellfox_profit_daily"]) await query(prior.split("\n").find(line => line.startsWith(`CREATE VIEW ${view} `))!);
    await query(`INSERT INTO "SellfoxSalesDailySnapshot" (id,"organizationId","workspaceId","storeId","reportDate","sourceKey",msku,asin,quantity,revenue,currency,payload,"updatedAt","syncedAt")
      VALUES ('old','org','ws','s','2026-10-24','m1','m1','A',2,10,'USD','{}',now(),'2026-10-25');
      INSERT INTO "SellfoxProductDailySnapshot" (id,"organizationId","workspaceId","storeId","reportDate","sourceKey",msku,asin,currency,payload,"updatedAt","saleRevenue","grossProfit","orderNum")
      VALUES ('all','org','ws','s','2026-10-24','m1','m1','A','USD','{}',now(),100,20,5);`);
    // Execute the actual incremental migration against populated prior views/indexes.
    await query(await readFile("prisma/migrations/20261026010000_sellfox_sales_profit_p0/migration.sql", "utf8"));
    await query(await readFile("prisma/migrations/20261026020000_sellfox_profit_fees_image_fallback/migration.sql", "utf8"));
    // Reuse the actual safe-number helper from 50000 without unrelated Listing DDL.
    const listingMigration = await readFile("prisma/migrations/20261026050000_sellfox_listing_typed_read_model/migration.sql", "utf8");
    await query(listingMigration.match(/CREATE FUNCTION sellfox_listing_number\(value text\)[\s\S]*?\$\$;/)![0]);
    const priorFeeKeys = ["refundPrice", "refundNum", "commodityCost", "shippingPrice", "taxPrice"];
    const extraFeeKeys = ["headTripPrice", "avgPurchaseCost", "amazonCommissionPrice"];
    const feeKeys = [...priorFeeKeys, ...extraFeeKeys];
    const backfillPayload = { refundPrice: "2", refundNum: 1, commodityCost: "3", shippingPrice: 4, taxPrice: "5", headTripPrice: "6.5", avgPurchaseCost: 0, amazonCommissionPrice: "-8", userNameList: [" 温见清 ", "陈馨", "温见清", "", "  "] };
    await query('UPDATE "SellfoxProductDailySnapshot" SET payload=$1::jsonb WHERE id=\'all\'', [JSON.stringify(backfillPayload)]);
    const viewColumns = async () => (await query(`SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='sellfox_profit_daily' ORDER BY ordinal_position`, [schema])).rows.map(row => row.column_name);
    const oldColumns = await viewColumns();
    await query(await readFile("prisma/migrations/20261026080000_sellfox_product_daily_typed_fees/migration.sql", "utf8"));
    assert.deepEqual(await viewColumns(), [...oldColumns, ...priorFeeKeys]);
    await query(await readFile("prisma/migrations/20261026090000_sellfox_product_daily_user_name_list/migration.sql", "utf8"));
    assert.deepEqual(await viewColumns(), [...oldColumns, ...priorFeeKeys, "userNameList"]);
    const columns90000 = await viewColumns();
    await query(await readFile("prisma/migrations/20261026100000_sellfox_product_daily_typed_fee_extras/migration.sql", "utf8"));
    assert.deepEqual(await viewColumns(), [...columns90000, ...extraFeeKeys]);
    const backfilled = (await query('SELECT * FROM "SellfoxProductDailySnapshot" WHERE id=\'all\'')).rows[0];
    assert.deepEqual(backfilled.payload, backfillPayload);
    assert.deepEqual((backfilled.userNameList as string[]).sort(), ["温见清", "陈馨"].sort());
    assert.ok((await query(`SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND indexname='sellfox_product_daily_user_name_list'`, [schema])).rows.some(row => String(row.indexdef).includes('USING gin ("userNameList")')));
    assert.deepEqual(feeKeys.map(key => backfilled[key]), [2, 1, 3, 4, 5, 6.5, 0, -8]);
    assert.equal((await query('SELECT orders FROM sellfox_sales_daily')).rows[0].orders, null);
    assert.equal((await query('SELECT "onlySettle" FROM sellfox_profit_daily')).rows[0].onlySettle, false);
    await query(`UPDATE "SellfoxSalesDailySnapshot" SET orders=0;
      INSERT INTO "SellfoxSalesDayCoverage" VALUES ('s','2026-10-24','2026-10-25');
      INSERT INTO sellfox_listing_current ("storeId",msku,"parentAsin",title,price,"mainImage","organizationId","workspaceId") VALUES ('s','m1','P','商品',10,'https://m.media-amazon.com/images/I/fixture.jpg','org','ws'),('s','m1','WRONG','错误',1,'https://m.media-amazon.com/images/I/wrong.jpg','other','ws');
      INSERT INTO "SellfoxProductDailySnapshot" (id,"organizationId","workspaceId","storeId","reportDate","sourceKey",msku,asin,currency,payload,"updatedAt","saleRevenue","grossProfit","orderNum","onlySettle")
      VALUES ('settled','org','ws','s','2026-10-24','m1','m1','A','USD','{}',now(),40,8,2,true);`);
    const read = async (domain: "sales" | "performance", params: string) => {
      const sql = workbenchReadSql(domain, sellfoxBrowseQuery(new URL(`http://localhost/?from=2026-10-24&to=2026-10-24&${params}`)), {organizationId:"org",workspaceId:"ws"});
      assert.doesNotMatch(sql.text, /s\.payload->>'(?:refundPrice|refundNum|commodityCost|shippingPrice|taxPrice|headTripPrice|avgPurchaseCost|amazonCommissionPrice)'/);
      const result = (await query(sql.text, sql.values)).rows[0];
      return result as {rows: Record<string, unknown>[]; totals: Record<string, unknown>[]; total: number; facets: { salespersons?: string[] }};
    };
    const selected = await read("performance", "salesperson=" + encodeURIComponent("温见清"));
    assert.equal(selected.total, 1); assert.equal(selected.totals[0].saleRevenue, 100);
    assert.deepEqual(selected.rows[0].userNameList, backfilled.userNameList);
    const nameColumn = visibleColumns("performance", ["salesperson"])[0];
    assert.equal(sellfoxColumnValue(nameColumn, selected.rows[0]), (backfilled.userNameList as string[]).join("、"));
    const emptyPerson = await read("performance", "salesperson=unknown");
    assert.equal(emptyPerson.total, 0); assert.deepEqual(emptyPerson.totals, []);
    assert.deepEqual(emptyPerson.facets.salespersons, selected.facets.salespersons);
    assert.deepEqual((selected.facets.salespersons ?? []).sort(), ["温见清", "陈馨"].sort());
    assert.deepEqual((await read("performance", "onlySettle=1")).facets.salespersons, []);
    assert.deepEqual((await read("performance", "site=CA")).facets.salespersons, []);
    const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
    globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => (await query(sql.text, sql.values)).rows } as unknown as PrismaClient;
    try {
      for (const exporting of [false, true]) {
        const agent = await readSellfoxAgentRows("performance", sellfoxBrowseQuery(new URL("http://localhost/?from=2026-10-24&to=2026-10-24&salesperson=" + encodeURIComponent("温见清"))), { organizationId: "org", workspaceId: "ws" }, exporting);
        assert.equal(agent.rows.length, 1); assert.equal(agent.rows[0].saleRevenue, 100);
        assert.deepEqual(extraFeeKeys.map(key => agent.rows[0][key]), [6.5, 0, -8]);
      }
    } finally { globals.prisma = previous; }
    // Trigger handles all invalid containers and ignores non-string members without inventing names.
    for (const userNameList of [null, "温见清", {}, [], [null, 1, false, { name: "伪造" }]]) {
      await query('UPDATE "SellfoxProductDailySnapshot" SET payload=$1::jsonb WHERE id=\'settled\'', [JSON.stringify({ userNameList })]);
      assert.deepEqual((await query('SELECT "userNameList" FROM "SellfoxProductDailySnapshot" WHERE id=\'settled\'')).rows[0].userNameList, []);
    }
    const orders = await read("sales", "metric=orders");
    assert.equal(orders.rows[0].subtotal, 0); assert.equal(orders.totals[0].subtotal, 0);
    assert.equal(orders.rows[0].mainImage, 'https://m.media-amazon.com/images/I/fixture.jpg');
    const all = await read("performance", ""), settled = await read("performance", "onlySettle=1");
    assert.equal(all.total, 1); assert.equal(all.totals[0].saleRevenue, 100);
    assert.equal(all.rows[0].promotionDiscount, 0); assert.equal(all.totals[0].giftWrapFee, 0);
    assert.deepEqual(feeKeys.map(key => all.rows[0][key]), [2, 1, 3, 4, 5, 6.5, 0, -8]);
    assert.deepEqual(feeKeys.map(key => all.totals[0][key]), [2, 1, 3, 4, 5, 6.5, 0, -8]);
    assert.equal(settled.total, 1); assert.equal(settled.totals[0].saleRevenue, 40);
    assert.equal(settled.rows[0].mainImage, orders.rows[0].mainImage);
    assert.deepEqual(feeKeys.map(key => settled.rows[0][key]), [0, 0, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(feeKeys.map(key => settled.totals[0][key]), [0, 0, 0, 0, 0, 0, 0, 0]);
    await query(`INSERT INTO "SellfoxSalesDailySnapshot" (id,"organizationId","workspaceId","storeId","reportDate","sourceKey",msku,asin,quantity,revenue,currency,payload,"updatedAt","syncedAt",orders)
      VALUES ('unknown','org','ws','s','2026-10-24','m2','m2','B',1,10,'USD','{}',now(),'2026-10-25',NULL),('cad','org','ws','s','2026-10-24','m3','m3','C',1,10,'CAD','{}',now(),'2026-10-25',3);`);
    const missing = await read("sales", "metric=orders&pageSize=1");
    assert.equal(missing.rows.length, 1); assert.equal(missing.total, 3);
    assert.equal(missing.totals.find(t=>t.currency === 'USD')?.subtotal, null);
    assert.equal(missing.totals.find(t=>t.currency === 'CAD')?.subtotal, 3);
    const search = await read("sales", "metric=orders&searchType=msku&search=m1&exactMatch=1");
    assert.equal(search.total, 1); assert.equal(search.totals[0].subtotal, 0);
    const incomplete = workbenchReadSql("sales", sellfoxBrowseQuery(new URL('http://localhost/?from=2026-10-23&to=2026-10-24&metric=orders')), {organizationId:'org',workspaceId:'ws'});
    const incompleteRows = (await query(incomplete.text, incomplete.values)).rows[0].rows as Record<string, unknown>[];
    assert.equal(incompleteRows[0].subtotal, null);
    // Optional fees coalesce at entity and totals levels; unknown core metrics
    // remain null. Different currencies and settlement partitions never mix.
    await query(`INSERT INTO "SellfoxProductDailySnapshot" (id,"organizationId","workspaceId","storeId","reportDate","sourceKey",msku,asin,currency,payload,"updatedAt","promotionDiscount","giftWrapFee")
      VALUES ('fee','org','ws','s','2026-10-24','m2','m2','A','USD','{"userNameList":["陈馨"],"refundPrice":"2.5","refundNum":0,"commodityCost":3,"shippingPrice":4,"taxPrice":-0.5,"headTripPrice":1.5,"avgPurchaseCost":"2","amazonCommissionPrice":3}',now(),12.5,1.25),
        ('fee-null','org','ws','s','2026-10-24','m3','m3','B','USD','{"refundPrice":"invalid","refundNum":"","commodityCost":null,"shippingPrice":"Infinity","taxPrice":"1e999","headTripPrice":"invalid","avgPurchaseCost":null,"amazonCommissionPrice":"Infinity"}',now(),NULL,NULL),
        ('fee-cad','org','ws','s','2026-10-24','mc','mc','C','CAD','{"refundPrice":10,"refundNum":1,"commodityCost":20,"shippingPrice":30,"taxPrice":40,"headTripPrice":50,"avgPurchaseCost":60,"amazonCommissionPrice":70}',now(),9,2);`);
    // INSERT supplies fees only through payload; trigger replaces nullable defaults.
    const insertedFees = (await query('SELECT * FROM "SellfoxProductDailySnapshot" WHERE id=\'fee\'')).rows[0];
    assert.deepEqual(feeKeys.map(key => insertedFees[key]), [2.5, 0, 3, 4, -0.5, 1.5, 2, 3]);
    const invalidFees = (await query('SELECT * FROM "SellfoxProductDailySnapshot" WHERE id=\'fee-null\'')).rows[0];
    assert.deepEqual(feeKeys.map(key => invalidFees[key]), [null, null, null, null, null, null, null, null]);
    const personOnly = await read("performance", "dimension=asin&salesperson=" + encodeURIComponent("温见清"));
    assert.equal(personOnly.rows.length, 1); assert.equal(personOnly.rows[0].saleRevenue, 100);
    assert.equal(personOnly.totals[0].saleRevenue, 100); assert.equal(personOnly.totals[0].refundPrice, 2);
    const sharedPerson = await read("performance", "dimension=asin&salesperson=" + encodeURIComponent("陈馨"));
    assert.equal(sharedPerson.rows.length, 1); assert.equal(sharedPerson.rows[0].refundPrice, 4.5);
    assert.equal(sharedPerson.totals[0].refundPrice, 4.5); // no splitting/double-counting across names
    const fees = await read("performance", "dimension=asin");
    const combined = fees.rows.find(row => row.identity === "A")!;
    assert.equal(combined.promotionDiscount, 12.5); assert.equal(combined.giftWrapFee, 1.25);
    assert.deepEqual(feeKeys.map(key => combined[key]), [4.5, 1, 6, 8, 4.5, 8, 2, -5]);
    assert.equal(combined.saleRevenue, null);
    const nullFees = fees.rows.find(row => row.identity === "B")!;
    assert.equal(nullFees.promotionDiscount, 0); assert.equal(nullFees.giftWrapFee, 0);
    assert.deepEqual(feeKeys.map(key => nullFees[key]), [0, 0, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(feeKeys.map(key => fees.totals.find(row => row.currency === "USD")?.[key]), [4.5, 1, 6, 8, 4.5, 8, 2, -5]);
    assert.deepEqual(feeKeys.map(key => fees.totals.find(row => row.currency === "CAD")?.[key]), [10, 1, 20, 30, 40, 50, 60, 70]);
    assert.equal(fees.totals.find(row => row.currency === "USD")?.promotionDiscount, 12.5);
    assert.equal(fees.totals.find(row => row.currency === "USD")?.giftWrapFee, 1.25);
    assert.equal(fees.totals.find(row => row.currency === "CAD")?.promotionDiscount, 9);
    for (const key of extraFeeKeys) {
      const sorted = await read("performance", `dimension=asin&sortBy=${key}&sortOrder=desc&pageSize=1`);
      assert.equal(sorted.rows[0].currency, "CAD");
      assert.deepEqual(sorted.totals, fees.totals);
    }
    const paged = await read("performance", "dimension=asin&pageSize=1");
    assert.equal(paged.rows.length, 1); assert.deepEqual(paged.totals, fees.totals);
    const settledFees = await read("performance", "dimension=asin&onlySettle=1");
    assert.equal(settledFees.totals[0].promotionDiscount, 0);
    assert.equal(settledFees.totals[0].giftWrapFee, 0);
    // UPDATE OF payload refreshes all eight fees, clearing stale values on missing keys.
    await query('UPDATE "SellfoxProductDailySnapshot" SET payload=$1::jsonb WHERE id=\'fee\'', [JSON.stringify({ refundPrice: 0, refundNum: "2.5", commodityCost: "", shippingPrice: "bad", taxPrice: null, headTripPrice: "0", avgPurchaseCost: "2.5", amazonCommissionPrice: "bad" })]);
    const updatedFees = (await query('SELECT * FROM "SellfoxProductDailySnapshot" WHERE id=\'fee\'')).rows[0];
    assert.deepEqual(feeKeys.map(key => updatedFees[key]), [0, 2.5, null, null, null, 0, 2.5, null]);
    assert.equal(updatedFees.promotionDiscount, 12.5); assert.equal(updatedFees.giftWrapFee, 1.25);
    const updated = await read("performance", "dimension=msku&searchType=msku&search=m2&exactMatch=1");
    assert.deepEqual(feeKeys.map(key => updated.rows[0][key]), [0, 2.5, 0, 0, 0, 0, 2.5, 0]);
    assert.deepEqual(feeKeys.map(key => updated.totals[0][key]), [0, 2.5, 0, 0, 0, 0, 2.5, 0]);
    await query('UPDATE "SellfoxProductDailySnapshot" SET payload=\'{}\'::jsonb WHERE id=\'fee\'');
    const cleared = (await query('SELECT * FROM sellfox_profit_daily WHERE id=\'fee\'')).rows[0];
    assert.deepEqual(feeKeys.map(key => cleared[key]), [null, null, null, null, null, null, null, null]);
    assert.deepEqual(cleared.userNameList, []);
    // Use the same numeric contract for each new typed fact; Listing names are never aliases.
    for (const value of [null, "", " ", "bad", "Infinity", "-Infinity", "NaN", "1e999", {}, [], true]) {
      await query('UPDATE "SellfoxProductDailySnapshot" SET payload=$1::jsonb WHERE id=\'fee\'', [JSON.stringify(Object.fromEntries(extraFeeKeys.map(key => [key, value])))]);
      const invalid = (await query('SELECT * FROM sellfox_profit_daily WHERE id=\'fee\'')).rows[0];
      assert.deepEqual(extraFeeKeys.map(key => invalid[key]), [null, null, null]);
    }
    await query('UPDATE "SellfoxProductDailySnapshot" SET payload=$1::jsonb WHERE id=\'fee\'', [JSON.stringify({ headTripCost: 999, purchaseCost: 999, referralFee: 999 })]);
    const listingNames = (await query('SELECT * FROM sellfox_profit_daily WHERE id=\'fee\'')).rows[0];
    assert.deepEqual(extraFeeKeys.map(key => listingNames[key]), [null, null, null]);
  } finally { await query(`ROLLBACK; SET search_path TO public; DROP SCHEMA "${schema}" CASCADE`); }
}

test("sales/profit migration and browse totals preserve scopes, zero, null, current images and currency", {skip: !process.env.SELLFOX_P0_TEST_DATABASE_URL}, async () => {
  const client = new Client({connectionString:process.env.SELLFOX_P0_TEST_DATABASE_URL});
  try { await client.connect(); await verifySellfoxP0Sql((sql,values)=>client.query(sql,values)); }
  finally { await client.end(); }
});


// Standalone offline verifier. Never reads DATABASE_URL or connects to a remote database.
if (process.argv[1]?.endsWith("sellfox-sales-profit-p0.ts")) {
  void (async () => {
    const moduleName = process.env.SELLFOX_TEST_PGLITE_MODULE || "@electric-sql/pglite";
    const { PGlite } = await import(moduleName) as { PGlite: new () => {
      query: Query; exec: (sql: string) => Promise<{ rows: Record<string, unknown>[] }[]>; close: () => Promise<void>;
    } };
    const db = new PGlite();
    try {
      await verifySellfoxP0Sql(async (sql, values) => values?.length ? db.query(sql, values) : (await db.exec(sql)).at(-1)!);
      console.log("Sales/profit 80000 + 90000 + 100000 migration, fee extras, trigger, salesperson containment/facets/totals/Agent: PASS (disposable PGlite)");
    } finally { await db.close(); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
