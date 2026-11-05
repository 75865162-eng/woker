import { boundedRequestText } from "@/lib/amazon-sync/request-body";
import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { auditAmazonMcpProtocol, amazonMcpTools, authenticateAmazonMcp, invokeAmazonMcp } from "@/lib/amazon-sync/mcp";
import { SyncInputError } from "@/lib/amazon-sync/policy";
export const runtime = "nodejs";
const json = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
function toolInputSchema(name: string) {
  const scopeProperties: Record<string, unknown> = {
    sellerAccountId: { type: "string" }, sellerAccountIds: { type: "array", items: { type: "string" }, maxItems: 200 },
    marketplaceId: { type: "string" },
  };
  if (["data_list_tables", "data_describe_table", "data_query", "data_sync_status", "data_sync_start"].includes(name)) {
    const properties = { ...scopeProperties };
    if (name === "data_describe_table") properties.table = { type: "string", maxLength: 100 };
    if (name === "data_query") {
      properties.table = { type: "string", maxLength: 100 };
      properties.page = { type: "integer", minimum: 1, maximum: 10000 };
      properties.pageSize = { type: "integer", minimum: 1, maximum: 1000, default: 100 };
        properties.filters = {
        type: "object", additionalProperties: false,
          properties: Object.fromEntries(["sellerSku", "asin", "condition", "listingStatus", "from", "to", "reportType", "adProduct", "campaignId", "adGroupId", "advertisedAsin", "searchTerm", "placement"].map(field => [field, { type: "string", maxLength: 200, ...(field === "from" || field === "to" ? { format: "date" } : {}) }])),
      };
    }
    if (name === "data_sync_start") {
      properties.resource = { type: "string", maxLength: 100 };
      properties.dateFrom = { type: "string", format: "date" };
      properties.dateTo = { type: "string", format: "date" };
    }
    const required = name === "data_describe_table" || name === "data_query" ? ["table"] : name === "data_sync_start" ? ["resource"] : [];
    return { type: "object", additionalProperties: false, properties, ...(required.length ? { required } : {}) };
  }
  const properties: Record<string, unknown> = {
    ...scopeProperties,
    from: { type: "string", format: "date" }, to: { type: "string", format: "date" },
    keyword: { type: "string", maxLength: 200 }, page: { type: "integer", minimum: 1, maximum: 10000 }, taskId: { type: "string" },
  };
  return { type: "object", additionalProperties: false, properties };
}
export async function POST(request: Request) {
  let id: unknown = null;
  try {
    if (request.headers.get("origin") && request.headers.get("origin") !== new URL(request.url).origin) throw new SyncInputError("Forbidden.", 403);
    if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "JSON required." }, 415);
    if (Number(request.headers.get("content-length")) > 64_000) return json({ error: "Request too large." }, 413);
    const identity = await authenticateAmazonMcp(request.headers.get("authorization"));
    const text = await boundedRequestText(request, 64000);
    if (Buffer.byteLength(text) > 64_000) return json({ error: "Request too large." }, 413);
    const input = JSON.parse(text) as Record<string, unknown>;
    if (!input || Array.isArray(input) || input.jsonrpc !== "2.0" || typeof input.method !== "string") return json({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid request." } }, 400);
    id = input.id ?? null;
    if (id !== null && typeof id !== "string" && typeof id !== "number") throw new SyncInputError("Invalid request.");
    const requestId = randomUUID();
    if (input.method !== "tools/call") await auditAmazonMcpProtocol(identity, input.method, requestId);
    if (input.method === "notifications/initialized" && input.id === undefined) return new Response(null, { status: 202, headers: { "Cache-Control": "no-store" } });
    const params = (input.params ?? {}) as Record<string, unknown>;
    let result: unknown;
    if (input.method === "initialize") {
      const version = params.protocolVersion;
      if (!["2024-11-05", "2025-03-26", "2025-06-18"].includes(String(version))) throw new SyncInputError("Unsupported protocol version.");
      result = { protocolVersion: version, capabilities: { tools: {} }, serverInfo: { name: "erp-amazon", version: "1.0.0" } };
    } else if (input.method === "ping") result = {};
    else if (input.method === "tools/list") result = { tools: amazonMcpTools.filter(([name]) => identity.tools.includes(name)).map(([name, description]) => ({ name, description, inputSchema: toolInputSchema(name), annotations: { readOnlyHint: name !== "data_sync_start", destructiveHint: false } })) };
    else if (input.method === "tools/call") {
      const output = await invokeAmazonMcp(identity, typeof params.name === "string" ? params.name : "", params.arguments ?? {}, requestId);
      result = { content: [{ type: "text", text: JSON.stringify(output) }], isError: false };
    } else return json({ jsonrpc: "2.0", id, error: { code: -32601, message: "Method not found." } });
    return json({ jsonrpc: "2.0", id, result });
  } catch (error) {
    const status = error instanceof SyncInputError ? error.status : error instanceof SyntaxError ? 400 : 500;
    const documentedCode = error instanceof SyncInputError ? error.message.match(/^(TABLE_NOT_ALLOWED|FIELD_NOT_MAPPED|SCHEMA_UNVERIFIED):/)?.[1] : undefined;
    if (error instanceof SyncInputError && documentedCode) return json({ jsonrpc: "2.0", id, error: { code: documentedCode, message: error.message } }, status);
    return json({ jsonrpc: "2.0", id, error: { code: status === 401 ? -32001 : status === 403 ? -32003 : -32603, message: status === 401 ? "认证失败。" : status === 403 ? "数据范围不可访问。" : status === 400 ? "参数无效。" : "请求失败。" } }, status);
  }
}
export function GET() { return new Response(null, { status: 405, headers: { Allow: "POST", "Cache-Control": "no-store" } }); }
