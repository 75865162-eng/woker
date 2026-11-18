import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;

/**
 * Offline DDL verification for the P1/P2 migrations using disposable PGlite.
 * Builds the minimal prerequisite schema the new migrations depend on, applies each
 * migration verbatim, then asserts columns / indexes / view definitions.
 */
async function withPglite(fn: (q: Query) => Promise<void>) {
  const { PGlite } = await import("@electric-sql/pglite") as {
    PGlite: new () => { query: Query; exec: (sql: string) => Promise<{ rows: Record<string, unknown>[] }[]>; close: () => Promise<void> };
  };
  const db = new PGlite();
  const q: Query = async (sql, values) => values?.length ? db.query(sql, values) : (await db.exec(sql)).at(-1)!;
  try {
    await fn(q);
  } finally {
    await db.close();
  }
}

async function minimalPrerequisites(q: Query) {
  await q(`
    CREATE TABLE "SellfoxStore" (id text PRIMARY KEY, "organizationId" text, "workspaceId" text, "externalId" text, name text, marketplace text);
    CREATE TABLE "SellfoxSalesDayCoverage" ("storeId" text, "reportDate" text, "capturedAt" timestamp, "rowWrites" int, PRIMARY KEY ("storeId","reportDate"));
    CREATE TABLE "SellfoxSalesDailySnapshot" (
      id text PRIMARY KEY, "organizationId" text, "workspaceId" text, "storeId" text, "reportDate" text,
      "sourceKey" text, asin text, msku text, sku text, quantity int, revenue decimal(20,4), currency text,
      "syncedAt" timestamp, "createdAt" timestamp, "updatedAt" timestamp, orders int,
      UNIQUE ("storeId","reportDate","sourceKey")
    );
    CREATE TABLE "SellfoxSnapshotHead" ("storeId" text, resource text, "capturedAt" timestamp, PRIMARY KEY ("storeId","resource"));
    CREATE TABLE "SellfoxListingSnapshot" (
      id text PRIMARY KEY, "organizationId" text, "workspaceId" text, "storeId" text, "sourceKey" text,
      "capturedAt" timestamp, asin text, msku text, sku text, brand text, "productTagNames" text[],
      developer text, spu text, price decimal(20,4)
    );
    CREATE TABLE "SellfoxProductDailySnapshot" (
      id text PRIMARY KEY, "organizationId" text, "workspaceId" text, "storeId" text, "reportDate" text,
      "sourceKey" text, msku text, "onlySettle" boolean, "saleQuantity" int, "saleRevenue" decimal(20,4),
      "grossProfit" decimal(20,4), "netRevenue" decimal(20,4), "adCost" decimal(20,4), currency text, "syncedAt" timestamp
    );
    CREATE TABLE "SellfoxFbaInventorySnapshot" (id text PRIMARY KEY, "organizationId" text, "workspaceId" text, "storeId" text, "capturedAt" timestamp, "sourceKey" text, msku text);
    CREATE VIEW sellfox_listing_current AS SELECT t.id,t."organizationId",t."workspaceId",t."storeId",t."sourceKey",
      t."capturedAt",t.asin,t.msku,t.sku,NULL::text AS "parentAsin",NULL::text AS title,NULL::text AS status,
      t.price,NULL::text AS currency,NULL::int AS fulfillable,NULL::int AS "sales7",NULL::int AS "sales14",NULL::int AS "sales30",
      NULL::decimal(20,4) AS "revenue7",NULL::decimal(20,4) AS "revenue14",NULL::decimal(20,4) AS "revenue30",
      NULL::decimal(20,4) AS "adSpend7",NULL::decimal(20,4) AS "adSpend14",NULL::decimal(20,4) AS "adSpend30",
      NULL::text AS "sourceUpdatedAt",s."externalId" AS "shopExternalId",s.name,s.marketplace,
      NULL::text AS fnsku,NULL::text AS "parentSku",NULL::text AS "mainImage",t.brand,
      NULL::text AS "amazonBrand",NULL::text AS "productTags",NULL::text AS "openDate",NULL::text AS "firstSaleDate",
      NULL::text AS "bsrCategory",NULL::text AS "buyBoxWinner",NULL::text AS fulfillment,NULL::text AS rating,
      NULL::float AS "ratingCount",NULL::float AS "bsrRank",NULL::decimal(20,4) AS "purchaseCost",
      NULL::decimal(20,4) AS "fbaFees",NULL::decimal(20,4) AS "referralFee",NULL::decimal(20,4) AS "totalFee",
      NULL::float AS "headTripCost",NULL::float AS "reservedQty",NULL::decimal(20,4) AS "shippingPrice",
      NULL::decimal(20,4) AS "profitPrice",NULL::float AS "profitRate",NULL::float AS "listingQuantity",
      NULL::float AS unsellable,NULL::float AS warehousing,t."productTagNames",NULL::float AS "ratingValue",
      NULL::text AS "dxmPublishState",t.developer,t.spu
      FROM "SellfoxListingSnapshot" t JOIN "SellfoxStore" s ON s.id=t."storeId";
  `);
}

const migrations = {
  complete: "prisma/migrations/20261219010000_sellfox_p1_complete_column/migration.sql",
  indexes: "prisma/migrations/20261219020000_sellfox_p1_indexes/migration.sql",
  profile: "prisma/migrations/20261219030000_sellfox_p1_listing_profile/migration.sql",
  aggregates: "prisma/migrations/20261219040000_sellfox_p2_aggregates/migration.sql",
};

test("P1 coverage migration adds physical complete column and rebuilds view without EXISTS", async () => {
  await withPglite(async (q) => {
    await minimalPrerequisites(q);
    await q(`CREATE VIEW sellfox_sales_daily AS SELECT t.id,t."organizationId",t."workspaceId",t."storeId",
      t."sourceKey",t."reportDate",t.asin,t.msku,t.sku,t.quantity,t.revenue,t.currency,t."syncedAt",
      s."externalId" AS "shopExternalId",s.name,s.marketplace,
      (EXISTS (SELECT 1 FROM "SellfoxSalesDayCoverage" c WHERE c."storeId"=t."storeId" AND c."reportDate"=t."reportDate" AND c."capturedAt"=t."syncedAt")) AS complete,
      t.orders FROM "SellfoxSalesDailySnapshot" t JOIN "SellfoxStore" s ON s.id=t."storeId";`);
    // seed a matching coverage row + fact row to verify backfill
    await q(`INSERT INTO "SellfoxStore" VALUES ('s','o','w','shop','店','US');
      INSERT INTO "SellfoxSalesDailySnapshot" (id,"organizationId","workspaceId","storeId","reportDate","sourceKey","syncedAt","updatedAt") VALUES ('f','o','w','s','2026-11-18','k','2026-11-19',now());
      INSERT INTO "SellfoxSalesDayCoverage" VALUES ('s','2026-11-18','2026-11-19',3);`);
    await q(await readFile(migrations.complete, "utf8"));
    const col = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name='SellfoxSalesDailySnapshot' AND column_name='complete'`)).rows;
    assert.equal(col.length, 1);
    const completeVal = (await q(`SELECT complete FROM "SellfoxSalesDailySnapshot" WHERE id='f'`)).rows[0].complete;
    assert.equal(completeVal, true, "backfill must mark matching row complete");
    const viewDef = (await q(`SELECT pg_get_viewdef('sellfox_sales_daily'::regclass, true) AS d`)).rows[0].d as string;
    assert.ok(!viewDef.includes("SellfoxSalesDayCoverage"), "view must not reference coverage table");
    assert.ok(viewDef.includes("complete"), "view must expose complete");
  });
});

test("P1 index migration creates lateral-asin and coverage-batch indexes", async () => {
  await withPglite(async (q) => {
    await minimalPrerequisites(q);
    await q(await readFile(migrations.indexes, "utf8"));
    const names = (await q(`SELECT indexname FROM pg_indexes WHERE schemaname='public'`)).rows.map((r) => r.indexname);
    assert.ok(names.includes("sellfox_listing_lateral_asin"));
    assert.ok(names.includes("sellfox_sales_day_coverage_batch"));
  });
});

test("P1 profile migration creates aligned table from the view and P2 creates all aggregate tables", async () => {
  await withPglite(async (q) => {
    await minimalPrerequisites(q);
    await q(await readFile(migrations.profile, "utf8"));
    const profileCols = (await q(`SELECT column_name FROM information_schema.columns WHERE table_name='SellfoxListingProfile'`)).rows.map((r) => r.column_name);
    for (const c of ["id", "storeId", "sourceKey", "capturedAt", "productTagNames", "developer", "spu", "headCapturedAt", "syncedAt"]) {
      assert.ok(profileCols.includes(c), `profile missing ${c}`);
    }
    await q(await readFile(migrations.aggregates, "utf8"));
    const tables = (await q(`SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_name LIKE 'Sellfox%Agg%'`)).rows.map((r) => r.table_name).sort();
    assert.deepEqual(tables, ["SellfoxAdsAggDaily", "SellfoxOverviewAgg", "SellfoxProfitAggDaily", "SellfoxSalesAggDaily", "SellfoxSalesAggEntity"]);
    // amounts must be numeric, never double precision / float
    const amountTypes = (await q(`SELECT table_name,column_name,data_type FROM information_schema.columns
      WHERE table_name IN ('SellfoxSalesAggDaily','SellfoxProfitAggDaily','SellfoxAdsAggDaily')
        AND column_name IN ('revenueOriginal','saleRevenue','grossProfit','netRevenue','cost','adSales')`)).rows;
    assert.ok(amountTypes.length > 0);
    for (const row of amountTypes) assert.equal(row.data_type, "numeric", `${row.column_name} must be numeric`);
  });
});
