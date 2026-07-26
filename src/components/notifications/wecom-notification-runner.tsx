"use client";

import { useEffect, useRef } from "react";
import {
  buildLaunchOverdueAlerts,
  buildWeComLaunchOverdueMarkdown,
  createSentRecords,
  normalizeWeComNotificationSettings,
  validateWeComWebhookUrl,
  wecomNotificationSentStorageKey,
  wecomNotificationSettingsStorageKey,
  type WeComNotificationSentRecord,
  type WeComNotificationSettings,
} from "@/lib/notifications/wecom";
import { useWorkspaceStore } from "@/lib/stores/workspace-store";

const scanIntervalMs = 30 * 60 * 1000;

export function WeComNotificationRunner() {
  const inFlightRef = useRef(false);

  useEffect(() => {
    let disposed = false;

    async function scanAndSend() {
      if (disposed || inFlightRef.current) return;

      const settings = readSettings();
      if (!settings.enabled || !validateWeComWebhookUrl(settings.webhookUrl)) return;

      const state = useWorkspaceStore.getState();
      if (!state.campaignGroups.length) return;

      const alerts = buildLaunchOverdueAlerts({
        campaignGroups: state.campaignGroups,
        performanceRows: state.performanceRows,
        launchOverdueDays: settings.launchOverdueDays,
        sentRecords: readSentRecords(),
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
          window.localStorage.setItem(
            wecomNotificationSentStorageKey,
            JSON.stringify([...createSentRecords(alerts), ...readSentRecords()].slice(0, 300)),
          );
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

function readSettings(): WeComNotificationSettings {
  try {
    const saved = window.localStorage.getItem(wecomNotificationSettingsStorageKey);

    return normalizeWeComNotificationSettings(saved ? (JSON.parse(saved) as Partial<WeComNotificationSettings>) : null);
  } catch {
    return normalizeWeComNotificationSettings(null);
  }
}

function readSentRecords(): WeComNotificationSentRecord[] {
  try {
    const saved = window.localStorage.getItem(wecomNotificationSentStorageKey);

    return saved ? (JSON.parse(saved) as WeComNotificationSentRecord[]) : [];
  } catch {
    return [];
  }
}
