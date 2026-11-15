import assert from "node:assert/strict";
import test from "node:test";
import { getJson, readGetDedupStats, resetGetDedupStats } from "@/lib/workspace/get-json";

function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Response>) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; method: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), method: init?.method ?? "GET" });
    return handler(String(input), init);
  }) as typeof fetch;
  return {
    calls,
    restore() { globalThis.fetch = original; },
  };
}

test("同一时刻相同 GET 只发一次请求，调用方共享同一结果", async () => {
  resetGetDedupStats();
  const mock = mockFetch(async () => Response.json({ plans: [] }));
  try {
    const [a, b, c] = await Promise.all([
      getJson("/api/operations/procurement/plans", { headers: { "x-workspace-id": "w1" } }),
      getJson("/api/operations/procurement/plans", { headers: { "x-workspace-id": "w1" } }),
      getJson("/api/operations/procurement/plans", { headers: { "x-workspace-id": "w1" } }),
    ]);
    assert.equal(mock.calls.length, 1);
    assert.strictEqual(a, b);
    assert.strictEqual(b, c);
    assert.equal(readGetDedupStats().requests, 1);
    assert.equal(readGetDedupStats().shared, 2);
  } finally { mock.restore(); }
});

test("请求结束后再调用会重新取数，数据新鲜度不受影响", async () => {
  resetGetDedupStats();
  let round = 0;
  const mock = mockFetch(async () => { round++; return Response.json({ round }); });
  try {
    const first = await getJson<{ round: number }>("/api/x", { headers: { "x-workspace-id": "w1" } });
    const second = await getJson<{ round: number }>("/api/x", { headers: { "x-workspace-id": "w1" } });
    assert.equal(mock.calls.length, 2);
    assert.equal(first.data.round, 1);
    assert.equal(second.data.round, 2);
  } finally { mock.restore(); }
});

test("不同工作区不共享在途请求（租户隔离）", async () => {
  resetGetDedupStats();
  const mock = mockFetch(async () => Response.json({ ok: true }));
  try {
    await Promise.all([
      getJson("/api/operations/ext?kind=reviews", { headers: { "x-workspace-id": "w1" } }),
      getJson("/api/operations/ext?kind=reviews", { headers: { "x-workspace-id": "w2" } }),
    ]);
    assert.equal(mock.calls.length, 2);
  } finally { mock.restore(); }
});

test("非 2xx 不抛错，交由调用方判定，且不缓存错误", async () => {
  resetGetDedupStats();
  const mock = mockFetch(async () => Response.json({ error: "无权限" }, { status: 403 }));
  try {
    const result = await getJson<{ error: string }>("/api/x", { headers: { "x-workspace-id": "w1" } });
    assert.equal(result.ok, false);
    assert.equal(result.status, 403);
    assert.equal(result.data.error, "无权限");
    await getJson("/api/x", { headers: { "x-workspace-id": "w1" } });
    assert.equal(mock.calls.length, 2);
  } finally { mock.restore(); }
});

test("请求失败后清空在途记录，重试可以重新发请求", async () => {
  resetGetDedupStats();
  let attempt = 0;
  const mock = mockFetch(async () => {
    attempt++;
    if (attempt === 1) throw new Error("network");
    return Response.json({ ok: true });
  });
  try {
    await assert.rejects(getJson("/api/x", { headers: { "x-workspace-id": "w1" } }));
    const retry = await getJson("/api/x", { headers: { "x-workspace-id": "w1" } });
    assert.equal(retry.ok, true);
    assert.equal(mock.calls.length, 2);
  } finally { mock.restore(); }
});

test("只发 GET，不改变请求方法", async () => {
  resetGetDedupStats();
  const mock = mockFetch(async () => Response.json({ ok: true }));
  try {
    await getJson("/api/x", { headers: { "x-workspace-id": "w1" } });
    assert.equal(mock.calls.length, 1);
    assert.equal(mock.calls[0].method, "GET");
  } finally { mock.restore(); }
});
