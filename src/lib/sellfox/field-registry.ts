/**
 * 赛狐字段契约（M0 数据契约）。
 *
 * 目的：让赛狐工作台的每一个展示字段、聚合维度、筛选字段都能回答三件事——
 *   1) 来自哪张表哪个字段（source / table / column）；
 *   2) 怎么聚合（aggregate）；
 *   3) 空值表示什么（nullSemantics），且不把 null 补成 0。
 *
 * 本文件是纯静态声明，无请求、无数据库、无外部副作用。它不是运行时读取层：
 * 真正的读路径是 workbench-read.ts / agent-read.ts / replica-workbench.tsx，
 * 本契约用于固化口径、供校验脚本与测试比对，防止「用一个字段冒充另一个字段」。
 *
 * 五条铁律（编码进结构与校验）：
 *   1. 不造数：数据源不存在的字段 enabled=false + needsData=true，UI 显示「-」，不造列、不造值。
 *   2. null 传播：nullSemantics 只能是 "-" 或明确的分组占位文案，禁止把 null 变 0。
 *   3. 币种不混算：金额字段 currencyScoped=true，跨币种合计必须按币种分列。
 *   4. 筛选即围栏：所有筛选字段 scoped=true，服务端须与 organizationId/workspaceId 同时入 where。
 *   5. 同上下文下钻：跳转动作携带当前筛选（见 M3），本契约只登记动作存在性。
 */

export type FieldSource =
  | "sales_daily"          // SellfoxSalesDailySnapshot
  | "listing"              // sellfox_listing_current / SellfoxListingSnapshot
  | "inventory"            // SellfoxFbaInventorySnapshot
  | "product_daily"        // SellfoxProductDailySnapshot（销售利润，含 userNameList）
  | "store"                // SellfoxStore
  | "derived"              // 由已同步字段计算，不是原始列
  | "route"                // 行内跳转入口，非数据列
  | "none";                // 赛狐有此概念但本系统数据源未接入

export type Aggregate =
  | "identity"             // 身份/维度键，直接分组
  | "sum"                  // 区间求和
  | "latest"               // 取最近一次快照
  | "coalesce_group"       // COALESCE 后分组（空值独立成组）
  | "computed"             // 计算字段
  | "none";                // 无聚合（占位/跳转/缺字段）

export type FieldGroup = "dimension" | "basic" | "inventory" | "sales" | "action";

export interface FieldContract {
  /** 稳定键，与 UI columns[].key / 维度 id / agent 列名对齐。 */
  key: string;
  /** 赛狐侧口径名称。 */
  label: string;
  group: FieldGroup;
  source: FieldSource;
  /** Prisma model 或 SQL 视图名；无真实来源时为 null。 */
  table: string | null;
  /** 真实列名或计算表达式；无真实来源时为 null。 */
  column: string | null;
  aggregate: Aggregate;
  /** 空值语义：只能是 "-" 或明确的分组占位文案，绝不写 0。 */
  nullSemantics: string;
  enabled: boolean;
  /** 数据源未接入时为 true；enabled 必须为 false。 */
  needsData?: boolean;
  /** 金额字段：跨币种必须分列，不混算。 */
  currencyScoped?: boolean;
  /** 筛选字段：服务端必须与租户范围同时入 where。 */
  scoped?: boolean;
  /** 禁用 / NEEDS_DATA 的原因，写清楚缺口来源。 */
  reason?: string;
}

const DASH = "-";
const UNASSIGNED_DEVELOPER = "未分配开发员";
const UNASSIGNED_SPU = "未分配SPU";

/**
 * 字段契约表。覆盖 v4 §4.1–4.4 的 8 维度 + 基本信息 + 库存 + 销售 + 行内动作。
 * 每条都可追溯到当前代码基线（commit 8d3d245）的真实读取路径。
 */
export const SELLFOX_FIELD_CONTRACTS: readonly FieldContract[] = [
  // ---- 8 个聚合维度（§4.1 D1–D8）----
  { key: "asin", label: "ASIN", group: "dimension", source: "sales_daily", table: "SellfoxSalesDailySnapshot", column: "asin", aggregate: "identity", nullSemantics: DASH, enabled: true, scoped: true },
  { key: "parentAsin", label: "父ASIN", group: "dimension", source: "listing", table: "sellfox_listing_current", column: "parentAsin", aggregate: "coalesce_group", nullSemantics: DASH, enabled: true, scoped: true, reason: "COALESCE(parentAsin, asin)：无父体时自成一组，workbench-read.ts identity 分支已实现。" },
  { key: "msku", label: "MSKU", group: "dimension", source: "sales_daily", table: "SellfoxSalesDailySnapshot", column: "msku", aggregate: "identity", nullSemantics: DASH, enabled: true, scoped: true },
  { key: "sku", label: "SKU", group: "dimension", source: "sales_daily", table: "SellfoxSalesDailySnapshot", column: "sku", aggregate: "identity", nullSemantics: DASH, enabled: true, scoped: true },
  { key: "spu", label: "SPU", group: "dimension", source: "listing", table: "sellfox_listing_current", column: "spu", aggregate: "coalesce_group", nullSemantics: UNASSIGNED_SPU, enabled: true, scoped: true, reason: "COALESCE(spu,'未分配SPU')：空值独立成组，不静默并入某款。" },
  { key: "store", label: "店铺", group: "dimension", source: "store", table: "SellfoxStore", column: "name", aggregate: "identity", nullSemantics: DASH, enabled: true, scoped: true },
  { key: "developer", label: "开发员", group: "dimension", source: "listing", table: "sellfox_listing_current", column: "developer", aggregate: "coalesce_group", nullSemantics: UNASSIGNED_DEVELOPER, enabled: true, scoped: true, reason: "COALESCE(developer,'未分配开发员')：来源为 Listing 开发员字段，不伪造成业务员。" },
  // 业务员是「商品级数组属性」，不是销量日快照的列。真实来源 product_daily.userNameList，
  // 当前仅支持筛选（EXISTS 半连接），不作为可切维度，直到有单值归属列落地。
  { key: "salesperson", label: "业务员", group: "dimension", source: "product_daily", table: "SellfoxProductDailySnapshot", column: "userNameList", aggregate: "none", nullSemantics: DASH, enabled: false, scoped: true, reason: "业务员是商品级数组（userNameList），销量日快照无该列；仅支持 EXISTS 半连接筛选，不展开数组伪造维度，也不从开发员冒充。workbench-read.ts:96 已实现筛选。" },

  // ---- 基本信息列（§4.4，17 列）----
  { key: "image", label: "图片", group: "basic", source: "listing", table: "sellfox_listing_current", column: "mainImage", aggregate: "latest", nullSemantics: DASH, enabled: true, reason: "仅允许 m.media-amazon.com HTTPS CDN，冷门/懒加载由渲染层处理。" },
  { key: "asinCol", label: "ASIN", group: "basic", source: "sales_daily", table: "SellfoxSalesDailySnapshot", column: "asin", aggregate: "identity", nullSemantics: DASH, enabled: true },
  { key: "storeSite", label: "店铺/站点", group: "basic", source: "store", table: "SellfoxStore", column: "name,marketplace", aggregate: "identity", nullSemantics: DASH, enabled: true, reason: "店名与站点国旗两行展示，站点来自 marketplace。" },
  { key: "parentAsinCol", label: "父ASIN", group: "basic", source: "listing", table: "sellfox_listing_current", column: "parentAsin", aggregate: "latest", nullSemantics: DASH, enabled: true },
  { key: "mskuPrice", label: "MSKU/售价", group: "basic", source: "listing", table: "sellfox_listing_current", column: "msku,price", aggregate: "latest", nullSemantics: DASH, enabled: true, currencyScoped: true, reason: "售价按币种格式化，跨币种不相加。" },
  { key: "title", label: "品名/SKU", group: "basic", source: "listing", table: "sellfox_listing_current", column: "title,sku", aggregate: "latest", nullSemantics: DASH, enabled: true },
  { key: "productName", label: "中文品名", group: "basic", source: "none", table: null, column: null, aggregate: "none", nullSemantics: DASH, enabled: false, needsData: true, reason: "Listing V2 响应无中文品名字段；缺失时展示 SKU，不造 productName。" },
  { key: "spuCol", label: "款名/SPU", group: "basic", source: "listing", table: "sellfox_listing_current", column: "spu", aggregate: "latest", nullSemantics: DASH, enabled: true, reason: "空值统一显示 -，与 SPU 维度占位区分。" },
  { key: "productTags", label: "产品标签", group: "basic", source: "listing", table: "sellfox_listing_current", column: "openDate", aggregate: "computed", nullSemantics: DASH, enabled: true, reason: "生命周期 4 档由 openDate 计算；公共/个人标签无源，二期。" },
  { key: "brand", label: "商品品牌", group: "basic", source: "listing", table: "sellfox_listing_current", column: "brand", aggregate: "latest", nullSemantics: DASH, enabled: true },
  { key: "model", label: "型号", group: "basic", source: "none", table: null, column: null, aggregate: "none", nullSemantics: DASH, enabled: false, needsData: true, reason: "Listing V2 响应无 model；赛狐「报关型号」属另一接口，未采集前显示 -。" },
  { key: "salespersonCol", label: "业务员", group: "basic", source: "product_daily", table: "SellfoxProductDailySnapshot", column: "userNameList", aggregate: "none", nullSemantics: DASH, enabled: true, reason: "按 storeId+msku 半连接展示真实数组，不展开成多行。" },
  { key: "owner", label: "业绩归属人", group: "basic", source: "none", table: null, column: null, aggregate: "none", nullSemantics: DASH, enabled: false, needsData: true, reason: "赛狐有业绩归属业务员 ID（在线产品修改接口），当前同步未采集该归属列，显示 -。" },
  { key: "category", label: "分类", group: "basic", source: "none", table: null, column: null, aggregate: "none", nullSemantics: DASH, enabled: false, needsData: true, reason: "类目树 categoryPath 无源，显示 - 不造分类。" },
  { key: "analysis", label: "分析", group: "action", source: "route", table: null, column: null, aggregate: "none", nullSemantics: DASH, enabled: false, needsData: true, reason: "M3 趋势弹窗：环比/同比/7天/30天/本月均值，按 grain 重采样，携带当前筛选上下文。" },
  { key: "operations", label: "运营", group: "action", source: "route", table: null, column: null, aggregate: "none", nullSemantics: DASH, enabled: false, needsData: true, reason: "M3 跳转 listings，携带当前筛选上下文。" },
  { key: "insight", label: "销量洞察", group: "action", source: "route", table: null, column: null, aggregate: "none", nullSemantics: DASH, enabled: false, needsData: true, reason: "M3 跳转同 ASIN 看板，携带当前筛选上下文。" },

  // ---- 库存列（§4.4，14 列）----
  { key: "fulfillable", label: "FBA可售", group: "inventory", source: "inventory", table: "SellfoxFbaInventorySnapshot", column: "quantity", aggregate: "latest", nullSemantics: DASH, enabled: true, reason: "取最近一次库存快照，缺快照留空不补 0。" },
  { key: "totalInventory", label: "FBA总库存", group: "inventory", source: "inventory", table: "SellfoxFbaInventorySnapshot", column: "totalInventory", aggregate: "latest", nullSemantics: DASH, enabled: true },
  { key: "unfulfillable", label: "不可售", group: "inventory", source: "inventory", table: "SellfoxFbaInventorySnapshot", column: "unfulfillable", aggregate: "latest", nullSemantics: DASH, enabled: true },
  { key: "reserved", label: "预留数", group: "inventory", source: "inventory", table: "SellfoxFbaInventorySnapshot", column: "reservedTransfer/reservedProcessing/reservedCustomerorders", aggregate: "latest", nullSemantics: DASH, enabled: true, reason: "三类预留分列可追溯；合计仅在同币种同快照内相加。" },
  { key: "inTransit", label: "FBA在途", group: "inventory", source: "inventory", table: "SellfoxFbaInventorySnapshot", column: "inTransit", aggregate: "latest", nullSemantics: DASH, enabled: true },
  { key: "inboundWorking", label: "入库处理中", group: "inventory", source: "inventory", table: "SellfoxFbaInventorySnapshot", column: "inboundWorking", aggregate: "latest", nullSemantics: DASH, enabled: true },
  { key: "inboundShipped", label: "入库已发出", group: "inventory", source: "inventory", table: "SellfoxFbaInventorySnapshot", column: "inboundShipped", aggregate: "latest", nullSemantics: DASH, enabled: true },
  { key: "inboundReceiving", label: "入库正在接收", group: "inventory", source: "inventory", table: "SellfoxFbaInventorySnapshot", column: "inboundReceiving", aggregate: "latest", nullSemantics: DASH, enabled: true },
  { key: "fbmAvailable", label: "FBM可售", group: "inventory", source: "none", table: null, column: null, aggregate: "none", nullSemantics: DASH, enabled: false, needsData: true, reason: "卖家自配送库存无同步源，显示 -。" },
  { key: "awdInventory", label: "AWD库存", group: "inventory", source: "none", table: null, column: null, aggregate: "none", nullSemantics: DASH, enabled: false, needsData: true, reason: "无任何 AWD 字段，显示 - 不补 0。" },
  { key: "awdInTransit", label: "AWD在途", group: "inventory", source: "none", table: null, column: null, aggregate: "none", nullSemantics: DASH, enabled: false, needsData: true, reason: "无 AWD 在途字段，显示 - 不补 0。" },
  { key: "awdAvailable", label: "AWD可售", group: "inventory", source: "none", table: null, column: null, aggregate: "none", nullSemantics: DASH, enabled: false, needsData: true, reason: "无 AWD 可售字段，显示 - 不补 0。" },
  { key: "awdReserved", label: "AWD预留", group: "inventory", source: "none", table: null, column: null, aggregate: "none", nullSemantics: DASH, enabled: false, needsData: true, reason: "无 AWD 预留字段，显示 - 不补 0。" },
  { key: "awdToFba", label: "AWD发FBA在途", group: "inventory", source: "none", table: null, column: null, aggregate: "none", nullSemantics: DASH, enabled: false, needsData: true, reason: "无 AWD 发 FBA 在途字段，显示 - 不补 0。" },
  { key: "availableDays", label: "FBA可售天数", group: "inventory", source: "derived", table: null, column: "quantity / (区间销量 ÷ 天数)", aggregate: "computed", nullSemantics: DASH, enabled: true, reason: "日均取所选区间销量÷天数；除零、缺库存或缺销量一律 null，不补 0。" },

  // ---- 销售列（§4.4，3 列）----
  { key: "quantity", label: "销量", group: "sales", source: "sales_daily", table: "SellfoxSalesDailySnapshot", column: "quantity", aggregate: "sum", nullSemantics: DASH, enabled: true, scoped: true, reason: "所选日期区间合计，与小计口径一致；缺日不补 0。" },
  { key: "revenue", label: "销售额", group: "sales", source: "sales_daily", table: "SellfoxSalesDailySnapshot", column: "revenue", aggregate: "sum", nullSemantics: DASH, enabled: true, currencyScoped: true, scoped: true, reason: "按币种分列，跨币种不相加。" },
  { key: "orders", label: "订单量", group: "sales", source: "sales_daily", table: "SellfoxSalesDailySnapshot", column: "orders", aggregate: "sum", nullSemantics: DASH, enabled: true, scoped: true },
  { key: "subtotal", label: "小计", group: "sales", source: "sales_daily", table: "SellfoxSalesDailySnapshot", column: "按当前 metric 取 quantity/revenue/orders", aggregate: "sum", nullSemantics: DASH, enabled: true, currencyScoped: true, scoped: true, reason: "金额按币种分列；跨币种合计须标「折合」并附汇率口径。" },
];

const byKey = new Map(SELLFOX_FIELD_CONTRACTS.map((field) => [field.key, field]));

export function sellfoxField(key: string): FieldContract | undefined {
  return byKey.get(key);
}

/** 扁平键值表，便于测试遍历与调试输出。 */
export const SELLFOX_FIELDS: Readonly<Record<string, FieldContract>> = Object.freeze(
  Object.fromEntries(SELLFOX_FIELD_CONTRACTS.map((field) => [field.key, field])),
);
