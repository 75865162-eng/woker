import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { Product } from "../src/lib/products/types";
import type { ProductEditorDraft } from "../src/components/products/product-workbench-model";

const source = readFileSync(new URL("../src/components/products/use-product-revision-conflict.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
function harness() {
  const state: unknown[] = [];
  let cursor = 0;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const original = { sku: "SKU-1", revision: 2, englishName: "Before", competitors: ["a"] } as unknown as ProductEditorDraft;
  let draft = original;
  let base = original;
  let error = "";
  let flushed = 0;
  const hookExports: Record<string, unknown> = {};
  runInNewContext(compiled, {
    exports: hookExports,
    require(name: string) {
      if (name === "react") return {
        useState(initial: unknown) { const i = cursor++; if (!(i in state)) state[i] = initial; return [state[i], (value: unknown) => { state[i] = typeof value === "function" ? (value as (v: unknown) => unknown)(state[i]) : value; }]; },
        useRef(initial: unknown) { const i = cursor++; if (!(i in state)) state[i] = { current: initial }; return state[i]; },
      };
      if (name === "@/lib/products/product-edit-draft-repository") return { restoreProductEdits: (before: Record<string, unknown>, form: Record<string, unknown>, latest: Record<string, unknown>) => ({ ...latest, ...Object.fromEntries(Object.keys(form).filter(key => key !== "revision" && JSON.stringify(form[key]) !== JSON.stringify(before[key])).map(key => [key, form[key]])) }) };
      if (name === "./product-workbench-data") return { productToDraft: (product: Product) => product };
      throw new Error(`unexpected module ${name}`);
    },
    fetch: async (url: string, init?: RequestInit) => { calls.push({ url, init }); return Response.json({ product: { sku: "SKU-1", revision: 3, englishName: "Latest", competitors: ["b"] } }); },
    encodeURIComponent,
  });
  const options = { sku: "SKU-1", workspaceId: "workspace-a", products: [], nextSku: "SKU-2", flushDraft: async () => { flushed++; }, setDraft: (value: ProductEditorDraft) => { draft = value; }, setBaseSnapshot: (value: ProductEditorDraft) => { base = value; }, setEditorError: (value: string) => { error = value; } };
  type ConflictApi = {
    open: boolean;
    active: boolean;
    latest: ProductEditorDraft | null;
    loading: boolean;
    conflict: { current: { original: ProductEditorDraft; form: ProductEditorDraft } | null };
    begin: (before: ProductEditorDraft, form: ProductEditorDraft) => void;
    loadLatest: () => Promise<void>;
    useServerVersion: () => void;
    restoreMine: () => void;
    acceptCandidate: (record: { original: ProductEditorDraft; form: ProductEditorDraft; baseRevision?: number }, current: ProductEditorDraft, isEditing: boolean) => void;
  };
  return { render() { cursor = 0; return (hookExports as { useProductRevisionConflict: (options: unknown) => ConflictApi }).useProductRevisionConflict(options); }, calls, original, get draft() { return draft; }, get base() { return base; }, get error() { return error; }, get flushed() { return flushed; } };
}

test("loads the latest scoped revision without saving and restores edited fields explicitly", async () => {
  const h = harness();
  let conflict = h.render();
  conflict.begin(h.original, { ...h.original, englishName: "My edit" });
  conflict = h.render();
  assert.equal(conflict.active, true);
  assert.equal(conflict.open, true);
  await conflict.loadLatest();
  conflict = h.render();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, "/api/products/SKU-1/detail");
  assert.equal((h.calls[0].init?.headers as Record<string, string>)["x-workspace-id"], "workspace-a");
  assert.equal(h.flushed, 1);
  conflict.restoreMine();
  assert.equal(h.base.revision, 3);
  assert.equal(h.draft.revision, 3);
  assert.equal(h.draft.englishName, "My edit");
  assert.deepEqual((h.draft as unknown as { competitors?: unknown }).competitors, ["b"]);
  assert.equal(conflict.conflict.current, null);
  assert.match(h.error, /未自动保存/);
});

test("using server version clears conflict without replaying local edits", async () => {
  const h = harness();
  let conflict = h.render();
  conflict.begin(h.original, { ...h.original, englishName: "My edit" });
  conflict = h.render();
  await conflict.loadLatest();
  conflict = h.render();
  conflict.useServerVersion();
  conflict = h.render();
  assert.equal(conflict.active, false);
  assert.equal(h.draft.englishName, "Latest");
  assert.equal(h.base.revision, 3);
  assert.equal(conflict.conflict.current, null);
  assert.equal(h.error, "");
});

test("recovers shell drafts by replaying only changed fields and keeps their missing revision", () => {
  const h = harness();
  const conflict = h.render();
  const candidate = { original: h.original, form: { ...h.original, englishName: "Recovered" }, baseRevision: undefined };
  conflict.acceptCandidate(candidate, h.original, true);
  assert.equal(h.draft.englishName, "Recovered");
  assert.equal(h.draft.revision, 2);
  assert.equal(h.base.revision, 2);
});
