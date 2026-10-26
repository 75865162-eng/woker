/** Caller supplies a fresh disposable PostgreSQL/PGlite DB. Never reads env or connects to a database. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { verifySellfoxAdsPhaseASql } from "./sellfox-ads-phase-a";
import { workbenchReadSql } from "@/lib/sellfox/workbench-read";
import { sellfoxBrowseQuery } from "@/lib/sellfox/browse-query";
import { sellfoxAgentColumns } from "@/lib/sellfox/agent-read";
type Query = Parameters<typeof verifySellfoxAdsPhaseASql>[0];
export async function verifySellfoxAdsPhaseBSql(query: Query) {
  await verifySellfoxAdsPhaseASql(query);
  await query(await readFile("prisma/migrations/20261026040000_sellfox_ads_campaign_group_placement/migration.sql", "utf8"));
  for (const code of ["adCampaignReport", "adGroupReport", "adSpaceReport"]) {
    await query(`INSERT INTO "SellfoxReportTask" (id,"organizationId","workspaceId","storeId","runId","adType","reportTypeCode","startDate","endDate",status,"updatedAt") VALUES ($1,'org','ws','s','r','sp',$1,'2026-10-24','2026-10-24','pending',now())`, [code]);
  }
  assert.equal((await query('SELECT count(*)::int AS n FROM "SellfoxReportTask"')).rows[0].n, 6);
  for (const [model, domain, extra, values, identity] of [
    ["SellfoxAdsCampaignDaily", "ads_campaign", ',"campaignName"', ",'Campaign'", "campaignId"],
    ["SellfoxAdsAdGroupDaily", "ads_ad_group", ',"adGroupId","adGroupName"', ",'g','Group'", "adGroupId"],
    ["SellfoxAdsPlacementDaily", "ads_placement", ',placement', ",'topOfSearch'", "placement"],
  ] as const) {
    await query(`INSERT INTO "${model}" (id,"organizationId","workspaceId","storeId","reportDate","adType","campaignId"${extra},cost,clicks,"adOrders","adSales",payload) VALUES
      ('a','org','ws','s','2026-10-23','sp','c'${values},2,1,0,10,'{}'),
      ('b','org','ws','s','2026-10-24','sp','c'${values},3,2,0,20,'{}'),
      ('zero','org','ws','s','2026-10-24','sp','c2'${values},0,0,0,0,'{}'),
      ('foreign','foreign','ws','f','2026-10-24','sp','c'${values},100,100,100,100,'{}')`);
    const source = `sellfox_${domain}_daily`;
    const narrow = (await query(`SELECT ${sellfoxAgentColumns[domain].map(key => `"${key}"`).join(",")} FROM ${source} WHERE id='a'`)).rows[0];
    assert.equal(narrow.acos, 0.2); assert.equal(narrow.roas, 5); assert.equal(narrow.currency, null); assert.equal(narrow.shopExternalId, "shop");
    const zero = (await query(`SELECT acos,roas FROM ${source} WHERE id='zero'`)).rows[0];
    assert.equal(zero.acos, null); assert.equal(zero.roas, null);
    const read = async (params = "", scope = { organizationId: "org", workspaceId: "ws" }) => {
      const sql = workbenchReadSql(domain, sellfoxBrowseQuery(new URL(`http://localhost/?from=2026-10-23&to=2026-10-24&${params}`)), scope);
      return (await query(sql.text, sql.values)).rows[0] as { total: number; rows: Record<string, unknown>[]; totals: Record<string, unknown>[] };
    };
    const filtered = await read("quickFilter=clicksNoOrders&adType=sp");
    assert.equal(filtered.total, 1); assert.equal(filtered.rows[0].cost, 5); assert.equal(filtered.totals[0].cost, 5);
    assert.equal(filtered.rows[0][identity], narrow[identity]);
    assert.equal((await read("adType=sb")).total, 0);
    assert.equal((await read("", { organizationId: "org", workspaceId: "foreign" })).total, 0);
    assert.equal((await read("searchType=campaignId&search=c2&exactMatch=1")).total, 1);
    if (identity !== "campaignId") assert.equal((await read(`searchType=${identity}&search=${narrow[identity]}&exactMatch=1`)).total, 2);
    assert.equal((await read("pageSize=1&page=2")).rows.length, 1);
    assert.equal((await read("pageSize=1&page=3")).rows.length, 0);
    // Copy the physical row with a new PK: the business key must still reject it.
    await assert.rejects(() => query(`INSERT INTO "${model}" SELECT (jsonb_populate_record(NULL::"${model}", to_jsonb(t)||'{"id":"duplicate"}'::jsonb)).* FROM "${model}" t WHERE id='a'`), /unique/i);
    if (domain === "ads_placement") {
      await assert.rejects(() => query(`INSERT INTO "${model}" SELECT (jsonb_populate_record(NULL::"${model}", to_jsonb(t)||'{"id":"group-scoped","adGroupId":"different"}'::jsonb)).* FROM "${model}" t WHERE id='a'`), /unique/i);
      // Group metadata may vary between days; the aggregate must not claim a single group.
      await query(`UPDATE "${model}" SET "adGroupId"=CASE WHEN id='a' THEN 'g1' ELSE 'g2' END WHERE id IN ('a','b')`);
      assert.equal((await read("quickFilter=spend")).rows[0].adGroupId, null);
    }
  }
  // Ads product + sibling tabs use the same current Listing enrichment. No live DB.
  const prior = await readFile("prisma/migrations/20261025020000_sellfox_agent_read_models/migration.sql", "utf8");
  const productTable = prior.slice(prior.indexOf('CREATE TABLE "SellfoxAdsProductDaily"'));
  await query(productTable.slice(0, productTable.indexOf("\n);\n") + 4));
  await query(prior.split("\n").find(line => line.startsWith("CREATE VIEW sellfox_ads_product_daily AS"))!);
  await query(`INSERT INTO "SellfoxAdsProductDaily" (id,"organizationId","workspaceId","storeId","reportDate","adType","campaignId","adGroupId","productId",cost,payload) VALUES
    ('a','org','ws','s','2026-10-23','sp','c','g','p',2,'{}'),('b','org','ws','s','2026-10-24','sp','c','g','p',3,'{}')`);
  await query(`INSERT INTO sellfox_listing_current (id,"organizationId","workspaceId","storeId",msku,asin,"mainImage",rating,"productTags","ratingCount") VALUES
    ('exact','org','ws','s','exact','ASIN','https://example.test/exact.jpg','4.4','新品、重点',128),
    ('sibling','org','ws','s','aaa','ASIN','https://example.test/sibling.jpg','1.0','其他',7),
    ('foreign-org','foreign','ws','s','exact','ASIN','foreign','0','foreign',999),
    ('foreign-ws','org','foreign','s','exact','ASIN','foreign','0','foreign',999),
    ('foreign-store','org','ws','f','exact','ASIN','foreign','0','foreign',999)`);
  for (const [model, domain] of [
    ["SellfoxAdsProductDaily", "ads_report"], ["SellfoxAdsTargetingDaily", "ads_targeting"], ["SellfoxAdsSearchTermDaily", "ads_search_term"],
    ["SellfoxAdsCampaignDaily", "ads_campaign"], ["SellfoxAdsAdGroupDaily", "ads_ad_group"], ["SellfoxAdsPlacementDaily", "ads_placement"],
  ] as const) {
    const read = async (exporting = false) => {
      const sql = workbenchReadSql(domain, sellfoxBrowseQuery(new URL("http://localhost/?from=2026-10-23&to=2026-10-24&quickFilter=spend&sortBy=ratingCount&sortOrder=desc"), domain), { organizationId: "org", workspaceId: "ws" }, exporting);
      const result = (await query(sql.text, sql.values)).rows[0] as { rows: Record<string, unknown>[] };
      assert.equal(result.rows.length, 1);
      assert.equal(result.rows[0].cost, 5); // LIMIT 1 must never multiply facts.
      return result.rows[0];
    };
    const fields = (row: Record<string, unknown>) => [row.mainImage, row.rating, row.productTags, row.ratingCount];
    // Missing product identity on campaign/placement stays NULL-safe.
    assert.deepEqual(fields(await read()), [null, null, null, null]);
    await query(`UPDATE "${model}" SET msku='exact',asin='ASIN' WHERE id IN ('a','b')`);
    for (const exporting of [false, true]) assert.deepEqual(fields(await read(exporting)), ["https://example.test/exact.jpg", "4.4", "新品、重点", 128]);
    // ASIN fallback chooses aaa; mixed ratings/counts/tags must not pick an arbitrary min.
    await query(`UPDATE "${model}" SET msku='absent' WHERE id='b'`);
    assert.deepEqual(fields(await read()), ["https://example.test/exact.jpg", null, null, null]);
    await query(`UPDATE "${model}" SET asin=NULL WHERE id='b'`);
    assert.deepEqual(fields(await read()), ["https://example.test/exact.jpg", null, null, null]);
    await query(`UPDATE "${model}" SET msku=NULL,asin=NULL WHERE id='a'`);
    assert.deepEqual(fields(await read()), [null, null, null, null]);
    await query(`UPDATE sellfox_listing_current SET "mainImage"='' WHERE id='exact'`);
    await query(`UPDATE "${model}" SET msku='exact',asin='ASIN' WHERE id IN ('a','b')`);
    assert.deepEqual(fields(await read()), [null, "4.4", "新品、重点", 128]);
    await query(`UPDATE sellfox_listing_current SET "mainImage"='https://example.test/exact.jpg' WHERE id='exact'`);
    // Matched Listing with a missing typed count also invalidates unanimity.
    await query(`UPDATE sellfox_listing_current SET "ratingCount"=NULL WHERE id='sibling'`);
    await query(`UPDATE "${model}" SET msku='absent' WHERE id='b'`);
    assert.equal((await read()).ratingCount, null);
    await query(`UPDATE "${model}" SET msku='exact' WHERE id='b'`);
    await query(`UPDATE sellfox_listing_current SET "ratingCount"=0 WHERE id='exact'`);
    for (const exporting of [false, true]) assert.equal((await read(exporting)).ratingCount, 0);
    await query(`UPDATE sellfox_listing_current SET "ratingCount"=CASE WHEN id='exact' THEN 128 ELSE 7 END WHERE id IN ('exact','sibling')`);
  }
}

// Standalone disposable verifier; never reads DATABASE_URL or connects remotely.
if (process.argv[1]?.endsWith("sellfox-ads-phase-b.ts")) {
  void (async () => {
    const moduleName = process.env.SELLFOX_TEST_PGLITE_MODULE || "@electric-sql/pglite";
    const { PGlite } = await import(moduleName) as { PGlite: new () => {
      query: Query; exec: (sql: string) => Promise<{ rows: Record<string, unknown>[] }[]>; close: () => Promise<void>;
    } };
    const db = new PGlite();
    try {
      await verifySellfoxAdsPhaseBSql(async (sql, values) => values?.length ? db.query(sql, values) : (await db.exec(sql)).at(-1)!);
      console.log("PASS: ads Phase A/B and six-tab Listing image/rating/ratingCount/productTags parity (disposable PGlite)");
    } finally { await db.close(); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
