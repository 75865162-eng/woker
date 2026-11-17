import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { Product, ProductDraft } from "../src/lib/products/types";

const source = readFileSync(new URL("../src/components/products/use-product-editor.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const product = (sku: string) => ({ sku, id: `prod-${sku}`, status: "pending", createdAt: "fixture", images: [] }) as unknown as Product;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}
function harness() {
  let workspaceId = "a";
  let cursor = 0;
  let error = "";
  let logs: string[] = [];
  const slots: unknown[] = [];
  const effects: Array<() => void | (() => void)> = [];
  const cleanups: Array<() => void> = [];
  const listeners = new Set<() => void>();
  const requests: Array<{ url: string; init?: RequestInit; result: ReturnType<typeof deferred<Response>> }> = [];
  const saved: Array<{ product: Product; isNew: boolean }> = [];
  const cache = new Map<string, Product>();
  const inflight = new Map<string, Promise<Product>>();
  let parsed = Promise.resolve(product("imported"));
  let uploads = 0;
  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (value: unknown) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }];
    },
    useRef(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = { current: initial };
      return slots[index];
    },
    useCallback: (fn: unknown) => fn,
    useEffect(fn: () => void | (() => void), dependencies: unknown[]) {
      const index = cursor++;
      const previous = slots[index] as unknown[] | undefined;
      if (!previous || dependencies.some((value, i) => value !== previous[i])) effects.push(fn);
      slots[index] = dependencies;
    },
  };
  const modules: Record<string, unknown> = {
    react,
    "@/data/products": { newProductStatusOptions: [{ value: "pending" }] },
    "@/lib/products/amazon-field-policy": { stripAmazonProductObservations: (value: Product) => value },
    "@/lib/workspace/workspace-scope-events": { workspaceScopeChangedEventName: "scope" },
    "./product-workbench-data": { parseProductWorkbookFile: () => parsed },
    "./product-attachment-upload": { uploadEmbeddedProductImages: async (value: Product) => { uploads++; return value; } },
    "./product-workbench-utils": { formatDateTime: () => "fixture-date", nextSku: () => "next" },
    "./product-workbench-cache": {
      productDetailCache: cache, productDetailInflight: inflight,
      getProductDetailCacheKeyWithMode: (workspace: string, sku: string, full: boolean) => `${workspace}:${sku}:${full}`,
      readCurrentWorkspaceId: () => workspaceId,
      invalidateProductRequestCaches: () => {},
    },
  };
  const exports: { useProductEditor?: (options: unknown) => Record<string, unknown> } = {};
  runInNewContext(compiled, {
    exports, require: (name: string) => { assert.ok(name in modules, name); return modules[name]; },
    fetch: (url: string, init?: RequestInit) => {
      const result = deferred<Response>();
      requests.push({ url, init, result });
      return result.promise;
    },
    window: { addEventListener: (_name: string, fn: () => void) => listeners.add(fn), removeEventListener: (_name: string, fn: () => void) => listeners.delete(fn) },
  });
  const options = {
    products: [], creatorName: "fixture-owner", identityKey: "org:user",
    setActivityLog: (updater: (current: string[]) => string[]) => { logs = updater(logs); },
    setProductsError: (value: string) => { error = value; },
    onSaved: (value: Product, isNew: boolean) => saved.push({ product: value, isNew }),
  };
  type Session = {
    activeProduct: Product | null; importedEditorDraft: Product | null; detailReady: boolean; detailError: string; isEditorOpen: boolean;
    openProduct: (sku: string) => Promise<void>; openNewProduct: () => void; closeProductEditor: () => void;
    handleImportFile: (file: File) => Promise<void>; handleSaveProduct: (draft: ProductDraft) => Promise<void>;
  };
  function render() {
    cursor = 0;
    const session = exports.useProductEditor!(options) as unknown as Session;
    effects.splice(0).forEach((effect) => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); });
    return session;
  }
  return {
    render, requests, saved, cache, inflight,
    get error() { return error; }, get logs() { return logs; }, get uploads() { return uploads; },
    setParsed(value: Promise<Product>) { parsed = value; },
    switchScope(value: string) { workspaceId = value; listeners.forEach((listener) => listener()); },
    unmount() { cleanups.forEach((cleanup) => cleanup()); },
  };
}
const respond = (product: Product) => new Response(JSON.stringify({ product }));

test("详情请求去重且后打开的商品不被迟到详情覆盖", async () => {
  const h = harness();
  const session = h.render();
  const first = session.openProduct(" first ");
  const duplicate = session.openProduct("first");
  assert.equal(h.requests.length, 1);
  const last = session.openProduct("last");
  h.requests[1].result.resolve(respond(product("last")));
  await last;
  h.requests[0].result.resolve(respond(product("first")));
  await Promise.all([first, duplicate]);
  assert.equal(h.render().activeProduct?.sku, "last");
  assert.equal(h.render().detailReady, true);
  assert.equal(h.cache.get("a:first:true")?.sku, "first");
  assert.equal(h.inflight.size, 0);
});

test("工作区切换或卸载阻止详情重新打开编辑器", async () => {
  for (const end of ["scope", "unmount"]) {
    const h = harness();
    const pending = h.render().openProduct("first");
    if (end === "scope") h.switchScope("b"); else h.unmount();
    h.requests[0].result.resolve(respond(product("first")));
    await pending;
    assert.equal(h.render().activeProduct, null);
    if (end === "scope") assert.equal(h.render().isEditorOpen, false);
    assert.equal(h.requests[0].init?.headers && (h.requests[0].init.headers as Record<string, string>)["x-workspace-id"], "a");
    assert.equal(h.cache.has("b:first:true"), false);
  }
});

test("导入只创建可检查的草稿，失效导入不上传附件也不覆盖新会话", async () => {
  const h = harness();
  await h.render().handleImportFile({ name: "fixture.xlsx" } as File);
  const imported = h.render();
  assert.equal(imported.importedEditorDraft?.selectionOwner, "fixture-owner");
  assert.equal(imported.activeProduct, null);
  assert.equal(imported.isEditorOpen, true);
  assert.equal(h.requests.length, 0);
  assert.equal(h.uploads, 1);
  const delayed = deferred<Product>();
  h.setParsed(delayed.promise);
  const pending = imported.handleImportFile({ name: "late.xlsx" } as File);
  h.render().openNewProduct();
  delayed.resolve(product("late"));
  await pending;
  assert.equal(h.render().importedEditorDraft, null);
  assert.equal(h.uploads, 1);
});

test("详情错误保留重试状态，关闭编辑器后迟到错误不回写", async () => {
  const h = harness();
  const pending = h.render().openProduct("missing");
  h.requests[0].result.resolve(new Response(JSON.stringify({ error: "fixture missing" }), { status: 404 }));
  await pending;
  assert.equal(h.render().detailReady, false);
  assert.equal(h.render().detailError, "fixture missing");
  const late = h.render().openProduct("late");
  h.render().closeProductEditor();
  h.requests[1].result.resolve(new Response(JSON.stringify({ error: "late failure" }), { status: 500 }));
  await late;
  assert.equal(h.render().detailError, "");
  assert.equal(h.render().isEditorOpen, false);
});

test("工作区切换阻止导入解析结果上传到另一个工作区", async () => {
  const h = harness();
  const parsed = deferred<Product>();
  h.setParsed(parsed.promise);
  const pending = h.render().handleImportFile({ name: "fixture.xlsx" } as File);
  h.switchScope("b");
  parsed.resolve(product("imported-a"));
  await pending;
  assert.equal(h.uploads, 0);
  assert.equal(h.render().importedEditorDraft, null);
  assert.equal(h.render().isEditorOpen, false);
  assert.equal(h.error, "");
});

test("保存保留revision并向调用方报告冲突，新商品状态归一化", async () => {
  const h = harness();
  const pending = h.render().handleSaveProduct({ ...product("new"), status: "listed", revision: 7 } as unknown as ProductDraft);
  const body = JSON.parse(h.requests[0].init?.body as string);
  assert.equal(body.workspaceId, "a");
  assert.equal(body.product.revision, 7);
  assert.equal(body.product.status, "pending");
  h.requests[0].result.resolve(new Response(JSON.stringify({ conflict: true, error: "revision conflict" }), { status: 409 }));
  await assert.rejects(pending, { name: "ProductRevisionConflictError", message: "revision conflict" });
  assert.equal(h.saved.length, 0);
  assert.match(h.logs[0], /商品保存失败/);
});

test("保存成功触发列表更新，但跨工作区迟到保存不污染当前列表", async () => {
  for (const switchScope of [false, true]) {
    const h = harness();
    const pending = h.render().handleSaveProduct(product("new") as unknown as ProductDraft);
    if (switchScope) h.switchScope("b");
    h.requests[0].result.resolve(respond(product("new")));
    await pending;
    assert.equal(h.saved.length, switchScope ? 0 : 1);
    if (!switchScope) assert.equal(h.saved[0].isNew, true);
    assert.equal(h.cache.has("a:new:true"), true);
    assert.equal(h.cache.has("b:new:true"), false);
  }
});
