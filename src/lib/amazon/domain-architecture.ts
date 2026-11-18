/**
 * Amazon 数据域架构账本（SP-API + Ads API）。
 *
 * 目的：把「可同步的数据域」「对应落地页」「自动同步计划」三件事收敛到单一事实来源，
 * 让部署后无需真实数据即可验证「架构是否已搭好」，真实数据到位后按域逐项验收。
 *
 * 边界（与项目其他只读目录一致）：
 * - 本模块只做静态架构映射与一致性自检，不读凭证、不发网络请求、不写数据库。
 * - `landing` 描述的是「源码中已存在的页面路由」，不是宣称页面已有数据；数据为空时页面明确显示 NEEDS_DATA。
 * - `schedule.registered` 表示适配器已注册，不等于已有真实数据源或已成功采集。
 * - 验收状态永远是操作员用真实账号按 `acceptance` 步骤完成，代码不伪造接通结论。
 */
import { syncDomains, implementedDomain, type SyncDomainPlan } from "../amazon-sync/policy";
import { automaticAdapters } from "../amazon-sync/automatic-adapters";
import { listAdsCapabilities } from "../amazon-ads/capabilities";

export type Provider = "amazon_sp_api" | "amazon_ads";
export type LandingSurface = "workbench" | "sync-matrix" | "ads-workbench" | "none";

export type DomainArchitectureRow = {
  provider: Provider;
  /** 域稳定标识：SP 用 syncDomains id；Ads 用 `${product}:${domain}`. */
  id: string;
  label: string;
  group: string;
  /** 代码能力是否已实现（与 getIntegrationCatalog 的 availability 不混用）。 */
  implemented: boolean;
  /** 该域的落地页；route 为真实存在的 URL，surface 说明承载组件。 */
  landing: { surface: LandingSurface; route: string; note: string };
  /** 自动同步计划：注册状态、默认间隔、调度器、是否需要显式审批/采集对象。 */
  schedule: { registered: boolean; intervalMinutes: number | null; scheduler: string; note: string };
  /** 真实验收前置（来自 policy.nextStep / capabilities.limitations 的摘要）。 */
  acceptance: string;
};

/**
 * SP 域 → 落地页 view 映射。
 * 键必须与 operations-sections.tsx 的 view / sync-center-workbench.tsx 的分发一致。
 * 值分两类：专用 workbench（有业务字段视图）与矩阵概览（只有数据源/任务/快照入口）。
 */
const spLanding: Record<string, { surface: LandingSurface; view: string; note: string }> = {
  catalog: { surface: "workbench", view: "catalog", note: "在线商品：按店铺/站点/SKU 查看商品与库存快照" },
  inventory: { surface: "workbench", view: "inventory", note: "FBA 库存：当前已发布快照浏览" },
  orders: { surface: "workbench", view: "orders", note: "订单工作台：有界列表与窗口进度" },
  finance: { surface: "workbench", view: "finance", note: "财务交易：卖家级交易与质量标记" },
  returns: { surface: "workbench", view: "returns", note: "FBA 仓收退货：按单份已发布报告" },
  sales_traffic: { surface: "workbench", view: "sales-traffic", note: "销售与流量日报：按业务日报告" },
  settlements: { surface: "workbench", view: "settlements", note: "结算报告：发现 + 原始行（归属隔离）" },
  reimbursements: { surface: "workbench", view: "reimbursements", note: "赔偿报告：金额/数量/关联键" },
  inventory_age: { surface: "workbench", view: "inventory_age", note: "库龄快照：分桶逐列展示" },
  inventory_events: { surface: "workbench", view: "inventory_events", note: "Ledger 库存事件：有界日期申请" },
  fulfillment: { surface: "workbench", view: "fulfillment", note: "FBA 在途：计划/货件/商品行" },
  listing_details: { surface: "workbench", view: "listing_details", note: "Listing 完整信息：有界 SKU 观察" },
  catalog_items: { surface: "workbench", view: "catalog_items", note: "商品目录：有界 ASIN 观察" },
  pricing: { surface: "workbench", view: "pricing", note: "价格与 Featured Offer：分段快照" },
  buy_box_history: { surface: "workbench", view: "buy_box_history", note: "Buy Box 历史：单日报告版本" },
  brand_analytics: { surface: "workbench", view: "brand_analytics", note: "品牌分析：五类报告与覆盖" },
  order_items: { surface: "workbench", view: "order-items", note: "订单商品：复用订单详情，非独立数据源" },
  // promotions / notifications 有读能力、自动计划和 MCP/API 读取器，但运营页尚无专用 workbench 分发，
  // 故诚实归到同步矩阵（任务/快照入口），不伪造一个打不开的 view 路由。详见 acceptance 说明。
};

const spMatrixOnlyNote = "同步矩阵中查看数据源、任务与本次快照；报告族行通过 domain-reports 读取器查询已发布行。";

/** 有能力与计划、但尚无专用运营页 workbench 的域：仍可从同步矩阵与只读读取器查看，不伪造路由。 */
const spReaderOnlyNote: Record<string, string> = {
  promotions: "同步矩阵查看任务/快照；已发布促销观察经 observations 读取器（需显式 seller+site）与 MCP 查询，暂无专用运营页视图。",
  notifications: "同步矩阵查看任务/快照；只读订阅发现经 observations 读取器与 MCP 查询，暂无专用运营页视图。",
};

const spSchedulerByMode: Record<string, string> = {
  report: "worker:amazon-sync · domain-report",
  incremental: "worker:amazon-sync · incremental",
  snapshot: "worker:amazon-sync · observation/snapshot",
  date_range: "worker:amazon-sync · report-window",
  external: "worker:amazon-sync · external",
};

const registeredResources = new Set<string>(automaticAdapters.map(adapter => adapter.resource));

function spRow(domain: SyncDomainPlan): DomainArchitectureRow {
  const landingConfig = spLanding[domain.id];
  const landing: DomainArchitectureRow["landing"] = landingConfig
    ? { surface: landingConfig.surface, route: `/operations?view=${landingConfig.view}`, note: landingConfig.note }
    : { surface: "sync-matrix", route: "/operations?view=amazon-sync", note: spReaderOnlyNote[domain.id] ?? spMatrixOnlyNote };
  const registered = registeredResources.has(domain.id);
  const schedule: DomainArchitectureRow["schedule"] = {
    registered,
    intervalMinutes: domain.frequency,
    scheduler: registered ? spSchedulerByMode[domain.mode] ?? "worker:amazon-sync" : "none",
    note: domain.id === "order_items"
      ? "复用 orders 详情，不创建独立采集源"
      : registered ? "自动计划已注册；需绑定数据源并获批后运行" : "无自动计划",
  };
  return {
    provider: "amazon_sp_api",
    id: domain.id,
    label: domain.name,
    group: domain.group,
    implemented: domain.implemented,
    landing,
    schedule,
    acceptance: domain.nextStep,
  };
}

/** Ads 域：只取 SP 产品能力目录（SB/SD 尚无可同步能力，单独在审计里说明）。 */
function adsRows(): DomainArchitectureRow[] {
  return listAdsCapabilities("SP").map(cap => {
    // 与 getIntegrationCatalog.adsAvailability 同口径：代码读适配器已实现即视为「架构已搭好」。
    // acquisition（NONE / FORMAL_LIVE_ADAPTER）表示真实线上采集器验收，属另一维度，不混入能力判断。
    const implemented = cap.read !== "NOT_IMPLEMENTED";
    const isProfile = cap.read === "AUTHORIZATION_FLOW";
    const isReport = cap.read === "REPORT_WORKER";
    const landing: DomainArchitectureRow["landing"] = isProfile
      ? { surface: "ads-workbench", route: "/amazon-ads/accounts", note: "广告账户与授权：Profile 发现、授权与账户连接" }
      : implemented
        ? { surface: "ads-workbench", route: "/amazon-ads", note: "已同步广告数据：结构实体 / 发布日报，按 Profile 查询" }
        : { surface: "none", route: "", note: "能力未实现，无落地页" };
    const schedule: DomainArchitectureRow["schedule"] = isProfile
      ? { registered: false, intervalMinutes: null, scheduler: "authorization-flow", note: "按需授权发现，无定时计划" }
      : isReport
        ? { registered: implemented, intervalMinutes: 1440, scheduler: "worker:amazon-sync · tickAmazonAdsReports", note: "每日报表计划；需 Profile 报表权限与有效授权" }
        : implemented
          ? { registered: true, intervalMinutes: 1440, scheduler: "worker:amazon-sync · tickAmazonAds", note: "每日结构同步计划；需 Profile 授权" }
          : { registered: false, intervalMinutes: null, scheduler: "none", note: "无自动计划（能力未实现）" };
    return {
      provider: "amazon_ads" as const,
      id: `sp:${cap.domain}`,
      label: `SP · ${cap.domain}`,
      group: `Amazon Ads · ${cap.read === "STRUCTURE_WORKER" ? "结构域" : cap.read === "REPORT_WORKER" ? "报表域" : "账户"}`,
      implemented,
      landing,
      schedule,
      acceptance: cap.limitations.join("；") || "需真实 Ads 账号验收",
    };
  });
}

export function getDomainArchitecture(): DomainArchitectureRow[] {
  return [...syncDomains.map(spRow), ...adsRows()];
}

export type ArchitectureAudit = {
  ok: boolean;
  checks: Array<{ id: string; ok: boolean; detail: string }>;
  counts: {
    spDomains: number;
    spImplemented: number;
    spWithWorkbench: number;
    spWithSchedule: number;
    adsCapabilities: number;
    adsImplemented: number;
  };
  gaps: string[];
};

/**
 * 架构自检：在没有任何真实数据的前提下验证三件事是否搭好。
 * 只检查源码级不变量，不读取数据库，不把「待真实数据」误报为失败。
 */
export function auditDomainArchitecture(): ArchitectureAudit {
  const rows = getDomainArchitecture();
  const sp = rows.filter(r => r.provider === "amazon_sp_api");
  const ads = rows.filter(r => r.provider === "amazon_ads");
  const spImplemented = sp.filter(r => r.implemented);
  const adsImplemented = ads.filter(r => r.implemented);
  const checks: ArchitectureAudit["checks"] = [];
  const gaps: string[] = [];

  const noLanding = spImplemented.filter(r => r.landing.surface === "none" || !r.landing.route);
  checks.push({ id: "sp.implemented_has_landing", ok: noLanding.length === 0, detail: noLanding.length ? noLanding.map(r => r.id).join("、") : "全部已实现 SP 域均有落地路由" });
  if (noLanding.length) gaps.push(`SP 已实现域缺落地页：${noLanding.map(r => r.id).join("、")}`);

  const unregistered = spImplemented.filter(r => !r.schedule.registered && r.id !== "order_items");
  checks.push({ id: "sp.implemented_has_schedule", ok: unregistered.length === 0, detail: unregistered.length ? unregistered.map(r => r.id).join("、") : "全部已实现 SP 域均注册自动计划" });
  if (unregistered.length) gaps.push(`SP 已实现域缺自动计划：${unregistered.map(r => r.id).join("、")}`);

  const badView = sp.filter(r => r.landing.surface === "workbench" && !/^\/operations\?view=[\w-]+$/.test(r.landing.route));
  checks.push({ id: "sp.workbench_route_format", ok: badView.length === 0, detail: badView.length ? badView.map(r => `${r.id}=${r.landing.route}`).join("、") : "所有 workbench 路由格式有效" });
  if (badView.length) gaps.push(`SP 落地路由格式无效：${badView.map(r => r.id).join("、")}`);

  const typeMismatch = sp.filter(r => r.implemented && r.id !== "order_items" && !isImplementedDomainType(r.id));
  checks.push({ id: "sp.implemented_domain_type", ok: typeMismatch.length === 0, detail: typeMismatch.length ? typeMismatch.map(r => r.id).join("、") : "ImplementedDomain 类型覆盖全部已实现域" });
  if (typeMismatch.length) gaps.push(`ImplementedDomain 类型缺域：${typeMismatch.map(r => r.id).join("、")}`);

  const adsNoLanding = adsImplemented.filter(r => r.landing.surface === "none" || !r.landing.route);
  checks.push({ id: "ads.implemented_has_landing", ok: adsNoLanding.length === 0, detail: adsNoLanding.length ? adsNoLanding.map(r => r.id).join("、") : "全部已实现 Ads 能力均有落地路由" });
  if (adsNoLanding.length) gaps.push(`Ads 已实现能力缺落地页：${adsNoLanding.map(r => r.id).join("、")}`);

  const adsNoSchedule = adsImplemented.filter(r => !r.schedule.registered && r.schedule.scheduler !== "authorization-flow");
  checks.push({ id: "ads.implemented_has_schedule", ok: adsNoSchedule.length === 0, detail: adsNoSchedule.length ? adsNoSchedule.map(r => r.id).join("、") : "全部已实现 Ads 能力均有计划或为授权流" });
  if (adsNoSchedule.length) gaps.push(`Ads 已实现能力缺计划：${adsNoSchedule.map(r => r.id).join("、")}`);

  return {
    ok: checks.every(c => c.ok),
    checks,
    counts: {
      spDomains: sp.length,
      spImplemented: spImplemented.length,
      spWithWorkbench: spImplemented.filter(r => r.landing.surface === "workbench").length,
      spWithSchedule: spImplemented.filter(r => r.schedule.registered).length,
      adsCapabilities: ads.length,
      adsImplemented: adsImplemented.length,
    },
    gaps,
  };
}

function isImplementedDomainType(id: string): boolean {
  try { implementedDomain(id); return true; } catch { return false; }
}
