import assert from "node:assert/strict";
import test from "node:test";
import {
  cacheEnabled, SELLFOX_CACHE_PREFIX, SELLFOX_CACHE_TTL, SELLFOX_EMPTY_TTL,
  SELLFOX_VERSION_SOURCE, normalizeSellfoxCacheQuery, sellfoxCacheKey,
  sellfoxOverviewCacheKey, sellfoxDomainInvalidationPrefix, sellfoxOverviewInvalidationPrefix,
  syncResourceToCacheDomains, setSellfoxCacheRedisForTest, readThroughSellfox,
  invalidateSellfoxDomain, overviewStoreScopeParts, type CachedBody,
} from "../src/lib/sellfox/result-cache";

const ORG = "org-1";
const WS = "ws-1";

test("query normalization is stable regardless of key order and drops empty values", () => {
  const a = normalizeSellfoxCacheQuery({ b: "2", a: "1", empty: "", nul: null, undef: undefined });
  const b = normalizeSellfoxCacheQuery({ a: "1", b: "2" });
  assert.equal(a, b);
  assert.ok(!a.includes("empty") && !a.includes("nul") && !a.includes("undef"));
});

test("array filters are normalized order-independently", () => {
  assert.equal(
    normalizeSellfoxCacheQuery({ shopExternalId: ["s2", "s1"] }),
    normalizeSellfoxCacheQuery({ shopExternalId: ["s1", "s2"] }),
  );
});

test("cache keys are namespaced sellfox and isolated by tenant/workspace/domain", () => {
  const k1 = sellfoxCacheKey(ORG, WS, "sales", "a=1");
  const k2 = sellfoxCacheKey(ORG, WS, "performance", "a=1");
  const k3 = sellfoxCacheKey(ORG, "ws-2", "sales", "a=1");
  const k4 = sellfoxCacheKey("org-2", WS, "sales", "a=1");
  assert.ok(k1.startsWith(`${SELLFOX_CACHE_PREFIX}wb:`));
  assert.equal(new Set([k1, k2, k3, k4]).size, 4);
  assert.notEqual(k1, k2); assert.notEqual(k1, k3); assert.notEqual(k1, k4);
  assert.ok(!k1.toLowerCase().includes("amazon"));
});

test("change in any query field changes the key", () => {
  const a = sellfoxCacheKey(ORG, WS, "sales", normalizeSellfoxCacheQuery({ page: 1, pageSize: 50 }));
  const b = sellfoxCacheKey(ORG, WS, "sales", normalizeSellfoxCacheQuery({ page: 2, pageSize: 50 }));
  const c = sellfoxCacheKey(ORG, WS, "sales", normalizeSellfoxCacheQuery({ page: 1, pageSize: 100 }));
  assert.equal(new Set([a, b, c]).size, 3);
});

test("overview key isolated by tenant and scope", () => {
  const a = sellfoxOverviewCacheKey(ORG, WS, "scope-1");
  const b = sellfoxOverviewCacheKey(ORG, WS, "scope-2");
  assert.ok(a.startsWith(`${SELLFOX_CACHE_PREFIX}ov:`));
  assert.notEqual(a, b);
});

test("overview store-scope three states never collide (full / empty / subset)", () => {
  const full = overviewStoreScopeParts(undefined);
  const empty = overviewStoreScopeParts([]);
  const subset = overviewStoreScopeParts(["s2", "s1"]);

  // 全量：不收紧、旧键（空数组被归一化丢弃）
  assert.equal(full.restrict, false);
  assert.deepEqual(full.storeWhere, {});
  assert.deepEqual(full.storeTableWhere, {});
  assert.equal(normalizeSellfoxCacheQuery({ storeIds: full.storeKeyPart }), "");

  // 空集：强制空集 + 哨兵，键区别于全量，避免越权用户读到全量缓存
  assert.equal(empty.restrict, true);
  assert.deepEqual(empty.storeWhere, { storeId: { in: [] } });
  assert.deepEqual(empty.storeTableWhere, { id: { in: [] } });
  assert.ok(normalizeSellfoxCacheQuery({ storeIds: empty.storeKeyPart }).includes("__NO_SELLFOX_STORE__"));

  // 子集：按 id 排序、各自独立键
  assert.equal(subset.restrict, true);
  assert.deepEqual(subset.storeWhere, { storeId: { in: ["s1", "s2"] } });
  assert.deepEqual(subset.storeTableWhere, { id: { in: ["s1", "s2"] } });
  assert.deepEqual(subset.storeKeyPart, ["s1", "s2"]);

  const keyOf = (ids: string[] | undefined) =>
    sellfoxOverviewCacheKey(ORG, WS, normalizeSellfoxCacheQuery({ storeIds: overviewStoreScopeParts(ids).storeKeyPart }));
  const otherSubset = overviewStoreScopeParts(["s3"]).storeKeyPart;
  const keys = new Set([
    keyOf(undefined), keyOf([]), keyOf(["s1", "s2"]),
    sellfoxOverviewCacheKey(ORG, WS, normalizeSellfoxCacheQuery({ storeIds: otherSubset })),
  ]);
  assert.equal(keys.size, 4, "全量/空集/两个不同子集必须产生 4 个不同的缓存键");
  assert.equal(keyOf(["s1", "s2"]), keyOf(["s2", "s1"]), "同一集合顺序不同应命中同一键");
});

test("invalidation prefixes target only the intended tenant/domain", () => {
  assert.equal(sellfoxDomainInvalidationPrefix(ORG, WS, "sales"), `${SELLFOX_CACHE_PREFIX}wb:${ORG}:${WS}:sales:`);
  assert.equal(sellfoxOverviewInvalidationPrefix(ORG, WS), `${SELLFOX_CACHE_PREFIX}ov:${ORG}:${WS}:`);
});

test("TTL table matches the plan and empty results use the short TTL", () => {
  assert.equal(SELLFOX_CACHE_TTL.sales, 300);
  assert.equal(SELLFOX_CACHE_TTL.performance, 300);
  assert.equal(SELLFOX_CACHE_TTL.ads_report, 600);
  assert.equal(SELLFOX_CACHE_TTL.overview, 60);
  assert.equal(SELLFOX_CACHE_TTL.restock, 300);
  assert.equal(SELLFOX_EMPTY_TTL, 30);
});

test("version sources are physical tables owned by the sellfox source", () => {
  for (const [domain, source] of Object.entries(SELLFOX_VERSION_SOURCE)) {
    assert.ok(source.model.startsWith("Sellfox"), `${domain} -> ${source.model}`);
    assert.ok(["syncedAt", "capturedAt"].includes(source.column), `${domain} -> ${source.column}`);
  }
});

test("sync resource invalidates every dependent read domain", () => {
  assert.deepEqual(syncResourceToCacheDomains("sales").sort(), ["overview", "restock", "sales"]);
  assert.ok(syncResourceToCacheDomains("stores").includes("overview"));
  assert.ok(syncResourceToCacheDomains("stores").includes("sales"));
  assert.ok(syncResourceToCacheDomains("inventory").includes("performance"));
  // 补货依赖库存/销量/listing/在途，任一变化都要失效。
  assert.ok(syncResourceToCacheDomains("inventory").includes("restock"));
  assert.ok(syncResourceToCacheDomains("listings").includes("restock"));
  assert.ok(syncResourceToCacheDomains("fba_shipments").includes("restock"));
  assert.ok(syncResourceToCacheDomains("stores").includes("restock"));
  assert.deepEqual(syncResourceToCacheDomains("ads_report"), ["ads_report", "overview"]);
});

// --- read-through behaviour with an injected in-memory Redis ----------------
class FakeRedis {
  store = new Map<string, { value: string; expireAt: number }>();
  async get(key: string) {
    const row = this.store.get(key);
    if (!row) return null;
    if (row.expireAt <= Date.now()) { this.store.delete(key); return null; }
    return row.value;
  }
  async set(key: string, value: string, mode: "EX", ttl: number) {
    void mode;
    this.store.set(key, { value, expireAt: Date.now() + ttl * 1000 });
    return "OK";
  }
  async scan(cursor: string, matchArg: string, patternStr: string, countArg: string, count: number): Promise<[string, string[]]> {
    void cursor; void matchArg; void countArg; void count;
    const pattern = new RegExp(`^${patternStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\\\*/g, ".*")}$`);
    return ["0", [...this.store.keys()].filter(k => pattern.test(k))];
  }
  async del(...keys: string[]) { let n = 0; for (const k of keys) if (this.store.delete(k)) n++; return n; }
  on(event: string, listener: () => void) { void event; void listener; }
}

const ORIGINAL_ENV = process.env.SELLFOX_CACHE_ENABLED;

function enable() { process.env.SELLFOX_CACHE_ENABLED = "true"; assert.equal(cacheEnabled(), true); }
function restore() {
  if (ORIGINAL_ENV === undefined) delete process.env.SELLFOX_CACHE_ENABLED;
  else process.env.SELLFOX_CACHE_ENABLED = ORIGINAL_ENV;
  setSellfoxCacheRedisForTest(undefined);
}

test("read-through: miss loads + caches, then hit reuses body without reload", async () => {
  enable();
  const redis = new FakeRedis();
  setSellfoxCacheRedisForTest(redis);
  const key = sellfoxCacheKey(ORG, WS, "sales", "v=1");
  let loads = 0;
  const load = async () => { loads++; return { rows: [{ id: 1 }] }; };
  const first = await readThroughSellfox(key, "sales", async () => "ver-1", load);
  assert.equal(first.cache, "miss");
  assert.equal(loads, 1);
  const second = await readThroughSellfox(key, "sales", async () => "ver-1", load);
  assert.equal(second.cache, "hit");
  assert.equal(loads, 1);
  assert.deepEqual(second.body, first.body);
  restore();
});

test("read-through: version change invalidates old body", async () => {
  enable();
  setSellfoxCacheRedisForTest(new FakeRedis());
  const key = sellfoxCacheKey(ORG, WS, "sales", "v=2");
  let loads = 0;
  const load = async () => ({ n: ++loads });
  await readThroughSellfox(key, "sales", async () => "ver-1", load);
  const next = await readThroughSellfox(key, "sales", async () => "ver-2", load);
  assert.equal(next.cache, "miss");
  assert.equal(loads, 2);
  restore();
});

test("read-through: bypass skips read and write", async () => {
  enable();
  const redis = new FakeRedis();
  setSellfoxCacheRedisForTest(redis);
  const key = sellfoxCacheKey(ORG, WS, "sales", "v=3");
  let loads = 0;
  const load = async () => ({ n: ++loads });
  await readThroughSellfox(key, "sales", async () => "ver-1", load, { bypass: true });
  await readThroughSellfox(key, "sales", async () => "ver-1", load, { bypass: true });
  assert.equal(loads, 2);
  assert.equal(redis.store.size, 0);
  restore();
});

test("read-through: Redis failure degrades to direct load (fail-open)", async () => {
  enable();
  setSellfoxCacheRedisForTest(null);
  const key = sellfoxCacheKey(ORG, WS, "sales", "v=4");
  let loads = 0;
  const load = async () => ({ n: ++loads });
  const result = await readThroughSellfox(key, "sales", async () => "ver-1", load);
  assert.equal(result.cache, "miss");
  assert.equal(loads, 1);
  restore();
});

test("read-through: empty result uses short TTL", async () => {
  enable();
  const redis = new FakeRedis();
  setSellfoxCacheRedisForTest(redis);
  const key = sellfoxCacheKey(ORG, WS, "sales", "v=5");
  await readThroughSellfox(key, "sales", async () => "ver-1", async () => ({ rows: [] }), {
    isEmpty: body => Array.isArray(body.rows) && body.rows.length === 0,
  });
  const raw = await redis.get(key);
  assert.ok(raw);
  const parsed = JSON.parse(raw!) as CachedBody<{ rows: unknown[] }>;
  assert.equal(parsed.empty, true);
  restore();
});

test("invalidate deletes all cached bodies and versions for a domain", async () => {
  enable();
  const redis = new FakeRedis();
  setSellfoxCacheRedisForTest(redis);
  const key = sellfoxCacheKey(ORG, WS, "sales", "v=6");
  await readThroughSellfox(key, "sales", async () => "ver-1", async () => ({ rows: [1] }));
  assert.ok(redis.store.size >= 2);
  await invalidateSellfoxDomain(ORG, WS, "sales");
  assert.equal(redis.store.size, 0);
  restore();
});
