/** Optional local PostgreSQL regression. DDL/data live in a temporary schema and roll back. */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client } from "pg";
import { workbenchReadSql } from "@/lib/sellfox/workbench-read";
import { sellfoxBrowseQuery } from "@/lib/sellfox/browse-query";

type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
export async function verifySellfoxP0Sql(query: Query) {
  const schema = `sellfox_p0_${randomUUID().replaceAll("-", "")}`;
  await query("BEGIN");
  try {
    await query(`CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}"`);
    await query(`CREATE TABLE "SellfoxStore" (id text PRIMARY KEY,"organizationId" text,"workspaceId" text,"externalId" text,name text,marketplace text);
      INSERT INTO "SellfoxStore" VALUES ('s','org','ws','shop','店铺','US'),('foreign','other','ws','foreign-shop','其他组织','US');
      CREATE TABLE "SellfoxSalesDayCoverage" ("storeId" text,"reportDate" text,"capturedAt" timestamp);
      CREATE TABLE sellfox_listing_current ("storeId" text,msku text,"parentAsin" text,title text,price float,"mainImage" text,"organizationId" text,"workspaceId" text);`);
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
    assert.equal((await query('SELECT orders FROM sellfox_sales_daily')).rows[0].orders, null);
    assert.equal((await query('SELECT "onlySettle" FROM sellfox_profit_daily')).rows[0].onlySettle, false);
    await query(`UPDATE "SellfoxSalesDailySnapshot" SET orders=0;
      INSERT INTO "SellfoxSalesDayCoverage" VALUES ('s','2026-10-24','2026-10-25');
      INSERT INTO sellfox_listing_current VALUES ('s','m1','P','商品',10,'https://m.media-amazon.com/images/I/fixture.jpg','org','ws'),('s','m1','WRONG','错误',1,'https://m.media-amazon.com/images/I/wrong.jpg','other','ws');
      INSERT INTO "SellfoxProductDailySnapshot" (id,"organizationId","workspaceId","storeId","reportDate","sourceKey",msku,asin,currency,payload,"updatedAt","saleRevenue","grossProfit","orderNum","onlySettle")
      VALUES ('settled','org','ws','s','2026-10-24','m1','m1','A','USD','{}',now(),40,8,2,true);`);
    const read = async (domain: "sales" | "performance", params: string) => {
      const sql = workbenchReadSql(domain, sellfoxBrowseQuery(new URL(`http://localhost/?from=2026-10-24&to=2026-10-24&${params}`)), {organizationId:"org",workspaceId:"ws"});
      const result = (await query(sql.text, sql.values)).rows[0];
      return result as {rows: Record<string, unknown>[]; totals: Record<string, unknown>[]; total: number};
    };
    const orders = await read("sales", "metric=orders");
    assert.equal(orders.rows[0].subtotal, 0); assert.equal(orders.totals[0].subtotal, 0);
    assert.equal(orders.rows[0].mainImage, 'https://m.media-amazon.com/images/I/fixture.jpg');
    const all = await read("performance", ""), settled = await read("performance", "onlySettle=1");
    assert.equal(all.total, 1); assert.equal(all.totals[0].saleRevenue, 100);
    assert.equal(all.rows[0].promotionDiscount, 0); assert.equal(all.totals[0].giftWrapFee, 0);
    assert.equal(settled.total, 1); assert.equal(settled.totals[0].saleRevenue, 40);
    assert.equal(settled.rows[0].mainImage, orders.rows[0].mainImage);
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
      VALUES ('fee','org','ws','s','2026-10-24','m2','m2','A','USD','{}',now(),12.5,1.25),
        ('fee-null','org','ws','s','2026-10-24','m3','m3','B','USD','{}',now(),NULL,NULL),
        ('fee-cad','org','ws','s','2026-10-24','mc','mc','C','CAD','{}',now(),9,2);`);
    const fees = await read("performance", "dimension=asin");
    const combined = fees.rows.find(row => row.identity === "A")!;
    assert.equal(combined.promotionDiscount, 12.5); assert.equal(combined.giftWrapFee, 1.25);
    assert.equal(combined.saleRevenue, null);
    const nullFees = fees.rows.find(row => row.identity === "B")!;
    assert.equal(nullFees.promotionDiscount, 0); assert.equal(nullFees.giftWrapFee, 0);
    assert.equal(fees.totals.find(row => row.currency === "USD")?.promotionDiscount, 12.5);
    assert.equal(fees.totals.find(row => row.currency === "USD")?.giftWrapFee, 1.25);
    assert.equal(fees.totals.find(row => row.currency === "CAD")?.promotionDiscount, 9);
    const paged = await read("performance", "dimension=asin&pageSize=1");
    assert.equal(paged.rows.length, 1); assert.deepEqual(paged.totals, fees.totals);
    const settledFees = await read("performance", "dimension=asin&onlySettle=1");
    assert.equal(settledFees.totals[0].promotionDiscount, 0);
    assert.equal(settledFees.totals[0].giftWrapFee, 0);
  } finally { await query("ROLLBACK"); }
}

test("sales/profit migration and browse totals preserve scopes, zero, null, current images and currency", {skip: !process.env.SELLFOX_P0_TEST_DATABASE_URL}, async () => {
  const client = new Client({connectionString:process.env.SELLFOX_P0_TEST_DATABASE_URL});
  try { await client.connect(); await verifySellfoxP0Sql((sql,values)=>client.query(sql,values)); }
  finally { await client.end(); }
});
