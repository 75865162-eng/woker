import { normalizeAiSettings, type AiModelSettings } from "@/lib/ai-settings";

type AiSettingsPurpose = "text" | "image";

function resolveEnvAiSettings(purpose: AiSettingsPurpose) {
  if (purpose === "image") {
    return {
      apiKey:
        process.env.TOGOAPI_IMAGE_API_KEY ||
        process.env.TOGOAPI_API_KEY ||
        process.env.AIGOCODE_API_KEY ||
        process.env.OPENROUTER_API_KEY ||
        process.env.DEEPSEEK_API_KEY ||
        process.env.OPENAI_API_KEY ||
        "",
      baseUrl:
        process.env.TOGOAPI_IMAGE_BASE_URL ||
        process.env.TOGOAPI_BASE_URL ||
        process.env.AIGOCODE_BASE_URL ||
        process.env.OPENROUTER_BASE_URL ||
        process.env.DEEPSEEK_BASE_URL ||
        "https://api.deepseek.com",
      model:
        process.env.TOGOAPI_IMAGE_MODEL ||
        process.env.TOGOAPI_MODEL ||
        process.env.AIGOCODE_MODEL ||
        process.env.OPENROUTER_MODEL ||
        process.env.DEEPSEEK_MODEL ||
        "deepseek-v4-flash",
      wireApi:
        (process.env.TOGOAPI_IMAGE_WIRE_API as AiModelSettings["wireApi"] | undefined) ||
        (process.env.TOGOAPI_IMAGE_API_KEY || process.env.TOGOAPI_API_KEY || process.env.AIGOCODE_API_KEY ? "responses" : "chat_completions"),
    } satisfies Partial<AiModelSettings>;
  }

  return {
    apiKey:
      process.env.TOGOAPI_API_KEY ||
      process.env.AIGOCODE_API_KEY ||
      process.env.OPENROUTER_API_KEY ||
      process.env.DEEPSEEK_API_KEY ||
      process.env.OPENAI_API_KEY ||
      "",
    baseUrl:
      process.env.TOGOAPI_BASE_URL ||
      process.env.AIGOCODE_BASE_URL ||
      process.env.OPENROUTER_BASE_URL ||
      process.env.DEEPSEEK_BASE_URL ||
      "https://api.deepseek.com",
    model:
      process.env.TOGOAPI_MODEL ||
      process.env.AIGOCODE_MODEL ||
      process.env.OPENROUTER_MODEL ||
      process.env.DEEPSEEK_MODEL ||
      "deepseek-v4-flash",
    wireApi:
      (process.env.TOGOAPI_WIRE_API as AiModelSettings["wireApi"] | undefined) ||
      (process.env.TOGOAPI_API_KEY || process.env.AIGOCODE_API_KEY ? "responses" : "chat_completions"),
  } satisfies Partial<AiModelSettings>;
}

export function resolveAiSettings(aiSettings?: Partial<AiModelSettings> | null, purpose: AiSettingsPurpose = "text"): AiModelSettings {
  if (aiSettings?.apiKey?.trim()) {
    return normalizeAiSettings(aiSettings);
  }

  const envSettings = resolveEnvAiSettings(purpose);

  return normalizeAiSettings({
    ...envSettings,
    ...aiSettings,
  });
}

export function buildAiTextEndpoint(settings: Pick<AiModelSettings, "baseUrl" | "wireApi">) {
  const baseUrl = settings.baseUrl.replace(/\/+$/, "");

  if (settings.wireApi === "chat_completions") {
    return `${baseUrl}/chat/completions`;
  }

  return `${baseUrl}${baseUrl.endsWith("/v1") ? "/responses" : "/v1/responses"}`;
}
