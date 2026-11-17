export type SellfoxWindowResource = "stores" | "inventory" | "sales" | "performance" | "hourly" | "listings" | "ads_report" | "ads_targeting" | "ads_search_term" | "ads_campaign" | "ads_ad_group" | "ads_placement";

/**
 * 赛狐同步窗口配置（按资源类型的业务规则集中登记，避免散落魔数）。
 * 全部支持环境变量覆盖以便"改而不发版"，并做上下限钳制（fail-closed）：
 * 任何异常配置都不会放大回溯范围或分页上限而打穿防护。
 */
function readBoundedInt(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || !Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export type SellfoxWindowConfig = {
  maxReportDays: number;
  hourlyLookbackDays: number;
  maxPages: number;
  backfillDaysPerRun: number;
};

export function getSellfoxWindowConfig(): SellfoxWindowConfig {
  return {
    maxReportDays: readBoundedInt("SELLFOX_MAX_REPORT_DAYS", 90, 1, 90),
    hourlyLookbackDays: readBoundedInt("SELLFOX_HOURLY_LOOKBACK_DAYS", 60, 1, 60),
    maxPages: readBoundedInt("SELLFOX_MAX_PAGES_PER_RESOURCE", 10_000, 1, 10_000),
    backfillDaysPerRun: readBoundedInt("SELLFOX_BACKFILL_DAYS_PER_RUN", 7, 1, 90),
  };
}

/** 按资源类型返回适用的回溯窗口说明，供接入/配置核对使用。 */
export function describeSellfoxResourceWindow(resource: SellfoxWindowResource): string {
  const cfg = getSellfoxWindowConfig();
  if (resource === "inventory" || resource === "listings") return "仅当前状态";
  if (resource === "stores") return "无日期窗口";
  if (resource === "hourly") return `最近 ${cfg.hourlyLookbackDays} 天单日`;
  return `最多 ${cfg.maxReportDays} 个自然日`;
}
