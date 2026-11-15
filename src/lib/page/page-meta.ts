/**
 * ERP 全站页面审计矩阵（代码化）。
 *
 * 来源对照：
 *  - codex/tiaotiao-style-demo（Wimoor 原系统 Vue3 + Element Plus）的 9 类页面模式
 *  - woker 仓库 wimoor 分支的 50 个 Next.js 路由
 *  - 本地主项目 codex/amazon-multistore-mcp 分支的 37 个路由
 *
 * 每一条记录就是一次「审计 + 规划 + 移植」的结论：页面所属业务域、应套用的展示模式、
 * 必备信息块、必备按钮集、参考来源、缓存口径与相关页面。
 * `PageFrame` 在 layout 层读取本表，为除 /dashboard 外的所有页面注入统一布局。
 */

export type PagePattern =
  | "master-data"    // 主数据列表页：筛选 + 功能按钮区 + 复合单元格表格 + 分页
  | "document"       // 单据列表页：新增/删除/导入/导出 + 单据明细
  | "entry"          // 单据录入页：主表 + 子表明细 + 底部固定提交
  | "approval"       // 审核工作台：状态 tabs 带角标 + 批量审核 + 行内动作
  | "report"         // 统计报表页：维度 tabs + 多级表头 + 合计行
  | "detail"         // 详情弹窗/抽屉：描述区 + 双子表
  | "master-detail"  // 主从双视图：单据/SKU 切换 + 行展开
  | "dashboard"      // 看板：KPI 卡 + 图表
  | "settings"       // 设置：tabs + 分栏表单
  | "hub"            // 导航/中台落地页
  | "agent"          // AI Agent 工作台
  | "utility"        // 工具页
  | "redirect";      // 重定向占位

export type PageCapability =
  | "新增" | "编辑" | "删除" | "批量操作" | "导入" | "下载模板" | "导出"
  | "审核" | "驳回" | "作废" | "打印" | "刷新" | "重置" | "高级筛选"
  | "列配置" | "状态标签" | "合计行" | "详情抽屉" | "视图切换" | "复制"
  | "同步" | "试算" | "保存快照" | "权限校验" | "多标签保活";

export type RelatedLink = { label: string; href: string };

export type PageCachePolicy = {
  /** 展示给用户的口径说明 */
  strategy: string;
  /** 客户端列表缓存 TTL（毫秒） */
  ttlMs?: number;
  /** 筛选条件是否跨页保留（对应原系统 search.vue 的 ckey 语义） */
  persistFilters?: boolean;
  /** 是否使用多标签页保活（对应原系统 keep-alive） */
  keepAlive?: boolean;
  /** 请求是否并发去重 */
  dedupe?: boolean;
};

export type PageMeta = {
  /** 精确路径；以 * 结尾表示前缀匹配 */
  path: string;
  title: string;
  /** 面包屑一级分组 */
  group: string;
  groupHref?: string;
  pattern: PagePattern;
  description: string;
  /** 页面说明面板中的信息块要点 */
  bullets?: string[];
  /** 对应 Wimoor 原系统的页面 / 模式 */
  source?: string;
  /** 必备按钮与能力集合 */
  capabilities?: PageCapability[];
  /** 相关页面快捷入口 */
  related?: RelatedLink[];
  /** 子视图（?view= / ?tab= / ?domain=） */
  views?: Record<string, { title: string; description?: string; pattern?: PagePattern; source?: string }>;
  /** 子视图取自哪个 query 参数 */
  viewParam?: "view" | "tab" | "domain" | "adsTab";
  cache: PageCachePolicy;
  /** true 时不注入统一框架（/dashboard 按需求排除） */
  skipFrame?: boolean;
};

const NO_STORE: PageCachePolicy = {
  strategy: "API no-store；客户端列表缓存 30s（请求并发去重，工作区切换自动失效）",
  ttlMs: 30_000,
  persistFilters: true,
  keepAlive: true,
  dedupe: true,
};

const REPORT_CACHE: PageCachePolicy = {
  strategy: "报表查询 no-store；客户端缓存 60s + URL 筛选可分享；汇总与明细同接口返回",
  ttlMs: 60_000,
  persistFilters: true,
  keepAlive: true,
  dedupe: true,
};

const STATIC_CACHE: PageCachePolicy = {
  strategy: "静态配置；字典/下拉长缓存，工作区或租户切换时主动失效",
  ttlMs: 300_000,
  keepAlive: true,
  dedupe: true,
};

const REALTIME_CACHE: PageCachePolicy = {
  strategy: "实时状态 no-store；15s 轮询（页面隐藏时暂停），无列表缓存",
  persistFilters: false,
  keepAlive: true,
  dedupe: true,
};

const OPERATIONS_RELATED: RelatedLink[] = [
  { label: "同步中心", href: "/operations" },
  { label: "采购计划", href: "/operations/purchase-plans" },
  { label: "仓库工作台", href: "/logistics/warehouse?tab=warehouses" },
  { label: "赛狐数据中台", href: "/sellfox" },
];

/** 全部页面（含 wimoor 分支新增 13 页），/dashboard 显式排除。 */
export const PAGE_META: PageMeta[] = [
  {
    path: "/", title: "运营工作台", group: "首页", pattern: "hub",
    description: "全站业务入口与经营概览，聚合商品、订单、库存、采购、财务、广告与数据域的快捷通路。",
    bullets: ["十大业务分组导航", "工作区/店铺/站点作用域切换", "同步任务与通知状态"],
    source: "Wimoor 首页 dashboard/index.vue + 全局外壳 Layout",
    capabilities: ["刷新", "权限校验", "多标签保活"],
    related: [{ label: "商品主档", href: "/dashboard" }, { label: "经营中台", href: "/operations" }, { label: "任务中心", href: "/tasks" }],
    cache: STATIC_CACHE,
  },
  {
    path: "/dashboard", title: "商品主档", group: "商品管理", pattern: "master-data",
    description: "按需求排除本次布局改造，保留既有 SSR 预取与 ProductWorkbench 完整实现。",
    skipFrame: true,
    cache: NO_STORE,
  },
  {
    path: "/workspace", title: "PPC Bulk 优化", group: "广告管理", pattern: "master-detail",
    description: "广告批量调整工作台：草稿导入、规则校验、差异预览与批量提交。",
    bullets: ["批量草稿与调整表", "规则校验与冲突提示", "提交前差异预览"],
    source: "Wimoor 广告 manager/index.vue + 单据/SKU 双视图模式",
    capabilities: ["导入", "下载模板", "导出", "批量操作", "视图切换", "列配置"],
    related: [{ label: "Amazon Ads", href: "/amazon-ads/campaigns" }, { label: "PPC 经营指标", href: "/operations?view=ads" }],
    cache: NO_STORE,
  },
  {
    path: "/accounts", title: "账号权限", group: "系统管理", pattern: "master-data",
    description: "组织成员、角色与权限目录；服务端预取团队花名册和角色目录，保证首屏有数据。",
    bullets: ["成员与角色目录", "按模块授权", "审计与权限快照"],
    source: "Wimoor sys/subUser、ruleAuth、dept 主数据列表模式",
    capabilities: ["新增", "编辑", "删除", "批量操作", "刷新", "权限校验", "列配置"],
    related: [{ label: "系统设置", href: "/settings" }, { label: "版本审计", href: "/versions" }],
    cache: STATIC_CACHE,
  },
  {
    path: "/settings", title: "系统设置", group: "系统管理", pattern: "settings",
    description: "模型、工作区、通知、集成、Skill/ERP、运维等配置的分区表单，tab 状态写回 URL 可分享。",
    bullets: ["模型与工具", "工作区与作用域", "通知与集成", "Skill / ERP", "运维与数据状态"],
    source: "Wimoor sys/* 设置页 + 维度 tabs 模式",
    capabilities: ["重置", "刷新", "权限校验", "多标签保活"],
    related: [{ label: "账号权限", href: "/accounts" }, { label: "版本审计", href: "/versions" }],
    viewParam: "tab",
    views: {
      models: { title: "模型与工具" }, workspace: { title: "工作区" }, notifications: { title: "通知" },
      integrations: { title: "集成" }, "skill-erp": { title: "Skill / ERP" }, operations: { title: "运维" },
      points: { title: "积分策略" }, mcp: { title: "MCP 设置" },
    },
    cache: STATIC_CACHE,
  },
  {
    path: "/tasks", title: "任务中心", group: "系统管理", pattern: "document",
    description: "导入、解析、导出任务的集中状态视图；对应原系统同步任务与进度轮询。",
    bullets: ["任务状态与进度条", "失败原因与重试", "产物下载"],
    source: "Wimoor sys/task + RightToolbar 刷新模式",
    capabilities: ["刷新", "导出", "状态标签", "复制"],
    related: [{ label: "版本审计", href: "/versions" }, { label: "同步中心", href: "/operations" }],
    cache: REALTIME_CACHE,
  },
  {
    path: "/versions", title: "版本审计", group: "系统管理", pattern: "report",
    description: "数据版本与变更审计；保留变更时间、操作人、影响范围与回滚线索。",
    bullets: ["版本时间线", "变更对象与字段", "操作人留痕"],
    source: "Wimoor sys 审计/日志报表模式",
    capabilities: ["刷新", "导出", "合计行"],
    related: [{ label: "任务中心", href: "/tasks" }, { label: "历史记录", href: "/history" }],
    cache: REPORT_CACHE,
  },
  {
    path: "/history", title: "历史记录", group: "数据中心", pattern: "document",
    description: "赛狐搜索词合并的本地上传与导出记录，支持按批次回溯与产物下载。",
    bullets: ["批次与时间", "上传/导出类型", "记录数与产物"],
    source: "Wimoor 单据列表页模式（无新增，仅查询与导出）",
    capabilities: ["刷新", "导出", "状态标签", "详情抽屉"],
    related: [{ label: "赛狐搜词合并", href: "/saihu-search-merge" }],
    cache: NO_STORE,
  },
  {
    path: "/forbidden", title: "无访问权限", group: "系统管理", pattern: "utility",
    description: "权限不足时的引导页，说明所请求路径与申请入口，避免空白页。",
    capabilities: ["权限校验"],
    related: [{ label: "返回工作台", href: "/" }, { label: "账号权限", href: "/accounts" }],
    cache: STATIC_CACHE,
  },
  {
    path: "/listing-ai", title: "Listing AI", group: "商品管理", pattern: "utility",
    description: "Listing 文案生成、图片增强与结果对比；tab 状态写回 URL。",
    bullets: ["生成输入与参数", "结果按项对比", "历史草稿与图片超分"],
    source: "Wimoor Listing 相关 + 主从结果视图模式",
    capabilities: ["试算", "导出", "复制", "详情抽屉", "保存快照"],
    related: [{ label: "Listing 生成台", href: "/listing-ai/studio" }, { label: "在线商品", href: "/operations?view=catalog" }],
    viewParam: "tab",
    views: { imageupscale: { title: "图片超分" }, "image-upscale": { title: "图片超分" }, gallery: { title: "结果图库" } },
    cache: NO_STORE,
  },
  {
    path: "/listing-ai/studio", title: "Listing 生成台", group: "商品管理", pattern: "entry",
    description: "填写产品特点/参数/规格直出标题与描述，竞品图生图，结果按项对比并支持导出与批量采纳。",
    bullets: ["输入表单与字段约束", "结果面板与逐项对比", "批量采纳/导出/历史"],
    source: "Wimoor 单据录入页 + 主从双视图模式",
    capabilities: ["试算", "批量操作", "导出", "复制", "保存快照", "列配置"],
    related: [{ label: "Listing AI", href: "/listing-ai" }],
    cache: NO_STORE,
  },
  {
    path: "/logistics", title: "物流文件工作台", group: "物流发货", pattern: "document",
    description: "头程与 FBA 物流文件、面单与箱规资料的集中工作台。",
    bullets: ["物流单据与文件", "箱规与装箱资料", "导出与模板"],
    source: "Wimoor erp/ship/transportation + 单据列表页模式",
    capabilities: ["新增", "导入", "下载模板", "导出", "打印", "刷新"],
    related: [{ label: "仓库工作台", href: "/logistics/warehouse?tab=warehouses" }, { label: "FBA 在途货件", href: "/operations?view=fulfillment" }],
    cache: NO_STORE,
  },
  {
    path: "/logistics/warehouse", title: "仓库工作台", group: "仓库管理", pattern: "document",
    description: "WMS 主工作台：仓库档案、入库单、出库单、库存与调拨流水按 tab 切换；状态与单据 id 均可由 URL 还原。",
    bullets: ["仓库档案与库位", "入库/出库单据", "公司库存与调拨", "单据明细与打印"],
    source: "Wimoor erp/warehouse/{inbound,outbound,transfer,stocktake} 单据列表 + 录入页模式",
    capabilities: ["新增", "删除", "导入", "下载模板", "导出", "打印", "刷新", "审核", "详情抽屉", "状态标签"],
    related: [{ label: "库存浏览", href: "/operations?view=inventory" }, { label: "组装", href: "/operations/assembly" }],
    viewParam: "tab",
    views: {
      warehouses: { title: "仓库档案", pattern: "master-data" },
      receipts: { title: "仓库入库", pattern: "document", source: "inbound/index.vue" },
      reservations: { title: "仓库出库", pattern: "document", source: "outbound/index.vue" },
      balances: { title: "公司库存与调拨", pattern: "report" },
      transfers: { title: "调拨流水", pattern: "report" },
      stocktake: { title: "盘点单", pattern: "document" },
    },
    cache: NO_STORE,
  },
  {
    path: "/operations", title: "经营中台", group: "数据中心", pattern: "hub",
    description: "Amazon SP-API 全量业务视图的入口：43 个业务视图按九大板块归类，逐视图标注字段、数据源与使用边界，并含同步中心管理页。",
    bullets: ["九大业务板块与字段口径", "已接入 / 待接入能力标注", "同步计划、任务、数据域与质量"],
    source: "Wimoor 全局外壳 + 动态菜单 + GlobalTable 列表模式",
    capabilities: ["刷新", "重置", "高级筛选", "导出", "列配置", "同步", "状态标签", "合计行", "详情抽屉", "权限校验"],
    related: OPERATIONS_RELATED,
    viewParam: "view",
    cache: NO_STORE,
  },
  {
    path: "/operations/expenses", title: "ERP 费用单", group: "财务、结算与税务", pattern: "approval",
    description: "通用费用单的登记、审批与核销；对应原系统费用管理，补齐状态标签与批量审核动作。",
    bullets: ["费用单状态流转", "审批与驳回", "金额与币种口径"],
    source: "Wimoor erp/finance/paymentRequest + 审核工作台模式",
    capabilities: ["新增", "审核", "驳回", "作废", "导出", "打印", "状态标签", "批量操作"],
    related: [{ label: "ERP 总账", href: "/operations/finance-ledger" }, { label: "财务交易", href: "/operations?view=finance" }],
    cache: NO_STORE,
  },
  {
    path: "/operations/finance-ledger", title: "ERP 总账", group: "财务、结算与税务", pattern: "report",
    description: "会计科目、凭证与期间的总账视图；按原系统凭证列表补齐多级状态与合计行。",
    bullets: ["凭证日期与字号", "借贷金额与合计", "期间与结账状态"],
    source: "Wimoor finance/vouchers/list + ledger/* 报表模式",
    capabilities: ["新增", "审核", "导入", "导出", "打印", "合计行", "状态标签", "高级筛选"],
    related: [{ label: "ERP 费用单", href: "/operations/expenses" }, { label: "税务与发票", href: "/operations/tax" }],
    cache: REPORT_CACHE,
  },
  {
    path: "/operations/purchase-plans", title: "采购计划", group: "采购管理", pattern: "approval",
    description: "按销量与库存缺口推算需求，人工确认后转采购单。",
    bullets: ["需求推算口径", "库存缺口与在途", "转单与确认留痕"],
    source: "Wimoor erp/purchase/plan_amz + 审核工作台模式",
    capabilities: ["新增", "审核", "驳回", "批量操作", "导出", "刷新", "状态标签"],
    related: [{ label: "采购订单", href: "/operations?view=purchase-orders" }, { label: "采购发票", href: "/operations/purchase-invoices" }],
    cache: NO_STORE,
  },
  {
    path: "/operations/purchase-invoices", title: "采购发票", group: "采购管理", pattern: "approval",
    description: "采购单 / 收货单 / 发票三单匹配，差异须带理由审批。",
    bullets: ["三单匹配结果", "差异原因与审批", "金额与税额"],
    source: "Wimoor erp/purchase/form + 单据审核模式",
    capabilities: ["新增", "审核", "驳回", "导入", "导出", "合计行", "状态标签"],
    related: [{ label: "采购计划", href: "/operations/purchase-plans" }, { label: "采购协同", href: "/operations/procurement-collab" }],
    cache: NO_STORE,
  },
  {
    path: "/operations/procurement-collab", title: "采购协同", group: "采购管理", pattern: "master-detail",
    description: "请款单、换货单与供应商报价比价，按单据/SKU 双视图核对。",
    bullets: ["请款与换货", "供应商报价比价", "双视图与明细展开"],
    source: "Wimoor erp/purchase/{orders,change} + 主从双视图模式",
    capabilities: ["视图切换", "批量操作", "导出", "详情抽屉", "状态标签"],
    related: [{ label: "采购订单", href: "/operations?view=purchase-orders" }, { label: "供应商档案", href: "/operations?view=suppliers" }],
    cache: NO_STORE,
  },
  {
    path: "/operations/tax", title: "税务与发票", group: "财务、结算与税务", pattern: "report",
    description: "VAT/GST 发票台账与申报期归集、申报留痕。",
    bullets: ["发票台账", "申报期归集", "税额汇总与合计"],
    source: "Wimoor finance/ledger/invoice + 统计报表模式",
    capabilities: ["导出", "合计行", "高级筛选", "刷新", "状态标签"],
    related: [{ label: "ERP 总账", href: "/operations/finance-ledger" }, { label: "结算报告", href: "/operations?view=settlements" }],
    cache: REPORT_CACHE,
  },
  {
    path: "/operations/assembly", title: "组装", group: "仓库管理", pattern: "entry",
    description: "BOM 定义组合商品，组装完成扣组件、产成品并滚动成本。",
    bullets: ["BOM 与组件明细", "组装单与子表", "成本滚动与合计"],
    source: "Wimoor erp/assembly + 单据录入页模式",
    capabilities: ["新增", "导入", "下载模板", "导出", "合计行", "详情抽屉"],
    related: [{ label: "仓库工作台", href: "/logistics/warehouse?tab=warehouses" }, { label: "库存浏览", href: "/operations?view=inventory" }],
    cache: NO_STORE,
  },
  {
    path: "/operations/calculators", title: "计算器中心", group: "运营工具", pattern: "utility",
    description: "FBA 费用与利润测算，含保本价反算与方案快照。",
    bullets: ["费用与利润参数", "保本价反算", "方案快照对比"],
    source: "Wimoor 计算器/报价试算页模式",
    capabilities: ["试算", "保存快照", "复制", "导出"],
    related: [{ label: "佣金与 FBA 费用预估", href: "/operations?view=fee-estimates" }, { label: "销售利润", href: "/sellfox/performance" }],
    cache: NO_STORE,
  },
  {
    path: "/operations/data-dictionary", title: "数据字典与自定义字段", group: "系统管理", pattern: "master-data",
    description: "枚举字典、自定义字段定义的统一登记，字典结果长缓存并在作用域切换时失效。",
    bullets: ["字典类型与条目", "自定义字段定义", "生效范围与版本"],
    source: "Wimoor sys/dict + useDict 字典缓存模式",
    capabilities: ["新增", "编辑", "删除", "刷新", "列配置", "状态标签"],
    related: [{ label: "系统设置", href: "/settings" }],
    cache: STATIC_CACHE,
  },
  {
    path: "/operations/sales-plans", title: "销售计划与预测", group: "销售管理", pattern: "report",
    description: "按 SKU 拆目标、历史日均预测与实际偏差。",
    bullets: ["目标拆解", "预测与回测", "实际偏差与合计"],
    source: "Wimoor amazon/sales/report + 统计报表模式",
    capabilities: ["导出", "合计行", "高级筛选", "视图切换"],
    related: [{ label: "销售流量日报", href: "/operations?view=sales-traffic" }, { label: "补货计划", href: "/operations?view=replenishment" }],
    cache: REPORT_CACHE,
  },
  {
    path: "/operations/multi-channel", title: "多渠道经营", group: "销售管理", pattern: "master-data",
    description: "eBay / Walmart / Temu / TikTok / Shopify 店铺与订单的统一视图。",
    bullets: ["渠道店铺主档", "跨渠道订单", "渠道状态与口径"],
    source: "Wimoor temu/* + 主数据列表模式",
    capabilities: ["新增", "导入", "导出", "批量操作", "状态标签"],
    related: [{ label: "订单列表", href: "/operations?view=orders" }],
    cache: NO_STORE,
  },
  {
    path: "/operations/repricing", title: "跟卖与调价", group: "销售管理", pattern: "approval",
    description: "跟卖监控、调价规则与人工采纳队列。",
    bullets: ["跟卖监控与告警", "调价规则", "采纳队列与审核"],
    source: "Wimoor amazon/listing/price_adjust + 审核工作台模式",
    capabilities: ["审核", "驳回", "批量操作", "导出", "刷新", "状态标签"],
    related: [{ label: "价格与 Featured Offer", href: "/operations?view=pricing" }],
    cache: NO_STORE,
  },
  {
    path: "/operations/reviews", title: "评论与店铺绩效", group: "销售管理", pattern: "report",
    description: "评论/差评跟踪、处置记录与绩效快照判定，含统计卡与批量处置。",
    bullets: ["评论与差评分层", "处置记录", "绩效快照与统计"],
    source: "Wimoor amazon/order + buyer-messages + 统计报表模式",
    capabilities: ["批量操作", "导出", "合计行", "状态标签", "详情抽屉"],
    related: [{ label: "账户健康", href: "/operations?view=account-health" }],
    cache: REPORT_CACHE,
  },
  {
    path: "/operations/ops-extensions", title: "运营资料与滞销", group: "运营工具", pattern: "report",
    description: "承运商、三方仓主数据与只读库存生成的滞销判定快照。",
    bullets: ["承运商与三方仓主档", "滞销判定口径", "快照与导出"],
    source: "Wimoor erp/thirdparty + 报表模式",
    capabilities: ["导出", "合计行", "刷新", "高级筛选"],
    related: [{ label: "库存浏览", href: "/operations?view=inventory" }, { label: "库龄", href: "/operations?view=inventory_age" }],
    cache: REPORT_CACHE,
  },
  {
    path: "/saihu-search-merge", title: "赛狐搜词合并", group: "数据中心", pattern: "utility",
    description: "搜索词合并工具：上传、解析、合并规则、导出与历史批次。",
    bullets: ["上传与解析", "合并规则与预览", "导出与历史"],
    source: "Wimoor 工具页 + 导入弹窗模式",
    capabilities: ["导入", "下载模板", "导出", "重置", "复制"],
    related: [{ label: "历史记录", href: "/history" }],
    cache: NO_STORE,
  },
  {
    path: "/image-upscale", title: "图片超分", group: "商品管理", pattern: "redirect",
    description: "旧入口，重定向到 /listing-ai 的图片超分 tab；保留面包屑与相关页面便于回溯。",
    bullets: ["旧入口重定向口径", "目标 tab 直达", "来源与缓存说明"],
    source: "Wimoor 路由重定向 + 全局外壳模式",
    capabilities: ["刷新", "复制", "视图切换"],
    related: [{ label: "Listing AI", href: "/listing-ai?tab=image-upscale" }],
    cache: STATIC_CACHE,
  },
  {
    path: "/agents", title: "Amazon AI Agent", group: "其他工作区", pattern: "hub",
    description: "AI Agent 平台入口：市场、选品、商品、供应商、PPC、编排与 Listing 智能体。",
    bullets: ["智能体目录与状态", "执行记录与交接", "权限与工具网关"],
    source: "Wimoor 无对应（Next.js 版新增能力）",
    capabilities: ["刷新", "复制", "权限校验"],
    related: [{ label: "编排智能体", href: "/agents/orchestrator" }, { label: "粒粒技能中心", href: "/lili" }],
    cache: STATIC_CACHE,
  },
  {
    path: "/agents/listing", title: "刊登 Agent", group: "其他工作区", pattern: "agent",
    description: "Amazon Listing 关键词图谱、标题、要点、描述、A+ 简报与草稿审批。",
    bullets: ["关键词图谱与文案生成", "A+ 简报", "草稿审批链路"],
    source: "Wimoor amazon/listing + 审核工作台模式",
    capabilities: ["试算", "审核", "驳回", "保存快照", "详情抽屉", "复制", "刷新", "导出"],
    related: [{ label: "Listing AI", href: "/listing-ai" }, { label: "智能体首页", href: "/agents" }],
    cache: NO_STORE,
  },
  {
    path: "/agents/market", title: "市场 Agent", group: "其他工作区", pattern: "agent",
    description: "Amazon 市场机会发现、证据聚合、机会评分与项目审批。",
    bullets: ["机会发现与证据聚合", "机会评分", "项目审批"],
    source: "Wimoor amazon/product 选品调研 + 审核工作台模式",
    capabilities: ["试算", "审核", "驳回", "高级筛选", "详情抽屉", "刷新", "导出"],
    related: [{ label: "选品证据补全", href: "/agents/market/selection" }, { label: "Agent 编排器", href: "/agents/orchestrator" }],
    cache: NO_STORE,
  },
  {
    path: "/agents/market/selection", title: "选品证据补全", group: "其他工作区", pattern: "entry",
    description: "补齐低星评论与 1688 供应线索，重建 quality 后再决定上传或建 SKU。",
    bullets: ["低星评论证据", "1688 供应线索", "quality 重算与提交"],
    source: "Wimoor 单据录入页 + 主从双视图模式",
    capabilities: ["编辑", "新增", "试算", "刷新", "复制", "详情抽屉"],
    related: [{ label: "市场 Agent", href: "/agents/market" }, { label: "本地 AI 选品研究", href: "/agents/selection-research" }],
    cache: NO_STORE,
  },
  {
    path: "/agents/orchestrator", title: "Agent 编排器", group: "其他工作区", pattern: "hub",
    description: "串联市场、产品、供应、刊登、上架与 PPC 的统一编排中心，查看链路与交接状态。",
    bullets: ["多智能体链路编排", "任务交接与状态", "执行记录"],
    source: "Wimoor 全局外壳 + 主从双视图模式",
    capabilities: ["试算", "刷新", "视图切换", "状态标签", "详情抽屉", "复制"],
    related: [{ label: "智能体首页", href: "/agents" }, { label: "PPC 广告 Agent", href: "/agents/ppc" }],
    cache: NO_STORE,
  },
  {
    path: "/agents/ppc", title: "PPC 广告 Agent", group: "广告管理", pattern: "agent",
    description: "Amazon Ads、SellerSprite、历史 PPC 与商品数据驱动的诊断和审批建议。",
    bullets: ["广告指标诊断", "优化建议生成", "建议审批与采纳"],
    source: "Wimoor amazon/advertisement/manager + 审核工作台模式",
    capabilities: ["试算", "审核", "驳回", "批量操作", "导出", "详情抽屉", "刷新", "保存快照"],
    related: [{ label: "Amazon Ads", href: "/amazon-ads/campaigns" }, { label: "PPC 经营指标", href: "/operations?view=ads" }],
    cache: NO_STORE,
  },
  {
    path: "/agents/product", title: "产品 Agent", group: "商品管理", pattern: "agent",
    description: "Amazon 产品规划、PRD、成本目标与项目草案生成。",
    bullets: ["产品规划与 PRD", "成本目标", "项目草案"],
    source: "Wimoor 单据录入页 + 详情抽屉模式",
    capabilities: ["新增", "编辑", "试算", "保存快照", "详情抽屉", "复制", "刷新"],
    related: [{ label: "供应 Agent", href: "/agents/supplier" }, { label: "商品工作台", href: "/operations?view=catalog" }],
    cache: NO_STORE,
  },
  {
    path: "/agents/selection-research", title: "本地 AI 选品研究", group: "其他工作区", pattern: "approval",
    description: "五阶段流程、两次人工确认、证据可追溯的本地选品研究工作区。",
    bullets: ["五阶段研究流程", "两次人工确认", "证据追溯与产物"],
    source: "Wimoor 审核工作台 + 单据录入页模式",
    capabilities: ["新增", "审核", "驳回", "高级筛选", "详情抽屉", "导出", "刷新"],
    related: [{ label: "市场 Agent", href: "/agents/market" }, { label: "选品证据补全", href: "/agents/market/selection" }],
    cache: NO_STORE,
  },
  {
    path: "/agents/supplier", title: "供应 Agent", group: "采购管理", pattern: "agent",
    description: "Amazon 供应商推荐、报价分析、RFQ 草稿与采购项目生成。",
    bullets: ["供应商推荐", "报价对比分析", "RFQ 草稿与采购项目"],
    source: "Wimoor erp/purchase + 单据录入页模式",
    capabilities: ["新增", "编辑", "试算", "导出", "详情抽屉", "刷新", "保存快照"],
    related: [{ label: "供应商主档", href: "/operations?view=suppliers" }, { label: "产品 Agent", href: "/agents/product" }],
    cache: NO_STORE,
  },
  {
    path: "/agents/*", title: "智能体工作台", group: "其他工作区", pattern: "agent",
    description: "单个 AI Agent 的执行工作台：输入、工具调用链、执行记录与结果产物。",
    bullets: ["执行输入与参数", "工具调用链", "产物与执行历史"],
    source: "Wimoor 无对应（Next.js 版新增能力）",
    capabilities: ["试算", "复制", "刷新", "详情抽屉", "保存快照"],
    related: [{ label: "智能体首页", href: "/agents" }],
    cache: NO_STORE,
  },
  {
    path: "/sellfox", title: "赛狐数据中台", group: "数据中心", pattern: "hub",
    description: "赛狐全量数据域接入进度、同步状态与拉取入口；按 domain 切换八个数据域。",
    bullets: ["数据域接入进度", "同步状态与日志", "筛选、排序、导出与列配置"],
    source: "Wimoor 全局外壳 + GlobalTable 列表模式",
    capabilities: ["同步", "刷新", "重置", "高级筛选", "导出", "列配置", "合计行", "详情抽屉", "状态标签"],
    related: [{ label: "销量统计", href: "/sellfox/sales" }, { label: "销售利润", href: "/sellfox/performance" }, { label: "同步日志", href: "/sellfox?domain=runs" }],
    viewParam: "domain",
    views: {
      overview: { title: "概览" }, stores: { title: "店铺" }, inventory: { title: "库存" },
      sales: { title: "销量", pattern: "report" }, performance: { title: "销售利润", pattern: "report" },
      listings: { title: "在线商品", pattern: "master-data" }, ads: { title: "广告", pattern: "report" },
      runs: { title: "同步日志", pattern: "document" },
    },
    cache: NO_STORE,
  },
  {
    path: "/sellfox/listings", title: "在线产品", group: "数据中心", pattern: "master-data",
    description: "销售 → 在线产品。读取本地 SellfoxListingSnapshot，支持筛选、分页与详情核对。",
    bullets: ["在线商品主档", "站点/店铺/ASIN 筛选", "快照来源与详情"],
    source: "Wimoor GlobalTable 主数据列表页",
    capabilities: ["刷新", "重置", "高级筛选", "导出", "列配置", "详情抽屉", "状态标签"],
    related: [{ label: "赛狐数据中台", href: "/sellfox" }, { label: "销量统计", href: "/sellfox/sales" }],
    cache: NO_STORE,
  },
  {
    path: "/sellfox/orders", title: "全部订单", group: "数据中心", pattern: "document",
    description: "订单 → 全部订单。按订单行读取已同步的赛狐订单快照。",
    bullets: ["订单行明细", "状态与时间筛选", "合计行与导出"],
    source: "Wimoor amazon/order 单据列表页",
    capabilities: ["刷新", "重置", "高级筛选", "导出", "合计行", "详情抽屉", "状态标签"],
    related: [{ label: "赛狐数据中台", href: "/sellfox" }, { label: "货件", href: "/sellfox/shipments" }],
    cache: REPORT_CACHE,
  },
  {
    path: "/sellfox/performance", title: "销售利润", group: "数据中心", pattern: "report",
    description: "数据 → 销售利润。读取本地 SellfoxProductDailySnapshot，按商品/日维度核算利润。",
    bullets: ["收入、成本与利润", "维度切换与日期区间", "汇总与合计行"],
    source: "Wimoor 统计报表页（多级表头 + 合计行）",
    capabilities: ["刷新", "重置", "高级筛选", "导出", "列配置", "合计行", "视图切换"],
    related: [{ label: "销量统计", href: "/sellfox/sales" }, { label: "赛狐数据中台", href: "/sellfox?domain=performance" }],
    cache: REPORT_CACHE,
  },
  {
    path: "/sellfox/restock", title: "补货建议", group: "数据中心", pattern: "report",
    description: "FBA → 补货建议。基于本地商品、销量与货件快照计算，只读展示、不写入补货表。",
    bullets: ["补货量与建议天数", "销量与在途口径", "只读快照说明"],
    source: "Wimoor erp/replenishment + 统计报表页",
    capabilities: ["刷新", "重置", "高级筛选", "导出", "合计行", "详情抽屉"],
    related: [{ label: "货件", href: "/sellfox/shipments" }, { label: "库存浏览", href: "/operations?view=inventory" }],
    cache: REPORT_CACHE,
  },
  {
    path: "/sellfox/sales", title: "销量统计", group: "数据中心", pattern: "report",
    description: "数据 → 销量统计。读取本地 SellfoxSalesDailySnapshot，按日/商品/店铺汇总销量。",
    bullets: ["销量与销售额趋势", "日期区间与维度", "多级表头与合计行"],
    source: "Wimoor 统计报表页（维度 tabs + 合计行）",
    capabilities: ["刷新", "重置", "高级筛选", "导出", "列配置", "合计行", "视图切换"],
    related: [{ label: "销售利润", href: "/sellfox/performance" }, { label: "赛狐数据中台", href: "/sellfox?domain=sales" }],
    cache: REPORT_CACHE,
  },
  {
    path: "/sellfox/shipments", title: "货件", group: "数据中心", pattern: "document",
    description: "FBA → 货件。按货件行读取最近一次完整采集的赛狐货件快照。",
    bullets: ["货件行明细", "采集批次与完整性", "状态标签与导出"],
    source: "Wimoor erp/shipplan 单据列表页",
    capabilities: ["刷新", "重置", "高级筛选", "导出", "详情抽屉", "状态标签"],
    related: [{ label: "补货建议", href: "/sellfox/restock" }, { label: "全部订单", href: "/sellfox/orders" }],
    cache: NO_STORE,
  },
  {
    path: "/sellfox/*", title: "赛狐数据域", group: "数据中心", pattern: "report",
    description: "赛狐单数据域的明细浏览：筛选、排序、分页、列配置与导出，筛选条件写回 URL 可分享。",
    bullets: ["多维筛选与日期区间", "服务端排序与分页", "合计行与列配置"],
    source: "Wimoor GlobalTable + 统计报表模式",
    capabilities: ["刷新", "重置", "高级筛选", "导出", "列配置", "合计行", "详情抽屉"],
    related: [{ label: "赛狐数据中台", href: "/sellfox" }],
    cache: NO_STORE,
  },
  {
    path: "/amazon-ads/*", title: "Amazon Ads", group: "广告管理", pattern: "master-detail",
    description: "SP/SB/SD 广告活动、报表采集与批量优化；独立鉴权与权限校验。",
    bullets: ["广告活动与指标网格", "报表采集任务", "批量调整与提案"],
    source: "Wimoor amazon/advertisement/manager + 审核工作台模式",
    capabilities: ["新增", "批量操作", "导出", "同步", "列配置", "视图切换", "状态标签", "权限校验"],
    related: [{ label: "PPC Bulk 优化", href: "/workspace" }, { label: "PPC 经营指标", href: "/operations?view=ads" }],
    cache: NO_STORE,
  },
  {
    path: "/lili/*", title: "粒粒 Lili 技能中心", group: "其他工作区", pattern: "utility",
    description: "技能目录、工作流与工具文档；按 locale 与权限过滤可访问内容，force-dynamic 保证实时。",
    bullets: ["技能与工具目录", "工作流文档", "多语言与权限过滤"],
    source: "Wimoor sys/deepseek + 文档页模式",
    capabilities: ["复制", "刷新", "权限校验"],
    related: [{ label: "智能体首页", href: "/agents" }],
    cache: REALTIME_CACHE,
  },
  {
    path: "/help", title: "帮助中心", group: "系统管理", pattern: "hub",
    description: "一级模块索引、二级功能定位与全站快捷键说明；导航改造后的对照入口。",
    bullets: ["十一大业务模块索引", "二级功能直达链接", "快捷键与导航使用说明"],
    source: "导航信息架构升级（一级模块 + 二级功能菜单）配套页面",
    capabilities: ["刷新", "复制"],
    related: [{ label: "工作台首页", href: "/" }, { label: "系统设置", href: "/settings" }],
    cache: STATIC_CACHE,
  },
];

/** 按 pathname 解析页面元信息：精确匹配优先，其次最长前缀通配。 */
export function resolvePageMeta(pathname: string): PageMeta | null {
  const path = pathname === "" ? "/" : pathname.replace(/\/+$/, "") || "/";
  const exact = PAGE_META.find((item) => item.path === path);
  if (exact) return exact;
  let best: PageMeta | null = null;
  for (const item of PAGE_META) {
    if (!item.path.endsWith("*")) continue;
    const prefix = item.path.slice(0, -1).replace(/\/+$/, "");
    if ((path === prefix || path.startsWith(`${prefix}/`)) && (!best || prefix.length > best.path.length - 1)) {
      best = item;
    }
  }
  return best;
}

/** 供验收清单使用：统计被纳入改造的页面数。 */
export function auditedPageCount(): number {
  return PAGE_META.filter((item) => !item.skipFrame).length;
}

export const PAGE_PATTERN_LABELS: Record<PagePattern, string> = {
  "master-data": "主数据列表页",
  document: "单据列表页",
  entry: "单据录入页",
  approval: "审核工作台",
  report: "统计报表页",
  detail: "详情抽屉页",
  "master-detail": "主从双视图页",
  dashboard: "看板驾驶舱",
  settings: "分区设置页",
  hub: "导航中台页",
  agent: "AI Agent 工作台",
  utility: "工具页",
  redirect: "重定向页",
};
