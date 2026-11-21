import type { SellfoxSyncResource } from "./sync-contract";

/**
 * 赛狐 Open API 全量数据域规划表。
 *
 * live     : 已有同步实现、有落表，可直接拉取
 * planned  : 文档已确认、落表与同步器待实现
 * blocked  : 依赖赛狐后台开通接口权限 / 平台侧授权
 *
 * api 字段只写本地文档（sellfox-api-docs）里能核对到的真实路径；
 * 文档尚未补齐的读取接口标注「文档：接口名」，不臆造路径。
 */
export type SellfoxPlanStatus = "live" | "planned" | "blocked";
export type SellfoxPlanPriority = "P0" | "P1" | "P2";

export type SellfoxPlanItem = {
  id: string;
  label: string;
  api: string[];
  table?: string;
  resource?: SellfoxSyncResource;
  status: SellfoxPlanStatus;
  priority: SellfoxPlanPriority;
  note?: string;
  href?: string;
};

export type SellfoxPlanGroup = {
  id: string;
  label: string;
  hint: string;
  items: SellfoxPlanItem[];
};

export const sellfoxPlanGroups: SellfoxPlanGroup[] = [
  {
    id: "overview",
    label: "数据总览",
    hint: "店铺与口径底盘，所有数据域都按店铺范围落表",
    items: [
      { id: "stores", label: "店铺列表", api: ["/api/shop/pageList.json"], table: "SellfoxStore", resource: "stores", status: "live", priority: "P0", note: "B0 底座已落地（实测 payload 定型）：响应 rows[] 真实字段 id(赛狐 shopId)→externalId、name、sellerId(Amazon Seller ID,14位)→sellerAccountId、marketplaceId→marketplace、region、status。sellerAccountId 缺失保留 NULL 不臆造；syncStores 已按实测字段落库。" },
      { id: "marketplace", label: "站点 MarketplaceId 映射", api: ["文档：站点MarketplaceId对应关系"], status: "live", priority: "P0", note: "实测确认：店铺列表 rows[].marketplaceId 即 Amazon MarketplaceId（如 ATVPDKIKX0DER），已随店铺同步落 SellfoxStore.marketplace，作为 B0 底座供 sellerAccountId + marketplaceId 与 Amazon 站点对齐" },
      { id: "sub-account", label: "子账号列表", api: ["文档：获取子账号列表"], status: "live", priority: "P2", note: "业务员/开发员归属维度 子账号（69），global/none 通用采集器。" },
      { id: "exchange-rate", label: "汇率列表", api: ["文档：汇率列表"], status: "live", priority: "P0", note: "多币种利润汇总前置条件 汇率（month=yyyyMM+codes），global/range 通用采集器，实测 2 行；多币种汇总前置。" },
    ],
  },
  {
    id: "product",
    label: "商品",
    hint: "本地商品库 + 平台在线产品（Listing）",
    items: [
      { id: "listings", label: "在线产品（Listing）", api: ["/api/order/api/product/v2/pageList.json"], table: "SellfoxListingSnapshot", resource: "listings", status: "live", priority: "P0", href: "/sellfox/listings" },
      { id: "listing-log", label: "Listing 操作日志", api: ["文档：查询Listing操作日志列表"], status: "planned", priority: "P2" },
      { id: "sku", label: "SKU 商品库", api: ["文档：查询SKU"], status: "live", priority: "P0", note: "本地 SKU 主数据、成本、开发员；写入用 /api/commodity/create.json SKU 商品库（含成本 purchaseCost/开发员），global/none 通用采集器，实测 2799 行。" },
      { id: "spu", label: "SPU 款名", api: ["文档：查询SPU"], status: "live", priority: "P0", note: "写入用 /api/commodity/insertMultiattributeCommodityV2.json SPU 款名，global/none 通用采集器；当前租户实测 0 行但接口已通。" },
      { id: "category", label: "商品分类", api: ["/api/category/updateCategory.json"], status: "live", priority: "P2", note: "已有增删改，缺查询列表 分类树（顶层数组），global/none 通用采集器，实测 20 行。" },
      { id: "brand", label: "品牌库", api: ["文档：查询品牌"], status: "live", priority: "P2", note: "品牌库，global/none 通用采集器，实测 12 行。" },
      { id: "attrs", label: "商品属性", api: ["文档：获取商品属性列表"], status: "live", priority: "P2", note: "商品属性字典（rowsPath=commodityAttributeVoList），global/none 通用采集器，实测 2 类。" },
      { id: "aux-material", label: "辅料 / 质检模板", api: ["文档：查询辅料", "文档：质检模板列表"], status: "planned", priority: "P2" },
      { id: "product-detail", label: "商品详情 V2", api: ["文档：查看商品详情V2"], status: "planned", priority: "P2", note: "与 SKU 主数据同源，落详情字段" },
      { id: "tags", label: "产品标签", api: ["/api/stats/labelManage/createLabel.json"], status: "planned", priority: "P2", note: "已有打标写入，缺标签列表查询" },
      { id: "reviews", label: "评价明细", api: ["文档：获取评价明细列表"], status: "live", priority: "P1", note: "评价明细（startDate/endDate≤1年），global/range 通用采集器，实测 570 行。" },
      { id: "listing-pair", label: "多平台配对", api: ["文档：查询多平台配对列表"], status: "planned", priority: "P2" },
    ],
  },
  {
    id: "sales",
    label: "销售与利润",
    hint: "按日快照，是销量 / 利润 / 补货建议的计算底座",
    items: [
      { id: "sales", label: "销量统计（日）", api: ["文档：获取销量数据"], table: "SellfoxSalesDailySnapshot", resource: "sales", status: "live", priority: "P0", href: "/sellfox/sales" },
      { id: "performance", label: "销售利润（产品维度日）", api: ["文档：获取销售利润数据(产品)"], table: "SellfoxProductDailySnapshot", resource: "performance", status: "live", priority: "P0", href: "/sellfox/performance" },
      { id: "product-analysis", label: "产品分析 2.0", api: ["文档：获取产品分析数据（2.0）"], status: "live", priority: "P1", note: "BSR / 评分 / 流量结构 产品分析2.0（searchType=sku，BSR/评分/流量/广告/利润全维），global/range 通用采集器，实测 1629 行；金额为 number/字符串，建 typed 表须转 Decimal。" },
      { id: "store-performance", label: "店铺表现按天", api: ["文档：店铺表现按天查询"], status: "live", priority: "P1", note: "店铺表现按天（顶层数组），global/range 通用采集器，实测单区间 246 行。" },
      { id: "custom-report", label: "自定义报表", api: ["文档：获取自定义报表列表数据"], status: "planned", priority: "P2" },
      { id: "profit-report", label: "利润报表／结算利润（9 维度 × 2 套）", api: ["/api/financial/v2/monthProfit/shop.json", "/api/financial/v2/monthProfit/sku.json", "/api/financial/v2/monthProfit/msku.json", "/api/financial/v2/monthProfit/asin.json", "/api/financial/v2/monthProfit/parentAsin.json", "/api/financial/v2/monthProfit/spu.json", "/api/financial/v2/monthProfit/developer.json", "/api/financial/v2/monthProfit/salesMan.json", "/api/financial/v2/monthProfit/shopSummary.json"], status: "planned", priority: "P1", note: "通用采集器落地（实测已验证）：用真实凭据+dateType=2/yyyyMMdd 调通 shop/asin 等维度，reportList[] 返回 200+ 数值字段（salesNum/productSales/grossProfit/roi 等）及 currency+rate；shopSummary 传同参报 40014 需单独校准。响应字段无官方定义，仍走 fin_profit_* 种子 payload 原样落 SellfoxApiRecord，不臆造 typed 表；金额上游为 number，建 typed 表时须按规范转 Decimal(18,4)+三列。口径与日快照独立不覆盖" },
    ],
  },
  {
    id: "order",
    label: "订单",
    hint: "订单主链，驱动利润与售后",
    items: [
      { id: "orders", label: "订单列表与明细", api: ["/api/order/pageList.json"], table: "SellfoxOrderSnapshot", resource: "orders", status: "live", priority: "P0", href: "/sellfox/orders" },
      { id: "order-detail", label: "订单详情（批量）", api: ["/api/order/detailByOrderIds.json"], table: "SellfoxOrderDetail", resource: "order_detail", status: "live", priority: "P0", href: "/sellfox/order-detail", note: "一单一行，原始响应保真；由订单快照的 sellerOrderId 分批驱动，明细行与费用项见 payload。契约见 docs/sellfox-api-docs/API.md#api-476895394" },
      { id: "fbm-order", label: "FBM 订单列表／详情", api: ["/api/packageShip/getPackagePage.json", "文档：FBM订单列表", "文档：FBM订单详情"], status: "planned", priority: "P2", note: "已登记通用端点种子（默认停用，fbm_orders）；purchaseDateStart/End 用 yyyy-MM-dd，shopIdList 传字符串店铺 ID" },
      { id: "order-process", label: "订单处理列表／详情", api: ["文档：查询订单处理列表", "文档：查询订单处理详情"], status: "live", priority: "P2", note: "订单处理列表（purchaseDateStart/End），global/range 通用采集器。" },
      { id: "returns", label: "FBA / FBM 退货报告", api: ["/api/order/api/report/fbaReturn/pageList.json", "/api/order/api/report/fbm/return/order/pageList.json"], status: "live", priority: "P1", note: "FBA/FBM 退货报告（returnStartDate/End），global/range 通用采集器，FBA 实测 1967 行。" },
    ],
  },
  {
    id: "ads",
    label: "广告",
    hint: "SP / SB / SD 六类日报 + 小时曲线 + 管理实体（报表共用下载通道，按 reportTypeCode 约束裁剪 adType）",
    items: [
      { id: "ads_product", label: "广告产品报告", api: ["/api/cpc/download/createTask.json"], table: "SellfoxAdsProductDaily", resource: "ads_report", status: "live", priority: "P1", note: "SP/SB/SD 共用表（adType 区分）；SD 仅支持 adProductReport" },
      { id: "ads_campaign", label: "广告活动报告", api: ["/api/cpc/download/createTask.json"], table: "SellfoxAdsCampaignDaily", resource: "ads_campaign", status: "live", priority: "P1", note: "SP/SB/SD 均支持" },
      { id: "ads_ad_group", label: "广告组报告", api: ["/api/cpc/download/createTask.json"], table: "SellfoxAdsAdGroupDaily", resource: "ads_ad_group", status: "live", priority: "P1", note: "SP/SB/SD 均支持" },
      { id: "ads_placement", label: "广告位报告", api: ["/api/cpc/download/createTask.json"], table: "SellfoxAdsPlacementDaily", resource: "ads_placement", status: "live", priority: "P2", note: "仅 SP/SB（SD 无广告位报告）" },
      { id: "ads_targeting", label: "投放（关键词/商品）报告", api: ["/api/cpc/download/createTask.json"], table: "SellfoxAdsTargetingDaily", resource: "ads_targeting", status: "live", priority: "P1", note: "SP/SB（SD 投放走 sdTargetListReport，未纳入）" },
      { id: "ads_search_term", label: "搜索词报告", api: ["/api/cpc/download/createTask.json"], table: "SellfoxAdsSearchTermDaily", resource: "ads_search_term", status: "live", priority: "P1", note: "仅 SP/SB（SD 无搜索词报告）" },
      { id: "hourly", label: "SP 小时报告", api: ["/api/cpc/hourData/spCampaign.json"], table: "SellfoxHourlyMetric", resource: "hourly", status: "live", priority: "P2", note: "当前实现只取每店前 5 个 SP 活动" },
      { id: "ads-manage", label: "SP 广告管理实体（活动/组/产品/关键词/商品投放/否定词/否定商品）", api: ["/api/cpc/manageData/spCampaign.json", "/api/cpc/manageData/spGroup.json", "/api/cpc/manageData/spAdProduct.json", "/api/cpc/manageData/spKeyword.json", "/api/cpc/manageData/spTarget.json", "/api/cpc/manageData/spNeKeyword.json", "/api/cpc/manageData/spNeTarget.json"], status: "planned", priority: "P1", note: "广告结构树，用于投放诊断" },
      { id: "ads-manage-sb-sd", label: "SB／SD 广告管理实体", api: ["/api/cpc/manageData/sbCampaign.json", "/api/cpc/manageData/sbGroup.json", "/api/cpc/manageData/sbAdProduct.json", "/api/cpc/manageData/sbTarget.json", "/api/cpc/manageData/sbKeyword.json", "/api/cpc/manageData/sbNeKeyword.json", "/api/cpc/manageData/sbNeTarget.json", "/api/cpc/manageData/sdCampaign.json", "/api/cpc/manageData/sdGroup.json", "/api/cpc/manageData/sdAdProduct.json", "/api/cpc/manageData/sdCreative.json", "/api/cpc/manageData/sdTarget.json", "/api/cpc/manageData/sdNeTarget.json"], status: "planned", priority: "P1", note: "管理实体（活动结构/创意），与报表不同通道；待接入" },
      { id: "hourly-sb-sd", label: "SB／SD 小时报告（8 类）", api: ["文档：小时报告-SB广告活动／广告组／投放／广告位", "文档：小时报告-SD广告活动／广告组／广告产品／投放"], status: "planned", priority: "P2" },
      { id: "aba", label: "ABA 搜索词", api: ["/api/cpc/searchTerms/pageList.json"], status: "planned", priority: "P1" },
    ],
  },
  {
    id: "inventory",
    label: "库存",
    hint: "FBA 在仓 + 本地仓 + 流水，补货建议的输入",
    items: [
      { id: "inventory", label: "FBA 库存明细", api: ["文档：查询FBA库存明细"], table: "SellfoxFbaInventorySnapshot", resource: "inventory", status: "live", priority: "P0", href: "/sellfox/restock" },
      { id: "warehouse", label: "仓库列表", api: ["文档：查询仓库列表"], status: "live", priority: "P1", note: "仓库列表，global/none 通用采集器，实测 24 行。" },
      { id: "local-inventory", label: "本地仓库存明细", api: ["文档：查询库存明细"], status: "live", priority: "P1", note: "本地仓库存明细（含成本三列口径），global/none 通用采集器，实测 2047 行。" },
      { id: "inventory-flow", label: "库存流水", api: ["文档：获取库存流水"], status: "live", priority: "P2", note: "库存流水（createTimeStart/End），global/range 通用采集器，实测 6423 行。" },
      { id: "age", label: "库龄报表", api: ["文档：库龄报表列表页"], status: "live", priority: "P1", note: "库龄报表（showCost=1），global/none 通用采集器，实测 1977 行。" },
      { id: "bin", label: "货架位", api: ["文档：货架位列表分页查询"], status: "planned", priority: "P2" },
      { id: "in-out", label: "其他出入库单", api: ["/api/warehouseInOut/inRecords.json", "/api/warehouseInOut/outRecords.json"], status: "planned", priority: "P2" },
      { id: "stock-ops", label: "库存单据（调整／调拨／盘点／加工／拆分）", api: ["文档：查询调整单列表", "文档：调拨单列表", "文档：盘点单列表", "文档：加工单列表页", "文档：拆分单列表页"], status: "planned", priority: "P2" },
      { id: "removal-order", label: "移除入库单", api: ["文档：移除入库单列表查询"], status: "live", priority: "P2", note: "移除入库单，global/none 通用采集器，实测 29 行。" },
    ],
  },
  {
    id: "fba",
    label: "FBA 发货",
    hint: "货件、发货单、装箱与入库计划",
    items: [
      { id: "fba_shipments", label: "FBA 货件", api: ["文档：获取FBA货件列表"], table: "SellfoxFbaShipmentSnapshot", resource: "fba_shipments", status: "live", priority: "P0", href: "/sellfox/shipments" },
      { id: "fba-shipment-products", label: "货件产品明细", api: ["/api/fbaShipment/shipmentItemList.json", "/api/fbaShipment/batchQuery/shipmentItemList.json"], status: "planned", priority: "P1" },
      { id: "fba-dispatch", label: "FBA 发货单", api: ["/api/fba/shippingOrder/items.json", "/api/fba/shippingOrder/detailByShipSn.json", "/api/fba/shippingOrder/create.json"], status: "planned", priority: "P1" },
      { id: "fba-packing", label: "装箱 / 入库计划", api: ["/api/packing/task/createPackingListByBox.json", "/api/inbound/createInboundPlan.json", "/api/inbound/getInboundPlan.json", "文档：查询装箱任务列表"], status: "planned", priority: "P2" },
      { id: "oversea-stock", label: "海外仓备货单", api: ["文档：海外仓备货单列表页", "文档：海外仓备货单详情"], status: "planned", priority: "P2" },
      { id: "batch-flow", label: "批次入库／出库／签收", api: ["文档：获取批次入库数据", "文档：获取批次出库数据", "文档：获取货件签收数据"], status: "planned", priority: "P2" },
    ],
  },
  {
    id: "purchase",
    label: "采购",
    hint: "采购单、计划与供应商，串起成本链路",
    items: [
      { id: "purchase-order", label: "采购单", api: ["文档：采购单列表"], status: "live", priority: "P1", note: "改数用 /api/purchase/updatePurchaseQuantity.json 等 采购单（含 currency/exchangeRate），global/none 通用采集器，实测 2962 行。" },
      { id: "purchase-plan", label: "采购计划", api: ["/api/purchasePlan/create.json", "文档：采购计划分页查询"], status: "planned", priority: "P2" },
      { id: "supplier", label: "供应商", api: ["/api/supplier/createOrUpdate.json", "文档：获取供应商列表"], status: "live", priority: "P2", note: "供应商，global/none 通用采集器，实测 512 行。" },
      { id: "purchase-return", label: "采购退货 / 变更单", api: ["/api/purchaseReturned/create.json", "/api/purchaseChange/createV2.json", "文档：查询采购退货单列表"], status: "planned", priority: "P2" },
      { id: "purchase-receipt", label: "采购入库单", api: ["文档：查询采购入库单列表"], status: "planned", priority: "P1" },
      { id: "purchase-meta", label: "结算方式 / 采购方", api: ["文档：获取所有结算方式", "文档：采购方列表"], status: "planned", priority: "P2" },
      { id: "first-leg", label: "头程分摊 / 成本调整", api: ["文档：头程分摊列表页", "文档：查询成本调整单列表"], status: "planned", priority: "P2" },
    ],
  },
  {
    id: "finance",
    label: "财务",
    hint: "结算、应收、发票与资金单据",
    items: [
      { id: "settlement", label: "结算汇总 / 明细", api: ["/api/financial/v2/settlementSummary/detailPage.json", "/api/financial/v2/settlementSummary/groupPage.json"], status: "live", priority: "P0", href: "/sellfox/endpoint-data?code=fin_settlement_detail_v2", note: "结算中心 V2，已登记通用端点种子 fin_settlement_detail_v2 / fin_settlement_summary_v2（原始行落 SellfoxApiRecord，不猜字段）；结算口径不与日利润快照相加。契约见 docs/sellfox-api-docs/API.md#api-399397941" },
      { id: "receivable", label: "应收报表", api: ["文档：获取应收报表数据"], status: "live", priority: "P1", note: "应收报表（bizDate=yyyyMM，含 rate），global/range 通用采集器，实测 39 行；文档标注即将下线。" },
      { id: "invoice", label: "发票与广告发票", api: ["文档：查询发票详情", "文档：查询广告发票列表-V2"], status: "planned", priority: "P2" },
      { id: "payment", label: "付款单 / 收款单 / 请款池", api: ["文档：查询付款单列表", "文档：查询收款单列表", "文档：查询请款单列表"], status: "planned", priority: "P2" },
      { id: "delay", label: "延迟金额 / 延迟交易", api: ["文档：延迟金额", "文档：延迟交易"], status: "planned", priority: "P2" },
      { id: "fba-fee", label: "FBA 仓库明细 / 汇总", api: ["/api/finance/fbaStockDetail/pageList.json", "/api/finance/fbaWarehouseSummary/pageList.json"], status: "live", priority: "P1", note: "FBA 仓库明细费用（startMonth/End=yyyy-MM，60+ 金额列），global/range 通用采集器，实测 2179 行；建 typed 表须转 Decimal(18,4)+三列。" },
    ],
  },
  {
    id: "system",
    label: "报表与工具",
    hint: "Amazon 原生报表与多平台数据",
    items: [
      { id: "amazon-report", label: "Amazon 原表 / 报告任务", api: ["/api/report/center/add.json", "/api/report/center/pageList.json", "/api/report/center/task/createTask.json"], status: "planned", priority: "P2" },
      { id: "amazon-fee", label: "赔偿 / 盘库 / 仓储费报告", api: ["文档：获取Amazon赔偿报告", "文档：获取Amazon长期仓储费报告"], status: "planned", priority: "P2" },
    ],
  },
];

export const sellfoxLiveDatasets: {
  key: string;
  label: string;
  resource: SellfoxSyncResource;
  table: string;
  href?: string;
  dateField: "reportDate" | "capturedAt" | "purchaseDate" | "latestCapturedAt";
}[] = [
  { key: "listings", label: "在线产品", resource: "listings", table: "SellfoxListingSnapshot", href: "/sellfox/listings", dateField: "capturedAt" },
  { key: "inventory", label: "FBA 库存", resource: "inventory", table: "SellfoxFbaInventorySnapshot", href: "/sellfox/restock", dateField: "reportDate" },
  { key: "sales", label: "销量日快照", resource: "sales", table: "SellfoxSalesDailySnapshot", href: "/sellfox/sales", dateField: "reportDate" },
  { key: "performance", label: "利润日快照", resource: "performance", table: "SellfoxProductDailySnapshot", href: "/sellfox/performance", dateField: "reportDate" },
  { key: "orders", label: "订单快照", resource: "orders", table: "SellfoxOrderSnapshot", href: "/sellfox/orders", dateField: "purchaseDate" },
  { key: "fba_shipments", label: "FBA 货件", resource: "fba_shipments", table: "SellfoxFbaShipmentSnapshot", href: "/sellfox/shipments", dateField: "latestCapturedAt" },
  { key: "ads_report", label: "广告产品日报", resource: "ads_report", table: "SellfoxAdsProductDaily", dateField: "reportDate" },
  { key: "ads_campaign", label: "广告活动日报", resource: "ads_campaign", table: "SellfoxAdsCampaignDaily", dateField: "reportDate" },
  { key: "ads_ad_group", label: "广告组日报", resource: "ads_ad_group", table: "SellfoxAdsAdGroupDaily", dateField: "reportDate" },
  { key: "ads_targeting", label: "投放日报", resource: "ads_targeting", table: "SellfoxAdsTargetingDaily", dateField: "reportDate" },
  { key: "ads_search_term", label: "搜索词日报", resource: "ads_search_term", table: "SellfoxAdsSearchTermDaily", dateField: "reportDate" },
  { key: "ads_placement", label: "广告位日报", resource: "ads_placement", table: "SellfoxAdsPlacementDaily", dateField: "reportDate" },
];

export function sellfoxPlanSummary() {
  const items = sellfoxPlanGroups.flatMap((group) => group.items);
  return {
    total: items.length,
    live: items.filter((item) => item.status === "live").length,
    planned: items.filter((item) => item.status === "planned").length,
    blocked: items.filter((item) => item.status === "blocked").length,
  };
}
