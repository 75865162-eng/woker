/**
 * Sellfox MCP Server (Streamable HTTP transport) — canonical endpoint.
 *
 * Provider binding: only `sfmcp_` credentials are accepted here. An Amazon
 * `amcp_` token is rejected before any credential lookup and audited as
 * `sellfox.mcp.isolation.denied`.
 */
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { McpIsolationError, mcpProviderPolicies } from "@/lib/mcp/isolation";
import { auditSellfoxMcpProtocol, authenticateSellfoxMcp, invokeSellfoxMcp } from "@/lib/sellfox/mcp";
import { sellfoxDiscoverableTools, sellfoxMcpToolNames } from "@/lib/sellfox/mcp-tool-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY = 64_000;
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
const rpcError = (id: unknown, code: number, message: string, data?: unknown) => ({ jsonrpc: "2.0", id, error: { code, message, ...(data ? { data } : {}) } });

export async function POST(request: Request) {
  const requestId = randomUUID();
  let id: unknown = null;
  try {
    if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) return json({ error: "Forbidden." }, 403);
    if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "JSON required." }, 415);
    if (Number(request.headers.get("content-length")) > MAX_BODY) return json({ error: "Request too large." }, 413);
    const identity = await authenticateSellfoxMcp(request.headers.get("authorization"), new URL(request.url).origin + mcpProviderPolicies.sellfox.audiencePath);
    const text = await request.text();
    if (Buffer.byteLength(text) > MAX_BODY) return json({ error: "Request too large." }, 413);
    const input = JSON.parse(text) as Record<string, unknown>;
    if (!input || Array.isArray(input) || input.jsonrpc !== "2.0" || typeof input.method !== "string") return json(rpcError(null, -32600, "Invalid request."), 400);
    id = input.id ?? null;
    const method = input.method;
    if (method !== "tools/call") await auditSellfoxMcpProtocol(identity, method, requestId);
    if (method === "notifications/initialized" && input.id === undefined) return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
    const params = (input.params ?? {}) as Record<string, unknown>;
    if (method === "initialize") {
      const version = params.protocolVersion;
      if (!["2024-11-05", "2025-03-26", "2025-06-18"].includes(String(version))) throw new McpIsolationError("Unsupported protocol version.", "TOOL_NOT_ALLOWED", 400, "sellfox");
      return json({ jsonrpc: "2.0", id, result: {
        protocolVersion: version, capabilities: { tools: {} },
        serverInfo: { name: mcpProviderPolicies.sellfox.serverName, version: "2.0.0" },
        _meta: { provider: "sellfox", isolation: "provider-bound; store-scoped; read-only" },
      } });
    }
    if (method === "ping") return json({ jsonrpc: "2.0", id, result: {} });
    if (method === "tools/list") {
      const tools = sellfoxDiscoverableTools(identity.tools).map(tool => ({
        name: tool.name, description: tool.description, inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        _meta: { "erp/provider": "sellfox", "erp/toolVersion": tool.version, "erp/operationMode": tool.operationMode },
      }));
      return json({ jsonrpc: "2.0", id, result: { tools } });
    }
    if (method === "tools/call") {
      const name = typeof params.name === "string" ? params.name : "";
      if (!name) return json(rpcError(id, -32602, "工具名称为空。", { provider: "sellfox", requestId }), 400);
      const output = await invokeSellfoxMcp(identity, name, params.arguments ?? {}, requestId);
      const structured = output && typeof output === "object" && !Array.isArray(output);
      return json({ jsonrpc: "2.0", id, result: {
        content: [{ type: "text", text: JSON.stringify(output) }], isError: false,
        ...(request.headers.get("mcp-protocol-version") === "2025-06-18" && structured ? { structuredContent: output } : {}),
      } });
    }
    return json(rpcError(id, -32601, "Method not found."));
  } catch (error) {
    const isolation = error instanceof McpIsolationError ? error : null;
    const status = isolation?.status ?? (error instanceof SyntaxError ? 400 : 500);
    const businessCode = isolation?.code ?? (status === 400 ? "INVALID_ARGUMENT" : "INTERNAL_FAILURE");
    const message = status === 401 ? "认证失败。" : status === 403 ? "数据范围不可访问。" : status === 400 ? "参数无效。" : status === 503 ? "服务未就绪。" : "请求失败。";
    const code = status === 401 ? -32001 : status === 403 ? -32003 : status === 400 ? -32602 : -32603;
    return json(rpcError(id, code, message, { requestId, provider: "sellfox", businessCode }), status);
  }
}

export async function GET(request: Request) {
  const base = { server: mcpProviderPolicies.sellfox.serverName, transport: "streamable-http", endpoint: mcpProviderPolicies.sellfox.audiencePath, provider: "sellfox", tokenPrefix: mcpProviderPolicies.sellfox.tokenPrefix };
  try {
    const identity = await authenticateSellfoxMcp(request.headers.get("authorization"), new URL(request.url).origin + mcpProviderPolicies.sellfox.audiencePath);
    return json({ ...base, tools: sellfoxDiscoverableTools(identity.tools).map(tool => tool.name), catalogSize: sellfoxMcpToolNames.length, storeScope: identity.storeScope.includes("*") ? "ALL" : `${identity.storeScope.length} stores` });
  } catch {
    return json({ ...base, tools: [], authenticated: false });
  }
}

export function OPTIONS() {
  return new Response(null, { status: 204, headers: { Allow: "GET, POST, OPTIONS", "Cache-Control": "no-store" } });
}
