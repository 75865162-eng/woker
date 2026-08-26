"use client";

import { useEffect, useState } from "react";
import {
  Bot,
  ChevronDown,
  FolderOpen,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  RotateCcw,
  Save,
  Send,
  SlidersHorizontal,
  Trash2,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { WeComNotificationSettingsPanel } from "@/components/settings/wecom-notification-settings";
import {
  aiSettingsStorageKey,
  aiImageSettingsStorageKey,
  aiSettingsProfilesStorageKey,
  aiProviderOptions,
  createAiProfileName,
  createSavedAiModelProfilePair,
  defaultAiImageModelSettings,
  defaultAiModelSettings,
  normalizeAiSettings,
  normalizeSavedAiModelProfiles,
  type AiModelSettings,
  type SavedAiModelProfile,
} from "@/lib/ai-settings";

const fieldClass =
  "h-9 w-full rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10";
const labelClass = "text-xs font-bold uppercase tracking-normal text-muted";

export function SettingsWorkbench() {
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
        const localSettings = readLocalAiSettings();
        const localImageSettings = readLocalAiImageSettings();
        const localProfiles = readLocalAiProfiles();
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

        const migratedSettings = localSettings ?? defaultAiModelSettings;
        const migratedImageSettings = localImageSettings ?? defaultAiImageModelSettings;
        const migratedProfiles = localProfiles.length
          ? localProfiles
          : createSavedAiModelProfilePair(migratedSettings, migratedImageSettings, createAiProfileName(migratedSettings));
        const migratedActiveProfileId = migratedProfiles.find((profile) => profile.kind === "system")?.id ?? "";
        const migratedProfileName = migratedProfiles.find((profile) => profile.kind === "system")?.name || createAiProfileName(migratedSettings);

        await persistSettings(migratedSettings, migratedImageSettings, migratedProfiles, migratedActiveProfileId);

        if (cancelled) return;
        setSettings(migratedSettings);
        setImageSettings(migratedImageSettings);
        setProfileName(migratedProfileName);
        setProfiles(migratedProfiles);
        setActiveProfileId(migratedActiveProfileId);
      } catch (error) {
        const localSettings = readLocalAiSettings();
        const localImageSettings = readLocalAiImageSettings();
        const localProfiles = readLocalAiProfiles();

        if (cancelled) return;
        if (localSettings) setSettings(localSettings);
        if (localImageSettings) setImageSettings(localImageSettings);
        if (localProfiles.length) {
          setProfileName(localProfiles.find((profile) => profile.kind === "system")?.name || createAiProfileName(localSettings ?? defaultAiModelSettings));
          setProfiles(localProfiles);
        }
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

    if (value.provider !== "custom") return normalizeAiSettings({ ...value, wireApi: value.wireApi === "image_generations" ? value.wireApi : "responses" });

    return {
      ...value,
      baseUrl: value.baseUrl.replace(/\/+$/, ""),
      model: value.model,
      wireApi: value.wireApi === "image_generations" ? value.wireApi : "responses",
      timeoutSeconds: Math.max(10, Math.min(240, Number(value.timeoutSeconds) || defaultAiImageModelSettings.timeoutSeconds)),
    };
  }

  async function persistSettings(
    nextSettings: AiModelSettings,
    nextImageSettings: AiModelSettings,
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

    cacheAiSettings(nextSettings, nextProfiles);
    cacheAiImageSettings(nextImageSettings);
  }

  async function saveSettings() {
    const normalized = normalizeBeforeSave(settings);
    const normalizedImage = normalizeImageBeforeSave(imageSettings);
    const now = new Date().toISOString();
    const existingSystemProfile = profiles.find((profile) => profile.kind === "system" && profile.id === activeProfileId) ??
      profiles.find((profile) => profile.kind === "system" && profile.bundleId === profiles.find((candidate) => candidate.id === activeProfileId)?.bundleId);
    const nextProfileName = profileName.trim() || createAiProfileName(normalized);
    const bundleId = existingSystemProfile?.bundleId ?? existingSystemProfile?.id ?? `${normalized.provider}-${normalized.model}-${Date.now()}`;
    const systemProfileId = existingSystemProfile?.id ?? bundleId;
    const imageProfileId = `${bundleId}::image`;
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
      {
        id: imageProfileId,
        bundleId,
        kind: "image" as const,
        name: `${nextProfileName} · 生图`,
        createdAt: profiles.find((profile) => profile.id === imageProfileId)?.createdAt ?? now,
        updatedAt: now,
        settings: normalizedImage,
      },
      ...profiles.filter((profile) => profile.bundleId !== bundleId),
    ].slice(0, 20);

    try {
      await persistSettings(normalized, normalizedImage, nextProfiles, systemProfileId);
      setSettings(normalized);
      setImageSettings(normalizedImage);
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
    const now = new Date().toISOString();
    const activeSystemProfile = profiles.find((profile) => profile.kind === "system" && profile.id === activeProfileId) ??
      profiles.find((profile) => profile.kind === "system" && profile.bundleId === profiles.find((candidate) => candidate.id === activeProfileId)?.bundleId);
    const bundleId =
      activeSystemProfile?.bundleId ??
      profiles.find((profile) => profile.kind === "image")?.bundleId ??
      (activeProfileId || `${settings.provider}-${settings.model}-${Date.now()}`);
    const systemProfile = activeSystemProfile;
    const imageProfileId = `${bundleId}::image`;
    const nextProfiles = [
      ...(systemProfile ? [systemProfile] : []),
      {
        id: imageProfileId,
        bundleId,
        kind: "image" as const,
        name: `${profileName.trim() || createAiProfileName(settings)} · 生图`,
        createdAt: profiles.find((profile) => profile.id === imageProfileId)?.createdAt ?? now,
        updatedAt: now,
        settings: normalized,
      },
      ...profiles.filter((profile) => profile.bundleId !== bundleId && profile.id !== imageProfileId),
    ].slice(0, 20);

    try {
      await persistSettings(settings, normalized, nextProfiles, activeSystemProfile?.id ?? activeProfileId);
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
    const builtInProfiles = createSavedAiModelProfilePair(defaultAiModelSettings, imageSettings, nextProfileName);

    try {
      await persistSettings(defaultAiModelSettings, imageSettings, builtInProfiles, builtInProfiles[0]?.id ?? "");
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
      await persistSettings(settings, defaultAiImageModelSettings, nextProfiles, activeSystemProfile?.id ?? activeProfileId);
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

  return (
    <>
      <div className="space-y-3">
        <section className="grid grid-cols-1 gap-3">
          <Card>
            <CardHeader className="flex flex-col gap-2 px-3 py-2.5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-brand text-white">
                  <Bot className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-sm">AI 大模型配置</CardTitle>
                  <p className="mt-0.5 text-xs text-muted">按 OpenAI 兼容 Responses 协议提交，其他功能会统一读取这里的配置。</p>
                </div>
              </div>
              <Badge tone={ready ? "green" : "amber"}>{ready ? "可调用" : "待完善"}</Badge>
            </CardHeader>
            <CardContent className="space-y-3 p-3">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-foreground">预设供应商</p>
                    <p className="mt-0.5 text-xs text-muted">选择供应商后只需要粘贴 API Key，再点击保存配置。</p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={applyDeepseekPreset}>
                    <Zap className="h-4 w-4" />
                    推荐
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {aiProviderOptions.map((provider) => {
                    const active = settings.provider === provider.id;

                    return (
                      <button
                        key={provider.id}
                        className={`relative flex min-h-12 items-center gap-2 rounded-md border px-3 py-2 text-left transition ${
                          active ? "border-brand bg-brand text-white shadow-sm" : "border-border bg-surface-muted hover:border-brand hover:bg-white"
                        }`}
                        onClick={() => applyProviderPreset(provider.id)}
                        type="button"
                      >
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[11px] font-black ${active ? "bg-white text-brand" : provider.accentClass}`}>
                          {provider.shortLabel}
                        </span>
                        <span className="min-w-0">
                          <span className={`block truncate text-sm font-bold ${active ? "text-white" : "text-foreground"}`}>{provider.label}</span>
                          <span className={`mt-0.5 block truncate text-xs ${active ? "text-white/80" : "text-muted"}`}>{provider.model}</span>
                        </span>
                        {provider.recommended ? <span className="absolute right-2 top-2 rounded-full bg-accent px-1.5 py-0.5 text-[10px] font-black text-white">荐</span> : null}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 xl:grid-cols-[0.9fr_1.2fr_0.8fr]">
                <Field label="名称">
                  <input
                    className={fieldClass}
                    value={profileName}
                    onChange={(event) => setProfileName(event.target.value)}
                    placeholder="例如：TogoAPI 系统配置"
                  />
                </Field>
                <Field label="API Key">
                  <div className="relative">
                    <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <input
                      className={`${fieldClass} pl-9 pr-11 font-mono`}
                      type={showSecret ? "text" : "password"}
                      value={settings.apiKey}
                      onChange={(event) => update("apiKey", event.target.value)}
                      placeholder="sk-..."
                    />
                    <button
                      className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-foreground"
                      onClick={() => setShowSecret((current) => !current)}
                      title={showSecret ? "隐藏密钥" : "显示密钥"}
                      type="button"
                    >
                      {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </Field>
                <Field label="默认模型">
                  <input className={fieldClass} value={settings.model} onChange={(event) => update("model", event.target.value)} />
                </Field>
              </div>

              <button
                className="flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left transition hover:bg-surface-muted"
                onClick={() => setShowAdvanced((current) => !current)}
                type="button"
              >
                <div className="flex items-center gap-3">
                  <SlidersHorizontal className="h-4 w-4 text-brand" />
                  <div>
                    <p className="text-sm font-bold text-foreground">高级连接参数</p>
                    <p className="mt-0.5 text-xs text-muted">默认不用改；只有换供应商或模型时再调整。</p>
                  </div>
                </div>
                <ChevronDown className={`h-4 w-4 text-muted transition ${showAdvanced ? "rotate-180" : ""}`} />
              </button>

              {showAdvanced ? (
                <div className="grid grid-cols-1 gap-3 rounded-md border border-border bg-surface-muted p-3 xl:grid-cols-3">
                  <Field label="Base URL">
                    <div className="relative">
                      <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                      <input className={`${fieldClass} pl-9`} value={settings.baseUrl} onChange={(event) => update("baseUrl", event.target.value)} />
                    </div>
                  </Field>
                  <Field label="协议">
                    <select className={fieldClass} value={settings.wireApi} onChange={(event) => update("wireApi", event.target.value as AiModelSettings["wireApi"])}>
                      <option value="chat_completions">Chat Completions API</option>
                      <option value="responses">Responses API</option>
                      <option value="image_generations">Images Generations API</option>
                    </select>
                  </Field>
                  <Field label="超时秒数">
                    <input
                      className={fieldClass}
                      min={10}
                      max={240}
                      inputMode="decimal"
                      type="text"
                      value={settings.timeoutSeconds}
                      onChange={(event) => update("timeoutSeconds", Number(event.target.value))}
                    />
                  </Field>
                </div>
              ) : null}

              <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-muted">
                  {settingsError ? <span className="text-red-600">{settingsError}</span> : savedAt ? <span>已保存：{savedAt}</span> : <span>填写 API Key 后点击保存，Listing AI 会立即使用新配置。</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => void resetSettings()}>
                    <RotateCcw className="h-4 w-4" />
                    重置
                  </Button>
                  <Button onClick={() => void saveSettings()} disabled={!settings.apiKey.trim()}>
                    <Save className="h-4 w-4" />
                    保存配置
                  </Button>
                </div>
              </div>

              <div className="border-t border-border pt-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-foreground">生图预设</p>
                    <p className="mt-0.5 text-xs text-muted">它只是已保存配置里的一个预装 API，Image Plan 直接读取这个预设。</p>
                  </div>
                  <Badge tone={imageReady ? "green" : "amber"}>{imageReady ? "可调用" : "待完善"}</Badge>
                </div>
                <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.2fr_0.8fr]">
                  <Field label="API Key">
                    <div className="relative">
                      <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                      <input
                        className={`${fieldClass} pl-9 pr-11 font-mono`}
                        type={showImageSecret ? "text" : "password"}
                        value={imageSettings.apiKey}
                        onChange={(event) => setImageSettings((current) => ({ ...current, apiKey: event.target.value }))}
                        placeholder="sk-..."
                      />
                      <button
                        className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-foreground"
                        onClick={() => setShowImageSecret((current) => !current)}
                        title={showImageSecret ? "隐藏密钥" : "显示密钥"}
                        type="button"
                      >
                        {showImageSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </Field>
                  <Field label="默认模型">
                    <input
                      className={fieldClass}
                      value={imageSettings.model}
                      onChange={(event) => setImageSettings((current) => ({ ...current, model: event.target.value }))}
                    />
                  </Field>
                </div>

                <button
                  className="mt-3 flex w-full items-center justify-between rounded-md border border-border px-3 py-2 text-left transition hover:bg-surface-muted"
                  onClick={() => setShowImageAdvanced((current) => !current)}
                  type="button"
                >
                  <div className="flex items-center gap-3">
                    <SlidersHorizontal className="h-4 w-4 text-brand" />
                    <div>
                      <p className="text-sm font-bold text-foreground">高级连接参数</p>
                      <p className="mt-0.5 text-xs text-muted">仅当图片接口地址或协议不同于系统配置时修改。</p>
                    </div>
                  </div>
                  <ChevronDown className={`h-4 w-4 text-muted transition ${showImageAdvanced ? "rotate-180" : ""}`} />
                </button>

                {showImageAdvanced ? (
                  <div className="mt-3 grid grid-cols-1 gap-3 rounded-md border border-border bg-surface-muted p-3 xl:grid-cols-3">
                    <Field label="Base URL">
                      <div className="relative">
                        <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                        <input
                          className={`${fieldClass} pl-9`}
                          value={imageSettings.baseUrl}
                          onChange={(event) => setImageSettings((current) => ({ ...current, baseUrl: event.target.value }))}
                        />
                      </div>
                    </Field>
                    <Field label="协议">
                      <select
                        className={fieldClass}
                        value={imageSettings.wireApi}
                        onChange={(event) =>
                          setImageSettings((current) => ({
                            ...current,
                            wireApi: event.target.value as AiModelSettings["wireApi"],
                          }))
                        }
                      >
                        <option value="responses">Responses API</option>
                        <option value="image_generations">Images Generations API</option>
                      </select>
                    </Field>
                    <Field label="超时秒数">
                      <input
                        className={fieldClass}
                        min={10}
                        max={240}
                        inputMode="decimal"
                        type="text"
                        value={imageSettings.timeoutSeconds}
                        onChange={(event) =>
                          setImageSettings((current) => ({
                            ...current,
                            timeoutSeconds: Number(event.target.value),
                          }))
                        }
                      />
                    </Field>
                  </div>
                ) : null}

                <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm text-muted">
                    {imageSettingsError ? <span className="text-red-600">{imageSettingsError}</span> : imageSavedAt ? <span>已保存：{imageSavedAt}</span> : <span>填写生图 API Key 后点击保存，Image Plan 会使用这个预设。</span>}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" onClick={() => void resetImageSettings()}>
                      <RotateCcw className="h-4 w-4" />
                      重置生图
                    </Button>
                    <Button onClick={() => void saveImageSettings()} disabled={!imageSettings.apiKey.trim()}>
                      <Save className="h-4 w-4" />
                      保存生图配置
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <section className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(220px,320px)_minmax(0,1fr)]">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between px-3 py-2.5">
              <div className="flex items-center gap-2">
                <FolderOpen className="h-4 w-4 text-brand" />
                <CardTitle className="text-sm">已保存配置</CardTitle>
              </div>
              <Badge tone="gray">{profiles.length} 个</Badge>
            </CardHeader>
            <CardContent className="space-y-2 p-3">
              {profiles.length ? (
                profiles.map((profile) => {
                  const active = profile.id === activeProfileId;

                return (
                  <div key={profile.id} className={`rounded-md border p-2.5 ${active ? "border-brand bg-brand/5" : "border-border bg-white"}`}>
                    <button className="w-full text-left" onClick={() => void loadProfile(profile)} type="button">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <p className="truncate text-sm font-bold text-foreground">{profile.name}</p>
                          <Badge tone={profile.kind === "image" ? "amber" : "gray"}>{profile.kind === "image" ? "生图" : "系统"}</Badge>
                        </div>
                        {active && profile.kind === "system" ? <Badge tone="green">当前</Badge> : null}
                      </div>
                      <p className="mt-1 truncate text-xs text-muted">{profile.settings.baseUrl}</p>
                      <p className="mt-1 text-xs text-muted">{profile.settings.wireApi}</p>
                      </button>
                      <Button className="mt-2 w-full" size="sm" variant="secondary" onClick={() => void deleteProfile(profile.id)}>
                        <Trash2 className="h-4 w-4" />
                        删除
                      </Button>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm leading-6 text-muted">{settingsLoading ? "正在读取数据库配置..." : "暂无保存配置。点击保存配置后会出现在这里。"}</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-col gap-2 px-3 py-2.5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-muted text-brand">
                  <Bot className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-sm">测试聊天</CardTitle>
                  <p className="mt-0.5 text-xs text-muted">发送一条短消息，验证 API Key、Base URL、模型和 Responses 协议是否可用。</p>
                </div>
              </div>
              <Badge tone={testingChat ? "amber" : ready ? "green" : "gray"}>{testingChat ? "测试中" : ready ? "可测试" : "待配置"}</Badge>
            </CardHeader>
            <CardContent className="space-y-3 p-3">
              <div className="max-h-56 space-y-2 overflow-auto rounded-md border border-border bg-surface-muted p-3 thin-scrollbar">
                {chatMessages.map((message, index) => (
                  <div key={`${message.role}-${index}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                    <div
                      className={`max-w-[78%] whitespace-pre-wrap rounded-md px-3 py-2 text-sm leading-5 ${
                        message.role === "user" ? "bg-brand text-white" : "border border-border bg-white text-foreground"
                      }`}
                    >
                      {message.content}
                    </div>
                  </div>
                ))}
              </div>

              {chatError ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{chatError}</div> : null}

              <div className="grid grid-cols-1 gap-2 lg:grid-cols-[minmax(0,1fr)_130px]">
                <textarea
                  className={`${fieldClass} min-h-16 resize-y py-2`}
                  value={chatInput}
                  onChange={(event) => setChatInput(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      void sendTestChat();
                    }
                  }}
                  placeholder="输入测试消息"
                />
                <Button className="h-auto min-h-16" disabled={!chatInput.trim() || testingChat} onClick={sendTestChat}>
                  <Send className="h-4 w-4" />
                  {testingChat ? "发送中" : "发送测试"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>

        <WeComNotificationSettingsPanel />

      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

function readLocalAiSettings() {
  try {
    const saved = window.localStorage.getItem(aiSettingsStorageKey);

    return saved ? normalizeAiSettings(JSON.parse(saved) as Partial<AiModelSettings>) : null;
  } catch {
    return null;
  }
}

function readLocalAiImageSettings() {
  try {
    const saved = window.localStorage.getItem(aiImageSettingsStorageKey);

    return saved ? normalizeAiSettings(JSON.parse(saved) as Partial<AiModelSettings>) : null;
  } catch {
    return null;
  }
}

function readLocalAiProfiles() {
  try {
    const savedProfiles = window.localStorage.getItem(aiSettingsProfilesStorageKey);

    return savedProfiles ? normalizeSavedAiModelProfiles(JSON.parse(savedProfiles) as SavedAiModelProfile[]) : [];
  } catch {
    return [];
  }
}

function cacheAiSettings(settings: AiModelSettings, profiles: SavedAiModelProfile[]) {
  window.localStorage.setItem(aiSettingsStorageKey, JSON.stringify(settings));
  window.localStorage.setItem(aiSettingsProfilesStorageKey, JSON.stringify(profiles));
}

function cacheAiImageSettings(settings: AiModelSettings) {
  window.localStorage.setItem(aiImageSettingsStorageKey, JSON.stringify(settings));
}
