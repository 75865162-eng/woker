import assert from "node:assert/strict";
import test from "node:test";
import {
  AMAZON_CACHE_PREFIX, normalizeAmazonCacheQuery, amazonAccessFingerprint, amazonCacheKey,
  amazonDomainInvalidationPrefix, amazonTenantInvalidationPrefix, cacheEnabled,
  readThroughAmazon, setAmazonCacheRedisForTest, setAmazonTtlRandomForTest,
  type AmazonCachedBody,
} from "../src/lib/amazon-ads/result-cache";
import type { AmazonDataAccess } from "../src/lib/amazon-sync/data-access";

const ORG = "org-1";
const WS = "ws-1";
const DOMAIN = "report_acquisition";
const ORIGINAL_ENV = process.env.AMAZON_CACHE_ENABLED;
function enable() { process.env.AMAZON_CACHE_ENABLED = "true"; assert.equal(cacheEnabled(), true); }
function restore() {
  setAmazonCacheRedisForTest(undefined);
  setAmazonTtlRandomForTest(undefined);
  if (ORIGINAL_ENV === undefined) delete process.env.AMAZON_CACHE_ENABLED;
  else process.env.AMAZON_CACHE_ENABLED = ORIGINAL_ENV;
}

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => { store.set(key, value); return "OK"; },
    scan: async (_cursor: string, _match: string, pattern: string) => {
      const prefix = pattern.replace("*", "");
      return ["0", [...store.keys()].filter(k => k.startsWith(prefix))];
    },
    del: async (...keys: string[]) => { let n = 0; for (const k of keys) if (store.delete(k)) n += 1; return n; },
    on: () => {},
  };
}

const accessFull: AmazonDataAccess = { allSellers: true, sellerIds: [] };
const accessA: AmazonDataAccess = { allSellers: false, sellerIds: ["s1", "s2"] };
const accessAReordered: AmazonDataAccess = { allSellers: false, sellerIds: ["s2", "s1"] };
const accessB: AmazonDataAccess = { allSellers: false, sellerIds: ["s3"] };
const accessScoped: AmazonDataAccess = { allSellers: false, sellerIds: ["s1"], scopes: [{ sellerAccountId: "s1", marketplaceIds: ["ATVPDKIKX0DER"] }] };

test("query normalization is order-independent and drops empties", () => {
  assert.equal(normalizeAmazonCacheQuery({ b: "2", a: "1", empty: "", nul: null }), "a=1&b=2");
  assert.equal(normalizeAmazonCacheQuery({ ids: ["x", "y"] }), normalizeAmazonCacheQuery({ ids: ["y", "x"] }));
});

test("access fingerprint: identical grants share, different/revoked grants never collide", () => {
  const fpA = amazonAccessFingerprint(accessA);
  assert.ok(fpA);
  assert.equal(fpA, amazonAccessFingerprint(accessAReordered), "seller id order must not matter");
  assert.notEqual(fpA, amazonAccessFingerprint(accessB), "different grants must differ");
  assert.notEqual(fpA, amazonAccessFingerprint(accessScoped), "scoped marketplace grants must differ");
  assert.notEqual(amazonAccessFingerprint(accessFull), fpA, "admin/all-sellers must differ from restricted");
  assert.equal(amazonAccessFingerprint(undefined), "", "missing access yields empty fingerprint");
  assert.equal(amazonAccessFingerprint({ allSellers: false, sellerIds: [] }), "", "empty grant yields empty fingerprint");
});

test("cache keys are namespaced and isolated by tenant/workspace/domain/grant/query", () => {
  const q = normalizeAmazonCacheQuery({ profileId: "p1", from: "2026-01-01" });
  const base = amazonCacheKey(ORG, WS, DOMAIN, amazonAccessFingerprint(accessA), q);
  assert.ok(base.startsWith(`${AMAZON_CACHE_PREFIX}wb:`));
  const keys = new Set([
    base,
    amazonCacheKey(ORG, WS, DOMAIN, amazonAccessFingerprint(accessA), "profileId=p2"),
    amazonCacheKey(ORG, WS, "ads_metadata", amazonAccessFingerprint(accessA), q),
    amazonCacheKey(ORG, "ws-2", DOMAIN, amazonAccessFingerprint(accessA), q),
    amazonCacheKey("org-2", WS, DOMAIN, amazonAccessFingerprint(accessA), q),
    amazonCacheKey(ORG, WS, DOMAIN, amazonAccessFingerprint(accessB), q),
  ]);
  assert.equal(keys.size, 6, "every isolation dimension must produce a distinct key");
});

test("invalidation prefixes target only the intended tenant/domain", () => {
  assert.equal(amazonDomainInvalidationPrefix(ORG, WS, DOMAIN), `${AMAZON_CACHE_PREFIX}wb:${ORG}:${WS}:${DOMAIN}:`);
  assert.equal(amazonTenantInvalidationPrefix(ORG, WS), `${AMAZON_CACHE_PREFIX}wb:${ORG}:${WS}:`);
});

test("cache hit returns cached body while version matches; version change forces reload", async () => {
  enable();
  const redis = fakeRedis();
  setAmazonCacheRedisForTest(redis as never);
  const key = amazonCacheKey(ORG, WS, DOMAIN, amazonAccessFingerprint(accessA), "x=1");
  let version = "v1";
  let loads = 0;
  const load = async () => { loads += 1; return { rows: loads }; };

  const r1 = await readThroughAmazon(key, DOMAIN, amazonAccessFingerprint(accessA), async () => version, load);
  assert.equal(r1.cache, "miss");
  const r2 = await readThroughAmazon(key, DOMAIN, amazonAccessFingerprint(accessA), async () => version, load);
  assert.equal(r2.cache, "hit");
  assert.equal(r2.body.rows, 1);
  assert.equal(loads, 1, "second read must not reload");

  version = "v2";
  const r3 = await readThroughAmazon(key, DOMAIN, amazonAccessFingerprint(accessA), async () => version, load);
  assert.equal(r3.cache, "miss");
  assert.equal(r3.body.rows, 2, "version change must reload");
  restore();
});

test("missing access fingerprint bypasses the cache entirely (fail-safe)", async () => {
  enable();
  const redis = fakeRedis();
  setAmazonCacheRedisForTest(redis as never);
  const key = amazonCacheKey(ORG, WS, DOMAIN, "", "x=1");
  let loads = 0;
  const load = async () => { loads += 1; return { rows: loads }; };
  const r1 = await readThroughAmazon(key, DOMAIN, "", async () => "v1", load);
  const r2 = await readThroughAmazon(key, DOMAIN, "", async () => "v1", load);
  assert.equal(r1.cache, "bypass");
  assert.equal(r2.cache, "bypass");
  assert.equal(loads, 2, "no-fingerprint reads must always hit the loader");
  assert.equal(redis.store.size, 0, "nothing should be written without a fingerprint");
  restore();
});

test("Redis outage degrades to direct load (fail-open)", async () => {
  enable();
  setAmazonCacheRedisForTest(null);
  const key = amazonCacheKey(ORG, WS, DOMAIN, amazonAccessFingerprint(accessA), "x=1");
  let loads = 0;
  const load = async () => { loads += 1; return { ok: true }; };
  const r1 = await readThroughAmazon(key, DOMAIN, amazonAccessFingerprint(accessA), async () => "v1", load);
  const r2 = await readThroughAmazon(key, DOMAIN, amazonAccessFingerprint(accessA), async () => "v1", load);
  assert.equal(r1.body.ok, true);
  assert.equal(r2.body.ok, true);
  assert.equal(loads, 2, "outage → every read calls loader, never 500");
  restore();
});

test("singleflight: concurrent callers with the same key share one load", async () => {
  enable();
  setAmazonCacheRedisForTest(null);
  const key = amazonCacheKey(ORG, WS, DOMAIN, amazonAccessFingerprint(accessA), "x=1");
  let loads = 0;
  const load = async () => { loads += 1; await new Promise(r => setTimeout(r, 20)); return { n: loads }; };
  const [a, b, c] = await Promise.all([
    readThroughAmazon(key, DOMAIN, amazonAccessFingerprint(accessA), async () => "v1", load),
    readThroughAmazon(key, DOMAIN, amazonAccessFingerprint(accessA), async () => "v1", load),
    readThroughAmazon(key, DOMAIN, amazonAccessFingerprint(accessA), async () => "v1", load),
  ]);
  assert.equal(loads, 1);
  assert.deepEqual(a.body, b.body);
  assert.deepEqual(b.body, c.body);
  restore();
});

test("disabled env bypasses cache", async () => {
  delete process.env.AMAZON_CACHE_ENABLED;
  const redis = fakeRedis();
  setAmazonCacheRedisForTest(redis as never);
  const key = amazonCacheKey(ORG, WS, DOMAIN, amazonAccessFingerprint(accessA), "x=1");
  let loads = 0;
  const load = async () => { loads += 1; return 1; };
  const r = await readThroughAmazon(key, DOMAIN, amazonAccessFingerprint(accessA), async () => "v1", load);
  assert.equal(r.cache, "bypass");
  assert.equal(loads, 1);
  assert.equal(redis.store.size, 0);
  restore();
});
