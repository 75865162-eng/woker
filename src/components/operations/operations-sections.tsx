"use client";

export type OperationsEntry = { view: string; label: string; pending?: { source: string; fields: string; requirement: string } };
type OperationsSection = { id: string; label: string; fields: string; source: string; boundary: string; entries: OperationsEntry[] };

// Presentation only: keep the existing view keys, data readers and approval boundaries.
export const operationsSections: OperationsSection[] = [
  {
    id: "products", label: "商品与 Listing",
    fields: "Seller SKU、ASIN、标题、品牌、五点、描述、图片链接、商品属性、类目、父子变体、刊登状态与 Listing 问题",
    source: "Listings Items、Catalog Items、商品报告；Product Type Definitions 与 A+ Content 待接入",
    boundary: "复用在线商品及已发布的 Listing / 目录观察；字段受 Amazon 返回、安全字段白名单和授权范围限制。外部观察不覆盖商品主档。",
    entries: [
      { view: "catalog", label: "在线商品" }, { view: "listing_details", label: "Listing 完整信息" }, { view: "catalog_items", label: "商品目录" },
      { view: "product-types", label: "商品类型与属性定义", pending: { source: "Product Type Definitions", fields: "商品类型、属性定义、必填字段、校验约束", requirement: "需接入商品类型定义查询及对应站点、商品类型范围。当前没有已接入的数据查询。" } },
      { view: "a-plus", label: "A+ 内容与关联 ASIN", pending: { source: "A+ Content", fields: "A+ 内容文档、内容状态、关联 ASIN", requirement: "需核验品牌和 A+ 资格并接入文档、ASIN 关联查询。Listing 文案不等于 A+ 文档。" } },
    ],
  },
  {
    id: "sales", label: "订单与销售",
    fields: "订单号、创建 / 更新时间、状态、站点、FBA / 自配送渠道、金额、币种；订单商品 SKU、ASIN、数量、商品金额、税费、折扣",
    source: "Orders；销售汇总复用经营与品牌分析中的销售流量日报",
    boundary: "订单商品复用订单详情策略；买家及收货信息受业务用途和受限角色约束，普通查询不展示 PII。金额和明细以实际已采集字段为准。",
    entries: [{ view: "orders", label: "订单列表" }, { view: "order-items", label: "订单商品" }],
  },
  {
    id: "stock", label: "库存与仓储",
    fields: "SKU、ASIN、FNSKU、可售、预留、不可售、入库在途 / 接收数量；库存流水、库龄与库存规划报告字段",
    source: "FBA Inventory、库存报告；AWD 待接入",
    boundary: "库存快照、Ledger 库存事件、库龄报告分别保留来源与日期口径；不把申报货件数量当成实际在途，不用当前库龄推断历史。",
    entries: [{ view: "inventory", label: "库存浏览" }, { view: "inventory_age", label: "库龄" }, { view: "inventory_events", label: "FBA 库存事件" }, { view: "replenishment", label: "补货计划" },
      { view: "awd", label: "AWD 库存", pending: { source: "Amazon Warehousing and Distribution（AWD）", fields: "AWD 商品标识、库存与入库相关数量", requirement: "需核验 AWD 服务资格并接入独立库存查询；现有 FBA 库存不能代替 AWD 库存。" } }],
  },
  {
    id: "logistics", label: "物流与履约",
    fields: "入库计划号、货件号、计划 / 货件商品、目的仓、申报数量及返回状态",
    source: "Fulfillment Inbound；Fulfillment Outbound、Shipping、Easy Ship 待接入",
    boundary: "现有入口仅查询审批 planIds 范围内的计划与货件观察；装箱、运输选项、追踪及实际接收数量是否可用，以已发布业务字段为准。",
    entries: [{ view: "fulfillment", label: "FBA 在途货件" },
      { view: "merchant-shipping", label: "自配送运费与面单", pending: { source: "Shipping、Easy Ship", fields: "运费报价、面单、追踪信息、配送状态", requirement: "需按站点核验服务资格并接入。购买运输和生成面单属于写操作，须独立审批；此入口不创建货件或面单。" } },
      { view: "mcf", label: "MCF 履约单与包裹", pending: { source: "Fulfillment Outbound", fields: "MCF 履约单、商品、包裹、配送状态", requirement: "需接入 MCF 履约查询并明确订单范围；此入口不创建、修改或取消履约单。" } }],
  },
  {
    id: "prices", label: "价格与竞争报价",
    fields: "ASIN、自有报价、商品价与运费（按返回）、分段 Featured Offer、竞争价格参考；Buy Box 历史占比",
    source: "Product Pricing、销售流量报告；Product Fees 与报价通知待接入",
    boundary: "自有价格当前为 New / B2C，Featured Offer 按购买选项分段；报价数量、成色与履约信息按实际返回展示，不推断唯一赢家。",
    entries: [{ view: "pricing", label: "价格与 Featured Offer" }, { view: "buy_box_history", label: "Buy Box 历史日报" },
      { view: "fee-estimates", label: "佣金与 FBA 费用预估", pending: { source: "Product Fees", fields: "佣金、FBA 等费用预估、预估币种与条件", requirement: "需接入按 SKU / ASIN 及报价条件的费用预估。财务已入账费用不能代替预估。" } },
      { view: "offer-notifications", label: "报价变动通知", pending: { source: "Notifications / 报价通知", fields: "报价变动事件、竞争报价及 Featured Offer 相关通知", requirement: "需独立核验订阅和事件接收能力；现有价格快照不代表已接入通知。" } }],
  },
  {
    id: "accounts", label: "财务、结算与税务",
    fields: "交易编号、关联订单、入账时间、状态、收入、退款、佣金、履约费、调整、赔偿与币种；结算报告明细",
    source: "Finances、结算报告、赔偿报告；税务报告与适用发票接口待接入",
    boundary: "财务沿用服务端管理员和范围校验；结算只展示已确认站点归属的行，未知归属隔离。不同来源金额不直接相加，报告发现窗口不等于结算周期。",
    entries: [{ view: "finance", label: "财务交易" }, { view: "settlements", label: "结算报告" }, { view: "reimbursements", label: "赔偿" },
      { view: "tax-invoices", label: "税务与发票", pending: { source: "适用税务报告 / 发票接口", fields: "符合站点及权限条件的税务、发票数据", requirement: "需核验站点、税务身份及接口资格后接入；此入口不申请发票或执行税务动作。" } }],
  },
  {
    id: "insights", label: "经营与品牌分析",
    fields: "销售额、销量、订单商品量、Sessions、Page Views、转化与购物车相关指标（按返回）；搜索词、搜索查询、搜索目录、购买组合",
    source: "销售与流量报告、Brand Analytics 报告；PPC 指标保留独立来源",
    boundary: "日报与品牌报告分别保留业务日、周期、版本和资格限制。搜索频率排名不等于搜索量；PPC 与店铺销售指标不混算。",
    entries: [{ view: "sales-traffic", label: "销售流量日报" }, { view: "brand_analytics", label: "品牌分析" }, { view: "ads", label: "PPC 经营指标" },
      { view: "repeat-purchase", label: "复购分析", pending: { source: "Brand Analytics 复购报告", fields: "复购买家、复购销售与对应周期指标", requirement: "现有品牌分析支持搜索词、搜索查询、搜索目录和购买组合；复购报告尚未接入，需核验品牌资格。" } },
      { view: "data-kiosk", label: "Data Kiosk 查询", pending: { source: "Data Kiosk", fields: "适用数据集的销售、流量或分析查询结果", requirement: "需核验可用数据集、查询权限及异步任务流程；当前不提交 Data Kiosk 查询。" } }],
  },
  {
    id: "service", label: "退货、售后与账户健康",
    fields: "退货商品、数量、原因、时间、报告状态及可用订单关联；退款和赔偿复用财务板块",
    source: "FBA 退货报告、Finances；Messaging、Solicitations 与卖家绩效报告待接入",
    boundary: "现有退货为 FBA 仓收退货，按单份已发布报告查看；不代表覆盖所有自配送退货。订单、退款和赔偿关联须保持相同组织、店铺、站点与授权边界。",
    entries: [{ view: "returns", label: "FBA 仓收退货" },
      { view: "buyer-messages", label: "买家消息与邀评", pending: { source: "Messaging、Solicitations", fields: "可用消息动作、邀评资格与动作", requirement: "需核验订单及可用动作并接入；消息、邀评为外部发送动作，此入口不发送任何内容。" } },
      { view: "account-health", label: "账户健康与卖家绩效", pending: { source: "适用卖家绩效报告", fields: "接口或报告实际支持的卖家绩效指标", requirement: "需逐站点核验可用报告和字段；不把同步数据质量当作 Amazon 账户健康。" } }],
  },
];

export const operationsEntries = operationsSections.flatMap(section => section.entries);
export const operationsAdminNav = [["overview", "数据总览"], ["approvals", "变更审批"], ["plans", "同步计划"], ["tasks", "同步任务"], ["domains", "数据域管理"], ["quality", "数据质量"], ["connections", "店铺与授权"], ["settings", "同步设置"]] as const;

export function OperationsSectionCards({ navigate }: { navigate: (view: string) => void }) {
  return <section aria-label="经营中台八大板块" className="grid min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
    {operationsSections.map((section, index) => <article key={section.id} className="min-w-0 rounded-lg border border-border bg-surface p-4">
      <p className="text-[10px] font-medium text-muted">板块 {String(index + 1).padStart(2, "0")}</p>
      <h2 className="mt-1 text-sm font-semibold">{section.label}</h2>
      <p className="mt-2 text-xs leading-relaxed text-muted">{section.fields}</p>
      <p className="mt-2 text-[11px] leading-relaxed text-muted">主要来源：{section.source}</p>
      <button type="button" className="mt-3 min-h-9 text-xs font-medium text-brand-dark hover:underline" onClick={() => navigate(section.entries[0].view)}>进入{section.label} →</button>
    </article>)}
  </section>;
}

export function OperationsSectionGuide({ view }: { view: string }) {
  const section = operationsSections.find(item => item.entries.some(entry => entry.view === view));
  if (!section) return null;
  const pending = section.entries.find(entry => entry.view === view)?.pending;
  return <section aria-label="板块字段与来源" className="space-y-2 rounded-lg border border-border bg-surface p-3.5 text-xs leading-relaxed">
    <p className="font-semibold">{section.label}</p>
    <p><span className="text-muted">主要字段：</span>{pending?.fields ?? section.fields}</p>
    <p><span className="text-muted">主要来源：</span>{pending?.source ?? section.source}</p>
    <p className="text-muted">{pending ? "待接入 · 已提供能力说明入口，当前没有此能力的已接入查询或采集操作。" : section.boundary}</p>
    {pending && <p role="status">{pending.requirement}</p>}
  </section>;
}
