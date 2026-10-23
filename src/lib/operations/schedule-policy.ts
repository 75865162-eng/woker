import { amazonReadDomains, type AmazonReadDomain } from "./types";

export const defaultSyncIntervals: Record<AmazonReadDomain, number> = {
  inventory: 60, orders: 15, ads: 120, catalog: 1440, finance: 1440, fulfillment: 1440,
};

export function parseSchedulePatch(body: Record<string, unknown>) {
  if (!(amazonReadDomains as readonly unknown[]).includes(body.resource)) throw new Error("不支持的同步域。");
  const resource = body.resource as AmazonReadDomain;
  if (typeof body.enabled !== "boolean") throw new Error("enabled 必须为布尔值。");
  const intervalMinutes = body.intervalMinutes ?? defaultSyncIntervals[resource];
  if (typeof intervalMinutes !== "number" || !Number.isInteger(intervalMinutes) || intervalMinutes < 15 || intervalMinutes > 10080) {
    throw new Error("同步间隔须为 15–10080 的整数分钟。");
  }
  if (body.enabled && resource !== "inventory" && resource !== "catalog") throw new Error("该域未接入同步 worker，不能启用计划；广告使用现有 PPC 数据。");
  return { resource, enabled: body.enabled, intervalMinutes };
}

export function nextScheduledAt(schedule: { enabled: boolean; intervalMinutes: number; lastEnqueuedAt: Date | null; updatedAt: Date }) {
  if (!schedule.enabled) return null;
  return new Date((schedule.lastEnqueuedAt ?? schedule.updatedAt).getTime() + schedule.intervalMinutes * 60_000);
}
