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
