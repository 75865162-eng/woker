import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/components/products/use-product-list.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const turn = () => new Promise<void>(resolve => setImmediate(resolve));
const summary = { total: 7 };
function environment() {
  let workspace = "a";
  const requests: Array<{ url: string; signal?: AbortSignal; resolve: (data: unknown) => void; reject: (error: Error) => void }> = [];
  const writes: unknown[] = [];
  const cache = {
    readCachedProductWorkbench: () => null, readCurrentWorkspaceId: () => workspace,
    normalizeProductFilters: () => ({}), emptyProductListSummary: { total: 0 },
    writeCachedProductWorkbench: (data: unknown) => writes.push(data),
    getProductListRequestCacheKey: () => `${workspace}::workspaceId=${workspace}`,
    getProductSummaryRequestCacheKey: () => `${workspace}::summary`,
    productSummaryResponseCache: new Map(), productSummaryInflight: new Map(), REQUEST_CACHE_TTL_MS: 30000,
    scheduleNonCriticalTask: () => () => {},
  };
  function mount() {
    let cursor = 0;
    const slots: unknown[] = [];
    const cleanups: Array<() => void> = [];
    const react = {
      useState(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial; return [slots[index], (action: unknown) => { slots[index] = typeof action === "function" ? action(slots[index]) : action; }]; },
      useRef(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
      useCallback(fn: unknown) { cursor++; return fn; },
      useEffect(fn: () => void | (() => void)) { const index = cursor++; if (!(index in slots)) { slots[index] = true; const cleanup = fn(); if (cleanup) cleanups.push(cleanup); } },
    };
    const exports: Record<string, (...args: unknown[]) => unknown> = {};
    runInNewContext(compiled, {
      exports, AbortController, window: { setTimeout: () => 0, clearTimeout: () => {} },
      fetch: (url: string, options: { signal?: AbortSignal }) => new Promise((resolve, reject) => requests.push({ url, signal: options.signal, resolve: data => resolve({ ok: true, json: async () => data }), reject })),
      require: (name: string) => {
        if (name === "react") return react;
        if (name.endsWith("amazon-field-policy")) return { stripAmazonProductObservations: (p: unknown) => p };
        if (name.endsWith("lightweight-product")) return { toLightweightProduct: (p: unknown) => p };
        if (name.endsWith("list-sort")) return { defaultProductListSort: { field: "updatedAt", direction: "desc" } };
        if (name.endsWith("use-draft-state")) return { useDraftState: (_key: string, initial: unknown) => react.useState(initial) };
        if (name === "./product-workbench-model") return { initialFilters: {} };
        if (name === "./product-workbench-cache") return cache;
        if (name === "./product-list-state") return { mergeSavedProductIntoList: (products: unknown, totalCount: number) => ({ products, totalCount, pending: null }) };
        throw new Error(name);
      },
    });
    type Session = { products: Array<{ sku: string }>; productsError: string; listSummary: { total: number }; reloadProducts: () => Promise<void> };
    return { render() { cursor = 0; return exports.useProductList(undefined, "", () => {}) as Session; }, dispose() { cleanups.forEach(fn => fn()); } };
  }
  return { mount, requests, writes, cache, scope(value: string) { workspace = value; } };
}

test("列表请求代次阻止旧结果覆盖新结果，手动请求卸载会取消", async () => {
  const h = environment(); const view = h.mount();
  const first = view.render().reloadProducts(); const second = view.render().reloadProducts();
  assert.equal(h.requests[0].signal?.aborted, true);
  h.requests[1].resolve({ products: [{ sku: "new" }], summary }); await second;
  h.requests[0].resolve({ products: [{ sku: "old" }], summary }); await first;
  assert.equal(view.render().products[0].sku, "new"); assert.equal(h.writes.length, 1);
  const last = view.render().reloadProducts(); view.dispose();
  assert.equal(h.requests[2].signal?.aborted, true);
  h.requests[2].resolve({ products: [{ sku: "late" }], summary }); await last;
  assert.equal(h.writes.length, 1);
});

test("切换工作区后迟到列表不能写状态或缓存", async () => {
  const h = environment(); const view = h.mount(); const pending = view.render().reloadProducts();
  h.scope("b"); h.requests[0].resolve({ products: [{ sku: "a" }], summary }); await pending;
  assert.equal(view.render().products.length, 0); assert.equal(h.writes.length, 0);
});

test("共享统计请求去重，取消一个消费者不影响另一个，缓存隔离工作区", async () => {
  const h = environment(); const one = h.mount(); const two = h.mount();
  const a = one.render().reloadProducts(); const b = two.render().reloadProducts();
  h.requests[0].resolve({ products: [] }); h.requests[1].resolve({ products: [] }); await Promise.all([a, b]);
  assert.equal(h.requests.length, 3); one.dispose();
  h.requests[2].resolve({ summary }); await turn();
  assert.equal(one.render().listSummary.total, 0); assert.equal(two.render().listSummary.total, 7);
  assert.equal(h.cache.productSummaryResponseCache.has("a::summary"), true);
  h.scope("b"); const three = h.mount(); const c = three.render().reloadProducts();
  h.requests[3].resolve({ products: [] }); await c;
  assert.equal(h.requests.length, 5);
  h.scope("c"); h.requests[4].reject(new Error("迟到失败")); await turn();
  assert.equal(three.render().listSummary.total, 0);
  assert.equal(h.cache.productSummaryResponseCache.has("b::summary"), false);
});
