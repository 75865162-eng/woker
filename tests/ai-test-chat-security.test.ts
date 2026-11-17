import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { AiModelSettings } from "@/lib/ai-settings";
import type { AiFetchInit, AiFetchResponse } from "@/lib/server/ai-fetch";

type Api = { POST(request: Request): Promise<Response> };
type Options = {
  denied?: boolean;
  settings?: Partial<AiModelSettings>;
  fetch?: (url: string, init: AiFetchInit) => Promise<AiFetchResponse>;
  requestJson?: () => Promise<unknown>;
};

const secrets = ["sk-fixture-not-a-real-key", "fixture-proxy-user", "fixture-proxy-password"];
const sensitiveDetail = `Authorization: Bearer ${secrets[0]}; http://${secrets[1]}:${secrets[2]}@proxy.fixture.invalid:8080; upstream-private-detail`;
const genericError = "测试失败，请检查模型配置或稍后重试。";
const codexError = "连接已到达 AIGOCODE，但这个 API Key 只允许 Codex 官方客户端使用，不能被当前本地 Web App 直接调用。请更换可用于 OpenAI 兼容 API 的 Key，或换成可直接调用的 Base URL。";
const source = readFileSync(new URL("../src/app/api/ai-settings/test-chat/route.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function fixture(options: Options = {}) {
  const settings: AiModelSettings = {
    enabled: true,
    provider: "custom",
    apiKey: secrets[0],
    baseUrl: "https://upstream.fixture.invalid/v1",
    model: "fixture-model",
    wireApi: "chat_completions",
    timeoutSeconds: 1,
    ...options.settings,
  };
  const calls = {
    permissions: [] as unknown[][],
    bodyReads: 0,
    resolves: [] as unknown[][],
    endpoints: [] as AiModelSettings[],
    headers: [] as AiModelSettings[],
    responseOptions: [] as AiModelSettings[],
    fetches: [] as Array<{ url: string; init: AiFetchInit }>,
    extractors: [] as Array<{ kind: string; data: unknown }>,
    timers: 0,
    clearedTimers: 0,
  };
  const timers = new Set<ReturnType<typeof setTimeout>>();
  const deniedResponse = Response.json({ error: "无权查看设置" }, { status: 403 });
  const dependencies: Record<string, unknown> = {
    "next/server": { NextResponse: { json: Response.json } },
    "@/lib/auth/api-permissions": {
      requireApiPermission: async (...args: unknown[]) => {
        calls.permissions.push(args);
        return options.denied ? { ok: false, response: deniedResponse } : { ok: true };
      },
    },
    "@/lib/server/ai-runtime": {
      resolveAiSettings: (...args: unknown[]) => { calls.resolves.push(args); return settings; },
      buildAiTextEndpoint: (value: AiModelSettings) => {
        calls.endpoints.push(value);
        return `${value.baseUrl}/${value.wireApi === "chat_completions" ? "chat/completions" : "responses"}`;
      },
      buildAiRequestHeaders: (value: AiModelSettings) => {
        calls.headers.push(value);
        return { Authorization: `Bearer ${value.apiKey}`, "Content-Type": "application/json" };
      },
      buildResponsesRequestOptions: (value: AiModelSettings) => {
        calls.responseOptions.push(value);
        return { store: false };
      },
    },
    "@/lib/listing-ai/client": {
      extractChatCompletionText: (data: { choices?: Array<{ message: { content: string } }> }) => {
        calls.extractors.push({ kind: "chat_completions", data });
        return data.choices?.[0]?.message.content ?? "";
      },
      extractOutputText: (data: { output_text?: string }) => {
        calls.extractors.push({ kind: "responses", data });
        return data.output_text ?? "";
      },
    },
    "@/lib/server/ai-fetch": {
      fetchAiApi: async (url: string, init: AiFetchInit) => {
        calls.fetches.push({ url, init });
        assert.ok(options.fetch, "未配置 fixture fetch，禁止访问真实网络");
        return options.fetch(url, init);
      },
    },
  };
  const exports: Record<string, unknown> = {};
  const load = new Function("exports", "require", "AbortController", "setTimeout", "clearTimeout", "fetch", "process", compiled);
  load(exports, (name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), `未声明的依赖：${name}`);
    return dependencies[name];
  }, AbortController, (callback: () => void, milliseconds: number) => {
    assert.equal(milliseconds, 1000, "使用正常短超时，不以超长计时器掩盖清理问题");
    const timer = setTimeout(callback, milliseconds);
    timers.add(timer);
    calls.timers += 1;
    return timer;
  }, (timer: ReturnType<typeof setTimeout>) => {
    assert.ok(timers.delete(timer), "只清理当前 fixture 创建的计时器");
    calls.clearedTimers += 1;
    clearTimeout(timer);
  }, () => { throw new Error("禁止访问真实网络"); }, { env: {} });
  const api = exports as Api;
  const request = new Request("http://fixture.invalid/api/ai-settings/test-chat", {
    method: "POST",
    body: JSON.stringify({ message: "  连接测试  ", aiSettings: { model: "request-fixture-model" } }),
  });
  const readJson = request.json.bind(request);
  request.json = async () => {
    calls.bodyReads += 1;
    return options.requestJson ? options.requestJson() : readJson();
  };
  return {
    calls, settings, request, deniedResponse,
    post: async () => {
      try {
        const response = await api.POST(request);
        assert.equal(timers.size, 0, "POST 返回前应在 finally 清理计时器");
        assert.equal(calls.clearedTimers, calls.timers);
        return response;
      } finally {
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
      }
    },
  };
}

async function expectError(response: Response, status: number, error: string) {
  assert.equal(response.status, status);
  const payload: unknown = await response.json();
  const serialized = JSON.stringify(payload);
  for (const secret of [...secrets, "upstream-private-detail"]) {
    assert.ok(!serialized.includes(secret), "错误响应不得包含模拟密钥、代理凭据或上游私有详情");
  }
  assert.deepEqual(payload, { error });
}

test("权限拒绝原样返回403，不读body、不解析配置、不fetch", async () => {
  const state = fixture({ denied: true, requestJson: async () => { throw new Error(sensitiveDetail); } });
  const response = await state.post();
  assert.equal(response, state.deniedResponse);
  assert.deepEqual(state.calls.permissions, [["settings", "view", state.request]]);
  assert.equal(state.calls.bodyReads, 0);
  assert.equal(state.calls.resolves.length, 0);
  assert.equal(state.calls.fetches.length, 0);
  assert.equal(state.calls.timers, 0);
});

test("缺少API Key返回400且不fetch", async () => {
  const state = fixture({ settings: { apiKey: "  " } });
  await expectError(await state.post(), 400, "缺少 API Key，请先保存大模型配置。");
  assert.equal(state.calls.fetches.length, 0);
  assert.equal(state.calls.timers, 0);
});

test("图片接口返回400且不fetch", async () => {
  const state = fixture({ settings: { wireApi: "image_generations" } });
  await expectError(await state.post(), 400, "当前配置是图片生成接口，不能用于聊天测试。请在 Listing AI 的图片生成区验证火山方舟生图。");
  assert.equal(state.calls.fetches.length, 0);
  assert.equal(state.calls.timers, 0);
});

for (const status of [401, 429, 503]) {
  test(`上游HTTP ${status}保留状态且不泄露响应正文`, async () => {
    const state = fixture({ fetch: async () => new Response(sensitiveDetail, { status }) });
    await expectError(await state.post(), status, `测试失败：上游服务返回 HTTP ${status}，请检查模型配置或稍后重试。`);
    assert.equal(state.calls.fetches.length, 1);
  });
}

for (const status of [401, 403]) {
  test(`Codex限制将上游${status}转换为固定403提示且不回原文`, async () => {
    const state = fixture({ fetch: async () => new Response(`${sensitiveDetail}; only allows Codex official clients`, { status }) });
    await expectError(await state.post(), 403, codexError);
  });
}

for (const [label, thrown] of [
  ["Error.message", new Error(sensitiveDetail)],
  ["非Error字符串", sensitiveDetail],
  ["非Error对象", { message: sensitiveDetail }],
] as const) {
  test(`fetch抛出${label}返回固定500且不泄露`, async () => {
    const state = fixture({ fetch: async () => { throw thrown; } });
    await expectError(await state.post(), 500, genericError);
    assert.equal(state.calls.timers, 1);
  });
}

test("上游成功响应json解析异常返回固定500且不泄露", async () => {
  const malformed = fixture({ fetch: async () => new Response(`{"detail":"${sensitiveDetail}",`) });
  await expectError(await malformed.post(), 500, genericError);
  assert.equal(malformed.calls.fetches.length, 1);
  assert.equal(malformed.calls.extractors.length, 0);
});

test("请求body的json解析异常返回固定500且不fetch", async () => {
  const state = fixture({ requestJson: async () => { throw new SyntaxError(sensitiveDetail); } });
  await expectError(await state.post(), 500, genericError);
  assert.equal(state.calls.fetches.length, 0);
  assert.equal(state.calls.timers, 0);
});

test("fetch抛出AbortError返回504且清理计时器", async () => {
  const error = new Error(sensitiveDetail);
  error.name = "AbortError";
  const state = fixture({ fetch: async () => { throw error; } });
  await expectError(await state.post(), 504, "测试请求超时：1 秒内没有返回。");
  assert.equal(state.calls.timers, 1);
});

for (const wireApi of ["chat_completions", "responses"] as const) {
  test(`${wireApi}成功保持result契约并选择对应请求和extractor`, async () => {
    const data = wireApi === "chat_completions"
      ? { choices: [{ message: { content: "连接成功" } }] }
      : { output_text: "连接成功" };
    const state = fixture({ settings: { wireApi }, fetch: async () => Response.json(data) });
    const response = await state.post();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      result: { message: "连接成功", model: state.settings.model, baseUrl: state.settings.baseUrl },
    });
    assert.deepEqual(state.calls.resolves, [[{ model: "request-fixture-model" }, "text"]]);
    assert.deepEqual(state.calls.extractors, [{ kind: wireApi, data }]);
    assert.deepEqual(state.calls.endpoints, [state.settings]);
    assert.deepEqual(state.calls.headers, [state.settings]);
    assert.deepEqual(state.calls.responseOptions, wireApi === "responses" ? [state.settings] : []);
    assert.equal(state.calls.fetches.length, 1);
    const { url, init } = state.calls.fetches[0];
    assert.equal(url, `${state.settings.baseUrl}/${wireApi === "chat_completions" ? "chat/completions" : "responses"}`);
    assert.equal(init.method, "POST");
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.signal.aborted, false);
    assert.deepEqual(init.headers, { Authorization: `Bearer ${secrets[0]}`, "Content-Type": "application/json" });
    const messages = [
      { role: "system", content: "你是一个连接测试助手。只需简短回答用户问题，不要输出敏感信息。" },
      { role: "user", content: "连接测试" },
    ];
    assert.deepEqual(JSON.parse(String(init.body)), wireApi === "chat_completions"
      ? { model: state.settings.model, messages }
      : { store: false, model: state.settings.model, input: messages });
    assert.equal(state.calls.timers, 1);
  });

  test(`${wireApi}返回空文本时保持502契约`, async () => {
    const state = fixture({ settings: { wireApi }, fetch: async () => Response.json({}) });
    await expectError(await state.post(), 502, "模型已响应，但没有返回可显示文本。");
    assert.equal(state.calls.extractors[0].kind, wireApi);
  });
}
