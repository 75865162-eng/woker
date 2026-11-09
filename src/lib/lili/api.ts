import { researchMcpTools, callResearchMcpTool } from "./research-tools";
import { NextResponse } from "next/server";
import type { PermissionAction } from "@/lib/accounts/permissions";
import { listSkills, listTools, listWorkflows } from "./catalog";
import type { ToolConfigDependencies } from "./tool-config-api";
import { createRuntimeTools, RuntimeToolError, type RuntimeTools } from "./runtime-tools";
import { publicMcpResponse } from "./public-mcp";
import { publicResearchTools } from "./public-research-tools";

type Authorization = { ok: true; user?: { id: string; organizationId: string } } | { ok: false; response: Response };
export type LiliAuthorize = (moduleId: string, action: PermissionAction, request: Request) => Promise<Authorization>;
type Endpoint = { methods: string[]; moduleId?: string; nextPath?: string };
const endpoints: Record<string, Endpoint> = {
  "health": { methods: ["GET"] }, "mcp": { methods: ["GET", "POST"] },
  "codex-bundle": { methods: ["GET"] }, "preferences": { methods: ["POST"] },
  "tools/run": { methods: ["POST"] }, "tool-config": { methods: ["GET", "PUT"], moduleId: "settings" },
  "tool-config/mappings": { methods: ["GET"], moduleId: "settings" },
  "tool-config/test": { methods: ["POST"], moduleId: "settings" },
  "team": { methods: ["POST"], moduleId: "accounts", nextPath: "/accounts" },
  "session": { methods: ["POST", "DELETE"], nextPath: "/login" },
  "stores": { methods: ["POST"], moduleId: "operations", nextPath: "/operations" },
  "ads-profiles": { methods: ["POST"], moduleId: "operations", nextPath: "/amazon-ads" },
  "connections": { methods: ["POST"], moduleId: "operations", nextPath: "/operations" },
  "connections/[id]": { methods: ["PATCH", "DELETE"], moduleId: "operations", nextPath: "/operations" },
  "approvals/[id]": { methods: ["POST"], nextPath: "/agents" },
  "shopify": { methods: ["POST", "DELETE"], moduleId: "settings", nextPath: "/settings" },
  "credits": { methods: ["POST"] }, "feedback": { methods: ["POST"] },
  "workflows/pack": { methods: ["POST"], nextPath: "/agents" },
  "workflows/run": { methods: ["POST"], nextPath: "/agents" },
  "workflows/selection-doc": { methods: ["POST"], nextPath: "/agents/market/selection" },
  "workflows/selection-html": { methods: ["GET"], nextPath: "/agents/market/selection" },
};
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
class RequestFormatError extends Error {}
function json(body: unknown, status = 200) { return NextResponse.json(body, { status, headers }); }
function endpointKey(parts: string[]) {
  if (parts.length === 2 && ["approvals", "connections"].includes(parts[0])) return `${parts[0]}/[id]`;
  return parts.join("/");
}

async function boundedJson(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new RequestFormatError("Expected JSON");
  const reader = request.body?.getReader();
  if (!reader) throw new RequestFormatError("Missing body");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16_384) { await reader.cancel(); throw new RequestFormatError("Body too large"); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new RequestFormatError("Expected object");
  return body;
}

async function defaultAuthorize(moduleId: string, action: PermissionAction, request: Request) {
  const { requireApiPermission } = await import("@/lib/auth/api-permissions");
  return requireApiPermission(moduleId, action, request);
}

/** Both namespaces expose public Skill definitions; business operations share scoped host authorization. */
export async function handleLiliRequest(request: Request, parts: string[], authorize: LiliAuthorize = defaultAuthorize, toolConfigDependencies?: ToolConfigDependencies, runtimeTools?: RuntimeTools): Promise<Response> {
  try {
    const key = endpointKey(parts);
    if (key === "mcp") {
      const origin = request.headers.get("origin");
      if (origin && origin !== new URL(request.url).origin) return json({ error: "origin_mismatch" }, 403);
      const version = request.headers.get("mcp-protocol-version");
      if (version && !["2024-11-05", "2025-03-26", "2025-06-18"].includes(version)) return json({ error: "unsupported_protocol_version" }, 400);
    }
    const endpoint = Object.hasOwn(endpoints, key) ? endpoints[key] : undefined;
    const moduleId = endpoint?.moduleId ?? "agents";
    // The shared permission helper inspects workspaceId in JSON bodies. Bound that
    // body first so its clone cannot read an unlimited payload before our parser.
    const parsedBody = request.method !== "GET" && request.headers.get("content-type")?.includes("application/json")
      ? await boundedJson(request) : undefined;
    // A supplied bearer never falls back to a browser cookie, including an invalid bearer.
    if (key === "mcp" && request.headers.has("authorization")) {
      const { handleResearchBearerMcp } = await import("./research-bearer-mcp");
      const { researchBearerDependencies } = await import("./research-bearer-server");
      return handleResearchBearerMcp(request, parsedBody, researchBearerDependencies);
    }
    const publicResult = key === "mcp" ? await publicMcpResponse(request, parsedBody) : undefined;
    if (publicResult?.terminal) return publicResult.response;
    const authorizationRequest = parsedBody ? new Request(request.url, { method: request.method, headers: request.headers, body: JSON.stringify(parsedBody) }) : request;
    let permission: Authorization;
    try { permission = await authorize(moduleId, "view", authorizationRequest); }
    catch (error) { if (publicResult) return publicResult.response; throw error; }
    if (!permission.ok) {
      if (publicResult) return publicResult.response;
      if (key === "mcp" && permission.response.status === 401) { const response = json({ jsonrpc: "2.0", id: parsedBody?.id ?? null, error: { code: -32001,
        message: "This tool requires an authenticated data scope. Connecting and loading Skills do not require ERP browser login.",
        data: { businessCode: "AUTHENTICATED_DATA_SCOPE_REQUIRED", authenticationRequired: true } } }, 401); response.headers.set("WWW-Authenticate", 'Bearer realm="lili-mcp", resource_metadata="' + new URL("/.well-known/oauth-protected-resource/api/lili/mcp", process.env.LILI_PUBLIC_ORIGIN || request.url).href + '"'); return response; }
      return permission.response;
    }
    if (!endpoint) return json({ ok: false, error: "not_found" }, 404);
    if (!endpoint.methods.includes(request.method)) return new Response(null, { status: 405, headers: { ...headers, Allow: endpoint.methods.join(", ") } });
    if (request.method !== "GET") {
      const origin = request.headers.get("origin");
      if (origin && origin !== new URL(request.url).origin) return json({ ok: false, error: "origin_mismatch" }, 403);
    }
    if (key === "health") return json({ ok: true, source: "shipped-definitions", businessExecutionReady: false, tools: listTools().length, skills: listSkills().length, workflows: listWorkflows().length });
    if (key === "tool-config" || key === "tool-config/test") {
      if (request.method !== "GET") {
        const editPermission = await authorize("settings", "edit", authorizationRequest);
        if (!editPermission.ok) return editPermission.response;
        if (!editPermission.user || editPermission.user.id !== permission.user?.id || editPermission.user.organizationId !== permission.user?.organizationId) return json({ message: "配置身份校验失败。" }, 403);
      }
      if (!permission.user) return json({ message: "配置身份校验失败。" }, 403);
      const { handleToolConfiguration } = await import("./tool-config-api");
      return handleToolConfiguration(request, key, parsedBody, permission.user, toolConfigDependencies);
    }
    if (key === "tool-config/mappings") return json({ tools: listTools().map(({ name, availability }) => ({ name, availability })), source: "host-catalog" });
    if (key === "codex-bundle") {
      const exportPermission = await authorize("agents", "export", authorizationRequest);
      if (!exportPermission.ok) return exportPermission.response;
      const { createSkillBundle } = await import("./skill-bundle");
      return new Response(await createSkillBundle(), { headers: { ...headers, "Content-Type": "application/zip", "Content-Disposition": 'attachment; filename="lili-skills.zip"' } });
    }
    if (key === "preferences") {
      const body = parsedBody ?? await boundedJson(request);
      if (body.locale !== "zh" && body.locale !== "en") return json({ ok: false, error: "invalid_locale" }, 400);
      const response = json({ ok: true, locale: body.locale });
      response.cookies.set("lili_locale", body.locale, { path: "/", httpOnly: true, sameSite: "lax", secure: new URL(request.url).protocol === "https:", maxAge: 31_536_000 });
      return response;
    }
    const requireReviewedMarketCall = (name: string) => {
      if (name.startsWith("sellersprite__") || name.startsWith("xiyou__")) throw new Error("RESEARCH_REQUEST_REQUIRES_HUMAN_REVIEW");
    };
    const getRuntime = async () => runtimeTools ?? (permission.user
      ? (await import("./runtime-server")).runtimeToolsForUser(permission.user, authorizationRequest, parsedBody)
      : createRuntimeTools([]));
    const discover = async () => {
      const registered = await (await getRuntime()).discover();
      return { ...registered, tools: [...registered.tools, ...publicResearchTools, ...researchMcpTools] };
    };
    if (key === "mcp" && request.method === "GET") return json({ source: "runtime-registry", scope: "authenticated-ERP-session", ...await discover() });
    if (key === "mcp" || key === "tools/run") {
      const body = parsedBody ?? await boundedJson(request);
      if (key === "tools/run") {
        if (typeof body.name !== "string") return json({ ok: false, error: "invalid_tool_name" }, 400);
        if (body.name.startsWith("sellersprite__") || body.name.startsWith("xiyou__")) return json({ ok: false, error: "RESEARCH_REQUEST_REQUIRES_HUMAN_REVIEW", nextPath: "/agents/selection-research" }, 409);
        const runtime = await getRuntime();
        const output = await runtime.call(body.name, (body.input ?? {}) as never, request.signal);
        return json({ ok: true, source: "runtime-adapter", result: output });
      }
      const id = body.id ?? null;
      if (body.method === "notifications/initialized") return new Response(null, { status: 202, headers });
      if (body.method === "initialize") return json({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", serverInfo: { name: "lili-mcp", version: "1.1.0" }, capabilities: { tools: {} } } });
      if (body.method === "tools/list") return json({ jsonrpc: "2.0", id, result: await discover() });
      if (body.method === "tools/call") {
        const params = body.params;
        if (!params || typeof params !== "object" || Array.isArray(params) || typeof (params as Record<string, unknown>).name !== "string") return json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid tool parameters" } }, 400);
        const args = params as Record<string, unknown>;
        try {
          if (researchMcpTools.some(tool => tool.name === args.name)) {
            const output = await callResearchMcpTool(authorizationRequest, args.name as string, (args.arguments ?? {}) as never);
            return json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(output) }], isError: !output.ok } });
          }
          requireReviewedMarketCall(args.name as string);
          const output = await (await getRuntime()).call(args.name as string, (args.arguments ?? {}) as never, request.signal);
          return json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(output) }], isError: false } });
        } catch (error) { return json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ error: error instanceof RuntimeToolError ? error.code : "RUNTIME_TOOL_UNAVAILABLE_OR_FORBIDDEN", message: "请检查真实 Schema、当前授权；外部市场请求请通过 research_start/research_step 执行，审批在 Codex 对话里确认。" }) }], isError: true } }); }
      }
      return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
    }
    const action: PermissionAction = request.method === "GET" ? "view" : key.startsWith("approvals/") ? "approve" : ["PUT", "PATCH", "DELETE"].includes(request.method) ? "edit" : "create";
    const mutationPermission = await authorize(moduleId, action, authorizationRequest);
    if (!mutationPermission.ok) return mutationPermission.response;
    return json({ ok: false, error: "lili_operation_not_mapped", nextPath: endpoint.nextPath,
      nextAction: { kind: "UNSUPPORTED_EXECUTOR", channel: "codex_chat", browserRequired: false }, message: "此步骤执行器尚未接入。请在对话中说明未执行部分并保留分析或草稿；无需返回浏览器。没有修改配置、创建业务记录、启动任务或调用外部服务。" }, 501);
  } catch (error) {
    // Never echo provider errors, credentials, raw bodies or connection strings.
    if (error instanceof RuntimeToolError) {
      const invalid = error.code === "INVALID_TOOL_ARGUMENTS";
      return json({ ok: false, error: error.code, message: invalid ? "参数不符合当前真实 Schema，请展开参数定义后修正。" : "工具不可用、权限不足或 Schema 已改变，请重新发现工具。" }, invalid ? 400 : error.code === "RUNTIME_TOOL_UNAVAILABLE_OR_FORBIDDEN" ? 403 : 409);
    }
    const invalid = error instanceof RequestFormatError || error instanceof SyntaxError;
    return json({ ok: false, error: invalid ? "invalid_request" : "lili_unavailable", message: invalid ? "请求格式无效，请检查参数后重试。" : "服务暂不可用，请稍后重试。" }, invalid ? 400 : 503);
  }
}
