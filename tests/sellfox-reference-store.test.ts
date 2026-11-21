import test from "node:test";
import assert from "node:assert/strict";
import { referenceScopeKey, useSellfoxReferenceStore } from "@/lib/stores/sellfox-reference-store";

const PAYLOAD = {
  stores: [{ id: "s1", externalId: "1001", name: "店A", marketplace: "ATVPDKIKX0DER", country: "US", status: "active", lastSyncedAt: null }],
  sites: [{ marketplace: "ATVPDKIKX0DER", code: "US", label: "美国站", storeCount: 1 }],
  salespersons: [{ name: "陈馨", storeCount: 1, stores: ["1001"] }],
  version: "v1",
  cache: { status: "miss" },
};

function reset() {
  useSellfoxReferenceStore.setState({
    scopeKey: null, stores: [], sites: [], salespersons: [],
    status: "idle", version: null, loadedAt: null, error: null, cacheStatus: null,
  });
}

function mockFetch(impl: (url: string) => { ok: boolean; body: unknown }) {
  const orig = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    calls.push(url);
    const { ok, body } = impl(url);
    return { ok, status: ok ? 200 : 500, json: async () => body } as Response;
  }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

test("referenceScopeKey: 三态与 workspace/账号维度都进入键", () => {
  const base = { organizationId: "org", workspaceId: "ws" };
  assert.equal(referenceScopeKey({ ...base, storeScope: "all" }), "org|ws|||all");
  assert.equal(referenceScopeKey({ ...base, storeScope: "none" }), "org|ws|||__NO_SELLFOX_STORE__");
  assert.equal(referenceScopeKey({ ...base, storeScope: ["s2", "s1"] }), "org|ws|||s1,s2");
  assert.equal(referenceScopeKey({ ...base, accountId: "a1", marketplace: "us" }), "org|ws|a1|us|all");
});

test("ensureLoaded: 首次加载 + 同 scope 命中零请求 + 新 scope 重载", async () => {
  reset();
  const { calls, restore } = mockFetch(() => ({ ok: true, body: PAYLOAD }));
  try {
    const store = useSellfoxReferenceStore.getState();
    await store.ensureLoaded("org|ws|||all");
    assert.equal(useSellfoxReferenceStore.getState().status, "ready");
    assert.equal(useSellfoxReferenceStore.getState().stores.length, 1);
    assert.equal(calls.length, 1);

    // 同 scope 再调：零请求
    await useSellfoxReferenceStore.getState().ensureLoaded("org|ws|||all");
    assert.equal(calls.length, 1);

    // 新 scope：重载
    await useSellfoxReferenceStore.getState().ensureLoaded("org|ws|a1|us|all");
    assert.equal(calls.length, 2);
  } finally { restore(); reset(); }
});

test("ensureLoaded: 失败置 error 但不抛，stores 为空", async () => {
  reset();
  const { restore } = mockFetch(() => ({ ok: false, body: { error: "x" } }));
  try {
    await useSellfoxReferenceStore.getState().ensureLoaded("org|ws|||all");
    const s = useSellfoxReferenceStore.getState();
    assert.equal(s.status, "error");
    assert.equal(s.stores.length, 0);
  } finally { restore(); reset(); }
});

test("refresh: 失败保留旧值（stale-while-revalidate）", async () => {
  reset();
  let fail = false;
  const { restore } = mockFetch(() => fail ? { ok: false, body: {} } : { ok: true, body: PAYLOAD });
  try {
    await useSellfoxReferenceStore.getState().ensureLoaded("k1");
    const before = useSellfoxReferenceStore.getState().stores;
    fail = true;
    await useSellfoxReferenceStore.getState().refresh();
    assert.equal(useSellfoxReferenceStore.getState().status, "ready");
    assert.deepEqual(useSellfoxReferenceStore.getState().stores, before);
  } finally { restore(); reset(); }
});
