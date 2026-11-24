/**
 * Wimoor ↔ 本项目 ↔ SP-API 字段级对标目录。
 *
 * 数据来源：`docs/wimoor-sp-api-field-mapping-audit-2026-11-24.md`（静态映射核对表，
 * 取证基于 HEAD af8f453a / Wimoor ec86736b）。本模块把该文档 §3 的逐页字段映射结构化，
 * 使「差距」可机读、可验证、可聚合，供对标看板与覆盖状态机消费。
 *
 * 覆盖状态（五态）：
 * - explicit        文档 ✅：模型有显式列且 SP-API 源已接入解析链路
 * - extractable     文档 🟡 / 部分 🔴：字段落在 Json 透传列、需主档 join，或可从原始行 Json 提取
 * - derived         派生指标（文档 ⚪/🔴），已按 Wimoor 源码实证公式实现（见 wimoor-derived-metrics）
 * - pending-data    静态映射已给出，但需迁移+真实数据才能落库/取值核验（文档 ⏳ 且依赖数据）
 * - pending-decision 需先拍板口径或本地录入（汇率/含税/PII/本地费用等），不臆造
 *
 * 红线：本目录只是「可见性」层，不改变任何数据。所有派生公式取自 Wimoor 源码实证，
 * 未拍板口径项一律 pending-decision，不生成假值。
 */

export type Priority = "P0" | "P1" | "P2" | "-";

export type CoverageState =
  | "explicit"
  | "extractable"
  | "derived"
  | "pending-data"
  | "pending-decision";

export type FieldMapping = {
  /** Wimoor 页面列名 */
  label: string;
  /** Wimoor 表列绑定 prop */
  prop: string;
  /** 本项目 Prisma 模型.字段（或候选） */
  modelField: string;
  /** SP-API 报告 / API 元素（实证） */
  spapi: string;
  state: CoverageState;
  priority: Priority;
  /** 差距 / 核验动作 */
  note: string;
  /** 文档标记 ⏳：取值一致性待迁移跑通后核验 */
  valueCheck: boolean;
};

export type FieldGroup = {
  /** 页面 key */
  page: string;
  /** 页面中文名 */
  pageLabel: string;
  /** Wimoor 路由 */
  wimoorRoute: string;
  fields: FieldMapping[];
};

const f = (
  label: string,
  prop: string,
  modelField: string,
  spapi: string,
  state: CoverageState,
  priority: Priority,
  note: string,
  valueCheck = false,
): FieldMapping => ({ label, prop, modelField, spapi, state, priority, note, valueCheck });

/** 全量字段目录（§3.1–§3.9）。 */
export const FIELD_GROUPS: FieldGroup[] = [
  {
    page: "listing/products",
    pageLabel: "商品 Listing",
    wimoorRoute: "listing/products",
    fields: [
      f("图片", "image", "ProductMedia.url/thumbUrl；AmazonCatalogImageReference", "Catalog mainImage.link；listings image-url", "extractable", "P1", "按 ASIN 回查主图；迁移后核对空图兜底", true),
      f("产品信息", "name", "ProductListing.title/sku/asin；ProductMaster", "ItemSummaryByMarketplace.itemName/asin", "extractable", "P1", "标题主档 join；核对多语言标题来源", true),
      f("售价", "price", "ProductListing.price/currency", "listings your-price/price；Catalog 报价", "explicit", "-", "核对价格币种与精度 Decimal(20,4)", true),
      f("类型", "ptype", "ProductVariant.attributes(Json)；CatalogSnapshot.listingAttributes(Json)", "ItemSummaryByMarketplace.productType", "pending-data", "P1", "产品类型未提显式列；筛选/分组需要时再提列"),
      f("价格(含落地)", "landedAmount", "无", "派生（售价+税费/头程，口径未确认）", "pending-decision", "P2", "派生列；含税/头程口径未拍板，确认前不默认展示"),
      f("listing价格", "listingAmount", "ProductListing.price（待核口径）", "listings 价格类元素", "extractable", "P1", "核对与 price 是否重复；若市场价/划线价需另列", true),
      f("运费", "shippingAmount", "无显式列；订单行亦无", "Orders ShippingPrice；listings 运费模板", "pending-data", "P0", "如需展示需在订单行或主档补列；SP 元素待契约复核"),
      f("销售数据", "组合槽位", "销售/广告汇总（见 order-period-summary / ads）", "销售报告+广告报告", "derived", "P0", "派生汇总：依赖 order-period-summary 与广告汇总层，见派生层"),
      f("国家", "country", "ProductListing.marketplaceId → Marketplace", "报告 marketplace-id", "explicit", "-", "维度存在，核对站点映射表完整性", true),
      f("库存数量", "quantity", "ProductListing.inventory；InventorySnapshot.fulfillableQuantity", "库存报告可售数量", "explicit", "-", "两处库存口径需统一来源", true),
      f("备注", "remark", "无", "本地人工备注（非 SP-API）", "pending-decision", "P2", "若需人工备注建本地表，不进同步覆盖"),
      f("操作", "operate", "—", "—", "explicit", "-", "UI 动作列，非数据字段"),
    ],
  },
  {
    page: "order/order_manager",
    pageLabel: "订单",
    wimoorRoute: "order/order_manager",
    fields: [
      f("图片", "image", "按 ASIN 关联 ProductMedia", "Catalog mainImage.link", "extractable", "-", "同商品主图链路", true),
      f("商品信息", "name", "AmazonOrderItemRecord.asin/sellerSku；标题 join 主档", "OrderItem Title/ASIN/SellerSKU", "extractable", "-", "行标题未持久化，join 主档后核对", true),
      f("订单号", "orderid", "AmazonOrderRecord.amazonOrderId", "AmazonOrderId", "explicit", "-", "身份键，核对唯一性与去重", true),
      f("订单总金额", "orderprice", "AmazonOrderRecord.grandTotalAmount/grandTotalOriginal/currencyCode", "OrderTotal.Amount/CurrencyCode", "explicit", "-", "核对头总额与行合计；原币/折算双值口径", true),
      f("数量/单价", "quantity", "AmazonOrderItemRecord.quantityOrdered/proceedsAmount", "OrderItem QuantityOrdered/ItemPrice", "explicit", "-", "已建；税费/折扣/运费等未分列", true),
      f("ItemTax 等行费用", "itemTax", "无（原始行 Json 保留）", "ItemTax/ShippingTax/PromotionDiscount/ShippingPrice/GiftWrapPrice/PointsGranted/ConditionNote", "extractable", "P0", "从原始行 fields Json 提取映射，见 wimoor-field-extract"),
      f("订购时间", "buydate", "AmazonOrderRecord.createdTime/marketplaceTimeZone", "PurchaseDate/LastUpdateDate", "explicit", "-", "时区：按站点时区展示", true),
      f("发票上传", "feedstatus", "无", "Feed/发票回传状态", "pending-decision", "P2", "需独立 Feed 状态模型，当前链路未覆盖"),
      f("邀评状态", "feedstatus", "无", "非 SP-API 直出", "pending-decision", "P2", "本地状态机/外部记录，当前未建模"),
      f("备注", "remark", "无", "本地备注", "pending-decision", "P2", "本地人工备注，非 SP-API 字段，需建本地表"),
      f("操作", "operate", "—", "—", "explicit", "-", "UI 动作列"),
    ],
  },
  {
    page: "order/refund",
    pageLabel: "退货",
    wimoorRoute: "order/refund",
    fields: [
      f("站点", "groupname", "AmazonReturnRecord.marketplaceId", "marketplace", "explicit", "-", "站点映射核对", true),
      f("订单号", "orderId", "AmazonReturnRecord.amazonOrderId", "amazon-order-id", "explicit", "-", "身份键核对", true),
      f("图片", "image", "按 ASIN 关联主档图", "Catalog 主图", "extractable", "-", "同前", true),
      f("商品信息", "name", "sellerSku/asin/fnsku；标题 join", "sku/asin/fnsku/product-name", "extractable", "-", "标题未持久化", true),
      f("购买时间", "purchaseDate", "无显式列（仅 returnAt）", "purchase-date", "extractable", "P0", "从原始行 Json 提取，见 wimoor-field-extract"),
      f("退款时间", "returnDate", "AmazonReturnRecord.returnAt", "return-date", "explicit", "-", "时区口径核对", true),
      f("退货数量", "quantity", "AmazonReturnRecord.quantity", "quantity", "explicit", "-", "核对负号/退仓口径", true),
      f("退货金额", "itemPrice", "无显式列（可从财务/结算退款行回补）", "refunded-amount", "extractable", "P0", "从原始行 Json 提取，见 wimoor-field-extract"),
      f("商品状况", "detailedDispositionName", "AmazonReturnRecord.disposition", "detailed-disposition-name/disposition", "extractable", "P1", "存原始枚举码；中文译名为字典层", true),
      f("退货原因", "reasonname", "reasonId → AmazonReturnReason.code", "reason-code/reason-description", "extractable", "P1", "仅存原因码，描述/中文名未存", true),
      f("退货留言", "customerComments", "无", "customer-comments", "pending-decision", "P1", "模型缺列；注意 PII 可取范围（§6.4）"),
      f("追踪编号", "licensePlateNumber", "无", "license-plate-number", "pending-data", "P1", "模型缺列"),
    ],
  },
  {
    page: "inventory/fba/detail",
    pageLabel: "库存明细",
    wimoorRoute: "inventory/fba/detail",
    fields: [
      f("产品信息", "name", "InventorySnapshot.sellerSku/asin/fnSku", "sku/fnsku/asin", "extractable", "-", "同前", true),
      f("仓库", "warehouse", "AmazonReturnRecord.fulfillmentCenterId（退货侧）；库存侧无", "fulfillment-center-id", "extractable", "P1", "库存快照缺仓中心维度，原始行可提取"),
      f("库存合计", "afnWarehouseQuantity", "七项数量求和派生", "—", "derived", "-", "派生合计；核对是否含 reserved/unfulfillable"),
      f("可售库存", "afnFulfillableQuantity", "fulfillableQuantity", "afn-fulfillable-quantity", "explicit", "-", "数值核对", true),
      f("预留库存", "afnReservedQuantity", "reservedQuantity", "reserved_qty", "explicit", "-", "数值核对", true),
      f("正在发货", "afnInboundWorkingQuantity", "inboundWorkingQuantity", "inbound-working", "explicit", "-", "元素名以报告头为准", true),
      f("待接收", "afnInboundShippedQuantity", "inboundShippedQuantity", "inbound-shipped", "explicit", "-", "同上", true),
      f("正在接收", "afnInboundReceivingQuantity", "inboundReceivingQuantity", "inbound-receiving", "explicit", "-", "同上", true),
      f("不可用", "afnUnsellableQuantity", "unfulfillableQuantity", "unsellable", "explicit", "-", "同上", true),
      f("异常", "afnResearchingQuantity", "researchingQuantity", "researching", "explicit", "-", "同上", true),
      f("安全库存周期", "stockingCycle", "AmazonReplenishmentPolicy（待核关联）", "非 SP-API 直出", "pending-decision", "P2", "本地补货策略字段，待与策略模型对齐"),
      f("最小发货周期", "minCycle", "无", "非 SP-API 直出", "pending-decision", "P2", "本地补货策略字段，待与安全库存周期模型一并对齐"),
      f("头程运输成本", "firstLegCharges", "ProductCost/WmsCostEntry（待确认）", "非库存报告元素", "pending-decision", "P2", "成本来源模型待确认后 join"),
      f("分站点库存", "country", "无分站点库存维度", "BY_COUNTRY: country/quantity-for-local-fulfillment", "pending-data", "P1", "现为单站点快照；分站点需扩维度或建按国汇总"),
    ],
  },
  {
    page: "inventory/planning",
    pageLabel: "库存规划",
    wimoorRoute: "inventory/planning",
    fields: [
      f("图片/商品信息/站点", "image/name", "同商品/库存主档链路", "—", "extractable", "-", "主档 join 后核对"),
      f("采购成本", "purchasecost", "ProductCost.amount/currency", "非 SP 元素", "pending-decision", "P0", "按 SKU/日期 join；成本口径待拍板（§6.4）"),
      f("可用库存", "available", "fulfillableQuantity", "规划报告 available", "explicit", "-", "与规划报告口径核对", true),
      f("持续供货", "sellThrough", "无", "规划报告 sell-through", "pending-data", "P0", "需新快照列"),
      f("库存健康状况", "fbaInventoryLevelHealthStatus", "无", "规划报告健康状态枚举", "pending-data", "P0", "需新快照列"),
      f("历史供货天数", "historicalDaysOfSupply", "无", "规划报告指标", "pending-data", "P0", "需新快照列"),
      f("低库存水平量", "fbaMinimumInventoryLevel", "无", "规划报告指标", "pending-data", "P0", "需新快照列"),
      f("周转数量 30/90天", "weeksOfCoverT30/T90", "无", "规划报告覆盖周数", "pending-data", "P0", "需新快照列"),
      f("滞销费用", "estimatedLtsfNextCharge", "无", "长期仓储费预估", "pending-data", "P0", "需新快照列"),
      f("下月仓储费", "estimatedStorageCostNextMonth", "无", "仓储费预估", "pending-data", "P0", "需新快照列"),
      f("库龄桶(季度5)", "invAge0To90Days…365Plus", "无", "规划报告库龄桶", "pending-data", "P0", "5 个季度库龄桶需新快照列"),
      f("库龄桶(月度5)", "invAge0To30Days…331To365", "无", "规划报告库龄桶", "pending-data", "P0", "5 个月度库龄桶需新快照列"),
      f("销售额7/30/60/90天", "salesShippedLast7/30/60/90Days", "无（销售汇总层未接规划页）", "规划报告 + 销售汇总", "pending-data", "P0", "依赖销售汇总+规划报告双源"),
      f("发货量7/30/60/90天", "unitsShippedT7/T30/T60/T90", "无", "规划报告 units shipped", "pending-data", "P0", "需新快照列"),
      f("冗余库存", "estimatedExcessQuantity", "无", "规划报告冗余量", "pending-data", "P0", "需新快照列"),
      f("龄库存附加费数量(6桶)", "quantityToBeChargedAis181T210…365Plus", "无", "规划报告 AIS 数量桶", "pending-data", "P0", "6 个 AIS 数量桶"),
      f("超龄库存附加费(6桶)", "estimatedAis181T210…365Plus", "无", "规划报告 AIS 金额桶", "pending-data", "P0", "6 个 AIS 金额桶"),
    ],
  },
  {
    page: "payment/settlement_sku",
    pageLabel: "结算 SKU",
    wimoorRoute: "payment/settlement_sku",
    fields: [
      f("商品信息", "sku", "SettlementAllocationLine.sku；SettlementRow.sellerSku/asin", "结算行 sku/asin", "explicit", "-", "分摊行身份键核对", true),
      f("销售额", "principal", "分摊行本金；源行 SKU_PRINCIPAL", "Product Fees 本金行", "extractable", "-", "本金口径：退款行不冲减", true),
      f("销量", "salenum", "无行级汇总（订单行可派生）", "订单报告/API", "derived", "P0", "需销售汇总层按 SKU 派生（order-period-summary）"),
      f("订单量", "ordernum", "无", "COUNT(DISTINCT order-id)", "derived", "P0", "派生计数：COUNT(DISTINCT order-id)，见派生层"),
      f("平均售价", "avgprice", "无", "派生 principal/salenum", "derived", "P1", "Wimoor: salenum=0?0:principal/salenum，见派生层"),
      f("退款数量", "refundsales", "源行 SKU_REFUND", "退款类结算行", "extractable", "-", "分类规则已实现，SKU 级计数待汇总", true),
      f("退款金额", "refund", "源行退款金额", "退款类结算行金额", "extractable", "-", "同上", true),
      f("退款率", "refundrate", "无", "派生 refundorder/ordernum", "derived", "P1", "Wimoor: 2位 HALF_UP，见派生层"),
      f("FBA费用", "fbafee", "费用池 share* 分摊", "FBA 费类行", "extractable", "-", "核对费用池归类优先级", true),
      f("销售佣金", "commission", "现 8 池未单列佣金", "佣金类 amountType", "pending-data", "P1", "确认是否从 otherfee 拆出"),
      f("买家运费", "shipping", "同上", "运费类行", "pending-data", "P1", "同上"),
      f("促销费", "promotion", "同上", "促销/折扣类行", "pending-data", "P1", "同上"),
      f("其它收支", "otherfee", "shareShopOtherFee 兜底池", "other-transaction 兜底行", "extractable", "-", "兜底池归属核对", true),
      f("SKU结算", "setincome", "无 SKU 净额汇总", "派生 本金−退款−费用", "derived", "P0", "Wimoor: sum(principal+commission+fbafee+refund+otherfee+tax+shipping+promotion)"),
      f("预估VAT", "profit_vat", "无税费列", "税费类行/税务台账", "pending-decision", "P0", "含税口径待拍板（§6.4）"),
      f("市场费用", "profit_marketfee", "无", "市场费用类", "pending-decision", "P0", "缺列"),
      f("所得税", "profit_companytax", "无", "所得税类", "pending-decision", "P0", "缺列"),
      f("关税", "profit_customstax", "无", "关税类", "pending-decision", "P0", "缺列；候选头程/报关模型"),
      f("汇率损耗", "profit_exchangelost", "FinanceRecord.convertedAmount/fxEvidence", "折算汇率证据", "pending-decision", "P0", "折算证据在财务表；损耗派生口径待确认"),
      f("固定费用", "profit_lostrate", "无", "本地固定费用录入", "pending-decision", "P2", "本地固定费用录入，需建费用类型表"),
      f("其它费用", "profit_otherfee", "无", "其它费用类", "pending-decision", "P0", "缺列"),
      f("预估运费", "profit_local_shipmentfee", "无", "本地/头程运费", "pending-decision", "P2", "本地/头程运费，候选 WMS 成本模型待确认"),
      f("采购成本", "local_price", "ProductCost.amount", "非结算报告元素", "pending-decision", "P0", "按 SKU/生效日期 join；成本口径待拍板"),
      f("自定义费用", "local_other_cost", "无自定义费用类型表", "本地录入", "pending-decision", "P2", "需费用类型与录入模型"),
      f("退税", "local_return_tax", "无", "退税台账", "pending-decision", "P2", "缺列"),
      f("毛利润", "profit", "无利润汇总模型", "派生 收入−成本−费用−税", "derived", "P0", "Wimoor 公式已实证；成本/税待拍板，分层计算见派生层"),
      f("毛利润率", "profitrate", "无", "派生 profit/principal", "derived", "P1", "Wimoor: 2位 HALF_UP，见派生层"),
    ],
  },
  {
    page: "payment/costSharing",
    pageLabel: "费用分摊明细",
    wimoorRoute: "payment/costSharing",
    fields: [
      f("分摊产品", "sku", "AllocationLine.sku/sellerSku", "结算分摊行", "explicit", "-", "分摊行身份核对", true),
      f("金额", "amount", "Line.basisAmount/share*；Allocation.currency", "分摊算法输出", "extractable", "-", "核对分摊基数与 8 池金额", true),
      f("日期", "byday", "Line.businessDate", "结算业务日期", "extractable", "-", "日期口径核对", true),
      f("单据号", "code", "Allocation.settlementId/settlementRef", "结算单据号", "extractable", "-", "单据号映射核对", true),
      f("分摊日期", "date", "Allocation.createdAt", "分摊生成时间", "extractable", "-", "时区核对", true),
      f("店铺", "groupname", "Allocation.settlementReportId → 站点", "报告站点绑定", "extractable", "-", "店铺名经主档/站点表 join", true),
      f("国家", "marketname", "SettlementRow.marketplaceId", "结算行站点", "extractable", "-", "站点映射核对", true),
      f("费用类型", "itemname", "费用池类别（8 池）", "结算行分类", "pending-data", "P2", "费用类型未存名称字典；池键→中文需字典层"),
      f("货币", "currency", "Allocation.currency", "结算币种", "explicit", "-", "币种核对", true),
      f("创建人", "operator", "Allocation.createdBy", "内部操作人", "extractable", "-", "系统自动分摊与人工标识区分", true),
      f("创建日期", "createDate", "Allocation.createdAt", "内部生成时间", "extractable", "-", "时区核对", true),
      f("操作", "operate", "—", "—", "explicit", "-", "UI 动作列"),
    ],
  },
  {
    page: "payment/profitReport/child",
    pageLabel: "利润报表",
    wimoorRoute: "payment/profitReport/child",
    fields: [
      f("广告销售额", "rpt_adv_sales", "AmazonAdsReportFact.sales", "广告销售额", "derived", "P0", "派生：按 SKU/日期汇总 AdsReportFact.sales；是否混算自然销售待拍板（§6.4）"),
      f("广告销量", "rpt_adv_units", "AmazonAdsReportFact.units", "广告销量", "derived", "P0", "派生：按 SKU/日期汇总 AdsReportFact.units；是否混算自然销售待拍板（§6.4）"),
      f("店铺分摊-仓储", "share_storage_fee", "Line.shareStorageFee", "分摊金额", "explicit", "-", "核对分摊金额", true),
      f("店铺分摊-长期仓储", "share_long_storage_fee", "shareLongStorageFee", "分摊金额", "explicit", "-", "同上", true),
      f("店铺分摊-广告花费", "share_adv_spend_fee", "shareAdvSpendFee", "分摊金额", "explicit", "-", "同上", true),
      f("店铺分摊-优惠券", "share_coupon_redemption_fee", "shareCouponRedemptionFee", "分摊金额", "explicit", "-", "同上", true),
      f("店铺分摊-预留金", "share_reserve_fee", "shareReserveFee", "分摊金额", "explicit", "-", "同上", true),
      f("店铺分摊-补偿", "share_reimbursement_fee", "shareReimbursementFee", "分摊金额", "explicit", "-", "同上", true),
      f("店铺分摊-弃置", "share_disposal_fee", "shareDisposalFee", "分摊金额", "explicit", "-", "同上", true),
      f("店铺分摊-其它", "share_shop_other_fee", "shareShopOtherFee", "分摊金额", "explicit", "-", "同上", true),
      f("店铺结算", "income", "无店铺级结算汇总", "店铺层派生", "pending-data", "P0", "店铺层汇总待建"),
      f("SKU报表-仓储/长仓/广告/补偿/弃置", "rpt_*", "费用类报告行 Json", "报告原件保留", "extractable", "P1", "从原始行 Json 提取，见 wimoor-field-extract"),
      f("SKU报表-费用合计", "fin_sum_fee", "无", "派生合计", "derived", "P1", "派生：费用类求和 sum(rpt_*)，见派生层"),
      f("VAT税费", "profit_vat", "同结算 SKU", "税费类行", "pending-decision", "P0", "含税口径待拍板"),
      f("FBA费用", "fbafee", "同结算 SKU", "FBA 费类行", "extractable", "-", "同上", true),
      f("SKU结算", "setincome", "同结算 SKU", "派生净额", "derived", "P0", "见派生层"),
      f("其它采购成本", "local_other_cost", "无", "自定义成本", "pending-decision", "P2", "缺列"),
    ],
  },
  {
    page: "report/pageview",
    pageLabel: "流量浏览",
    wimoorRoute: "report/pageview",
    fields: [
      f("图片", "image", "主档图", "Catalog 主图", "extractable", "-", "同前", true),
      f("SKU", "sku", "SalesTrafficProductSnapshot.sellerSku", "请求维度 sellerSku", "explicit", "-", "维度核对", true),
      f("日期", "byday", "businessDate", "报告日期", "explicit", "-", "YYYY-MM-DD 核对", true),
      f("访问次数", "sessions", "metrics.sessions(Json)", "sessions", "extractable", "-", "空值识别 quality=MISSING_FIELDS", true),
      f("访问转化率", "sessionPercentage", "无显式列（原始行 Json 可提取）", "sessionPercentage", "extractable", "P1", "Wimoor 直采字段；从原始行 Json 提取"),
      f("浏览次数", "pageViews", "metrics.pageViews(Json)", "pageViews", "extractable", "-", "同 sessions", true),
      f("浏览转化率", "pageViewsPercentage", "无显式列", "pageViewsPercentage", "extractable", "P1", "Wimoor 直采；从原始行 Json 提取"),
      f("购物车比例", "buyBoxPercentage", "无显式列", "buyBoxPercentage", "extractable", "P1", "Wimoor 直采；从原始行 Json 提取"),
      f("销量", "unitsOrdered", "metrics.unitsOrdered(Json)", "unitsOrdered", "extractable", "-", "核对", true),
      f("商品转化率", "unitSessionPercentage", "无显式列", "unitSessionPercentage", "extractable", "P1", "Wimoor 直采；从原始行 Json 提取"),
      f("销售额", "orderedProductSales", "metrics.orderedProductSales(Json)", "orderedProductSales.amount/currency", "extractable", "-", "金额对象结构核对", true),
      f("订单", "totalOrderItems", "metrics.totalOrderItems(Json)", "totalOrderItems", "extractable", "-", "核对", true),
    ],
  },
  {
    page: "advertisement/manager",
    pageLabel: "广告",
    wimoorRoute: "advertisement/manager",
    fields: [
      f("活动/组/关键词/投放名称", "name/keywordText", "AdsEntityRecord.name/keywordText；AdsReportFact id", "实体名与层级外键", "extractable", "-", "事实表按 ID 聚合，实体表补名称", true),
      f("状态", "state", "AdsEntityRecord.state", "实体状态", "explicit", "-", "枚举映射核对", true),
      f("预算", "budget", "AdsEntityRecord.budgetAmount/budgetType", "预算实体", "explicit", "-", "预算币种待核", true),
      f("开始/结束日期", "start/end", "AdsEntityRecord.startDate/endDate", "日期实体", "explicit", "-", "日期类型核对", true),
      f("竞价/建议竞价", "bid/sugBid", "AdsEntityRecord.bid；建议竞价未存", "竞价实体/建议竞价接口", "pending-data", "P1", "建议竞价未落库"),
      f("曝光量", "impressions", "AdsReportFact.impressions", "impressions", "explicit", "-", "核对", true),
      f("点击次数", "clicks", "clicks", "clicks", "explicit", "-", "核对", true),
      f("点击率", "CTR", "无（派生 clicks/impressions）", "—", "derived", "P1", "Wimoor: sum(clicks)/sum(impressions)，见派生层"),
      f("每次点击费用", "avgcost", "无（派生 spend/clicks）", "—", "derived", "P1", "Wimoor: sum(cost)/sum(clicks)，见派生层"),
      f("广告费", "cost", "spend", "cost/spend", "explicit", "-", "币种核对", true),
      f("广告销售额", "sumSales", "sales", "attributedSales", "extractable", "-", "未区分同/跨 SKU", true),
      f("销量", "sumUnits", "units", "attributedUnits", "extractable", "-", "同上", true),
      f("订单量", "attributedUnitsOrdered", "orders", "attributedOrders", "explicit", "-", "核对", true),
      f("ACOS", "ACOS", "无（派生 spend/sales）", "—", "derived", "P1", "Wimoor: cost>0且sales=0→哨兵；否则 cost/attributedSales7d"),
      f("ROAS", "ROAS", "无（派生 sales/spend）", "—", "derived", "P1", "Wimoor: attributedSales7d/cost，见派生层"),
      f("转化率", "CSRT", "无（派生 orders/clicks）", "—", "derived", "P1", "Wimoor: attributedConversions7d/clicks，见派生层"),
      f("目标商品-销售额", "attributedSalesSameSKU", "未分列；rawDimensions(Json) 待核", "同 SKU 归因销售额", "pending-data", "P1", "事实表未拆同/跨 SKU"),
      f("其它商品-销售额", "attributedSales", "未分列", "跨 SKU 归因销售额", "pending-data", "P1", "同上"),
      f("目标商品-转化量", "attributedConversionsSameSKU", "未分列", "同 SKU 转化量", "pending-data", "P1", "同上"),
      f("其它商品-转化量", "attributedConversions", "未分列", "跨 SKU 转化量", "pending-data", "P1", "同上"),
      f("分归因窗口(1/7/14/30天)", "sales1d…30d", "仅 attributionWindow 维度，数值未分列", "各窗口归因指标", "pending-data", "P1", "需按窗口扩列或建子表"),
      f("新品牌/品牌效应/心愿单等", "newToBrand*等", "无", "NB/品牌效应专属指标", "pending-data", "P2", "当前链路未接入，按业务排期"),
      f("否定关键词/投放", "keywordText/targetingText", "targetingType/matchType；否定态待核", "否定实体", "pending-data", "P1", "否定标记未落显式列"),
      f("Search Terms", "query", "AdsReportFact.searchTerm", "查询词维度", "explicit", "-", "核对", true),
    ],
  },
];

/** 全量字段（扁平）。 */
export const ALL_FIELD_MAPPINGS: FieldMapping[] = FIELD_GROUPS.flatMap(g => g.fields);

/** 覆盖状态中文标签。 */
export const STATE_LABELS: Record<CoverageState, string> = {
  explicit: "已显式列",
  extractable: "可提取/需join",
  derived: "派生已实现",
  "pending-data": "待数据/迁移",
  "pending-decision": "待拍板/本地",
};

/** 按状态聚合计数。 */
export function coverageSummary(fields: FieldMapping[] = ALL_FIELD_MAPPINGS): Record<CoverageState, number> {
  const acc: Record<CoverageState, number> = {
    explicit: 0, extractable: 0, derived: 0, "pending-data": 0, "pending-decision": 0,
  };
  for (const f of fields) acc[f.state]++;
  return acc;
}

/** 按优先级聚合（P0/P1/P2 缺口，不含 "-"）。 */
export function prioritySummary(fields: FieldMapping[] = ALL_FIELD_MAPPINGS): Record<Priority, number> {
  const acc: Record<Priority, number> = { P0: 0, P1: 0, P2: 0, "-": 0 };
  for (const f of fields) acc[f.priority]++;
  return acc;
}

/** 已落地（显式列+可提取+派生）占比。 */
export function implementedRatio(fields: FieldMapping[] = ALL_FIELD_MAPPINGS): number {
  const done = fields.filter(f => f.state === "explicit" || f.state === "extractable" || f.state === "derived").length;
  return fields.length === 0 ? 0 : Math.round((done / fields.length) * 1000) / 10;
}
