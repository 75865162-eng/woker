/**
 * Unified read-only integration resource catalog.
 *
 * Aggregates EXISTING static contracts only (no network, no credential use, no
 * DB writes). Used by the setup wizard / role probing and by the MCP dataset
 * directory so the UI can truthfully show "syncable / not implemented / needs
 * role" and the official windows — without promising history the APIs don't offer.
 */
import { syncDomains, type SyncDomainPlan } from "@/lib/amazon-sync/policy";
import { listAdsCapabilities, adsCapabilityBlockers, type AdsCapability } from "@/lib/amazon-ads/capabilities";
import { sellfoxPlanGroups } from "@/lib/sellfox/data-plan";
import { getSellfoxWindowConfig, describeSellfoxResourceWindow, type SellfoxWindowResource } from "@/lib/sellfox/window-config";
import { sellfoxDatasets } from "@/lib/sellfox/mcp-tool-registry";

export type ResourceAvailability = "available" | "not_implemented" | "needs_role" | "blocked";
export type CatalogResource = {
  provider: "sellfox" | "amazon_sp_api" | "amazon_ads";
  id: string;
  label: string;
  group: string;
  availability: ResourceAvailability;
  window: string;
  roleRequirement: string;
  reasons: string[];
  api: string[];
};

const spWindowById: Record<string, string> = {
  orders: "最多 730 天增量回溯", finance: "最多 730 天增量回溯",
  inventory_events: "单次最多 31 天、最近 540 天",
  fba_inventory_report: "当前快照，不支持历史回补",
  fba_fulfilled_inventory: "当前快照，不支持历史回补",
  inventory: "当前快照，不支持历史回补",
  catalog: "当前快照", pricing: "当前快照",
};

function spAvailability(domain: SyncDomainPlan): ResourceAvailability {
  if (!domain.implemented) return "not_implemented";
  if (domain.authorization === "pending") return "needs_role";
  return "available";
}
function adsAvailability(row: AdsCapability): ResourceAvailability {
  if (row.read === "NOT_IMPLEMENTED" || row.acquisition === "NONE") return "not_implemented";
  if (row.liveAcceptance === "NOT_VERIFIED" || row.accountPermission === "REQUIRES_PROFILE_CHECK") return "needs_role";
  return "available";
}

export function getIntegrationCatalog(): { resources: CatalogResource[]; sellfoxWindows: ReturnType<typeof getSellfoxWindowConfig> } {
  const resources: CatalogResource[] = [];

  for (const group of sellfoxPlanGroups) {
    for (const item of group.items) {
      const availability: ResourceAvailability = item.status === "live" ? "available" : item.status === "blocked" ? "blocked" : "not_implemented";
      const resourceId = item.resource ?? item.id;
      const window = item.resource ? describeSellfoxResourceWindow(item.resource as SellfoxWindowResource) : "按接口约定";
      resources.push({
        provider: "sellfox", id: item.id, label: item.label, group: group.label,
        availability, window,
        roleRequirement: availability === "blocked" ? "需在赛狐后台开通接口权限" : "赛狐 API 凭证",
        reasons: [item.note ?? (item.status === "planned" ? "文档已确认，采集/落表待实现" : item.status === "blocked" ? "平台侧权限未开通" : "")].filter(Boolean),
        api: item.api,
      });
    }
  }

  for (const item of syncDomains) {
    const domain: SyncDomainPlan = item;
    resources.push({
      provider: "amazon_sp_api", id: domain.id, label: domain.name, group: domain.group,
      availability: spAvailability(domain),
      window: spWindowById[domain.id] ?? (domain.mode === "snapshot" ? "当前快照" : "按官方增量窗口"),
      roleRequirement: domain.authorization === "verified" ? "已验证角色" : domain.authorization === "separate" ? "独立 OAuth 授权" : "需在 Seller Central 开通受限角色",
      reasons: [domain.nextStep].filter(Boolean),
      api: [domain.api],
    });
  }

  for (const row of listAdsCapabilities()) {
    resources.push({
      provider: "amazon_ads", id: `${row.product.toLowerCase()}-${row.domain}`, label: `${row.product} · ${row.domain}`, group: `Amazon Ads ${row.product}`,
      availability: adsAvailability(row),
      window: row.limitations.find(text => /天|保留|快照/.test(text)) ?? "按官方报表窗口",
      roleRequirement: "需在 Amazon Ads 后台开通对应 Profile 报表权限",
      reasons: [...adsCapabilityBlockers(row), ...row.limitations],
      api: [...row.endpoints],
    });
  }

  return { resources, sellfoxWindows: getSellfoxWindowConfig() };
}

export type McpDatasetEntry = {
  provider: "sellfox";
  key: string;
  table: string;
  label: string;
  available: boolean;
  reason: string;
  grain: string;
  /** Money is returned per row with its own currency; never summed across currencies. */
  currencyWarning: string | null;
};

/**
 * Sellfox MCP dataset directory with an explicit `available` flag and a
 * currency warning on money-bearing datasets, matching the way the Amazon
 * `ads_report_daily` dataset is annotated in skill-data.ts.
 * Grain/columns come from the existing allow-list registry; no new query path.
 */
export function getMcpDatasetCatalog(): { sellfox: McpDatasetEntry[] } {
  const moneyHints = ["revenue", "cost", "price", "amount", "profit", "sales", "fee", "spend", "budget"];
  const sellfox = Object.values(sellfoxDatasets).map(dataset => {
    const moneyColumns = dataset.columns.filter(column => moneyHints.some(hint => column.toLowerCase().includes(hint)));
    return {
      provider: "sellfox" as const,
      key: dataset.key,
      table: dataset.table,
      label: dataset.label,
      available: true,
      reason: dataset.description || "已落库并注册只读白名单",
      grain: dataset.storeColumn ? `按店铺（${dataset.storeColumn}）· ${dataset.dateField}` : dataset.dateField,
      currencyWarning: moneyColumns.length
        ? "金额按行返回并保留原币种，禁止跨币种汇总；展示值由服务端转换，不参与运算。"
        : null,
    };
  });
  return { sellfox };
}
