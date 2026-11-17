"use client";

import { useEffect, useRef, useState } from "react";
import { defaultSellerSpriteMcpSettings, normalizeSellerSpriteMcpSettings, type SellerSpriteMcpPublicSettings, type SellerSpriteMcpSettings } from "@/lib/integrations/sellersprite";
import type { SellerSpriteMcpState } from "./use-settings-workbench-model";

export function useSellerSpriteSettings() {
  const [settings, setSettings] = useState<SellerSpriteMcpState>({
    ...defaultSellerSpriteMcpSettings,
    hasApiKey: false,
    configured: false,
  });
  const [showSecret, setShowSecret] = useState(false);
  const [savedAt, setSavedAt] = useState("");
  const [error, setError] = useState("");
  const [testMessage, setTestMessage] = useState("");
  const [testing, setTesting] = useState(false);
  const revision = useRef(0);
  const mounted = useRef(false);
  const saveInFlight = useRef(false);
  const testInFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    mounted.current = true;
    const startedRevision = revision.current;

    async function restoreSettings() {
      try {
        const response = await fetch("/api/integrations/sellersprite");
        if (!response.ok) throw new Error("无法从数据库读取 SellerSprite MCP 配置。");
        const data = (await response.json()) as { settings?: SellerSpriteMcpPublicSettings };
        const publicSettings = data.settings;
        if (!publicSettings || cancelled || startedRevision !== revision.current) return;

        setSettings({
          ...normalizeSellerSpriteMcpSettings({
            enabled: publicSettings.enabled,
            serverUrl: publicSettings.serverUrl,
            marketplace: publicSettings.marketplace,
            timeoutSeconds: publicSettings.timeoutSeconds,
            protocolVersion: publicSettings.protocolVersion,
          }),
          apiKey: "",
          hasApiKey: publicSettings.hasApiKey,
          configured: publicSettings.configured,
        });
      } catch (cause) {
        if (!cancelled && startedRevision === revision.current) setError(cause instanceof Error ? cause.message : "SellerSprite MCP 配置加载失败。");
      }
    }

    void restoreSettings();
    return () => { cancelled = true; mounted.current = false; };
  }, []);

  const ready = settings.enabled && settings.serverUrl.trim().startsWith("http") && (settings.apiKey.trim().length > 0 || settings.hasApiKey);

  function update<K extends keyof SellerSpriteMcpSettings>(key: K, value: SellerSpriteMcpSettings[K]) {
    revision.current++;
    setSavedAt("");
    setTestMessage("");
    setError("");
    setSettings((current) => ({ ...current, [key]: value, configured: false }));
  }

  async function save() {
    if (!mounted.current || saveInFlight.current || testInFlight.current) return;
    saveInFlight.current = true;
    const startedRevision = ++revision.current;
    const normalized = normalizeSellerSpriteMcpSettings(settings);
    try {
      const response = await fetch("/api/integrations/sellersprite", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: normalized }),
      });
      const data = (await response.json().catch(() => ({}))) as { settings?: SellerSpriteMcpPublicSettings; error?: string };
      if (!mounted.current || startedRevision !== revision.current) return;
      if (!response.ok || !data.settings) throw new Error(data.error || "SellerSprite MCP 配置保存失败。");
      setSettings({
        ...normalizeSellerSpriteMcpSettings({
          enabled: data.settings.enabled,
          serverUrl: data.settings.serverUrl,
          marketplace: data.settings.marketplace,
          timeoutSeconds: data.settings.timeoutSeconds,
          protocolVersion: data.settings.protocolVersion,
        }),
        apiKey: "",
        hasApiKey: data.settings.hasApiKey,
        configured: data.settings.configured,
      });
      setSavedAt(new Date().toLocaleString("zh-CN", { hour12: false }));
      setError("");
    } catch (cause) {
      if (mounted.current && startedRevision === revision.current) setError(cause instanceof Error ? cause.message : "SellerSprite MCP 配置保存失败。");
    } finally {
      saveInFlight.current = false;
    }
  }

  async function test() {
    if (!mounted.current || saveInFlight.current || testInFlight.current) return;
    testInFlight.current = true;
    const startedRevision = revision.current;
    const normalized = normalizeSellerSpriteMcpSettings(settings);
    setTesting(true);
    setError("");
    setTestMessage("");
    try {
      const response = await fetch("/api/integrations/sellersprite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: normalized }),
      });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; message?: string; error?: string };
      if (!mounted.current || startedRevision !== revision.current) return;
      if (!response.ok) throw new Error(data.error || "SellerSprite MCP 测试失败。");
      setTestMessage(data.message || (data.ok ? "SellerSprite MCP 测试成功。" : "SellerSprite MCP 配置待完善。"));
    } catch (cause) {
      if (mounted.current && startedRevision === revision.current) setError(cause instanceof Error ? cause.message : "SellerSprite MCP 测试失败。");
    } finally {
      testInFlight.current = false;
      if (mounted.current) setTesting(false);
    }
  }

  return { ready, settings, update, showSecret, setShowSecret, savedAt, error, testMessage, testing, save, test };
}
