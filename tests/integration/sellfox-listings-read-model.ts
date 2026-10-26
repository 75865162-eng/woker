/** Disposable PostgreSQL/PGlite only. Caller supplies the connection; no env/API access. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";
import { workbenchReadSql, readSellfoxWorkbench } from "@/lib/sellfox/workbench-read";
import { readSellfoxAgentRows } from "@/lib/sellfox/agent-read";
import { sellfoxBrowseQuery } from "@/lib/sellfox/browse-query";

type Row = Record<string, unknown>;
type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Row[] }>;
type Statement = { text: string; values: unknown[] };
type Result = { rows: Row[]; total: number; totals: Row[]; facets: { productTags: string[]; brands: string[] } };
const migrationPath = "prisma/migrations/20261026050000_sellfox_listing_typed_read_model/migration.sql";
const publishStateMigrationPath = "prisma/migrations/20261026060000_sellfox_listing_publish_state/migration.sql";
const dimensionMigrationPath = "prisma/migrations/20261026070000_sellfox_listing_developer_spu/migration.sql";
const scope = { organizationId: "org", workspaceId: "ws" };

async function verifyReportListingProjection(query: Query) {
  await query(`CREATE TABLE sellfox_sales_daily AS
    SELECT f.*,f.id AS "sourceKey",'SKU'::text AS sku,'USD'::text AS currency,
      '2026-10-26'::text AS "reportDate",quantity*10 AS revenue,quantity AS orders,true AS complete,
      '2026-10-26'::text AS "syncedAt",'shop'::text AS "shopExternalId",'店铺'::text AS name,'US'::text AS marketplace
    FROM (VALUES
      ('exact','org','ws','s','ASIN','a',2::float),
      ('unknown-value','org','ws','s','ASIN','c',3::float),
      ('fallback','org','ws','s','ASIN','missing',5::float),
      ('unmatched','org','ws','s','NO-ASIN','none',7::float),
      ('foreign-fact','other','ws','foreign','ASIN','a',1000::float)
    ) f(id,"organizationId","workspaceId","storeId",asin,msku,quantity);
    CREATE TABLE "SellfoxProductDailySnapshot" AS SELECT *,quantity AS "saleQuantity",revenue AS "saleRevenue",
      false AS "onlySettle",NULL::text AS title,NULL::text AS "parentAsin",NULL::text AS "imageUrl",
      1::float AS "grossProfit",NULL::float AS "grossProfitRate",1::float AS "adCost",
      NULL::float AS "promotionDiscount",NULL::float AS "giftWrapFee",revenue AS "netRevenue",
      NULL::float AS "refundRate",orders AS "orderNum",quantity AS "fbaQuantity",0::float AS "fbmQuantity",
      2::float AS "refundPrice",1::float AS "refundNum",3::float AS "commodityCost",4::float AS "shippingPrice",5::float AS "taxPrice",
      ARRAY[]::text[] AS "userNameList",'{"refundPrice":2,"refundNum":1,"commodityCost":3,"shippingPrice":4,"taxPrice":5}'::jsonb AS payload
    FROM sellfox_sales_daily;
    INSERT INTO "SellfoxProductDailySnapshot" SELECT id||'-settled',"organizationId","workspaceId","storeId",asin,msku,quantity,"sourceKey",sku,currency,"reportDate",revenue,orders,complete,"syncedAt","shopExternalId",name,marketplace,"saleQuantity","saleRevenue",true,title,"parentAsin","imageUrl","grossProfit","grossProfitRate","adCost","promotionDiscount","giftWrapFee","netRevenue","refundRate","orderNum","fbaQuantity","fbmQuantity","refundPrice","refundNum","commodityCost","shippingPrice","taxPrice","userNameList",payload FROM "SellfoxProductDailySnapshot";
    CREATE VIEW sellfox_profit_daily AS SELECT * FROM "SellfoxProductDailySnapshot";`);
  for (const domain of ["sales", "performance"] as const) {
    const read = async (params = "", exporting = false) => {
      const url = new URL("http://localhost/?reportDate=2026-10-26&dimension=msku");
      for (const [key,value] of new URLSearchParams(params)) url.searchParams.set(key,value);
      const browse = sellfoxBrowseQuery(url);
      const sql = workbenchReadSql(domain, browse, scope, exporting);
      assert.doesNotMatch(sql.text, /p\.payload|jsonb_array_elements|JOIN "SellfoxListingSnapshot"/);
      assert.doesNotMatch(sql.text, /s\.payload->>'(?:refundPrice|refundNum|commodityCost|shippingPrice|taxPrice)'/);
      const result = (await query(sql.text, sql.values)).rows[0] as Result;
      return { browse, result };
    };
    const all = (await read()).result;
    assert.equal(all.total, 4);
    const metric = domain === "sales" ? "subtotal" : "saleQuantity";
    assert.equal(all.totals[0][metric], 17);
    assert.deepEqual(all.facets, { brands: ["Brand", "Other"], productTags: ["标签、完整"], ...(domain === "performance" ? { salespersons: [] } : {}) });
    for (const [params, ids, quantity] of [
      ["fulfillment=AFN&buyBox=no&brand=Brand&productTag="+encodeURIComponent("标签、完整"), ["exact", "fallback"], 7],
      ["buyBox=yes", [], 0], // ASIN sibling b must not override the exact MSKU or stable ASIN fallback.
      ["brand=Other", [], 0],
      ["fulfillment=MFN", [], 0],
      ["productTag=标签", [], 0],
      ["brand=absent&search=absent", [], 0],
      ["shopExternalId=foreign", [], 0],
      ["site=CA", [], 0],
    ] as const) {
      for (const exporting of [false, true]) {
        const { browse, result } = await read(params, exporting);
        assert.deepEqual(result.rows.map(row=>row.id), ids);
        assert.equal(result.total, ids.length);
        assert.equal(result.totals[0]?.[metric] ?? 0, quantity);
        if (!exporting && !params.startsWith("shopExternalId=") && params!=="site=CA") assert.deepEqual(result.facets, all.facets);
        const agent = await readSellfoxAgentRows(domain, browse, scope, exporting);
        assert.deepEqual(agent.rows.map(row=>row.id), ids);
        assert.equal(agent.pagination.total, ids.length);
      }
    }
    for (const dimension of domain === "sales" ? ["developer", "spu"] : ["developer"]) {
      const result = (await read(`dimension=${dimension}`)).result;
      const expected = dimension === "developer" ? " Primary " : "SPU-SKU";
      assert.equal(result.rows.find(row=>row.identity===expected)?.[domain === "sales" ? "quantity" : "saleQuantity"], 7);
      assert.equal(result.rows.find(row=>row.identity===(dimension === "developer" ? "未分配开发员" : "未分配SPU"))?.[domain === "sales" ? "quantity" : "saleQuantity"], 10);
    }
    const paged = (await read("pageSize=1&page=2")).result;
    assert.equal(paged.rows.length, 1); assert.equal(paged.total, all.total); assert.deepEqual(paged.totals, all.totals);
    if (domain === "performance") {
      assert.equal(all.totals[0].shippingPrice, 16); // Performance totals sum typed fact fees.
      const settled = (await read("onlySettle=1")).result;
      assert.equal(settled.total, all.total); assert.deepEqual(settled.totals, all.totals);
      assert.deepEqual((await read("dimension=spu")).result, (await read("dimension=asin")).result);
    }
  }
}

export async function verifySellfoxListingReadModel(query: Query, before?: Statement) {
  const schema = `listing_read_${randomUUID().replaceAll("-", "")}`;
  const globals = globalThis as unknown as { prisma?: PrismaClient }, previous = globals.prisma;
  await query(`CREATE SCHEMA "${schema}"; SET search_path TO "${schema}"`);
  try {
    const prior = await readFile("prisma/migrations/20261025020000_sellfox_agent_read_models/migration.sql", "utf8");
    await query(`CREATE TABLE "SellfoxStore" (id text PRIMARY KEY,"organizationId" text,"workspaceId" text,"externalId" text,name text,marketplace text);
      INSERT INTO "SellfoxStore" VALUES ('s','org','ws','shop','店铺','US'),('foreign','other','ws','foreign','外部','US');`);
    for (const table of ["SellfoxSnapshotHead", "SellfoxListingSnapshot"]) {
      await query(prior.match(new RegExp(`CREATE TABLE "${table}" \\([\\s\\S]*?\\n\\);`))![0]);
    }
    await query('ALTER TABLE "SellfoxListingSnapshot" ALTER COLUMN msku DROP NOT NULL');
    await query(await readFile("prisma/migrations/20261025040000_sellfox_listing_identity_image/migration.sql", "utf8"));
    const oldColumns = (await query(`SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='sellfox_listing_current' ORDER BY ordinal_position`, [schema])).rows.map(r => r.column_name);
    const payload = {
      devId: "primary", devList: [{ devId: "other", devName: "First" }, { devId: "primary", devName: " Primary " }],
      commodityName: "", commoditySku: "SPU-SKU",
      dxmPublishState: " delete ",
      brand: " Brand ", amazonBrand: " Amazon ", rating: "4.5", ratingCount: 0,
      buyBoxWinner: false, switchFulfillmentTo: "AFN", firstSaleDate: "", firstOrderDate: "2024-01-15",
      bsrRank: [{ rank: "bad", bigCategory: true }, { rank: "10", categoryName: "Small" }, { rank: "9999999.0", categoryName: " Big ", bigCategory: true }],
      productLabelList: [{ labelDetailList: [{ labelName: " 标签、完整 " }, { labelName: "标签、完整" }, { labelName: " " }] }],
      quantity: 48, unsellable: 0, warehousing: null, purchaseCost: "12.5", fbaFees: 0, referralFee: 2,
      totalFee: 3, headTripCost: 1.5, reservedQty: 0, shippingPrice: "", shipCost: "2.5", profitPrice: -1.5, profitRate: -0.1,
    };
    const insert = (id: string, org: string, store: string, date: string, data: unknown, msku: string | null = id) => query(`INSERT INTO "SellfoxListingSnapshot"
      (id,"organizationId","workspaceId","storeId","sourceKey","capturedAt",asin,msku,sku,title,status,currency,"sales7",payload)
      VALUES ($1,$2,'ws',$3,$1,$4,'ASIN',$5,'SKU','商品','active','USD',7,$6::jsonb)`, [id,org,store,date,msku,JSON.stringify(data)]);
    await insert("a", "org", "s", "2026-10-26", payload);
    await insert("history", "org", "s", "2026-10-25", payload);
    await insert("partial", "org", "s", "2026-10-27", payload);
    await insert("foreign", "other", "foreign", "2026-10-26", payload);
    await query(`INSERT INTO "SellfoxSnapshotHead" VALUES ('s','listings','2026-10-26'),('foreign','listings','2026-10-26')`);
    // Execute the shipped additive migration over populated data and existing view.
    await query(await readFile(migrationPath, "utf8"));
    const priorProjection = (await query('SELECT * FROM sellfox_listing_current WHERE id=\'a\'')).rows[0];
    const typedColumns = (await query(`SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='sellfox_listing_current' ORDER BY ordinal_position`, [schema])).rows.map(r=>r.column_name);
    await query(await readFile(publishStateMigrationPath, "utf8"));
    const columns = (await query(`SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='sellfox_listing_current' ORDER BY ordinal_position`, [schema])).rows.map(r=>r.column_name);
    assert.deepEqual(columns.slice(0,oldColumns.length),oldColumns);
    assert.deepEqual(columns, [...typedColumns, "dxmPublishState"]);
    assert.equal((await query('SELECT id,msku FROM sellfox_listing_current WHERE "organizationId"=\'org\'')).rows[0].id,"a");
    const projected = (await query('SELECT * FROM sellfox_listing_current WHERE id=\'a\'')).rows[0];
    const { dxmPublishState, ...unchangedProjection } = projected;
    assert.equal(dxmPublishState, "delete");
    assert.deepEqual(unchangedProjection, priorProjection);
    assert.deepEqual((await query('SELECT "dxmPublishState" FROM "SellfoxListingSnapshot" ORDER BY id')).rows.map(row => row.dxmPublishState), ["delete", "delete", "delete", "delete"]);
    await query(await readFile(dimensionMigrationPath, "utf8"));
    const dimensionColumns = (await query(`SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='sellfox_listing_current' ORDER BY ordinal_position`, [schema])).rows.map(r=>r.column_name);
    assert.deepEqual(dimensionColumns, [...columns, "developer", "spu"]);
    const { developer, spu, ...previousProjection } = (await query("SELECT * FROM sellfox_listing_current WHERE id='a'")).rows[0];
    assert.equal(developer, " Primary "); assert.equal(spu, "SPU-SKU");
    assert.deepEqual(previousProjection, projected);
    assert.deepEqual((await query('SELECT developer,spu FROM "SellfoxListingSnapshot" ORDER BY id')).rows,
      Array.from({ length: 4 }, () => ({ developer: " Primary ", spu: "SPU-SKU" })));
    // Updates by old application code still project both dimensions in the same transaction.
    // Exact legacy behavior: empty != whitespace; duplicate devIds use the first match,
    // then first nonempty name (never the second matching devId just because it has a name).
    for (const [data, expectedDeveloper, expectedSpu] of [
      [{}, null, null],
      [{ devList: {}, commodityName: "", commoditySku: "" }, null, null],
      [{ devList: [null, {}, { devName: "" }, { devName: "First" }] }, "First", null],
      [{ devId: "x", devList: [{ devId: "y", devName: "Fallback" }, { devId: "x", devName: "" }, { devId: "x", devName: "Later" }] }, "Fallback", null],
      [{ devId: "missing", devList: [{ devName: "" }, { devName: "First" }, { devName: "Second" }], commodityName: "Name", commoditySku: "SKU" }, "First", "Name"],
      [{ devId: "", devList: [{ devId: "x", devName: "First" }, { devId: "", devName: "Ignored" }], commoditySku: "SKU" }, "First", "SKU"],
      [{ devList: [{ devName: " " }], commodityName: " " }, " ", " "],
      [{ devList: null, commodityName: null, commoditySku: null }, null, null],
    ] as const) {
      await query('UPDATE "SellfoxListingSnapshot" SET payload=$1::jsonb WHERE id=\'history\'', [JSON.stringify(data)]);
      assert.deepEqual((await query('SELECT developer,spu FROM "SellfoxListingSnapshot" WHERE id=\'history\'')).rows[0], { developer: expectedDeveloper, spu: expectedSpu });
    }
    for (const [key,value] of Object.entries({ brand:"Brand",amazonBrand:"Amazon",rating:"4.5",ratingCount:0,firstSaleDate:"2024-01-15",bsrRank:null,bsrCategory:"Big",listingQuantity:48,unsellable:0,warehousing:null,purchaseCost:12.5,fbaFees:0,referralFee:2,totalFee:3,headTripCost:1.5,reservedQty:0,shippingPrice:2.5,profitPrice:-1.5,profitRate:-0.1,buyBoxWinner:"否",fulfillment:"AFN",productTags:"标签、完整" })) assert.equal(projected[key],value,key);
    assert.deepEqual(projected.productTagNames,["标签、完整"]);
    // Partial/history rows also backfilled, so publishing a resumed Head cannot expose holes.
    assert.equal((await query('SELECT brand FROM "SellfoxListingSnapshot" WHERE id=\'partial\'')).rows[0].brand,"Brand");
    globals.prisma = { $queryRaw: async (sql: Prisma.Sql) => (await query(sql.text,sql.values)).rows } as unknown as PrismaClient;
    await query(`CREATE TABLE sellfox_inventory_current ("organizationId" text,"workspaceId" text,"storeId" text,msku text,quantity float,"totalInventory" float,"capturedAt" timestamp);
      INSERT INTO sellfox_inventory_current VALUES ('org','ws','s','a',19,180,'2026-10-26'),('other','ws','s','a',999,999,'2026-10-26');`);
    const read = async (params = "", exporting = false) => {
      const url = new URL("http://localhost/?pageSize=20&dimension=asin");
      for (const [key,value] of new URLSearchParams(params)) url.searchParams.set(key,value);
      const sql = workbenchReadSql("listings",sellfoxBrowseQuery(url),scope,exporting);
      assert.doesNotMatch(sql.text,/payload|jsonb_array_elements|JOIN "SellfoxListingSnapshot"/);
      return (await query(sql.text,sql.values)).rows[0] as Result;
    };
    const one = await read("fulfillment=AFN&buyBox=no&brand=Brand&productTag="+encodeURIComponent("标签、完整"));
    assert.equal(one.total,1); assert.equal(one.rows[0].id,"a");
    assert.equal(one.rows[0].dxmPublishState, "delete");
    assert.equal((await read("", true)).rows[0].dxmPublishState, "delete");
    assert.deepEqual(one.totals,[{currency:"USD",count:1}]);
    assert.deepEqual(one.facets,{productTags:["标签、完整"],brands:["Brand"]});
    const empty = await read("brand=absent&search=absent&status=delete");
    assert.equal(empty.total,0); assert.deepEqual(empty.rows,[]); assert.deepEqual(empty.facets,one.facets);
    assert.equal((await read("productTag=标签")).total,0); // exact membership, no separator splitting
    assert.equal((await read("site=CA")).facets.brands.length,0);
    assert.equal((await read("shopExternalId=foreign")).total,0);
    assert.equal((await read("searchType=parentAsin&search=missing&exactMatch=1")).total,0);
    assert.equal((await read("searchType=msku&search=a&exactMatch=1")).total,1);
    const enriched = await readSellfoxWorkbench("listings",sellfoxBrowseQuery(new URL("http://localhost/?pageSize=20")),scope);
    assert.equal(enriched.rows[0].fulfillable,null); // snapshot stock stays distinct from inventory stock
    assert.equal(enriched.rows[0].totalInventory,180);
    for (const exporting of [false,true]) {
      const agent = await readSellfoxAgentRows("listings",sellfoxBrowseQuery(new URL("http://localhost/?fulfillment=AFN&buyBox=no&brand=Brand&productTag="+encodeURIComponent("标签、完整"))),scope,exporting);
      assert.equal(agent.pagination.total,1); assert.equal(agent.rows[0].id,"a");
    }
    // Normal sync insert/update both execute the trigger. Missing, malformed, zero,
    // real boolean vs string boolean, and deleted rows without MSKU are preserved.
    await insert("b","org","s","2026-10-26",{...payload,dxmPublishState:"future-state",brand:"Other",rating:"10",buyBoxWinner:true,bsrRank:[{rank:"2",categoryName:"First"},{rank:"3",bigCategory:true,categoryName:"Big"}]},null);
    await insert("c","org","s","2026-10-26",{dxmPublishState:{state:"delete"},rating:"bad",ratingCount:"1e9999",buyBoxWinner:"true",switchFulfillmentTo:"unknown",productLabelList:{},bsrRank:"bad",quantity:"NaN",profitPrice:"Infinity"});
    await query(`UPDATE "SellfoxListingSnapshot" SET status='delete' WHERE id='b'`);
    await verifyReportListingProjection(query);
    const three = await read("sortBy=rating&sortOrder=asc");
    assert.deepEqual(three.rows.map(r=>r.id),["a","b","c"]);
    assert.equal(three.rows[1].dxmPublishState, "future-state");
    assert.equal(three.rows[2].dxmPublishState, null);
    const missing = three.rows[2];
    for (const key of ["ratingCount","buyBoxWinner","fulfillment","productTags","bsrRank","listingQuantity","profitPrice"]) assert.equal(missing[key],null,key);
    assert.equal(missing.rating,"bad");
    assert.equal(three.rows[1].bsrRank,3); assert.equal(three.rows[1].bsrCategory,"Big");
    assert.equal((await read("status=delete")).rows[0].msku,null);
    assert.equal((await read("pageSize=1&page=2&sortBy=rating&sortOrder=asc")).rows[0].id,"b");
    assert.equal((await read("buyBox=yes")).total,1);
    for (const value of [null, "", "  ", 0, false, [], {}]) {
      await query('UPDATE "SellfoxListingSnapshot" SET payload=jsonb_set(payload,\'{dxmPublishState}\',$1::jsonb) WHERE id=\'b\'', [JSON.stringify(value)]);
      assert.equal((await read("status=delete")).rows[0].dxmPublishState, null);
    }
    await query('UPDATE "SellfoxListingSnapshot" SET payload=jsonb_set(payload,\'{dxmPublishState}\',\'" delete "\'::jsonb) WHERE id=\'b\'');
    assert.equal((await read("status=delete")).rows[0].dxmPublishState, "delete");
    await query('UPDATE "SellfoxListingSnapshot" SET payload=$1::jsonb WHERE id=\'a\'',[JSON.stringify({brand:"Changed",rating:0})]);
    const updated = (await read("brand=Changed")).rows[0];
    assert.equal(updated.dxmPublishState, null);
    assert.deepEqual((await query("SELECT developer,spu FROM sellfox_listing_current WHERE id='a'")).rows[0], { developer: null, spu: null });
    assert.equal(updated.rating,"0"); assert.equal(updated.productTags,null); assert.equal(updated.bsrRank,null);
    // Complete Head remains the publication boundary; old/history/partial never leak.
    await query(`UPDATE "SellfoxSnapshotHead" SET "capturedAt"='2026-10-27' WHERE "storeId"='s'`);
    assert.deepEqual((await read()).rows.map(r=>r.id),["partial"]);
    await query(`UPDATE "SellfoxSnapshotHead" SET "capturedAt"='2026-10-26' WHERE "storeId"='s'`);
    await query('DELETE FROM "SellfoxListingSnapshot"');
    // 10,000 current + 20,000 retained history, 10 stores, ~3KB payload, narrow page 20.
    await query(`INSERT INTO "SellfoxStore" SELECT 'store-'||n,'org','ws','shop-'||n,'店铺'||n,'US' FROM generate_series(0,9) n;
      INSERT INTO "SellfoxSnapshotHead" SELECT 'store-'||n,'listings','2026-10-26'::timestamp FROM generate_series(0,9) n;
      INSERT INTO "SellfoxListingSnapshot" (id,"organizationId","workspaceId","storeId","sourceKey","capturedAt",asin,msku,sku,title,status,price,currency,"sales7",payload)
      SELECT lpad(n::text,6,'0')||'-'||d,'org','ws','store-'||(n%10),n::text,('2026-10-26'::date-d)::timestamp,'ASIN'||n,'MSKU'||n,'SKU'||n,'商品'||n,'active',n%100,'USD',n%50,
        jsonb_build_object('brand','Brand'||(n%5),'rating','4.5','buyBoxWinner',true,'switchFulfillmentTo','AFN','ratingCount',n,'purchaseCost',1.5,'quantity',48,'productLabelList',jsonb_build_array(jsonb_build_object('labelDetailList',jsonb_build_array(jsonb_build_object('labelName','Tag'||(n%10))))),'bsrRank',jsonb_build_array(jsonb_build_object('rank',n,'bigCategory',true,'categoryName','Category')),'padding',repeat(md5(n::text),96))
      FROM generate_series(1,10000) n CROSS JOIN generate_series(0,2) d;
      ANALYZE "SellfoxListingSnapshot"; ANALYZE "SellfoxSnapshotHead"; ANALYZE "SellfoxStore";`);
    const statement = workbenchReadSql("listings",sellfoxBrowseQuery(new URL("http://localhost/?dimension=asin&pageSize=20")),scope);
    const explain = async (sql: Statement) => (await query("EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) "+sql.text,sql.values)).rows[0]["QUERY PLAN"];
    const plans: Record<string,unknown> = {};
    if (before) {
      const old = (await query(before.text,before.values)).rows[0] as Result;
      const after = await read();
      assert.equal(old.total,10000); assert.deepEqual(after.totals,old.totals); assert.deepEqual(after.facets,old.facets);
      // Keep the previous rating display string and all row fields unchanged.
      assert.deepEqual(after.rows.map(row => { const original = { ...row }; delete original.dxmPublishState; return original; }),old.rows);
      plans.before = await explain(before);
    }
    for (const key of ["default","brand","sales7"] as const) {
      const sql = key==="default" ? statement : workbenchReadSql("listings",sellfoxBrowseQuery(new URL(`http://localhost/?dimension=asin&pageSize=20&${key==="brand"?"brand=Brand1&fulfillment=AFN&buyBox=yes":"sortBy=sales7&sortOrder=desc"}`)),scope);
      const result = (await query(sql.text,sql.values)).rows[0] as Result;
      assert.equal(result.total,key==="brand"?2000:10000); assert.equal(result.rows.length,20);
      plans[key] = await explain(sql);
      assert.doesNotMatch(JSON.stringify(plans[key]),/jsonb_array_elements|payload|SellfoxListingSnapshot_pkey/);
    }
    return plans;
  } finally {
    globals.prisma=previous;
    await query(`SET search_path TO public; DROP SCHEMA "${schema}" CASCADE`);
  }
}

// Optional standalone runner. PGlite is a test-only external tool, not an app dependency.
if (process.argv[1]?.endsWith("sellfox-listings-read-model.ts")) {
  void (async () => {
    const moduleName = process.env.SELLFOX_TEST_PGLITE_MODULE || "@electric-sql/pglite";
    const { PGlite } = await import(moduleName) as { PGlite: new () => {
      query: Query; exec: (sql: string) => Promise<{ rows: Row[] }[]>; close: () => Promise<void>;
    } };
    const db = new PGlite();
    try {
      const beforePath = process.argv.find(arg=>arg.startsWith("--before-sql="))?.slice("--before-sql=".length);
      const before = beforePath ? JSON.parse(await readFile(beforePath,"utf8")) as Statement : undefined;
      const plans = await verifySellfoxListingReadModel(async (sql,values)=>values?.length ? db.query(sql,values) : (await db.exec(sql)).at(-1)!,before);
      console.log(JSON.stringify(plans,null,2));
      console.log("Listing migration/backfill/trigger/browse/agent/scope/pagination: PASS (disposable PGlite)");
    } finally { await db.close(); }
  })().catch(error=>{ console.error(error); process.exitCode=1; });
}
