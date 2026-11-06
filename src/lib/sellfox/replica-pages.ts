export type ReplicaId = "sales" | "performance" | "listings" | "orders" | "shipments" | "restock";
export type ReplicaColumnKind = "text" | "image" | "qty" | "decimal" | "money" | "rate" | "store" | "mskuPrice" | "skuName" | "titleAsin" | "asinMsku" | "salesWindow" | "tags" | "people" | "metric" | "missing" | "icon";
export type ReplicaColumn = { key: string; label: string; kind?: ReplicaColumnKind; defaultVisible?: boolean };
export type ReplicaAction = { id: string; label: string; disabled?: boolean; reason?: string };
export type ReplicaDimension = { id: string; label: string; disabled?: boolean; reason?: string };
export type ReplicaCheck = { id: string; label: string; disabled?: boolean; reason?: string };
export type ReplicaQuery = "workbench" | "agent" | "snapshot" | "stub";

export type ReplicaPage = {
  id: ReplicaId;
  href: string;
  title: string;
  nav: string;
  subtitle: string;
  endpoint: string;
  stub: boolean;
  query: ReplicaQuery;
  dimensions: ReplicaDimension[];
  metrics: { id: string; label: string }[];
  searchTypes: { id: string; label: string }[];
  showDate: boolean;
  dateLabel: string;
  currency: boolean;
  fulfillment: boolean;
  status: boolean;
  tagFilter: boolean;
  salespersonFilter: boolean;
  columns: ReplicaColumn[];
  actions: ReplicaAction[];
  checks: ReplicaCheck[];
  emptyTitle: string;
  emptyHint: string;
};

const locked = "赛狐页面有此控件，本地快照没有对应字段，不造数。";
const noWrite = "此复刻页不发起同步或导入，避免写入数据库。";
const salesDims: ReplicaDimension[] = [
  { id: "asin", label: "ASIN" },
  { id: "parentAsin", label: "父ASIN" },
  { id: "msku", label: "MSKU" },
  { id: "sku", label: "SKU" },
  { id: "spu", label: "SPU" },
  { id: "store", label: "店铺" },
  { id: "developer", label: "开发员" },
  { id: "salesperson", label: "业务员", disabled: true, reason: "销量日快照没有业务员维度，不从 Listing 开发员伪造。" },
];

const searchAsin = [
  { id: "asin", label: "ASIN" },
  { id: "parentAsin", label: "父ASIN" },
  { id: "msku", label: "MSKU" },
  { id: "sku", label: "SKU" },
  { id: "title", label: "标题" },
];

export const replicaPages: ReplicaPage[] = [
  {
    id: "sales",
    href: "/sellfox/sales",
    title: "销量统计",
    nav: "数据 → 销量统计",
    subtitle: "读取 SellfoxSalesDailySnapshot 汇总。同步按钮不在此页写入。",
    endpoint: "/api/sellfox/sales",
    stub: false,
    query: "workbench",
    dimensions: salesDims,
    metrics: [
      { id: "quantity", label: "销量" },
      { id: "orders", label: "订单量" },
      { id: "revenue", label: "销售额" },
    ],
    searchTypes: searchAsin,
    showDate: true,
    dateLabel: "日期范围",
    currency: true,
    fulfillment: true,
    status: false,
    tagFilter: true,
    salespersonFilter: false,
    columns: [
      { key: "mainImage", label: "图片", kind: "image" },
      { key: "asin", label: "ASIN" },
      { key: "store", label: "店铺/站点", kind: "store" },
      { key: "analysis", label: "分析", kind: "icon" },
      { key: "operations", label: "运营", kind: "icon" },
      { key: "insight", label: "销量洞察", kind: "icon" },
      { key: "parentAsin", label: "父ASIN" },
      { key: "msku", label: "MSKU/售价", kind: "mskuPrice" },
      { key: "sku", label: "品名/SKU", kind: "skuName" },
      { key: "spu", label: "款名/SPU", kind: "missing" },
      { key: "productTags", label: "产品标签", kind: "tags" },
      { key: "title", label: "标题" },
      { key: "salesperson", label: "业务员", kind: "people" },
      { key: "owner", label: "业绩归属人", kind: "missing" },
      { key: "category", label: "分类", kind: "missing" },
      { key: "brand", label: "商品品牌" },
      { key: "fulfillable", label: "FBA可售", kind: "qty" },
      { key: "subtotal", label: "小计", kind: "metric" },
    ],
    actions: [
      { id: "sync", label: "同步", disabled: true, reason: noWrite },
      { id: "export", label: "导出" },
      { id: "columns", label: "自定义列" },
      { id: "refresh", label: "刷新" },
      { id: "help", label: "帮助" },
    ],
    checks: [
      { id: "aggregate", label: "按维度汇总", disabled: true, reason: "本地查询始终按当前维度汇总，没有未汇总明细表。" },
      { id: "realtime", label: "实时统计", disabled: true, reason: "页面只读已同步快照，不在浏览器里拉赛狐。" },
      { id: "hideZero", label: "隐藏销量为0的产品" },
      { id: "evaluation", label: "测评产品", disabled: true, reason: locked },
      { id: "exchange", label: "去除换货销量", disabled: true, reason: locked },
    ],
    emptyTitle: "暂无数据",
    emptyHint: "当前店铺和日期范围内没有销量快照。",
  },
  {
    id: "performance",
    href: "/sellfox/performance",
    title: "销售利润",
    nav: "数据 → 销售利润",
    subtitle: "读取 SellfoxProductDailySnapshot。金额缺失保持空白，不补 0。",
    endpoint: "/api/sellfox/performance",
    stub: false,
    query: "workbench",
    dimensions: salesDims.map((item) => item.id === "salesperson" ? { id: "salesperson", label: "业务员", disabled: true, reason: "利润查询维度没有业务员键；业务员只作筛选（payload.userNameList）。" } : item),
    metrics: [],
    searchTypes: searchAsin,
    showDate: true,
    dateLabel: "订购时间",
    currency: true,
    fulfillment: true,
    status: false,
    tagFilter: true,
    salespersonFilter: true,
    columns: [
      { key: "mainImage", label: "图片", kind: "image" },
      { key: "identity", label: "标题/ASIN", kind: "titleAsin" },
      { key: "parentAsin", label: "父ASIN" },
      { key: "sku", label: "品名/SKU", kind: "skuName" },
      { key: "grossProfit", label: "毛利润", kind: "money" },
      { key: "grossProfitRate", label: "毛利率", kind: "rate" },
      { key: "netProfitRate", label: "净销售额毛利率", kind: "rate" },
      { key: "saleRevenue", label: "销售额", kind: "money" },
      { key: "netRevenue", label: "净销售额", kind: "money" },
      { key: "orderNum", label: "订单量", kind: "qty" },
      { key: "fulfillable", label: "FBA可售", kind: "qty" },
      { key: "saleQuantity", label: "销量", kind: "qty" },
      { key: "evaluationSaleNum", label: "测评销量", kind: "qty" },
      { key: "channelSaleNum", label: "多渠道销量", kind: "qty" },
      { key: "promotionDiscount", label: "促销折扣", kind: "money" },
      { key: "giftWrapFee", label: "礼品包装费", kind: "money" },
      { key: "shippingChargeAmount", label: "买家运费", kind: "money" },
    ],
    actions: [
      { id: "customFee", label: "自定义费用", disabled: true, reason: noWrite },
      { id: "customMetric", label: "自定义指标", disabled: true, reason: locked },
      { id: "export", label: "导出" },
      { id: "columns", label: "自定义列" },
      { id: "refresh", label: "刷新" },
      { id: "help", label: "帮助" },
    ],
    checks: [
      { id: "onlySettle", label: "只统计已结算订单" },
      { id: "aggregate", label: "按维度汇总", disabled: true, reason: "本地查询始终按当前维度汇总。" },
    ],
    emptyTitle: "暂无数据",
    emptyHint: "当前店铺和订购时间范围内没有销售利润快照。",
  },
  {
    id: "listings",
    href: "/sellfox/listings",
    title: "在线产品",
    nav: "销售 → 在线产品",
    subtitle: "读取 SellfoxListingSnapshot 的当前快照视图 sellfox_listing_current。",
    endpoint: "/api/sellfox/listings",
    stub: false,
    query: "agent",
    dimensions: [
      { id: "child", label: "子体" },
      { id: "parent", label: "父体", disabled: true, reason: "父体汇总未接入，不造父体行。" },
    ],
    metrics: [],
    searchTypes: searchAsin,
    showDate: true,
    dateLabel: "上架时间",
    currency: false,
    fulfillment: true,
    status: true,
    tagFilter: false,
    salespersonFilter: false,
    columns: [
      { key: "status", label: "状态" },
      { key: "mainImage", label: "图片", kind: "image" },
      { key: "asin", label: "ASIN/MSKU", kind: "asinMsku" },
      { key: "title", label: "标题" },
      { key: "analysis", label: "分析", kind: "icon" },
      { key: "attrs", label: "属性", kind: "missing" },
      { key: "productTags", label: "产品标签", kind: "tags" },
      { key: "parentAsin", label: "父ASIN" },
      { key: "parentSku", label: "父SKU" },
      { key: "fnsku", label: "FNSKU" },
      { key: "sku", label: "品名/SKU", kind: "skuName" },
      { key: "store", label: "店铺/站点", kind: "store" },
      { key: "price", label: "价格", kind: "money" },
      { key: "sales7", label: "7|14|30天销量", kind: "salesWindow" },
      { key: "fulfillable", label: "可售", kind: "qty" },
      { key: "salesperson", label: "业务员", kind: "missing" },
      { key: "ops", label: "操作", kind: "icon" },
    ],
    actions: [
      { id: "pair", label: "配对", disabled: true, reason: noWrite },
      { id: "autoPair", label: "自动配对", disabled: true, reason: noWrite },
      { id: "assign", label: "分配业务员", disabled: true, reason: noWrite },
      { id: "sync", label: "同步", disabled: true, reason: noWrite },
      { id: "price", label: "调价", disabled: true, reason: noWrite },
      { id: "print", label: "打印", disabled: true, reason: locked },
      { id: "tag", label: "标签", disabled: true, reason: noWrite },
      { id: "import", label: "导入/导出", disabled: true, reason: "导入会写数据；当前页导出请用右侧导出，只下载已加载行。" },
      { id: "export", label: "导出" },
      { id: "columns", label: "自定义列" },
      { id: "refresh", label: "刷新" },
    ],
    checks: [],
    emptyTitle: "暂无数据",
    emptyHint: "当前筛选下没有在线产品快照。",
  },
  {
    id: "orders",
    href: "/sellfox/orders",
    title: "全部订单",
    nav: "订单 → 全部订单",
    subtitle: "读取 SellfoxOrderSnapshot。Worker 每 12 小时同步，此页不写库。",
    endpoint: "/api/sellfox/orders",
    stub: false,
    query: "snapshot",
    dimensions: [
      { id: "current", label: "2025年至今" },
      { id: "history", label: "历史订单", disabled: true, reason: "没有订单快照，历史订单不单独造一份空表。" },
    ],
    metrics: [],
    searchTypes: [
      { id: "order", label: "订单号" },
      { id: "asin", label: "ASIN" },
      { id: "msku", label: "MSKU" },
      { id: "sku", label: "SKU" },
    ],
    showDate: true,
    dateLabel: "订购时间",
    currency: true,
    fulfillment: true,
    status: true,
    tagFilter: false,
    salespersonFilter: true,
    columns: [
      { key: "store", label: "店铺/站点" },
      { key: "orderId", label: "订单号" },
      { key: "sellerOrderId", label: "卖家订单号" },
      { key: "purchaseAt", label: "订购时间" },
      { key: "payAt", label: "付款时间" },
      { key: "refundAt", label: "退款时间" },
      { key: "status", label: "订单状态" },
      { key: "revenue", label: "销售收益" },
      { key: "asin", label: "图片/ASIN/MSKU" },
      { key: "sku", label: "品名/SKU" },
      { key: "qty", label: "销量" },
      { key: "refundQty", label: "退款量" },
      { key: "promo", label: "促销编码" },
      { key: "amount", label: "产品金额" },
      { key: "profit", label: "订单利润/订单利润率" },
      { key: "ops", label: "操作" },
    ],
    actions: [
      { id: "fee", label: "录入费用", disabled: true, reason: noWrite },
      { id: "eval", label: "标记测评", disabled: true, reason: noWrite },
      { id: "invoice", label: "上传发票", disabled: true, reason: noWrite },
      { id: "sync", label: "同步订单", disabled: true, reason: noWrite },
      { id: "cost", label: "导入成本", disabled: true, reason: noWrite },
      { id: "columns", label: "自定义列" },
      { id: "export", label: "导出" },
    ],
    checks: [{ id: "unlimited", label: "不限制时间", disabled: true, reason: "请用订购时间筛选；不提供无日期的全表扫描开关。" }],
    emptyTitle: "暂无数据",
    emptyHint: "当前店铺和订购时间范围内没有订单快照。",
  },
  {
    id: "shipments",
    href: "/sellfox/shipments",
    title: "货件",
    nav: "FBA → 货件",
    subtitle: "读取 SellfoxFbaShipmentSnapshot 的最近一次完整采集。接口失败的店铺单独列出。",
    endpoint: "/api/sellfox/shipments",
    stub: false,
    query: "snapshot",
    dimensions: [],
    metrics: [],
    searchTypes: [
      { id: "shipment", label: "货件编号" },
      { id: "msku", label: "MSKU" },
      { id: "asin", label: "ASIN" },
    ],
    showDate: true,
    dateLabel: "创建时间",
    currency: false,
    fulfillment: false,
    status: true,
    tagFilter: false,
    salespersonFilter: false,
    columns: [
      { key: "store", label: "店铺/站点" },
      { key: "shipmentId", label: "货件编号" },
      { key: "name", label: "货件名称" },
      { key: "status", label: "货件状态" },
      { key: "createdAt", label: "创建时间" },
      { key: "shippedAt", label: "发货时间" },
      { key: "mskuCount", label: "MSKU种类" },
      { key: "declared", label: "申报量" },
      { key: "shipped", label: "已发货" },
      { key: "received", label: "签收量" },
      { key: "fc", label: "物流中心" },
      { key: "ops", label: "操作" },
    ],
    actions: [
      { id: "sync", label: "同步", disabled: true, reason: noWrite },
      { id: "export", label: "导出" },
      { id: "columns", label: "自定义列" },
      { id: "refresh", label: "刷新" },
    ],
    checks: [],
    emptyTitle: "暂无数据",
    emptyHint: "当前筛选下没有货件快照。",
  },
  {
    id: "restock",
    href: "/sellfox/restock",
    title: "补货建议",
    nav: "FBA → 补货建议",
    subtitle: "按可售、在途和 7/14/30 日均实时计算。备货 30 天、安全 7 天，不另存建议表。",
    endpoint: "/api/sellfox/restock",
    stub: false,
    query: "snapshot",
    dimensions: [
      { id: "asin", label: "ASIN" },
      { id: "msku", label: "MSKU" },
    ],
    metrics: [],
    searchTypes: searchAsin,
    showDate: false,
    dateLabel: "",
    currency: false,
    fulfillment: true,
    status: true,
    tagFilter: false,
    salespersonFilter: false,
    columns: [
      { key: "mainImage", label: "图片", kind: "image" },
      { key: "asin", label: "ASIN/MSKU", kind: "asinMsku" },
      { key: "sku", label: "品名/SKU", kind: "skuName" },
      { key: "store", label: "店铺/站点" },
      { key: "fulfillable", label: "FBA可售", kind: "qty" },
      { key: "reservedQty", label: "预留", kind: "qty" },
      { key: "unsellable", label: "不可售", kind: "qty" },
      { key: "warehousing", label: "在仓", kind: "qty" },
      { key: "inTransit", label: "在途", kind: "qty" },
      { key: "avg7", label: "7日均", kind: "decimal" },
      { key: "avg14", label: "14日均", kind: "decimal" },
      { key: "avg30", label: "30日均", kind: "decimal" },
      { key: "daily", label: "加权日均", kind: "decimal" },
      { key: "cover", label: "可售天数", kind: "decimal" },
      { key: "suggest", label: "建议补货量", kind: "qty" },
      { key: "suggestDate", label: "建议补货日" },
      { key: "local", label: "本地发FBA", kind: "missing" },
      { key: "salesperson", label: "业务员", kind: "missing" },
    ],
    actions: [
      { id: "generate", label: "生成建议", disabled: true, reason: "打开页面即按当前快照计算，不另存建议。" },
      { id: "sync", label: "同步", disabled: true, reason: noWrite },
      { id: "export", label: "导出" },
      { id: "columns", label: "自定义列" },
      { id: "refresh", label: "刷新" },
    ],
    checks: [],
    emptyTitle: "暂无数据",
    emptyHint: "当前筛选下没有可计算的在线产品。",
  },
];

export function replicaPage(id: string) {
  return replicaPages.find((item) => item.id === id);
}

export type DatePreset = "today" | "yesterday" | "d7" | "d14" | "d30" | "d90" | "thisMonth" | "lastMonth" | "custom";

export function shanghaiToday(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

export function addCalendarDays(iso: string, days: number) {
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

export function rangeForPreset(preset: DatePreset, today = shanghaiToday()) {
  if (preset === "today") return { from: today, to: today };
  if (preset === "yesterday") {
    const day = addCalendarDays(today, -1);
    return { from: day, to: day };
  }
  if (preset === "d7") return { from: addCalendarDays(today, -6), to: today };
  if (preset === "d14") return { from: addCalendarDays(today, -13), to: today };
  if (preset === "d30") return { from: addCalendarDays(today, -29), to: today };
  if (preset === "d90") return { from: addCalendarDays(today, -89), to: today };
  if (preset === "thisMonth") return { from: `${today.slice(0, 8)}01`, to: today };
  if (preset === "lastMonth") {
    const [year, month] = today.split("-").map(Number);
    const start = new Date(Date.UTC(year, month - 2, 1));
    const end = new Date(Date.UTC(year, month - 1, 0));
    return { from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) };
  }
  return { from: "", to: "" };
}

export const datePresets: { id: DatePreset; label: string }[] = [
  { id: "today", label: "今天" },
  { id: "yesterday", label: "昨天" },
  { id: "d7", label: "近7天" },
  { id: "d14", label: "近14天" },
  { id: "d30", label: "近30天" },
  { id: "d90", label: "近90天" },
  { id: "thisMonth", label: "本月" },
  { id: "lastMonth", label: "上月" },
  { id: "custom", label: "自定义" },
];
