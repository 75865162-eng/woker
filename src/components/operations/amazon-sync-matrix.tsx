"use client";
/**
 * Amazon SP-API / Ads API 独立同步矩阵。
 *
 * 设计约束（对齐独立同步中心 UI 设计文档）：
 * - 强隔离：SP 与 Ads 两套数据源、接口、统计视图、矩阵分开，不合并、不共用同一张表。
 * - 只读观察：页面只展示服务端已有证据；缺失数据用「—」或 NEEDS_DATA 表达，不补造零值、百分比或总页数。
 * - 危险操作二次确认；手动同步是补救入口，不替代授权后的自动回填／增量同步。
 * - 统一浮层底座：Dialog / Drawer 复用 overlays.tsx（ESC / 遮罩关闭、busy 锁定）。
 */
import { cloneElement, isValidElement, useCallback, useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from "react";
import { useVisiblePolling } from "@/lib/hooks/use-visible-polling";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, Drawer } from "@/components/ui/overlays";
import { StandardDataTable } from "@/components/ui/table-variants";
import { type DataTableColumn } from "@/components/ui/data-table";
import { getJson } from "@/lib/workspace/get-json";
import { syncDomains, isIncrementalResource } from "@/lib/amazon-sync/policy";
import type { SyncAccess, SyncSourceView, SyncTaskLogView } from "@/lib/amazon-sync/contracts";

const spBase = "/api/operations/sync-center";
const adsBase = "/api/integrations/amazon/ads";
const stamp = (s: string | null | undefined) => s ? new Date(s).toLocaleString("zh-CN", { hour12: false }) : "—";
const day = (s: string | null | undefined) => s ? new Date(s).toISOString().slice(0, 10) : "—";
const domainName = (s: string) => syncDomains.find(d => d.id === s)?.name ?? s;

/** 工作区作用域请求头：与同步中心保持一致。 */
function scopeHeaders() {
  const h = new Headers();
  try { const s = JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") ?? "{}"); h.set("x-workspace-id", s.workspaceId || "default"); } catch { h.set("x-workspace-id", "default"); }
  return h;
}

/** 真实物理表名映射（来自 sp-api-datasets / mcp-datasets 登记）；未登记的数据域不臆造表名。 */
const resourceTable: Record<string, string> = {
  inventory: "AmazonInventorySnapshot", catalog: "AmazonCatalogSnapshot", orders: "AmazonOrderRecord", order_items: "AmazonOrderItemRecord",
  finance: "AmazonFinanceRecord", returns: "AmazonReturnRecord", sales_traffic: "AmazonSalesTrafficSnapshot",
  settlements: "AmazonSyncReportRow", reimbursements: "AmazonSyncReportRow", inventory_age: "AmazonSyncReportRow", inventory_events: "AmazonSyncReportRow",
  promotions: "AmazonDomainObservation", notifications: "AmazonDomainObservation", brand_analytics: "AmazonDomainObservation",
  listing_details: "AmazonCatalogSnapshot", catalog_items: "AmazonCatalogSnapshot", fulfillment: "AmazonDomainObservation", pricing: "AmazonDomainObservation",
};
/** Ads 数据域 → 真实物理表。SP_STRUCTURE 为结构实体，其余报表事实。 */
const adsTable = (dataDomain: string, reportType: string) => {
  if (dataDomain === "SP_STRUCTURE" || dataDomain === "SB_STRUCTURE" || dataDomain === "SD_STRUCTURE") return "AmazonAdsEntityRecord";
  return reportType ? "AmazonAdsReportFact" : "AmazonAdsSyncDomainState";
};

/** 文档状态枚举 → UI tone。严格取自服务端真实 health / status，不推算。 */
function statusInfo(value: string): { label: string; tone: "green" | "red" | "amber" | "blue" | "gray" } {
  if (["FRESH", "SUCCEEDED", "CURRENT", "COMPLETE", "CONFIGURED", "PUBLISHED"].includes(value)) return { label: "成功", tone: "green" };
  if (["FAILED", "BLOCKED", "ERROR", "AUTH_REJECTED", "NO_PERMISSION_OR_INELIGIBLE"].includes(value)) return { label: value === "BLOCKED" ? "权限不足" : "失败", tone: "red" };
  if (["STALE", "PARTIAL_SUCCESS", "PARTIAL", "INCOMPLETE", "PAUSED", "WAITING_FOR_CONFIG"].includes(value)) return { label: value === "PAUSED" ? "已暂停" : "部分／过期", tone: "amber" };
  if (["SYNCING", "RUNNING", "QUEUED", "WAITING", "IN_PROGRESS", "RETRY_WAIT", "WAITING_FOR_ADAPTER"].includes(value)) return { label: "同步中", tone: "blue" };
  if (["NOT_CONFIGURED", "NOT_SYNCED", "MISSING_SOURCE", "PENDING", "AUTHORIZATION_BLOCKED"].includes(value)) return { label: "等待授权／待接入", tone: "gray" };
  return { label: value, tone: "gray" };
}
function StateBadge({ value }: { value: string }) { const info = statusInfo(value); return <Badge tone={info.tone} className="rounded px-1.5 py-0 text-label font-medium">{info.label}</Badge>; }

/** 行内细进度：只用服务端真实计数；无分母时展示不确定态，不臆造百分比。 */
const stageNames: Record<string, string> = { REPORT_CREATING: "报表生成中", REPORT_CREATE: "报表生成中", REPORT_PARSING: "下载解析中", REPORT_PUBLISH: "报表发布中", DOWNLOAD: "下载中", FETCHING: "拉取中", FETCHING_DETAILS: "详情补集中", PAGE_COMMIT: "分页提交中", PERSISTING: "入库中", VERIFY: "校验中" };
function InlineProgress({ stage, pages, rows, pagesTotal }: { stage: string; pages: number; rows: number; pagesTotal?: number | null }) {
  const label = stageNames[stage] ?? (stage || "同步中");
  const pct = pagesTotal && pagesTotal > 0 ? Math.min(100, Math.round(pages / pagesTotal * 100)) : null;
  return <div className="mt-1.5" data-testid="matrix-inline-progress" role="progressbar" aria-label="同步进度" aria-valuetext={`${label}，已处理 ${pages} 页 ${rows} 条`}>
    <div className="h-1 overflow-hidden rounded-full bg-surface"><div className={`h-full rounded-full bg-brand ${pct === null ? "w-1/3 animate-pulse" : ""}`} style={pct === null ? undefined : { width: `${pct}%` }} /></div>
    <span className="mt-0.5 block text-xs text-muted">{label} · {pct === null ? `已处理 ${pages} 页` : `分片 ${pages}/${pagesTotal}`} / {rows} 条</span>
  </div>;
}

/** 前端回溯上限拦截（文档：SP 订单财务 730 天；Ads 搜索词 65 天、其余报表 95 天）。仅对提供日期输入的时序资源生效。 */
const backfillLimitDays: Record<string, number> = { orders: 730, finance: 730, brand_analytics: 65 };
function limitFor(resource: string, apiOrDomain = "") {
  if (resource === "brand_analytics") return 65;
  if (/search.?term/i.test(apiOrDomain) || resource.includes("search")) return 65;
  return backfillLimitDays[resource] ?? 95;
}

type SpCoverageSource = { sourceId: string; resource: string; marketplaceId: string; status: string; published: boolean; visibleRows: number; history: { applicable: boolean; percent: number | null; gapCount: number | null }; lastSuccessAt: string | null };
type SpCoverage = { observedAt: string; summary: { registeredDomains: number; completedDomains: number; domainCoveragePercent: number | null; complete: boolean }; domains: Array<{ resource: string; name: string; status: string; configuredSources: number; expectedSources: number | null; completedSources: number }>; sources: SpCoverageSource[] };
type AdsPlan = { id: string; status: string; intervalMinutes: number; nextRunAt: string | null; lastSuccessAt: string | null; lastErrorCode: string | null; reportLookbackDays: number; profile: { profileId: string; region: string; countryCode: string; marketplaceId: string; sellerAccountId: string; authorization: { name: string; status: string } }; tasks: Array<{ id: string; status: string; stage: string; trigger: string; processedCount: number; apiRequests: number; errorCode: string | null; requestedFrom: string | null; requestedTo: string | null; startedAt: string; finishedAt: string | null }> };
type AdsFreshness = { profileId: string; dataDomain: string; reportType: string; status: string; coveredFrom: string | null; coveredTo: string | null; lastAttemptAt: string | null; lastSuccessAt: string | null; lastTaskId: string | null; warningCodes: string[] };
type AdsTask = { id: string; planId: string; profileId: string; status: string; stage: string; trigger: string; processedCount: number; apiRequests: number; errorCode: string | null; requestedFrom: string | null; requestedTo: string | null; startedAt: string; finishedAt: string | null };
type AdsSyncPayload = { plans: AdsPlan[]; freshness: AdsFreshness[]; taskHistory: AdsTask[]; reportSyncEnabled: boolean; access?: SyncAccess };

type MatrixRow = {
  id: string; domain: string; table: string; rows: number | null; coverageSubjects: string; coverageRange: string; latestBusinessDate: string;
  lastSync: string; status: string; syncing: boolean; stage: string; pages: number; pagesTotal: number | null; processed: number;
  sourceIds: string[]; planId?: string; taskId?: string; profileId?: string; resource: string; error?: string | null;
};

function Field({ name, children }: { name: string; children: ReactNode }) { const id = useId(); return <div className="grid min-w-0 gap-1 text-xs text-muted"><label className="whitespace-nowrap" htmlFor={id}>{name}</label>{isValidElement(children) ? cloneElement(children as ReactElement<{ id?: string }>, { id }) : children}</div>; }

export function AmazonSyncMatrix({ initialTab = "sp" }: { initialTab?: "sp" | "ads" }) {
  const [tab, setTab] = useState<"sp" | "ads">(initialTab);
  const [spSources, setSpSources] = useState<SyncSourceView[]>([]), [spCoverage, setSpCoverage] = useState<SpCoverage | null>(null);
  const [spAccess, setSpAccess] = useState<SyncAccess>({ canEdit: false, canCreate: false, canConfigure: false });
  const [adsPlans, setAdsPlans] = useState<AdsPlan[]>([]), [adsFreshness, setAdsFreshness] = useState<AdsFreshness[]>([]), [adsTasks, setAdsTasks] = useState<AdsTask[]>([]), [adsAccess, setAdsAccess] = useState<SyncAccess>({ canEdit: false, canCreate: false, canConfigure: false });
  const [connection, setConnection] = useState(""), [loading, setLoading] = useState(true), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false), [reloadKey, setReloadKey] = useState(0);
  const refresh = useCallback(() => { setReloadKey(k => k + 1); }, []);
  const [logTarget, setLogTarget] = useState<MatrixRow | null>(null), [logs, setLogs] = useState<SyncTaskLogView[]>([]), [logLoading, setLogLoading] = useState(false);
  const [syncTarget, setSyncTarget] = useState<MatrixRow | null>(null), [syncMode, setSyncMode] = useState<"incremental" | "custom">("incremental"), [syncFrom, setSyncFrom] = useState(""), [syncTo, setSyncTo] = useState("");
  const [confirm, setConfirm] = useState<{ title: string; description: string; run: () => void } | null>(null);
  const seq = useRef(0), mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; seq.current++; }, []);

  const load = useCallback(async () => {
    const n = ++seq.current; setLoading(true); setError("");
    try {
      if (tab === "sp") {
        const h = scopeHeaders();
        const [ov, cov] = await Promise.all([
          getJson<{ sources: SyncSourceView[]; access?: SyncAccess; error?: string }>(`${spBase}?section=overview`, { headers: h }),
          getJson<SpCoverage & { error?: string }>(`${spBase}?section=coverage`, { headers: h }),
        ]);
        if (n !== seq.current) return;
        if (!ov.ok) throw new Error(ov.data.error ?? "SP 矩阵读取失败。");
        setSpSources(ov.data.sources ?? []); if (ov.data.access) setSpAccess(ov.data.access);
        if (cov.ok) setSpCoverage(cov.data); else setSpCoverage(null);
      } else {
        const h = scopeHeaders();
        const res = await getJson<AdsSyncPayload & { error?: string }>(`${adsBase}/sync`, { headers: h });
        if (n !== seq.current) return;
        if (!res.ok) throw new Error(res.data.error ?? "Ads 矩阵读取失败。");
        setAdsPlans(res.data.plans ?? []); setAdsFreshness(res.data.freshness ?? []); setAdsTasks(res.data.taskHistory ?? []); if (res.data.access) setAdsAccess(res.data.access);
      }
    } catch (e) { if (n === seq.current && mounted.current) setError(e instanceof Error ? e.message : "读取失败。"); }
    finally { if (n === seq.current && mounted.current) setLoading(false); }
  }, [tab]);
  useEffect(() => { void load(); }, [load, reloadKey]);
  // 可见性感知轮询：后台标签停表、弹层打开或操作进行中跳过、回前台立即刷新。
  useVisiblePolling({
    intervalMs: 30000,
    enabled: true,
    busy: busy || logTarget !== null || syncTarget !== null,
    onPoll: () => { void load(); },
  });

  const spConnections = [...new Set(spSources.map(s => `${s.seller.id}:${s.seller.displayName || s.seller.accountKey}`))].map(v => { const [id, name] = v.split(":"); return { id, name }; });
  const adsConnections = [...new Map(adsPlans.map(p => [p.profile.authorization.name || p.profile.profileId, p.profile.authorization.name || p.profile.profileId])).entries()].map(([name]) => ({ id: name, name }));
  const activeConnections = tab === "sp" ? spConnections : adsConnections;

  const spRows: MatrixRow[] = (() => {
    const covBySource = new Map((spCoverage?.sources ?? []).map(c => [c.sourceId, c]));
    const grouped = new Map<string, SyncSourceView[]>();
    for (const s of spSources) {
      if (connection && connection !== `${s.seller.id}:${s.seller.displayName || s.seller.accountKey}` && connection !== s.authorization.name) continue;
      grouped.set(s.resource, [...(grouped.get(s.resource) ?? []), s]);
    }
    return [...grouped.entries()].map(([resource, list]) => {
      const cov = list.map(s => covBySource.get(s.id)).filter(Boolean) as SpCoverageSource[];
      const subjects = new Set(list.map(s => s.marketplaceId));
      const covered = new Set(cov.filter(c => c.published && c.visibleRows > 0).map(c => c.marketplaceId));
      const cursor = list.map(s => s.resourceCursor).find(Boolean);
      const worstStatus = list.some(s => s.health === "FAILED" || s.health === "BLOCKED") ? "FAILED" : list.some(s => s.health === "SYNCING") ? "SYNCING" : list.some(s => s.health === "FRESH") ? "FRESH" : list[0]?.health ?? "NOT_SYNCED";
      const syncing = list.some(s => s.health === "SYNCING" && s.latestTask);
      const task = list.find(s => s.health === "SYNCING")?.latestTask;
      const successes = list.map(s => s.lastSuccessAt).filter(Boolean) as string[];
      return {
        id: resource, domain: domainName(resource), table: resourceTable[resource] ?? "NEEDS_DATA",
        rows: list.some(s => s.rowCount > 0) ? list.reduce((sum, s) => sum + s.rowCount, 0) : null,
        coverageSubjects: `${covered.size} / ${subjects.size}`,
        coverageRange: cursor ? `${day(cursor.watermarkFrom)} ~ ${day(cursor.watermarkTo)}` : "—",
        latestBusinessDate: cursor ? day(cursor.watermarkTo) : "—",
        lastSync: successes.length ? stamp(successes.sort().at(-1)) : "—",
        status: worstStatus, syncing, stage: task?.stage ?? "", pages: task?.pagesCompleted ?? 0, pagesTotal: null, processed: task?.processedCount ?? 0,
        sourceIds: list.map(s => s.id), resource,
      };
    });
  })();

  const adsRows: MatrixRow[] = (() => {
    // 真实关联链：freshness.lastTaskId → taskHistory（planId/status/stage/processedCount）→ plan（授权/Profile）。
    // profileId 在 freshness 是内部记录 ID，在 plan.profile 是 Amazon 公共 Profile ID，二者不等价，故不用它关联。
    const planById = new Map(adsPlans.map(p => [p.id, p]));
    const taskById = new Map(adsTasks.map(t => [t.id, t]));
    const inSelectedConnection = (f: AdsFreshness) => {
      if (!connection) return true;
      const task = f.lastTaskId ? taskById.get(f.lastTaskId) : undefined;
      const plan = task ? planById.get(task.planId) : undefined;
      const name = plan?.profile.authorization.name || adsPlans.find(p => p.profile.profileId === f.profileId)?.profile.authorization.name;
      return name === connection;
    };
    const merged = new Map<string, { dataDomain: string; reportType: string; items: AdsFreshness[] }>();
    for (const f of adsFreshness) {
      if (!inSelectedConnection(f)) continue;
      const key = `${f.dataDomain}:${f.reportType}`;
      merged.set(key, { dataDomain: f.dataDomain, reportType: f.reportType, items: [...(merged.get(key)?.items ?? []), f] });
    }
    return [...merged.entries()].map(([key, group]) => {
      const profiles = new Set(group.items.map(f => f.profileId));
      const withData = new Set(group.items.filter(f => f.lastSuccessAt).map(f => f.profileId));
      const ranges = group.items.map(f => f.coveredFrom).filter(Boolean) as string[];
      const latest = group.items.map(f => f.coveredTo).filter(Boolean) as string[];
      const successes = group.items.map(f => f.lastSuccessAt).filter(Boolean) as string[];
      const tasks = group.items.map(f => f.lastTaskId ? taskById.get(f.lastTaskId) : undefined).filter(Boolean) as AdsTask[];
      const task = tasks[0];
      const plan = task ? planById.get(task.planId) : undefined;
      const syncing = tasks.some(t => ["RUNNING", "QUEUED", "WAITING", "RETRY_WAIT"].includes(t.status));
      const status = group.items.some(f => ["FAILED", "BLOCKED", "NO_PERMISSION"].includes(f.status)) || tasks.some(t => t.status === "FAILED" || t.errorCode) ? "FAILED" : syncing ? "RUNNING" : successes.length ? "SUCCEEDED" : group.items[0]?.status ?? "NOT_CONFIGURED";
      return {
        id: key, domain: group.reportType ? `${domainName(group.dataDomain) === group.dataDomain ? group.dataDomain : domainName(group.dataDomain)} · ${group.reportType}` : (group.dataDomain === "SP_STRUCTURE" ? "SP 广告结构" : group.dataDomain),
        table: adsTable(group.dataDomain, group.reportType),
        rows: task?.processedCount != null ? task.processedCount : null,
        coverageSubjects: `${withData.size} / ${profiles.size}`,
        coverageRange: ranges.length && latest.length ? `${day(ranges.sort()[0])} ~ ${day(latest.sort().at(-1))}` : "—",
        latestBusinessDate: latest.length ? day(latest.sort().at(-1)) : "—",
        lastSync: successes.length ? stamp(successes.sort().at(-1)) : "—",
        status, syncing, stage: task?.stage ?? "", pages: 0, pagesTotal: null, processed: task?.processedCount ?? 0,
        sourceIds: [], planId: plan?.id ?? task?.planId, taskId: task?.id, profileId: [...profiles][0], resource: group.dataDomain, error: task?.errorCode ?? plan?.lastErrorCode ?? group.items.find(f => f.warningCodes.length)?.warningCodes[0],
      };
    });
  })();

  const rows = tab === "sp" ? spRows : adsRows;
  const access = tab === "sp" ? spAccess : adsAccess;
  // 权限就绪 = 非「等待授权 / 权限不足 / 未配置」状态；严格按服务端真实状态枚举判定，不推算。
  const notReady = ["NOT_CONFIGURED", "PENDING", "AUTHORIZATION_BLOCKED", "BLOCKED", "NOT_SYNCED", "MISSING_SOURCE", "ADAPTER_NOT_IMPLEMENTED"];
  const summary = {
    total: rows.length,
    ready: rows.filter(r => !notReady.includes(r.status)).length,
    succeeded: rows.filter(r => ["SUCCEEDED", "FRESH"].includes(r.status)).length,
    failed: rows.filter(r => ["FAILED", "BLOCKED"].includes(r.status)).length,
  };

  const columns: DataTableColumn<MatrixRow>[] = [
    { key: "domain", header: "数据域", width: 200, render: r => <span className="font-medium">{r.domain}</span> },
    { key: "table", header: "落库表", width: 170, render: r => <span className="font-mono text-xs text-muted" title={r.table === "NEEDS_DATA" ? "该数据域未登记物理表映射，不臆造表名。" : undefined}>{r.table}</span> },
    { key: "rows", header: "总行数", width: 90, numeric: true, render: r => r.rows === null ? <span className="text-muted" title="无已发布证据，不补造 0">—</span> : r.rows.toLocaleString() },
    { key: "coverageSubjects", header: "覆盖主体", width: 110, render: r => <span title={tab === "sp" ? "已覆盖 Marketplace / 全部 Marketplace" : "已覆盖 Profile / 全部 Profile"}>{r.coverageSubjects}</span> },
    { key: "coverageRange", header: "覆盖区间", width: 190, render: r => <span className="text-xs">{r.coverageRange}</span> },
    { key: "latestBusinessDate", header: "最新业务日期", width: 110, render: r => <span className="text-xs">{r.latestBusinessDate}</span> },
    { key: "lastSync", header: "最近同步时间", width: 165, render: r => <span className="text-xs">{r.lastSync}</span> },
    { key: "status", header: "状态", width: 120, render: r => <><StateBadge value={r.status} />{r.syncing && <InlineProgress stage={r.stage} pages={r.pages} pagesTotal={r.pagesTotal} rows={r.processed} />}{r.error && !r.syncing && <span className="mt-0.5 block text-xs text-danger-ink" title={r.error}>{r.error.slice(0, 40)}</span>}</> },
    { key: "action", header: "操作", width: 160, render: r => <div className="flex flex-wrap gap-1.5"><Button size="sm" variant="secondary" title={r.syncing ? "同步进行中，可查看日志或取消" : "触发手动同步"} onClick={() => { setSyncTarget(r); setSyncMode("incremental"); setSyncFrom(""); setSyncTo(""); }}>{r.syncing ? "取消" : "手动同步"}</Button><Button size="sm" variant="ghost" onClick={() => void openLog(r)}>日志</Button></div> },
  ];

  const openLog = async (r: MatrixRow) => {
    setLogTarget(r); setLogs([]); setLogLoading(true); setError("");
    try {
      const h = scopeHeaders();
      if (tab === "sp") {
        const id = spSources.find(s => r.sourceIds.includes(s.id))?.latestTask?.id;
        if (!id) { setLogs([]); return; }
        const res = await getJson<{ logs: SyncTaskLogView[]; error?: string }>(`${spBase}?section=task&id=${encodeURIComponent(id)}`, { headers: h });
        if (!res.ok) throw new Error(res.data.error ?? "日志读取失败。");
        setLogs(res.data.logs ?? []);
      } else {
        const id = r.taskId ?? adsPlans.find(p => p.id === r.planId)?.tasks[0]?.id;
        if (!id) { setLogs([]); return; }
        const res = await getJson<{ taskDetail?: { attemptRuns: Array<{ attemptNumber: number; stage: string; status: string; errorCode: string | null; safeErrorSummary: string | null; apiRequests: number; processedCount: number; startedAt: string; finishedAt: string | null }> }; error?: string }>(`${adsBase}/sync?taskId=${encodeURIComponent(id)}`, { headers: h });
        if (!res.ok) throw new Error(res.data.error ?? "日志读取失败。");
        setLogs((res.data.taskDetail?.attemptRuns ?? []).map(a => ({ id: String(a.attemptNumber), attempt: a.attemptNumber, event: a.status, stage: a.stage, page: null, code: a.errorCode, requestId: null, statusCode: null, rateLimit: null, createdAt: a.startedAt })));
      }
    } catch (e) { setError(e instanceof Error ? e.message : "日志读取失败。"); }
    finally { setLogLoading(false); }
  };

  const submitSync = async () => {
    if (!syncTarget) return;
    const r = syncTarget;
    if (r.syncing) {
      const taskId = tab === "sp" ? spSources.find(s => r.sourceIds.includes(s.id))?.latestTask?.id : r.taskId ?? adsPlans.find(p => p.id === r.planId)?.tasks[0]?.id;
      if (!taskId) return;
      setBusy(true); setError("");
      try {
        const h = scopeHeaders(); h.set("content-type", "application/json");
        const url = tab === "sp" ? spBase : `${adsBase}/sync`;
        const body = tab === "sp" ? { action: "control-task", id: taskId, control: "cancel" } : { action: "cancel", taskId };
        const res = await fetch(url, { method: "POST", headers: h, body: JSON.stringify(body) });
        const data = await res.json(); if (!res.ok) throw new Error(data.error ?? "取消失败。");
        setNotice("已提交取消请求；后台分片在检查点停止。"); setSyncTarget(null); await load();
      } catch (e) { setError(e instanceof Error ? e.message : "取消失败。"); } finally { setBusy(false); }
      return;
    }
    setBusy(true); setError("");
    try {
      const h = scopeHeaders(); h.set("content-type", "application/json");
      if (tab === "sp") {
        const body: Record<string, unknown> = { action: "run", sourceIds: r.sourceIds, idempotencyKey: crypto.randomUUID() };
        const timeBased = isIncrementalResource(r.resource) || r.resource === "sales_traffic" || r.resource === "brand_analytics";
        if (timeBased && syncMode === "custom") {
          if (!syncFrom || !syncTo || syncFrom > syncTo) throw new Error("请填写有效的回填起止日期。");
          const days = (Date.parse(syncTo) - Date.parse(syncFrom)) / 86400000 + 1;
          const limit = limitFor(r.resource, domainName(r.resource));
          if (days > limit) throw new Error(`回填区间 ${days} 天超过该数据域上限 ${limit} 天，请缩短后重试。`);
          body.dateFrom = syncFrom; body.dateTo = syncTo;
        }
        const res = await fetch(spBase, { method: "POST", headers: h, body: JSON.stringify(body) });
        const data = await res.json(); if (!res.ok) throw new Error(data.error ?? "提交失败。");
        setNotice(res.status === 202 ? "同步申请已提交，等待系统处理。" : "已提交，正在后台同步。");
      } else {
        if (!r.planId) throw new Error("该数据域没有可执行的 Ads 计划。");
        const res = await fetch(`${adsBase}/sync`, { method: "POST", headers: h, body: JSON.stringify({ action: "run", planId: r.planId }) });
        const data = await res.json(); if (!res.ok) throw new Error(data.error ?? "提交失败。");
        setNotice("Ads 手动同步已提交；后台按计划窗口执行。");
      }
      setSyncTarget(null); await load();
    } catch (e) { setError(e instanceof Error ? e.message : "提交失败。"); } finally { setBusy(false); }
  };

  const bulkRetry = () => {
    const failed = rows.filter(r => ["FAILED", "BLOCKED"].includes(r.status));
    if (!failed.length) { setNotice("当前矩阵没有失败项。"); return; }
    setConfirm({ title: `批量重试 ${failed.length} 项失败资源`, description: tab === "sp" ? "将为当前视图内的失败数据源重新提交同步，系统自动执行。是否继续？" : "将重试当前视图内失败资源的 Ads 计划。是否继续？", run: () => {
      setBusy(true); setError("");
      const h = scopeHeaders(); h.set("content-type", "application/json");
      void (async () => {
        try {
          if (tab === "sp") {
            const res = await fetch(spBase, { method: "POST", headers: h, body: JSON.stringify({ action: "run", sourceIds: failed.flatMap(r => r.sourceIds), idempotencyKey: crypto.randomUUID() }) });
            const d = await res.json(); if (!res.ok) throw new Error(d.error ?? "提交失败。");
            setNotice("失败项已重新提交，系统正在自动同步。");
          } else {
            const planIds = [...new Set(failed.map(r => r.planId).filter(Boolean))] as string[];
            for (const planId of planIds) { const res = await fetch(`${adsBase}/sync`, { method: "POST", headers: h, body: JSON.stringify({ action: "retry", planId }) }); const d = await res.json(); if (!res.ok) throw new Error(d.error ?? "重试失败。"); }
            setNotice("Ads 失败计划已提交重试。");
          }
          await load();
        } catch (e) { setError(e instanceof Error ? e.message : "操作失败。"); } finally { setBusy(false); }
      })();
    } });
  };

  const timeBasedTarget = syncTarget && (isIncrementalResource(syncTarget.resource) || syncTarget.resource === "sales_traffic" || syncTarget.resource === "brand_analytics");
  const syncLimit = syncTarget ? limitFor(syncTarget.resource, domainName(syncTarget.resource)) : 95;

  return <div className="space-y-4" data-testid="amazon-sync-matrix">
    <header className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
      <div><h1 className="text-title font-semibold">Amazon 同步矩阵</h1><p className="mt-0.5 text-xs text-muted">SP-API 与 Ads API 独立矩阵 · 页面只读观察服务端真实状态 · 手动同步不替代自动同步</p></div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-xs text-muted">当前连接
          <select aria-label="选择 Amazon 连接" className="min-h-9 rounded border border-border bg-background px-2 text-sm text-foreground" value={connection} onChange={e => setConnection(e.target.value)}>
            <option value="">全部连接</option>{activeConnections.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
        <Button size="sm" variant="secondary" disabled={loading || busy} onClick={refresh}>刷新矩阵</Button>
        <Button size="sm" variant="secondary" disabled={loading || busy || !access.canCreate} onClick={bulkRetry}>批量重试失败项</Button>
      </div>
    </header>

    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" data-testid="matrix-summary">{[
      { label: "总注册资源", value: summary.total, note: "当前视图可见数据域" },
      { label: "权限就绪资源", value: summary.ready, note: "非等待授权状态" },
      { label: "同步成功资源", value: summary.succeeded, note: "最近一次同步成功" },
      { label: "同步失败资源", value: summary.failed, note: "失败／权限不足" },
    ].map(item => <div key={item.label} className="rounded-lg border border-border bg-surface px-4 py-3"><p className="truncate text-xs text-muted">{item.label}</p><p className="metric-tabular mt-1 text-xl font-semibold">{item.value}</p><p className="mt-1 truncate text-xs text-muted">{item.note}</p></div>)}</div>

    <div role="tablist" aria-label="Amazon 数据源" className="flex gap-1 border-b border-border">
      {(["sp", "ads"] as const).map(t => <button key={t} type="button" role="tab" aria-selected={tab === t} data-testid={`matrix-tab-${t}`} onClick={() => { setTab(t); setConnection(""); setError(""); }} className={`min-h-10 px-4 text-sm font-semibold ${tab === t ? "border-b-2 border-brand text-brand" : "text-muted hover:text-foreground"}`}>{t === "sp" ? "SP-API 资源同步矩阵" : "Ads API 资源同步矩阵"}</button>)}
    </div>
    <p className="text-xs text-muted">{tab === "sp" ? "数据来自 Amazon SP-API 同步来源与其已发布证据；覆盖主体、区间、最新业务日期均按站点×数据域真实记录，未发布保持空缺。" : "数据来自 Amazon Ads 独立授权、Profile、同步计划与数据域新鲜度；与 SP-API 完全隔离，不合并统计。"}</p>
    {error && <p role="alert" className="rounded border border-danger/30 bg-danger-soft p-3 text-sm text-danger-ink">{error}</p>}
    {notice && <p role="status" className="text-sm text-brand">{notice}</p>}

    <section className="rounded-lg border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold">{tab === "sp" ? "SP-API 资源同步矩阵" : "Ads API 资源同步矩阵"}</h2><span className="text-xs text-muted">列标题可按需显隐，固定首列不参与隐藏</span></div>
      {loading ? <p role="status" className="py-8 text-center text-sm text-muted">正在读取{tab === "sp" ? " SP-API " : " Ads API "}矩阵…</p> :
        <StandardDataTable ariaLabel={tab === "sp" ? "SP-API 资源同步矩阵" : "Ads API 资源同步矩阵"} rows={rows} getRowKey={r => r.id} columns={columns} columnToggle pinnedColumnKeys={["domain"]} empty="当前连接下没有已登记的资源；授权并验证后由后台自动发现。" />}
    </section>

    {/* 手动同步 / 取消弹窗 */}
    <Dialog open={syncTarget !== null} title={syncTarget?.syncing ? "取消同步任务" : "手动同步"} description={syncTarget ? `${syncTarget.domain} · ${syncTarget.table}` : undefined} busy={busy} onClose={() => { if (!busy) setSyncTarget(null); }} footer={<>
      <Button variant="secondary" disabled={busy} onClick={() => setSyncTarget(null)}>关闭</Button>
      <Button disabled={busy || (!syncTarget?.syncing && !access.canCreate)} onClick={() => void submitSync()}>{syncTarget?.syncing ? "确认取消" : "提交"}</Button>
    </>}>
      {syncTarget && (syncTarget.syncing ? <p className="text-sm text-muted">该资源正在同步。取消请求将在后台任务的检查点生效，已提交的分片与已发布数据保留。此操作需二次确认后执行。</p> : <>
        <p className="mb-3 text-xs leading-relaxed text-muted">手动同步是授权后自动回填／增量同步的补救入口；提交后{tab === "sp" ? "系统立即自动执行，无需人工审批" : "由后台按计划窗口执行"}。页面不直接调用 Amazon 接口。</p>
        {tab === "sp" && timeBasedTarget && <div className="space-y-3">
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="同步方式">
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="sync-mode" checked={syncMode === "incremental"} onChange={() => setSyncMode("incremental")} />增量更新</label>
            <label className="flex items-center gap-2 text-sm"><input type="radio" name="sync-mode" checked={syncMode === "custom"} onChange={() => setSyncMode("custom")} />自定义区间回填</label>
          </div>
          {syncMode === "custom" && <div className="grid gap-3 sm:grid-cols-2">
            <Field name="开始日期"><input type="date" className="min-h-9 rounded border border-border bg-background px-2 text-sm" value={syncFrom} max={syncTo || undefined} onChange={e => setSyncFrom(e.target.value)} /></Field>
            <Field name="结束日期"><input type="date" className="min-h-9 rounded border border-border bg-background px-2 text-sm" value={syncTo} min={syncFrom || undefined} onChange={e => setSyncTo(e.target.value)} /></Field>
            <p className="sm:col-span-2 text-xs text-muted">该数据域回填上限 {syncLimit} 天；超出上限前端拦截。订单／财务等由持久游标决定的窗口不接受临时历史日期，请在同步计划中按审批策略配置。</p>
          </div>}
        </div>}
        {tab === "sp" && !timeBasedTarget && <p className="rounded border border-border bg-background p-3 text-xs text-muted">当前快照类资源不支持历史区间回填；提交后拉取最新完整快照，不覆盖已发布版本。</p>}
        {tab === "ads" && <p className="rounded border border-border bg-background p-3 text-xs text-muted">Ads 计划按已配置的回溯窗口执行（搜索词类最多 65 天，其余报表最多 95 天）；不在页面指定临时日期。</p>}
      </>)}
    </Dialog>

    {/* 同步日志抽屉 */}
    <Drawer open={logTarget !== null} title="同步日志" description={logTarget ? `${logTarget.domain} · ${logTarget.table}` : undefined} onClose={() => setLogTarget(null)} width="lg">
      {logTarget && <div className="space-y-3 text-sm">
        <p className="text-xs leading-relaxed text-muted">批次日志来自服务端结构日志，含请求标识、HTTP 状态、限流头与错误分类；原始 API 报错正文不会展示。页面关闭不中断后台同步。</p>
        {logLoading ? <p role="status" className="py-6 text-center text-xs text-muted">读取日志…</p> : logs.length ? <div className="space-y-2">{logs.map(l => <article key={l.id} className="rounded-md border border-border p-3" data-testid="matrix-log-row"><div className="flex flex-wrap items-center gap-2"><StateBadge value={l.event} /><span className="text-xs text-muted">{stamp(l.createdAt)}</span></div><p className="mt-1 text-xs">阶段 {l.stage} · 尝试 {l.attempt} · 页 {l.page ?? "—"} · HTTP {l.statusCode ?? "—"} · 错误 {l.code ?? "—"}</p><p className="mt-0.5 break-all font-mono text-label text-muted">RequestId {l.requestId ?? "—"} · 限流头 {l.rateLimit ?? "—"}</p></article>)}</div> : <p className="py-6 text-center text-xs text-muted">该资源暂无可展示的批次日志。</p>}
      </div>}
    </Drawer>

    {/* 危险操作二次确认 */}
    <Dialog open={confirm !== null} title={confirm?.title ?? ""} busy={busy} onClose={() => { if (!busy) setConfirm(null); }} footer={<><Button variant="secondary" disabled={busy} onClick={() => setConfirm(null)}>取消</Button><Button disabled={busy} onClick={() => { const run = confirm?.run; setConfirm(null); run?.(); }}>确认继续</Button></>}>
      <p className="text-sm text-muted">{confirm?.description}</p>
    </Dialog>
  </div>;
}
