import {
  normalizeAiImageSettings,
  normalizeAiSettings,
  type AiModelSettings,
  type AiSettingsBundle,
  type SavedAiModelProfile,
} from "@/lib/ai-settings";
import { decryptAiApiKey, encryptAiApiKey, type AiSettingsCryptoScope } from "@/lib/server/ai-settings-crypto";

/**
 * 对落库前的 AI 配置做密钥加密。只处理 apiKey 字段，其余配置保持明文，
 * 保证设置页可正常展示/编辑非敏感项。
 */
export function encryptAiBundleForStorage(bundle: AiSettingsBundle, scope: AiSettingsCryptoScope): AiSettingsBundle {
  return {
    text: { ...bundle.text, apiKey: encryptAiApiKey(bundle.text.apiKey, scope) },
    image: { ...bundle.image, apiKey: encryptAiApiKey(bundle.image.apiKey, scope) },
  };
}

export function encryptAiProfilesForStorage(
  profiles: SavedAiModelProfile[],
  scope: AiSettingsCryptoScope,
): SavedAiModelProfile[] {
  return profiles.map((profile) => ({
    ...profile,
    settings: { ...profile.settings, apiKey: encryptAiApiKey(profile.settings.apiKey, scope) },
  }));
}

/** 解密出可展示/可发请求的 bundle（含明文 apiKey）。兼容历史明文数据。 */
export function decryptAiBundleFromStorage(
  settings: unknown,
  scope: AiSettingsCryptoScope,
): AiSettingsBundle {
  const raw = settings as Partial<AiSettingsBundle> | Partial<AiModelSettings> | null | undefined;
  const isBundle = Boolean(raw && ("text" in raw || "image" in raw));
  const text = isBundle
    ? normalizeAiSettings((raw as Partial<AiSettingsBundle>).text)
    : normalizeAiSettings(raw as Partial<AiModelSettings>);
  const image = isBundle
    ? normalizeAiImageSettings((raw as Partial<AiSettingsBundle>).image)
    : normalizeAiImageSettings(null);

  return {
    text: { ...text, apiKey: decryptAiApiKey(text.apiKey, scope) },
    image: { ...image, apiKey: decryptAiApiKey(image.apiKey, scope) },
  };
}

export function decryptAiProfilesFromStorage(
  profiles: unknown,
  scope: AiSettingsCryptoScope,
): SavedAiModelProfile[] {
  if (!Array.isArray(profiles)) return [];
  return profiles
    .filter((profile): profile is Record<string, unknown> => Boolean(profile && typeof profile === "object" && !Array.isArray(profile)))
    .map((profile) => {
      const settings = normalizeAiSettings(profile.settings as Partial<AiModelSettings> | undefined);
      return {
        ...profile,
        settings: { ...settings, apiKey: decryptAiApiKey(settings.apiKey, scope) },
      } as SavedAiModelProfile;
    });
}
