import { normalizeAiSettings, type AiModelSettings } from "@/lib/ai-settings";

export function resolveAiSettings(aiSettings?: Partial<AiModelSettings> | null): AiModelSettings {
  if (aiSettings?.apiKey?.trim()) {
    return normalizeAiSettings(aiSettings);
  }

  const envSettings = {
    apiKey:
      process.env.AIGOCODE_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      process.env.DEEPSEEK_API_KEY ||
      process.env.OPENAI_API_KEY ||
      "",
    baseUrl:
      process.env.AIGOCODE_BASE_URL ||
      process.env.OPENROUTER_BASE_URL ||
      process.env.DEEPSEEK_BASE_URL ||
      "https://api.deepseek.com",
    model:
      process.env.AIGOCODE_MODEL ||
      process.env.OPENROUTER_MODEL ||
      process.env.DEEPSEEK_MODEL ||
      "deepseek-v4-flash",
    wireApi: process.env.AIGOCODE_API_KEY ? "responses" : "chat_completions",
  } satisfies Partial<AiModelSettings>;

  return normalizeAiSettings({
    ...envSettings,
    ...aiSettings,
    apiKey: envSettings.apiKey,
    baseUrl: envSettings.baseUrl,
    model: envSettings.model,
    wireApi: envSettings.wireApi,
  });
}

export function buildAiTextEndpoint(settings: Pick<AiModelSettings, "baseUrl" | "wireApi">) {
  const baseUrl = settings.baseUrl.replace(/\/+$/, "");

  if (settings.wireApi === "chat_completions") {
    return `${baseUrl}/chat/completions`;
  }

  return `${baseUrl}${baseUrl.endsWith("/v1") ? "/responses" : "/v1/responses"}`;
}
