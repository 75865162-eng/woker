"use client";

import { useEffect, useRef } from "react";
import {
  buildLaunchOverdueAlerts,
  buildWeComLaunchOverdueMarkdown,
  createSentRecords,
  normalizeWeComNotificationSettings,
  normalizeWeComNotificationSentRecords,
  validateWeComWebhookUrl,
  wecomNotificationSentStorageKey,
  wecomNotificationSettingsStorageKey,
  type WeComNotificationSentRecord,
  type WeComNotificationSettings,
} from "@/lib/notifications/wecom";

const scanIntervalMs = 30 * 60 * 1000;
const wecomSettingsApiPath = "/api/notifications/wecom/settings";

export function WeComNotificationRunner() {
  const inFlightRef = useRef(false);

  useEffect(() => {
    let disposed = false;

    async function scanAndSend() {
      if (disposed || inFlightRef.current) return;

      const { settings, sentRecords } = await readSettings();
      if (!settings.enabled || !validateWeComWebhookUrl(settings.webhookUrl)) return;

      const { useWorkspaceStore } = await import("@/lib/stores/workspace-store");
      const state = useWorkspaceStore.getState();
      if (!state.campaignGroups.length) return;

      const alerts = buildLaunchOverdueAlerts({
        campaignGroups: state.campaignGroups,
        performanceRows: state.performanceRows,
        launchOverdueDays: settings.launchOverdueDays,
        sentRecords,
        notifyOncePerDay: settings.notifyOncePerDay,
      });
      if (!alerts.length) return;

      inFlightRef.current = true;
      try {
        const response = await fetch("/api/notifications/wecom", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            webhookUrl: settings.webhookUrl,
            message: buildWeComLaunchOverdueMarkdown({
              alerts,
              launchOverdueDays: settings.launchOverdueDays,
            }),
          }),
        });
        const data = (await response.json().catch(() => ({}))) as { result?: { sent: boolean } };

        if (response.ok && data.result?.sent && settings.notifyOncePerDay) {
          const nextSentRecords = [...createSentRecords(alerts), ...sentRecords].slice(0, 300);
          cacheSentRecords(nextSentRecords);
          await persistSettings(settings, nextSentRecords);
        }
      } finally {
        inFlightRef.current = false;
      }
    }

    void scanAndSend();
    const timer = window.setInterval(() => {
      void scanAndSend();
    }, scanIntervalMs);

    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  return null;
}

async function readSettings(): Promise<{ settings: WeComNotificationSettings; sentRecords: WeComNotificationSentRecord[] }> {
  try {
    const response = await fetch(wecomSettingsApiPath, { cache: "no-store" });
    if (response.ok) {
      const data = (await response.json()) as {
        settings?: Partial<WeComNotificationSettings>;
        sentRecords?: WeComNotificationSentRecord[];
      };

      const settings = normalizeWeComNotificationSettings(data.settings ?? null);
      const sentRecords = normalizeWeComNotificationSentRecords(data.sentRecords);
      cacheSettings(settings);
      cacheSentRecords(sentRecords);
      return { settings, sentRecords };
    }
  } catch {
    // fall back below
  }

  return {
    settings: readCachedSettings(),
    sentRecords: readSentRecords(),
  };
}

function readSentRecords(): WeComNotificationSentRecord[] {
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

    return saved ? normalizeWeComNotificationSettings(JSON.parse(saved) as Partial<WeComNotificationSettings>) : normalizeWeComNotificationSettings(null);
  } catch {
    return normalizeWeComNotificationSettings(null);
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

    if (!response.ok) return;

    const data = (await response.json().catch(() => ({}))) as {
      settings?: Partial<WeComNotificationSettings>;
      sentRecords?: WeComNotificationSentRecord[];
    };
    const normalized = normalizeWeComNotificationSettings(data.settings ?? settings);
    const normalizedSentRecords = normalizeWeComNotificationSentRecords(data.sentRecords ?? sentRecords);
    cacheSettings(normalized);
    cacheSentRecords(normalizedSentRecords);
  } catch {
    cacheSettings(settings);
    cacheSentRecords(sentRecords);
  }
}
