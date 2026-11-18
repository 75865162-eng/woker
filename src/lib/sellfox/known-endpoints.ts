/**
 * 赛狐「已文档化域」通用端点种子。
 *
 * 原则（与全仓口径一致）：只登记本地 sellfox-api-docs 字段级文档里能核对到的
 * 真实路径与请求参数；响应列未文档化的，一律走通用采集器原样存 JSON（不猜字段、
 * 不补零、不编造业务主键，行身份回退内容哈希保证幂等）。
 *
 * 这些种子默认停用（enabled=false）：后台「登记已文档化域」后，用户按需启用，
 * worker 即按「店铺 × 日期块」自动拉全量，无需任何脚本。未文档化（缺字段文档）
 * 的域不在此列：仓库流水 / 批次出入库 / 结算明细分页 / 按日利润报表等文档未抓取，
 * 故不登记，避免编造路径或参数。
 */

export type SellfoxKnownEndpointSeed = {
  code: string;
  label: string;
  path: string;
  dateMode: "none" | "current" | "range";
  scopeMode: "store" | "global";
  chunkDays: number;
  pageSize: number;
  rowsPath: string;
  idFields: string;
  params: string;
  dateFormat: string;
  maxRows: number;
  historyFrom: string | null;
  /** 文档标注即将下线，启用前须知。 */
  deprecated?: boolean;
  note?: string;
};

/** 财务 V2 月/日利润报表（monthProfit）共用参数契约，按维度段区分路径。 */
function monthProfitParams() {
  return JSON.stringify({
    dateType: 2, // 2=按日；对应 startDate/endDate 用 yyyyMMdd（限制最近 6 个月，故 chunkDays=90 安全）
    startDate: "${startDate}",
    endDate: "${endDate}",
    shopIds: ["${shopIdNumeric}"],
    pageNo: "${pageNo}",
    pageSize: "${pageSize}",
  });
}

const MONTH_PROFIT_DIMS: Array<{ dim: string; code: string; label: string }> = [
  { dim: "asin", code: "asin", label: "利润报表-ASIN" },
  { dim: "sku", code: "sku", label: "利润报表-SKU" },
  { dim: "msku", code: "msku", label: "利润报表-MSKU" },
  { dim: "spu", code: "spu", label: "利润报表-SPU" },
  { dim: "parentAsin", code: "parent_asin", label: "利润报表-父ASIN" },
  { dim: "shop", code: "shop", label: "利润报表-店铺" },
  { dim: "salesMan", code: "salesman", label: "利润报表-业务员" },
  { dim: "developer", code: "developer", label: "利润报表-开发员" },
  { dim: "shopSummary", code: "shop_summary", label: "利润报表-店铺汇总" },
];

export function sellfoxKnownEndpoints(): SellfoxKnownEndpointSeed[] {
  const seeds: SellfoxKnownEndpointSeed[] = [];

  for (const { dim, code, label } of MONTH_PROFIT_DIMS) {
    seeds.push({
      code: `fin_profit_${code}`,
      label: `财务·${label}`,
      path: `/api/financial/v2/monthProfit/${dim}.json`,
      dateMode: "range",
      scopeMode: "store",
      chunkDays: 90, // 按日查询限制最近 6 个月（≈180 天），90 天块安全
      pageSize: 200, // 文档最大 200
      rowsPath: "",
      idFields: "", // 响应列未文档化：行身份回退内容哈希，绝编造字段
      params: monthProfitParams(),
      dateFormat: "yyyyMMdd",
      maxRows: 50_000,
      historyFrom: null,
      note: "V2 利润报表，按月/日维度独立落表（SellfoxApiRecord），不与日利润快照覆盖。",
    });
  }

  seeds.push({
    code: "fin_profit_order",
    label: "财务·利润报表-订单",
    path: "/api/financial/v2/order.json",
    dateMode: "range",
    scopeMode: "store",
    chunkDays: 31, // 文档：begin/end 跨度不能超过 31 天
    pageSize: 200,
    rowsPath: "",
    idFields: "",
    params: JSON.stringify({
      shopIds: ["${shopIdNumeric}"],
      begin: "${startDate}",
      end: "${endDate}",
      pageNo: "${pageNo}",
      pageSize: "${pageSize}",
    }),
    dateFormat: "yyyy-MM-dd",
    maxRows: 50_000,
    historyFrom: null,
    note: "V2 订单级利润，按订单/退款/手续费维度，需配合 settlementId 等检索。",
  });

  seeds.push({
    code: "fin_settlement_overview",
    label: "财务·结算总览（即将下线）",
    path: "/api/financial/selectGroupPage.json",
    dateMode: "range",
    scopeMode: "store",
    chunkDays: 90, // 文档：begin/end 跨度不能超过一年
    pageSize: 200,
    rowsPath: "",
    idFields: "",
    params: JSON.stringify({
      shopIds: ["${shopIdNumeric}"],
      begin: "${startDate}",
      end: "${endDate}",
      pageNo: "${pageNo}",
      pageSize: "${pageSize}",
    }),
    dateFormat: "yyyy-MM-dd",
    maxRows: 50_000,
    historyFrom: null,
    deprecated: true,
    note: "文档标注「即将下线」，下游应迁移至 V2 monthProfit/shopSummary；启用前须知。",
  });

  seeds.push({
    code: "fbm_orders",
    label: "订单·FBM 订单列表",
    path: "/api/packageShip/getPackagePage.json",
    dateMode: "range",
    scopeMode: "store",
    chunkDays: 90, // 文档：purchaseDate 跨度不能超过 12 个月
    pageSize: 200, // 文档最大 200
    rowsPath: "",
    idFields: "",
    params: JSON.stringify({
      shopIdList: ["${shopId}"], // 注意：FBM 用字符串店铺 ID，非数字
      purchaseDateStart: "${startDate}",
      purchaseDateEnd: "${endDate}",
      pageNo: "${pageNo}",
      pageSize: "${pageSize}",
    }),
    dateFormat: "yyyy-MM-dd",
    maxRows: 50_000,
    historyFrom: null,
    note: "FBM 自发货包裹分页；shopIdList 传字符串店铺 externalId。",
  });

  // ── 剩余只读数据域（2026-11-19 用生产凭据逐条真实联调通过）──────────────────────────
  // 参数名、日期格式、分页字段均来自本地 sellfox-api 字段级文档并经真实响应校验；
  // 响应列未文档化，一律走通用采集器原样落 SellfoxApiRecord（不猜字段、不补零、不换算）。
  // 这些接口绝大多数为「全局报表」：scopeMode=global 时采集器只跑一遍、不按店铺放大。
  const paged = (extra: Record<string, unknown> = {}) => JSON.stringify({
    pageNo: "${pageNo}", pageSize: "${pageSize}", ...extra,
  });

  // 主数据 / 当前状态：每天全量一次，无日期窗口。
  type MasterSeed = Pick<SellfoxKnownEndpointSeed, "code" | "label" | "path" | "idFields" | "note">;
  const master: MasterSeed[] = [
    { code: "sku", label: "商品·SKU 商品库", path: "/api/commodity/pageList.json", idFields: "id", note: "本地 SKU 主数据：成本 purchaseCost、开发员 devId/devName、品牌、包装尺寸。实测 2799 行。" },
    { code: "spu", label: "商品·SPU 款名", path: "/api/commodity/getCommoditySpuList.json", idFields: "id", note: "SPU 款名；当前租户实测 0 行，接口已联调通，保留端点待数据。" },
    { code: "brand", label: "商品·品牌库", path: "/api/commodity/listBrands.json", idFields: "id", note: "品牌字典，实测 12 行。" },
    { code: "category", label: "商品·分类树", path: "/api/category/getList.json", idFields: "id", note: "分类树，响应为顶层数组，实测 20 行。" },
    { code: "attrs", label: "商品·属性字典", path: "/api/commodityAttribute/initAttribute.json", idFields: "attributeId", note: "属性字典，rowsPath=commodityAttributeVoList，实测 2 类。" },
    { code: "supplier", label: "采购·供应商", path: "/api/supplier/pageList.json", idFields: "id", note: "供应商主数据，实测 512 行。" },
    { code: "sub-account", label: "总览·子账号", path: "/api/account/getSubUserPage.json", idFields: "id", note: "业务员/运营子账号归属维度，实测 69 行。" },
    { code: "warehouse", label: "库存·仓库列表", path: "/api/warehouseManage/warehouseList.json", idFields: "id", note: "仓库主数据，实测 24 行。" },
    { code: "fba-warehouse-list", label: "财务·FBA 仓库列表", path: "/api/financial/batchCost/getFBAWarehousePageList.json", idFields: "id", note: "FBA 仓库与 batchCost 费用域的仓库维表，响应顶层数组，实测 39 行。" },
    { code: "purchase-order", label: "采购·采购单", path: "/api/purchase/page.json", idFields: "id", note: "采购单主表，含 currency/exchangeRate 金额三列口径，实测 2962 行。" },
    { code: "local-inventory", label: "库存·本地仓库存明细", path: "/api/warehouseManage/warehouseItemList.json", idFields: "id", note: "本地仓库存，含 perPurchase/totalPurchase/inventoryCost，实测 2047 行。" },
    { code: "removal-order", label: "库存·移除入库单", path: "/api/removeInboundOrder/search.json", idFields: "id", note: "移除入库单，实测 29 行。" },
  ];
  for (const seed of master) {
    seeds.push({
      ...seed, label: `赛狐·${seed.label}`, dateMode: "none", scopeMode: "global",
      chunkDays: 1, pageSize: 200, rowsPath: "", dateFormat: "yyyy-MM-dd",
      params: paged(), maxRows: 50_000, historyFrom: null,
    });
  }
  // 库龄报表需要 showCost=1 才返回成本列；响应 id 恒为 null，行身份回退内容哈希。
  seeds.push({
    code: "age", label: "赛狐·库存·库龄报表", path: "/api/warehouse/batch/age/pageList.json",
    dateMode: "none", scopeMode: "global", chunkDays: 1, pageSize: 100, rowsPath: "", idFields: "",
    params: paged({ showCost: "1" }), dateFormat: "yyyy-MM-dd", maxRows: 50_000, historyFrom: null,
    note: "库龄报表，showCost=1 返回 totalPurchase/totalInventoryCost 成本列；id 恒 null 故行身份用内容哈希。实测 1977 行。",
  });

  // 日期报表：按全局日期块滚动采集（非按店铺），日期参数名/格式逐条按文档+实测校准。
  type ReportSeed = Pick<SellfoxKnownEndpointSeed, "code" | "label" | "path" | "params" | "dateFormat" | "idFields" | "note"> & { chunkDays?: number };
  const reports: ReportSeed[] = [
    { code: "store-performance", label: "销售·店铺表现按天", path: "/api/stats/getShopDataByDay.json", params: JSON.stringify({ startDate: "${startDate}", endDate: "${endDate}", orderBy: "nowDate", desc: "true" }), dateFormat: "yyyy-MM-dd", idFields: "shopId,marketplaceId,nowDate", note: "店铺按天表现：销量/流量/广告/利润全口径，响应顶层数组，实测单日区间 246 行。" },
    { code: "fba-return", label: "订单·FBA 退货报告", path: "/api/order/api/report/fbaReturn/pageList.json", params: paged({ returnStartDate: "${startDate}", returnEndDate: "${endDate}" }), dateFormat: "yyyy-MM-dd", idFields: "id", note: "FBA 退货明细；必须传 returnStartDate/returnEndDate（yyyy-MM-dd），实测 1967 行。" },
    { code: "fbm-return", label: "订单·FBM 退货报告", path: "/api/order/api/report/fbm/return/order/pageList.json", params: paged({ returnStartDate: "${startDate}", returnEndDate: "${endDate}" }), dateFormat: "yyyy-MM-dd", idFields: "id", note: "FBM 退货明细；同样必须传退货日期区间。" },
    { code: "reviews", label: "商品·评价明细", path: "/api/review/pageDetailList.json", params: paged({ startDate: "${startDate}", endDate: "${endDate}" }), dateFormat: "yyyy-MM-dd", idFields: "reviewId", note: "评价明细；startDate/endDate 必需且跨度≤1年，实测 570 行。" },
    { code: "product-analysis", label: "销售·产品分析 2.0", path: "/api/productAnalyze/new/pageList.json", params: paged({ startDate: "${startDate}", endDate: "${endDate}", searchType: "sku" }), dateFormat: "yyyy-MM-dd", idFields: "asin", note: "产品分析 2.0：BSR/评分/流量/广告/利润全维度；searchType 必填（此处 sku），实测 1629 行。金额多为 number/字符串，建 typed 表须按规范转 Decimal。" },
    { code: "inventory-flow", label: "库存·库存流水", path: "/api/warehouseInOut/inOutRecords.json", params: paged({ createTimeStart: "${startDate}", createTimeEnd: "${endDate}" }), dateFormat: "yyyy-MM-dd", idFields: "id", note: "库存流水；必须传 createTimeStart/createTimeEnd，实测 6423 行。" },
    { code: "order-process", label: "订单·订单处理列表", path: "/api/packageShip/v1/getPackagePage.json", params: paged({ purchaseDateStart: "${startDate}", purchaseDateEnd: "${endDate}" }), dateFormat: "yyyy-MM-dd", idFields: "packageSn", note: "订单处理（FBM 包裹维度）；必须传 purchaseDateStart/purchaseDateEnd。" },
    { code: "fba-fee-detail", label: "财务·FBA 仓库明细费用", path: "/api/finance/fbaStockDetail/pageList.json", params: JSON.stringify({ startMonth: "${startDate}", endMonth: "${endDate}" }), dateFormat: "yyyy-MM", idFields: "reportDate,fnsku,msku", note: "FBA 仓库费用明细：月末成本/头程/周转等 60+ 金额列，startMonth/endMonth 用 yyyy-MM，实测 2179 行。金额建 typed 表须转 Decimal(18,4)+三列。" },
    { code: "receivable", label: "财务·应收报表", path: "/api/financial/accountReceivable/pageList.json", params: paged({ bizDate: "${startDate}" }), dateFormat: "yyyyMM", idFields: "sellerId,bizDate", note: "应收报表：含 rate 汇率、期初/期末余额；bizDate 用 yyyyMM，实测 39 行。文档标注即将下线。" },
    { code: "exchange-rate", label: "总览·汇率列表", path: "/api/rate/open/pageList.json", params: paged({ month: "${startDate}", codes: ["CNY", "USD"] }), dateFormat: "yyyyMM", idFields: "date,code", note: "汇率列表：month 用 yyyyMM，codes 币种数组；多币种利润汇总前置。实测 2 行。" },
  ];
  for (const seed of reports) {
    seeds.push({
      ...seed, label: `赛狐·${seed.label}`, dateMode: "range", scopeMode: "global",
      chunkDays: seed.chunkDays || 30, pageSize: 200, rowsPath: "", maxRows: 50_000, historyFrom: null,
    });
  }

  return seeds;
}

/**
 * 把已文档化域登记为默认停用的通用端点（幂等）。
 * - 不存在则创建并默认 enabled=false；
 * - 已存在则只刷新静态配置，保留用户已有的 enabled 开关，绝不把已启用的端点改回停用。
 * 返回新增 / 更新的 code 清单，便于后台回显。
 */
export async function seedSellfoxKnownEndpoints(scope: { organizationId: string; workspaceId: string }) {
  const { prisma } = await import("@/lib/db/prisma");
  const seeds = sellfoxKnownEndpoints();
  const created: string[] = [];
  const updated: string[] = [];
  for (const seed of seeds) {
    const existing = await prisma.sellfoxApiEndpoint.findUnique({
      where: { organizationId_workspaceId_code: { ...scope, code: seed.code } },
      select: { id: true, enabled: true },
    });
    if (!existing) {
      await prisma.sellfoxApiEndpoint.create({
        data: {
          id: `sellfox-endpoint-${scope.organizationId}-${scope.workspaceId}-${seed.code}`,
          organizationId: scope.organizationId,
          workspaceId: scope.workspaceId,
          code: seed.code,
          label: seed.label,
          path: seed.path,
          dateMode: seed.dateMode,
          scopeMode: seed.scopeMode,
          chunkDays: seed.chunkDays,
          pageSize: seed.pageSize,
          rowsPath: seed.rowsPath,
          idFields: seed.idFields,
          params: seed.params,
          dateFormat: seed.dateFormat,
          maxRows: seed.maxRows,
          historyFrom: seed.historyFrom,
          enabled: false,
        },
      });
      created.push(seed.code);
    } else {
      await prisma.sellfoxApiEndpoint.update({
        where: { id: existing.id },
        data: {
          label: seed.label,
          path: seed.path,
          dateMode: seed.dateMode,
          scopeMode: seed.scopeMode,
          chunkDays: seed.chunkDays,
          pageSize: seed.pageSize,
          rowsPath: seed.rowsPath,
          idFields: seed.idFields,
          params: seed.params,
          dateFormat: seed.dateFormat,
          maxRows: seed.maxRows,
          historyFrom: seed.historyFrom,
          enabled: existing.enabled, // 保留用户开关
        },
      });
      updated.push(seed.code);
    }
  }
  return { total: seeds.length, created, updated };
}
