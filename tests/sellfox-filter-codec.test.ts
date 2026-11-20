import test from "node:test";
import assert from "node:assert/strict";
import {
  decodeMulti, decodeMultiParam, encodeMultiParam, decodeBatchSearch,
  firstOf, SELLFOX_BATCH_SEARCH_LIMIT, SellfoxFilterCodecError,
} from "@/lib/sellfox/filter-codec";
import { sellfoxBrowseQuery, sellfoxSnapshotWhere } from "@/lib/sellfox/browse-query";

const query = (params: string) => sellfoxBrowseQuery(new URL(`http://localhost/?${params}`));

test("多值编解码：CSV 与重复键等价、去重保序、空值忽略", () => {
  assert.deepEqual(decodeMulti(["US,CA", "CA, MX", "", "  JP "]), ["US", "CA", "MX", "JP"]);
  const a = new URLSearchParams("site=US,CA&site=CA");
  const b = new URLSearchParams("site=US&site=CA");
  assert.deepEqual(decodeMultiParam(a, "site"), ["US", "CA"]);
  assert.deepEqual(decodeMultiParam(b, "site"), ["US", "CA"]);
  assert.equal(firstOf(["US", "CA"]), "US");
  assert.equal(firstOf([]), "");
});

test("encodeMultiParam 写回单键 CSV，空数组不写入", () => {
  const params = new URLSearchParams();
  encodeMultiParam(params, "site", ["US", "CA", "CA"]);
  assert.equal(params.get("site"), "US,CA");
  const empty = new URLSearchParams();
  encodeMultiParam(empty, "site", []);
  assert.equal(empty.has("site"), false);
});

test("批量搜索：换行/中英文逗号切分、去重、上限 200 抛 413", () => {
  assert.deepEqual(decodeBatchSearch("B0A\nB0B,B0C，B0B"), ["B0A", "B0B", "B0C"]);
  assert.deepEqual(decodeBatchSearch(""), []);
  assert.deepEqual(decodeBatchSearch("  "), []);
  const over = Array.from({ length: SELLFOX_BATCH_SEARCH_LIMIT + 1 }, (_, i) => `X${i}`).join(",");
  assert.throws(() => decodeBatchSearch(over), (error: unknown) => error instanceof SellfoxFilterCodecError && error.status === 413);
});

test("旧单值 URL 兼容：site/salesperson/shop 单值仍可读，行为不变", () => {
  const q = query("site=US&salesperson=张三&shopExternalId=s1");
  assert.deepEqual(q.sites, []);
  assert.equal(q.site, "US");
  assert.deepEqual(q.salespersons, []);
  assert.equal(q.salesperson, "张三");
  assert.deepEqual(q.shopExternalIds, ["s1"]);
  assert.deepEqual(q.searchTerms, []);
  // 复数键优先，单值字段保留原值（互不覆盖）。
  const multi = query("site=US&sites=CA,MX&salesperson=张三&salespersons=李四,王五");
  assert.deepEqual(multi.sites, ["CA", "MX"]);
  assert.deepEqual(multi.salespersons, ["李四", "王五"]);
  assert.equal(multi.site, "US");
});

test("多值站点进入 where：marketplace IN，且与租户范围同时入 where（铁律4）", () => {
  const q = query("sites=US,CA");
  assert.deepEqual(q.sites, ["US", "CA"]);
  const where = sellfoxSnapshotWhere(q, "org-1", "ws-2", ["s1"]);
  assert.equal(where.organizationId, "org-1");
  assert.equal(where.workspaceId, "ws-2");
  assert.deepEqual(where.storeId, { in: ["s1"] });
  assert.deepEqual(where.SellfoxStore, { marketplace: { in: ["US", "CA"] } });
  // 单值 site 仍走原精确匹配，多值与单值互不干扰。
  assert.deepEqual(sellfoxSnapshotWhere(query("site=DE"), "o", "w").SellfoxStore, { marketplace: "DE" });
});

test("多值店铺：复数键 CSV 与重复单键都归一到 shopExternalIds", () => {
  assert.deepEqual(query("shopExternalIds=s1,s2").shopExternalIds, ["s1", "s2"]);
  assert.deepEqual(query("shopExternalId=s1&shopExternalId=s2").shopExternalIds, ["s1", "s2"]);
});

test("非法站点格式 400；批量超限 413（不放行空条件）", () => {
  assert.throws(() => query("sites=US,not-a-site"), /站点标识无效/);
  assert.throws(() => query("sites=" + "US".repeat(30)), /站点标识无效/);
  const bulk = Array.from({ length: 201 }, (_, i) => `M${i}`).join(",");
  assert.throws(() => query(`searchTerms=${encodeURIComponent(bulk)}`), (error: unknown) => {
    const e = error as { status?: number };
    return e.status === 413;
  });
});

test("searchTerms 进入 query：单值与批量都能解析", () => {
  assert.deepEqual(query("search=MSKU1").searchTerms, ["MSKU1"]);
  assert.deepEqual(query("searchTerms=A,B,C").searchTerms, ["A", "B", "C"]);
});
