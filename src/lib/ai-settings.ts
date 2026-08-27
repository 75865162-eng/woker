export type AiProviderPreset = "deepseek" | "openrouter" | "openai" | "gemini" | "zhipu" | "kimi" | "qwen" | "aigocode" | "togoapi" | "volcengine" | "custom";
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
  bundleId: string;
  kind: "system" | "image";
  name: string;
  createdAt: string;
  updatedAt: string;
  settings: AiModelSettings;
}

export interface AiSettingsBundle {
  text: AiModelSettings;
  image: AiModelSettings;
}

export const aiSettingsStorageKey = "amazon-ad-ai-model-settings";
export const aiImageSettingsStorageKey = "amazon-ad-ai-image-model-settings";
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
    id: "togoapi",
    label: "TogoAPI",
    shortLabel: "TG",
    accentClass: "bg-cyan-50 text-cyan-700",
    baseUrl: "https://api.togoapi.com/v1",
    model: "gpt-5.4",
    wireApi: "chat_completions",
    recommended: true,
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

const defaultAiProvider = aiProviderOptions.find((option) => option.id === "togoapi") ?? aiProviderOptions[0];

export const defaultAiModelSettings: AiModelSettings = {
  enabled: true,
  provider: defaultAiProvider.id,
  apiKey: "",
  baseUrl: defaultAiProvider.baseUrl,
  model: defaultAiProvider.model,
  wireApi: defaultAiProvider.wireApi,
  timeoutSeconds: 90,
};

export const defaultAiImageModelSettings: AiModelSettings = {
  enabled: true,
  provider: defaultAiProvider.id,
  apiKey: "",
  baseUrl: defaultAiProvider.baseUrl,
  model: "gpt-image-2",
  wireApi: "image_generations",
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

export function normalizeAiImageSettings(value: Partial<AiModelSettings> | null | undefined): AiModelSettings {
  const base = {
    ...defaultAiImageModelSettings,
    ...value,
  };

  return {
    ...base,
    baseUrl: (value?.baseUrl || defaultAiImageModelSettings.baseUrl).replace(/\/+$/, ""),
    model: value?.model || defaultAiImageModelSettings.model,
    wireApi: value?.wireApi || defaultAiImageModelSettings.wireApi,
    timeoutSeconds: Math.max(10, Math.min(240, Number(value?.timeoutSeconds) || defaultAiImageModelSettings.timeoutSeconds)),
  };
}

export function normalizeAiSettingsBundle(
  value: Partial<AiSettingsBundle> | Partial<AiModelSettings> | null | undefined,
): AiSettingsBundle {
  if (!value || "text" in value || "image" in value) {
    return {
      text: normalizeAiSettings((value as Partial<AiSettingsBundle> | null | undefined)?.text),
      image: normalizeAiImageSettings((value as Partial<AiSettingsBundle> | null | undefined)?.image),
    };
  }

  const legacy = normalizeAiSettings(value as Partial<AiModelSettings>);
  return {
    text: legacy,
    image: defaultAiImageModelSettings,
  };
}

export function createDefaultAiSettingsBundle(): AiSettingsBundle {
  return {
    text: defaultAiModelSettings,
    image: defaultAiImageModelSettings,
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

export function createAiImageProfileName(name: string) {
  return `${name} · 生图`;
}

export function createSavedAiModelProfilePair(
  settings: AiModelSettings,
  imageSettings: AiModelSettings,
  name: string,
  timestamp = new Date().toISOString(),
): SavedAiModelProfile[] {
  const bundleId = `${settings.provider}-${settings.model}-${Date.now()}`;
  const systemProfileId = bundleId;
  const imageProfileId = `${bundleId}::image`;

  return [
    {
      id: systemProfileId,
      bundleId,
      kind: "system",
      name,
      createdAt: timestamp,
      updatedAt: timestamp,
      settings,
    },
    {
      id: imageProfileId,
      bundleId,
      kind: "image",
      name: createAiImageProfileName(name),
      createdAt: timestamp,
      updatedAt: timestamp,
      settings: imageSettings,
    },
  ];
}

function normalizeSavedAiModelProfile(
  value: Record<string, unknown>,
  fallbackKind: "system" | "image",
  fallbackBundleId: string,
  fallbackName: string,
) {
  const settings = normalizeAiSettings((value.settings as Partial<AiModelSettings> | undefined) ?? (value as Partial<AiModelSettings>));
  const now = new Date().toISOString();
  const kind = value.kind === "image" ? "image" : value.kind === "system" ? "system" : fallbackKind;
  const bundleId = typeof value.bundleId === "string" && value.bundleId ? value.bundleId : fallbackBundleId;

  return {
    id: typeof value.id === "string" && value.id ? value.id : `${bundleId}${kind === "image" ? "::image" : ""}`,
    bundleId,
    kind,
    name: typeof value.name === "string" && value.name ? value.name : fallbackName,
    createdAt: typeof value.createdAt === "string" && value.createdAt ? value.createdAt : now,
    updatedAt: typeof value.updatedAt === "string" && value.updatedAt ? value.updatedAt : now,
    settings,
  } satisfies SavedAiModelProfile;
}

export function normalizeSavedAiModelProfiles(value: unknown): SavedAiModelProfile[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((profile): profile is Record<string, unknown> => Boolean(profile && typeof profile === "object" && !Array.isArray(profile)))
    .flatMap((profile) => {
      if (profile.kind === "system" || profile.kind === "image") {
        const bundleId = typeof profile.bundleId === "string" && profile.bundleId ? profile.bundleId : typeof profile.id === "string" ? profile.id.replace(/::image$/, "") : `${Date.now()}`;
        const fallbackName = typeof profile.name === "string" && profile.name ? profile.name : "AI 配置";
        return [normalizeSavedAiModelProfile(profile, profile.kind, bundleId, fallbackName)];
      }

      const settings = normalizeAiSettings(profile.settings as Partial<AiModelSettings> | undefined);
      const imageSettingsRaw = profile.imageSettings as Partial<AiModelSettings> | undefined;
      const fallbackName = typeof profile.name === "string" && profile.name ? profile.name : createAiProfileName(settings);
      const bundleId = typeof profile.id === "string" && profile.id ? profile.id : `${settings.provider}-${settings.model}-${Date.now()}`;
      const systemProfile = normalizeSavedAiModelProfile(
        { ...profile, id: typeof profile.id === "string" && profile.id ? profile.id : bundleId, kind: "system", bundleId, name: fallbackName, settings },
        "system",
        bundleId,
        fallbackName,
      );

      if (!imageSettingsRaw) {
        return [systemProfile];
      }

      const imageProfile = normalizeSavedAiModelProfile(
        {
          ...profile,
          id: `${bundleId}::image`,
          kind: "image",
          bundleId,
          name: createAiImageProfileName(fallbackName),
          settings: imageSettingsRaw,
        },
        "image",
        bundleId,
        createAiImageProfileName(fallbackName),
      );

      return [systemProfile, imageProfile];
    })
    .slice(0, 20);
}
