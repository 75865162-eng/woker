import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import type { SellerSpriteMcpPublicSettings } from "../src/lib/integrations/sellersprite";

const source = readFileSync(new URL("../src/components/settings/use-sellersprite-settings.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;

type Api = {
  ready: boolean;
  settings: { enabled: boolean; serverUrl: string; marketplace: string; timeoutSeconds: number; protocolVersion: string; apiKey: string; hasApiKey: boolean; configured: boolean };
  showSecret: boolean;
  error: string;
  testMessage: string;
  testing: boolean;
  update: (key: string, value: unknown) => void;
  save: () => Promise<void>;
  test: () => Promise<void>;
  setShowSecret: (value: boolean) => void;
};

type FixtureResponse = { ok: boolean; body: unknown };
function harness(responses: Array<FixtureResponse | Promise<FixtureResponse>>) {
  const states: unknown[] = [];
  const effects: boolean[] = [];
  const cleanups: Array<() => void> = [];
  let cursor = 0;
  let effectCursor = 0;
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const exports: Record<string, unknown> = {};
  runInNewContext(compiled, {
    exports,
    require(name: string) {
      if (name === "react") return {
        useState(initial: unknown) {
          const index = cursor++;
          if (!(index in states)) states[index] = initial;
          return [states[index], (next: unknown) => { states[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(states[index]) : next; }];
        },
        useRef(initial: unknown) {
          const index = cursor++;
          if (!(index in states)) states[index] = { current: initial };
          return states[index];
        },
        useEffect(effect: () => (() => void) | void) {
          const index = effectCursor++;
          if (!effects[index]) {
            effects[index] = true;
            const cleanup = effect();
            if (cleanup) cleanups.push(cleanup);
          }
        },
      };
      if (name === "@/lib/integrations/sellersprite") return {
        defaultSellerSpriteMcpSettings: { enabled: false, serverUrl: "", marketplace: "US", timeoutSeconds: 30, protocolVersion: "streamableHttp", apiKey: "" },
        normalizeSellerSpriteMcpSettings(value: Record<string, unknown>) {
          return { enabled: Boolean(value.enabled), serverUrl: String(value.serverUrl ?? "").trim(), marketplace: String(value.marketplace ?? "US").toUpperCase(), timeoutSeconds: Number(value.timeoutSeconds ?? 30), protocolVersion: String(value.protocolVersion ?? "streamableHttp"), apiKey: String(value.apiKey ?? "") };
        },
      };
      throw new Error(`unexpected module ${name}`);
    },
    fetch: async (url: string, init?: RequestInit) => {
      requests.push({ url, init });
      const response = await (responses.shift() ?? { ok: true, body: {} });
      return { ok: response.ok, json: async () => response.body };
    },
    Date,
  });
  function render() { cursor = 0; effectCursor = 0; return (exports as { useSellerSpriteSettings: () => Api }).useSellerSpriteSettings(); }
  return { render, requests, unmount() { cleanups.forEach((cleanup) => cleanup()); } };
}

function deferredResponse() {
  let resolve!: (value: FixtureResponse) => void;
  const promise = new Promise<FixtureResponse>((done) => { resolve = done; });
  return { promise, resolve };
}

const publicSettings: SellerSpriteMcpPublicSettings = { enabled: true, serverUrl: "https://mcp.example.test", marketplace: "US", timeoutSeconds: 30, protocolVersion: "streamableHttp", hasApiKey: true, configured: true };

test("初始配置迟到不能覆盖用户输入的密钥", async () => {
  const pending = deferredResponse();
  const h = harness([pending.promise]);
  let api = h.render();
  api.update("apiKey", "unsaved-key");
  pending.resolve({ ok: true, body: { settings: publicSettings } });
  await new Promise((resolve) => setImmediate(resolve));
  api = h.render();
  assert.equal(api.settings.apiKey, "unsaved-key");
  assert.equal(h.requests.length, 1);
});

test("保存中再编辑保留新输入且同一时刻只发送一次写入", async () => {
  const pending = deferredResponse();
  const h = harness([{ ok: true, body: { settings: publicSettings } }, pending.promise]);
  let api = h.render();
  await new Promise((resolve) => setImmediate(resolve));
  api = h.render();
  const saving = api.save();
  await api.save();
  api.update("serverUrl", "https://new.example.test");
  pending.resolve({ ok: true, body: { settings: publicSettings } });
  await saving;
  api = h.render();
  assert.equal(api.settings.serverUrl, "https://new.example.test");
  assert.equal(api.settings.configured, false);
  assert.equal(h.requests.filter((request) => request.init?.method === "PUT").length, 1);
});

test("旧连接测试结果不回填已修改的配置，重复测试和交错保存被阻止", async () => {
  const pending = deferredResponse();
  const h = harness([{ ok: true, body: { settings: publicSettings } }, pending.promise]);
  let api = h.render();
  await new Promise((resolve) => setImmediate(resolve));
  api = h.render();
  const testing = api.test();
  await api.test();
  await api.save();
  api.update("marketplace", "DE");
  pending.resolve({ ok: true, body: { ok: true, message: "旧配置可用" } });
  await testing;
  api = h.render();
  assert.equal(api.testMessage, "");
  assert.equal(api.testing, false);
  assert.equal(h.requests.length, 2);
});

test("保存失败保留未提交密钥并允许重试", async () => {
  const h = harness([
    { ok: true, body: { settings: publicSettings } },
    { ok: false, body: { error: "保存失败" } },
    { ok: true, body: { settings: publicSettings } },
  ]);
  h.render();
  await new Promise((resolve) => setImmediate(resolve));
  h.render().update("apiKey", "retry-key");
  let api = h.render();
  await api.save();
  api = h.render();
  assert.equal(api.error, "保存失败");
  assert.equal(api.settings.apiKey, "retry-key");
  await api.save();
  api = h.render();
  assert.equal(api.error, "");
  assert.equal(api.settings.apiKey, "");
  assert.equal(h.requests.filter((request) => request.init?.method === "PUT").length, 2);
});

test("卸载后初始读取不再回填状态", async () => {
  const pending = deferredResponse();
  const h = harness([pending.promise]);
  h.render();
  h.unmount();
  pending.resolve({ ok: true, body: { settings: publicSettings } });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.render().settings.hasApiKey, false);
});

test("SellerSprite 读取只回填公开配置，API key 保持空白且状态可用", async () => {
  const h = harness([{ ok: true, body: { settings: publicSettings } }]);
  let api = h.render();
  await new Promise((resolve) => setImmediate(resolve));
  api = h.render();
  assert.equal(h.requests[0].url, "/api/integrations/sellersprite");
  assert.equal(api.settings.apiKey, "");
  assert.equal(api.settings.hasApiKey, true);
  assert.equal(api.ready, true);
});

test("SellerSprite 保存沿用已保存密钥语义并清空输入明文", async () => {
  const h = harness([{ ok: true, body: { settings: publicSettings } }, { ok: true, body: { settings: publicSettings } }]);
  let api = h.render();
  await new Promise((resolve) => setImmediate(resolve));
  api = h.render();
  api.update("apiKey", "new-secret");
  api = h.render();
  await api.save();
  await new Promise((resolve) => setImmediate(resolve));
  api = h.render();
  assert.equal(h.requests.length, 2);
  const saveRequest = h.requests.find((request) => request.init?.method === "PUT");
  assert.ok(saveRequest);
  const body = JSON.parse(String(saveRequest.init?.body)) as { settings: { apiKey: string } };
  assert.equal(body.settings.apiKey, "new-secret");
  assert.equal(api.settings.apiKey, "");
  assert.equal(api.settings.hasApiKey, true);
});

test("SellerSprite 测试错误经状态返回且 testing 最终清除", async () => {
  const h = harness([{ ok: true, body: { settings: publicSettings } }, { ok: false, body: { error: "连接失败" } }]);
  let api = h.render();
  await new Promise((resolve) => setImmediate(resolve));
  api = h.render();
  await api.test();
  api = h.render();
  assert.equal(h.requests.length, 2);
  assert.ok(h.requests.some((request) => request.init?.method === "POST"));
  assert.equal(api.error, "连接失败");
  assert.equal(api.testing, false);
});
