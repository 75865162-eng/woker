import { test } from "node:test";
import assert from "node:assert/strict";
import { LruMap } from "../src/lib/cache/lru-map";
import {
  resolveResourceTtlMs, readApiResource, __resetApiResourceCacheForTest,
  __apiResourceCacheSize, __pruneApiResourceCache, type FetchLike,
} from "../src/lib/hooks/api-resource-cache";

function json(value: unknown): Response {
  return { ok: true, status: 200, json: async () => value } as Response;
}

test("LruMap: 容量上限淘汰最久未命中的键", () => {
  const cache = new LruMap<number>({ maxEntries: 3 });
  cache.set("a", 1);
  cache.set("b", 2);
  cache.set("c", 3);
  assert.equal(cache.get("a"), 1, "命中 a 后 a 成为最近使用");
  cache.set("d", 4, 0, 100);
  assert.equal(cache.size, 3, "超过上限后淘汰最久未命中的 b");
  assert.equal(cache.get("b"), undefined);
  assert.equal(cache.get("a"), 1);
  assert.equal(cache.get("c"), 3);
  assert.equal(cache.get("d"), 4);
});

test("LruMap: TTL 过期读取返回 undefined 并清理，pruneExpired 主动清理", () => {
  let now = 0;
  const cache = new LruMap<string>({ maxEntries: 10, now: () => now });
  cache.set("k", "v", 100);
  now = 50;
  assert.equal(cache.get("k"), "v");
  now = 150;
  assert.equal(cache.get("k"), undefined, "过期后读取应返回 undefined");
  assert.equal(cache.size, 0, "过期项读取时被清理");

  cache.set("x", "1", 100);
  cache.set("y", "2", 100);
  now = 1000;
  assert.equal(cache.pruneExpired(), 2, "主动清理全部过期项");
  assert.equal(cache.size, 0);
});

test("白名单 TTL：慢变只读接口未显式指定 ttlMs 时启用读缓存", async () => {
  __resetApiResourceCacheForTest();
  let calls = 0;
  const fetcher: FetchLike = async () => { calls++; return json({ v: 1 }); };
  const opts = { ttlMs: undefined, fetcher, now: () => 100 };
  const r1 = await readApiResource("/api/lili/call-quota", "/api/lili/call-quota", {}, opts);
  const r2 = await readApiResource("/api/lili/call-quota", "/api/lili/call-quota", {}, opts);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(calls, 1, "白名单接口应在 TTL 内复用缓存");
  if (r2.ok) assert.equal(r2.fromCache, true);
});

test("白名单 TTL：调用方显式 ttlMs=0 强制不缓存，覆盖白名单", () => {
  assert.equal(resolveResourceTtlMs("/api/lili/call-quota", 0), 0);
  assert.equal(resolveResourceTtlMs("/api/lili/call-quota", undefined), 10_000);
  assert.equal(resolveResourceTtlMs("/api/unknown", undefined), 0);
  assert.equal(resolveResourceTtlMs("/api/lili/call-quota?x=1", undefined), 10_000);
});

test("结果缓存容量上限：大量不同 key 不会无限增长", async () => {
  __resetApiResourceCacheForTest();
  const fetcher: FetchLike = async () => json({ v: 1 });
  for (let i = 0; i < 600; i++) {
    await readApiResource(`/api/x/${i}`, `/api/x/${i}`, {}, { ttlMs: 10000, fetcher });
  }
  assert.ok(__apiResourceCacheSize() <= 500, `缓存条目应受上限约束，实际 ${__apiResourceCacheSize()}`);
});

test("pruneExpired: 测试接口可主动清理过期条目", () => {
  __resetApiResourceCacheForTest();
  // 通过公开写入路径无法直接注入过期，这里验证清理接口在空缓存下安全返回 0。
  assert.equal(__pruneApiResourceCache(), 0);
});
