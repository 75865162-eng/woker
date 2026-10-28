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

test("fulfillable min/max filter typed column on listing_current; facets stay scope-only", () => {
  for (const exporting of [false, true]) {
    for (const range of ["", "fulfillableMin=0", "fulfillableMax=10000", "fulfillableMin=1&fulfillableMax=500"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}&shopExternalId=shop&site=US`), "listings");
      const sql = workbenchReadSql("listings", query, scope, exporting);
      const hasRange = query.fulfillableMin != null || query.fulfillableMax != null;
      if (hasRange) {
        assert.match(sql.text, /s\."fulfillable" IS NOT NULL/);
        for (const [value, pattern] of [[query.fulfillableMin, /s\."fulfillable">=\$(\d+)/], [query.fulfillableMax, /s\."fulfillable"<=\$(\d+)/]] as const) {
          const match = sql.text.match(pattern);
          if (value != null) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
          else assert.equal(match, null);
        }
      } else {
        assert.doesNotMatch(sql.text, /s\."fulfillable" IS NOT NULL|s\."fulfillable">=|s\."fulfillable"<=/);
      }
      if (!exporting) {
        const facets = sql.text.slice(sql.text.indexOf("facet_source AS MATERIALIZED"), sql.text.indexOf("SELECT (SELECT COALESCE"));
        assert.doesNotMatch(facets, /fulfillableMin|fulfillableMax|s\."fulfillable">=|s\."fulfillable"<=/);
        for (const pattern of [/s\."organizationId"=/, /s\."workspaceId"=/, /s\."shopExternalId" IN/, /s\.marketplace=/]) assert.match(facets, pattern);
      }
    }
  }
  for (const domain of ["sales", "performance", "ads_report"] as const) {
    const query = sellfoxBrowseQuery(new URL("http://localhost/?fulfillableMin=1&fulfillableMax=9"), domain);
    const sql = workbenchReadSql(domain, query, scope, false);
    assert.doesNotMatch(sql.text, /s\."fulfillable" IS NOT NULL|fulfillableMin/);
  }
});

test("sales7 min/max filter typed column on listing_current; facets stay scope-only", () => {
  for (const exporting of [false, true]) {
    for (const range of ["", "sales7Min=0", "sales7Max=10000", "sales7Min=1&sales7Max=500"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}&shopExternalId=shop&site=US`), "listings");
      const sql = workbenchReadSql("listings", query, scope, exporting);
      const hasRange = query.sales7Min != null || query.sales7Max != null;
      if (hasRange) {
        assert.match(sql.text, /s\."sales7" IS NOT NULL/);
        for (const [value, pattern] of [[query.sales7Min, /s\."sales7">=\$(\d+)/], [query.sales7Max, /s\."sales7"<=\$(\d+)/]] as const) {
          const match = sql.text.match(pattern);
          if (value != null) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
          else assert.equal(match, null);
        }
      } else {
        assert.doesNotMatch(sql.text, /s\."sales7" IS NOT NULL|s\."sales7">=|s\."sales7"<=/);
      }
      if (!exporting) {
        const facets = sql.text.slice(sql.text.indexOf("facet_source AS MATERIALIZED"), sql.text.indexOf("SELECT (SELECT COALESCE"));
        assert.doesNotMatch(facets, /sales7Min|sales7Max|s\."sales7">=|s\."sales7"<=/);
        for (const pattern of [/s\."organizationId"=/, /s\."workspaceId"=/, /s\."shopExternalId" IN/, /s\.marketplace=/]) assert.match(facets, pattern);
      }
    }
  }
  for (const domain of ["sales", "performance", "ads_report"] as const) {
    const query = sellfoxBrowseQuery(new URL("http://localhost/?sales7Min=1&sales7Max=9"), domain);
    const sql = workbenchReadSql(domain, query, scope, false);
    assert.doesNotMatch(sql.text, /s\."sales7" IS NOT NULL|sales7Min/);
  }
});

test("sales14 min/max filter typed column on listing_current; facets stay scope-only", () => {
  for (const exporting of [false, true]) {
    for (const range of ["", "sales14Min=0", "sales14Max=10000", "sales14Min=1&sales14Max=500"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}&shopExternalId=shop&site=US`), "listings");
      const sql = workbenchReadSql("listings", query, scope, exporting);
      const hasRange = query.sales14Min != null || query.sales14Max != null;
      if (hasRange) {
        assert.match(sql.text, /s\."sales14" IS NOT NULL/);
        for (const [value, pattern] of [[query.sales14Min, /s\."sales14">=\$(\d+)/], [query.sales14Max, /s\."sales14"<=\$(\d+)/]] as const) {
          const match = sql.text.match(pattern);
          if (value != null) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
          else assert.equal(match, null);
        }
      } else {
        assert.doesNotMatch(sql.text, /s\."sales14" IS NOT NULL|s\."sales14">=|s\."sales14"<=/);
      }
      if (!exporting) {
        const facets = sql.text.slice(sql.text.indexOf("facet_source AS MATERIALIZED"), sql.text.indexOf("SELECT (SELECT COALESCE"));
        assert.doesNotMatch(facets, /sales14Min|sales14Max|s\."sales14">=|s\."sales14"<=/);
        for (const pattern of [/s\."organizationId"=/, /s\."workspaceId"=/, /s\."shopExternalId" IN/, /s\.marketplace=/]) assert.match(facets, pattern);
      }
    }
  }
  for (const domain of ["sales", "performance", "ads_report"] as const) {
    const query = sellfoxBrowseQuery(new URL("http://localhost/?sales14Min=1&sales14Max=9"), domain);
    const sql = workbenchReadSql(domain, query, scope, false);
    assert.doesNotMatch(sql.text, /s\."sales14" IS NOT NULL|sales14Min/);
  }
});

test("sales30 min/max filter typed column on listing_current; facets stay scope-only", () => {
  for (const exporting of [false, true]) {
    for (const range of ["", "sales30Min=0", "sales30Max=10000", "sales30Min=1&sales30Max=500"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}&shopExternalId=shop&site=US`), "listings");
      const sql = workbenchReadSql("listings", query, scope, exporting);
      const hasRange = query.sales30Min != null || query.sales30Max != null;
      if (hasRange) {
        assert.match(sql.text, /s\."sales30" IS NOT NULL/);
        for (const [value, pattern] of [[query.sales30Min, /s\."sales30">=\$(\d+)/], [query.sales30Max, /s\."sales30"<=\$(\d+)/]] as const) {
          const match = sql.text.match(pattern);
          if (value != null) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
          else assert.equal(match, null);
        }
      } else {
        assert.doesNotMatch(sql.text, /s\."sales30" IS NOT NULL|s\."sales30">=|s\."sales30"<=/);
      }
      if (!exporting) {
        const facets = sql.text.slice(sql.text.indexOf("facet_source AS MATERIALIZED"), sql.text.indexOf("SELECT (SELECT COALESCE"));
        assert.doesNotMatch(facets, /sales30Min|sales30Max|s\."sales30">=|s\."sales30"<=/);
        for (const pattern of [/s\."organizationId"=/, /s\."workspaceId"=/, /s\."shopExternalId" IN/, /s\.marketplace=/]) assert.match(facets, pattern);
      }
    }
  }
  for (const domain of ["sales", "performance", "ads_report"] as const) {
    const query = sellfoxBrowseQuery(new URL("http://localhost/?sales30Min=1&sales30Max=9"), domain);
    const sql = workbenchReadSql(domain, query, scope, false);
    assert.doesNotMatch(sql.text, /s\."sales30" IS NOT NULL|sales30Min/);
  }
});

test("revenue7 min/max filter typed column on listing_current; facets stay scope-only", () => {
  for (const exporting of [false, true]) {
    for (const range of ["", "revenue7Min=0", "revenue7Max=10000", "revenue7Min=1.5&revenue7Max=48"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}&shopExternalId=shop&site=US`), "listings");
      const sql = workbenchReadSql("listings", query, scope, exporting);
      const hasRange = query.revenue7Min != null || query.revenue7Max != null;
      if (hasRange) {
        assert.match(sql.text, /s\."revenue7" IS NOT NULL/);
        for (const [value, pattern] of [[query.revenue7Min, /s\."revenue7">=\$(\d+)/], [query.revenue7Max, /s\."revenue7"<=\$(\d+)/]] as const) {
          const match = sql.text.match(pattern);
          if (value != null) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
          else assert.equal(match, null);
        }
      } else {
        assert.doesNotMatch(sql.text, /s\."revenue7" IS NOT NULL|s\."revenue7">=|s\."revenue7"<=/);
      }
      if (!exporting) {
        const facets = sql.text.slice(sql.text.indexOf("facet_source AS MATERIALIZED"), sql.text.indexOf("SELECT (SELECT COALESCE"));
        assert.doesNotMatch(facets, /revenue7Min|revenue7Max|s\."revenue7">=|s\."revenue7"<=/);
        for (const pattern of [/s\."organizationId"=/, /s\."workspaceId"=/, /s\."shopExternalId" IN/, /s\.marketplace=/]) assert.match(facets, pattern);
      }
    }
  }
  for (const domain of ["sales", "performance", "ads_report"] as const) {
    const query = sellfoxBrowseQuery(new URL("http://localhost/?revenue7Min=1&revenue7Max=9"), domain);
    const sql = workbenchReadSql(domain, query, scope, false);
    assert.doesNotMatch(sql.text, /s\."revenue7" IS NOT NULL|revenue7Min/);
  }
});

test("revenue14 min/max filter typed column on listing_current; facets stay scope-only", () => {
  for (const exporting of [false, true]) {
    for (const range of ["", "revenue14Min=0", "revenue14Max=10000", "revenue14Min=1.5&revenue14Max=48"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}&shopExternalId=shop&site=US`), "listings");
      const sql = workbenchReadSql("listings", query, scope, exporting);
      const hasRange = query.revenue14Min != null || query.revenue14Max != null;
      if (hasRange) {
        assert.match(sql.text, /s\."revenue14" IS NOT NULL/);
        for (const [value, pattern] of [[query.revenue14Min, /s\."revenue14">=\$(\d+)/], [query.revenue14Max, /s\."revenue14"<=\$(\d+)/]] as const) {
          const match = sql.text.match(pattern);
          if (value != null) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
          else assert.equal(match, null);
        }
      } else {
        assert.doesNotMatch(sql.text, /s\."revenue14" IS NOT NULL|s\."revenue14">=|s\."revenue14"<=/);
      }
      if (!exporting) {
        const facets = sql.text.slice(sql.text.indexOf("facet_source AS MATERIALIZED"), sql.text.indexOf("SELECT (SELECT COALESCE"));
        assert.doesNotMatch(facets, /revenue14Min|revenue14Max|s\."revenue14">=|s\."revenue14"<=/);
        for (const pattern of [/s\."organizationId"=/, /s\."workspaceId"=/, /s\."shopExternalId" IN/, /s\.marketplace=/]) assert.match(facets, pattern);
      }
    }
  }
  for (const domain of ["sales", "performance", "ads_report"] as const) {
    const query = sellfoxBrowseQuery(new URL("http://localhost/?revenue14Min=1&revenue14Max=9"), domain);
    const sql = workbenchReadSql(domain, query, scope, false);
    assert.doesNotMatch(sql.text, /s\."revenue14" IS NOT NULL|revenue14Min/);
  }
});

test("revenue30 min/max filter typed column on listing_current; facets stay scope-only", () => {
  for (const exporting of [false, true]) {
    for (const range of ["", "revenue30Min=0", "revenue30Max=10000", "revenue30Min=1.5&revenue30Max=48"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}&shopExternalId=shop&site=US`), "listings");
      const sql = workbenchReadSql("listings", query, scope, exporting);
      const hasRange = query.revenue30Min != null || query.revenue30Max != null;
      if (hasRange) {
        assert.match(sql.text, /s\."revenue30" IS NOT NULL/);
        for (const [value, pattern] of [[query.revenue30Min, /s\."revenue30">=\$(\d+)/], [query.revenue30Max, /s\."revenue30"<=\$(\d+)/]] as const) {
          const match = sql.text.match(pattern);
          if (value != null) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
          else assert.equal(match, null);
        }
      } else {
        assert.doesNotMatch(sql.text, /s\."revenue30" IS NOT NULL|s\."revenue30">=|s\."revenue30"<=/);
      }
      if (!exporting) {
        const facets = sql.text.slice(sql.text.indexOf("facet_source AS MATERIALIZED"), sql.text.indexOf("SELECT (SELECT COALESCE"));
        assert.doesNotMatch(facets, /revenue30Min|revenue30Max|s\."revenue30">=|s\."revenue30"<=/);
        for (const pattern of [/s\."organizationId"=/, /s\."workspaceId"=/, /s\."shopExternalId" IN/, /s\.marketplace=/]) assert.match(facets, pattern);
      }
    }
  }
  for (const domain of ["sales", "performance", "ads_report"] as const) {
    const query = sellfoxBrowseQuery(new URL("http://localhost/?revenue30Min=1&revenue30Max=9"), domain);
    const sql = workbenchReadSql(domain, query, scope, false);
    assert.doesNotMatch(sql.text, /s\."revenue30" IS NOT NULL|revenue30Min/);
  }
});

test("adSpend7 min/max filter typed column on listing_current; facets stay scope-only", () => {
  for (const exporting of [false, true]) {
    for (const range of ["", "adSpend7Min=0", "adSpend7Max=10000", "adSpend7Min=1.5&adSpend7Max=48"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}&shopExternalId=shop&site=US`), "listings");
      const sql = workbenchReadSql("listings", query, scope, exporting);
      const hasRange = query.adSpend7Min != null || query.adSpend7Max != null;
      if (hasRange) {
        assert.match(sql.text, /s\."adSpend7" IS NOT NULL/);
        for (const [value, pattern] of [[query.adSpend7Min, /s\."adSpend7">=\$(\d+)/], [query.adSpend7Max, /s\."adSpend7"<=\$(\d+)/]] as const) {
          const match = sql.text.match(pattern);
          if (value != null) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
          else assert.equal(match, null);
        }
      } else {
        assert.doesNotMatch(sql.text, /s\."adSpend7" IS NOT NULL|s\."adSpend7">=|s\."adSpend7"<=/);
      }
      if (!exporting) {
        const facets = sql.text.slice(sql.text.indexOf("facet_source AS MATERIALIZED"), sql.text.indexOf("SELECT (SELECT COALESCE"));
        assert.doesNotMatch(facets, /adSpend7Min|adSpend7Max|s\."adSpend7">=|s\."adSpend7"<=/);
        for (const pattern of [/s\."organizationId"=/, /s\."workspaceId"=/, /s\."shopExternalId" IN/, /s\.marketplace=/]) assert.match(facets, pattern);
      }
    }
  }
  for (const domain of ["sales", "performance", "ads_report"] as const) {
    const query = sellfoxBrowseQuery(new URL("http://localhost/?adSpend7Min=1&adSpend7Max=9"), domain);
    const sql = workbenchReadSql(domain, query, scope, false);
    assert.doesNotMatch(sql.text, /s\."adSpend7" IS NOT NULL|adSpend7Min/);
  }
});

test("adSpend14 min/max filter typed column on listing_current; facets stay scope-only", () => {
  for (const exporting of [false, true]) {
    for (const range of ["", "adSpend14Min=0", "adSpend14Max=10000", "adSpend14Min=1.5&adSpend14Max=48"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}&shopExternalId=shop&site=US`), "listings");
      const sql = workbenchReadSql("listings", query, scope, exporting);
      const hasRange = query.adSpend14Min != null || query.adSpend14Max != null;
      if (hasRange) {
        assert.match(sql.text, /s\."adSpend14" IS NOT NULL/);
        for (const [value, pattern] of [[query.adSpend14Min, /s\."adSpend14">=\$(\d+)/], [query.adSpend14Max, /s\."adSpend14"<=\$(\d+)/]] as const) {
          const match = sql.text.match(pattern);
          if (value != null) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
          else assert.equal(match, null);
        }
      } else {
        assert.doesNotMatch(sql.text, /s\."adSpend14" IS NOT NULL|s\."adSpend14">=|s\."adSpend14"<=/);
      }
      if (!exporting) {
        const facets = sql.text.slice(sql.text.indexOf("facet_source AS MATERIALIZED"), sql.text.indexOf("SELECT (SELECT COALESCE"));
        assert.doesNotMatch(facets, /adSpend14Min|adSpend14Max|s\."adSpend14">=|s\."adSpend14"<=/);
        for (const pattern of [/s\."organizationId"=/, /s\."workspaceId"=/, /s\."shopExternalId" IN/, /s\.marketplace=/]) assert.match(facets, pattern);
      }
    }
  }
  for (const domain of ["sales", "performance", "ads_report"] as const) {
    const query = sellfoxBrowseQuery(new URL("http://localhost/?adSpend14Min=1&adSpend14Max=9"), domain);
    const sql = workbenchReadSql(domain, query, scope, false);
    assert.doesNotMatch(sql.text, /s\."adSpend14" IS NOT NULL|adSpend14Min/);
  }
});

test("adSpend30 min/max filter typed column on listing_current; facets stay scope-only", () => {
  for (const exporting of [false, true]) {
    for (const range of ["", "adSpend30Min=0", "adSpend30Max=10000", "adSpend30Min=1.5&adSpend30Max=48"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}&shopExternalId=shop&site=US`), "listings");
      const sql = workbenchReadSql("listings", query, scope, exporting);
      const hasRange = query.adSpend30Min != null || query.adSpend30Max != null;
      if (hasRange) {
        assert.match(sql.text, /s\."adSpend30" IS NOT NULL/);
        for (const [value, pattern] of [[query.adSpend30Min, /s\."adSpend30">=\$(\d+)/], [query.adSpend30Max, /s\."adSpend30"<=\$(\d+)/]] as const) {
          const match = sql.text.match(pattern);
          if (value != null) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
          else assert.equal(match, null);
        }
      } else {
        assert.doesNotMatch(sql.text, /s\."adSpend30" IS NOT NULL|s\."adSpend30">=|s\."adSpend30"<=/);
      }
      if (!exporting) {
        const facets = sql.text.slice(sql.text.indexOf("facet_source AS MATERIALIZED"), sql.text.indexOf("SELECT (SELECT COALESCE"));
        assert.doesNotMatch(facets, /adSpend30Min|adSpend30Max|s\."adSpend30">=|s\."adSpend30"<=/);
        for (const pattern of [/s\."organizationId"=/, /s\."workspaceId"=/, /s\."shopExternalId" IN/, /s\.marketplace=/]) assert.match(facets, pattern);
      }
    }
  }
  for (const domain of ["sales", "performance", "ads_report"] as const) {
    const query = sellfoxBrowseQuery(new URL("http://localhost/?adSpend30Min=1&adSpend30Max=9"), domain);
    const sql = workbenchReadSql(domain, query, scope, false);
    assert.doesNotMatch(sql.text, /s\."adSpend30" IS NOT NULL|adSpend30Min/);
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

test("price min/max filter typed column on listing_current; facets stay scope-only", () => {
  for (const exporting of [false, true]) {
    for (const range of ["", "priceMin=0", "priceMax=10000", "priceMin=1.5&priceMax=48"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}&shopExternalId=shop&site=US`), "listings");
      const sql = workbenchReadSql("listings", query, scope, exporting);
      const hasRange = query.priceMin != null || query.priceMax != null;
      if (hasRange) {
        assert.match(sql.text, /s\.price IS NOT NULL/);
        for (const [value, pattern] of [[query.priceMin, /s\.price>=\$(\d+)/], [query.priceMax, /s\.price<=\$(\d+)/]] as const) {
          const match = sql.text.match(pattern);
          if (value != null) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
          else assert.equal(match, null);
        }
      } else {
        assert.doesNotMatch(sql.text, /s\.price IS NOT NULL|s\.price>=|s\.price<=/);
      }
      if (!exporting) {
        const facets = sql.text.slice(sql.text.indexOf("facet_source AS MATERIALIZED"), sql.text.indexOf("SELECT (SELECT COALESCE"));
        assert.doesNotMatch(facets, /priceMin|priceMax|s\.price>=|s\.price<=/);
        for (const pattern of [/s\."organizationId"=/, /s\."workspaceId"=/, /s\."shopExternalId" IN/, /s\.marketplace=/]) assert.match(facets, pattern);
      }
    }
  }
  for (const domain of ["sales", "performance", "ads_report"] as const) {
    const query = sellfoxBrowseQuery(new URL("http://localhost/?priceMin=1&priceMax=9"), domain);
    const sql = workbenchReadSql(domain, query, scope, false);
    assert.doesNotMatch(sql.text, /s\.price IS NOT NULL|priceMin/);
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

test("unsellable min/max filter typed column on listing_current; facets stay scope-only", () => {
  for (const exporting of [false, true]) {
    for (const range of ["", "unsellableMin=0", "unsellableMax=10000", "unsellableMin=1&unsellableMax=5000"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}&shopExternalId=shop&site=US`), "listings");
      const sql = workbenchReadSql("listings", query, scope, exporting);
      const hasRange = query.unsellableMin != null || query.unsellableMax != null;
      if (hasRange) {
        assert.match(sql.text, /s\."unsellable" IS NOT NULL/);
        for (const [value, pattern] of [[query.unsellableMin, /s\."unsellable">=\$(\d+)/], [query.unsellableMax, /s\."unsellable"<=\$(\d+)/]] as const) {
          const match = sql.text.match(pattern);
          if (value != null) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
          else assert.equal(match, null);
        }
      } else {
        assert.doesNotMatch(sql.text, /s\."unsellable" IS NOT NULL|s\."unsellable">=|s\."unsellable"<=/);
      }
      if (!exporting) {
        const facets = sql.text.slice(sql.text.indexOf("facet_source AS MATERIALIZED"), sql.text.indexOf("SELECT (SELECT COALESCE"));
        assert.doesNotMatch(facets, /unsellable/);
        for (const pattern of [/s\."organizationId"=/, /s\."workspaceId"=/, /s\."shopExternalId" IN/, /s\.marketplace=/]) assert.match(facets, pattern);
      }
    }
  }
  for (const domain of ["sales", "performance", "ads_report"] as const) {
    const query = sellfoxBrowseQuery(new URL("http://localhost/?unsellableMin=1&unsellableMax=9"), domain);
    const sql = workbenchReadSql(domain, query, scope, false);
    assert.doesNotMatch(sql.text, /s\."unsellable" IS NOT NULL|unsellableMin/);
  }
});

test("warehousing min/max filter typed column on listing_current; facets stay scope-only", () => {
  for (const exporting of [false, true]) {
    for (const range of ["", "warehousingMin=0", "warehousingMax=10000", "warehousingMin=1&warehousingMax=5000"]) {
      const query = sellfoxBrowseQuery(new URL(`http://localhost/?${range}&shopExternalId=shop&site=US`), "listings");
      const sql = workbenchReadSql("listings", query, scope, exporting);
      const hasRange = query.warehousingMin != null || query.warehousingMax != null;
      if (hasRange) {
        assert.match(sql.text, /s\."warehousing" IS NOT NULL/);
        for (const [value, pattern] of [[query.warehousingMin, /s\."warehousing">=\$(\d+)/], [query.warehousingMax, /s\."warehousing"<=\$(\d+)/]] as const) {
          const match = sql.text.match(pattern);
          if (value != null) { assert.ok(match); assert.equal(sql.values[Number(match[1]) - 1], value); }
          else assert.equal(match, null);
        }
      } else {
        assert.doesNotMatch(sql.text, /s\."warehousing" IS NOT NULL|s\."warehousing">=|s\."warehousing"<=/);
      }
      if (!exporting) {
        const facets = sql.text.slice(sql.text.indexOf("facet_source AS MATERIALIZED"), sql.text.indexOf("SELECT (SELECT COALESCE"));
        assert.doesNotMatch(facets, /warehousing/);
        for (const pattern of [/s\."organizationId"=/, /s\."workspaceId"=/, /s\."shopExternalId" IN/, /s\.marketplace=/]) assert.match(facets, pattern);
      }
    }
  }
  for (const domain of ["sales", "performance", "ads_report"] as const) {
    const query = sellfoxBrowseQuery(new URL("http://localhost/?warehousingMin=1&warehousingMax=9"), domain);
    const sql = workbenchReadSql(domain, query, scope, false);
    assert.doesNotMatch(sql.text, /s\."warehousing" IS NOT NULL|warehousingMin/);
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
