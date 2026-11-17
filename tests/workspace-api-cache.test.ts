import assert from "node:assert/strict";
import test from "node:test";
import {
  cachedApiGet,
  invalidateWorkspaceApiCache,
  setWorkspaceApiCacheScope,
} from "@/lib/workspace/workspace-api-cache";

setWorkspaceApiCacheScope("test-cached-api-get");
invalidateWorkspaceApiCache();

test("cachedApiGet returns cached value within TTL and skips fetcher", async () => {
  const key = "overview:org:ws";
  let calls = 0;
  const fetcher = async () => { calls += 1; return { rows: calls }; };
  const first = await cachedApiGet({ queryKey: key, ttlMs: 5000, fetcher });
  const second = await cachedApiGet({ queryKey: key, ttlMs: 5000, fetcher });
  assert.equal(calls, 1);
  assert.deepEqual(second, first);
});

test("cachedApiGet de-duplicates concurrent inflight requests", async () => {
  const key = "overview:inflight";
  let calls = 0;
  const fetcher = async () => { calls += 1; await new Promise((r) => setTimeout(r, 20)); return { calls }; };
  const [a, b, c] = await Promise.all([
    cachedApiGet({ queryKey: key, fetcher }),
    cachedApiGet({ queryKey: key, fetcher }),
    cachedApiGet({ queryKey: key, fetcher }),
  ]);
  assert.equal(calls, 1, "three concurrent requests must share one fetch");
  assert.deepEqual(a, b);
  assert.deepEqual(b, c);
});

test("cachedApiGet force bypasses cache", async () => {
  const key = "overview:force";
  let calls = 0;
  const fetcher = async () => ({ calls: ++calls });
  await cachedApiGet({ queryKey: key, fetcher });
  const forced = await cachedApiGet({ queryKey: key, force: true, fetcher });
  assert.equal(forced.calls, 2);
});

test("cachedApiGet retries failed fetcher then caches success", async () => {
  const key = "overview:retry";
  let calls = 0;
  const fetcher = async () => { calls += 1; if (calls < 3) throw new Error("transient"); return { ok: true }; };
  const result = await cachedApiGet({ queryKey: key, retries: 2, fetcher });
  assert.equal(result.ok, true);
  assert.equal(calls, 3);
  // Cached success: another call does not re-run the fetcher.
  await cachedApiGet({ queryKey: key, fetcher });
  assert.equal(calls, 3);
});

test("cachedApiGet does not cache failures", async () => {
  const key = "overview:fail";
  let calls = 0;
  const fetcher = async () => { calls += 1; throw new Error("down"); };
  await assert.rejects(() => cachedApiGet({ queryKey: key, retries: 1, fetcher }), /down/);
  await assert.rejects(() => cachedApiGet({ queryKey: key, retries: 1, fetcher }), /down/);
  assert.equal(calls, 4, "two calls × (1 + 1 retry) — failures are not cached");
});

test("invalidateWorkspaceApiCache clears cachedApiGet entries", async () => {
  const key = "overview:invalidate";
  let calls = 0;
  const fetcher = async () => ({ calls: ++calls });
  await cachedApiGet({ queryKey: key, fetcher });
  await cachedApiGet({ queryKey: key, fetcher });
  assert.equal(calls, 1);
  invalidateWorkspaceApiCache();
  await cachedApiGet({ queryKey: key, fetcher });
  assert.equal(calls, 2);
});
