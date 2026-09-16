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
