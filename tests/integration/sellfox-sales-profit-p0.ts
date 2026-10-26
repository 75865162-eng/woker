/** Optional local PostgreSQL regression. DDL/data live in a disposable schema. */
import test from "node:test";
import contigFees from "../fixtures/sellfox/performance-contig-fees.json";
import optionalFees from "../fixtures/sellfox/performance-optional-fees.json";
import miscFees from "../fixtures/sellfox/performance-misc-fees.json";
import storageFees from "../fixtures/sellfox/performance-storage-fees.json";
import adChannels from "../fixtures/sellfox/performance-ad-channel-costs.json";
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
        id text,asin text,brand text,rating text,"buyBoxWinner" text,fulfillment text,developer text,spu text,"productTagNames" text[],"productTags" text);`);
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
    const contigKeys = Object.keys(contigFees.backfill);
    const contigBackfill = [1.5, 0, 3, 14.25, 5, 6, 7, 8, 9, 10, 11, 12], contigInserted = [0, 2.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13], contigCad = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120];
    const contigNull = contigKeys.map(() => null), contigZero = contigKeys.map(() => 0);
    const contigCombined = contigBackfill.map((v, i) => v + contigInserted[i]);
    const optionalKeys = Object.keys(optionalFees.backfill);
    const optionalBackfill = [1.5, 0, 3, 4.25, 5, 6, 7, 8], optionalInserted = [0, 2.5, 4, 5, 6, 7, 8, 9], optionalCad = [10, 20, 30, 40, 50, 60, 70, 80];
    const optionalNull = optionalKeys.map(() => null), optionalZero = optionalKeys.map(() => 0);
    const optionalCombined = optionalBackfill.map((v, i) => v + optionalInserted[i]);
    const miscKeys = Object.keys(miscFees.backfill);
    const miscBackfill = [1.5, 0, 3, 4.25, 5, 6], miscInserted = [0, 2.5, 4, 5, 6, 7], miscCad = [10, 20, 30, 40, 50, 60];
    const miscNull = miscKeys.map(() => null), miscZero = miscKeys.map(() => 0);
    const miscCombined = miscBackfill.map((v, i) => v + miscInserted[i]);
    const storageKeys = Object.keys(storageFees.backfill);
    const storageBackfill = [1.5, 0, 3, 4.25], storageInserted = [0, 2.5, 4, 5], storageCad = [10, 20, 30, 40];
    const storageNull = storageKeys.map(() => null), storageZero = storageKeys.map(() => 0);
    const storageCombined = storageBackfill.map((v, i) => v + storageInserted[i]);
    const adKeys = Object.keys(adChannels.backfill);
    const adBackfill = [1.5, 0, 3, 4.25, 5];
    const adInserted = [0, 2.5, 4, 5, 6.75];
    const adCad = [10, 20, 30, 40, 50];
    const adCombined = adBackfill.map((v, i) => v + adInserted[i]);
    const adNull = adKeys.map(() => null), adZero = adKeys.map(() => 0);
    const qtyKeys = ["evaluationSaleNum", "channelSaleNum"];
    const backfillPayload = { ...adChannels.backfill, ...storageFees.backfill, ...miscFees.backfill, ...optionalFees.backfill, ...contigFees.backfill, adTotalCost: 99.5, refundPrice: "2", refundNum: 1, commodityCost: "3", shippingPrice: 4, taxPrice: "5", headTripPrice: "6.5", avgPurchaseCost: 0, amazonCommissionPrice: "-8", evaluationSaleNum: "0", channelSaleNum: "1", userNameList: [" 温见清 ", "陈馨", "温见清", "", "  "] };
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
    const columns100000 = await viewColumns();
    await query(await readFile("prisma/migrations/20261026110000_sellfox_product_daily_eval_channel_qty/migration.sql", "utf8"));
    assert.deepEqual(await viewColumns(), [...columns100000, ...qtyKeys]);
    const columns110000 = await viewColumns();
    await query(`UPDATE "SellfoxProductDailySnapshot" SET "adCost"=88.25 WHERE id='all'`);
    const indexes110000 = (await query(`SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND tablename='SellfoxProductDailySnapshot'`, [schema])).rows;
    await query(await readFile("prisma/migrations/20261026120000_sellfox_product_daily_ad_channel_costs/migration.sql", "utf8"));
    assert.deepEqual(await viewColumns(), [...columns110000, ...adKeys]);
    assert.ok(!(await viewColumns()).includes("adTotalCost"));
    assert.deepEqual((await query(`SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND tablename='SellfoxProductDailySnapshot'`, [schema])).rows, indexes110000);
    const columns120000 = await viewColumns();
    await query(await readFile("prisma/migrations/20261026130000_sellfox_product_daily_storage_fees/migration.sql", "utf8"));
    assert.deepEqual(await viewColumns(), [...columns120000, ...storageKeys]);
    assert.deepEqual((await query(`SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND tablename='SellfoxProductDailySnapshot'`, [schema])).rows, indexes110000);
    const columns130000 = await viewColumns();
    await query(await readFile("prisma/migrations/20261026140000_sellfox_product_daily_misc_fees/migration.sql", "utf8"));
    assert.deepEqual(await viewColumns(), [...columns130000, ...miscKeys]);
    assert.deepEqual((await query(`SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND tablename='SellfoxProductDailySnapshot'`, [schema])).rows, indexes110000);
    await query(`UPDATE "SellfoxProductDailySnapshot" SET "promotionDiscount"=17.25 WHERE id='all'`);
    const columns140000 = await viewColumns();
    await query(await readFile("prisma/migrations/20261026150000_sellfox_product_daily_optional_fees/migration.sql", "utf8"));
    assert.deepEqual(await viewColumns(), [...columns140000, ...optionalKeys]);
    assert.deepEqual((await query(`SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND tablename='SellfoxProductDailySnapshot'`, [schema])).rows, indexes110000);
    const columns150000 = await viewColumns();
    await query(await readFile("prisma/migrations/20261026160000_sellfox_product_daily_contig_fees/migration.sql", "utf8"));
    assert.deepEqual(await viewColumns(), [...columns150000, ...contigKeys]);
    assert.deepEqual((await query(`SELECT indexdef FROM pg_indexes WHERE schemaname=$1 AND tablename='SellfoxProductDailySnapshot'`, [schema])).rows, indexes110000);
    const backfilled = (await query('SELECT * FROM "SellfoxProductDailySnapshot" WHERE id=\'all\'')).rows[0];
    assert.deepEqual(backfilled.payload, backfillPayload);
    assert.equal(backfilled.promotionDiscount, 17.25);
    assert.equal(backfilled.promotionTotalAmount, 1.5);
    for (const key of contigKeys) await query(`UPDATE "SellfoxProductDailySnapshot" SET "${key}"=999 WHERE id='all'`);
    const manualContig = (await query(`SELECT * FROM sellfox_profit_daily WHERE id='all'`)).rows[0];
    assert.deepEqual(contigKeys.map(key => manualContig[key]), contigKeys.map(() => 999));
    await query(`UPDATE "SellfoxProductDailySnapshot" SET payload=payload WHERE id='all'`);
    const refreshedContig = (await query(`SELECT * FROM sellfox_profit_daily WHERE id='all'`)).rows[0];
    assert.deepEqual(contigKeys.map(key => refreshedContig[key]), contigBackfill);
    assert.deepEqual([backfilled.starStorageFeeAmount, backfilled.storageFeeAmount, backfilled.fbaStorageFeeAmount, backfilled.fbaLongTermStorageFeeAmount, backfilled.fbaOverageFeeAmount], [14.25, 4.25, 1.5, 0, 0]);
    assert.deepEqual([backfilled.shippingChargebackAmount, backfilled.shippingChargeAmount, backfilled.orderOtherPriceAmount, backfilled.otherPriceAmount], [9, 7, 12, 6]);
    // A non-payload update must not reproject typed fields; payload=payload does.
    await query(`UPDATE "SellfoxProductDailySnapshot" SET "promotionTotalAmount"=999 WHERE id='all'`);
    assert.equal((await query(`SELECT "promotionTotalAmount" FROM sellfox_profit_daily WHERE id='all'`)).rows[0].promotionTotalAmount, 999);
    await query(`UPDATE "SellfoxProductDailySnapshot" SET payload=payload WHERE id='all'`);
    assert.equal((await query(`SELECT "promotionTotalAmount" FROM sellfox_profit_daily WHERE id='all'`)).rows[0].promotionTotalAmount, 1.5);
    await query(`UPDATE "SellfoxProductDailySnapshot" SET "promotionDiscount"=0 WHERE id='all'`);
    assert.deepEqual(adKeys.map(key => backfilled[key]), adBackfill);
    assert.deepEqual(storageKeys.map(key => backfilled[key]), storageBackfill);
    assert.deepEqual(miscKeys.map(key => backfilled[key]), miscBackfill);
    assert.deepEqual(optionalKeys.map(key => backfilled[key]), optionalBackfill);
    assert.deepEqual(contigKeys.map(key => backfilled[key]), contigBackfill);
    assert.equal(backfilled.storageFeeAmount, 4.25);
    assert.equal(backfilled.fbaStorageFeeAmount, 1.5);
    assert.equal(backfilled.adCost, 88.25); // 120000 does not reproject existing adCost from payload.adTotalCost
    assert.deepEqual(qtyKeys.map(key => backfilled[key]), [0, 1]);
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
      assert.doesNotMatch(sql.text, /s\.payload->>'(?:refundPrice|refundNum|commodityCost|shippingPrice|taxPrice|headTripPrice|avgPurchaseCost|amazonCommissionPrice|evaluationSaleNum|channelSaleNum|adSpCost|adSdCost|adSbCost|adSbvCost|adSbsCost|fbaStorageFeeAmount|fbaLongTermStorageFeeAmount|fbaRemovalFeeAmount|fbaDisposalFeeAmount|customAsinFee|customShopFee|serviceFeeAmount|storageFeeAmount|compensationAmount|evaluationFee|promotionTotalAmount|fbaOverageFeeAmount|chargebackAmount|guaranteeClaimAmount|digitalServicesFeeAmount|otherPriceAmount|shippingChargeAmount|regulatoryFeeAmount|couponPaymentAmount|sellerDealPaymentAmount|vineFeeAmount|starStorageFeeAmount|subscriptionAmount|fbaCustomerReturnAmount|fbaInboundConvenienceFeeAmount|inboundTransportationFeeAmount|shippingChargebackAmount|giftwrapChargebackAmount|costOfPointsGrantedAmount|orderOtherPriceAmount)'/);
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
        assert.deepEqual(adKeys.map(key => agent.rows[0][key]), adBackfill);
        assert.deepEqual(storageKeys.map(key => agent.rows[0][key]), storageBackfill);
        assert.deepEqual(miscKeys.map(key => agent.rows[0][key]), miscBackfill);
        assert.deepEqual(optionalKeys.map(key => agent.rows[0][key]), optionalBackfill);
        assert.deepEqual(contigKeys.map(key => agent.rows[0][key]), contigBackfill);
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
    assert.deepEqual(adKeys.map(key => all.rows[0][key]), adBackfill);
    assert.deepEqual(storageKeys.map(key => all.rows[0][key]), storageBackfill);
    assert.deepEqual(miscKeys.map(key => all.rows[0][key]), miscBackfill);
    assert.deepEqual(optionalKeys.map(key => all.rows[0][key]), optionalBackfill);
    assert.deepEqual(contigKeys.map(key => all.rows[0][key]), contigBackfill);
    assert.deepEqual(adKeys.map(key => all.totals[0][key]), adBackfill);
    assert.deepEqual(storageKeys.map(key => all.totals[0][key]), storageBackfill);
    assert.deepEqual(miscKeys.map(key => all.totals[0][key]), miscBackfill);
    assert.deepEqual(optionalKeys.map(key => all.totals[0][key]), optionalBackfill);
    assert.deepEqual(contigKeys.map(key => all.totals[0][key]), contigBackfill);
    assert.deepEqual(adKeys.map(key => settled.rows[0][key]), adZero);
    assert.deepEqual(storageKeys.map(key => settled.rows[0][key]), storageZero);
    assert.deepEqual(miscKeys.map(key => settled.rows[0][key]), miscZero);
    assert.deepEqual(optionalKeys.map(key => settled.rows[0][key]), optionalZero);
    assert.deepEqual(contigKeys.map(key => settled.rows[0][key]), contigZero);
    assert.deepEqual(adKeys.map(key => settled.totals[0][key]), adZero);
    assert.deepEqual(storageKeys.map(key => settled.totals[0][key]), storageZero);
    assert.deepEqual(miscKeys.map(key => settled.totals[0][key]), miscZero);
    assert.deepEqual(optionalKeys.map(key => settled.totals[0][key]), optionalZero);
    assert.deepEqual(contigKeys.map(key => settled.totals[0][key]), contigZero);
    assert.equal(all.total, 1); assert.equal(all.totals[0].saleRevenue, 100);
    assert.equal(all.rows[0].promotionDiscount, 0); assert.equal(all.totals[0].giftWrapFee, 0);
    assert.deepEqual(feeKeys.map(key => all.rows[0][key]), [2, 1, 3, 4, 5, 6.5, 0, -8]);
    assert.deepEqual(qtyKeys.map(key => all.rows[0][key]), [0, 1]);
    assert.deepEqual(qtyKeys.map(key => all.totals[0][key]), [0, 1]);
    assert.deepEqual(feeKeys.map(key => all.totals[0][key]), [2, 1, 3, 4, 5, 6.5, 0, -8]);
    assert.deepEqual(qtyKeys.map(key => settled.rows[0][key]), [0, 0]);
    assert.deepEqual(qtyKeys.map(key => settled.totals[0][key]), [0, 0]);
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
      VALUES ('fee','org','ws','s','2026-10-24','m2','m2','A','USD',$1::jsonb,now(),12.5,1.25),
        ('fee-null','org','ws','s','2026-10-24','m3','m3','B','USD',$2::jsonb,now(),NULL,NULL),
        ('fee-cad','org','ws','s','2026-10-24','mc','mc','C','CAD',$3::jsonb,now(),9,2);`, [
      JSON.stringify({ "userNameList":["陈馨"],"refundPrice":"2.5","refundNum":0,"commodityCost":3,"shippingPrice":4,"taxPrice":-0.5,"headTripPrice":1.5,"avgPurchaseCost":"2","amazonCommissionPrice":3,"evaluationSaleNum":"2","channelSaleNum":0, ...adChannels.insert, ...storageFees.insert, ...miscFees.insert, ...optionalFees.insert, ...contigFees.insert }),
      JSON.stringify({ "refundPrice":"invalid","refundNum":"","commodityCost":null,"shippingPrice":"Infinity","taxPrice":"1e999","headTripPrice":"invalid","avgPurchaseCost":null,"amazonCommissionPrice":"Infinity","evaluationSaleNum":"invalid","channelSaleNum":"Infinity", ...adChannels.invalid, ...storageFees.invalid, ...miscFees.invalid, ...optionalFees.invalid, ...contigFees.invalid }),
      JSON.stringify({ "refundPrice":10,"refundNum":1,"commodityCost":20,"shippingPrice":30,"taxPrice":40,"headTripPrice":50,"avgPurchaseCost":60,"amazonCommissionPrice":70,"evaluationSaleNum":4,"channelSaleNum":5, ...adChannels.cad, ...storageFees.cad, ...miscFees.cad, ...optionalFees.cad, ...contigFees.cad }),
    ]);
    // INSERT supplies fees only through payload; trigger replaces nullable defaults.
    const insertedFees = (await query('SELECT * FROM "SellfoxProductDailySnapshot" WHERE id=\'fee\'')).rows[0];
    assert.deepEqual(feeKeys.map(key => insertedFees[key]), [2.5, 0, 3, 4, -0.5, 1.5, 2, 3]);
    assert.deepEqual(qtyKeys.map(key => insertedFees[key]), [2, 0]);
    assert.deepEqual(adKeys.map(key => insertedFees[key]), adInserted);
    assert.deepEqual(storageKeys.map(key => insertedFees[key]), storageInserted);
    assert.deepEqual(miscKeys.map(key => insertedFees[key]), miscInserted);
    assert.deepEqual(optionalKeys.map(key => insertedFees[key]), optionalInserted);
    assert.deepEqual(contigKeys.map(key => insertedFees[key]), contigInserted);
    assert.equal(insertedFees.promotionDiscount, 12.5);
    assert.equal(insertedFees.promotionTotalAmount, 0);
    assert.deepEqual([insertedFees.starStorageFeeAmount, insertedFees.storageFeeAmount, insertedFees.fbaStorageFeeAmount, insertedFees.fbaLongTermStorageFeeAmount, insertedFees.fbaOverageFeeAmount], [5, 5, 0, 2.5, 2.5]);
    assert.deepEqual([insertedFees.shippingChargebackAmount, insertedFees.shippingChargeAmount, insertedFees.giftwrapChargebackAmount, insertedFees.giftWrapFee, insertedFees.orderOtherPriceAmount, insertedFees.otherPriceAmount], [10, 8, 11, 1.25, 13, 7]);
    const invalidFees = (await query('SELECT * FROM "SellfoxProductDailySnapshot" WHERE id=\'fee-null\'')).rows[0];
    assert.deepEqual(feeKeys.map(key => invalidFees[key]), [null, null, null, null, null, null, null, null]);
    assert.deepEqual(qtyKeys.map(key => invalidFees[key]), [null, null]);
    assert.deepEqual(adKeys.map(key => invalidFees[key]), adNull);
    assert.deepEqual(storageKeys.map(key => invalidFees[key]), storageNull);
    assert.deepEqual(miscKeys.map(key => invalidFees[key]), miscNull);
    assert.deepEqual(optionalKeys.map(key => invalidFees[key]), optionalNull);
    assert.deepEqual(contigKeys.map(key => invalidFees[key]), contigNull);
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
    assert.deepEqual(adKeys.map(key => combined[key]), adCombined);
    assert.deepEqual(storageKeys.map(key => combined[key]), storageCombined);
    assert.deepEqual(miscKeys.map(key => combined[key]), miscCombined);
    assert.deepEqual(optionalKeys.map(key => combined[key]), optionalCombined);
    assert.deepEqual(contigKeys.map(key => combined[key]), contigCombined);
    assert.deepEqual(adKeys.map(key => fees.totals.find(row => row.currency === "USD")?.[key]), adCombined);
    assert.deepEqual(storageKeys.map(key => fees.totals.find(row => row.currency === "USD")?.[key]), storageCombined);
    assert.deepEqual(miscKeys.map(key => fees.totals.find(row => row.currency === "USD")?.[key]), miscCombined);
    assert.deepEqual(optionalKeys.map(key => fees.totals.find(row => row.currency === "USD")?.[key]), optionalCombined);
    assert.deepEqual(contigKeys.map(key => fees.totals.find(row => row.currency === "USD")?.[key]), contigCombined);
    assert.deepEqual(adKeys.map(key => fees.totals.find(row => row.currency === "CAD")?.[key]), adCad);
    assert.deepEqual(storageKeys.map(key => fees.totals.find(row => row.currency === "CAD")?.[key]), storageCad);
    assert.deepEqual(miscKeys.map(key => fees.totals.find(row => row.currency === "CAD")?.[key]), miscCad);
    assert.deepEqual(optionalKeys.map(key => fees.totals.find(row => row.currency === "CAD")?.[key]), optionalCad);
    assert.deepEqual(contigKeys.map(key => fees.totals.find(row => row.currency === "CAD")?.[key]), contigCad);
    assert.deepEqual(qtyKeys.map(key => combined[key]), [2, 1]);
    assert.deepEqual(qtyKeys.map(key => fees.totals.find(row => row.currency === "USD")?.[key]), [2, 1]);
    assert.deepEqual(qtyKeys.map(key => fees.totals.find(row => row.currency === "CAD")?.[key]), [4, 5]);
    const nullFees = fees.rows.find(row => row.identity === "B")!;
    assert.deepEqual(qtyKeys.map(key => nullFees[key]), [0, 0]);
    assert.deepEqual(adKeys.map(key => nullFees[key]), adZero);
    assert.deepEqual(storageKeys.map(key => nullFees[key]), storageZero);
    assert.deepEqual(miscKeys.map(key => nullFees[key]), miscZero);
    assert.deepEqual(optionalKeys.map(key => nullFees[key]), optionalZero);
    assert.deepEqual(contigKeys.map(key => nullFees[key]), contigZero);
    assert.equal(nullFees.promotionDiscount, 0); assert.equal(nullFees.giftWrapFee, 0);
    assert.deepEqual(feeKeys.map(key => nullFees[key]), [0, 0, 0, 0, 0, 0, 0, 0]);
    assert.deepEqual(feeKeys.map(key => fees.totals.find(row => row.currency === "USD")?.[key]), [4.5, 1, 6, 8, 4.5, 8, 2, -5]);
    assert.deepEqual(feeKeys.map(key => fees.totals.find(row => row.currency === "CAD")?.[key]), [10, 1, 20, 30, 40, 50, 60, 70]);
    assert.equal(fees.totals.find(row => row.currency === "USD")?.promotionDiscount, 12.5);
    assert.equal(fees.totals.find(row => row.currency === "USD")?.giftWrapFee, 1.25);
    assert.equal(fees.totals.find(row => row.currency === "CAD")?.promotionDiscount, 9);
    for (const key of [...extraFeeKeys, ...qtyKeys, ...adKeys, ...storageKeys, ...miscKeys, ...optionalKeys, ...contigKeys]) {
      const sorted = await read("performance", `dimension=asin&sortBy=${key}&sortOrder=desc&pageSize=1`);
      assert.equal(sorted.rows[0].currency, "CAD");
      assert.deepEqual(sorted.totals, fees.totals);
    }
    globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => (await query(sql.text, sql.values)).rows } as unknown as PrismaClient;
    try {
      for (const exporting of [false, true]) for (const key of qtyKeys) for (const sortOrder of ["asc", "desc"]) {
        const agent = await readSellfoxAgentRows("performance", sellfoxBrowseQuery(new URL(`http://localhost/?reportDate=2026-10-24&sortBy=${key}&sortOrder=${sortOrder}`), "performance"), { organizationId: "org", workspaceId: "ws" }, exporting);
        assert.deepEqual(qtyKeys.map(key => agent.rows.find(row => row.id === "all")?.[key]), [0, 1]);
        assert.deepEqual(qtyKeys.map(key => agent.rows.find(row => row.id === "fee-null")?.[key]), [null, null]);
        assert.equal(agent.rows[0].id, sortOrder === "desc" ? "fee-cad" : key === "evaluationSaleNum" ? "all" : "fee");
      }
    } finally { globals.prisma = previous; }
    globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => (await query(sql.text, sql.values)).rows } as unknown as PrismaClient;
    try {
      for (const exporting of [false, true]) for (const key of adKeys) for (const sortOrder of ["asc", "desc"]) {
        const agent = await readSellfoxAgentRows("performance", sellfoxBrowseQuery(new URL(`http://localhost/?reportDate=2026-10-24&sortBy=${key}&sortOrder=${sortOrder}`), "performance"), { organizationId: "org", workspaceId: "ws" }, exporting);
        assert.deepEqual(adKeys.map(key => agent.rows.find(row => row.id === "all")?.[key]), adBackfill);
        assert.deepEqual(adKeys.map(key => agent.rows.find(row => row.id === "fee-null")?.[key]), adNull);
        assert.equal(agent.rows[0].id, sortOrder === "desc" ? "fee-cad" : key === "adSpCost" ? "fee" : "all");
      }
    } finally { globals.prisma = previous; }
    globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => (await query(sql.text, sql.values)).rows } as unknown as PrismaClient;
    try {
      for (const exporting of [false, true]) for (const key of storageKeys) for (const sortOrder of ["asc", "desc"]) {
        const agent = await readSellfoxAgentRows("performance", sellfoxBrowseQuery(new URL(`http://localhost/?reportDate=2026-10-24&sortBy=${key}&sortOrder=${sortOrder}`), "performance"), { organizationId: "org", workspaceId: "ws" }, exporting);
        assert.deepEqual(storageKeys.map(key => agent.rows.find(row => row.id === "all")?.[key]), storageBackfill);
        assert.deepEqual(miscKeys.map(key => agent.rows.find(row => row.id === "all")?.[key]), miscBackfill);
        assert.deepEqual(optionalKeys.map(key => agent.rows.find(row => row.id === "all")?.[key]), optionalBackfill);
        assert.deepEqual(contigKeys.map(key => agent.rows.find(row => row.id === "all")?.[key]), contigBackfill);
        assert.deepEqual(storageKeys.map(key => agent.rows.find(row => row.id === "fee-null")?.[key]), storageNull);
        assert.deepEqual(miscKeys.map(key => agent.rows.find(row => row.id === "fee-null")?.[key]), miscNull);
        assert.deepEqual(optionalKeys.map(key => agent.rows.find(row => row.id === "fee-null")?.[key]), optionalNull);
        assert.deepEqual(contigKeys.map(key => agent.rows.find(row => row.id === "fee-null")?.[key]), contigNull);
        assert.equal(agent.rows[0].id, sortOrder === "desc" ? "fee-cad" : key === "fbaStorageFeeAmount" ? "fee" : "all");
      }
    } finally { globals.prisma = previous; }
    globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => (await query(sql.text, sql.values)).rows } as unknown as PrismaClient;
    try {
      for (const exporting of [false, true]) for (const key of miscKeys) for (const sortOrder of ["asc", "desc"]) {
        const agent = await readSellfoxAgentRows("performance", sellfoxBrowseQuery(new URL(`http://localhost/?reportDate=2026-10-24&sortBy=${key}&sortOrder=${sortOrder}`), "performance"), { organizationId: "org", workspaceId: "ws" }, exporting);
        assert.deepEqual(miscKeys.map(key => agent.rows.find(row => row.id === "all")?.[key]), miscBackfill);
        assert.deepEqual(optionalKeys.map(key => agent.rows.find(row => row.id === "all")?.[key]), optionalBackfill);
        assert.deepEqual(contigKeys.map(key => agent.rows.find(row => row.id === "all")?.[key]), contigBackfill);
        assert.deepEqual(miscKeys.map(key => agent.rows.find(row => row.id === "fee-null")?.[key]), miscNull);
        assert.deepEqual(optionalKeys.map(key => agent.rows.find(row => row.id === "fee-null")?.[key]), optionalNull);
        assert.deepEqual(contigKeys.map(key => agent.rows.find(row => row.id === "fee-null")?.[key]), contigNull);
        assert.equal(agent.rows[0].id, sortOrder === "desc" ? "fee-cad" : key === "customAsinFee" ? "fee" : "all");
      }
    } finally { globals.prisma = previous; }
    globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => (await query(sql.text, sql.values)).rows } as unknown as PrismaClient;
    try {
      for (const exporting of [false, true]) for (const key of optionalKeys) for (const sortOrder of ["asc", "desc"]) {
        const agent = await readSellfoxAgentRows("performance", sellfoxBrowseQuery(new URL(`http://localhost/?reportDate=2026-10-24&sortBy=${key}&sortOrder=${sortOrder}`), "performance"), { organizationId: "org", workspaceId: "ws" }, exporting);
        assert.deepEqual(optionalKeys.map(key => agent.rows.find(row => row.id === "all")?.[key]), optionalBackfill);
        assert.deepEqual(contigKeys.map(key => agent.rows.find(row => row.id === "all")?.[key]), contigBackfill);
        assert.deepEqual(optionalKeys.map(key => agent.rows.find(row => row.id === "fee-null")?.[key]), optionalNull);
        assert.deepEqual(contigKeys.map(key => agent.rows.find(row => row.id === "fee-null")?.[key]), contigNull);
        assert.equal(agent.rows[0].id, sortOrder === "desc" ? "fee-cad" : key === "promotionTotalAmount" ? "fee" : "all");
      }
    } finally { globals.prisma = previous; }
    globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => (await query(sql.text, sql.values)).rows } as unknown as PrismaClient;
    try {
      for (const exporting of [false, true]) for (const key of contigKeys) for (const sortOrder of ["asc", "desc"]) {
        const agent = await readSellfoxAgentRows("performance", sellfoxBrowseQuery(new URL(`http://localhost/?reportDate=2026-10-24&sortBy=${key}&sortOrder=${sortOrder}`), "performance"), { organizationId: "org", workspaceId: "ws" }, exporting);
        assert.deepEqual(contigKeys.map(key => agent.rows.find(row => row.id === "all")?.[key]), contigBackfill);
        assert.deepEqual(contigKeys.map(key => agent.rows.find(row => row.id === "fee-null")?.[key]), contigNull);
        assert.equal(agent.rows[0].id, sortOrder === "desc" ? "fee-cad" : contigInserted[contigKeys.indexOf(key)] < contigBackfill[contigKeys.indexOf(key)] ? "fee" : "all");
      }
    } finally { globals.prisma = previous; }
    const paged = await read("performance", "dimension=asin&pageSize=1");
    assert.equal(paged.rows.length, 1); assert.deepEqual(paged.totals, fees.totals);
    const settledFees = await read("performance", "dimension=asin&onlySettle=1");
    assert.equal(settledFees.totals[0].promotionDiscount, 0);
    assert.equal(settledFees.totals[0].giftWrapFee, 0);
    // UPDATE OF payload refreshes all prior fees/quantities and new ad costs, clearing missing keys.
    await query('UPDATE "SellfoxProductDailySnapshot" SET payload=$1::jsonb WHERE id=\'fee\'', [JSON.stringify({ ...Object.fromEntries([...adKeys, ...storageKeys, ...miscKeys, ...optionalKeys, ...contigKeys].map(key => [key, "0"])), refundPrice: 0, refundNum: "2.5", commodityCost: "", shippingPrice: "bad", taxPrice: null, headTripPrice: "0", avgPurchaseCost: "2.5", amazonCommissionPrice: "bad", evaluationSaleNum: "0", channelSaleNum: "2" })]);
    const updatedFees = (await query('SELECT * FROM "SellfoxProductDailySnapshot" WHERE id=\'fee\'')).rows[0];
    assert.deepEqual(feeKeys.map(key => updatedFees[key]), [0, 2.5, null, null, null, 0, 2.5, null]);
    assert.deepEqual(qtyKeys.map(key => updatedFees[key]), [0, 2]);
    assert.deepEqual(adKeys.map(key => updatedFees[key]), adZero);
    assert.deepEqual(storageKeys.map(key => updatedFees[key]), storageZero);
    assert.deepEqual(miscKeys.map(key => updatedFees[key]), miscZero);
    assert.deepEqual(optionalKeys.map(key => updatedFees[key]), optionalZero);
    assert.deepEqual(contigKeys.map(key => updatedFees[key]), contigZero);
    assert.equal(updatedFees.promotionDiscount, 12.5); assert.equal(updatedFees.giftWrapFee, 1.25);
    const updated = await read("performance", "dimension=msku&searchType=msku&search=m2&exactMatch=1");
    assert.deepEqual(feeKeys.map(key => updated.rows[0][key]), [0, 2.5, 0, 0, 0, 0, 2.5, 0]);
    assert.deepEqual(feeKeys.map(key => updated.totals[0][key]), [0, 2.5, 0, 0, 0, 0, 2.5, 0]);
    await query('UPDATE "SellfoxProductDailySnapshot" SET payload=\'{}\'::jsonb WHERE id=\'fee\'');
    const cleared = (await query('SELECT * FROM sellfox_profit_daily WHERE id=\'fee\'')).rows[0];
    assert.deepEqual(feeKeys.map(key => cleared[key]), [null, null, null, null, null, null, null, null]);
    assert.deepEqual(cleared.userNameList, []);
    assert.deepEqual(adKeys.map(key => cleared[key]), adNull);
    assert.deepEqual(storageKeys.map(key => cleared[key]), storageNull);
    assert.deepEqual(miscKeys.map(key => cleared[key]), miscNull);
    assert.deepEqual(optionalKeys.map(key => cleared[key]), optionalNull);
    assert.deepEqual(contigKeys.map(key => cleared[key]), contigNull);
    assert.deepEqual(qtyKeys.map(key => cleared[key]), [null, null]);
    // Use the same numeric contract for each new typed fact; Listing names are never aliases.
    for (const value of [null, "", " ", "bad", "Infinity", "-Infinity", "NaN", "1e999", {}, [], true]) {
      await query('UPDATE "SellfoxProductDailySnapshot" SET payload=$1::jsonb WHERE id=\'fee\'', [JSON.stringify(Object.fromEntries([...extraFeeKeys, ...qtyKeys, ...adKeys, ...storageKeys, ...miscKeys, ...optionalKeys, ...contigKeys].map(key => [key, value])))]);
      const invalid = (await query('SELECT * FROM sellfox_profit_daily WHERE id=\'fee\'')).rows[0];
      assert.deepEqual(extraFeeKeys.map(key => invalid[key]), [null, null, null]);
      assert.deepEqual(adKeys.map(key => invalid[key]), adNull);
      assert.deepEqual(storageKeys.map(key => invalid[key]), storageNull);
      assert.deepEqual(miscKeys.map(key => invalid[key]), miscNull);
      assert.deepEqual(optionalKeys.map(key => invalid[key]), optionalNull);
      assert.deepEqual(contigKeys.map(key => invalid[key]), contigNull);
      assert.deepEqual(qtyKeys.map(key => invalid[key]), [null, null]);
    }
    await query('UPDATE "SellfoxProductDailySnapshot" SET payload=$1::jsonb WHERE id=\'fee\'', [JSON.stringify({ headTripCost: 999, purchaseCost: 999, referralFee: 999, fbaFees: 999, monthlyStorageFee: 999 })]);
    const listingNames = (await query('SELECT * FROM sellfox_profit_daily WHERE id=\'fee\'')).rows[0];
    assert.deepEqual(extraFeeKeys.map(key => listingNames[key]), [null, null, null]);
    assert.deepEqual(storageKeys.map(key => listingNames[key]), storageNull);
    assert.deepEqual(miscKeys.map(key => listingNames[key]), miscNull);
    assert.deepEqual(optionalKeys.map(key => listingNames[key]), optionalNull);
    assert.deepEqual(contigKeys.map(key => listingNames[key]), contigNull);
    // Catalog supplementation: execute both aggregation levels and Agent long-table SQL
    // in disposable PostgreSQL-compatible storage, never a persistent database.
    await query(`INSERT INTO sellfox_listing_current (id,"organizationId","workspaceId","storeId",msku,asin,brand,"productTags",price) VALUES
      ('cat-1','org','ws','s','cat1','CAT','品牌','新品、重点',0),
      ('cat-2','org','ws','s','cat2','CAT','品牌','新品、重点',0),
      ('cat-sibling','org','ws','s','aaa','CAT','错误兄弟','错误',999),
      ('cat-foreign','other','ws','s','cat1','CAT','其他组织','错误',999),
      ('cat-workspace','org','other','s','cat1','CAT','其他工作区','错误',999),
      ('cat-store','org','ws','foreign','cat1','CAT','其他店铺','错误',999),
      ('cat-sort','org','ws','s','sort','SORT','A','A',25);
      INSERT INTO "SellfoxSalesDayCoverage" VALUES ('s','2026-10-20','2026-10-25'),('s','2026-10-21','2026-10-25');
      INSERT INTO "SellfoxSalesDailySnapshot" (id,"organizationId","workspaceId","storeId","reportDate","sourceKey",msku,asin,sku,quantity,revenue,currency,payload,"updatedAt","syncedAt",orders) VALUES
      ('cat1','org','ws','s','2026-10-20','cat1','cat1','CAT','catalog',1,10,'USD','{}',now(),'2026-10-25',1),
      ('cat2','org','ws','s','2026-10-21','cat2','cat2','CAT','catalog',2,20,'USD','{}',now(),'2026-10-25',2),
      ('cat-sort','org','ws','s','2026-10-20','sort','sort','SORT','sort',3,30,'USD','{}',now(),'2026-10-25',3),
      ('cat-null','org','ws','s','2026-10-20','missing','missing','MISSING','missing',4,40,'USD','{}',now(),'2026-10-25',4);`);
    const catalogQuery = (params = "") => sellfoxBrowseQuery(new URL(`http://localhost/?from=2026-10-20&to=2026-10-21&dimension=sku&${params}`), "sales");
    const catalog = async (params = "") => {
      const sql = workbenchReadSql("sales", catalogQuery(params), { organizationId: "org", workspaceId: "ws" });
      return (await query(sql.text, sql.values)).rows[0] as { rows: Record<string, unknown>[]; totals: Record<string, unknown>[]; total: number };
    };
    const fields = (row: Record<string, unknown>) => [row.brand, row.productTags, row.price];
    const unanimous = await catalog();
    assert.deepEqual(fields(unanimous.rows.find(r => r.identity === "catalog")!), ["品牌", "新品、重点", 0]);
    assert.deepEqual(fields(unanimous.rows.find(r => r.identity === "missing")!), [null, null, null]);
    assert.equal(unanimous.totals[0].subtotal, 10);
    assert.ok(!Object.hasOwn(unanimous.totals[0], "price"));
    for (const key of ["brand", "productTags", "price"]) {
      const sorted = await catalog(`sortBy=${key}&sortOrder=asc&pageSize=1`);
      assert.equal(sorted.rows[0].identity, key === "price" ? "catalog" : "sort");
      assert.equal(sorted.total, 3); assert.deepEqual(sorted.totals, unanimous.totals);
      const desc = await catalog(`sortBy=${key}&sortOrder=desc&pageSize=1`);
      assert.equal(desc.rows[0].identity, key === "price" ? "sort" : "catalog");
    }
    // Different values and partially missing values must clear the final row across days.
    for (const value of [null, "冲突"]) {
      await query('UPDATE sellfox_listing_current SET brand=$1,"productTags"=$1,price=$2 WHERE id=\'cat-2\'', [value, value === null ? null : 99]);
      assert.deepEqual(fields((await catalog()).rows.find(r => r.identity === "catalog")!), [null, null, null]);
    }
    // The same member disagreement within one day also propagates through grouped.
    await query('UPDATE "SellfoxSalesDailySnapshot" SET "reportDate"=\'2026-10-20\' WHERE id=\'cat2\'');
    assert.deepEqual(fields((await catalog()).rows.find(r => r.identity === "catalog")!), [null, null, null]);
    globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => (await query(sql.text, sql.values)).rows } as unknown as PrismaClient;
    try {
      for (const exporting of [false, true]) for (const key of ["brand", "productTags", "price"]) {
        const agent = await readSellfoxAgentRows("sales", catalogQuery(`sortBy=${key}&sortOrder=asc`), { organizationId: "org", workspaceId: "ws" }, exporting);
        assert.equal(agent.pagination.total, 4);
        assert.deepEqual(fields(agent.rows.find(r => r.id === "cat1")!), ["品牌", "新品、重点", 0]);
        assert.deepEqual(fields(agent.rows.find(r => r.id === "cat-null")!), [null, null, null]);
      }
    } finally { globals.prisma = previous; }
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
      console.log("Sales/profit 80000 + 90000 + 100000 + 110000 + 120000 + 130000 + 140000 + 150000 + 160000 migration, contiguous coupon/deal/vine/star/sub/return/inbound and companion fees, optional promo/overage/chargeback/claim/dsf/other/buyer/regulatory fees, custom/service/storage/compensation/evaluation fees, storage/removal/disposal fees, ad channel costs, fee extras and evaluation/channel quantities, trigger, salesperson containment/facets/totals/Agent: PASS (disposable PGlite)");
    } finally { await db.close(); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
