import test from "node:test";
import assert from "node:assert/strict";
import { workbenchReadSql } from "@/lib/sellfox/workbench-read";
import { sellfoxBrowseQuery } from "@/lib/sellfox/browse-query";
import { sellfoxSortColumns } from "@/lib/sellfox/sort-columns";

const scope = { organizationId: "org-listing", workspaceId: "ws-listing" };
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
