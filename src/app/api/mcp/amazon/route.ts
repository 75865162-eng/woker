import { boundedRequestText } from "@/lib/amazon-sync/request-body";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { auditAmazonMcpProtocol, listDiscoverableAmazonMcpTools, authenticateAmazonMcp, invokeAmazonMcp } from "@/lib/amazon-sync/mcp";
import { SyncInputError } from "@/lib/amazon-sync/policy";
import { McpDatasetError } from "@/lib/amazon-sync/mcp-datasets";
import { amazonMcpToolDefinitions } from "@/lib/amazon-sync/mcp-tool-registry";
import { GatewayInvocationError } from "@/lib/agent-platform/tool-gateway";
export const runtime = "nodejs";
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
export async function POST(request: Request) {
  let id: unknown = null;
  const requestId = randomUUID();
  let toolVersion: string | null = null;
  try {
    if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) throw new SyncInputError("Forbidden.", 403);
    if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "JSON required." }, 415);
    if (Number(request.headers.get("content-length")) > 64_000) return json({ error: "Request too large." }, 413);
    const identity = await authenticateAmazonMcp(request.headers.get("authorization"), new URL(request.url).origin + "/api/mcp/amazon");
    const text = await boundedRequestText(request, 64000);
    if (Buffer.byteLength(text) > 64_000) return json({ error: "Request too large." }, 413);
    const input = JSON.parse(text) as Record<string, unknown>;
    if (!input || Array.isArray(input) || input.jsonrpc !== "2.0" || typeof input.method !== "string") return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request." } }, 400);
    id = input.id ?? null;
    if (id !== null && typeof id !== "string" && typeof id !== "number") throw new SyncInputError("Invalid request.");
    if (input.method !== "tools/call") await auditAmazonMcpProtocol(identity, input.method, requestId);
    if (input.method === "notifications/initialized" && input.id === undefined) return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
    const params = (input.params ?? {}) as Record<string, unknown>;
    if (input.method === "tools/call") toolVersion = amazonMcpToolDefinitions.find(tool => tool.name === params.name)?.version ?? null;
    let result: unknown;
    if (input.method === "initialize") {
      const version = params.protocolVersion;
      if (!["2024-11-05", "2025-03-26", "2025-06-18"].includes(String(version))) throw new SyncInputError("Unsupported protocol version.");
      result = { protocolVersion: version, capabilities: { tools: {} }, serverInfo: { name: "erp-amazon", version: "1.0.0" } };
    } else if (input.method === "ping") result = {};
    else if (input.method === "tools/list") result = { tools: await listDiscoverableAmazonMcpTools(identity, request.headers.get("mcp-protocol-version")) };
    else if (input.method === "tools/call") {
      const output = await invokeAmazonMcp(identity, typeof params.name === "string" ? params.name : "", params.arguments ?? {}, requestId, request.signal);
      result = { content: [{ type: "text", text: JSON.stringify(output) }], isError: false, ...(request.headers.get("mcp-protocol-version") === "2025-06-18" && output && typeof output === "object" && !Array.isArray(output) ? { structuredContent: output } : {}) };
    } else return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found." } });
    return json({ jsonrpc: "2.0", id, result });
  } catch (error) {
    const status = error instanceof SyncInputError ? error.status : error instanceof SyntaxError ? 400
      : error instanceof GatewayInvocationError ? error.code === "INVALID_INPUT" ? 400 : error.code === "TIMEOUT" ? 504 : error.code === "CANCELLED" ? 408 : 500 : 500;
    const documentedCode = error instanceof SyncInputError ? error.message.match(/^(TABLE_NOT_ALLOWED|FIELD_NOT_MAPPED|SCHEMA_UNVERIFIED):/)?.[1] : undefined;
    const businessCode = error instanceof McpDatasetError ? error.businessCode : error instanceof GatewayInvocationError ? error.code : documentedCode ?? (status === 401 ? "UNAUTHENTICATED" : status === 403 ? "FORBIDDEN" : status === 400 ? "INVALID_ARGUMENT" : "INTERNAL_FAILURE");
    const data = { requestId, toolVersion, businessCode, ...(businessCode === "DATASET_UNPUBLISHED" ? { dataAvailability: "NO_PUBLISHED_SOURCE" } : {}) };
    if (error instanceof SyncInputError && documentedCode) return json({ jsonrpc: "2.0", id, error: { code: documentedCode, message: error.message, data } }, status);
    const message = error instanceof GatewayInvocationError ? error.message : status === 401 ? "认证失败。" : status === 403 ? "数据范围不可访问。" : status === 400 ? "参数无效。" : "请求失败。";
    const code = error instanceof GatewayInvocationError && error.code === "INVALID_INPUT" ? -32602 : status === 401 ? -32001 : status === 403 ? -32003 : error instanceof McpDatasetError ? -32602 : -32603;
    return json({ jsonrpc: "2.0", id, error: { code, message, data } }, status);
  }
}
export function GET() { return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } }); }
