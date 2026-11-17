"use client";

import { useEffect, useState } from "react";
import { aiSettingsStorageKey, aiImageSettingsStorageKey, aiProviderOptions, createAiProfileName, createSavedAiModelProfilePair, defaultAiImageModelSettings, defaultAiModelSettings, normalizeAiImageSettings, normalizeAiSettings, normalizeSavedAiModelProfiles, type AiModelSettings, type SavedAiModelProfile } from "@/lib/ai-settings";
import { imageGenerationModelPattern, cacheAiSettings, cacheAiImageSettings } from "./use-settings-workbench-model";
import { useSellerSpriteSettings } from "./use-sellersprite-settings";
export function useSettingsWorkbench() {
  const [settings, setSettings] = useState<AiModelSettings>(defaultAiModelSettings);
  const [imageSettings, setImageSettings] = useState<AiModelSettings>(defaultAiImageModelSettings);
  const [profileName, setProfileName] = useState(createAiProfileName(defaultAiModelSettings));
  const [showSecret, setShowSecret] = useState(false);
  const [showImageSecret, setShowImageSecret] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showImageAdvanced, setShowImageAdvanced] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [imageSavedAt, setImageSavedAt] = useState("");
  const [chatInput, setChatInput] = useState("请用一句话回复：AI 大模型配置测试成功。");
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([
    { role: "assistant", content: "保存配置后，可以在这里发送一条测试消息验证连接。" },
  ]);
  const [testingChat, setTestingChat] = useState(false);
  const [chatError, setChatError] = useState("");
  const [profiles, setProfiles] = useState<SavedAiModelProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState("");
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsError, setSettingsError] = useState("");
  const [imageSettingsError, setImageSettingsError] = useState("");
  const sellerSprite = useSellerSpriteSettings();

  useEffect(() => {
    let cancelled = false;

    async function restoreSettings() {
      try {
        const response = await fetch("/api/ai-settings");

        if (!response.ok) {
          throw new Error("无法从数据库读取 AI 配置。");
        }

        const data = (await response.json()) as {
          settings?: Partial<AiModelSettings> | null;
          imageSettings?: Partial<AiModelSettings> | null;
          profiles?: SavedAiModelProfile[];
          activeProfileId?: string;
        };
        const databaseProfiles = normalizeSavedAiModelProfiles(data.profiles);

        if (data.settings) {
          const normalized = normalizeBeforeSave(data.settings as AiModelSettings);
          const normalizedImage = normalizeImageBeforeSave(
            data.imageSettings as AiModelSettings | null | undefined,
          );
          const nextProfiles = databaseProfiles.length
            ? databaseProfiles
            : createSavedAiModelProfilePair(normalized, normalizedImage, createAiProfileName(normalized));
          const nextProfileName =
            nextProfiles.find((profile) => profile.kind === "system" && profile.id === data.activeProfileId)?.name ||
            nextProfiles.find((profile) => profile.kind === "system")?.name ||
            createAiProfileName(normalized);

          if (cancelled) return;
          setSettings(normalized);
          setImageSettings(normalizedImage);
          setProfileName(nextProfileName);
          setProfiles(nextProfiles);
          setActiveProfileId(data.activeProfileId || nextProfiles.find((profile) => profile.kind === "system")?.id || "");
          cacheAiSettings(normalized, nextProfiles);
          cacheAiImageSettings(normalizedImage);
          return;
        }

        if (cancelled) return;
        const defaults = createSavedAiModelProfilePair(
          defaultAiModelSettings,
          defaultAiImageModelSettings,
          createAiProfileName(defaultAiModelSettings),
        );
        setSettings(defaultAiModelSettings);
        setImageSettings(defaultAiImageModelSettings);
        setProfileName(createAiProfileName(defaultAiModelSettings));
        setProfiles(defaults);
        setActiveProfileId(defaults.find((profile) => profile.kind === "system")?.id ?? "");
      } catch (error) {
        if (cancelled) return;
        const defaults = createSavedAiModelProfilePair(
          defaultAiModelSettings,
          defaultAiImageModelSettings,
          createAiProfileName(defaultAiModelSettings),
        );
        setSettings(defaultAiModelSettings);
        setImageSettings(defaultAiImageModelSettings);
        setProfileName(createAiProfileName(defaultAiModelSettings));
        setProfiles(defaults);
        setActiveProfileId(defaults.find((profile) => profile.kind === "system")?.id ?? "");
        setSettingsError(error instanceof Error ? error.message : "AI 配置加载失败。");
      } finally {
        if (!cancelled) setSettingsLoading(false);
      }
    }

    void restoreSettings();

    return () => {
      cancelled = true;
    };
  }, []);

  const ready = settings.enabled && settings.apiKey.trim().length > 0 && settings.baseUrl.trim().startsWith("http") && settings.model.trim().length > 0;
  const imageReady = imageSettings.enabled && imageSettings.apiKey.trim().length > 0 && imageSettings.baseUrl.trim().startsWith("http") && imageSettings.model.trim().length > 0;

  function applyDeepseekPreset() {
    applyProviderPreset("deepseek");
  }

  function applyProviderPreset(providerId: AiModelSettings["provider"]) {
    const provider = aiProviderOptions.find((option) => option.id === providerId);
    if (!provider) return;

    setActiveProfileId("");
    if (provider.id === "custom") {
      setShowAdvanced(true);
    }
    setSettings((current) => {
      const nextSettings: AiModelSettings = {
        enabled: true,
        provider: provider.id,
        apiKey: current.provider === provider.id ? current.apiKey : provider.apiKey ?? "",
        baseUrl: provider.baseUrl,
        model: provider.model,
        wireApi: provider.wireApi,
        timeoutSeconds: current.timeoutSeconds,
      };

      return provider.id === "custom" ? nextSettings : normalizeAiSettings(nextSettings);
    });
  }

  function update<K extends keyof AiModelSettings>(key: K, value: AiModelSettings[K]) {
    setSettings((current) => {
      const next = {
        ...current,
        [key]: value,
      };

      return current.provider === "custom" ? (next as AiModelSettings) : normalizeAiSettings(next);
    });
  }

  function normalizeBeforeSave(value: AiModelSettings) {
    if (value.provider !== "custom") return normalizeAiSettings(value);

    return {
      ...value,
      baseUrl: value.baseUrl.replace(/\/+$/, ""),
      model: value.model,
      timeoutSeconds: Math.max(10, Math.min(240, Number(value.timeoutSeconds) || defaultAiModelSettings.timeoutSeconds)),
    };
  }

  function normalizeImageBeforeSave(value: AiModelSettings | null | undefined): AiModelSettings {
    if (!value) return defaultAiImageModelSettings;

    if (value.provider !== "custom") return normalizeAiImageSettings({ ...value, wireApi: value.wireApi === "image_generations" ? value.wireApi : "responses" });

    return {
      ...value,
      baseUrl: value.baseUrl.replace(/\/+$/, ""),
      model: value.model,
      wireApi: value.wireApi === "image_generations" ? value.wireApi : "responses",
      timeoutSeconds: Math.max(10, Math.min(240, Number(value.timeoutSeconds) || defaultAiImageModelSettings.timeoutSeconds)),
    };
  }

  async function persistSettings(
    nextSettings: AiModelSettings | undefined,
    nextImageSettings: AiModelSettings | undefined,
    nextProfiles: SavedAiModelProfile[],
    nextActiveProfileId: string,
  ) {
    const response = await fetch("/api/ai-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: nextSettings,
        imageSettings: nextImageSettings,
        profiles: nextProfiles,
        activeProfileId: nextActiveProfileId,
      }),
    });

    if (!response.ok) {
      const data = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(data.error || "AI 配置保存失败。");
    }

    if (nextSettings) cacheAiSettings(nextSettings, nextProfiles);
    if (nextImageSettings) cacheAiImageSettings(nextImageSettings);
  }

  async function saveSettings() {
    const normalized = normalizeBeforeSave(settings);
    const now = new Date().toISOString();
    const existingSystemProfile = profiles.find((profile) => profile.kind === "system" && profile.id === activeProfileId) ??
      profiles.find((profile) => profile.kind === "system" && profile.bundleId === profiles.find((candidate) => candidate.id === activeProfileId)?.bundleId);
    const nextProfileName = profileName.trim() || createAiProfileName(normalized);
    const bundleId = existingSystemProfile?.bundleId ?? existingSystemProfile?.id ?? `${normalized.provider}-${normalized.model}-${Date.now()}`;
    const systemProfileId = existingSystemProfile?.id ?? bundleId;
    const nextProfiles = [
      {
        id: systemProfileId,
        bundleId,
        kind: "system" as const,
        name: nextProfileName,
        createdAt: existingSystemProfile?.createdAt ?? now,
        updatedAt: now,
        settings: normalized,
      },
      ...profiles.filter((profile) => profile.id !== systemProfileId),
    ].slice(0, 20);

    try {
      await persistSettings(normalized, undefined, nextProfiles, systemProfileId);
      setSettings(normalized);
      setProfileName(nextProfileName);
      setProfiles(nextProfiles);
      setActiveProfileId(systemProfileId);
      setSavedAt(new Date().toLocaleString("zh-CN", { hour12: false }));
      setSettingsError("");
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "AI 配置保存失败。");
    }
  }

  async function saveImageSettings() {
    const normalized = normalizeImageBeforeSave(imageSettings);

    if (normalized.wireApi === "image_generations" && !imageGenerationModelPattern.test(normalized.model)) {
      setImageSettingsError("Images Generations API 需要图片模型，例如 gpt-image-2；gpt-5.5 这类文本模型请用于系统配置。");
      return;
    }

    const now = new Date().toISOString();
    const activeSystemProfile = profiles.find((profile) => profile.kind === "system" && profile.id === activeProfileId) ??
      profiles.find((profile) => profile.kind === "system" && profile.bundleId === profiles.find((candidate) => candidate.id === activeProfileId)?.bundleId);
    const bundleId =
      activeSystemProfile?.bundleId ??
      profiles.find((profile) => profile.kind === "image")?.bundleId ??
      (activeProfileId || `${settings.provider}-${settings.model}-${Date.now()}`);
    const imageProfileId = `${bundleId}::image`;
    const nextProfiles = [
      {
        id: imageProfileId,
        bundleId,
        kind: "image" as const,
        name: `${profileName.trim() || createAiProfileName(settings)} · 生图`,
        createdAt: profiles.find((profile) => profile.id === imageProfileId)?.createdAt ?? now,
        updatedAt: now,
        settings: normalized,
      },
      ...profiles.filter((profile) => profile.id !== imageProfileId),
    ].slice(0, 20);

    try {
      await persistSettings(undefined, normalized, nextProfiles, activeSystemProfile?.id ?? activeProfileId);
      setImageSettings(normalized);
      setProfiles(nextProfiles);
      setImageSavedAt(new Date().toLocaleString("zh-CN", { hour12: false }));
      setImageSettingsError("");
    } catch (error) {
      setImageSettingsError(error instanceof Error ? error.message : "生图配置保存失败。");
    }
  }

  async function resetSettings() {
    window.localStorage.removeItem(aiSettingsStorageKey);
    const nextProfileName = createAiProfileName(defaultAiModelSettings);
    const existingSystemProfile = profiles.find((profile) => profile.kind === "system" && profile.id === activeProfileId) ??
      profiles.find((profile) => profile.kind === "system" && profile.bundleId === profiles.find((candidate) => candidate.id === activeProfileId)?.bundleId);
    const bundleId = existingSystemProfile?.bundleId ?? existingSystemProfile?.id ?? `${defaultAiModelSettings.provider}-${defaultAiModelSettings.model}-${Date.now()}`;
    const systemProfileId = existingSystemProfile?.id ?? bundleId;
    const now = new Date().toISOString();
    const builtInProfiles = [
      {
        id: systemProfileId,
        bundleId,
        kind: "system" as const,
        name: nextProfileName,
        createdAt: existingSystemProfile?.createdAt ?? now,
        updatedAt: now,
        settings: defaultAiModelSettings,
      },
      ...profiles.filter((profile) => profile.id !== systemProfileId),
    ].slice(0, 20);

    try {
      await persistSettings(defaultAiModelSettings, undefined, builtInProfiles, systemProfileId);
      setSettings(defaultAiModelSettings);
      setProfileName(nextProfileName);
      setProfiles(builtInProfiles);
      setActiveProfileId(builtInProfiles[0]?.id ?? "");
      setSavedAt("");
      setSettingsError("");
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "AI 配置重置失败。");
    }
  }

  async function resetImageSettings() {
    window.localStorage.removeItem(aiImageSettingsStorageKey);

    try {
      const now = new Date().toISOString();
      const activeSystemProfile =
        profiles.find((profile) => profile.kind === "system" && profile.id === activeProfileId) ??
        profiles.find((profile) => profile.kind === "system" && profile.bundleId === profiles.find((candidate) => candidate.id === activeProfileId)?.bundleId);
      const bundleId =
        activeSystemProfile?.bundleId ??
        profiles.find((profile) => profile.kind === "image")?.bundleId ??
        (activeProfileId || `${settings.provider}-${settings.model}-${Date.now()}`);
      const nextProfiles = [
        ...(activeSystemProfile ? [activeSystemProfile] : []),
        {
          id: `${bundleId}::image`,
          bundleId,
          kind: "image" as const,
          name: `${profileName.trim() || createAiProfileName(settings)} · 生图`,
          createdAt: profiles.find((profile) => profile.id === `${bundleId}::image`)?.createdAt ?? now,
          updatedAt: now,
          settings: defaultAiImageModelSettings,
        },
        ...profiles.filter((profile) => profile.bundleId !== bundleId && profile.id !== `${bundleId}::image`),
      ].slice(0, 20);
      await persistSettings(undefined, defaultAiImageModelSettings, nextProfiles, activeSystemProfile?.id ?? activeProfileId);
      setImageSettings(defaultAiImageModelSettings);
      setProfiles(nextProfiles);
      setImageSavedAt("");
      setImageSettingsError("");
    } catch (error) {
      setImageSettingsError(error instanceof Error ? error.message : "生图配置重置失败。");
    }
  }

  async function loadProfile(profile: SavedAiModelProfile) {
    const pairedSystemProfile = profiles.find((candidate) => candidate.kind === "system" && candidate.bundleId === profile.bundleId);
    const pairedImageProfile = profiles.find((candidate) => candidate.kind === "image" && candidate.bundleId === profile.bundleId);
    const normalizedSystem =
      profile.kind === "image" && pairedSystemProfile
        ? normalizeAiSettings(pairedSystemProfile.settings)
        : profile.settings.provider === "custom"
          ? normalizeBeforeSave(profile.settings)
          : normalizeAiSettings(profile.settings);
    const normalizedImage = normalizeImageBeforeSave(pairedImageProfile?.settings ?? (profile.kind === "image" ? profile.settings : imageSettings));

    try {
      await persistSettings(
        normalizedSystem,
        normalizedImage,
        profiles,
        pairedSystemProfile?.id ?? activeProfileId,
      );
      setSettings(normalizedSystem);
      setImageSettings(normalizedImage);
      setProfileName(pairedSystemProfile?.name || profile.name.replace(/ · 生图$/, ""));
      setActiveProfileId(pairedSystemProfile?.id ?? activeProfileId);
      setSavedAt("");
      setChatError("");
      setSettingsError("");
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "AI 配置切换失败。");
    }
  }

  async function deleteProfile(profileId: string) {
    const targetProfile = profiles.find((profile) => profile.id === profileId);
    const bundleId = targetProfile?.bundleId ?? profileId;
    const nextProfiles = profiles.filter((profile) => profile.bundleId !== bundleId);
    const nextActiveProfileId = activeProfileId === profileId || activeProfileId === `${bundleId}::image` ? "" : activeProfileId;

    try {
      await persistSettings(settings, imageSettings, nextProfiles, nextActiveProfileId);
      setProfiles(nextProfiles);
      setActiveProfileId(nextActiveProfileId);
      setSettingsError("");
    } catch (error) {
      setSettingsError(error instanceof Error ? error.message : "AI 配置删除失败。");
    }
  }

  async function sendTestChat() {
    const message = chatInput.trim();
    if (!message || testingChat) return;

    const normalized = normalizeAiSettings(settings);

    setTestingChat(true);
    setChatError("");
    setChatMessages((current) => [...current, { role: "user", content: message }]);
    setChatInput("");

    try {
      const response = await fetch("/api/ai-settings/test-chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          aiSettings: normalized.apiKey.trim() ? normalized : undefined,
        }),
      });
      const data = (await response.json()) as { result?: { message: string; model: string; baseUrl: string }; error?: string };

      if (!response.ok || !data.result) {
        throw new Error(data.error || "测试失败");
      }

      const result = data.result;
      setChatMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: `${result.message}\n\n连接信息：${result.model} · ${result.baseUrl}`,
        },
      ]);
    } catch (error) {
      setChatError(error instanceof Error ? error.message : "测试失败");
    } finally {
      setTestingChat(false);
    }
  }

  return { ready, applyDeepseekPreset, settings, applyProviderPreset, profileName, setProfileName, showSecret, update, setShowSecret, setShowAdvanced, showAdvanced, settingsError, savedAt, resetSettings, saveSettings, imageReady, showImageSecret, imageSettings, setImageSettings, setShowImageSecret, setShowImageAdvanced, showImageAdvanced, imageSettingsError, imageSavedAt, resetImageSettings, saveImageSettings, sellerSpriteReady: sellerSprite.ready, sellerSpriteSettings: sellerSprite.settings, updateSellerSprite: sellerSprite.update, showSellerSpriteSecret: sellerSprite.showSecret, setShowSellerSpriteSecret: sellerSprite.setShowSecret, sellerSpriteError: sellerSprite.error, sellerSpriteTestMessage: sellerSprite.testMessage, sellerSpriteSavedAt: sellerSprite.savedAt, testSellerSpriteSettings: sellerSprite.test, testingSellerSprite: sellerSprite.testing, saveSellerSpriteSettings: sellerSprite.save, profiles, activeProfileId, loadProfile, deleteProfile, settingsLoading, testingChat, chatMessages, chatError, chatInput, setChatInput, sendTestChat };
}
