"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { tx, type Locale } from "@/lib/lili/tx";
import { defaultXiyouSettings, type XiyouPublicSettings } from "@/lib/lili/tool-config";
import { defaultSellerSpriteMcpSettings, type SellerSpriteMcpPublicSettings } from "@/lib/integrations/sellersprite";

function SellerSpriteConfigCard() {
  const [settings, setSettings] = useState({ ...defaultSellerSpriteMcpSettings });
  const [saved, setSaved] = useState<SellerSpriteMcpPublicSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch("/api/integrations/sellersprite", { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const data = await response.json();
      if (!response.ok || !data.settings) throw new Error(data.error || "卖家精灵配置读取失败。");
      setSaved(data.settings);
      setSettings({ ...defaultSellerSpriteMcpSettings, ...data.settings, apiKey: "" });
      setMessage("");
    }).catch((error) => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "卖家精灵配置读取失败。"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);
  async function save() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/integrations/sellersprite", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ settings: {
        enabled: settings.enabled, serverUrl: settings.serverUrl, apiKey: settings.apiKey,
        marketplace: settings.marketplace, timeoutSeconds: settings.timeoutSeconds, protocolVersion: settings.protocolVersion,
      } }) });
      const data = await response.json();
      if (!response.ok || !data.settings) throw new Error(data.error || "卖家精灵配置保存失败。");
      setSaved(data.settings);
      setSettings({ ...defaultSellerSpriteMcpSettings, ...data.settings, apiKey: "" });
      setMessage("已保存卖家精灵配置；尚未验证连接。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "卖家精灵配置保存失败。"); }
    finally { setBusy(false); }
  }
  return <section className="lili-card space-y-3 p-5" aria-label="卖家精灵 SellerSprite">
    <h2 className="text-base font-bold">卖家精灵 SellerSprite</h2>
    <p className="text-sm">与主系统设置共用同一配置。填写「我的密钥」中的 secret-key；留空保留已保存密钥。</p>
    <p className="text-sm">{loading ? "正在读取配置…" : saved?.hasApiKey ? "已保存密钥；不代表已连接。" : "尚未保存密钥。"}</p>
    <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <fieldset disabled={loading || busy || !saved} className="space-y-3 disabled:opacity-60">
        <label className="flex items-center gap-2"><input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} />启用卖家精灵 MCP</label>
        <label className="block text-sm">SellerSprite MCP URL<input className="lili-field mt-1 w-full" placeholder="https://mcp.sellersprite.com/mcp" value={settings.serverUrl} onChange={(event) => setSettings({ ...settings, serverUrl: event.target.value })} /></label>
        <label className="block text-sm">SellerSprite secret-key<input type="password" autoComplete="new-password" className="lili-field mt-1 w-full" value={settings.apiKey} placeholder={saved?.hasApiKey ? "已保存；留空保留原密钥" : "填写 secret-key"} onChange={(event) => setSettings({ ...settings, apiKey: event.target.value })} /></label>
        <label className="block text-sm">站点<input className="lili-field mt-1 w-full" value={settings.marketplace} onChange={(event) => setSettings({ ...settings, marketplace: event.target.value.toUpperCase() })} /></label>
        <details className="rounded border p-3"><summary>高级 MCP 配置</summary><div className="mt-3 space-y-3">
          <label className="block text-sm">超时（秒）<input type="number" min={5} max={180} className="lili-field mt-1 w-full" value={settings.timeoutSeconds} onChange={(event) => setSettings({ ...settings, timeoutSeconds: Number(event.target.value) })} /></label>
          <label className="block text-sm">协议版本<input className="lili-field mt-1 w-full" value={settings.protocolVersion} onChange={(event) => setSettings({ ...settings, protocolVersion: event.target.value })} /></label>
        </div></details>
        <button type="submit" className="lili-btn-orange">{busy ? "处理中…" : "保存卖家精灵配置"}</button>
      </fieldset>
    </form>
    <Link className="underline text-sm" href="/settings?tab=models">打开主系统模型设置</Link>
    <p className="text-xs text-muted">主系统现有连接测试接口仍返回尚未实现；此处不会把保存成功显示为连接成功。Lili 业务工具执行器仍须逐项接入。</p>
    <p role="status" aria-live="polite" className="text-sm">{message}</p>
    {!loading && !saved && <button className="lili-btn-ghost" onClick={() => setRetry(retry + 1)}>重新读取卖家精灵配置</button>}
  </section>;
}

export function ToolConfigView({ locale }: { locale: Locale }) {
  const [settings, setSettings] = useState({ ...defaultXiyouSettings });
  const [saved, setSaved] = useState<XiyouPublicSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    fetch("/api/lili/tool-config", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok || !data.settings) throw new Error(data.message || "配置读取失败，请重试。");
        setSaved(data.settings);
        setSettings({ ...defaultXiyouSettings, ...data.settings, mcpToken: "", clientSecret: "" });
        setMessage("");
      }).catch((error) => { if (!controller.signal.aborted) setMessage(error instanceof Error ? error.message : "配置读取失败。"); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [retry]);

  async function submit(test: boolean) {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/lili/tool-config${test ? "/test" : ""}`, {
        method: test ? "POST" : "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "xiyou", ...(!test ? { settings: {
          enabled: settings.enabled, mcpUrl: settings.mcpUrl, mcpToken: settings.mcpToken,
          openapiBase: settings.openapiBase, clientId: settings.clientId, clientSecret: settings.clientSecret,
        } } : {}) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || "请求失败，请重试。");
      if (!test) {
        setSaved(data.settings);
        setSettings({ ...defaultXiyouSettings, ...data.settings, mcpToken: "", clientSecret: "" });
      }
      setMessage(data.message || (test ? "连接测试完成。" : "已保存；连接状态尚未验证。"));
    } catch (error) { setMessage(error instanceof Error ? error.message : "请求失败，请重试。"); }
    finally { setBusy(false); }
  }

  return <div className="lili-config mx-auto max-w-6xl space-y-5">
    <h1 className="text-xl font-bold">{tx(locale, "工具配置", "Tool configuration")}</h1>
    <p className="text-sm text-muted">配置按组织、工作区和用户隔离，本页使用默认工作区。旧 Lili 密钥未自动导入；保存配置不会自动运行工具或工作流。</p>
    <SellerSpriteConfigCard />
    <section className="lili-card space-y-3 p-5" aria-label="西柚洞察">
      <h2 className="text-base font-bold">西柚洞察（西柚找词）</h2>
      <p className="text-sm">填写西柚 MCP 控制台生成的 MCP Token，不含 Bearer 前缀。OpenAPI 密钥不能代替 MCP Token。</p>
      <div className="flex gap-4 text-sm"><a href="https://platform.xydc.com/mcp" target="_blank" rel="noreferrer" className="underline">获取 MCP Token</a><a href="https://platform.xydc.com/docs/mcp-access" target="_blank" rel="noreferrer" className="underline">MCP 接入文档</a></div>
      <details className="rounded border p-3"><summary>外部客户端 JSON 配置示例</summary><pre className="mt-3 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ mcpServers: { "xydc-mcp": { url: defaultXiyouSettings.mcpUrl, headers: { Authorization: "Bearer YOUR_MCP_TOKEN" } } } }, null, 2)}</pre><p className="mt-2 text-xs">YOUR_MCP_TOKEN 仅为占位符，示例不会读取已保存 Token。</p></details>
      <p className="text-sm">{loading ? "正在读取配置…" : saved?.configured ? "已保存 Token；不代表已连接。" : "尚未保存 Token。"}</p>
      <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void submit(false); }}>
        <fieldset disabled={loading || busy || !saved} className="space-y-3 disabled:opacity-60">
          <label className="flex items-center gap-2"><input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} />启用西柚 MCP</label>
          <label className="block text-sm">远程 MCP 地址<input className="lili-field mt-1 w-full" value={settings.mcpUrl} readOnly /></label>
          <label className="block text-sm">MCP Token<input type="password" autoComplete="new-password" className="lili-field mt-1 w-full" value={settings.mcpToken} placeholder={saved?.hasMcpToken ? "已保存；留空保留原 Token" : "填写 MCP Token"} onChange={(event) => setSettings({ ...settings, mcpToken: event.target.value })} /></label>
          <details className="rounded border p-3"><summary>独立 OpenAPI 配置（可选，非 MCP 接入）</summary><div className="mt-3 space-y-3">
            <label className="block text-sm">OpenAPI 根地址<input className="lili-field mt-1 w-full" value={settings.openapiBase} readOnly /></label>
            <label className="block text-sm">OpenAPI Client ID<input className="lili-field mt-1 w-full" value={settings.clientId} onChange={(event) => setSettings({ ...settings, clientId: event.target.value })} /></label>
            <label className="block text-sm">OpenAPI Client Secret<input type="password" autoComplete="new-password" className="lili-field mt-1 w-full" value={settings.clientSecret} placeholder={saved?.hasClientSecret ? "已保存；留空保留原密钥" : "填写 Client Secret（可选）"} onChange={(event) => setSettings({ ...settings, clientSecret: event.target.value })} /></label>
          </div></details>
          <div className="flex flex-wrap gap-3"><button type="submit" className="lili-btn-orange">{busy ? "处理中…" : "保存西柚配置"}</button><button type="button" className="lili-btn-ghost" disabled={!saved?.enabled || !saved?.configured || Boolean(settings.mcpToken) || Boolean(settings.clientSecret) || settings.enabled !== saved?.enabled || settings.clientId !== saved?.clientId} onClick={() => void submit(true)}>测试已保存连接</button></div>
        </fieldset>
      </form>
      <p className="text-xs text-muted">Token 与 Client Secret 加密保存，不回显原文。测试连接会向西柚发送已保存凭证；不执行业务工具。</p>
      <p role="status" className="text-sm" aria-live="polite">{message}</p>
      {!loading && !saved && <button className="lili-btn-ghost" onClick={() => setRetry(retry + 1)}>重新读取配置</button>}
    </section>
    <section className="lili-card space-y-2 p-5"><h2 className="font-semibold">其他原配置入口</h2><p className="text-sm">粒粒 Lili MCP：个人 Amazon 凭证在<Link className="underline" href="/operations">同步中心</Link>维护，旧 Lili MCP 的工具范围尚未等价接入。Sorftime：原版无独立直连执行器，保留待接入状态。</p><Link className="underline text-sm" href="/lili/v2/tools">查看工具目录与执行状态</Link></section>
  </div>;
}
