import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildSellfoxReference, type StoreRow, type TripleRow,
} from "@/lib/sellfox/reference-data";
import { SELLFOX_CACHE_TTL, syncResourceToCacheDomains } from "@/lib/sellfox/result-cache";

const stores: StoreRow[] = [
  { id: "s1", externalId: "1001", name: "店铺A", marketplace: "ATVPDKIKX0DER", country: "US", status: "active", updatedAt: "2026-01-02T00:00:00Z" },
  { id: "s2", externalId: "1002", name: "店铺B", marketplace: "ATVPDKIKX0DER", country: "US", status: "active", updatedAt: "2026-01-01T00:00:00Z" },
  { id: "s3", externalId: "1003", name: "店铺C", marketplace: "ZZUNKNOWN_SITE", country: "", status: "active", updatedAt: "2026-01-01T00:00:00Z" },
];

test("buildSellfoxReference: 站点只取可见店铺实际 marketplace，未收录原样显示", () => {
  const result = buildSellfoxReference(stores, [], "v-store", "v-daily");
  assert.equal(result.sites.length, 2); // 美国站 + 未知站点
  const us = result.sites.find((s) => s.marketplace === "ATVPDKIKX0DER")!;
  assert.equal(us.label, "美国站");
  assert.equal(us.code, "US");
  assert.equal(us.storeCount, 2);
  const unknown = result.sites.find((s) => s.marketplace === "ZZUNKNOWN_SITE")!;
  assert.equal(unknown.label, "ZZUNKNOWN_SITE"); // 不猜测
  assert.equal(unknown.code, "ZZUNKNOWN_SITE");
  assert.equal(unknown.storeCount, 1);
  assert.equal(result.version, "v-store|v-daily");
});

test("buildSellfoxReference: 业务员空名不计，未知店铺不暴露，多人多店去重", () => {
  const triples: TripleRow[] = [
    { person: "陈馨", storeId: "s1" },
    { person: "陈馨", storeId: "s1" }, // 重复去重
    { person: "陈馨", storeId: "s2" },
    { person: "   ", storeId: "s1" }, // 空名不计
    { person: "幽灵", storeId: "sX" }, // 非可见店铺，不暴露
  ];
  const result = buildSellfoxReference(stores, triples, "v", "v");
  assert.equal(result.salespersons.length, 1);
  const chen = result.salespersons[0];
  assert.equal(chen.name, "陈馨");
  assert.equal(chen.storeCount, 2);
  assert.deepEqual(chen.stores, ["1001", "1002"]); // 用 externalId，前端筛选可直接用
  assert.ok(!result.salespersons.some((p) => p.name === "幽灵"));
  assert.ok(!result.salespersons.some((p) => p.name === ""));
});

test("reference 缓存域：TTL 登记 + stores/performance 同步后失效映射", () => {
  assert.equal(SELLFOX_CACHE_TTL.reference, 600);
  assert.ok(syncResourceToCacheDomains("stores").includes("reference"));
  assert.ok(syncResourceToCacheDomains("performance").includes("reference"));
  // 不因引用数据失效而误伤无关业务域（sales 不产业务员名单）。
  assert.ok(!syncResourceToCacheDomains("sales").includes("reference"));
});

test("source guard: reference 接口保留权限三态与 scope 分键", () => {
  const route = readFileSync(new URL("../src/app/api/sellfox/reference-data/route.ts", import.meta.url), "utf8");
  assert.match(route, /resolveSellfoxVisibleStoreIds/);
  assert.match(route, /overviewStoreScopeParts/);
  assert.match(route, /storeIds:\s*parts\.storeKeyPart/);
  assert.match(route, /readThroughSellfox\(/);
  assert.doesNotMatch(route, /NextResponse\.json\(\{[\s\S]*?stores[\s\S]*?\}\)/); // load 不直接返回 Response
});
