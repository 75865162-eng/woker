/**
 * WIMOOR 迁移页 → 亚马逊真实数据集映射表。
 *
 * 设计原则（与 ERP 数据口径一致，绝不造数）：
 * 1. 只登记有已验证 reader（mcpDatasets）且业务语义明确对应的页面；
 * 2. status:
 *    - 'amazon'      该页读亚马逊同步真实数据（只读工作台）；
 *    - 'master'      本地主数据 CRUD（保持 MasterDataWorkbench 不变）；
 *    - 'already-real' 已通过其它真实 API 取数（如库存页），不动。
 * 3. 未登记的页面一律视为 'master'（fail-safe：宁可不接，不可错接）。
 * 4. dataset 必须是 mcpDatasets 中存在的 name；pin 是固定筛选，防止混淆口径。
 * 5. 数据读取统一走 GET /api/operations/sync-center?section=data（与 MCP 同源 readDataset），
 *    继承会话/workspace/账号分配收窄/审计/只读已发布数据源，页面侧不写死店铺账号。
 */

export type AmazonPageMapping = {
  /** 源组件（仅注释用途，便于对照原版 WIMOOR）。 */
  comp: string;
  /** 中文页面名（展示用）。 */
  name: string;
  /** mcpDatasets 中已登记的数据集名。 */
  dataset: string;
  /** 固定筛选（如 reportType），防止把多口径数据混成一张表。 */
  pin?: Record<string, string>;
  /** 展示列：dataset 字段 → 中文表头。 */
  columns: Array<{ key: string; label: string; numeric?: boolean; width?: number }>;
  /** 口径说明（页面底部展示，提醒数据边界）。 */
  basis: string;
  status: 'amazon';
};

export const AMAZON_PAGE_MAP: Record<string, AmazonPageMapping> = {
  // ── 销售 · 订单 ─────────────────────────────────────────────
  '/wimoor/sales/dingdan-liebiao': {
    comp: 'amazon/order/order_manager/index', name: '订单列表', dataset: 'orders',
    columns: [
      { key: 'amazonOrderId', label: '订单号', width: 190 },
      { key: 'rawStatus', label: '订单状态', width: 120 },
      { key: 'fulfillmentServiceLevel', label: '履约方式', width: 100 },
      { key: 'grandTotalOriginal', label: '订单金额', width: 120, numeric: true },
      { key: 'currencyCode', label: '币种', width: 70 },
      { key: 'createdTime', label: '下单时间', width: 170 },
    ],
    basis: '订单为 Amazon SP-API 已入库订单的当前事实（近30天），不代表完整历史；金额保留原币种，不跨币种合计。',
    status: 'amazon',
  },
  '/wimoor/sales/jinri-dingdan': {
    comp: 'amazon/order/today/index', name: '今日订单', dataset: 'orders',
    pin: { fromOffsetDays: '0' },
    columns: [
      { key: 'amazonOrderId', label: '订单号', width: 190 },
      { key: 'rawStatus', label: '订单状态', width: 120 },
      { key: 'grandTotalOriginal', label: '订单金额', width: 120, numeric: true },
      { key: 'currencyCode', label: '币种', width: 70 },
      { key: 'createdTime', label: '下单时间', width: 170 },
    ],
    basis: '仅展示最近 1 天已入库订单；金额为原币种字符串，不跨币种合计。',
    status: 'amazon',
  },
  '/wimoor/sales/xiaoliang-xiangqing': {
    comp: 'amazon/sales/details/index', name: '销量详情', dataset: 'order_items',
    columns: [
      { key: 'amazonOrderId', label: '订单号', width: 180 },
      { key: 'sellerSku', label: 'SKU', width: 140 },
      { key: 'asin', label: 'ASIN', width: 130 },
      { key: 'quantityOrdered', label: '数量', width: 80, numeric: true },
      { key: 'proceedsOriginal', label: '金额', width: 110, numeric: true },
      { key: 'currencyCode', label: '币种', width: 70 },
      { key: 'createdTime', label: '时间', width: 160 },
    ],
    basis: '订单商品行粒度；当前站点明细可能尚未采集（为空不代表没有销量）。金额保留原币种。',
    status: 'amazon',
  },
  '/wimoor/sales/tuihuo-dingdan': {
    comp: 'amazon/order/refund/index', name: '退货订单', dataset: 'returns',
    columns: [
      { key: 'amazonOrderId', label: '订单号', width: 180 },
      { key: 'sellerSku', label: 'SKU', width: 140 },
      { key: 'asin', label: 'ASIN', width: 130 },
      { key: 'quantity', label: '数量', width: 80, numeric: true },
      { key: 'returnAt', label: '退货时间', width: 170 },
      { key: 'disposition', label: '处置', width: 110 },
    ],
    basis: '单份已发布 FBA 退货报告；重叠报告不可直接相加，未返回不代表全渠道退货。',
    status: 'amazon',
  },

  // ── 销售 · 报表/商品 ────────────────────────────────────────
  '/wimoor/sales/xiaoshou-baobiao': {
    comp: 'amazon/sales/report/index', name: '销售报表', dataset: 'sales_traffic_daily',
    columns: [
      { key: 'businessDate', label: '业务日期', width: 120 },
      { key: 'metrics.unitsOrdered', label: '订单量', width: 100, numeric: true },
      { key: 'metrics.sessions', label: '会话数', width: 100, numeric: true },
      { key: 'metrics.pageViews', label: '浏览量', width: 100, numeric: true },
      { key: 'metrics.orderedProductSales.amount', label: '销售额', width: 120, numeric: true },
      { key: 'metrics.orderedProductSales.currencyCode', label: '币种', width: 70 },
      { key: 'quality', label: '质量', width: 90 },
    ],
    basis: '店铺逐日销售流量（近7天），不提供 SKU/ASIN 拆分；金额按行保留原币种，不跨币种合计。',
    status: 'amazon',
  },
  '/wimoor/sales/liuliang-baobiao': {
    comp: 'amazon/report/pageview/index', name: '流量报表', dataset: 'sales_traffic_daily',
    columns: [
      { key: 'businessDate', label: '业务日期', width: 120 },
      { key: 'metrics.sessions', label: '会话数', width: 110, numeric: true },
      { key: 'metrics.pageViews', label: '浏览量', width: 110, numeric: true },
      { key: 'metrics.unitsOrdered', label: '订单量', width: 100, numeric: true },
      { key: 'quality', label: '质量', width: 90 },
    ],
    basis: '店铺逐日流量快照（近7天），无 SKU/ASIN 拆分；数值为精确字符串，不推算。',
    status: 'amazon',
  },
  '/wimoor/sales/qushi-fenxi': {
    comp: 'amazon/listing/analysis/index', name: '趋势分析', dataset: 'sales_traffic_daily',
    columns: [
      { key: 'businessDate', label: '业务日期', width: 120 },
      { key: 'metrics.unitsOrdered', label: '订单量', width: 100, numeric: true },
      { key: 'metrics.orderedProductSales.amount', label: '销售额', width: 120, numeric: true },
      { key: 'metrics.orderedProductSales.currencyCode', label: '币种', width: 70 },
    ],
    basis: '店铺逐日趋势（近7天）；仅已发布快照，缺失日期不代表当日为 0。',
    status: 'amazon',
  },
  '/wimoor/sales/shangpin-fenxi': {
    comp: 'amazon/listing/products/index', name: '商品分析', dataset: 'listings',
    columns: [
      { key: 'sellerSku', label: 'SKU', width: 150 },
      { key: 'asin', label: 'ASIN', width: 130 },
      { key: 'listingStatus', label: '状态', width: 110 },
      { key: 'fulfillmentType', label: '履约方式', width: 110 },
      { key: 'sourceUpdatedAt', label: '更新时间', width: 170 },
    ],
    basis: '最近成功发布的 Listing 快照；只展示真实已保存字段，缺失显示「—」，不是商品主档。',
    status: 'amazon',
  },
  '/wimoor/sales/shangpin-sousuo': {
    comp: 'amazon/listing/catalog/index', name: '商品搜索', dataset: 'listings',
    columns: [
      { key: 'sellerSku', label: 'SKU', width: 150 },
      { key: 'asin', label: 'ASIN', width: 130 },
      { key: 'listingStatus', label: '状态', width: 110 },
      { key: 'fulfillmentType', label: '履约方式', width: 110 },
    ],
    basis: '从最近已发布 Listing 快照搜索；属性字段缺失不补造默认值。',
    status: 'amazon',
  },

  // ── 账目 · 结算/财务 ────────────────────────────────────────
  '/wimoor/account/settlements': {
    comp: 'amazon/payment/record/index', name: '结算记录', dataset: 'settlements_v2',
    columns: [
      { key: 'businessDate', label: '业务日期', width: 120 },
      { key: 'orderId', label: '订单号', width: 170 },
      { key: 'sellerSku', label: 'SKU', width: 130 },
      { key: 'amountOriginal', label: '金额', width: 110, numeric: true },
      { key: 'currencyCode', label: '币种', width: 70 },
      { key: 'quantityOriginal', label: '数量', width: 80, numeric: true },
    ],
    basis: '仅返回已发布且站点归属验证通过的结算报告行；原始金额不自动换算，不把报告头当交易金额。',
    status: 'amazon',
  },
  '/wimoor/account/settlement-sku': {
    comp: 'amazon/payment/settlement_sku/index', name: '账期SKU', dataset: 'settlements_v2',
    columns: [
      { key: 'sellerSku', label: 'SKU', width: 150 },
      { key: 'asin', label: 'ASIN', width: 130 },
      { key: 'businessDate', label: '业务日期', width: 120 },
      { key: 'amountOriginal', label: '金额', width: 110, numeric: true },
      { key: 'currencyCode', label: '币种', width: 70 },
    ],
    basis: '按结算报告行的 SKU 展示；金额为原币种字符串，不跨币种合计。',
    status: 'amazon',
  },
  '/wimoor/account/performance': {
    comp: 'amazon/payment/performanpce/index', name: '业绩报告', dataset: 'finance_transactions',
    columns: [
      { key: 'postedAt', label: '过账时间', width: 170 },
      { key: 'transactionType', label: '交易类型', width: 160 },
      { key: 'orderId', label: '订单号', width: 150 },
      { key: 'originalAmount', label: '原币金额', width: 110, numeric: true },
      { key: 'currency', label: '币种', width: 70 },
      { key: 'classification', label: '分类', width: 100 },
    ],
    basis: 'Finances API 已入库交易（近30天）；原币种金额，不代表最终结算，不跨币种汇总。',
    status: 'amazon',
  },
  '/wimoor/account/reimbursements': {
    comp: 'amazon/report/reimbursements_fee/index', name: '赔偿费用', dataset: 'reimbursements',
    columns: [
      { key: 'businessDate', label: '业务日期', width: 120 },
      { key: 'orderId', label: '订单号', width: 150 },
      { key: 'amountOriginal', label: '金额', width: 110, numeric: true },
      { key: 'currencyCode', label: '币种', width: 70 },
    ],
    basis: '已发布赔付报告；当前站点可能暂无数据（空不代表没有赔付），原币种保留。',
    status: 'amazon',
  },
  '/wimoor/account/storage-fees': {
    comp: 'amazon/report/storage_fee/index', name: 'FBA仓储费', dataset: 'storage_fees',
    columns: [
      { key: 'businessDate', label: '业务日期', width: 120 },
      { key: 'sellerSku', label: 'SKU', width: 140 },
      { key: 'amountOriginal', label: '费用', width: 110, numeric: true },
      { key: 'currencyCode', label: '币种', width: 70 },
    ],
    basis: '已发布仓储费报告行；当前站点可能暂无数据。单份完整月报，不跨版本累加。',
    status: 'amazon',
  },

  // ── 第二批：逐页语义匹配（2026-11-26 扩充，覆盖全部有对应亚马逊同步表的页） ──

  // 账目 · 本地账目/平台账目
  '/wimoor/account/inventory-value': {
    comp: 'erp/finance/inventoryValue/index', name: '库存货值', dataset: 'inventory',
    columns: [
      { key: 'sellerSku', label: 'SKU', width: 150 },
      { key: 'asin', label: 'ASIN', width: 130 },
      { key: 'fulfillableQuantity', label: '可售', width: 90, numeric: true },
      { key: 'reservedQuantity', label: '预留', width: 90, numeric: true },
      { key: 'inboundWorkingQuantity', label: '在途', width: 90, numeric: true },
      { key: 'unfulfillableQuantity', label: '不可售', width: 90, numeric: true },
      { key: 'condition', label: '状态', width: 100 },
    ],
    basis: 'FBA 库存快照（已发布）可售/预留/在途/不可售数量，来自 Amazon FBA 库存报告；货值金额需本地成本参与计算，本页只呈现亚马逊返回的库存数量事实。',
    status: 'amazon',
  },
  '/wimoor/account/open': {
    comp: 'amazon/report/open/index', name: '账期未结算', dataset: 'finance_transactions',
    columns: [
      { key: 'postedAt', label: '过账时间', width: 170 },
      { key: 'transactionType', label: '交易类型', width: 150 },
      { key: 'orderId', label: '订单号', width: 150 },
      { key: 'originalAmount', label: '原币金额', width: 110, numeric: true },
      { key: 'currency', label: '币种', width: 70 },
      { key: 'classification', label: '分类', width: 110 },
    ],
    basis: 'Finances API 交易流水（近30天），用于核对账期未结算项；原币金额不跨币种汇总，不代表最终结算。',
    status: 'amazon',
  },
  '/wimoor/account/profit-report': {
    comp: 'amazon/payment/profitReport/index', name: '利润报表', dataset: 'settlements_v2',
    columns: [
      { key: 'businessDate', label: '业务日期', width: 120 },
      { key: 'sellerSku', label: 'SKU', width: 140 },
      { key: 'asin', label: 'ASIN', width: 130 },
      { key: 'orderId', label: '订单号', width: 160 },
      { key: 'quantityOriginal', label: '数量', width: 80, numeric: true },
      { key: 'amountOriginal', label: '金额', width: 110, numeric: true },
      { key: 'currencyCode', label: '币种', width: 70 },
    ],
    basis: '利润=平台收入−成本；本页呈现亚马逊结算报告的收入侧真实数据（SKU/订单/金额）。采购成本、头程费用为本地数据，完整利润需在本地成本侧计算，本页不造利润数。',
    status: 'amazon',
  },
  '/wimoor/account/shop-profit': {
    comp: 'amazon/payment/profitReport/profitGroup/index', name: '店铺利润', dataset: 'settlements_v2',
    columns: [
      { key: 'businessDate', label: '业务日期', width: 120 },
      { key: 'orderId', label: '订单号', width: 160 },
      { key: 'sellerSku', label: 'SKU', width: 140 },
      { key: 'amountOriginal', label: '金额', width: 110, numeric: true },
      { key: 'currencyCode', label: '币种', width: 70 },
    ],
    basis: '按店铺维度的亚马逊结算收入侧真实数据；成本为本地数据，完整店铺利润需本地计算，本页不造利润数。',
    status: 'amazon',
  },
  '/wimoor/account/job-costing': {
    comp: 'amazon/payment/jobCosting/index', name: '批次成本', dataset: 'fba_shipments',
    columns: [
      { key: 'businessDate', label: '业务日期', width: 120 },
      { key: 'orderId', label: '订单号', width: 160 },
      { key: 'sellerSku', label: 'SKU', width: 140 },
      { key: 'quantityOriginal', label: '数量', width: 80, numeric: true },
      { key: 'amountOriginal', label: '金额', width: 110, numeric: true },
      { key: 'currencyCode', label: '币种', width: 70 },
    ],
    basis: 'FBA 入库货件报告（已发布）对应的 SKU/数量/金额；批次成本中的采购/头程成本为本地数据，本页呈现亚马逊侧的货件事实。',
    status: 'amazon',
  },

  // 产品 · 平台配对
  '/wimoor/product/sku-relation': {
    comp: 'amazon/listing/relation_msku/index', name: 'SKU配对', dataset: 'listings',
    columns: [
      { key: 'sellerSku', label: 'SKU', width: 160 },
      { key: 'asin', label: 'ASIN', width: 140 },
      { key: 'listingStatus', label: '状态', width: 110 },
      { key: 'fulfillmentType', label: '履约方式', width: 110 },
      { key: 'sourceUpdatedAt', label: '更新时间', width: 170 },
    ],
    basis: '展示亚马逊 Listing 快照的 SKU/ASIN 真实对应关系；MSKU 分组关系为本地业务数据，本页不改动本地配对。',
    status: 'amazon',
  },

  // 销售 · 评论绩效/报表/FBA/预测/移除
  '/wimoor/sales/chapin-guanli': {
    comp: 'amazon/report/performance/orderfeedback/index', name: '差评管理', dataset: 'customer_feedback',
    columns: [
      { key: 'asin', label: 'ASIN', width: 140 },
      { key: 'sellerSku', label: 'SKU', width: 140 },
      { key: 'kind', label: '类型', width: 120 },
      { key: 'capturedAt', label: '采集时间', width: 170 },
    ],
    basis: '客户反馈观察（已发布版本）；仅返回当前授权账号可见的反馈，当前站点暂无数据时为空。',
    status: 'amazon',
  },
  '/wimoor/sales/cuxiao-baogao': {
    comp: 'amazon/report/performance/index', name: '促销报告', dataset: 'promotions',
    columns: [
      { key: 'kind', label: '类型', width: 140 },
      { key: 'asin', label: 'ASIN', width: 130 },
      { key: 'sellerSku', label: 'SKU', width: 130 },
      { key: 'capturedAt', label: '采集时间', width: 170 },
    ],
    basis: '促销观察（已发布版本）；feeSnapshot 为创建时费率快照非实际花费，当前站点暂无数据时为空。',
    status: 'amazon',
  },
  '/wimoor/sales/dianpu-jixiao': {
    comp: 'amazon/report/performance/seller/index', name: '店铺绩效', dataset: 'sales_traffic_daily',
    columns: [
      { key: 'businessDate', label: '业务日期', width: 120 },
      { key: 'metrics.sessions', label: '会话数', width: 110, numeric: true },
      { key: 'metrics.pageViews', label: '浏览量', width: 110, numeric: true },
      { key: 'metrics.unitsOrdered', label: '订单量', width: 100, numeric: true },
      { key: 'quality', label: '质量', width: 90 },
    ],
    basis: '店铺逐日销售流量快照（近7天）作为绩效参考；卖家绩效评级指标不在此数据集内，当前站点无数据时为空。',
    status: 'amazon',
  },
  '/wimoor/sales/fba-feiyong': {
    comp: 'amazon/report/fba_fee/index', name: 'FBA费用', dataset: 'fee_preview',
    columns: [
      { key: 'businessDate', label: '业务日期', width: 120 },
      { key: 'sellerSku', label: 'SKU', width: 140 },
      { key: 'fulfilledBy', label: '履约方式', width: 110 },
      { key: 'estimatedTotalFeeOriginal', label: '预估总费用', width: 120, numeric: true },
      { key: 'currencyCode', label: '币种', width: 70 },
    ],
    basis: 'FBA 费用预览快照（估算值，非实际扣款）；每 Seller 每日最多请求一次，当前站点暂无数据时为空。',
    status: 'amazon',
  },
  '/wimoor/sales/fba-zhixiao': {
    comp: 'amazon/inventory/planning/index', name: 'FBA滞销', dataset: 'recommended_removals',
    columns: [
      { key: 'businessDate', label: '快照日期', width: 120 },
      { key: 'sellerSku', label: 'SKU', width: 140 },
      { key: 'asin', label: 'ASIN', width: 130 },
      { key: 'condition', label: '状态', width: 100 },
      { key: 'quantities', label: '库龄数量', width: 160 },
    ],
    basis: '推荐移除（滞销）每日快照；按报告类型读取，不能跨快照累加，当前站点暂无数据时为空。',
    status: 'amazon',
  },
  '/wimoor/sales/xiaoshou-jihua': {
    comp: 'amazon/sales/forecast/index', name: '销售计划', dataset: 'sales_traffic_daily',
    columns: [
      { key: 'businessDate', label: '业务日期', width: 120 },
      { key: 'metrics.unitsOrdered', label: '订单量', width: 100, numeric: true },
      { key: 'metrics.orderedProductSales.amount', label: '销售额', width: 120, numeric: true },
      { key: 'metrics.orderedProductSales.currencyCode', label: '币种', width: 70 },
    ],
    basis: '店铺逐日销售趋势（近7天）作为计划参考；预测目标为本地数据，本页呈现亚马逊实际销售事实。',
    status: 'amazon',
  },
  '/wimoor/sales/yichu-dingdan': {
    comp: 'amazon/order/remove/index', name: '移除订单', dataset: 'removal_order_report',
    columns: [
      { key: 'businessDate', label: '业务日期', width: 120 },
      { key: 'orderId', label: '移除订单号', width: 160 },
      { key: 'sellerSku', label: 'SKU', width: 140 },
      { key: 'quantityOriginal', label: '数量', width: 80, numeric: true },
      { key: 'amountOriginal', label: '费用', width: 110, numeric: true },
    ],
    basis: '移除订单报告（已发布）；仅含移除订单，当前站点暂无数据时为空。',
    status: 'amazon',
  },

  // 发货 · FBA 货件
  '/wimoor/shipment/handling': {
    comp: 'erp/shipv2/shipment_handing/list/index', name: '货件处理', dataset: 'fba_shipments',
    columns: [
      { key: 'businessDate', label: '业务日期', width: 120 },
      { key: 'orderId', label: '订单号', width: 160 },
      { key: 'sellerSku', label: 'SKU', width: 140 },
      { key: 'asin', label: 'ASIN', width: 130 },
      { key: 'quantityOriginal', label: '数量', width: 80, numeric: true },
      { key: 'amountOriginal', label: '金额', width: 110, numeric: true },
      { key: 'currencyCode', label: '币种', width: 70 },
    ],
    basis: 'FBA 入库货件报告（已发布）中亚马逊侧真实货件/订单/数量；本地物流处理状态不变。',
    status: 'amazon',
  },
  '/wimoor/shipment/track': {
    comp: 'erp/ship/shipment_handing/list/index', name: '货件跟踪', dataset: 'fba_shipments',
    columns: [
      { key: 'businessDate', label: '业务日期', width: 120 },
      { key: 'orderId', label: '订单号', width: 160 },
      { key: 'sellerSku', label: 'SKU', width: 140 },
      { key: 'quantityOriginal', label: '数量', width: 80, numeric: true },
      { key: 'currencyCode', label: '币种', width: 70 },
    ],
    basis: 'FBA 入库货件报告（已发布）作为亚马逊侧货件跟踪事实；本地物流轨迹不变。',
    status: 'amazon',
  },
  '/wimoor/shipment/ship-plan': {
    comp: 'erp/ship/ship_plan/index', name: 'FBA发货规划', dataset: 'fba_shipments',
    columns: [
      { key: 'businessDate', label: '业务日期', width: 120 },
      { key: 'sellerSku', label: 'SKU', width: 140 },
      { key: 'asin', label: 'ASIN', width: 130 },
      { key: 'quantityOriginal', label: '数量', width: 80, numeric: true },
      { key: 'amountOriginal', label: '金额', width: 110, numeric: true },
      { key: 'currencyCode', label: '币种', width: 70 },
    ],
    basis: 'FBA 入库货件报告（已发布）作为发货规划的亚马逊侧需求参考；本地补货计划数据不变。',
    status: 'amazon',
  },
};

/** 已通过其它真实 API 取数、无需改动的页面。 */
export const ALREADY_REAL_PAGES = new Set([
  '/wimoor/warehouse/daily-inventory',
  '/wimoor/shipment/fba-inventory',
  '/wimoor/shipment/fba-daily-inventory',
]);

/** 取映射；未登记返回 null（调用方保持 MasterDataWorkbench）。 */
export function amazonMapForPage(localHref: string): AmazonPageMapping | null {
  return AMAZON_PAGE_MAP[localHref] ?? null;
}

/** 计算展示列的扁平字段路径（供 adapter 取值）。 */
export function mapColumnPaths(mapping: AmazonPageMapping): string[] {
  return mapping.columns.map(c => c.key);
}
