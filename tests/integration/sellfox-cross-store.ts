/** Optional PostgreSQL regression; all fixtures are isolated and rolled back. */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import type { Prisma, PrismaClient } from "@prisma/client";
import { readSellfoxWorkbench } from "@/lib/sellfox/workbench-read";
import { sellfoxBrowseQuery } from "@/lib/sellfox/browse-query";

type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
export async function verifySellfoxCrossStoreSql(query: Query) {
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  const schema = `sellfox_cross_store_${randomUUID().replaceAll("-", "")}`;
  await query("BEGIN");
  try {
    await query(`CREATE SCHEMA "${schema}"; SET LOCAL search_path TO "${schema}"`);
    await query(`CREATE TABLE "SellfoxStore" (id text,"organizationId" text,"workspaceId" text,"externalId" text,name text,marketplace text);
      INSERT INTO "SellfoxStore" VALUES ('s1','org','ws','shop1','店一','US'),('s2','org','ws','shop2','店二','US'),('s3','org','ws','shop3','无关店','US'),('foreign','other','ws','foreign','其他组织','US');
      CREATE TABLE sellfox_listing_current (id text,"organizationId" text,"workspaceId" text,"storeId" text,msku text,asin text,"parentAsin" text,title text,"mainImage" text,price float,
        developer text,spu text,brand text,rating text,"buyBoxWinner" text,fulfillment text,"productTagNames" text[]);
      INSERT INTO sellfox_listing_current VALUES
        ('l1','org','ws','s1','shared','A','P','商品',NULL,10,'开发员甲','SPU甲',NULL,NULL,NULL,NULL,'{}'),
        ('l2','org','ws','s2','shared','A','P','商品',NULL,10,'开发员甲','SPU甲',NULL,NULL,NULL,NULL,'{}'),
        ('l3','org','ws','s1','solo','B','Q','单品',NULL,20,'开发员乙','SPU乙',NULL,NULL,NULL,NULL,'{}');
      ALTER TABLE sellfox_listing_current ADD COLUMN "productTags" text;
      CREATE TABLE sellfox_sales_daily (id text,"organizationId" text,"workspaceId" text,"storeId" text,"reportDate" text,asin text,msku text,sku text,currency text,quantity float,revenue float,orders float,complete boolean);
      INSERT INTO sellfox_sales_daily VALUES
        ('a','org','ws','s1','2026-10-24','A','shared','sku','USD',2,20,1,true),
        ('b','org','ws','s2','2026-10-24','A','shared','sku','USD',3,30,2,true),
        ('c','org','ws','s1','2026-10-25','A','shared','sku','USD',7,70,3,true),
        ('d','org','ws','s1','2026-10-24','B','solo','solo','USD',5,50,4,true),
        ('e','org','ws','s2','2026-10-24','A','shared','sku','CAD',11,110,5,true),
        ('f','org','ws','s1','2026-10-24','U','unknown','unknown','USD',13,130,6,true),
        ('g','org','ws','s2','2026-10-24','U','unknown','unknown','USD',17,170,7,true),
        ('h','other','ws','foreign','2026-10-24','A','shared','sku','USD',1000,1000,1000,true);
      CREATE TABLE "SellfoxProductDailySnapshot" AS SELECT id,"organizationId","workspaceId","storeId","reportDate",asin,msku,sku,currency,quantity AS "saleQuantity",revenue AS "saleRevenue",orders AS "orderNum",
        false AS "onlySettle",NULL::text AS title,NULL::text AS "parentAsin",NULL::text AS "imageUrl",1::float AS "grossProfit",1::float AS "adCost",NULL::float AS "promotionDiscount",NULL::float AS "giftWrapFee",1::float AS "netRevenue",NULL::float AS "refundRate",NULL::float AS "refundPrice",NULL::float AS "refundNum",NULL::float AS "commodityCost",NULL::float AS "shippingPrice",NULL::float AS "taxPrice",1::float AS "fbaQuantity",0::float AS "fbmQuantity",ARRAY[]::text[] AS "userNameList",'{}'::jsonb AS payload FROM sellfox_sales_daily;
    ALTER TABLE "SellfoxProductDailySnapshot"
      ADD COLUMN "headTripPrice" float, ADD COLUMN "avgPurchaseCost" float, ADD COLUMN "amazonCommissionPrice" float,
      ADD COLUMN "evaluationSaleNum" float, ADD COLUMN "channelSaleNum" float,
      ADD COLUMN "adSpCost" float, ADD COLUMN "adSdCost" float, ADD COLUMN "adSbCost" float,
      ADD COLUMN "adSbvCost" float, ADD COLUMN "adSbsCost" float,
      ADD COLUMN "fbaStorageFeeAmount" float, ADD COLUMN "fbaLongTermStorageFeeAmount" float, ADD COLUMN "fbaRemovalFeeAmount" float, ADD COLUMN "fbaDisposalFeeAmount" float,
      ADD COLUMN "customAsinFee" float, ADD COLUMN "customShopFee" float, ADD COLUMN "serviceFeeAmount" float, ADD COLUMN "storageFeeAmount" float, ADD COLUMN "compensationAmount" float, ADD COLUMN "evaluationFee" float,
      ADD COLUMN "promotionTotalAmount" float, ADD COLUMN "fbaOverageFeeAmount" float, ADD COLUMN "chargebackAmount" float, ADD COLUMN "guaranteeClaimAmount" float, ADD COLUMN "digitalServicesFeeAmount" float, ADD COLUMN "otherPriceAmount" float, ADD COLUMN "shippingChargeAmount" float, ADD COLUMN "regulatoryFeeAmount" float,
      ADD COLUMN "couponPaymentAmount" float, ADD COLUMN "sellerDealPaymentAmount" float, ADD COLUMN "vineFeeAmount" float, ADD COLUMN "starStorageFeeAmount" float, ADD COLUMN "subscriptionAmount" float, ADD COLUMN "fbaCustomerReturnAmount" float, ADD COLUMN "fbaInboundConvenienceFeeAmount" float, ADD COLUMN "inboundTransportationFeeAmount" float, ADD COLUMN "shippingChargebackAmount" float, ADD COLUMN "giftwrapChargebackAmount" float, ADD COLUMN "costOfPointsGrantedAmount" float, ADD COLUMN "orderOtherPriceAmount" float;
      CREATE TABLE sellfox_inventory_current ("organizationId" text,"workspaceId" text,"storeId" text,msku text,quantity float,"totalInventory" float,"capturedAt" text);
      INSERT INTO sellfox_inventory_current VALUES
        ('org','ws','s1','shared',10,12,'2026-10-26'),('org','ws','s2','shared',20,25,'2026-10-26'),
        ('org','ws','s1','solo',30,35,'2026-10-26'),('org','ws','s1','unknown',40,45,'2026-10-26'),
        ('org','ws','s3','shared',1000,1000,'2026-10-26'),('other','ws','s1','shared',1000,1000,'2026-10-26');`);
    globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => (await query(sql.text, sql.values)).rows } as unknown as PrismaClient;
    const read = (domain: "sales" | "performance", params: string) => readSellfoxWorkbench(domain,
      sellfoxBrowseQuery(new URL(`http://localhost/?from=2026-10-24&to=2026-10-25&${params}`)), { organizationId: "org", workspaceId: "ws" });
    for (const [domain, dimension] of [["sales", "developer"], ["sales", "spu"], ["performance", "developer"]] as const) {
      const result = await read(domain, `dimension=${dimension}`);
      const label = dimension === "spu" ? "SPU甲" : "开发员甲";
      const matching = result.rows.filter(row => row.identity === label && row.currency === "USD");
      assert.equal(matching.length, 1, `${domain}/${dimension} merges the same name across stores`);
      const row = matching[0];
      assert.equal(row[domain === "sales" ? "quantity" : "saleQuantity"], 12);
      assert.equal(row.storeId, null); assert.equal(row.marketplace, null); assert.equal(row.name, label);
      assert.deepEqual(row.members, ["shared"]);
      assert.equal(row.msku, null); // One MSKU string represents two store-specific members.
      assert.equal(row.fulfillable, 30); assert.equal(row.totalInventory, 37);
      assert.equal("stockMembers" in row, false);
      if (domain === "sales") {
        assert.deepEqual(row.daily, { "2026-10-24": 5, "2026-10-25": 7 });
        assert.equal(row.subtotal, 12);
      }
      const cad = result.rows.find(row => row.identity === label && row.currency === "CAD")!;
      assert.equal(cad[domain === "sales" ? "quantity" : "saleQuantity"], 11);
      assert.equal(cad.storeId, "s2"); assert.equal(cad.marketplace, "US"); assert.equal(cad.fulfillable, 20);
      const single = result.rows.find(row => row.identity === (dimension === "spu" ? "SPU乙" : "开发员乙"))!;
      assert.equal(single.storeId, "s1"); assert.equal(single.marketplace, "US"); assert.equal(single.fulfillable, 30);
      const unassigned = result.rows.find(row => row.identity === (dimension === "spu" ? "未分配SPU" : "未分配开发员"))!;
      assert.equal(unassigned[domain === "sales" ? "quantity" : "saleQuantity"], 30);
      assert.equal(unassigned.storeId, null);
      assert.equal(unassigned.fulfillable, null); assert.equal(unassigned.totalInventory, null);
      const filtered = await read(domain, `dimension=${dimension}&storeId=s1&currency=USD`);
      const filteredRow = filtered.rows.find(row => row.identity === label)!;
      assert.equal(filteredRow[domain === "sales" ? "quantity" : "saleQuantity"], 9);
      assert.equal(filteredRow.storeId, "s1"); assert.equal(filteredRow.marketplace, "US"); assert.equal(filteredRow.fulfillable, 10);
      const paged = await read(domain, `dimension=${dimension}&pageSize=1`);
      assert.equal(paged.rows.length, 1); assert.equal(paged.pagination.total, result.pagination.total);
      assert.deepEqual(paged.totals, result.totals);
    }
    for (const domain of ["sales", "performance"] as const) {
      for (const dimension of ["store", "asin", "parentAsin", "msku", "sku"]) {
        const result = await read(domain, `dimension=${dimension}&currency=USD`);
        assert.ok(result.rows.every(row => row.storeId != null));
        if (dimension === "store") assert.equal(result.rows.length, 2);
        else assert.equal(result.rows.filter(row => row.members instanceof Array && row.members.includes("shared")).length, 2);
      }
    }
  } finally {
    globals.prisma = previous;
    await query("ROLLBACK");
  }
}

test("developer/SPU SQL merges stores, isolates currency and supplements exact member stock", { skip: !process.env.SELLFOX_P0_TEST_DATABASE_URL }, async () => {
  const client = new Client({ connectionString: process.env.SELLFOX_P0_TEST_DATABASE_URL });
  try { await client.connect(); await verifySellfoxCrossStoreSql((sql, values) => client.query(sql, values)); }
  finally { await client.end(); }
});
