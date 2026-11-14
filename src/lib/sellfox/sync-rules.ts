import {
  sellfoxSyncResources, sellfoxEndpointResource, sellfoxEndpointCode, isSellfoxEndpointResource,
  type SellfoxSyncResource,
} from "./sync-contract";

export { sellfoxEndpointResource, sellfoxEndpointCode, isSellfoxEndpointResource };

/**
 * 同步规则注册表：所有数据域（内置 + 后台配置的 API 端点）的唯一编排事实源。
 *
 * 新增数据域不再改 sync-service 的分支或另写 CLI：
 * - 内置域：在此声明一条规则，编排器自动纳入全量计划、调度、分块、断点、分片记账；
 * - 自定义 API：后台写入 SellfoxApiEndpoint，endpointSyncRule() 生成同构规则，走同一编排链路。
 *
 * chunkDays 是「一次 run 允许的最大日期跨度」。上游广告报表单次请求超过 5 万行
 * 会被拒绝（2026-11-15 实测），因此广告类按实测行量预先切块；失败时编排器再自动对半拆。
 */
export type SyncCadence = "master" | "daily" | "document" | "monthly";
export type SyncDateMode = "none" | "current" | "range" | "month";

export type SyncRule = {
  /** 内置资源名，或 endpoint:<code>。 */
  id: string;
  label: string;
  cadence: SyncCadence;
  dateMode: SyncDateMode;
  /** 单次 run 最大天数；0 = 不带日期（当前状态）。 */
  chunkDays: number;
  /** 调度间隔（分钟）；schedulable=false 时不进定时任务表。 */
  intervalMinutes: number;
  schedulable: boolean;
  /** 上游单次请求行数上限，触发自适应拆分；null 表示无此限制。 */
  maxRows: number | null;
  /** 冷启动依赖：先跑 stores 才有店铺外键。 */
  dependsOn: string[];
  order: number;
  builtin: boolean;
};

const ad = (id: string, label: string, chunkDays: number, order: number): SyncRule => ({
  id, label, cadence: "daily", dateMode: "range", chunkDays, intervalMinutes: 1440,
  schedulable: true, maxRows: 50_000, dependsOn: ["stores"], order, builtin: true,
});

export const builtinSyncRules: SyncRule[] = [
  { id: "stores", label: "店铺列表", cadence: "master", dateMode: "none", chunkDays: 0, intervalMinutes: 480, schedulable: true, maxRows: null, dependsOn: [], order: 10, builtin: true },
  { id: "listings", label: "在线产品", cadence: "master", dateMode: "current", chunkDays: 0, intervalMinutes: 1440, schedulable: true, maxRows: null, dependsOn: ["stores"], order: 20, builtin: true },
  { id: "inventory", label: "FBA 库存", cadence: "daily", dateMode: "current", chunkDays: 0, intervalMinutes: 180, schedulable: true, maxRows: null, dependsOn: ["stores"], order: 30, builtin: true },
  { id: "orders", label: "订单", cadence: "document", dateMode: "range", chunkDays: 90, intervalMinutes: 720, schedulable: true, maxRows: null, dependsOn: ["stores"], order: 40, builtin: true },
  { id: "sales", label: "销量快照", cadence: "daily", dateMode: "range", chunkDays: 90, intervalMinutes: 1440, schedulable: true, maxRows: null, dependsOn: ["stores"], order: 50, builtin: true },
  { id: "performance", label: "产品日利润", cadence: "daily", dateMode: "range", chunkDays: 90, intervalMinutes: 1440, schedulable: true, maxRows: null, dependsOn: ["stores"], order: 60, builtin: true },
  { id: "fba_shipments", label: "货件", cadence: "document", dateMode: "range", chunkDays: 90, intervalMinutes: 720, schedulable: true, maxRows: null, dependsOn: ["stores"], order: 70, builtin: true },
  { id: "hourly", label: "小时样本", cadence: "daily", dateMode: "current", chunkDays: 1, intervalMinutes: 1440, schedulable: false, maxRows: null, dependsOn: ["stores"], order: 80, builtin: true },
  ad("ads_report", "广告商品报表", 14, 90),
  ad("ads_campaign", "广告活动报表", 14, 100),
  ad("ads_ad_group", "广告组报表", 14, 110),
  ad("ads_placement", "广告位报表", 14, 120),
  ad("ads_targeting", "广告投放报表", 7, 130),
  ad("ads_search_term", "广告搜索词报表", 7, 140),
];

/** 保持与 sellfoxSyncResources 完全一致，避免注册表与执行器清单漂移。 */
export const builtinSyncRuleMap: Record<SellfoxSyncResource, SyncRule> = Object.fromEntries(
  sellfoxSyncResources.map((resource) => {
    const rule = builtinSyncRules.find((item) => item.id === resource);
    if (!rule) throw new Error(`同步规则缺失：${resource}`);
    return [resource, rule];
  }),
) as Record<SellfoxSyncResource, SyncRule>;

export const syncResourceCadence = Object.fromEntries(
  builtinSyncRules.map((rule) => [rule.id, rule.cadence]),
) as Record<SellfoxSyncResource, SyncCadence>;

/** 定时任务表只覆盖 schedulable 的域；hourly 是抽样，不建计划。 */
export const sellfoxScheduleIntervals = Object.fromEntries(
  builtinSyncRules.filter((rule) => rule.schedulable).map((rule) => [rule.id, rule.intervalMinutes]),
) as Record<Exclude<SellfoxSyncResource, "hourly">, number>;

export const syncFirstRunOrder = [...builtinSyncRules].sort((a, b) => a.order - b.order).map((rule) => ({
  resource: rule.id as SellfoxSyncResource,
  label: rule.label,
  reason: rule.dependsOn.length ? `依赖 ${rule.dependsOn.join(" / ")}` : "所有事实表的外键来源",
  chunkDays: rule.chunkDays, order: rule.order,
}));

/** 后台配置的 API 端点 → 同构规则。配置值经过校验后才会落库。 */
export function endpointSyncRule(config: { code: string; label: string; dateMode: SyncDateMode; chunkDays: number; intervalMinutes: number; maxRows: number | null }): SyncRule {
  return {
    id: sellfoxEndpointResource(config.code), label: config.label, cadence: config.dateMode === "none" ? "master" : "daily",
    dateMode: config.dateMode, chunkDays: config.dateMode === "range" ? config.chunkDays : 0,
    intervalMinutes: config.intervalMinutes, schedulable: false, maxRows: config.maxRows,
    dependsOn: ["stores"], order: 1000, builtin: false,
  };
}

export function syncRuleChunkDays(resource: string) {
  return builtinSyncRuleMap[resource as SellfoxSyncResource]?.chunkDays ?? 90;
}

export function addSellfoxDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}
export function sellfoxSpanDays(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000) + 1;
}

/** 把 [from,to] 按 chunkDays 切成互不重叠的日期块；每块 ≤90 天（现有日期校验上限）。 */
export function sellfoxDateChunks(from: string, to: string, chunkDays: number) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new Error("日期范围无效。");
  if (!Number.isInteger(chunkDays) || chunkDays < 1 || chunkDays > 90) throw new Error("分块天数必须在 1~90 之间。");
  if (sellfoxSpanDays(from, to) > 3650) throw new Error("日期范围不得超过 3650 天。");
  const chunks: { startDate: string; endDate: string }[] = [];
  for (let cursor = from; cursor <= to;) {
    const endDate = addSellfoxDays(cursor, chunkDays - 1);
    chunks.push({ startDate: cursor, endDate: endDate > to ? to : endDate });
    cursor = addSellfoxDays(endDate > to ? to : endDate, 1);
  }
  return chunks;
}

/** 上游行数/文件过大类错误：编排器据此自动把窗口对半拆，最小 1 天。 */
export function isSellfoxChunkTooWide(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return /五万行|50,?000\s*行|超过\s*25MB|缩小(日期)?范围/.test(message);
}

export function splitSellfoxDateChunk(startDate: string, endDate: string) {
  const span = sellfoxSpanDays(startDate, endDate);
  if (span <= 1) return null;
  const mid = addSellfoxDays(startDate, Math.floor(span / 2) - 1);
  return [{ startDate, endDate: mid }, { startDate: addSellfoxDays(mid, 1), endDate }];
}

/**
 * 广告下载任务（/api/cpc/download/createTask.json）各 reportTypeCode 支持的 adTypeCode。
 * 依据赛狐开放平台文档「创建广告下载任务」：adSpace/adSearchTerm/adTargering 仅 sp,sb；
 * SD 的投放报告走 sdTargetListReport、且 SD 无广告位/搜索词报告，故 SD 只支持 campaign/ad_group/product。
 * 这是上游硬约束，越界提交会被拒绝，故在分派阶段按资源裁剪，绝不向 SD 发不被支持的报告类型。
 */
export const sellfoxAdsReportAdTypes: Record<string, string[]> = {
  adCampaignReport: ["sp", "sb", "sd"],
  adGroupReport: ["sp", "sb", "sd"],
  adProductReport: ["sp", "sb", "sd"],
  adSpaceReport: ["sp", "sb"],
  adTargeringReport: ["sp", "sb"],
  adSearchTermReport: ["sp", "sb"],
};

/** 资源 → 该资源同步时的 reportTypeCode（与 sync-service 分派一致）。 */
export function sellfoxAdsResourceReportType(resource: string) {
  return resource === "ads_campaign" ? "adCampaignReport"
    : resource === "ads_ad_group" ? "adGroupReport"
    : resource === "ads_placement" ? "adSpaceReport"
    : resource === "ads_targeting" ? "adTargeringReport"
    : resource === "ads_search_term" ? "adSearchTermReport"
    : "adProductReport";
}

/** 按 reportTypeCode 的合法 adType 裁剪传入的 adTypes；为空时保留默认值 sp（不破坏既有 SP 定时任务）。 */
export function sellfoxAdsAllowedAdTypes(resource: string, requested?: string[]) {
  const allowed = sellfoxAdsReportAdTypes[sellfoxAdsResourceReportType(resource)] ?? ["sp"];
  if (!requested || !requested.length) return ["sp"];
  const filtered = requested.filter((type) => allowed.includes(type));
  return filtered.length ? filtered : ["sp"];
}
