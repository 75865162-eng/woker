export type AiProviderPreset = "deepseek" | "openrouter" | "openai" | "gemini" | "zhipu" | "kimi" | "qwen" | "aigocode" | "volcengine" | "custom";
export type AiWireApi = "chat_completions" | "responses" | "image_generations";

export interface AiModelSettings {
  enabled: boolean;
  provider: AiProviderPreset;
  apiKey: string;
  baseUrl: string;
  model: string;
  wireApi: AiWireApi;
  timeoutSeconds: number;
}

export interface AiModelSettingsPublic {
  enabled: boolean;
  provider: AiProviderPreset;
  hasApiKey: boolean;
  baseUrl: string;
  model: string;
  wireApi: AiWireApi;
  timeoutSeconds: number;
}

export interface SavedAiModelProfile {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: AiModelSettings;
}

export const aiSettingsStorageKey = "amazon-ad-ai-model-settings";
export const aiSettingsProfilesStorageKey = "amazon-ad-ai-model-setting-profiles";

export interface AiProviderOption {
  id: AiProviderPreset;
  label: string;
  shortLabel: string;
  accentClass: string;
  baseUrl: string;
  model: string;
  wireApi: AiWireApi;
  apiKey?: string;
  recommended?: boolean;
}

export const aiProviderOptions: AiProviderOption[] = [
  {
    id: "deepseek",
    label: "DeepSeek",
    shortLabel: "DS",
    accentClass: "bg-blue-50 text-blue-700",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-v4-flash",
    wireApi: "chat_completions",
    recommended: true,
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    shortLabel: "OR",
    accentClass: "bg-slate-50 text-slate-700",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o",
    wireApi: "chat_completions",
  },
  {
    id: "openai",
    label: "ChatGPT / OpenAI",
    shortLabel: "AI",
    accentClass: "bg-emerald-50 text-emerald-700",
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4.1-mini",
    wireApi: "chat_completions",
  },
  {
    id: "gemini",
    label: "Gemini",
    shortLabel: "G",
    accentClass: "bg-indigo-50 text-indigo-700",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    model: "gemini-2.5-flash",
    wireApi: "chat_completions",
  },
  {
    id: "zhipu",
    label: "智普 GLM",
    shortLabel: "智",
    accentClass: "bg-cyan-50 text-cyan-700",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4.5-flash",
    wireApi: "chat_completions",
  },
  {
    id: "kimi",
    label: "Kimi",
    shortLabel: "K",
    accentClass: "bg-violet-50 text-violet-700",
    baseUrl: "https://api.moonshot.ai/v1",
    model: "kimi-k2.6",
    wireApi: "chat_completions",
  },
  {
    id: "qwen",
    label: "千问 Qwen",
    shortLabel: "Q",
    accentClass: "bg-amber-50 text-amber-700",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-plus",
    wireApi: "chat_completions",
  },
  {
    id: "aigocode",
    label: "AIGOCODE",
    shortLabel: "AG",
    accentClass: "bg-orange-50 text-orange-700",
    baseUrl: "https://api.aigocode.app/v1",
    model: "gpt-5.4",
    wireApi: "responses",
  },
  {
    id: "volcengine",
    label: "火山方舟",
    shortLabel: "Ark",
    accentClass: "bg-rose-50 text-rose-700",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seedream-5-0-lite-260128",
    wireApi: "image_generations",
  },
  {
    id: "custom",
    label: "其他 / 手动配置",
    shortLabel: "+",
    accentClass: "bg-surface-muted text-brand",
    baseUrl: "",
    model: "",
    wireApi: "chat_completions",
  },
];

export const defaultAiModelSettings: AiModelSettings = {
  enabled: true,
  provider: aiProviderOptions[0].id,
  apiKey: aiProviderOptions[0].apiKey ?? "",
  baseUrl: aiProviderOptions[0].baseUrl,
  model: aiProviderOptions[0].model,
  wireApi: aiProviderOptions[0].wireApi,
  timeoutSeconds: 90,
};

function normalizeModelName(value: Partial<AiModelSettings> | null | undefined) {
  if (value?.provider === "volcengine" && value.model === "doubao-seedream-3-0-t2i-250415") {
    return "doubao-seedream-5-0-lite-260128";
  }

  return value?.model || defaultAiModelSettings.model;
}

export function normalizeAiSettings(value: Partial<AiModelSettings> | null | undefined): AiModelSettings {
  return {
    ...defaultAiModelSettings,
    ...value,
    baseUrl: (value?.baseUrl || defaultAiModelSettings.baseUrl).replace(/\/+$/, ""),
    model: normalizeModelName(value),
    wireApi: value?.wireApi || defaultAiModelSettings.wireApi,
    timeoutSeconds: Math.max(10, Math.min(240, Number(value?.timeoutSeconds) || defaultAiModelSettings.timeoutSeconds)),
  };
}

export function toPublicAiSettings(settings: AiModelSettings): AiModelSettingsPublic {
  return {
    enabled: settings.enabled,
    provider: settings.provider,
    hasApiKey: Boolean(settings.apiKey.trim()),
    baseUrl: settings.baseUrl,
    model: settings.model,
    wireApi: settings.wireApi,
    timeoutSeconds: settings.timeoutSeconds,
  };
}

export function getProviderLabel(provider: AiProviderPreset) {
  return aiProviderOptions.find((option) => option.id === provider)?.label ?? "Custom";
}

export function createAiProfileName(settings: AiModelSettings) {
  return `${getProviderLabel(settings.provider)} · ${settings.model}`;
}
