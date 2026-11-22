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

/**
 * 系统自设的全量历史起点（不是赛狐官方限制）。此前系统默认只回补约 90 天 / 1 年，
 * 这是产品侧的保守选择，不是上游 API 要求。按"系统自设限制一律去掉、能拉尽拉"的原则，
 * 默认放开到 20 年（覆盖任何现实卖家的经营历史），并允许 env 进一步覆盖。
 * 真正不可突破的是赛狐官方硬约束（单次 31 天 / 5 万行 / 25MB / 200 页 / 1rps 等），
 * 那些在各 dataset 的 chunkDays / pageSize / 行数上限处独立保留。
 */
export const SELLFOX_FULL_HISTORY_DAYS = readBoundedInt("SELLFOX_FULL_HISTORY_DAYS", 20 * 365, 1, 100 * 365);

export type SellfoxWindowConfig = {
  maxReportDays: number;
  hourlyLookbackDays: number;
  maxPages: number;
  backfillDaysPerRun: number;
};

export function getSellfoxWindowConfig(): SellfoxWindowConfig {
  return {
    // 原 90 天上限是系统保守值（官方各接口为 31 天/6 月/1 年不等）。放开到与全量历史
    // 同量级，单次实际跨度仍由各 dataset 的 chunkDays 上限约束，不会打穿官方限制。
    maxReportDays: readBoundedInt("SELLFOX_MAX_REPORT_DAYS", SELLFOX_FULL_HISTORY_DAYS, 1, SELLFOX_FULL_HISTORY_DAYS),
    hourlyLookbackDays: readBoundedInt("SELLFOX_HOURLY_LOOKBACK_DAYS", SELLFOX_FULL_HISTORY_DAYS, 1, SELLFOX_FULL_HISTORY_DAYS),
    // 分页是防死循环的安全机制，不是"能拉多少历史"的窗口限制，保留但放宽上限。
    maxPages: readBoundedInt("SELLFOX_MAX_PAGES_PER_RESOURCE", 100_000, 1, 1_000_000),
    // 每轮回填天数：原默认 7 天是系统节流，放开到 365 天以尽快拉全，仍按块推进。
    backfillDaysPerRun: readBoundedInt("SELLFOX_BACKFILL_DAYS_PER_RUN", 365, 1, SELLFOX_FULL_HISTORY_DAYS),
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
