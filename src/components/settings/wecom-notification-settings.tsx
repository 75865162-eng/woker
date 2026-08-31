"use client";

import { useEffect, useMemo, useState } from "react";
import { BellRing, Check, RotateCcw, Save, Send, ShieldCheck } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  buildLaunchOverdueAlerts,
  buildWeComLaunchOverdueMarkdown,
  createSentRecords,
  defaultWeComNotificationSettings,
  normalizeWeComNotificationSettings,
  normalizeWeComNotificationSentRecords,
  validateWeComWebhookUrl,
  wecomNotificationSentStorageKey,
  wecomNotificationSettingsStorageKey,
  type WeComNotificationSentRecord,
  type WeComNotificationSettings,
} from "@/lib/notifications/wecom";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

const fieldClass =
  "h-9 w-full rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10";
const labelClass = "text-xs font-bold uppercase tracking-normal text-muted";
const wecomSettingsApiPath = "/api/notifications/wecom/settings";

export function WeComNotificationSettingsPanel() {
  const campaignGroups = useWorkspaceStore((state) => state.campaignGroups);
  const performanceRows = useWorkspaceStore((state) => state.performanceRows);
  const [settings, setSettings] = useState<WeComNotificationSettings>(defaultWeComNotificationSettings);
  const [savedAt, setSavedAt] = useState("");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let canceled = false;

    async function loadSettings() {
      try {
        const response = await fetch(wecomSettingsApiPath, { cache: "no-store" });
        if (!response.ok) throw new Error("无法从数据库读取企业微信通知设置。");

        const data = (await response.json()) as {
          settings?: Partial<WeComNotificationSettings>;
          sentRecords?: WeComNotificationSentRecord[];
          updatedAt?: string;
        };
        const normalized = normalizeWeComNotificationSettings(data.settings ?? null);
        const sentRecords = normalizeWeComNotificationSentRecords(data.sentRecords);

        if (canceled) return;
        setSettings(normalized);
        cacheSettings(normalized);
        cacheSentRecords(sentRecords);
        if (data.updatedAt) setSavedAt(new Date(data.updatedAt).toLocaleString("zh-CN", { hour12: false }));
      } catch {
        const saved = readCachedSettings();

        if (canceled) return;
        if (saved) setSettings(saved);
      }
    }

    void loadSettings();

    return () => {
      canceled = true;
    };
  }, []);

  const webhookReady = validateWeComWebhookUrl(settings.webhookUrl);
  const currentAlerts = useMemo(
    () =>
      buildLaunchOverdueAlerts({
        campaignGroups,
        performanceRows,
        launchOverdueDays: settings.launchOverdueDays,
        sentRecords: readSentRecords(),
        notifyOncePerDay: settings.notifyOncePerDay,
      }),
    [campaignGroups, performanceRows, settings.launchOverdueDays, settings.notifyOncePerDay],
  );

  function update<K extends keyof WeComNotificationSettings>(key: K, value: WeComNotificationSettings[K]) {
    setSettings((current) => normalizeWeComNotificationSettings({ ...current, [key]: value }));
    setStatus("");
    setError("");
  }

  function saveSettings() {
    const normalized = normalizeWeComNotificationSettings(settings);

    void persistSettings(normalized, readSentRecords()).then((ok) => {
      if (!ok) return;

      setSettings(normalized);
      setSavedAt(new Date().toLocaleString("zh-CN", { hour12: false }));
      setStatus("企业微信通知设置已保存。");
      setError("");
    });
  }

  function resetSettings() {
    void persistSettings(defaultWeComNotificationSettings, []).then((ok) => {
      if (!ok) return;

      window.localStorage.removeItem(wecomNotificationSettingsStorageKey);
      window.localStorage.removeItem(wecomNotificationSentStorageKey);
      setSettings(defaultWeComNotificationSettings);
      setSavedAt("");
      setStatus("企业微信通知设置已重置。");
      setError("");
    });
  }

  async function sendTestMessage() {
    await sendMarkdown("企业微信通知测试\n当前工作台已成功连接企业微信群机器人。", []);
  }

  async function scanAndSendLaunchAlerts() {
    if (!currentAlerts.length) {
      setStatus("当前没有需要发送的新品超期提醒。");
      setError("");
      return;
    }

    const message = buildWeComLaunchOverdueMarkdown({
      alerts: currentAlerts,
      launchOverdueDays: settings.launchOverdueDays,
    });

    await sendMarkdown(message, currentAlerts.map((alert) => alert.campaignGroupId));
  }

  async function sendMarkdown(message: string, sentCampaignGroupIds: string[]) {
    if (!webhookReady) {
      setError("请先填写有效的企业微信群机器人 Webhook。");
      return;
    }

    setSending(true);
    setStatus("");
    setError("");

    try {
      const response = await fetch("/api/notifications/wecom", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ webhookUrl: settings.webhookUrl, message }),
      });
      const data = (await response.json()) as { result?: { sent: boolean }; error?: string };

      if (!response.ok || !data.result?.sent) {
        throw new Error(data.error || "企业微信发送失败。");
      }

      if (settings.notifyOncePerDay && sentCampaignGroupIds.length) {
        const sentAt = new Date();
        const sentRecords = [
          ...createSentRecords(
            currentAlerts.filter((alert) => sentCampaignGroupIds.includes(alert.campaignGroupId)),
            sentAt,
          ),
          ...readSentRecords(),
        ].slice(0, 300);
        await persistSettings(normalizeWeComNotificationSettings(settings), sentRecords);
      }

      setStatus(sentCampaignGroupIds.length ? `已发送 ${sentCampaignGroupIds.length} 条新品超期提醒。` : "测试消息已发送。");
    } catch (error) {
      setError(error instanceof Error ? error.message : "企业微信发送失败。");
    } finally {
      setSending(false);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-2 px-3 py-2.5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-surface-muted text-brand">
            <BellRing className="h-4 w-4" />
          </div>
          <div>
            <CardTitle className="text-sm">企业微信通知</CardTitle>
            <p className="mt-0.5 text-xs text-muted">新品组超期后，把当前广告状态推送到企业微信群。</p>
          </div>
        </div>
        <Badge tone={settings.enabled && webhookReady ? "green" : webhookReady ? "amber" : "gray"}>
          {settings.enabled && webhookReady ? "已启用" : webhookReady ? "待启用" : "待配置"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3 p-3">
        <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_150px_140px]">
          <Field label="群机器人 Webhook">
            <input
              className={`${fieldClass} font-mono`}
              type="password"
              value={settings.webhookUrl}
              onChange={(event) => update("webhookUrl", event.target.value)}
              placeholder="https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=..."
            />
          </Field>
          <Field label="新品超期天数">
            <input
              className={fieldClass}
              inputMode="numeric"
              min={1}
              max={180}
              type="number"
              value={settings.launchOverdueDays}
              onChange={(event) => update("launchOverdueDays", Number(event.target.value))}
            />
          </Field>
          <div className="flex items-end">
            <label className="flex h-9 w-full items-center gap-2 rounded-md border border-border bg-white px-3 text-sm font-semibold text-foreground">
              <input
                checked={settings.enabled}
                onChange={(event) => update("enabled", event.target.checked)}
                type="checkbox"
              />
              启用通知
            </label>
          </div>
        </div>

        <label className="flex items-center gap-2 rounded-md border border-border bg-surface-muted px-3 py-2 text-sm font-semibold text-foreground">
          <input
            checked={settings.notifyOncePerDay}
            onChange={(event) => update("notifyOncePerDay", event.target.checked)}
            type="checkbox"
          />
          同一个广告组每天只提醒一次
        </label>

        <div className="grid grid-cols-[repeat(auto-fit,128px)] justify-start gap-2">
          <StatusItem label="新品组广告组" value={`${campaignGroups.filter((group) => group.lifecycleGroupId === "launch").length} 个`} />
          <StatusItem label="当前待提醒" value={`${currentAlerts.length} 个`} />
          <StatusItem label="Webhook" value={webhookReady ? "有效" : "未通过"} />
        </div>

        {status ? (
          <div className="flex items-center gap-2 rounded-md border border-green-200 bg-green-50 px-3 py-2 text-sm font-medium text-green-700">
            <Check className="h-4 w-4" />
            {status}
          </div>
        ) : null}
        {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">{error}</div> : null}

        <div className="flex flex-col gap-2 border-t border-border pt-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2 text-sm text-muted">
          <ShieldCheck className="h-4 w-4" />
          {savedAt ? <span>已保存：{savedAt}</span> : <span>配置优先保存在数据库，本机仅作缓存。</span>}
        </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={resetSettings}>
              <RotateCcw className="h-4 w-4" />
              重置
            </Button>
            <Button variant="secondary" disabled={!webhookReady || sending} onClick={sendTestMessage}>
              <Send className="h-4 w-4" />
              发测试
            </Button>
            <Button variant="secondary" onClick={saveSettings}>
              <Save className="h-4 w-4" />
              保存
            </Button>
            <Button disabled={!settings.enabled || !webhookReady || sending || !currentAlerts.length} onClick={scanAndSendLaunchAlerts}>
              <BellRing className="h-4 w-4" />
              {sending ? "发送中" : "扫描并发送"}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function readSentRecords(): WeComNotificationSentRecord[] {
  if (typeof window === "undefined") return [];

  try {
    const saved = window.localStorage.getItem(wecomNotificationSentStorageKey);

    return saved ? normalizeWeComNotificationSentRecords(JSON.parse(saved)) : [];
  } catch {
    return [];
  }
}

function readCachedSettings() {
  try {
    const saved = window.localStorage.getItem(wecomNotificationSettingsStorageKey);

    return saved ? normalizeWeComNotificationSettings(JSON.parse(saved) as Partial<WeComNotificationSettings>) : null;
  } catch {
    return null;
  }
}

function cacheSettings(settings: WeComNotificationSettings) {
  window.localStorage.setItem(wecomNotificationSettingsStorageKey, JSON.stringify(settings));
}

function cacheSentRecords(sentRecords: WeComNotificationSentRecord[]) {
  window.localStorage.setItem(wecomNotificationSentStorageKey, JSON.stringify(sentRecords));
}

async function persistSettings(settings: WeComNotificationSettings, sentRecords: WeComNotificationSentRecord[]) {
  try {
    const response = await fetch(wecomSettingsApiPath, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings, sentRecords }),
    });

    if (!response.ok) {
      throw new Error("企业微信通知设置保存失败。");
    }

    const data = (await response.json().catch(() => ({}))) as {
      settings?: Partial<WeComNotificationSettings>;
      sentRecords?: WeComNotificationSentRecord[];
    };
    const normalized = normalizeWeComNotificationSettings(data.settings ?? settings);
    const normalizedSentRecords = normalizeWeComNotificationSentRecords(data.sentRecords ?? sentRecords);

    cacheSettings(normalized);
    cacheSentRecords(normalizedSentRecords);
    return true;
  } catch {
    cacheSettings(settings);
    cacheSentRecords(sentRecords);
    return false;
  }
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1.5">
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
