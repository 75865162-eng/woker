import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../src/components/app-shell/workspace-scope-selector.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("selector.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const names = new Set(["shouldScopeFetch", "patchFetchWithWorkspaceScope", "writeSelectedScope"]);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node) && node.name && names.has(node.name.text)).map(node => node.getText(ast)).join("\n");
const compiled = ts.transpileModule(functions, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

test("全局补丁只补缺省作用域，不覆盖已绑定操作，也不向外域泄漏", async () => {
  const sent: Array<{ input: RequestInfo | URL; init?: RequestInit }> = [];
  const window = { location: { origin: "https://erp.fixture" }, fetch: async (input: RequestInfo | URL, init?: RequestInit) => { sent.push({ input, init }); return new Response(); } };
  const context = { window, URL, Request, Headers, readSelectedScope: () => ({ workspaceId: "ws-b", accountId: "seller-b", marketplace: "DE" }) };
  runInNewContext(`${compiled}; patchFetchWithWorkspaceScope(); patchFetchWithWorkspaceScope();`, context);
  await window.fetch("/api/data");
  let headers = new Headers(sent.at(-1)?.init?.headers);
  assert.equal(headers.get("x-workspace-id"), "ws-b");
  assert.equal(headers.get("x-account-id"), "seller-b");
  await window.fetch("/api/data", { headers: { "x-workspace-id": "ws-a", "x-account-id": "seller-a" } });
  headers = new Headers(sent.at(-1)?.init?.headers);
  assert.equal(headers.get("x-workspace-id"), "ws-a");
  assert.equal(headers.get("x-account-id"), "seller-a");
  assert.equal(headers.get("x-marketplace"), null);
  await window.fetch(new Request("https://erp.fixture/api/data", { headers: { "x-workspace-id": "ws-a" } }));
  assert.equal(new Headers(sent.at(-1)?.init?.headers).get("x-workspace-id"), "ws-a");
  await window.fetch("https://outside.fixture/api/data");
  assert.equal(sent.at(-1)?.init, undefined);
  assert.equal(sent.length, 4);
});

test("存储失败不提交工作区切换，成功时同步持久化 cookie", () => {
  const document = { cookie: "" };
  const scope = { workspaceId: "ws-b", accountId: "", marketplace: "" };
  let fail = true;
  const saved: string[] = [];
  const window = { localStorage: { setItem: (_key: string, value: string) => { if (fail) throw new Error("blocked"); saved.push(value); } } };
  const write = runInNewContext(`${compiled}; writeSelectedScope`, { window, document, storageKey: "scope", encodeURIComponent }) as (value: typeof scope) => boolean;
  assert.equal(write(scope), false);
  assert.equal(document.cookie, "");
  fail = false;
  assert.equal(write(scope), true);
  assert.equal(saved.length, 1);
  assert.match(document.cookie, /scope=.*Path=\//);
  // 两条提交路径都必须在 setSelected / emit 前检查持久化结果。
  assert.equal((source.match(/if \(!writeSelectedScope\(nextSelected\)\)/g) ?? []).length, 2);
});
