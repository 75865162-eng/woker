import test from "node:test";
import assert from "node:assert/strict";
import { workbenchReadSql } from "@/lib/sellfox/workbench-read";
import { sellfoxBrowseQuery } from "@/lib/sellfox/browse-query";
import { sellfoxSortColumns } from "@/lib/sellfox/sort-columns";
import { columns, defaultVisibleColumnKeys, visibleColumns, visibleColumnCsv } from "@/components/sellfox/workbench-types";

const scope = { organizationId: "org-listing", workspaceId: "ws-listing" };
test("listings range filters typed openDate inclusively for browse and export while facets stay scope-only", () => {
  for (const exporting of [false, true]) for (const range of ["", "from=2024-01-15", "to=2024-02-20", "from=2024-01-15&to=2024-02-20"]) {
    const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}`), "listings");
    const sql = workbenchReadSql("listings", query, scope, exporting);
    for (const [date, predicate] of [[query.from, /s\."openDate">=\$(\d+)/], [query.to, /s\."openDate"<=\$(\d+)/]] as const) {
      if (date) {
        const match = sql.text.match(predicate);
        assert.ok(match);
        assert.equal(sql.values[Number(match[1]) - 1], date);
      } else assert.doesNotMatch(sql.text, predicate);
    }
    assert.doesNotMatch(sql.text, /"reportDate"[<>]=|"sourceUpdatedAt"[<>]=|payload/);
    if (!exporting) {
      const facets = sql.text.slice(sql.text.indexOf("facet_source AS MATERIALIZED"), sql.text.indexOf("SELECT (SELECT COALESCE"));
      assert.doesNotMatch(facets, /openDate/);
      assert.match(facets, /s\."organizationId"=/);
      assert.match(facets, /s\."workspaceId"=/);
    }
  }
});

test("DXM publish state is a default-visible listing-only raw text column, distinct from price and pairing", () => {
  const config = visibleColumns("listings", ["dxmPublishState"]);
  assert.equal(config.length, 1);
  assert.equal(config[0].labelZh, "DXM 发布状态");
  assert.equal(config[0].defaultVisible, true);
  assert.ok(!config[0].unavailable);
  assert.equal(defaultVisibleColumnKeys("listings").includes("dxmPublishState"), true);
  assert.equal(visibleColumnCsv(config, [{ dxmPublishState: "delete" }, { dxmPublishState: "future-state" }, { dxmPublishState: null }]).trim(), '"DXM 发布状态"\r\n"delete"\r\n"future-state"\r\n""');
  assert.equal(columns.listings.filter(column => column.key === "price").length, 1);
  assert.equal(columns.listings.some(column => ["listingPrice", "listingPricing", "pairingStatus"].includes(column.key)), false);
  assert.equal(sellfoxSortColumns.listings.includes("dxmPublishState"), false);
  for (const exporting of [false, true]) {
    const sql = workbenchReadSql("listings", sellfoxBrowseQuery(new URL("http://localhost/")), scope, exporting);
    assert.match(sql.text, /s\."dxmPublishState"/);
    assert.doesNotMatch(sql.text, /payload|jsonb_array_elements/);
  }
  for (const domain of ["sales", "performance", "ads"]) assert.deepEqual(visibleColumns(domain, ["dxmPublishState"]), []);
});

test("listings default and common filters read typed projection without payload or enrichment joins", () => {
  for (const exporting of [false,true]) for (const dimension of ["asin","msku","parentAsin"]) {
    const query = sellfoxBrowseQuery(new URL(`http://localhost/?dimension=${dimension}&pageSize=20&status=active&brand=Brand&fulfillment=AFN&buyBox=yes&productTag=${encodeURIComponent("标签、完整")}&shopExternalId=shop&site=US`));
    const sql = workbenchReadSql("listings",query,scope,exporting);
    assert.doesNotMatch(sql.text,/payload|jsonb_array_elements|JOIN "SellfoxListingSnapshot"|JOIN listing|inventory_current/);
    assert.match(sql.text,/filtered AS NOT MATERIALIZED/);
    assert.match(sql.text,/counts AS MATERIALIZED \(SELECT currency,count\(\*\)::int AS count/);
    assert.match(sql.text,/s\.brand=/); assert.match(sql.text,/s\.fulfillment=/); assert.match(sql.text,/s\."buyBoxWinner"=/);
    assert.match(sql.text,/s\."productTagNames" @> ARRAY\[/);
    for (const value of [scope.organizationId,scope.workspaceId,"shop","US","Brand","AFN","是","标签、完整"]) assert.ok(sql.values.includes(value));
    if (exporting) assert.doesNotMatch(sql.text,/facet_source|AS facets/);
    else {
      const facets = sql.text.slice(sql.text.indexOf("facet_source AS MATERIALIZED"),sql.text.indexOf("SELECT (SELECT COALESCE"));
      assert.match(facets,/s\."organizationId"=/); assert.match(facets,/s\."workspaceId"=/);
      assert.match(facets,/s\."shopExternalId" IN/); assert.match(facets,/s\.marketplace=/);
      assert.doesNotMatch(facets,/s\.brand=|s\.fulfillment=|status ILIKE| @>/);
    }
  }
});

test("all allowed listing sorts operate on typed selected columns before pagination with stable ties", () => {
  for (const sortBy of sellfoxSortColumns.listings) for (const sortOrder of ["asc","desc"]) {
    const sql = workbenchReadSql("listings",sellfoxBrowseQuery(new URL(`http://localhost/?sortBy=${sortBy}&sortOrder=${sortOrder}&page=2&pageSize=20`),"listings"),scope);
    assert.ok(sql.text.includes(`s."${sortBy}"`));
    assert.ok(sql.text.includes(`FROM filtered ORDER BY "${sortBy === "rating" ? "ratingValue" : sortBy}" ${sortOrder.toUpperCase()} NULLS LAST, id ASC`));
    assert.deepEqual(sql.values.slice(-2),[20,20]);
    assert.doesNotMatch(sql.text,/payload|::float/);
  }
  const defaults = sellfoxBrowseQuery(new URL("http://localhost/"));
  assert.throws(()=>workbenchReadSql("listings",{...defaults,sortBy:'id";DROP TABLE'},scope),/排序/);
  assert.throws(()=>workbenchReadSql("listings",{...defaults,searchType:"campaignId"},scope),/搜索类型/);
});

test("listings DXM publish state is a bound exact predicate; DISTINCT facets remain scope-only and exclude NULL", () => {
  for (const exporting of [false, true]) for (const value of [undefined, "", "   ", "delete", "future-state", "%' OR TRUE--"]) {
    const query = sellfoxBrowseQuery(new URL(`http://localhost/?${new URLSearchParams({ ...(value === undefined ? {} : { dxmPublishState: value }), brand: "Brand", productTag: "标签", from: "2024-01-15", search: "sku", status: "active", shopExternalId: "shop", site: "US" })}`), "listings");
    const sql = workbenchReadSql("listings", query, scope, exporting);
    const predicate = /s\."dxmPublishState"=\$(\d+)/;
    if (value?.trim()) {
      const match = sql.text.match(predicate); assert.ok(match);
      assert.equal(sql.values[Number(match[1]) - 1], value);
      assert.ok(!sql.text.includes(value));
    } else assert.doesNotMatch(sql.text, predicate);
    assert.doesNotMatch(sql.text, /"dxmPublishState" ILIKE|payload|pairing/);
    if (exporting) assert.doesNotMatch(sql.text, /facet_source|AS facets/);
    else {
      const facets = sql.text.slice(sql.text.indexOf("facet_source AS MATERIALIZED"), sql.text.indexOf("SELECT (SELECT COALESCE"));
      assert.match(facets, /SELECT s\.brand,s\."productTagNames",s\."dxmPublishState",s\."bsrCategory"/);
      for (const field of ["organizationId", "workspaceId", "shopExternalId"]) assert.ok(facets.includes(`s."${field}"`));
      assert.match(facets, /s\.marketplace=/);
      assert.doesNotMatch(facets, /s\."dxmPublishState"=|s\."bsrCategory"=|s\.brand=| @>|openDate|ILIKE/);
      assert.match(sql.text, /'dxmPublishStates',ARRAY\(SELECT DISTINCT "dxmPublishState" FROM facet_source WHERE "dxmPublishState" IS NOT NULL ORDER BY 1\)/);
    }
  }
  const query = sellfoxBrowseQuery(new URL("http://localhost/?dxmPublishState=ignored"));
  for (const domain of ["sales", "performance", "ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"] as const) {
    for (const exporting of [false, true]) {
      const sql = workbenchReadSql(domain, query, scope, exporting);
      assert.doesNotMatch(sql.text, /dxmPublishState/);
      assert.ok(!sql.values.includes("ignored"));
    }
  }
});

test("firstSaleDate bounds use only typed column, independently of openDate; facets stay scope-only", () => {
  for (const exporting of [false, true]) {
    for (const range of ["", "firstSaleFrom=2024-02-01", "firstSaleTo=2024-03-01", "firstSaleFrom=2024-02-01&firstSaleTo=2024-03-01"]) {
      for (const openRange of ["", "from=2023-01-01&to=2023-12-31"]) {
        const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}&${openRange}&shopExternalId=shop&site=US`), "listings");
        const sql = workbenchReadSql("listings", query, scope, exporting);
        for (const [value, pattern] of [
          [query.firstSaleFrom, /s\."firstSaleDate">=\$(\d+)/], [query.firstSaleTo, /s\."firstSaleDate"<=\$(\d+)/],
          [query.from, /s\."openDate">=\$(\d+)/], [query.to, /s\."openDate"<=\$(\d+)/],
        ] as const) {
          const match = sql.text.match(pattern);
          if (value) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
          else assert.equal(match, null);
        }
        assert.doesNotMatch(sql.text, /payload|firstOrderDate|COALESCE\(s\."firstSaleDate"|"firstSaleDate" IS NULL|"reportDate"[<>]=/);
        if (!exporting) {
          const facets = sql.text.slice(sql.text.indexOf("facet_source AS MATERIALIZED"), sql.text.indexOf("SELECT (SELECT COALESCE"));
          assert.doesNotMatch(facets, /firstSaleDate|openDate/);
          for (const pattern of [/s\."organizationId"=/, /s\."workspaceId"=/, /s\."shopExternalId" IN/, /s\.marketplace=/]) assert.match(facets, pattern);
        }
      }
    }
  }
});

test("totalInventory min/max use inventory_current storeId+msku sum semantics; facets stay scope-only", () => {
  for (const exporting of [false, true]) {
    for (const range of ["", "totalInventoryMin=0", "totalInventoryMax=100", "totalInventoryMin=0&totalInventoryMax=100"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}&shopExternalId=shop&site=US`), "listings");
      const sql = workbenchReadSql("listings", query, scope, exporting);
      const hasRange = query.totalInventoryMin != null || query.totalInventoryMax != null;
      if (hasRange) {
        assert.match(sql.text, /EXISTS \(SELECT 1 FROM \(SELECT CASE WHEN count\(i\."totalInventory"\)=count\(\*\) THEN sum\(i\."totalInventory"\) END AS inv FROM sellfox_inventory_current i WHERE i\."organizationId"=s\."organizationId" AND i\."workspaceId"=s\."workspaceId" AND i\."storeId"=s\."storeId" AND i\.msku=s\.msku GROUP BY i\."storeId", i\.msku\) stock WHERE/);
        assert.match(sql.text, /stock\.inv IS NOT NULL/);
        for (const [value, pattern] of [[query.totalInventoryMin, /stock\.inv>=\$(\d+)/], [query.totalInventoryMax, /stock\.inv<=\$(\d+)/]] as const) {
          const match = sql.text.match(pattern);
          if (value != null) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
          else assert.equal(match, null);
        }
      } else {
        assert.doesNotMatch(sql.text, /sellfox_inventory_current|stock\.inv/);
      }
      assert.doesNotMatch(sql.text, /s\."totalInventory"|awd|AWD/);
      if (!exporting) {
        const facets = sql.text.slice(sql.text.indexOf("facet_source AS MATERIALIZED"), sql.text.indexOf("SELECT (SELECT COALESCE"));
        assert.doesNotMatch(facets, /totalInventory|sellfox_inventory_current/);
        for (const pattern of [/s\."organizationId"=/, /s\."workspaceId"=/, /s\."shopExternalId" IN/, /s\.marketplace=/]) assert.match(facets, pattern);
      }
    }
  }
  for (const domain of ["sales", "performance", "ads_report"] as const) {
    const query = sellfoxBrowseQuery(new URL("http://localhost/?totalInventoryMin=1&totalInventoryMax=9"), domain);
    const sql = workbenchReadSql(domain, query, scope, false);
    assert.doesNotMatch(sql.text, /stock\.inv|totalInventoryMin/);
  }
});

test("bsrRank min/max filter typed column on listing_current; facets stay scope-only", () => {
  for (const exporting of [false, true]) {
    for (const range of ["", "bsrRankMin=0", "bsrRankMax=10000", "bsrRankMin=1&bsrRankMax=5000"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}&shopExternalId=shop&site=US`), "listings");
      const sql = workbenchReadSql("listings", query, scope, exporting);
      const hasRange = query.bsrRankMin != null || query.bsrRankMax != null;
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
      if (!exporting) {
        const facets = sql.text.slice(sql.text.indexOf("facet_source AS MATERIALIZED"), sql.text.indexOf("SELECT (SELECT COALESCE"));
        assert.doesNotMatch(facets, /bsrRank/);
        for (const pattern of [/s\."organizationId"=/, /s\."workspaceId"=/, /s\."shopExternalId" IN/, /s\.marketplace=/]) assert.match(facets, pattern);
      }
    }
  }
  for (const domain of ["sales", "performance", "ads_report"] as const) {
    const query = sellfoxBrowseQuery(new URL("http://localhost/?bsrRankMin=1&bsrRankMax=9"), domain);
    const sql = workbenchReadSql(domain, query, scope, false);
    assert.doesNotMatch(sql.text, /s\."bsrRank" IS NOT NULL|bsrRankMin/);
  }
});

test("listingQuantity min/max filter typed column on listing_current; facets stay scope-only", () => {
  for (const exporting of [false, true]) {
    for (const range of ["", "listingQuantityMin=0", "listingQuantityMax=10000", "listingQuantityMin=1&listingQuantityMax=5000"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}&shopExternalId=shop&site=US`), "listings");
      const sql = workbenchReadSql("listings", query, scope, exporting);
      const hasRange = query.listingQuantityMin != null || query.listingQuantityMax != null;
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
      if (!exporting) {
        const facets = sql.text.slice(sql.text.indexOf("facet_source AS MATERIALIZED"), sql.text.indexOf("SELECT (SELECT COALESCE"));
        assert.doesNotMatch(facets, /listingQuantity/);
        for (const pattern of [/s\."organizationId"=/, /s\."workspaceId"=/, /s\."shopExternalId" IN/, /s\.marketplace=/]) assert.match(facets, pattern);
      }
    }
  }
  for (const domain of ["sales", "performance", "ads_report"] as const) {
    const query = sellfoxBrowseQuery(new URL("http://localhost/?listingQuantityMin=1&listingQuantityMax=9"), domain);
    const sql = workbenchReadSql(domain, query, scope, false);
    assert.doesNotMatch(sql.text, /s\."listingQuantity" IS NOT NULL|listingQuantityMin/);
  }
});

test("reservedQty min/max filter typed column on listing_current; facets stay scope-only", () => {
  for (const exporting of [false, true]) {
    for (const range of ["", "reservedQtyMin=0", "reservedQtyMax=10000", "reservedQtyMin=1&reservedQtyMax=5000"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}&shopExternalId=shop&site=US`), "listings");
      const sql = workbenchReadSql("listings", query, scope, exporting);
      const hasRange = query.reservedQtyMin != null || query.reservedQtyMax != null;
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
      if (!exporting) {
        const facets = sql.text.slice(sql.text.indexOf("facet_source AS MATERIALIZED"), sql.text.indexOf("SELECT (SELECT COALESCE"));
        assert.doesNotMatch(facets, /reservedQty/);
        for (const pattern of [/s\."organizationId"=/, /s\."workspaceId"=/, /s\."shopExternalId" IN/, /s\.marketplace=/]) assert.match(facets, pattern);
      }
    }
  }
  for (const domain of ["sales", "performance", "ads_report"] as const) {
    const query = sellfoxBrowseQuery(new URL("http://localhost/?reservedQtyMin=1&reservedQtyMax=9"), domain);
    const sql = workbenchReadSql(domain, query, scope, false);
    assert.doesNotMatch(sql.text, /s\."reservedQty" IS NOT NULL|reservedQtyMin/);
  }
});

test("listings bsrCategory is a bound exact predicate; DISTINCT facets remain scope-only and exclude NULL", () => {
  for (const exporting of [false, true]) for (const value of [undefined, "", "   ", "Baby", "Musical Instruments", "%' OR TRUE--"]) {
    const query = sellfoxBrowseQuery(new URL(`http://localhost/?${new URLSearchParams({ ...(value === undefined ? {} : { bsrCategory: value }), brand: "Brand", productTag: "标签", from: "2024-01-15", search: "sku", status: "active", shopExternalId: "shop", site: "US" })}`), "listings");
    const sql = workbenchReadSql("listings", query, scope, exporting);
    const predicate = /s\."bsrCategory"=\$(\d+)/;
    if (value?.trim()) {
      const match = sql.text.match(predicate); assert.ok(match);
      assert.equal(sql.values[Number(match[1]) - 1], value);
      assert.ok(!sql.text.includes(value));
    } else assert.doesNotMatch(sql.text, predicate);
    assert.doesNotMatch(sql.text, /"bsrCategory" ILIKE|payload/);
    if (exporting) assert.doesNotMatch(sql.text, /facet_source|AS facets/);
    else {
      const facets = sql.text.slice(sql.text.indexOf("facet_source AS MATERIALIZED"), sql.text.indexOf("SELECT (SELECT COALESCE"));
      assert.match(facets, /SELECT s\.brand,s\."productTagNames",s\."dxmPublishState",s\."bsrCategory"/);
      for (const field of ["organizationId", "workspaceId", "shopExternalId"]) assert.ok(facets.includes(`s."${field}"`));
      assert.match(facets, /s\.marketplace=/);
      assert.doesNotMatch(facets, /s\."bsrCategory"=|s\.brand=| @>|openDate|ILIKE/);
      assert.match(sql.text, /'bsrCategories',ARRAY\(SELECT DISTINCT "bsrCategory" FROM facet_source WHERE "bsrCategory" IS NOT NULL ORDER BY 1\)/);
    }
  }
  const query = sellfoxBrowseQuery(new URL("http://localhost/?bsrCategory=ignored"));
  for (const domain of ["sales", "performance", "ads_report", "ads_targeting", "ads_search_term", "ads_campaign", "ads_ad_group", "ads_placement"] as const) {
    for (const exporting of [false, true]) {
      const sql = workbenchReadSql(domain, query, scope, exporting);
      assert.doesNotMatch(sql.text, /bsrCategory/);
      assert.ok(!sql.values.includes("ignored"));
    }
  }
});
