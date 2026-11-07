import { skillMetaTools, liliInstructions, liliVersion } from "./skill-manifest";
import { NextResponse } from "next/server";
import { createRuntimeTools } from "./runtime-tools";
import { researchMcpTools } from "./research-tools";
import { publicResearchTools, callPublicResearchTool } from "./public-research-tools";

const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers });
const skillNames = new Set(["meta_search_skills", "meta_load_skill", "meta_list_workflows", ...skillMetaTools.map(tool => tool.name)]);

/** Public definitions only. No user settings, credentials, saved tasks or supplier adapters. */
export async function publicMcpResponse(request: Request, body?: Record<string, unknown>): Promise<{ response: Response; terminal: boolean } | undefined> {
  const skills = createRuntimeTools([]);
  const catalog = async () => ({ scope: "anonymous-definitions", source: "public-skill-catalog", providers: [], tools: [
    ...(await skills.discover()).tools,
    ...publicResearchTools,
    ...researchMcpTools.map(tool => ({ ...tool, description: `${tool.description} Business data and persisted research require authenticated organization/workspace/owner scope; no ERP browser login is required to connect or load Skills.` })),
  ] });
  if (request.method === "GET") return { response: json(await catalog()), terminal: false };
  if (request.method !== "POST") return undefined;
  const id = typeof body?.id === "string" || typeof body?.id === "number" ? body.id : null;
  const error = () => ({ response: json({ jsonrpc: "2.0", id, error: { code: -32600, message: "Invalid request." } }, 400), terminal: false });
  if (!body || body.jsonrpc !== "2.0" || typeof body.method !== "string" || body.id !== undefined && body.id !== null && typeof body.id !== "string" && typeof body.id !== "number") return error();
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return { response: json({ error: "origin_mismatch" }, 403), terminal: true };
  const params = body.params ?? {};
  if (!params || typeof params !== "object" || Array.isArray(params)) return error();
  const args = params as Record<string, unknown>;
  if (body.method === "initialize") {
    const requested = args.protocolVersion;
    const protocolVersion = ["2024-11-05", "2025-03-26", "2025-06-18"].includes(String(requested)) ? requested : "2025-06-18";
    return { response: json({ jsonrpc: "2.0", id, result: { protocolVersion, serverInfo: { name: "lili-mcp", version: liliVersion }, capabilities: { tools: {} }, instructions: liliInstructions } }), terminal: true };
  }
  if (body.method === "ping") return { response: json({ jsonrpc: "2.0", id, result: {} }), terminal: true };
  if (body.method === "notifications/initialized" && body.id === undefined) return { response: new Response(null, { status: 202, headers }), terminal: true };
  if (body.method === "tools/list") return { response: json({ jsonrpc: "2.0", id, result: await catalog() }), terminal: false };
  if (body.method === "tools/call" && typeof args.name === "string" && (skillNames.has(args.name) || publicResearchTools.some(tool => tool.name === args.name))) {
    try {
      const result = publicResearchTools.some(tool => tool.name === args.name)
        ? await callPublicResearchTool(args.name, (args.arguments ?? {}) as never)
        : await skills.call(args.name, (args.arguments ?? {}) as never, request.signal);
      return { response: json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify(result) }], isError: false } }), terminal: true };
    } catch {
      return { response: json({ jsonrpc: "2.0", id, result: { content: [{ type: "text", text: JSON.stringify({ error: "INVALID_PUBLIC_SKILL_ARGUMENTS" }) }], isError: true } }), terminal: true };
    }
  }
  return undefined;
}
