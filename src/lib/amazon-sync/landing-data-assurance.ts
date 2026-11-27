/**
 * 落地页数据保障框架（Landing Data Assurance）。
 *
 * 目标：把"人工逐页 retry / 热修"升级为可无人值守的自动闭环。以
 * `AMAZON_PAGE_MAP`（WIMOOR 迁移页 → 数据集）为唯一输入源，复用现有已验证的
 * 同步底座，不造数、不绕过审批、不削弱权限：
 *
 *   1) 扫描 SCAN —— 每个页面 → dataset → resource，对 scope 下每个
 *      (sellerAccountId, marketplaceId) 用与页面完全相同的 readDataset 口径读取，
 *      输出每页数据健康分类；
 *   2) 补采 RECONCILE —— 对"有数据源但未发布/失败"的源，经受控变更审批链
 *      (requestChange/approve/apply) 触发 run 或 retry，回到 worker 自动发布；
 *   3) 复验 VERIFY —— 再次扫描，确认从"无数据"变为"有数据"。
 *
 * 分类（LandingDataState）：
 *   - HAS_DATA         页面可读取到 >=1 行（验收通过）
 *   - NO_SOURCE        该站点没有 enabled 数据源（需先建源/授权，不造数）
 *   - AUTH_INVALID     授权未 CONFIGURED/未验证（需重新连接，不造数）
 *   - NOT_PUBLISHED    源已就绪但 activeRunId 为空（从未成功发布 → 可自动补采）
 *   - FAILED_RUN       最近任务失败/阻断且未发布（可自动补采）
 *   - SYNCING          有活动任务在跑（等待即可，不重复触发）
 *   - FIELD_MISMATCH   取数协议字段不匹配（代码缺陷，需修复映射）
 *   - EMPTY_PUBLISHED  源已发布但报告本身无行（业务空，不造数）
 *   - ERROR            其它异常（如实记录，不吞掉）
 *
 * 该模块只依赖数据库与既有服务函数，供 CLI/脚本在服务端 owner 身份下调用。
 */
import { prisma } from "@/lib/db/prisma";
import type { Prisma } from "@prisma/client";
import { AMAZON_PAGE_MAP, type AmazonPageMapping } from "@/lib/wimoor-migration/page-dataset-map";
import { datasetForTable } from "./mcp-datasets";
import { readDataset } from "./dataset-query";
import { SyncInputError, type SyncScope } from "./policy";
import { activeTaskStatuses } from "./policy";
import { AmazonReadError } from "./read-account";
import { McpDatasetError } from "./mcp-datasets";

export type LandingDataState =
  | "HAS_DATA"
  | "NO_SOURCE"
  | "AUTH_INVALID"
  | "NOT_PUBLISHED"
  | "FAILED_RUN"
  | "SYNCING"
  | "FIELD_MISMATCH"
  | "EMPTY_PUBLISHED"
  | "ERROR";

export type SiteDataResult = {
  sellerAccountId: string;
  marketplaceId: string;
  sourceId: string | null;
  state: LandingDataState;
  rowCount: number;
  activeRunId: string | null;
  lastRunStatus: string | null;
  detail: string;
};

export type PageDataHealth = {
  href: string;
  name: string;
  dataset: string;
  resource: string;
  state: LandingDataState;
  totalRows: number;
  sites: SiteDataResult[];
  /** 可自动补采的源 ID（state=NOT_PUBLISHED/FAILED_RUN）。 */
  reconcilableSourceIds: string[];
};

export type ScanSummary = {
  scope: SyncScope;
  actor: string;
  scannedAt: string;
  totalPages: number;
  stateCounts: Partial<Record<LandingDataState, number>>;
  pages: PageDataHealth[];
};

type SourceRow = {
  id: string;
  sellerAccountId: string;
  marketplaceId: string;
  enabled: boolean;
  activeRunId: string | null;
  authorization: { status: string; identityVerifiedAt: Date | null };
  latestRun: { id: string; status: string } | null;
};

const PRIORITY: Record<LandingDataState, number> = {
  HAS_DATA: 0,
  EMPTY_PUBLISHED: 1,
  SYNCING: 2,
  NOT_PUBLISHED: 3,
  FAILED_RUN: 4,
  NO_SOURCE: 5,
  AUTH_INVALID: 6,
  FIELD_MISMATCH: 7,
  ERROR: 8,
};

/** 页面整体状态 = 所有站点中最差但最有"行动意义"的状态；有数据即验收通过。 */
function aggregateState(states: LandingDataState[]): LandingDataState {
  if (!states.length) return "NO_SOURCE";
  if (states.includes("HAS_DATA")) return "HAS_DATA";
  return states.reduce((worst, s) => PRIORITY[s] > PRIORITY[worst] ? s : worst, states[0]);
}

/** 解析页面映射的 dataset → resource；未知 dataset 视为字段映射缺陷。 */
export function resourceForDataset(dataset: string): string {
  return datasetForTable(dataset).resource;
}

/** 读取 scope 下该 resource 的已配置数据源（含最近一次 run）。 */
async function sourcesForResource(scope: SyncScope, resource: string): Promise<SourceRow[]> {
  const sources = await prisma.amazonSyncDataSource.findMany({
    where: { ...scope, resource },
    include: {
      authorization: { select: { status: true, identityVerifiedAt: true } },
      runs: { orderBy: [{ startedAt: "desc" }, { id: "desc" }], take: 1, select: { id: true, status: true } },
    },
    orderBy: [{ sellerAccountId: "asc" }, { marketplaceId: "asc" }],
    take: 201,
  });
  return sources.map(s => ({
    id: s.id, sellerAccountId: s.sellerAccountId, marketplaceId: s.marketplaceId, enabled: s.enabled,
    activeRunId: s.activeRunId,
    authorization: { status: s.authorization.status, identityVerifiedAt: s.authorization.identityVerifiedAt },
    latestRun: s.runs[0] ?? null,
  }));
}

/** 用页面同口径 readDataset 读取单个 (dataset, seller, marketplace) 的行数。 */
async function readRowCount(
  scope: SyncScope,
  actor: string,
  dataset: string,
  sellerAccountId: string,
  marketplaceId: string,
  pin: Record<string, string> | undefined,
): Promise<{ rowCount: number }> {
  const params = new URLSearchParams({
    table: dataset, // 与页面工作台 / readDataset 同口径：协议 key 是 table，不是 dataset
    sellerAccountId,
    marketplaceId,
    page: "1",
    pageSize: "1", // 只需判断"有没有数据"，取一页最小成本
  });
  // pin 固定口径；原样透传，仍禁止未知 query key。
  // fromOffsetDays 是页面客户端日期偏移参数（工作台本地换算，非数据集协议字段），
  // 与页面工作台保持一致绝不发给 readDataset，否则触发 FIELD_NOT_MAPPED。
  for (const [key, value] of Object.entries(pin ?? {})) {
    if (key === "fromOffsetDays") continue;
    params.set(key, value);
  }
  const result = await readDataset(scope, params, actor) as unknown as { data?: { total?: number; items?: unknown[] } };
  const total = result?.data?.total;
  const rowCount = typeof total === "number" ? total : Array.isArray(result?.data?.items) ? result.data.items.length : 0;
  return { rowCount };
}

/** 扫描单页：返回该页下每个站点的健康度与可补采源。 */
export async function scanPage(
  scope: SyncScope,
  actor: string,
  href: string,
  mapping: AmazonPageMapping,
): Promise<PageDataHealth> {
  let resource: string;
  try {
    resource = resourceForDataset(mapping.dataset);
  } catch {
    return {
      href, name: mapping.name, dataset: mapping.dataset, resource: "<unresolved>",
      state: "FIELD_MISMATCH", totalRows: 0, sites: [], reconcilableSourceIds: [],
    };
  }
  const sources = await sourcesForResource(scope, resource);
  const sites: SiteDataResult[] = [];
  const reconcilableSourceIds: string[] = [];

  // 站点集合 = 已有数据源覆盖的站点（含被禁用的，便于诊断 NO_SOURCE）。
  for (const source of sources) {
    const base = { sellerAccountId: source.sellerAccountId, marketplaceId: source.marketplaceId, sourceId: source.id, activeRunId: source.activeRunId, lastRunStatus: source.latestRun?.status ?? null };
    if (source.authorization.status !== "CONFIGURED" || !source.authorization.identityVerifiedAt) {
      sites.push({ ...base, state: "AUTH_INVALID", rowCount: 0, detail: "Amazon 授权未配置或未验证，需重新连接（不造数）。" });
      continue;
    }
    if (!source.enabled) {
      sites.push({ ...base, state: "NO_SOURCE", rowCount: 0, detail: "数据源已禁用，需启用后再采集。" });
      continue;
    }
    // 有活动任务在跑只作为提示：若已有 activeRunId 已发布版本，仍按已发布数据读取，
    // 不能因为有新任务在跑就把页面误判为空（orders 常驻增量任务即属此例）。
    const syncing = activeTaskStatuses.includes(source.latestRun?.status ?? "");
    if (!source.activeRunId) {
      const failed = source.latestRun && ["FAILED", "BLOCKED", "PARTIAL_SUCCESS", "CANCELLED"].includes(source.latestRun.status);
      const state: LandingDataState = failed ? "FAILED_RUN" : "NOT_PUBLISHED";
      sites.push({ ...base, state, rowCount: 0, detail: failed ? `最近任务 ${source.latestRun?.status}，尚无已发布版本，可自动补采。` : "尚无已发布版本，可自动补采。" });
      reconcilableSourceIds.push(source.id); // 无已发布数据，读取必然异常，直接入补采候选，避免走 readDataset 抛错
      continue;
    }
    try {
      const { rowCount } = await readRowCount(scope, actor, mapping.dataset, source.sellerAccountId, source.marketplaceId, mapping.pin);
      const syncNote = syncing ? `（另有任务 ${source.latestRun?.status}，不影响已发布数据）` : "";
      sites.push({ ...base, state: rowCount > 0 ? "HAS_DATA" : "EMPTY_PUBLISHED", rowCount, detail: rowCount > 0 ? `已发布可读 ${rowCount} 行${syncNote}。` : `源已发布但当前站点无匹配行（业务空，不造数）${syncNote}。` });
    } catch (error) {
      if (error instanceof McpDatasetError || (error instanceof SyncInputError && /FIELD_NOT_MAPPED|SCHEMA_UNVERIFIED|TABLE_NOT_ALLOWED/.test((error as { code?: string }).code ?? ""))) {
        sites.push({ ...base, state: "FIELD_MISMATCH", rowCount: 0, detail: `取数协议字段不匹配：${error instanceof Error ? error.message : String(error)}` });
      } else if (error instanceof AmazonReadError) {
        sites.push({ ...base, state: "AUTH_INVALID", rowCount: 0, detail: error.message });
      } else {
        sites.push({ ...base, state: "ERROR", rowCount: 0, detail: error instanceof Error ? error.message.slice(0, 200) : String(error) });
      }
    }
  }

  if (!sources.length) {
    sites.push({ sellerAccountId: "*", marketplaceId: "*", sourceId: null, state: "NO_SOURCE", rowCount: 0, activeRunId: null, lastRunStatus: null, detail: "该 resource 在当前 scope 下没有任何数据源（需先完成授权/建源）。" });
  }

  return {
    href, name: mapping.name, dataset: mapping.dataset, resource,
    state: aggregateState(sites.map(s => s.state)),
    totalRows: sites.reduce((sum, s) => sum + s.rowCount, 0),
    sites,
    reconcilableSourceIds,
  };
}

/** 扫描全部迁移落地页。 */
export async function scanAllPages(scope: SyncScope, actor: string, onlyHrefs?: string[]): Promise<ScanSummary> {
  const entries = Object.entries(AMAZON_PAGE_MAP).filter(([href]) => !onlyHrefs?.length || onlyHrefs.includes(href));
  const pages: PageDataHealth[] = [];
  for (const [href, mapping] of entries) pages.push(await scanPage(scope, actor, href, mapping));
  const stateCounts: Partial<Record<LandingDataState, number>> = {};
  for (const page of pages) stateCounts[page.state] = (stateCounts[page.state] ?? 0) + 1;
  return { scope, actor, scannedAt: new Date().toISOString(), totalPages: pages.length, stateCounts, pages };
}

/** 汇总所有页面的可补采源（按 sourceId 去重），供编排器批量补采。 */
export function collectReconcilableSourceIds(scan: ScanSummary): string[] {
  return [...new Set(scan.pages.flatMap(p => p.reconcilableSourceIds))];
}

/** 扫描结果的可读文本（CLI 输出）。 */
export function formatScanSummary(scan: ScanSummary): string {
  const lines: string[] = [];
  lines.push(`# 落地页数据健康扫描 ${scan.scannedAt}`);
  lines.push(`scope=${scan.scope.organizationId}/${scan.scope.workspaceId} actor=${scan.actor} 页面=${scan.totalPages}`);
  lines.push("");
  lines.push("| 页面 | 数据集 | 状态 | 行数 | 可补采源 |");
  lines.push("| --- | --- | --- | ---: | --- |");
  for (const p of scan.pages) {
    lines.push(`| ${p.name} \`${p.href}\` | ${p.dataset} | ${p.state} | ${p.totalRows} | ${p.reconcilableSourceIds.length} |`);
  }
  lines.push("");
  lines.push(`状态汇总：${Object.entries(scan.stateCounts).map(([k, v]) => `${k}=${v}`).join("  ")}`);
  return lines.join("\n");
}
