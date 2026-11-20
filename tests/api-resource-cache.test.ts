import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildResourceKey, readApiResource, invalidateApiResource, invalidateApiResourcePrefix,
  __resetApiResourceCacheForTest, __apiResourceCacheSize,
  type FetchLike,
} from "../src/lib/hooks/api-resource-cache";

function jsonResponse(value: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => value,
  } as Response;
}

test("buildResourceKey: scope headers 参与键，任一维度变化即换键", () => {
  const base = buildResourceKey("/api/x", { "x-workspace-id": "ws1", "x-account-id": "acc1", "x-marketplace": "US" });
  const same = buildResourceKey("/api/x", { "x-marketplace": "US", "x-workspace-id": "ws1", "x-account-id": "acc1" });
  const diffWs = buildResourceKey("/api/x", { "x-workspace-id": "ws2", "x-account-id": "acc1", "x-marketplace": "US" });
  const diffAcc = buildResourceKey("/api/x", { "x-workspace-id": "ws1", "x-account-id": "acc2", "x-marketplace": "US" });
  const diffMp = buildResourceKey("/api/x", { "x-workspace-id": "ws1", "x-account-id": "acc1", "x-marketplace": "EU" });
  assert.equal(base, same, "同一 scope 集合（顺序无关）应命中同一 key");
  assert.notEqual(base, diffWs);
  assert.notEqual(base, diffAcc);
  assert.notEqual(base, diffMp);
});

test("buildResourceKey: content-type/accept 不参与键，query 参与键", () => {
  const a = buildResourceKey("/api/x", { "x-workspace-id": "ws1", "content-type": "application/json" });
  const b = buildResourceKey("/api/x", { "accept": "application/json", "x-workspace-id": "ws1" });
  assert.equal(a, b, "非 scope 头不应改变 key");
  const q1 = buildResourceKey("/api/x", undefined, { a: "1" });
  const q2 = buildResourceKey("/api/x", undefined, { a: "2" });
  const q1b = buildResourceKey("/api/x", undefined, { a: "1" });
  assert.equal(q1, q1b);
  assert.notEqual(q1, q2);
});

test("缓存复用：TTL 内第二次命中缓存，不发第二次请求", async () => {
  __resetApiResourceCacheForTest();
  let calls = 0;
  const fetcher: FetchLike = async () => { calls++; return jsonResponse({ v: 1 }); };
  const key = buildResourceKey("/api/cached", { "x-workspace-id": "ws1" });
  const r1 = await readApiResource(key, "/api/cached", { headers: { "x-workspace-id": "ws1" } }, { ttlMs: 1000, fetcher, now: () => 100 });
  const r2 = await readApiResource(key, "/api/cached", { headers: { "x-workspace-id": "ws1" } }, { ttlMs: 1000, fetcher, now: () => 200 });
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(calls, 1, "TTL 内应只发一次请求");
  if (r2.ok) assert.equal(r2.fromCache, true);
});

test("缓存过期：TTL 之后重新请求", async () => {
  __resetApiResourceCacheForTest();
  let calls = 0;
  const fetcher: FetchLike = async () => { calls++; return jsonResponse({ v: calls }); };
  const key = buildResourceKey("/api/exp", undefined);
  await readApiResource(key, "/api/exp", {}, { ttlMs: 100, fetcher, now: () => 0 });
  await readApiResource(key, "/api/exp", {}, { ttlMs: 100, fetcher, now: () => 50 });
  await readApiResource(key, "/api/exp", {}, { ttlMs: 100, fetcher, now: () => 200 });
  assert.equal(calls, 2, "过期后应重取");
});

test("并发合并：同 key 同时多个请求只发一次", async () => {
  __resetApiResourceCacheForTest();
  let calls = 0;
  let resolveFetch!: (r: Response) => void;
  const fetcher: FetchLike = () => { calls++; return new Promise<Response>((r) => { resolveFetch = r; }); };
  const key = buildResourceKey("/api/coalesce", undefined);
  const p1 = readApiResource(key, "/api/coalesce", {}, { fetcher });
  const p2 = readApiResource(key, "/api/coalesce", {}, { fetcher });
  const p3 = readApiResource(key, "/api/coalesce", {}, { fetcher });
  assert.equal(calls, 1, "在途期间应合并为一次请求");
  resolveFetch(jsonResponse({ ok: 1 }));
  const [r1, r2, r3] = await Promise.all([p1, p2, p3]);
  assert.equal(r1.ok, true);
  assert.equal(r2.ok, true);
  assert.equal(r3.ok, true);
  if (r2.ok) assert.equal(r2.fromInflight, true, "合并方应标记 fromInflight");
});

test("失败重试：5xx 重试，达到上限后失败", async () => {
  __resetApiResourceCacheForTest();
  let calls = 0;
  const fetcher: FetchLike = async () => { calls++; return jsonResponse({ e: 1 }, 503); };
  const key = buildResourceKey("/api/retry5", undefined);
  const r = await readApiResource(key, "/api/retry5", {}, { retries: 2, backoffMs: () => 0, fetcher });
  assert.equal(r.ok, false);
  assert.equal(calls, 3, "初始 1 次 + 重试 2 次 = 3");
});

test("失败重试：4xx 不重试，立即失败", async () => {
  __resetApiResourceCacheForTest();
  let calls = 0;
  const fetcher: FetchLike = async () => { calls++; return jsonResponse({ e: 1 }, 403); };
  const key = buildResourceKey("/api/retry4", undefined);
  const r = await readApiResource(key, "/api/retry4", {}, { retries: 3, backoffMs: () => 0, fetcher });
  assert.equal(r.ok, false);
  assert.equal(calls, 1, "4xx 不应重试");
});

test("失败重试成功后写入缓存", async () => {
  __resetApiResourceCacheForTest();
  let calls = 0;
  const fetcher: FetchLike = async () => { calls++; return calls < 2 ? jsonResponse({}, 500) : jsonResponse({ ok: true }); };
  const key = buildResourceKey("/api/retryok", undefined);
  const r = await readApiResource(key, "/api/retryok", {}, { retries: 1, backoffMs: () => 0, ttlMs: 1000, now: () => 0, fetcher });
  assert.equal(r.ok, true);
  assert.equal(calls, 2);
  const r2 = await readApiResource(key, "/api/retryok", {}, { retries: 1, backoffMs: () => 0, ttlMs: 1000, now: () => 10, fetcher });
  if (r2.ok) assert.equal(r2.fromCache, true, "重试成功的结果应被缓存");
});

test("手动失效：精确 key 与前缀失效", async () => {
  __resetApiResourceCacheForTest();
  const fetcher: FetchLike = async () => jsonResponse({ v: 1 });
  const k1 = buildResourceKey("/api/domain/a", { "x-workspace-id": "ws1" });
  const k2 = buildResourceKey("/api/domain/b", { "x-workspace-id": "ws1" });
  await readApiResource(k1, "/api/domain/a", { headers: { "x-workspace-id": "ws1" } }, { ttlMs: 10000, now: () => 0, fetcher });
  await readApiResource(k2, "/api/domain/b", { headers: { "x-workspace-id": "ws1" } }, { ttlMs: 10000, now: () => 0, fetcher });
  assert.equal(__apiResourceCacheSize(), 2);
  invalidateApiResource(k1);
  assert.equal(__apiResourceCacheSize(), 1);
  invalidateApiResourcePrefix("/api/domain/");
  assert.equal(__apiResourceCacheSize(), 0);
});

test("卸载取消：aborted signal 不重试且返回失败", async () => {
  __resetApiResourceCacheForTest();
  let calls = 0;
  const fetcher: FetchLike = async (_url, init) => {
    calls++;
    if (init?.signal?.aborted) throw new DOMException("aborted", "AbortError");
    return jsonResponse({ v: 1 });
  };
  const controller = new AbortController();
  controller.abort();
  const key = buildResourceKey("/api/abort", undefined);
  const r = await readApiResource(key, "/api/abort", { signal: controller.signal }, { retries: 2, backoffMs: () => 0, fetcher });
  assert.equal(r.ok, false);
  assert.equal(calls, 0, "已 abort 的 signal 不应发起请求");
  if (!r.ok) assert.equal(r.error.name, "AbortError");
});

test("TTL=0：仅并发合并，不跨次缓存", async () => {
  __resetApiResourceCacheForTest();
  let calls = 0;
  const fetcher: FetchLike = async () => { calls++; return jsonResponse({ v: calls }); };
  const key = buildResourceKey("/api/nocache", undefined);
  await readApiResource(key, "/api/nocache", {}, { ttlMs: 0, fetcher });
  await readApiResource(key, "/api/nocache", {}, { ttlMs: 0, fetcher });
  assert.equal(calls, 2, "TTL=0 时每次都应请求");
  assert.equal(__apiResourceCacheSize(), 0);
});
