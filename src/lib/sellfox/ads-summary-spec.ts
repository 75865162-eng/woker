import type { HostColumn } from "./host-page-schema";
import type { HostQuery } from "./host-read";

/**
 * 广告实体 × 区间汇总的纯声明（表名、实体端点映射、列）。
 * 单独成文件、不依赖 Prisma，便于页面配置与客户端组件引用；SQL 在 ads-entity-summary.ts。
 */

export type AdsSummaryKind = "campaign" | "adgroup" | "adproduct" | "targeting";

export type EntitySource = { code: string; adType: "sp" | "sb" | "sd" };

export type SummarySpec = {
  kind: AdsSummaryKind;
  dailyTable: string;
  /** 日报中的实体 ID 列。 */
  idColumn: string;
  /** 实体 payload 中的 ID 键。 */
  entityKey: string;
  /** 日报可回退的展示名称列（仅活动/组有）。 */
  fallbackNameColumn?: string;
  /** 日报中需要带到行上的父级 ID 列（组/产品/投放需要活动与组）。 */
  parentColumns: string[];
  entities: EntitySource[];
  grain: string;
  columns: HostColumn[];
};

const BASE_METRIC_COLUMNS: HostColumn[] = [
  { key: "impressions", label: "曝光量", kind: "qty" },
  { key: "clicks", label: "点击量", kind: "qty" },
  { key: "ctr", label: "CTR", kind: "rate", hint: "点击量合计 / 曝光量合计；任一日缺值或分母为 0 时留空。" },
  { key: "cost", label: "花费", kind: "money" },
  { key: "cpc", label: "CPC", kind: "money", hint: "花费合计 / 点击合计。" },
  { key: "adOrders", label: "广告订单", kind: "qty" },
  { key: "adSales", label: "广告销售额", kind: "money" },
  { key: "acos", label: "ACOS", kind: "rate", hint: "花费合计 / 广告销售额合计；销售额缺失时不计算。" },
  { key: "roas", label: "ROAS", kind: "decimal", hint: "广告销售额合计 / 花费合计。" },
  { key: "reportDates", label: "覆盖天数", kind: "qty", hint: "区间内该实体有日报的天数；小于区间天数表示覆盖不完整。" },
];

function summaryColumns(identity: HostColumn[]): HostColumn[] {
  return [...identity, ...BASE_METRIC_COLUMNS];
}

export const ADS_SUMMARY_SPECS: Record<AdsSummaryKind, SummarySpec> = {
  campaign: {
    kind: "campaign",
    dailyTable: "SellfoxAdsCampaignDaily",
    idColumn: "campaignId",
    entityKey: "campaignId",
    fallbackNameColumn: "campaignName",
    parentColumns: [],
    entities: [
      { code: "ads_ent_sp_campaign", adType: "sp" },
      { code: "ads_ent_sb_campaign", adType: "sb" },
      { code: "ads_ent_sd_campaign", adType: "sd" },
    ],
    grain: "活动当前实体 × 区间日报汇总（一行一活动）",
    columns: summaryColumns([
      { key: "store", label: "店铺/站点", kind: "store", width: 150 },
      { key: "adType", label: "类型", width: 70 },
      { key: "campaignId", label: "活动 ID", width: 170 },
      { key: "name", label: "活动名称", width: 240 },
      { key: "state", label: "状态", width: 90 },
      { key: "servingStatus", label: "服务状态", width: 150 },
      { key: "budget", label: "每日预算", kind: "money", width: 110 },
      { key: "strategy", label: "竞价策略", width: 130 },
      { key: "startDate", label: "开始日期", width: 105 },
      { key: "endDate", label: "结束日期", width: 105 },
      { key: "portfolioId", label: "广告组合 ID", width: 160 },
    ]),
  },
  adgroup: {
    kind: "adgroup",
    dailyTable: "SellfoxAdsAdGroupDaily",
    idColumn: "adGroupId",
    entityKey: "groupId",
    fallbackNameColumn: "adGroupName",
    parentColumns: ["campaignId"],
    entities: [
      { code: "ads_ent_sp_group", adType: "sp" },
      { code: "ads_ent_sb_group", adType: "sb" },
      { code: "ads_ent_sd_group", adType: "sd" },
    ],
    grain: "广告组当前实体 × 区间日报汇总（一行一组）",
    columns: summaryColumns([
      { key: "store", label: "店铺/站点", kind: "store", width: 150 },
      { key: "adType", label: "类型", width: 70 },
      { key: "campaignId", label: "活动 ID", width: 170 },
      { key: "adGroupId", label: "组 ID", width: 170 },
      { key: "name", label: "组名称", width: 220 },
      { key: "state", label: "状态", width: 90 },
      { key: "servingStatus", label: "服务状态", width: 150 },
      { key: "defaultBid", label: "默认竞价", kind: "money", width: 110 },
    ]),
  },
  adproduct: {
    kind: "adproduct",
    dailyTable: "SellfoxAdsProductDaily",
    idColumn: "productId",
    entityKey: "adId",
    parentColumns: ["campaignId", "adGroupId"],
    entities: [
      { code: "ads_ent_sp_ad_product", adType: "sp" },
      { code: "ads_ent_sb_ad_product", adType: "sb" },
      { code: "ads_ent_sd_ad_product", adType: "sd" },
    ],
    grain: "广告产品当前实体 × 区间日报汇总（一行一产品广告）",
    columns: summaryColumns([
      { key: "store", label: "店铺/站点", kind: "store", width: 150 },
      { key: "adType", label: "类型", width: 70 },
      { key: "campaignId", label: "活动 ID", width: 170 },
      { key: "adGroupId", label: "组 ID", width: 170 },
      { key: "productId", label: "产品广告 ID", width: 170 },
      { key: "asin", label: "ASIN", width: 110 },
      { key: "sku", label: "SKU", width: 130 },
      { key: "state", label: "状态", width: 90 },
      { key: "servingStatus", label: "服务状态", width: 150 },
    ]),
  },
  targeting: {
    kind: "targeting",
    dailyTable: "SellfoxAdsTargetingDaily",
    idColumn: "targetingId",
    entityKey: "targetId",
    parentColumns: ["campaignId", "adGroupId"],
    entities: [
      { code: "ads_ent_sp_target", adType: "sp" },
      { code: "ads_ent_sp_keyword", adType: "sp" },
      { code: "ads_ent_sb_target", adType: "sb" },
      { code: "ads_ent_sb_keyword", adType: "sb" },
      { code: "ads_ent_sd_target", adType: "sd" },
    ],
    grain: "投放/关键词当前实体 × 区间日报汇总（一行一投放）",
    columns: summaryColumns([
      { key: "store", label: "店铺/站点", kind: "store", width: 150 },
      { key: "adType", label: "类型", width: 70 },
      { key: "campaignId", label: "活动 ID", width: 170 },
      { key: "adGroupId", label: "组 ID", width: 170 },
      { key: "targetingId", label: "投放 ID", width: 170 },
      { key: "text", label: "关键词/表达式", width: 220 },
      { key: "matchType", label: "匹配方式", width: 100 },
      { key: "bid", label: "当前竞价", kind: "money", width: 105 },
      { key: "state", label: "状态", width: 90 },
      { key: "servingStatus", label: "服务状态", width: 150 },
    ]),
  },
};

/** 指标范围筛选：基础列 + 派生比率，全部在实体汇总之后执行（方案 §5.1 区间指标）。 */
export type AdsSummaryMetrics = {
  impressionsMin?: number;
  impressionsMax?: number;
  clicksMin?: number;
  clicksMax?: number;
  costMin?: number;
  costMax?: number;
  adOrdersMin?: number;
  adOrdersMax?: number;
  adSalesMin?: number;
  adSalesMax?: number;
  ctrMin?: number;
  ctrMax?: number;
  cpcMin?: number;
  cpcMax?: number;
  acosMin?: number;
  acosMax?: number;
  roasMin?: number;
  roasMax?: number;
};

export type AdsSummaryQuery = HostQuery & AdsSummaryMetrics & {
  /** 表现分组（方案 §5.3）：orders / clicksNoOrders / impressionsNoClicks / noPerformance / insufficient。 */
  bucket?: string;
  /** 导出全部筛选结果；超过上限直接拒绝，不静默截断。 */
  exportAll?: boolean;
};

export const ADS_BUCKETS = ["orders", "clicksNoOrders", "impressionsNoClicks", "noPerformance", "insufficient"] as const;

