import { randomUUID } from "node:crypto";
import type { Json, ObjectJson, ToolDefinition, Transport } from "./types";

type Fetch = typeof fetch;
function object(value: unknown): value is ObjectJson { return !!value && typeof value === "object" && !Array.isArray(value); }
/** Parse matching JSON-RPC response, including multiline SSE events. */
export function parseRpc(text: string, id: string): ObjectJson {
  const candidates = [text, ...text.split(/\r?\n\r?\n/).map((event) => event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n"))];
  for (const candidate of candidates) {
    try {
      const value: unknown = JSON.parse(candidate);
      if (object(value) && value.jsonrpc === "2.0" && value.id === id) return value;
    } catch { /* Skip keepalives/unrelated events. */ }
  }
  throw new Error("LILI_MATCHING_RPC_RESPONSE_MISSING");
}
/** Client for the existing Lili /api/mcp contract; this does not install or modify an MCP service. */
export function createLiliTransport(config: { endpoint: string; authorization?: string; fetch?: Fetch; timeoutMs?: number }): Transport {
  const url = new URL(config.endpoint);
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("UNSAFE_LILI_ENDPOINT");
  const fetcher = config.fetch ?? fetch;
  let session: string | undefined;
  let protocol: string | undefined;
  let initialized = false;
  async function request(method: string, params: ObjectJson, signal?: AbortSignal, notification = false) {
    const id = randomUUID();
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json, text/event-stream" };
    if (config.authorization) headers.authorization = config.authorization;
    if (session) headers["mcp-session-id"] = session;
    if (protocol) headers["mcp-protocol-version"] = protocol;
    const response = await fetcher(url, { method: "POST", redirect: "error", headers, cache: "no-store", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs ?? 30_000)]) : AbortSignal.timeout(config.timeoutMs ?? 30_000), body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id }), method, params }) });
    if (!response.ok) { await response.body?.cancel(); throw new Error(`LILI_HTTP_${response.status}`); }
    if (method === "initialize") session = response.headers.get("mcp-session-id") ?? undefined;
    if (notification) { await response.body?.cancel(); return {}; }
    // Streamable HTTP may keep SSE open after the matching event. Stop at that event.
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    const secret = config.authorization?.replace(/^Bearer\s+/i, "");
    let size = 0, text = "";
    const isSse = response.headers.get("content-type")?.includes("text/event-stream");
    const parse = () => {
      if (secret && text.includes(secret)) throw new Error("LILI_SECRET_ECHO_REJECTED");
      return parseRpc(text, id);
    };
    if (reader) {
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.byteLength;
          if (size > 8_000_000) throw new Error("LILI_RESPONSE_TOO_LARGE");
          text += decoder.decode(part.value, { stream: true });
          if (secret && text.includes(secret)) throw new Error("LILI_SECRET_ECHO_REJECTED");
          if (isSse && /\r?\n\r?\n/.test(text)) {
            try { return parse(); } catch (error) { if (!(error instanceof Error) || error.message !== "LILI_MATCHING_RPC_RESPONSE_MISSING") throw error; }
          }
        }
        text += decoder.decode();
      } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
    }
    return parse();
  }

  async function initialize() {
    if (initialized) return;
    const envelope = await request("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "erp-selection-research", version: "1" } });
    if (envelope.error || !object(envelope.result) || !["2024-11-05", "2025-03-26", "2025-06-18"].includes(String(envelope.result.protocolVersion))) throw new Error("LILI_INITIALIZE_FAILED");
    protocol = String(envelope.result.protocolVersion);
    await request("notifications/initialized", {}, undefined, true);
    initialized = true;
  }
  return {
    async listTools() {
      await initialize();
      const tools: ToolDefinition[] = [];
      const cursors = new Set<string>();
      let cursor: string | undefined;
      do {
        const envelope = await request("tools/list", cursor ? { cursor } : {});
        if (envelope.error || !object(envelope.result) || !Array.isArray(envelope.result.tools)) throw new Error("LILI_REGISTRY_UNAVAILABLE");
        for (const value of envelope.result.tools) {
          if (!object(value) || typeof value.name !== "string" || !object(value.inputSchema)) throw new Error("LILI_INVALID_TOOL_DEFINITION");
          if (tools.some(tool => tool.name === value.name) || tools.length >= 1000) throw new Error("LILI_INVALID_TOOL_DEFINITION");
          tools.push(value as unknown as ToolDefinition);
        }
        const next = envelope.result.nextCursor;
        cursor = typeof next === "string" && next ? next : undefined;
        if (cursor) { if (cursors.has(cursor) || cursors.size > 100) throw new Error("LILI_REGISTRY_CURSOR_LOOP"); cursors.add(cursor); }
      } while (cursor);
      return tools;
    },
    async callTool(name, args, signal): Promise<Json> {
      await initialize();
      // Preserve matching full JSON-RPC envelope, not just AI-normalized content.
      return request("tools/call", { name, arguments: args }, signal);
    },
  };
}
