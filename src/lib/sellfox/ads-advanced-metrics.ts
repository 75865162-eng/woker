/**
 * 广告高级指标字段注册表（方案第 6.4 节）。
 *
 * 本文件只登记赛狐活动列设置中实见的「高级指标/自定义列」候选，并明确其证据状态。
 * 纪律：没有来源字段、样本、适用广告类型、归因窗口与聚合口径核实之前，一律 evidenceStatus=待验证、
 * enabled=false；不产出任何数值、不填 0、不用相似指标冒充。ACoTS/ASoTS/ACoAS/ASoAS 的分子、分母、
 * 广告范围与名称不凭缩写猜测，登记为未决项。
 *
 * 这是声明式能力清单，不是数据，也不是 mock；页面以「待接说明」呈现，启用需单独补齐证据链并经评审。
 */
import type { HostColumn } from "./host-page-schema";

export type EvidenceStatus = "待验证" | "未决";

export type AdvancedMetricRegistration = {
  key: string;
  label: string;
  valueType: "percent" | "money" | "count" | "rate" | "unknown";
  unit: string | null;
  /** 已核实的来源字段；未核实为空数组。 */
  sources: string[];
  /** 已核实的适用广告类型；未核实为空数组。 */
  applicableAdTypes: string[];
  attributionWindow: string | null;
  dateGrain: string | null;
  aggregation: string | null;
  nullPolicy: string;
  filterable: boolean;
  sortable: boolean;
  exportable: boolean;
  evidenceStatus: EvidenceStatus;
  enabled: false;
  /** 待接原因 / 未决项说明。 */
  note: string;
  /** 尚未厘清的定义项（如分子、分母、广告范围、名称）。 */
  unresolved: string[];
};

type Seed = Pick<AdvancedMetricRegistration, "key" | "label" | "valueType" | "unit"> &
  Partial<Pick<AdvancedMetricRegistration, "sources" | "applicableAdTypes" | "attributionWindow" | "dateGrain" | "aggregation" | "nullPolicy" | "evidenceStatus" | "note" | "unresolved">>;

/** 统一填充「未启用 + 待验证」默认值，确保每项注册项字段完整且不产生任何真实数值。 */
function register(seed: Seed): AdvancedMetricRegistration {
  return {
    sources: [],
    applicableAdTypes: [],
    attributionWindow: null,
    dateGrain: null,
    aggregation: null,
    nullPolicy: "来源或口径未核实，返回 NEEDS_DATA，不以 0 填充。",
    filterable: false,
    sortable: false,
    exportable: false,
    evidenceStatus: "待验证",
    enabled: false,
    note: "赛狐活动列设置实见该指标名称，但来源字段、样本、适用广告类型与口径尚未核实，启用前保持待接。",
    unresolved: ["来源字段", "适用广告类型", "归因窗口", "聚合口径"],
    ...seed,
  };
}

/** 方案 6.4 点名的六类高级指标族 + 实见视频/品牌新买家等，逐项登记。 */
export const ADS_ADVANCED_METRICS: AdvancedMetricRegistration[] = [
  // 占比类
  register({ key: "impressionShare", label: "曝光占比", valueType: "percent", unit: "%" }),
  register({ key: "clickShare", label: "点击占比", valueType: "percent", unit: "%" }),
  register({ key: "costShare", label: "花费占比", valueType: "percent", unit: "%" }),
  register({ key: "orderShare", label: "订单占比", valueType: "percent", unit: "%" }),
  register({ key: "unitsShare", label: "销量占比", valueType: "percent", unit: "%" }),
  register({ key: "salesShare", label: "销售额占比", valueType: "percent", unit: "%" }),
  // 可见展示 / 品牌搜索 / 触达 / DPV
  register({ key: "viewableImpressions", label: "可见展示", valueType: "count", unit: null }),
  register({ key: "topSearchImpressionShare", label: "首页首位 IS", valueType: "percent", unit: "%" }),
  register({ key: "vcpm", label: "VCPM", valueType: "money", unit: "currency/1000" }),
  register({ key: "dpv", label: "DPV", valueType: "count", unit: null }),
  register({ key: "brandSearch", label: "品牌搜索", valueType: "count", unit: null }),
  register({ key: "cumulativeReach", label: "累计触达", valueType: "count", unit: null }),
  register({ key: "averageReach", label: "平均触达", valueType: "count", unit: null }),
  // 本广告产品 / 其他产品的订单、销量、销售额、占比与笔单价
  register({ key: "adProductOrders", label: "本广告产品订单", valueType: "count", unit: null }),
  register({ key: "otherProductOrders", label: "其他产品订单", valueType: "count", unit: null }),
  register({ key: "adProductSales", label: "本广告产品销售额", valueType: "money", unit: "currency" }),
  register({ key: "otherProductSales", label: "其他产品销售额", valueType: "money", unit: "currency" }),
  register({ key: "adProductUnits", label: "本广告产品销量", valueType: "count", unit: null }),
  register({ key: "otherProductUnits", label: "其他产品销量", valueType: "count", unit: null }),
  register({ key: "unitPricePerOrder", label: "笔单价", valueType: "money", unit: "currency" }),
  // 品牌新买家
  register({ key: "newToBrandOrders", label: "品牌新买家订单", valueType: "count", unit: null }),
  register({ key: "newToBrandSales", label: "品牌新买家销售额", valueType: "money", unit: "currency" }),
  register({ key: "newToBrandUnits", label: "品牌新买家销量", valueType: "count", unit: null }),
  register({ key: "newToBrandOrderPct", label: "品牌新买家订单占比", valueType: "percent", unit: "%" }),
  register({ key: "newToBrandSalesPct", label: "品牌新买家销售额占比", valueType: "percent", unit: "%" }),
  register({ key: "newToBrandUnitsPct", label: "品牌新买家销量占比", valueType: "percent", unit: "%" }),
  // 加购
  register({ key: "addToCart", label: "加购次数", valueType: "count", unit: null }),
  register({ key: "addToCartRate", label: "加购率", valueType: "percent", unit: "%" }),
  register({ key: "costPerAddToCart", label: "单次加购花费", valueType: "money", unit: "currency" }),
  // 视频（实见）
  register({ key: "videoQuartile1", label: "视频播放 25%", valueType: "count", unit: null }),
  register({ key: "videoQuartile2", label: "视频播放 50%", valueType: "count", unit: null }),
  register({ key: "videoQuartile3", label: "视频播放 75%", valueType: "count", unit: null }),
  register({ key: "videoComplete", label: "视频完整播放", valueType: "count", unit: null }),
  register({ key: "videoViewRate", label: "视频观看率", valueType: "percent", unit: "%" }),
  register({ key: "video5sViews", label: "视频 5 秒观看", valueType: "count", unit: null }),
  register({ key: "newToBrandViews", label: "品牌新买家观看", valueType: "count", unit: null }),
  register({ key: "viewThroughClickRate", label: "观看点击率", valueType: "percent", unit: "%" }),
  register({ key: "unmutes", label: "取消静音", valueType: "count", unit: null }),
  // 四个缩写指标：分子/分母/广告范围/名称均不猜，登记为未决
  register({
    key: "acots", label: "ACoTS", valueType: "unknown", unit: null, evidenceStatus: "未决",
    note: "赛狐活动列设置实见该缩写，但分子、分母、广告范围与中文名称均未核实，禁止按缩写猜测。",
    unresolved: ["分子", "分母", "广告范围", "名称"],
  }),
  register({
    key: "asots", label: "ASoTS", valueType: "unknown", unit: null, evidenceStatus: "未决",
    note: "赛狐活动列设置实见该缩写，但分子、分母、广告范围与中文名称均未核实，禁止按缩写猜测。",
    unresolved: ["分子", "分母", "广告范围", "名称"],
  }),
  register({
    key: "acoas", label: "ACoAS", valueType: "unknown", unit: null, evidenceStatus: "未决",
    note: "赛狐活动列设置实见该缩写，但分子、分母、广告范围与中文名称均未核实，禁止按缩写猜测。",
    unresolved: ["分子", "分母", "广告范围", "名称"],
  }),
  register({
    key: "asoas", label: "ASoAS", valueType: "unknown", unit: null, evidenceStatus: "未决",
    note: "赛狐活动列设置实见该缩写，但分子、分母、广告范围与中文名称均未核实，禁止按缩写猜测。",
    unresolved: ["分子", "分母", "广告范围", "名称"],
  }),
];

/** 供页面待接说明展示的字段样式预览列（仅 key/label，不含任何数据）。 */
export function advancedMetricPreviewColumns(): HostColumn[] {
  return ADS_ADVANCED_METRICS.map((metric) => ({ key: metric.key, label: metric.label }));
}

/** 汇总待验证/未决计数，供待接说明与测试使用。 */
export function advancedMetricsSummary() {
  return {
    total: ADS_ADVANCED_METRICS.length,
    pending: ADS_ADVANCED_METRICS.filter((m) => m.evidenceStatus === "待验证").length,
    unresolved: ADS_ADVANCED_METRICS.filter((m) => m.evidenceStatus === "未决").length,
    enabled: ADS_ADVANCED_METRICS.filter((m) => m.enabled).length,
  };
}
