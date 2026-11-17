

export type HostStatus = "live" | "planned" | "blocked";

export type HostPriority = "P0" | "P1" | "P2";

export type HostColumnKind = "text" | "stack" | "qty" | "decimal" | "money" | "rate" | "date" | "store" | "tags";

export type HostColumn = {
  key: string;
  label: string;
  kind?: HostColumnKind;
  /** 次行字段（kind = "stack" 时使用）。 */
  sub?: string;
  hint?: string;
  width?: number;
};

export type HostDataset = {
  id: string;
  label: string;
  status: HostStatus;
  priority: HostPriority;
  /** 落表名，未接入时也写目标表，方便对照规划。 */
  table: string;
  api: string[];
  /** 时间口径说明，显示在页面头部与 tab tooltip。 */
  grain: string;
  note?: string;
  /** live 数据集的读取方式：直连已有接口，或走 host-read 注册表。 */
  endpoint?: string;
  reader?: string;
  columns: HostColumn[];
  /** 是否支持站点/店铺/搜索/日期筛选。 */
  searchable?: boolean;
  dateRange?: boolean;
  /** 广告类数据集才有 adType（sp/sb/sd）。 */
  adType?: boolean;
};

export type HostPage = {
  id: string;
  href: string;
  title: string;
  subtitle: string;
  /** 页面级来源徽标，全部是赛狐侧数据，不与 Amazon SP-API 混算。 */
  source: string;
  datasets: HostDataset[];
};

export const storeColumn: HostColumn = { key: "store", label: "店铺/站点", kind: "store", width: 150 };

export const adsMetrics: HostColumn[] = [
  { key: "impressions", label: "曝光量", kind: "qty" },
  { key: "clicks", label: "点击量", kind: "qty" },
  { key: "ctr", label: "CTR", kind: "rate", hint: "点击量 / 曝光量；分母为 0 或缺失时留空。" },
  { key: "cost", label: "花费", kind: "money" },
  { key: "cpc", label: "CPC", kind: "money", hint: "花费 / 点击量；点击为 0 时留空。" },
  { key: "adOrders", label: "广告订单", kind: "qty" },
  { key: "adSales", label: "广告销售额", kind: "money" },
  { key: "acos", label: "ACOS", kind: "rate", hint: "花费 / 广告销售额；销售额缺失时不计算。" },
  { key: "roas", label: "ROAS", kind: "decimal", hint: "广告销售额 / 花费。" },
];
