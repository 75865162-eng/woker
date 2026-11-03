export const sellerSpriteIntegrationProvider = "sellersprite-mcp";

export interface SellerSpriteMcpSettings {
  enabled: boolean;
  serverUrl: string;
  apiKey: string;
  marketplace: string;
  timeoutSeconds: number;
  protocolVersion: string;
}

export interface SellerSpriteMcpPublicSettings {
  enabled: boolean;
  serverUrl: string;
  hasApiKey: boolean;
  marketplace: string;
  timeoutSeconds: number;
  protocolVersion: string;
  configured: boolean;
}

export const defaultSellerSpriteMcpSettings: SellerSpriteMcpSettings = {
  enabled: false,
  serverUrl: "",
  apiKey: "",
  marketplace: "US",
  timeoutSeconds: 30,
  protocolVersion: "streamableHttp",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export function normalizeSellerSpriteMcpSettings(
  value: Partial<SellerSpriteMcpSettings> | null | undefined,
  fallback: SellerSpriteMcpSettings = defaultSellerSpriteMcpSettings,
): SellerSpriteMcpSettings {
  return {
    enabled: Boolean(value?.enabled ?? fallback.enabled),
    serverUrl: String(value?.serverUrl ?? fallback.serverUrl).trim().replace(/\/+$/, ""),
    apiKey: String(value?.apiKey ?? fallback.apiKey).trim(),
    marketplace: String((value?.marketplace ?? fallback.marketplace) || "US").trim().toUpperCase(),
    timeoutSeconds: Math.max(5, Math.min(180, Number(value?.timeoutSeconds ?? fallback.timeoutSeconds) || defaultSellerSpriteMcpSettings.timeoutSeconds)),
    protocolVersion: String((value?.protocolVersion ?? fallback.protocolVersion) || defaultSellerSpriteMcpSettings.protocolVersion).trim(),
  };
}

export function parseSellerSpriteMcpSettings(value: unknown): SellerSpriteMcpSettings {
  if (!isRecord(value)) return defaultSellerSpriteMcpSettings;

  return normalizeSellerSpriteMcpSettings(value as Partial<SellerSpriteMcpSettings>);
}

export function toPublicSellerSpriteMcpSettings(settings: SellerSpriteMcpSettings): SellerSpriteMcpPublicSettings {
  const serverUrl = settings.serverUrl.trim();
  const hasApiKey = Boolean(settings.apiKey.trim());

  return {
    enabled: settings.enabled,
    serverUrl,
    hasApiKey,
    marketplace: settings.marketplace,
    timeoutSeconds: settings.timeoutSeconds,
    protocolVersion: settings.protocolVersion,
    configured: settings.enabled && serverUrl.startsWith("http") && hasApiKey,
  };
}

export function mergeSellerSpriteMcpSettings(
  submitted: Partial<SellerSpriteMcpSettings>,
  existing: SellerSpriteMcpSettings = defaultSellerSpriteMcpSettings,
) {
  return normalizeSellerSpriteMcpSettings(
    {
      ...existing,
      ...submitted,
      apiKey: submitted.apiKey?.trim() ? submitted.apiKey : existing.apiKey,
    },
    existing,
  );
}

export function validateSellerSpriteMcpSettings(settings: SellerSpriteMcpSettings) {
  if (!settings.enabled) return null;
  if (!settings.serverUrl.startsWith("http://") && !settings.serverUrl.startsWith("https://")) {
    return "SellerSprite MCP Server URL 必须以 http:// 或 https:// 开头。";
  }
  if (!settings.apiKey.trim()) {
    return "SellerSprite MCP secret-key 不能为空。";
  }

  return null;
}

type McpEnvelope = { result?: unknown; error?: { message?: string; data?: unknown } };

const toolAliases: Record<string, string[]> = {
  "sellersprite.market.search": ["market_find_products", "market.search", "product_research"],
  "sellersprite.keyword.search": ["market_research_keyword", "market_mine_keywords", "keyword.search"],
  "sellersprite.category.analyze": ["market_scan_node", "market_find_node", "category.analyze"],
  "sellersprite.competitor.analyze": ["market_list_competitors", "competitor.analyze"],
  "sellersprite.review.analyze": ["market_get_reviews", "review.analyze"],
  "sellersprite.trend.analyze": ["market_aba_trend", "trend.analyze"],
  "sellersprite.price.analyze": ["finance_get_fee_estimate", "price.analyze"],
  "sellersprite.sales.analyze": ["market_find_products", "sales.analyze"],
  "sellersprite.competition.analyze": ["market_scan_node", "competition.analyze"],
};

export async function executeSellerSpriteMcpTool(
  settings: SellerSpriteMcpSettings,
  toolId: string,
  input: unknown,
  options: { signal?: AbortSignal } = {},
) {
  const validationError = validateSellerSpriteMcpSettings(settings);
  if (validationError) throw { code: "SELLERSPRITE_MCP_NOT_CONFIGURED", message: validationError, retryable: false };

  const baseHeaders = {
    Accept: "application/json, text/event-stream",
    "Content-Type": "application/json",
    Authorization: `Bearer ${settings.apiKey}`,
    "X-API-Key": settings.apiKey,
  };
  const protocolVersion = /^\d{4}-\d{2}-\d{2}$/.test(settings.protocolVersion) ? settings.protocolVersion : "2024-11-05";
  let id = 0;
  let sessionId: string | undefined;
  const call = async (method: string, params?: Record<string, unknown>, notification = false): Promise<unknown> => {
    const response = await fetch(settings.serverUrl, {
      method: "POST",
      headers: sessionId ? { ...baseHeaders, "Mcp-Session-Id": sessionId } : baseHeaders,
      body: JSON.stringify({ jsonrpc: "2.0", ...(notification ? {} : { id: ++id }), method, ...(params ? { params } : {}) }),
      signal: options.signal,
    });
    sessionId = response.headers.get("mcp-session-id") ?? sessionId;
    const body = await readMcpResponse(response);
    if (!response.ok) throw { code: "SELLERSPRITE_MCP_HTTP_ERROR", message: `SellerSprite MCP returned HTTP ${response.status}.`, retryable: response.status >= 500, detail: body };
    if (notification) return body;
    if (!isRecord(body)) throw { code: "SELLERSPRITE_MCP_INVALID_RESPONSE", message: `SellerSprite MCP ${method} returned an invalid response.`, retryable: false };
    const envelope = body as McpEnvelope;
    if (envelope.error) throw { code: "SELLERSPRITE_MCP_PROTOCOL_ERROR", message: envelope.error.message ?? `SellerSprite MCP ${method} failed.`, retryable: false, detail: envelope.error.data };
    return envelope.result;
  };

  await call("initialize", { protocolVersion, capabilities: {}, clientInfo: { name: "amazon-ad-bulk-operation", version: "0.1.0" } });
  await call("notifications/initialized", undefined, true);
  const listed = await call("tools/list", {}) as { tools?: unknown } | undefined;
  const tools = Array.isArray(listed?.tools) ? listed.tools.filter(isRecord) : [];
  const aliases = [toolId, toolId.replaceAll(".", "_"), ...(toolAliases[toolId] ?? [])].map(normalizeToolName);
  const tool = tools.find((item) => typeof item.name === "string" && aliases.includes(normalizeToolName(item.name)));
  if (!tool || typeof tool.name !== "string") throw { code: "SELLERSPRITE_MCP_TOOL_NOT_FOUND", message: `SellerSprite MCP does not expose a tool for ${toolId}.`, retryable: false, detail: { availableTools: tools.map((item) => item.name) } };
  const result = await call("tools/call", { name: tool.name, arguments: isRecord(input) ? input : {} });
  if (!isRecord(result) || result.isError === true) throw { code: "SELLERSPRITE_MCP_TOOL_ERROR", message: `SellerSprite MCP tool ${tool.name} returned an error.`, retryable: false, detail: result };
  const output = unwrapMcpResult(result);
  validateMcpOutput(toolId, input, output);
  return { toolName: tool.name, output, sessionId };
}

export async function testSellerSpriteMcpConnection(settings: SellerSpriteMcpSettings) {
  const validationError = validateSellerSpriteMcpSettings(settings);
  if (validationError) throw new Error(validationError);
  const result = await executeSellerSpriteMcpTool(settings, "sellersprite.keyword.search", { marketplace: settings.marketplace, keyword: "connection test" });
  return { toolName: result.toolName, sessionId: result.sessionId };
}

function normalizeToolName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function unwrapMcpResult(result: Record<string, unknown>): Record<string, unknown> {
  if (isRecord(result.structuredContent)) return result.structuredContent;
  const content = Array.isArray(result.content) ? result.content : [];
  for (const item of content) {
    if (!isRecord(item)) continue;
    if (isRecord(item.data)) return item.data;
    if (typeof item.text === "string") {
      try { const parsed = JSON.parse(item.text) as unknown; if (isRecord(parsed)) return parsed; } catch { /* continue */ }
    }
  }
  throw { code: "SELLERSPRITE_MCP_INVALID_RESPONSE", message: "SellerSprite MCP returned no structured JSON data.", retryable: false };
}

function validateMcpOutput(toolId: string, input: unknown, output: Record<string, unknown>) {
  const serialized = JSON.stringify(output);
  if (/\b(sandbox|fixture|synthetic|mock|simulat(?:e|ed|ion)|sample data|insulated kettle)\b/i.test(serialized)) throw { code: "SELLERSPRITE_MCP_SIMULATED_DATA", message: `SellerSprite MCP ${toolId} returned sample or simulated data.`, retryable: false };
  if (isRecord(input)) {
    for (const key of ["marketplace", "keyword", "category", "asin"]) {
      const expected = typeof input[key] === "string" ? input[key].trim().toLowerCase() : "";
      const actual = typeof output[key] === "string" ? output[key].trim().toLowerCase() : "";
      if (expected && actual && (key === "marketplace" ? expected !== actual : !actual.includes(expected) && !expected.includes(actual))) throw { code: "SELLERSPRITE_MCP_RESPONSE_MISMATCH", message: `SellerSprite MCP ${toolId} returned ${key}=${String(output[key])} for requested ${String(input[key])}.`, retryable: false };
    }
  }
}

async function readMcpResponse(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text.trim()) return null;
  if (response.headers.get("content-type")?.includes("text/event-stream")) {
    const event = text.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).filter(Boolean).at(-1);
    return event ? JSON.parse(event) as unknown : null;
  }
  try { return JSON.parse(text) as unknown; } catch { throw { code: "SELLERSPRITE_MCP_INVALID_RESPONSE", message: "SellerSprite MCP returned invalid JSON.", retryable: false }; }
}
