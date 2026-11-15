/**
 * 一级模块命名归一：页面元数据（page-meta）里保留着改造前的分组名，
 * 导航升级后统一映射到 11 个一级模块，保证面包屑、审计条与侧栏用同一套分类口径。
 */
const MODULE_LABEL_ALIASES: Record<string, string> = {
  商品管理: "商品中心",
  销售管理: "销售与订单",
  广告管理: "广告中心",
  采购管理: "采购管理",
  仓库管理: "库存管理",
  物流发货: "物流管理",
  财务管理: "财务管理",
  数据中心: "数据中心",
  "AI 与工具": "AI 智能工作台",
  系统设置: "系统管理",
  首页: "工作台",
  工作台: "工作台",
};

export function normalizeModuleLabel(label: string | undefined | null): string {
  if (!label) return "";
  return MODULE_LABEL_ALIASES[label] ?? label;
}
