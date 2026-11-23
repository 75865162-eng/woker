

export type HostStatus = "live" | "planned" | "blocked";

export type HostPriority = "P0" | "P1" | "P2";

export type HostColumnKind = "text" | "stack" | "qty" | "decimal" | "money" | "rate" | "date" | "store" | "tags" | "image";

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
  /** 原始行读取：命中 SellfoxApiRecord.endpointCode，按真实 payload 键动态出列，不猜字段。 */
  rawCode?: string;
  columns: HostColumn[];
  /** 是否支持站点/店铺/搜索/日期筛选。 */
  searchable?: boolean;
  dateRange?: boolean;
  /** 广告类数据集才有 adType（sp/sb/sd）。 */
  adType?: boolean;
  /** 实体当前态数据集支持 state（enabled/paused/archived）本地筛选；键名来自实见 payload。 */
  stateFilter?: boolean;
};

/**
 * 一级标签分组：把多个底层数据集归入赛狐页面可见的一个管理标签。
 * 只做导航聚合，不改变任何 dataset id 或读取路径；href 用于纯外部/复用入口（如广告日志 domain=runs）。
 */
export type HostTabGroup = {
  id: string;
  label: string;
  /** 该分组包含的 dataset id；可以为空（例如仅作外链或阻断态说明）。 */
  datasetIds: string[];
  status?: HostStatus;
  note?: string;
  /** 证据等级，展示在分组 tooltip，避免把设计/待验证写成实见。 */
  evidence?: "实见" | "代码" | "设计" | "待验证";
  /** 复用入口：例如广告日志跳 /sellfox?domain=runs。存在时优先渲染跳转按钮而非数据表。 */
  href?: string;
  /** 写操作面板：嵌入可审计的广告优化方案组件（生成/审批/写闸门），不直接写外部系统。 */
  proposals?: boolean;
};

export type HostPage = {
  id: string;
  href: string;
  title: string;
  subtitle: string;
  /** 页面级来源徽标，全部是赛狐侧数据，不与 Amazon SP-API 混算。 */
  source: string;
  datasets: HostDataset[];
  /** 可选一级分组；未提供时沿用旧的扁平 dataset 标签栏，保持其它承接页零改动。 */
  groups?: HostTabGroup[];
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
