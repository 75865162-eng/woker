const APP_VERSION_PATTERN = /^v(\d+)\.(\d+)\.(\d+)$/;

export const defaultAppVersionLabel = "v0.0.1";

export function normalizeAppVersionLabel(value: unknown, fallback = defaultAppVersionLabel) {
  return typeof value === "string" && APP_VERSION_PATTERN.test(value) ? value : fallback;
}

export function formatAppReleaseLabel(version: unknown, releasedAt: unknown) {
  const label = normalizeAppVersionLabel(version);
  if (typeof releasedAt !== "string" || !releasedAt.trim()) return label;
  const date = new Date(releasedAt);
  if (!Number.isFinite(date.getTime())) return label;

  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Shanghai",
    year: "2-digit",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  return `${part("year")}/${part("month")}/${part("day")}/${label}`;
}

export function nextAppVersionLabel(current?: string | null) {
  const match = current?.match(APP_VERSION_PATTERN);
  if (!match) {
    return defaultAppVersionLabel;
  }

  const major = Number(match[1]);
  const minor = Number(match[2]);
  const patch = Number(match[3]);

  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
    return defaultAppVersionLabel;
  }

  return `v${major}.${minor}.${patch + 1}`;
}
