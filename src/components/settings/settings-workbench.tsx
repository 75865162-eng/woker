"use client";

import { Bot, ChevronDown, FolderOpen, Eye, EyeOff, KeyRound, Link2, PlugZap, RotateCcw, Save, Send, SlidersHorizontal, Trash2, Zap } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { aiProviderOptions, type AiModelSettings } from "@/lib/ai-settings";
import { fieldClass } from "./use-settings-workbench-model";
import { useSettingsWorkbench } from "./use-settings-workbench";
import { Field } from "./settings-field";
export function SettingsWorkbench() {
const { ready, applyDeepseekPreset, settings, applyProviderPreset, profileName, setProfileName, showSecret, update, setShowSecret, setShowAdvanced, showAdvanced, settingsError, savedAt, resetSettings, saveSettings, imageReady, showImageSecret, imageSettings, setImageSettings, setShowImageSecret, setShowImageAdvanced, showImageAdvanced, imageSettingsError, imageSavedAt, resetImageSettings, saveImageSettings, sellerSpriteReady, sellerSpriteSettings, updateSellerSprite, showSellerSpriteSecret, setShowSellerSpriteSecret, sellerSpriteError, sellerSpriteTestMessage, sellerSpriteSavedAt, testSellerSpriteSettings, testingSellerSprite, saveSellerSpriteSettings, profiles, activeProfileId, loadProfile, deleteProfile, settingsLoading, testingChat, chatMessages, chatError, chatInput, setChatInput, sendTestChat } = useSettingsWorkbench();
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
                          active ? "border-brand bg-brand text-white shadow-sm" : "border-border bg-surface-muted hover:border-brand hover:bg-surface"
                        }`}
                        onClick={() => applyProviderPreset(provider.id)}
                        type="button"
                      >
                        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-label font-black ${active ? "bg-surface text-brand" : provider.accentClass}`}>
                          {provider.shortLabel}
                        </span>
                        <span className="min-w-0">
                          <span className={`block truncate text-sm font-bold ${active ? "text-white" : "text-foreground"}`}>{provider.label}</span>
                          <span className={`mt-0.5 block truncate text-xs ${active ? "text-white/80" : "text-muted"}`}>{provider.model}</span>
                        </span>
                        {provider.recommended ? <span className="absolute right-2 top-2 rounded-full bg-accent px-1.5 py-0.5 text-label font-black text-white">荐</span> : null}
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
                  {settingsError ? <span className="text-danger-ink">{settingsError}</span> : savedAt ? <span>已保存：{savedAt}</span> : null}
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

              <details className="border-t border-border pt-3">
                <summary className="cursor-pointer text-sm font-semibold text-foreground">生图预设 <span className="ml-2 text-xs font-medium text-muted">{imageReady ? "可调用" : "待完善"}</span></summary>
                <div className="pt-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-bold text-foreground">生图预设</p>
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
                    {imageSettingsError ? <span className="text-danger-ink">{imageSettingsError}</span> : imageSavedAt ? <span>已保存：{imageSavedAt}</span> : null}
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
              </details>
            </CardContent>
          </Card>
        </section>

        <section className="grid grid-cols-1 gap-3">
          <Card>
            <CardHeader className="flex flex-col gap-2 px-3 py-2.5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-muted text-brand">
                  <PlugZap className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-sm">外部工具 / MCP 配置</CardTitle>
                </div>
              </div>
              <Badge tone={sellerSpriteReady ? "amber" : "gray"}>{sellerSpriteReady ? "配置已填写，连接未验证" : "待配置"}</Badge>
            </CardHeader>
            <CardContent className="space-y-3 p-3">
              <div className="grid grid-cols-1 gap-3 xl:grid-cols-[0.7fr_1.4fr_0.9fr]">
                <Field label="启用">
                  <label className="flex h-9 items-center gap-2 rounded-md border border-border bg-surface px-3 text-sm font-semibold text-foreground">
                    <input
                      checked={sellerSpriteSettings.enabled}
                      onChange={(event) => updateSellerSprite("enabled", event.target.checked)}
                      type="checkbox"
                    />
                    SellerSprite MCP
                  </label>
                </Field>
                <Field label="MCP Server URL">
                  <div className="relative">
                    <Link2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                    <input
                      className={`${fieldClass} pl-9`}
                      value={sellerSpriteSettings.serverUrl}
                      onChange={(event) => updateSellerSprite("serverUrl", event.target.value)}
                      placeholder="https://mcp.sellersprite.com/mcp"
                    />
                  </div>
                </Field>
                <Field label="Marketplace">
                  <input
                    className={fieldClass}
                    value={sellerSpriteSettings.marketplace}
                    onChange={(event) => updateSellerSprite("marketplace", event.target.value.toUpperCase())}
                    placeholder="US"
                  />
                </Field>
              </div>

              <Field label="Secret Key">
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
                  <input
                    className={`${fieldClass} pl-9 pr-11 font-mono`}
                    type={showSellerSpriteSecret ? "text" : "password"}
                    value={sellerSpriteSettings.apiKey}
                    onChange={(event) => updateSellerSprite("apiKey", event.target.value)}
                    placeholder={sellerSpriteSettings.hasApiKey ? "已保存，留空则保留" : "粘贴 secret-key"}
                  />
                  <button
                    className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-muted hover:bg-surface-muted hover:text-foreground"
                    onClick={() => setShowSellerSpriteSecret((current) => !current)}
                    title={showSellerSpriteSecret ? "隐藏密钥" : "显示密钥"}
                    type="button"
                  >
                    {showSellerSpriteSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </Field>

              <details>
                <summary className="cursor-pointer text-sm font-semibold text-foreground">高级参数</summary>
              <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-[1.2fr_0.7fr_0.8fr]">
                <Field label="超时秒数">
                  <input
                    className={fieldClass}
                    min={5}
                    max={180}
                    inputMode="decimal"
                    type="text"
                    value={sellerSpriteSettings.timeoutSeconds}
                    onChange={(event) => updateSellerSprite("timeoutSeconds", Number(event.target.value))}
                  />
                </Field>
                <Field label="协议版本">
                  <input
                    className={fieldClass}
                    value={sellerSpriteSettings.protocolVersion}
                    onChange={(event) => updateSellerSprite("protocolVersion", event.target.value)}
                    placeholder="streamableHttp"
                  />
                </Field>
              </div>
              </details>

              {sellerSpriteError ? <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm font-medium text-danger-ink">{sellerSpriteError}</div> : null}
              {sellerSpriteTestMessage ? <div className="rounded-md border border-warning-ink/30 bg-warning-soft px-3 py-2 text-sm font-medium text-warning-ink">{sellerSpriteTestMessage}</div> : null}

              <div className="flex flex-col gap-2 border-t border-border pt-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="text-sm text-muted">
                  {sellerSpriteSavedAt ? <span>已保存：{sellerSpriteSavedAt}</span> : null}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="secondary" onClick={() => void testSellerSpriteSettings()} disabled={testingSellerSprite}>
                    <Send className="h-4 w-4" />
                    {testingSellerSprite ? "测试中" : "测试连接"}
                  </Button>
                  <Button onClick={() => void saveSellerSpriteSettings()}>
                    <Save className="h-4 w-4" />
                    保存 MCP 配置
                  </Button>
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
            <details>
            <summary className="cursor-pointer list-none px-3 pb-2 text-xs font-semibold text-muted">{profiles.length} 个配置 · 展开管理</summary>
            <CardContent className="space-y-2 p-3 pt-0">
              {profiles.length ? (
                profiles.map((profile) => {
                  const active = profile.id === activeProfileId;

                return (
                  <div key={profile.id} className={`rounded-md border p-2.5 ${active ? "border-brand bg-brand/5" : "border-border bg-surface"}`}>
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
            </details>
          </Card>

          <Card>
            <details>
            <summary className="cursor-pointer px-3 py-2 text-sm font-semibold text-brand">测试连接</summary>
            <CardHeader className="flex flex-col gap-2 px-3 py-2.5 lg:flex-row lg:items-center lg:justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-muted text-brand">
                  <Bot className="h-4 w-4" />
                </div>
                <div>
                  <CardTitle className="text-sm">测试聊天</CardTitle>
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
                        message.role === "user" ? "bg-brand text-white" : "border border-border bg-surface text-foreground"
                      }`}
                    >
                      {message.content}
                    </div>
                  </div>
                ))}
              </div>

              {chatError ? <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm font-medium text-danger-ink">{chatError}</div> : null}

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
            </details>
          </Card>
        </section>

      </div>
    </>
  );
}
