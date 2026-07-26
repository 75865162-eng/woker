import type { CampaignGroup, LifecycleGroupId, PerformanceRow } from "@/lib/types";

export const wecomNotificationSettingsStorageKey = "amazon-ad-wecom-notification-settings";
export const wecomNotificationSentStorageKey = "amazon-ad-wecom-notification-sent";

export interface WeComNotificationSettings {
  enabled: boolean;
  webhookUrl: string;
  launchOverdueDays: number;
  notifyOncePerDay: boolean;
}

export interface WeComNotificationSentRecord {
  campaignGroupId: string;
  sentDate: string;
  sentAt: string;
}

export interface LaunchOverdueAlertItem {
  campaignGroupId: string;
  campaignName: string;
  adGroupName: string;
  lifecycleGroupId: LifecycleGroupId;
  launchDate: string;
  overdueDays: number;
  keywordCount: number;
  metrics: {
    impressions: number;
    clicks: number;
    orders: number;
    sales: number;
    spend: number;
    acos: number;
    cvr: number;
  };
}

export const defaultWeComNotificationSettings: WeComNotificationSettings = {
  enabled: false,
  webhookUrl: "",
  launchOverdueDays: 14,
  notifyOncePerDay: true,
};

const dayMs = 24 * 60 * 60 * 1000;

export function normalizeWeComNotificationSettings(
  value: Partial<WeComNotificationSettings> | null | undefined,
): WeComNotificationSettings {
  return {
    enabled: Boolean(value?.enabled),
    webhookUrl: typeof value?.webhookUrl === "string" ? value.webhookUrl.trim() : "",
    launchOverdueDays: Math.max(1, Math.min(180, Number(value?.launchOverdueDays) || defaultWeComNotificationSettings.launchOverdueDays)),
    notifyOncePerDay: value?.notifyOncePerDay ?? defaultWeComNotificationSettings.notifyOncePerDay,
  };
}

export function validateWeComWebhookUrl(webhookUrl: string) {
  try {
    const url = new URL(webhookUrl);

    return (
      url.protocol === "https:" &&
      url.hostname === "qyapi.weixin.qq.com" &&
      url.pathname === "/cgi-bin/webhook/send" &&
      Boolean(url.searchParams.get("key"))
    );
  } catch {
    return false;
  }
}

export function buildLaunchOverdueAlerts(input: {
  campaignGroups: CampaignGroup[];
  performanceRows: PerformanceRow[];
  launchOverdueDays: number;
  now?: Date;
  sentRecords?: WeComNotificationSentRecord[];
  notifyOncePerDay?: boolean;
}) {
  const now = input.now ?? new Date();
  const today = toDateKey(now);
  const sentTodayIds = new Set(
    input.notifyOncePerDay
      ? (input.sentRecords ?? []).filter((record) => record.sentDate === today).map((record) => record.campaignGroupId)
      : [],
  );

  const alerts: LaunchOverdueAlertItem[] = [];

  for (const group of input.campaignGroups) {
    if (group.lifecycleGroupId !== "launch") {
      continue;
    }

      const launchDate = parseDate(group.lastUpdated);
      if (!launchDate) continue;

      const overdueDays = Math.floor((now.getTime() - launchDate.getTime()) / dayMs) - input.launchOverdueDays;
      if (overdueDays < 1 || sentTodayIds.has(group.id)) continue;

      const rows = input.performanceRows.filter((row) => row.campaignGroupId === group.id);
      const metrics = summarizePerformanceRows(rows);

      alerts.push({
        campaignGroupId: group.id,
        campaignName: group.campaignName,
        adGroupName: group.adGroupName,
        lifecycleGroupId: group.lifecycleGroupId,
        launchDate: group.lastUpdated,
        overdueDays,
        keywordCount: group.keywordCount,
        metrics,
      });
  }

  return alerts.sort((left, right) => right.overdueDays - left.overdueDays);
}

export function buildWeComLaunchOverdueMarkdown(input: {
  alerts: LaunchOverdueAlertItem[];
  launchOverdueDays: number;
  generatedAt?: Date;
}) {
  const generatedAt = input.generatedAt ?? new Date();
  const header = [
    `新品超期提醒：${input.alerts.length} 个广告组需要检查`,
    `阈值：进入新品组超过 ${input.launchOverdueDays} 天`,
    `时间：${generatedAt.toLocaleString("zh-CN", { hour12: false })}`,
  ].join("\n");
  const body = input.alerts
    .slice(0, 12)
    .map((alert, index) => {
      const metrics = alert.metrics;

      return [
        `\n${index + 1}. ${alert.adGroupName}`,
        `Campaign：${alert.campaignName}`,
        `新品日期：${alert.launchDate}，已超期 ${alert.overdueDays} 天`,
        `关键词数：${alert.keywordCount}`,
        `当前广告：Spend ${formatCurrency(metrics.spend)} / Sales ${formatCurrency(metrics.sales)} / Orders ${metrics.orders} / ACOS ${formatPercent(metrics.acos)} / CVR ${formatPercent(metrics.cvr)}`,
        "建议：检查 Listing、预算、主推词表现、库存和转化率。",
      ].join("\n");
    })
    .join("\n");
  const more = input.alerts.length > 12 ? `\n\n另有 ${input.alerts.length - 12} 个广告组未展开，请回到工作台查看。` : "";

  return `${header}\n${body}${more}`.slice(0, 3900);
}

export function createSentRecords(alerts: LaunchOverdueAlertItem[], sentAt = new Date()): WeComNotificationSentRecord[] {
  const sentDate = toDateKey(sentAt);

  return alerts.map((alert) => ({
    campaignGroupId: alert.campaignGroupId,
    sentDate,
    sentAt: sentAt.toISOString(),
  }));
}

function summarizePerformanceRows(rows: PerformanceRow[]): LaunchOverdueAlertItem["metrics"] {
  const metrics = rows.reduce(
    (total, row) => ({
      impressions: total.impressions + row.impressions,
      clicks: total.clicks + row.clicks,
      orders: total.orders + row.orders,
      sales: total.sales + row.sales,
      spend: total.spend + row.spend,
    }),
    { impressions: 0, clicks: 0, orders: 0, sales: 0, spend: 0 },
  );

  return {
    ...metrics,
    sales: round(metrics.sales),
    spend: round(metrics.spend),
    acos: metrics.sales > 0 ? round((metrics.spend / metrics.sales) * 100) : 0,
    cvr: metrics.clicks > 0 ? round((metrics.orders / metrics.clicks) * 100) : 0,
  };
}

function parseDate(value: string) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatCurrency(value: number) {
  return `$${value.toFixed(2)}`;
}

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

function round(value: number) {
  return Number(value.toFixed(2));
}
