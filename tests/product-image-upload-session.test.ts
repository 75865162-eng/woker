import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/components/products/use-product-image-uploads.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
const turn = () => new Promise<void>(resolve => setImmediate(resolve));

function harness() {
  let cursor = 0;
  let draft = { images: [] as string[], imageAssets: [] as unknown[] };
  const slots: unknown[] = [];
  const cleanup: Array<() => void> = [];
  const revoked: string[] = [];
  const requests: Array<{ signal: AbortSignal; resolve: (value: unknown) => void; reject: (error: Error) => void }> = [];
  const react = {
    useState(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (action: unknown) => { slots[index] = typeof action === "function" ? action(slots[index]) : action; }]; },
    useRef(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = { current: initial }; return slots[index]; },
    useEffect(fn: () => () => void) { const index = cursor++; if (!(index in slots)) { slots[index] = true; cleanup.push(fn()); } },
  };
  const exports: Record<string, (draft: unknown, setter: unknown) => unknown> = {};
  runInNewContext(compiled, {
    exports, AbortController, URL: { createObjectURL: (file: { name: string }) => `blob:${file.name}`, revokeObjectURL: (url: string) => revoked.push(url) },
    require: (name: string) => {
      if (name === "react") return react;
      assert.equal(name, "./product-attachment-upload");
      return { selectProductImageFiles: (files: unknown[]) => files, uploadProductImageFile: (_file: unknown, options: { signal: AbortSignal }) => new Promise((resolve, reject) => requests.push({ signal: options.signal, resolve, reject })) };
    },
  });
  type Session = { imageUploads: Array<{ id: string; status: string }>; handleImageUpload: (files: unknown) => Promise<void>; cancelImageUpload: (id: string) => void; retryImageUpload: (id: string) => void };
  function render() { cursor = 0; return exports.useProductImageUploads(draft, (action: (value: typeof draft) => typeof draft) => { draft = action(draft); }) as Session; }
  return { render, requests, revoked, draft: () => draft, dispose: () => cleanup.forEach(fn => fn()) };
}

test("图片上传最多双并发，失败可重试且成功只绑定已完成附件", async () => {
  const h = harness();
  await h.render().handleImageUpload([{ name: "a" }, { name: "b" }, { name: "c" }]);
  await turn();
  assert.equal(h.requests.length, 2);
  h.requests[0].resolve({ id: "a", thumbUrl: "thumb-a" });
  await turn();
  assert.equal(h.requests.length, 3);
  assert.deepEqual(Array.from(h.draft().images), ["thumb-a"]);
  h.requests[1].reject(new Error("fixture failure"));
  await turn();
  const failed = h.render().imageUploads.find(item => item.status === "failed");
  assert.ok(failed);
  h.render().retryImageUpload(failed.id);
  await turn();
  assert.equal(h.requests.length, 4);
  h.dispose();
  assert.ok(h.requests[2].signal.aborted);
  assert.ok(h.requests[3].signal.aborted);
});

test("取消及卸载后迟到上传不能写回草稿，预览URL全部释放且队列停止", async () => {
  const h = harness();
  await h.render().handleImageUpload([{ name: "a" }, { name: "b" }, { name: "c" }]);
  await turn();
  const id = h.render().imageUploads[0].id;
  h.render().cancelImageUpload(id);
  assert.ok(h.requests[0].signal.aborted);
  h.requests[0].resolve({ id: "a", thumbUrl: "late-a" });
  await turn();
  assert.equal(h.draft().images.length, 0);
  h.dispose();
  for (const request of h.requests) request.resolve({ id: "late", thumbUrl: "late" });
  await turn();
  assert.equal(h.draft().images.length, 0);
  assert.equal(h.revoked.length, 3);
});
