/** Public form contract only. Credentials are never returned by the configuration API. */
export const xiyouProvider = "xiyou_mcp";
export const xiyouEndpoint = "https://mcp.xydc.com/mcp";
export type XiyouSettings = {
  enabled: boolean;
  mcpUrl: string;
  mcpToken: string;
  openapiBase: string;
  clientId: string;
  clientSecret: string;
};
export type XiyouPublicSettings = Omit<XiyouSettings, "mcpToken" | "clientSecret"> & {
  hasMcpToken: boolean;
  hasClientSecret: boolean;
  configured: boolean;
};
export const defaultXiyouSettings: XiyouSettings = {
  enabled: false, mcpUrl: xiyouEndpoint, mcpToken: "",
  openapiBase: "https://openapi.xiyouzhaoci.com", clientId: "", clientSecret: "",
};

export class ToolConfigInputError extends Error {}

export function mergeXiyouSettings(input: unknown, existing: XiyouSettings = defaultXiyouSettings): XiyouSettings {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ToolConfigInputError("配置必须是对象。");
  const patch = input as Record<string, unknown>;
  const next = { ...existing };
  for (const [field, value] of Object.entries(patch)) {
    if (!Object.hasOwn(defaultXiyouSettings, field)) throw new ToolConfigInputError("配置包含未知字段。");
    if (field === "enabled") {
      if (typeof value !== "boolean") throw new ToolConfigInputError("启用状态无效。");
      next.enabled = value;
      continue;
    }
    if (typeof value !== "string" || value.length > 8192) throw new ToolConfigInputError("配置字段格式或长度无效。");
    const key = field as Exclude<keyof XiyouSettings, "enabled">;
    const text = value.trim();
    if (["mcpToken", "clientSecret"].includes(key) && !text) continue;
    if (/[\r\n\u0000]/.test(text)) throw new ToolConfigInputError("配置字段不能包含换行或控制字符。");
    next[key] = text;
  }
  if (next.mcpUrl !== xiyouEndpoint) throw new ToolConfigInputError("西柚 MCP 地址须为 https://mcp.xydc.com/mcp，Token 请单独填写。");
  if (next.openapiBase !== defaultXiyouSettings.openapiBase) throw new ToolConfigInputError("西柚 OpenAPI 根地址无效。");
  if (next.mcpToken && (/^Bearer\s/i.test(next.mcpToken) || /YOUR_MCP_TOKEN|__keep__|[•●]/i.test(next.mcpToken))) throw new ToolConfigInputError("请填写 MCP Token 原文，不含 Bearer 前缀或占位符。");
  if (next.enabled && !next.mcpToken) throw new ToolConfigInputError("启用西柚 MCP 前请填写 Token。");
  return next;
}

export function publicXiyouSettings(settings: XiyouSettings): XiyouPublicSettings {
  const { mcpToken, clientSecret, ...safe } = settings;
  return { ...safe, hasMcpToken: Boolean(mcpToken), hasClientSecret: Boolean(clientSecret), configured: Boolean(mcpToken) };
}
