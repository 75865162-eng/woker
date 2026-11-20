import test from "node:test";
import assert from "node:assert/strict";
import { buildDimensionAnalysis, isDimension, type DimensionStoreRow, type DimensionTriple } from "@/lib/sellfox/dimension-analysis";

const stores: DimensionStoreRow[] = [
  { id: "s1", externalId: "1001", name: "店铺A", marketplace: "ATVPDKIKX0DER", country: "US", status: "active" },
  { id: "s2", externalId: "1002", name: "店铺B", marketplace: "ATVPDKIKX0DER", country: "US", status: "active" },
  { id: "s3", externalId: "1003", name: "店铺C", marketplace: "A1PA6795UKMFR9", country: "DE", status: "active" },
  { id: "s4", externalId: "1004", name: "无业务员店铺", marketplace: "A1VC38T7YXB528", country: "JP", status: "active" },
];

test("isDimension only accepts the three supported dimensions", () => {
  assert.equal(isDimension("salesperson"), true);
  assert.equal(isDimension("store"), true);
  assert.equal(isDimension("site"), true);
  for (const value of ["", "sales", "SITE", "amazon", null, undefined, 3]) assert.equal(isDimension(value), false);
});

test("buildDimensionAnalysis lists people/stores/sites with deduplicated associations", () => {
  // 同一 (person, store, msku) 重复出现（跨日快照）应去重；同一人多店、一店多人都要正确。
  const triples: DimensionTriple[] = [
    { person: "陈馨", storeId: "s1", msku: "M1" },
    { person: "陈馨", storeId: "s1", msku: "M1" }, // 重复
    { person: "陈馨", storeId: "s2", msku: "M2" },
    { person: "温见清", storeId: "s1", msku: "M1" },
    { person: "温见清", storeId: "s3", msku: "M3" },
    { person: "  刘丹  ", storeId: "s3", msku: "M3" }, // trim
    { person: "陈馨", storeId: "s1", msku: "" }, // 空 msku 不计入商品数
  ];
  const result = buildDimensionAnalysis(stores, triples, 5000);

  // 业务员名单：trim 后三人；按关联店铺数降序、同数按姓名排序。
  assert.deepEqual(result.salespeople.map((p) => p.name), ["温见清", "陈馨", "刘丹"]);
  const chen = result.salespeople.find((p) => p.name === "陈馨")!;
  assert.equal(chen.storeCount, 2); // s1, s2
  assert.equal(chen.mskuCount, 2); // M1, M2（重复与空值已去重/排除）
  assert.deepEqual(chen.sites, ["ATVPDKIKX0DER"]); // s1,s2 同为美国站，去重
  const wen = result.salespeople.find((p) => p.name === "温见清")!;
  assert.equal(wen.storeCount, 2);
  assert.deepEqual(wen.sites, ["A1PA6795UKMFR9", "ATVPDKIKX0DER"].sort());
  assert.ok(result.salespeople.some((p) => p.name === "刘丹"));

  // 店铺名单：4 个店铺全列（含无业务员的店铺）；关联业务员/商品数正确。
  assert.equal(result.stores.length, 4);
  const s1 = result.stores.find((s) => s.externalId === "1001")!;
  assert.equal(s1.label, "美国站");
  assert.equal(s1.code, "US");
  assert.deepEqual(s1.people, ["温见清", "陈馨"]);
  assert.equal(s1.mskuCount, 1); // M1
  const s4 = result.stores.find((s) => s.externalId === "1004")!;
  assert.equal(s4.personCount, 0);
  assert.equal(s4.mskuCount, 0);
  assert.equal(s4.label, "日本站");

  // 站点名单：由全部店铺建立骨架，含仅有一个无业务员店铺的日本站。
  assert.equal(result.sites.length, 3);
  const us = result.sites.find((s) => s.marketplace === "ATVPDKIKX0DER")!;
  assert.equal(us.label, "美国站");
  assert.equal(us.storeCount, 2);
  assert.equal(us.personCount, 2); // 陈馨、温见清
  assert.equal(us.mskuCount, 2); // M1, M2
  const jp = result.sites.find((s) => s.marketplace === "A1VC38T7YXB528")!;
  assert.equal(jp.storeCount, 1);
  assert.equal(jp.personCount, 0);
  assert.equal(jp.mskuCount, 0);

  // coverage 口径。
  assert.deepEqual(result.coverage, { stores: 4, people: 3, sites: 3, snapshotRows: 5000 });
});

test("buildDimensionAnalysis with no triples still lists all stores and sites but no people", () => {
  const result = buildDimensionAnalysis(stores, [], 0);
  assert.equal(result.salespeople.length, 0);
  assert.equal(result.stores.length, 4);
  assert.equal(result.sites.length, 3);
  assert.equal(result.coverage.people, 0);
  assert.equal(result.coverage.snapshotRows, 0);
});

test("buildDimensionAnalysis ignores triples pointing to unknown stores", () => {
  const result = buildDimensionAnalysis(stores, [
    { person: "幽灵", storeId: "not-in-scope", msku: "M9" },
  ], 10);
  assert.equal(result.salespeople.length, 0); // 关联不到可见店铺的人不入名单
  assert.equal(result.coverage.stores, 4);
});

test("buildDimensionAnalysis keeps unrecognized marketplace ID as-is", () => {
  const oddStores: DimensionStoreRow[] = [
    { id: "x1", externalId: "9", name: "未知站店铺", marketplace: "UNKNOWN_ID", country: "", status: "" },
  ];
  const result = buildDimensionAnalysis(oddStores, [{ person: "甲", storeId: "x1", msku: "M" }], 1);
  assert.equal(result.sites[0].label, "UNKNOWN_ID");
  assert.equal(result.sites[0].code, "UNKNOWN_ID");
  assert.equal(result.stores[0].label, "UNKNOWN_ID");
});
