"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bot,
  Check,
  ChevronDown,
  Clipboard,
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
  aiSettingsProfilesStorageKey,
  aiProviderOptions,
  createAiProfileName,
  defaultAiModelSettings,
  getProviderLabel,
  normalizeAiSettings,
  toPublicAiSettings,
  type AiModelSettings,
  type SavedAiModelProfile,
} from "@/lib/ai-settings";

const fieldClass =
  "w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10";
const labelClass = "text-xs font-bold uppercase tracking-normal text-muted";

export function SettingsWorkbench() {
  const [settings, setSettings] = useState<AiModelSettings>(defaultAiModelSettings);
  const [showSecret, setShowSecret] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [copied, setCopied] = useState(false);
  const [chatInput, setChatInput] = useState("请用一句话回复：AI 大模型配置测试成功。");
  const [chatMessages, setChatMessages] = useState<Array<{ role: "user" | "assistant"; content: string }>>([
    { role: "assistant", content: "保存配置后，可以在这里发送一条测试消息验证连接。" },
  ]);
  const [testingChat, setTestingChat] = useState(false);
  const [chatError, setChatError] = useState("");
  const [profiles, setProfiles] = useState<SavedAiModelProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState("");

  useEffect(() => {
    const saved = window.localStorage.getItem(aiSettingsStorageKey);
    if (saved) {
      const parsed = normalizeAiSettings(JSON.parse(saved) as Partial<AiModelSettings>);
      setSettings(parsed);
    }

    const savedProfiles = window.localStorage.getItem(aiSettingsProfilesStorageKey);
    if (savedProfiles) {
      setProfiles(
        (JSON.parse(savedProfiles) as SavedAiModelProfile[]).map((profile) => ({
          ...profile,
          settings: profile.settings.provider === "custom" ? normalizeBeforeSave(profile.settings) : normalizeAiSettings(profile.settings),
        })),
      );
    } else {
      const builtInProfile = createProfile(defaultAiModelSettings);
      window.localStorage.setItem(aiSettingsProfilesStorageKey, JSON.stringify([builtInProfile]));
      setProfiles([builtInProfile]);
      setActiveProfileId(builtInProfile.id);
    }
  }, []);

  const publicSettings = useMemo(() => toPublicAiSettings(normalizeAiSettings(settings)), [settings]);
  const ready = settings.enabled && settings.apiKey.trim().length > 0 && settings.baseUrl.trim().startsWith("http") && settings.model.trim().length > 0;

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

  function saveSettings() {
    const normalized = normalizeBeforeSave(settings);
    const now = new Date().toISOString();
    const existingProfileId = activeProfileId || profiles.find((profile) => profile.settings.provider === normalized.provider)?.id || "";
    const nextProfile = existingProfileId
      ? {
          id: existingProfileId,
          name: createAiProfileName(normalized),
          createdAt: profiles.find((profile) => profile.id === existingProfileId)?.createdAt ?? now,
          updatedAt: now,
          settings: normalized,
        }
      : createProfile(normalized, now);
    const nextProfiles = [nextProfile, ...profiles.filter((profile) => profile.id !== nextProfile.id)].slice(0, 20);

    window.localStorage.setItem(aiSettingsStorageKey, JSON.stringify(normalized));
    window.localStorage.setItem(aiSettingsProfilesStorageKey, JSON.stringify(nextProfiles));
    setSettings(normalized);
    setProfiles(nextProfiles);
    setActiveProfileId(nextProfile.id);
    setSavedAt(new Date().toLocaleString("zh-CN", { hour12: false }));
  }

  function resetSettings() {
    window.localStorage.removeItem(aiSettingsStorageKey);
    setSettings(defaultAiModelSettings);
    setActiveProfileId("");
    setSavedAt("");
  }

  function loadProfile(profile: SavedAiModelProfile) {
    const normalized = profile.settings.provider === "custom" ? normalizeBeforeSave(profile.settings) : normalizeAiSettings(profile.settings);
    window.localStorage.setItem(aiSettingsStorageKey, JSON.stringify(normalized));
    setSettings(normalized);
    setActiveProfileId(profile.id);
    setSavedAt("");
    setChatError("");
  }

  function deleteProfile(profileId: string) {
    const nextProfiles = profiles.filter((profile) => profile.id !== profileId);
    window.localStorage.setItem(aiSettingsProfilesStorageKey, JSON.stringify(nextProfiles));
    setProfiles(nextProfiles);

    if (activeProfileId === profileId) {
      setActiveProfileId("");
    }
  }

  async function copyPublicSettings() {
    await navigator.clipboard.writeText(JSON.stringify(publicSettings, null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
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
      <div className="space-y-5">
        <section className="grid grid-cols-1 gap-5 2xl:grid-cols-[260px_minmax(0,1fr)_380px]">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <FolderOpen className="h-5 w-5 text-brand" />
                <CardTitle>已保存配置</CardTitle>
              </div>
              <Badge tone="gray">{profiles.length} 个</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              {profiles.length ? (
                profiles.map((profile) => {
                  const active = profile.id === activeProfileId;

                  return (
                    <div key={profile.id} className={`rounded-md border p-3 ${active ? "border-brand bg-brand/5" : "border-border bg-white"}`}>
                      <button className="w-full text-left" onClick={() => loadProfile(profile)} type="button">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-bold text-foreground">{profile.name}</p>
                          {active ? <Badge tone="green">当前</Badge> : null}
                        </div>
                        <p className="mt-1 truncate text-xs text-muted">{profile.settings.baseUrl}</p>
                        <p className="mt-1 text-xs text-muted">{profile.settings.wireApi}</p>
                      </button>
                      <Button className="mt-3 w-full" size="sm" variant="secondary" onClick={() => deleteProfile(profile.id)}>
                        <Trash2 className="h-4 w-4" />
                        删除
                      </Button>
                    </div>
                  );
                })
              ) : (
                <p className="text-sm leading-6 text-muted">暂无保存配置。点击保存配置后会出现在这里。</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-md bg-brand text-white">
                  <Bot className="h-5 w-5" />
                </div>
                <div>
                  <CardTitle>AI 大模型配置</CardTitle>
                  <p className="mt-1 text-sm text-muted">按 OpenAI 兼容 Responses 协议提交，其他功能会统一读取这里的配置。</p>
                </div>
              </div>
              <Badge tone={ready ? "green" : "amber"}>{ready ? "可调用" : "待完善"}</Badge>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-bold text-foreground">预设供应商</p>
                    <p className="mt-1 text-xs text-muted">选择供应商后只需要粘贴 API Key，再点击保存配置。</p>
                  </div>
                  <Button variant="secondary" size="sm" onClick={applyDeepseekPreset}>
                    <Zap className="h-4 w-4" />
                    推荐
                  </Button>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {aiProviderOptions.map((provider) => {
                    const active = settings.provider === provider.id;

                    return (
                      <button
                        key={provider.id}
                        className={`relative flex min-h-16 items-center gap-3 rounded-md border px-4 py-3 text-left transition ${
                          active ? "border-brand bg-brand text-white shadow-sm" : "border-border bg-surface-muted hover:border-brand hover:bg-white"
                        }`}
                        onClick={() => applyProviderPreset(provider.id)}
                        type="button"
                      >
                        <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-xs font-black ${active ? "bg-white text-brand" : provider.accentClass}`}>
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

              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.8fr]">
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
                className="flex w-full items-center justify-between rounded-md border border-border px-4 py-3 text-left transition hover:bg-surface-muted"
                onClick={() => setShowAdvanced((current) => !current)}
                type="button"
              >
                <div className="flex items-center gap-3">
                  <SlidersHorizontal className="h-4 w-4 text-brand" />
                  <div>
                    <p className="text-sm font-bold text-foreground">高级连接参数</p>
                    <p className="mt-1 text-xs text-muted">默认不用改；只有换供应商或模型时再调整。</p>
                  </div>
                </div>
                <ChevronDown className={`h-4 w-4 text-muted transition ${showAdvanced ? "rotate-180" : ""}`} />
              </button>

              {showAdvanced ? (
                <div className="grid grid-cols-1 gap-4 rounded-md border border-border bg-surface-muted p-4 xl:grid-cols-3">
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

              <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-muted">
                  {savedAt ? <span>已保存：{savedAt}</span> : <span>填写 API Key 后点击保存，Listing AI 会立即使用新配置。</span>}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={resetSettings}>
                    <RotateCcw className="h-4 w-4" />
                    重置
                  </Button>
                  <Button onClick={saveSettings} disabled={!settings.apiKey.trim()}>
                    <Save className="h-4 w-4" />
                    保存配置
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>调用摘要</CardTitle>
              <Badge tone={publicSettings.hasApiKey ? "green" : "gray"}>{publicSettings.hasApiKey ? "Key 已就绪" : "未填 Key"}</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <StatusItem label="供应商" value={getProviderLabel(publicSettings.provider)} />
                <StatusItem label="协议" value={publicSettings.wireApi} />
                <StatusItem label="模型" value={publicSettings.model} />
                <StatusItem label="状态" value={ready ? "ready" : "setup"} />
              </div>
              <pre className="max-h-52 overflow-auto rounded-md border border-border bg-surface-muted p-3 text-xs leading-5 text-foreground thin-scrollbar">
                {JSON.stringify(publicSettings, null, 2)}
              </pre>
              <Button className="w-full" variant="secondary" onClick={copyPublicSettings}>
                {copied ? <Check className="h-4 w-4" /> : <Clipboard className="h-4 w-4" />}
                {copied ? "已复制" : "复制调用摘要"}
              </Button>
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-md bg-surface-muted text-brand">
                <Bot className="h-5 w-5" />
              </div>
              <div>
                <CardTitle>测试聊天</CardTitle>
                <p className="mt-1 text-sm text-muted">发送一条短消息，验证 API Key、Base URL、模型和 Responses 协议是否可用。</p>
              </div>
            </div>
            <Badge tone={testingChat ? "amber" : ready ? "green" : "gray"}>{testingChat ? "测试中" : ready ? "可测试" : "待配置"}</Badge>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="max-h-80 space-y-3 overflow-auto rounded-md border border-border bg-surface-muted p-4 thin-scrollbar">
              {chatMessages.map((message, index) => (
                <div key={`${message.role}-${index}`} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[78%] whitespace-pre-wrap rounded-md px-4 py-3 text-sm leading-6 ${
                      message.role === "user" ? "bg-brand text-white" : "border border-border bg-white text-foreground"
                    }`}
                  >
                    {message.content}
                  </div>
                </div>
              ))}
            </div>

            {chatError ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{chatError}</div> : null}

            <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_150px]">
              <textarea
                className={`${fieldClass} min-h-20 resize-y`}
                value={chatInput}
                onChange={(event) => setChatInput(event.target.value)}
                onKeyDown={(event) => {
                  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                    void sendTestChat();
                  }
                }}
                placeholder="输入测试消息"
              />
              <Button className="h-auto min-h-20" disabled={!chatInput.trim() || testingChat} onClick={sendTestChat}>
                <Send className="h-4 w-4" />
                {testingChat ? "发送中" : "发送测试"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <WeComNotificationSettingsPanel />

      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-2">
      <span className={labelClass}>{label}</span>
      {children}
    </label>
  );
}

function StatusItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border px-3 py-2">
      <p className="text-xs font-bold text-muted">{label}</p>
      <p className="mt-1 truncate text-sm font-bold text-foreground">{value}</p>
    </div>
  );
}

function createProfile(settings: AiModelSettings, timestamp = new Date().toISOString()): SavedAiModelProfile {
  const normalized = normalizeAiSettings(settings);

  return {
    id: `${normalized.provider}-${normalized.model}-${Date.now()}`,
    name: createAiProfileName(normalized),
    createdAt: timestamp,
    updatedAt: timestamp,
    settings: normalized,
  };
}
