/** Isolated PostgreSQL/PGlite check. Caller supplies a disposable database; no env/production access. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { workbenchReadSql } from "@/lib/sellfox/workbench-read";
import { sellfoxBrowseQuery } from "@/lib/sellfox/browse-query";

type Query = (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }>;
export async function verifySellfoxAdsPhaseASql(query: Query) {
  // Caller uses a fresh DB: create the prior task schema with a populated product task.
  await query(`CREATE TABLE "SellfoxStore" (id text PRIMARY KEY,"organizationId" text,"workspaceId" text,"externalId" text,name text,marketplace text);
    INSERT INTO "SellfoxStore" VALUES ('s','org','ws','shop','店铺','US'),('f','foreign','ws','foreign-shop','其他组织','US');
    CREATE TABLE "SellfoxListingSnapshot" (id text,payload jsonb,"organizationId" text,"workspaceId" text);
    CREATE TABLE sellfox_listing_current (id text,"storeId" text,msku text,asin text,"parentAsin" text,title text,price float,"mainImage" text,"organizationId" text,"workspaceId" text,
      brand text,rating text,"productTags" text,"buyBoxWinner" text,fulfillment text,developer text,spu text);`);
  const prior = await readFile("prisma/migrations/20261025020000_sellfox_agent_read_models/migration.sql", "utf8");
  await query(prior.slice(prior.indexOf('CREATE TABLE "SellfoxReportTask"'), prior.indexOf('CREATE TABLE "SellfoxAdsProductDaily"')));
  await query('CREATE UNIQUE INDEX "SellfoxReportTask_runId_storeId_adType_key" ON "SellfoxReportTask" ("runId","storeId","adType")');
  await query(`INSERT INTO "SellfoxReportTask" (id,"organizationId","workspaceId","storeId","runId","adType","startDate","endDate",status,"updatedAt") VALUES ('old','org','ws','s','r','sp','2026-10-24','2026-10-24','pending',now())`);
  await query(await readFile("prisma/migrations/20261026030000_sellfox_ads_targeting_search_term/migration.sql", "utf8"));
  assert.equal((await query('SELECT "reportTypeCode" FROM "SellfoxReportTask" WHERE id=\'old\'')).rows[0].reportTypeCode, "adProductReport");
  for (const code of ["adTargeringReport", "adSearchTermReport"]) await query(`INSERT INTO "SellfoxReportTask" (id,"organizationId","workspaceId","storeId","runId","adType","reportTypeCode","startDate","endDate",status,"updatedAt") VALUES ($1,'org','ws','s','r','sp',$1,'2026-10-24','2026-10-24','pending',now())`, [code]);
  assert.equal((await query('SELECT count(*)::int AS n FROM "SellfoxReportTask"')).rows[0].n, 3);
  await assert.rejects(() => query(`INSERT INTO "SellfoxReportTask" SELECT 'duplicate',"organizationId","workspaceId","storeId","runId","adType","startDate","endDate","externalTaskId",status,"fileKey","updatedAt","reportTypeCode" FROM "SellfoxReportTask" WHERE id='old'`), /unique/i);
  for (const [model, domain] of [["SellfoxAdsTargetingDaily", "ads_targeting"], ["SellfoxAdsSearchTermDaily", "ads_search_term"]] as const) {
    const extra = domain === "ads_search_term" ? ',"searchTerm"' : "", term = domain === "ads_search_term" ? ",'customer query'" : "";
    await query(`INSERT INTO "${model}" (id,"organizationId","workspaceId","storeId","reportDate","adType","campaignId","adGroupId","targetingId"${extra},cost,clicks,"adOrders","adSales",payload) VALUES
      ('a','org','ws','s','2026-10-23','sp','c','g','t'${term},2,1,0,10,'{}'),
      ('b','org','ws','s','2026-10-24','sp','c','g','t'${term},3,2,0,20,'{}'),
      ('other-target','org','ws','s','2026-10-24','sp','c','g','t2'${term},0,0,0,0,'{}'),
      ('foreign','foreign','ws','f','2026-10-24','sp','c','g','t'${term},100,100,100,100,'{}')`);
    const narrow = (await query(`SELECT acos,roas FROM sellfox_${domain}_daily WHERE id='a'`)).rows[0];
    assert.equal(narrow.acos, 0.2); assert.equal(narrow.roas, 5);
    const zeros = (await query(`SELECT acos,roas FROM sellfox_${domain}_daily WHERE id='other-target'`)).rows[0];
    assert.equal(zeros.acos, null); assert.equal(zeros.roas, null);
    const read = async (params: string) => {
      const sql = workbenchReadSql(domain, sellfoxBrowseQuery(new URL(`http://localhost/?from=2026-10-23&to=2026-10-24&${params}`)), { organizationId: "org", workspaceId: "ws" });
      return (await query(sql.text, sql.values)).rows[0] as { total: number; rows: Record<string, unknown>[]; totals: Record<string, unknown>[] };
    };
    const filtered = await read("quickFilter=clicksNoOrders&adType=sp");
    assert.equal(filtered.total, 1); assert.equal(filtered.rows[0].cost, 5); assert.equal(filtered.totals[0].cost, 5);
    assert.equal(filtered.rows[0].currency, null); assert.equal(filtered.rows[0].targetingId, "t");
    assert.equal((await read("adType=sb")).total, 0);
    assert.equal((await read("searchType=targetingId&search=t2&exactMatch=1")).total, 1);
    if (domain === "ads_search_term") assert.equal((await read("searchType=searchTerm&search=customer%20query&exactMatch=1")).total, 2);
    // Identical rows cannot bypass the physical identity index (including missing target sentinel).
    await assert.rejects(() => query(`INSERT INTO "${model}" SELECT 'duplicate',"organizationId","workspaceId","storeId","reportDate","adType","campaignId","adGroupId",${domain === "ads_search_term" ? '"searchTerm",' : ''}"targetingId","targetingText","matchType",asin,msku,currency,impressions,clicks,cost,"adOrders","adSales",payload,"syncedAt" FROM "${model}" WHERE id='a'`), /unique/i);
  }
}
