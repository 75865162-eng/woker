import { NextResponse } from "next/server";
import type { PermissionAction } from "@/lib/accounts/permissions";
import { listSkills, listTools, listWorkflows } from "./catalog";
import { runCatalogTool } from "./tool-execution";
import type { ToolConfigDependencies } from "./tool-config-api";

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

/** Both namespaces share host authorization. Catalog execution has no business fallback; settings use a separate scoped service. */
export async function handleLiliRequest(request: Request, parts: string[], authorize: LiliAuthorize = defaultAuthorize, toolConfigDependencies?: ToolConfigDependencies): Promise<Response> {
  try {
    const key = endpointKey(parts);
    const endpoint = Object.hasOwn(endpoints, key) ? endpoints[key] : undefined;
    const moduleId = endpoint?.moduleId ?? "agents";
    // The shared permission helper inspects workspaceId in JSON bodies. Bound that
    // body first so its clone cannot read an unlimited payload before our parser.
    const parsedBody = request.method !== "GET" && request.headers.get("content-type")?.includes("application/json")
      ? await boundedJson(request) : undefined;
    const authorizationRequest = parsedBody ? new Request(request.url, { method: request.method, headers: request.headers, body: JSON.stringify(parsedBody) }) : request;
    const permission = await authorize(moduleId, "view", authorizationRequest);
    if (!permission.ok) return permission.response;
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
    if (key === "mcp" && request.method === "GET") return json({ source: "shipped-definitions", scope: "authenticated-ERP-session", businessExecutionReady: false, tools: listTools().map(({ name, description, inputSchema, availability }) => ({ name, description, inputSchema, availability })) });
    if (key === "mcp" || key === "tools/run") {
      const body = parsedBody ?? await boundedJson(request);
      if (key === "tools/run") {
        if (typeof body.name !== "string") return json({ ok: false, error: "invalid_tool_name" }, 400);
        const result = await runCatalogTool(body.name, body.input ?? {});
        return json(result.body, result.status);
      }
      const id = body.id ?? null;
      if (body.method === "notifications/initialized") return new Response(null, { status: 202, headers });
      if (body.method === "initialize") return json({ jsonrpc: "2.0", id, result: { protocolVersion: "2025-06-18", serverInfo: { name: "lili-catalog", version: "1.0.0" }, capabilities: { tools: {} } } });
      if (body.method === "tools/list") return json({ jsonrpc: "2.0", id, result: { tools: listTools().map(({ name, description, inputSchema, availability, readOnly }) => ({ name, description: `${description}\n[ERP: ${availability === "catalog" ? "static catalog only" : "adapter not mapped"}]`, inputSchema, annotations: { readOnlyHint: readOnly } })) } });
      if (body.method === "tools/call") {
        const params = body.params;
        if (!params || typeof params !== "object" || Array.isArray(params) || typeof (params as Record<string, unknown>).name !== "string") return json({ jsonrpc: "2.0", id, error: { code: -32602, message: "Invalid tool parameters" } }, 400);
        const args = params as Record<string, unknown>;
        const result = await runCatalogTool(args.name as string, args.arguments ?? {});
        return json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result.body) }], isError: result.status >= 400 } });
      }
      return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found" } });
    }
    const action: PermissionAction = request.method === "GET" ? "view" : key.startsWith("approvals/") ? "approve" : ["PUT", "PATCH", "DELETE"].includes(request.method) ? "edit" : "create";
    const mutationPermission = await authorize(moduleId, action, authorizationRequest);
    if (!mutationPermission.ok) return mutationPermission.response;
    return json({ ok: false, error: "lili_operation_not_mapped", nextPath: endpoint.nextPath,
      message: "此独立 Lili 操作未映射；请使用主系统对应入口。没有修改配置、创建业务记录、启动任务或调用外部服务。" }, 501);
  } catch (error) {
    // Never echo provider errors, credentials, raw bodies or connection strings.
    const invalid = error instanceof RequestFormatError || error instanceof SyntaxError;
    return json({ ok: false, error: invalid ? "invalid_request" : "lili_unavailable", message: invalid ? "请求格式无效，请检查参数后重试。" : "服务暂不可用，请稍后重试。" }, invalid ? 400 : 503);
  }
}
