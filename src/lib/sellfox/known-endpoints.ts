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

  // 结算中心 V2：财务结算口径，与日利润快照不同口径，独立落 SellfoxApiRecord。
  // 契约来源：docs/sellfox-api-docs/API.md 的 api-399397941 / api-399397942（2026-11-19 核对）。
  seeds.push({
    code: "fin_settlement_detail_v2",
    label: "财务·结算明细 V2（分页）",
    path: "/api/financial/v2/settlementSummary/detailPage.json",
    dateMode: "range",
    scopeMode: "store",
    chunkDays: 90, // 文档 startTime/endTime 为 yyyy-MM-dd；结算按月出数，90 天块安全
    pageSize: 200,
    rowsPath: "data.detailPageVoList",
    idFields: "id", // 文档：FinancialSettlementDetailPageOpenVo.id = 唯一键 id
    params: JSON.stringify({
      pageNo: "${pageNo}",
      pageSize: "${pageSize}",
      startTime: "${startDate}",
      endTime: "${endDate}",
      shopIds: ["${shopIdNumeric}"], // 文档：shopIds 为 int32 数字店铺 ID
    }),
    dateFormat: "yyyy-MM-dd",
    maxRows: 50_000,
    historyFrom: null,
    note: "结算中心 V2 明细分页，按结算行 id 幂等；结算口径不与日利润快照相加。契约见 docs/sellfox-api-docs/API.md#api-399397941。",
  });

  seeds.push({
    code: "fin_settlement_summary_v2",
    label: "财务·结算汇总 V2（分页）",
    path: "/api/financial/v2/settlementSummary/groupPage.json",
    dateMode: "range",
    scopeMode: "store",
    chunkDays: 90,
    pageSize: 200,
    rowsPath: "data.groupVoList", // 文档：FinSettlementSummaryGroupOpenPage.groupVoList
    idFields: "groupId", // 文档：FinGroupOpenVo.groupId = 事件组ID，缺失时回退内容哈希
    params: JSON.stringify({
      pageNo: "${pageNo}",
      pageSize: "${pageSize}",
      timeType: "settlementStartTime", // 文档必填：结算开始时间口径
      startTime: "${startDate}",
      endTime: "${endDate}",
      shopIds: ["${shopIdNumeric}"],
    }),
    dateFormat: "yyyy-MM-dd",
    maxRows: 50_000,
    historyFrom: null,
    note: "结算中心 V2 汇总分页；timeType 必填，取结算开始时间口径。契约见 docs/sellfox-api-docs/API.md#api-399397942。",
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
