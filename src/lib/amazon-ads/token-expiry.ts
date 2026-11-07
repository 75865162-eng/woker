/** Shared by the account UI and offline tests; keep this module browser-safe. */
export type AdsTokenExpiryNotice =
  | { level: "UNKNOWN"; daysRemaining: null }
  | { level: "EXPIRED" | "WITHIN_7_DAYS" | "WITHIN_30_DAYS" | "WITHIN_60_DAYS"; daysRemaining: number };

export function amazonAdsTokenExpiryNotice(expiresAt: Date | string | null | undefined, now = new Date()): AdsTokenExpiryNotice | null {
  if (!expiresAt) return { level: "UNKNOWN", daysRemaining: null };
  const expiryTime = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(expiresAt);
  const nowTime = now.getTime();
  if (!Number.isFinite(nowTime)) return null;
  if (!Number.isFinite(expiryTime)) return { level: "UNKNOWN", daysRemaining: null };
  if (expiryTime <= nowTime) return { level: "EXPIRED", daysRemaining: 0 };
  const daysRemaining = Math.ceil((expiryTime - nowTime) / 86400000);
  if (daysRemaining <= 7) return { level: "WITHIN_7_DAYS", daysRemaining };
  if (daysRemaining <= 30) return { level: "WITHIN_30_DAYS", daysRemaining };
  if (daysRemaining <= 60) return { level: "WITHIN_60_DAYS", daysRemaining };
  return null;
}
