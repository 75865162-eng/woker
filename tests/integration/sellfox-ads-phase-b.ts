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
  await query(`INSERT INTO sellfox_listing_current (id,"organizationId","workspaceId","storeId",msku,asin,"mainImage",rating,"productTags","ratingCount",brand,fulfillment,"buyBoxWinner") VALUES
    ('exact','org','ws','s','exact','ASIN','https://example.test/exact.jpg','4.4','新品、重点',128,'品牌','AFN','是'),
    ('sibling','org','ws','s','aaa','ASIN','https://example.test/sibling.jpg','1.0','其他',7,'其他品牌','MFN','否'),
    ('foreign-org','foreign','ws','s','exact','ASIN','foreign','0','foreign',999,'foreign','未知','否'),
    ('foreign-ws','org','foreign','s','exact','ASIN','foreign','0','foreign',999,'foreign','未知','否'),
    ('foreign-store','org','ws','f','exact','ASIN','foreign','0','foreign',999,'foreign','未知','否')`);
  await query(`INSERT INTO "SellfoxStore" VALUES ('other','org','ws','other-shop','其他店铺','CA');
    INSERT INTO sellfox_listing_current (id,"organizationId","workspaceId","storeId",msku,asin,"productTagNames",brand) VALUES
      ('other-store','org','ws','other','exact','ASIN',ARRAY['其他店'],'其他店品牌');
    UPDATE sellfox_listing_current SET "productTagNames"=CASE
      WHEN id='exact' THEN ARRAY['新品','重点','标签、完整','重点']
      WHEN id='sibling' THEN ARRAY['其他']
      ELSE ARRAY['foreign'] END WHERE id<>'other-store';
    INSERT INTO sellfox_listing_current (id,"organizationId","workspaceId","storeId",msku,asin,brand) VALUES
      ('facet-only','org','ws','s','facet-only','FACET','00123'),
      ('facet-duplicate','org','ws','s','facet-duplicate','FACET2','00123')`);
  for (const [model, domain] of [
    ["SellfoxAdsProductDaily", "ads_report"], ["SellfoxAdsTargetingDaily", "ads_targeting"], ["SellfoxAdsSearchTermDaily", "ads_search_term"],
    ["SellfoxAdsCampaignDaily", "ads_campaign"], ["SellfoxAdsAdGroupDaily", "ads_ad_group"], ["SellfoxAdsPlacementDaily", "ads_placement"],
  ] as const) {
    const readResult = async (params = "", exporting = false, scope = { organizationId: "org", workspaceId: "ws" }, sortBy = "ratingCount") => {
      const url = new URL(`http://localhost/?from=2026-10-23&to=2026-10-24&quickFilter=spend&sortBy=${sortBy}&sortOrder=desc`);
      new URLSearchParams(params).forEach((value, key) => url.searchParams.set(key, value));
      const sql = workbenchReadSql(domain, sellfoxBrowseQuery(url, domain), scope, exporting);
      return (await query(sql.text, sql.values)).rows[0] as { total: number; rows: Record<string, unknown>[]; totals: Record<string, unknown>[]; facets?: { productTags: string[]; brands: string[] } };
    };
    const read = async (exporting = false, sortBy = "ratingCount") => {
      const result = await readResult("", exporting, undefined, sortBy);
      assert.equal(result.rows.length, 1);
      assert.equal(result.rows[0].cost, 5); // LIMIT 1 must never multiply facts.
      return result.rows[0];
    };
    const fields = (row: Record<string, unknown>) => [row.mainImage, row.rating, row.productTags, row.ratingCount, row.brand, row.fulfillment, row.buyBoxWinner];
    const fulfillmentCosts = async (afn: number | null, mfn: number | null) => {
      for (const exporting of [false, true]) {
        for (const [fulfillment, cost] of [["AFN", afn], ["MFN", mfn]] as const) {
          const result = await readResult(`fulfillment=${fulfillment}`, exporting);
          assert.equal(result.total, cost === null ? 0 : 1, `${domain}/${fulfillment}/${exporting}`);
          assert.equal(result.rows.length, cost === null ? 0 : 1);
          if (cost !== null) {
            assert.equal(result.rows[0].cost, cost); assert.equal(result.totals[0].cost, cost);
            assert.equal(result.rows[0].fulfillment, fulfillment);
          }
        }
      }
      // The same facts always remain in 全部, including NULL/unknown/unmatched members.
      assert.equal((await readResult()).totals[0].cost, 5);
    };
    const buyBoxCosts = async (yes: number | null, no: number | null, extra = "") => {
      for (const exporting of [false, true]) {
        for (const [buyBox, cost] of [["yes", yes], ["no", no]] as const) {
          const result = await readResult(`buyBox=${buyBox}&${extra}`, exporting);
          assert.equal(result.total, cost === null ? 0 : 1, `${domain}/buyBox=${buyBox}/${exporting}/${extra}`);
          assert.equal(result.rows.length, cost === null ? 0 : 1);
          if (cost !== null) {
            assert.equal(result.rows[0].cost, cost); assert.equal(result.totals[0].cost, cost);
            assert.equal(result.rows[0].buyBoxWinner, buyBox === "yes" ? "是" : "否");
          } else assert.deepEqual(result.totals, []);
          if (exporting) assert.equal(result.facets, undefined);
          else assert.deepEqual(Object.keys(result.facets!).sort(), ["brands", "productTags"]);
        }
      }
      assert.equal((await readResult("buyBox=")).totals[0].cost, 5);
    };
    const brandCost = async (brand: string, cost: number | null, extra = "") => {
      for (const exporting of [false, true]) {
        const result = await readResult(`${new URLSearchParams({ brand: ` ${brand} ` })}&${extra}`, exporting);
        assert.equal(result.total, cost === null ? 0 : 1, `${domain}/brand=${brand}/${exporting}/${extra}`);
        assert.equal(result.rows.length, cost === null ? 0 : 1);
        if (cost !== null) {
          assert.equal(result.rows[0].cost, cost); assert.equal(result.totals[0].cost, cost);
          assert.equal(result.rows[0].brand, brand);
        } else assert.deepEqual(result.totals, []);
        if (exporting) assert.equal(result.facets, undefined);
      }
      assert.equal((await readResult()).totals[0].cost, 5);
    };
    // Missing product identity on campaign/placement stays NULL-safe.
    assert.deepEqual(fields(await read()), [null, null, null, null, null, null, null]);
    await fulfillmentCosts(null, null);
    await buyBoxCosts(null, null);
    await brandCost("品牌", null); // No identity/Listing does not match a selected brand.
    assert.equal((await readResult("productTag=新品")).total, 0);
    await query(`UPDATE "${model}" SET msku='exact',asin='ASIN' WHERE id IN ('a','b')`);
    await buyBoxCosts(5, null);
    await buyBoxCosts(5, null, "brand=品牌&productTag=新品&fulfillment=AFN");
    await buyBoxCosts(null, null, "brand=其他品牌&productTag=新品&fulfillment=AFN");
    await fulfillmentCosts(5, null); // MSKU wins over the MFN ASIN sibling; no join fan-out.
    await brandCost("品牌", 5);
    await brandCost("品牌", 5, "productTag=新品&fulfillment=AFN");
    for (const brand of ["其他品牌", "品", "品牌、其他品牌", "missing", "foreign", "其他店品牌", "%' OR TRUE--"]) await brandCost(brand, null);
    await brandCost("品牌", null, "productTag=其他&fulfillment=AFN");
    await brandCost("品牌", null, "productTag=新品&fulfillment=MFN");
    assert.equal((await readResult("fulfillment=AFN&productTag=新品")).rows[0].cost, 5);
    assert.equal((await readResult("fulfillment=MFN&productTag=新品")).total, 0);
    for (const scope of [{ organizationId: "foreign", workspaceId: "ws" }, { organizationId: "org", workspaceId: "foreign" }]) {
      assert.equal((await readResult("fulfillment=AFN", false, scope)).total, 0);
      assert.equal((await readResult("brand=foreign", false, scope)).total, 0);
      for (const buyBox of ["yes", "no"]) assert.equal((await readResult(`buyBox=${buyBox}`, false, scope)).total, 0);
    }
    for (const params of ["storeId=other", "shopExternalId=other-shop", "site=CA", "storeId=f"]) {
      assert.equal((await readResult(`fulfillment=AFN&${params}`)).total, 0);
      assert.equal((await readResult(`brand=品牌&${params}`)).total, 0);
      for (const buyBox of ["yes", "no"]) assert.equal((await readResult(`buyBox=${buyBox}&${params}`)).total, 0);
    }
    for (const exporting of [false, true]) assert.deepEqual(fields(await read(exporting, "buyBoxWinner")), ["https://example.test/exact.jpg", "4.4", "新品、重点", 128, "品牌", "AFN", "是"]);
    for (const exporting of [false, true]) {
      for (const tag of [" 新品 ", "重点", "标签、完整"]) {
        const matched = await readResult(new URLSearchParams({ productTag: tag }).toString(), exporting);
        assert.equal(matched.total, 1); assert.equal(matched.rows[0].cost, 5); assert.equal(matched.totals[0].cost, 5);
        if (exporting) assert.equal(matched.facets, undefined);
      }
      for (const tag of ["新", "新品、重点", "missing", "其他", "其他店", "foreign", "%' OR TRUE--"]) {
        assert.equal((await readResult(new URLSearchParams({ productTag: tag }).toString(), exporting)).total, 0);
      }
    }
    // Facets follow current Listing org/workspace/store/site scope, independent of selections/search/date/adType.
    const scopedFacets = await readResult("buyBox=no&brand=missing&productTag=新品&fulfillment=MFN&search=impossible&shopExternalId=shop&site=US&adType=sb&from=2020-01-01&to=2020-01-01");
    assert.equal(scopedFacets.total, 0);
    assert.deepEqual(Object.keys(scopedFacets.facets!).sort(), ["brands", "productTags"]);
    assert.deepEqual(scopedFacets.facets!.brands, ["00123", "品牌", "其他品牌"].sort());
    assert.deepEqual(scopedFacets.facets!.productTags, ["新品", "重点", "标签、完整", "其他"].sort());
    assert.deepEqual((await readResult("storeId=other")).facets, { productTags: ["其他店"], brands: ["其他店品牌"] });
    assert.deepEqual((await readResult("site=CA")).facets, { productTags: ["其他店"], brands: ["其他店品牌"] });
    assert.deepEqual((await readResult("shopExternalId=other-shop")).facets, { productTags: ["其他店"], brands: ["其他店品牌"] });
    assert.deepEqual((await readResult("storeId=missing")).facets, { productTags: [], brands: [] });
    assert.deepEqual((await readResult("shopExternalId=foreign-shop")).facets, { productTags: [], brands: [] });
    for (const scope of [{ organizationId: "foreign", workspaceId: "ws" }, { organizationId: "org", workspaceId: "foreign" }]) {
      const isolated = await readResult("productTag=新品", false, scope);
      assert.equal(isolated.total, 0); assert.deepEqual(isolated.facets, { productTags: [], brands: [] });
    }
    // ASIN fallback chooses aaa; conflicting Listing metadata must not pick an arbitrary min.
    await query(`UPDATE "${model}" SET msku='absent' WHERE id='b'`);
    assert.deepEqual(fields(await read()), ["https://example.test/exact.jpg", null, null, null, null, null, null]);
    // All shows a conflict as NULL; yes/no select the matching member before rollup.
    await buyBoxCosts(2, 3);
    await buyBoxCosts(2, null, "brand=品牌&productTag=新品&fulfillment=AFN");
    await buyBoxCosts(null, 3, "brand=其他品牌&productTag=其他&fulfillment=MFN");
    assert.equal((await readResult("buyBox=no&pageSize=1&page=2")).rows.length, 0);
    assert.equal((await readResult("buyBox=no&pageSize=1&page=2")).totals[0].cost, 3);
    await fulfillmentCosts(2, 3); // ASIN fallback is MFN; filter members before entity/totals rollup.
    await brandCost("品牌", 2);
    await brandCost("其他品牌", 3);
    await brandCost("其他品牌", 3, "productTag=其他&fulfillment=MFN");
    assert.equal((await readResult("fulfillment=MFN&productTag=其他")).rows[0].cost, 3);
    assert.equal((await readResult("fulfillment=AFN&productTag=其他")).total, 0);
    const partial = await readResult("productTag=新品");
    assert.equal(partial.rows[0].cost, 2); assert.equal(partial.totals[0].cost, 2); // Filter members before rollup.
    const fallback = await readResult("productTag=其他");
    assert.equal(fallback.rows[0].cost, 3); assert.equal(fallback.totals[0].cost, 3);
    await query(`UPDATE "${model}" SET asin=NULL WHERE id='b'`);
    assert.deepEqual(fields(await read()), ["https://example.test/exact.jpg", null, null, null, null, null, null]);
    await buyBoxCosts(2, null);
    await fulfillmentCosts(2, null);
    await brandCost("品牌", 2); await brandCost("其他品牌", null);
    await query(`UPDATE "${model}" SET msku=NULL,asin=NULL WHERE id='a'`);
    assert.deepEqual(fields(await read()), [null, null, null, null, null, null, null]);
    await fulfillmentCosts(null, null);
    await brandCost("品牌", null);
    await buyBoxCosts(null, null);
    // Identities present only in another org/workspace/store must not supply metadata.
    await query(`UPDATE sellfox_listing_current SET msku='isolated',asin='ISOLATED',fulfillment='AFN'
      WHERE id IN ('foreign-org','foreign-ws','foreign-store','other-store')`);
    await query(`UPDATE "${model}" SET msku='isolated',asin='ISOLATED' WHERE id IN ('a','b')`);
    await fulfillmentCosts(null, null);
    await buyBoxCosts(null, null);
    await brandCost("foreign", null); await brandCost("其他店品牌", null);
    await query(`UPDATE sellfox_listing_current SET msku='exact',asin='ASIN',fulfillment='未知'
      WHERE id IN ('foreign-org','foreign-ws','foreign-store','other-store')`);
    assert.equal((await readResult("productTag=新品")).total, 0);
    await query(`UPDATE sellfox_listing_current SET "mainImage"='' WHERE id='exact'`);
    await query(`UPDATE "${model}" SET msku='exact',asin='ASIN' WHERE id IN ('a','b')`);
    assert.deepEqual(fields(await read()), [null, "4.4", "新品、重点", 128, "品牌", "AFN", "是"]);
    await query(`UPDATE sellfox_listing_current SET "mainImage"='https://example.test/exact.jpg' WHERE id='exact'`);
    // Matched Listing with missing typed metadata also invalidates unanimity.
    await query(`UPDATE sellfox_listing_current SET "ratingCount"=NULL,brand=NULL,fulfillment=NULL,"buyBoxWinner"=NULL WHERE id='sibling'`);
    await query(`UPDATE "${model}" SET msku='absent' WHERE id='b'`);
    const missing = await read();
    assert.deepEqual([missing.ratingCount, missing.brand, missing.fulfillment, missing.buyBoxWinner], [null, null, null, null]);
    await buyBoxCosts(2, null);
    await fulfillmentCosts(2, null);
    await brandCost("品牌", 2); await brandCost("其他品牌", null); // NULL brand cannot join a selected subset.
    await query(`UPDATE "${model}" SET msku='exact' WHERE id='b'`);
    await query(`UPDATE sellfox_listing_current SET "ratingCount"=0 WHERE id='exact'`);
    for (const exporting of [false, true]) assert.equal((await read(exporting)).ratingCount, 0);
    // Preserve typed strings, including numeric-looking brands, explicit unknown and empty strings.
    await query(`UPDATE sellfox_listing_current SET brand='00123',fulfillment='未知',"buyBoxWinner"='否' WHERE id='exact'`);
    const text = await read(true);
    assert.deepEqual([text.brand, text.fulfillment, text.buyBoxWinner], ["00123", "未知", "否"]);
    await buyBoxCosts(null, 5);
    await brandCost("00123", 5); await brandCost("123", null);
    await query(`UPDATE sellfox_listing_current SET brand='',fulfillment='' WHERE id='exact'`);
    const empty = await read();
    assert.deepEqual([empty.brand, empty.fulfillment], ["", ""]);
    await brandCost("00123", null); await brandCost("品牌", null);
    await query(`UPDATE sellfox_listing_current SET brand=NULL WHERE id='exact'`);
    await brandCost("00123", null); await brandCost("品牌", null);
    assert.deepEqual((await readResult("storeId=s")).facets!.brands, ["00123"]); // NULL excluded; duplicate names distinct.
    for (const value of [null, "", "未知", "afn", "AFN "]) {
      await query(`UPDATE sellfox_listing_current SET fulfillment=$1 WHERE id='exact'`, [value]);
      await fulfillmentCosts(null, null); // Exact typed comparison; no coercion to AFN/MFN.
    }
    // Chosen MSKU with NULL/conflict-as-NULL/unknown must not borrow the ASIN sibling's answer.
    await query(`UPDATE sellfox_listing_current SET "buyBoxWinner"='是' WHERE id='sibling'`);
    for (const value of [null, "", "未知", "true", "false", "yes", "no", "是 "]) {
      await query(`UPDATE sellfox_listing_current SET "buyBoxWinner"=$1 WHERE id='exact'`, [value]);
      await buyBoxCosts(null, null);
    }
    await query(`UPDATE sellfox_listing_current SET "buyBoxWinner"=CASE WHEN id='exact' THEN '是' ELSE '否' END,brand=CASE WHEN id='exact' THEN '品牌' ELSE '其他品牌' END,fulfillment=CASE WHEN id='exact' THEN 'AFN' ELSE 'MFN' END WHERE id IN ('exact','sibling')`);
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
      console.log("PASS: ads Phase A/B and six-tab Listing metadata + exact buyBox/brand/fulfillment/productTag filters/scoped facets (disposable PGlite)");
    } finally { await db.close(); }
  })().catch(error => { console.error(error); process.exitCode = 1; });
}
