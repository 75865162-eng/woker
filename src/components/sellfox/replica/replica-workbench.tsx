"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { SellfoxTabs } from "@/components/sellfox/sellfox-nav";
import { Dialog } from "@/components/ui/overlays";
import { ColumnResizeHandle } from "@/components/ui/column-resize-handle";
import { useSessionColumnWidths } from "@/lib/hooks/use-session-column-widths";
import { normalizeWorkspaceScope } from "@/lib/workspace/scope";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import { sellfoxSiteLabel, siteCodeOf } from "@/lib/sellfox/marketplace-site";
import {
  datePresets,
  rangeForPreset,
  type DatePreset,
  type ReplicaColumn,
  type ReplicaPage,
} from "@/lib/sellfox/replica-pages";

type Row = Record<string, unknown>;
type Store = { externalId: string; name: string; marketplace: string };
type SalesSummary = { quantity: number | null; fulfillable: number | null; totalInventory: number | null; daily: Record<string, { value: number | null; entities: number }> };
type SortOrder = "asc" | "desc";
type Filters = {
  dimension: string;
  metric: string;
  grain: "day" | "week" | "month";
  preset: DatePreset;
  from: string;
  to: string;
  site: string;
  shop: string;
  fulfillment: string;
  status: string;
  productTag: string;
  salesperson: string;
  owner: string;
  currency: string;
  searchType: string;
  search: string;
  exact: boolean;
  hideZero: boolean;
  onlySettle: boolean;
  sortBy: string;
  sortOrder: SortOrder;
  page: number;
  pageSize: number;
};

const noWrite = "此复刻页只读，不把同步或导入写入数据库。";
const weekdays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

/**
 * 列宽来自《赛狐ERP-销量统计页面UI逆向规格》表 7（ASIN 维度实测列宽）。
 * 仅在展示层设置，不参与数据契约。未列出的列沿用默认自适应宽度。
 */
const COLUMN_WIDTH_PX: Record<string, number> = {
  mainImage: 80, asin: 120, store: 120, analysis: 50, operations: 80, insight: 80,
  parentAsin: 120, msku: 150, sku: 150, spu: 150, productTags: 138, title: 200,
  identity: 120, asinMsku: 120, opLabel: 80, salesWindow: 150,
};

/**
 * 币种全集来自规格 6.2.5（原币种 / CNY / USD / EUR / JPY / GBP / AUD / CAD / MXN）。
 * 补全的是赛狐页面可见的选项；本地是否有对应币种数据取决于已同步快照，为空即显示“-”。
 */
const CURRENCY_OPTIONS = ["CNY", "USD", "EUR", "JPY", "GBP", "AUD", "CAD", "MXN"];

/**
 * 站点按大区分组来自规格 6.2.1。分组只作用于“全部站点”下拉的展示排序；
 * 实际筛选值仍是原始 Marketplace ID，不参与分组计算。
 */
const SITE_REGIONS: { label: string; codes: string[] }[] = [
  { label: "北美区", codes: ["US", "CA", "MX"] },
  { label: "欧洲区", codes: ["UK", "DE", "FR", "IT", "ES", "NL", "SE", "PL", "BE", "IE"] },
  { label: "日本", codes: ["JP"] },
  { label: "新加坡", codes: ["SG"] },
  { label: "澳大利亚", codes: ["AU"] },
  { label: "印度", codes: ["IN"] },
  { label: "阿联酋", codes: ["AE"] },
  { label: "沙特阿拉伯", codes: ["SA"] },
  { label: "土耳其", codes: ["TR"] },
];

function siteRegionOf(marketplace: string): string {
  const code = siteCodeOf(marketplace);
  return SITE_REGIONS.find((region) => region.codes.includes(code))?.label ?? "其他站点";
}

/** 数据不足项：控件可交互，但结果按缺失显示“-”，提示注明快照无此字段，不补 0、不造假。 */
const MISSING_HINT = "本地快照没有对应字段，已接通控件但结果按缺失显示“-”，不补 0、不造假。";

/**
 * 进程内短期读缓存 + 同 key in-flight 去重。只缓存只读快照响应，不持久化到
 * localStorage（避免同步后脏数据长期残留）；UI 列显隐偏好仍走原 localStorage。
 */
type ReadCache<T> = { body: T; ts: number };
const readCache = new Map<string, ReadCache<unknown>>();
const readInflight = new Map<string, Promise<unknown>>();
const CACHE_LIMIT = 120;
function cacheTtl(endpoint: string): number {
  if (endpoint.includes("/overview")) return 30_000;
  if (/\/sales($|\?)/.test(endpoint) || /domain=sales/.test(endpoint) || /\/performance/.test(endpoint) || /domain=ads_/.test(endpoint)) return 60_000;
  if (/\/listings/.test(endpoint) || /domain=listings/.test(endpoint)) return 30_000;
  if (/domain=inventory/.test(endpoint)) return 20_000;
  return 60_000;
}
function cacheGet<T>(key: string): ReadCache<T> | undefined {
  const hit = readCache.get(key) as ReadCache<T> | undefined;
  if (!hit) return undefined;
  if (Date.now() - hit.ts > cacheTtl(key)) { readCache.delete(key); return undefined; }
  // refresh LRU-ish ordering
  readCache.delete(key); readCache.set(key, hit);
  return hit;
}
function cacheSet<T>(key: string, body: T) {
  readCache.set(key, { body, ts: Date.now() });
  if (readCache.size > CACHE_LIMIT) {
    const oldest = readCache.keys().next().value;
    if (oldest !== undefined) readCache.delete(oldest);
  }
}
function clearCachePrefix(prefix: string) {
  for (const key of readCache.keys()) if (key.startsWith(prefix)) readCache.delete(key);
}
/** 共享一次请求：同 key 并发只发一个 fetch。命中缓存直接返回，不走网络。 */
function cachedFetch<T>(key: string, doFetch: () => Promise<T>, guard?: () => boolean): { promise: Promise<T>; hit: boolean } {
  const hit = cacheGet<T>(key);
  if (hit) return { promise: Promise.resolve(hit.body), hit: true };
  const pending = readInflight.get(key) as Promise<T> | undefined;
  if (pending) return { promise: pending, hit: true };
  const task = doFetch().then((body) => { if (!guard || guard()) cacheSet(key, body); return body; }).finally(() => { readInflight.delete(key); });
  readInflight.set(key, task);
  return { promise: task, hit: false };
}

function readScope() {
  try { return normalizeWorkspaceScope(JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") ?? "{}")); }
  catch { return normalizeWorkspaceScope(); }
}

function initialFilters(page: ReplicaPage): Filters {
  const ranged = page.showDate && page.query !== "agent";
  const range = ranged ? rangeForPreset("d30") : { from: "", to: "" };
  return {
    dimension: page.defaultDimension ?? page.dimensions.find((item) => !item.disabled)?.id ?? "",
    metric: page.metrics[0]?.id ?? "quantity",
    grain: "day",
    preset: ranged ? "d30" : "custom",
    from: range.from,
    to: range.to,
    site: "",
    shop: "",
    fulfillment: "",
    status: "",
    productTag: "",
    salesperson: "",
    owner: "",
    currency: "",
    searchType: page.searchTypes[0]?.id ?? "",
    search: "",
    exact: false,
    hideZero: false,
    onlySettle: false,
    sortBy: "",
    sortOrder: "desc",
    page: 1,
    pageSize: 20,
  };
}

function text(value: unknown) {
  if (value == null || value === "") return "-";
  if (Array.isArray(value)) return value.length ? value.map(String).join("、") : "-";
  return String(value);
}

function numberOf(value: unknown) {
  if (value == null || value === "") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function qty(value: unknown, digits = 0) {
  const number = numberOf(value);
  return number == null ? "-" : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(number);
}

function money(value: unknown, currency: unknown) {
  const number = numberOf(value);
  if (number == null) return "-";
  const code = typeof currency === "string" && currency ? currency : "";
  const body = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number);
  return code === "USD" ? `US$${body}` : code ? `${code} ${body}` : body;
}

function rate(value: unknown) {
  const number = numberOf(value);
  return number == null ? "-" : `${(number * 100).toFixed(2)}%`;
}

/** 展示列宽：会话内拖拽值优先，否则用赛狐规格表 7 的固定宽度；未收录的列返回 undefined 由 CSS 自适应。 */
function colWidthStyle(width: number | undefined): { width: number; minWidth: number; maxWidth: number } | undefined {
  return width ? { width, minWidth: width, maxWidth: width } : undefined;
}

function safeImage(value: unknown) {
  return typeof value === "string" && /^https?:\/\//.test(value) ? value : "";
}
function cacheTimeLabel(cachedAt: string | null) {
  if (!cachedAt) return "";
  const date = new Date(cachedAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false });
}

function cellText(column: ReplicaColumn, row: Row, metric: string) {
  if (column.kind === "image" || column.kind === "icon") return "";
  if (column.kind === "missing") return "-";
  if (column.kind === "store") return [text(row.name), sellfoxSiteLabel(row.marketplace)].filter(Boolean).join(" / ") || "-";
  if (column.kind === "mskuPrice") return [text(row.msku), money(row.price, row.currency)].join(" / ");
  if (column.kind === "skuName") return [text(row.title ?? row.identity), text(row.sku)].filter((item) => item !== "-").join(" / ") || "-";
  if (column.kind === "titleAsin") return [text(row.title), text(row.asin ?? row.identity)].join(" / ");
  if (column.kind === "asinMsku") return [text(row.asin), text(row.msku)].join(" / ");
  if (column.kind === "salesWindow") return [qty(row.sales7), qty(row.sales14), qty(row.sales30)].join(" | ");
  if (column.kind === "tags" || column.kind === "people") return text(column.kind === "people" ? row.userNameList : row.productTags);
  if (column.kind === "qty") return qty(row[column.key]);
  if (column.kind === "decimal") return qty(row[column.key], 2);
  if (column.kind === "money") return money(row[column.key], row.currency);
  if (column.kind === "rate") return rate(row[column.key]);
  if (column.kind === "metric") return metric === "revenue" ? money(row.subtotal, row.currency) : qty(row.subtotal);
  return text(row[column.key]);
}

function Cell({ column, row, metric }: { column: ReplicaColumn; row: Row; metric: string }) {
  if (column.kind === "image") {
    const src = safeImage(row.mainImage);
    return src ? <img className="sf-thumb" src={src} alt="商品主图" width={36} height={36} loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <span className="sf-thumb" />;
  }
  if (column.kind === "icon") return <button type="button" className="sf-btn" disabled title={noWrite}>—</button>;
  if (column.kind === "store") {
    const site = sellfoxSiteLabel(row.marketplace);
    return <span className="sf-stack"><span>{text(row.name)}</span><small title={String(row.marketplace ?? "")}>{site || "-"}</small></span>;
  }
  if (column.kind === "mskuPrice") {
    return <span className="sf-stack"><span>{text(row.msku)}</span><small>{money(row.price, row.currency)}</small></span>;
  }
  if (column.kind === "skuName") {
    return <span className="sf-stack"><span>{text(row.title ?? row.identity)}</span><small>{text(row.sku)}</small></span>;
  }
  if (column.kind === "titleAsin") {
    return <span className="sf-stack"><span>{text(row.title)}</span><small className="sf-link">{text(row.asin ?? row.identity)}</small></span>;
  }
  if (column.kind === "asinMsku") {
    return <span className="sf-stack"><span className="sf-link">{text(row.asin)}</span><small>{text(row.msku)}</small></span>;
  }
  return <>{cellText(column, row, metric)}</>;
}

/** 日矩阵列由返回的日期生成，日期本身来自服务端，不按页面推断。 */
function dayColumns(dates: string[]): (ReplicaColumn & { day: string })[] {
  return [...dates].reverse().map((date) => ({
    key: `day:${date}`,
    label: date.slice(5),
    kind: "qty" as const,
    sortable: true,
    day: date,
  }));
}

export function ReplicaWorkbench({ page }: { page: ReplicaPage }) {
  const [ready, setReady] = useState(false);
  const [scope, setScope] = useState(normalizeWorkspaceScope());
  const [draft, setDraft] = useState(() => initialFilters(page));
  const [applied, setApplied] = useState(() => initialFilters(page));
  const [rows, setRows] = useState<Row[]>([]);
  const [failures, setFailures] = useState<{ shopExternalId: string; shopName: string; error: string }[]>([]);
  const [totals, setTotals] = useState<Row[]>([]);
  const [summary, setSummary] = useState<SalesSummary | null>(null);
  const [dates, setDates] = useState<string[]>([]);
  const [total, setTotal] = useState(0);
  const [stores, setStores] = useState<Store[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [actionNotice, setActionNotice] = useState<{ title: string; message: string } | null>(null);
  const [localChecks, setLocalChecks] = useState<Record<string, boolean>>({});
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [cacheInfo, setCacheInfo] = useState<{ status: "hit" | "miss" | "bypass"; cachedAt: string | null } | null>(null);
  const lastRefreshNonce = useRef(refreshNonce);
  const [gotoPage, setGotoPage] = useState("1");
  const [visible, setVisible] = useState<string[]>(() => page.columns.filter((column) => column.defaultVisible !== false).map((column) => column.key));
  const storageKey = `sellfox-replica-columns:${page.id}`;
  const matrix = page.id === "sales";
  // 会话级列宽：拖拽仅当前标签页生效，不写库、不持久化。默认固定为赛狐规格表宽度。
  const { getWidth, startResize, resetWidths } = useSessionColumnWidths(`sellfox-replica:${page.id}`, COLUMN_WIDTH_PX);

  useEffect(() => {
    const saved = localStorage.getItem(storageKey);
    if (!saved) return;
    try {
      const keys = JSON.parse(saved) as unknown;
      if (Array.isArray(keys) && keys.every((key) => typeof key === "string")) {
        const known = keys.filter((key) => page.columns.some((column) => column.key === key));
        if (known.length) setVisible(known);
      }
    } catch { /* keep defaults */ }
  }, [page.columns, storageKey]);

  useEffect(() => {
    setScope(readScope());
    setReady(true);
    // 工作区作用域切换：清掉当前页客户端缓存，避免跨 scope 串数据。
    const changed = () => { clearCachePrefix(page.endpoint); setScope(readScope()); setApplied((current) => ({ ...current, page: 1 })); };
    window.addEventListener(workspaceScopeChangedEventName, changed);
    return () => window.removeEventListener(workspaceScopeChangedEventName, changed);
  }, [page.endpoint]);

  const headers = useMemo(() => ({
    "x-workspace-id": scope.workspaceId,
    ...(scope.accountId ? { "x-account-id": scope.accountId } : {}),
    ...(scope.marketplace ? { "x-marketplace": scope.marketplace } : {}),
  }), [scope]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const params = new URLSearchParams();
    params.set("workspaceId", scope.workspaceId);
    if (scope.accountId) params.set("accountId", scope.accountId);
    if (scope.marketplace) params.set("marketplace", scope.marketplace);
    const url = `/api/sellfox/overview?${params}`;
    const { promise } = cachedFetch<{ stores?: Store[] }>(url, async () => {
      const response = await fetch(url, { headers, cache: "no-store", signal: controller.signal });
      return response.ok ? response.json() as Promise<{ stores?: Store[] }> : { stores: [] };
    }, () => !controller.signal.aborted);
    promise
      .then((body) => { if (!controller.signal.aborted) setStores(body.stores ?? []); })
      .catch(() => { if (!controller.signal.aborted) setStores([]); });
    return () => controller.abort();
  }, [headers, ready, scope]);

  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    const params = new URLSearchParams();
    params.set("page", String(applied.page));
    params.set("pageSize", String(applied.pageSize));
    params.set("workspaceId", scope.workspaceId);
    if (scope.accountId) params.set("accountId", scope.accountId);
    if (scope.marketplace) params.set("marketplace", scope.marketplace);
    if (page.query === "workbench") {
      if (applied.dimension && applied.dimension !== "salesperson") params.set("dimension", applied.dimension);
      if (page.id === "sales") {
        params.set("metric", applied.metric);
        if (applied.grain && applied.grain !== "day") params.set("grain", applied.grain);
      }
      if (applied.from) params.set("from", applied.from);
      if (applied.to) params.set("to", applied.to);
      if (applied.site) params.set("site", applied.site);
      if (applied.shop) params.append("shopExternalId", applied.shop);
      if (applied.fulfillment) params.set("fulfillment", applied.fulfillment);
      if (applied.productTag) params.set("productTag", applied.productTag);
      if ((page.id === "performance" || page.id === "sales") && applied.salesperson) params.set("salesperson", applied.salesperson);
      if (applied.currency) params.set("currency", applied.currency);
      if (applied.hideZero) params.set("hideZero", "1");
      if (applied.onlySettle) params.set("onlySettle", "1");
      if (applied.sortBy) {
        params.set("sortBy", applied.sortBy);
        params.set("sortOrder", applied.sortOrder);
      }
      if (applied.search) {
        params.set("search", applied.search);
        if (applied.searchType) params.set("searchType", applied.searchType);
        if (applied.exact) params.set("exactMatch", "1");
      }
    } else if (page.query === "agent") {
      if (applied.site) params.set("site", applied.site);
      if (applied.shop) params.append("shopExternalId", applied.shop);
      if (applied.fulfillment) params.set("fulfillment", applied.fulfillment);
      if (applied.status) params.set("status", applied.status);
      if (applied.from) params.set("from", applied.from);
      if (applied.to) params.set("to", applied.to);
      if (applied.search) params.set("search", applied.search);
    } else if (page.query === "snapshot") {
      if (applied.dimension) params.set("dimension", applied.dimension);
      if (applied.site) params.set("site", applied.site);
      if (applied.shop) params.append("shopExternalId", applied.shop);
      if (applied.fulfillment) params.set("fulfillment", applied.fulfillment);
      if (applied.status) params.set("status", applied.status);
      if (applied.currency) params.set("currency", applied.currency);
      if (applied.salesperson) params.set("salesperson", applied.salesperson);
      if (applied.from) params.set("from", applied.from);
      if (applied.to) params.set("to", applied.to);
      if (applied.search) {
        params.set("search", applied.search);
        if (applied.searchType) params.set("searchType", applied.searchType);
        if (applied.exact) params.set("exactMatch", "1");
      }
    }
    // 手动刷新：nonce 变化时清掉当前页客户端缓存，强制真实回源。
    if (lastRefreshNonce.current !== refreshNonce) {
      lastRefreshNonce.current = refreshNonce;
      clearCachePrefix(page.endpoint);
    }
    const url = `${page.endpoint}?${params}`;
    setLoading(true);
    setError("");
    type Body = { rows?: Row[]; totals?: Row[]; summary?: SalesSummary; dates?: string[]; pagination?: { total?: number }; facets?: { productTags?: string[]; salespersons?: string[] }; failures?: { shopExternalId: string; shopName: string; error: string }[]; error?: string; message?: string; cache?: { status: "hit" | "miss" | "bypass"; cachedAt: string | null } };
    const { promise } = cachedFetch<Body>(url, async () => {
      const response = await fetch(url, { headers, cache: "no-store", signal: controller.signal });
      const body = await response.json() as Body;
      if (!response.ok) throw new Error(body.error || "读取失败");
      return body;
    }, () => !controller.signal.aborted);
    promise
      .then((body) => {
        if (controller.signal.aborted) return;
        setRows(Array.isArray(body.rows) ? body.rows : []);
        setTotals(Array.isArray(body.totals) ? body.totals : []);
        setSummary(body.summary ?? null);
        setDates(Array.isArray(body.dates) ? body.dates : []);
        setTotal(body.pagination?.total ?? 0);
        setTags(body.facets?.productTags ?? []);
        setPeople(body.facets?.salespersons ?? []);
        setFailures(Array.isArray(body.failures) ? body.failures : []);
        setCacheInfo(body.cache ?? null);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setRows([]);
        setTotals([]);
        setSummary(null);
        setDates([]);
        setTotal(0);
        setFailures([]);
        setCacheInfo(null);
        setError(reason instanceof Error ? reason.message : "读取失败");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [applied, headers, page.endpoint, page.id, page.query, ready, refreshNonce, scope]);

  const days = useMemo(() => (matrix ? dayColumns(dates) : []), [matrix, dates]);
  const columns: ReplicaColumn[] = [...page.columns.filter((column) => visible.includes(column.key)), ...days];
  const sites = [...new Set(stores.map((store) => store.marketplace).filter(Boolean))];
  const pages = Math.max(1, Math.ceil(total / applied.pageSize));
  const metricLabel = page.metrics.find((item) => item.id === applied.metric)?.label ?? "小计";

  useEffect(() => { setGotoPage(String(applied.page)); }, [applied.page]);

  function patchDraft(patch: Partial<Filters>) { setDraft((current) => ({ ...current, ...patch })); }
  function applySearch() { setApplied({ ...draft, page: 1 }); }
  function reset() {
    const next = initialFilters(page);
    setDraft(next);
    setApplied(next);
  }
  function setDimension(id: string) {
    setDraft((current) => ({ ...current, dimension: id, page: 1 }));
    setApplied((current) => ({ ...current, dimension: id, page: 1 }));
  }
  function setMetric(id: string) {
    setDraft((current) => ({ ...current, metric: id, page: 1 }));
    setApplied((current) => ({ ...current, metric: id, page: 1 }));
  }
  function setGrain(value: Filters["grain"]) {
    setDraft((current) => ({ ...current, grain: value, page: 1 }));
    setApplied((current) => ({ ...current, grain: value, page: 1 }));
  }
  function setPreset(preset: DatePreset) {
    const range = preset === "custom" ? { from: draft.from, to: draft.to } : rangeForPreset(preset);
    setDraft((current) => ({ ...current, preset, ...range }));
    setApplied((current) => ({ ...current, preset, ...range, page: 1 }));
  }
  function setPage(pageNumber: number) {
    const safe = Math.min(Math.max(1, pageNumber), pages);
    setDraft((current) => ({ ...current, page: safe }));
    setApplied((current) => ({ ...current, page: safe }));
  }
  function setPageSize(pageSize: number) {
    const next = { ...applied, pageSize, page: 1 };
    setDraft(next);
    setApplied(next);
  }
  function toggleSort(key: string) {
    const next = applied.sortBy === key ? (applied.sortOrder === "desc" ? "asc" : "desc") : "desc";
    setDraft((current) => ({ ...current, sortBy: key, sortOrder: next, page: 1 }));
    setApplied((current) => ({ ...current, sortBy: key, sortOrder: next, page: 1 }));
  }
  function runAction(id: string) {
    if (id === "columns") { setColumnsOpen(true); return; }
    if (id === "refresh") { setRefreshNonce((value) => value + 1); return; }
    if (id === "export") { exportCsv(); return; }
    if (id === "help") {
      setActionNotice({ title: "帮助", message: "本页为赛狐只读复刻：读取已同步快照，不写库。可用维度、筛选、排序、分页、导出（仅当前已加载行）与自定义列；“同步/导入/费用/调价”等写操作需在赛狐 ERP 或同步中心完成，本页点击仅说明状态。" });
      return;
    }
    // 其余按钮（同步、导入、费用、调价、配对等写操作）：接通点击，弹窗说明本地状态，不写库。
    const action = page.actions.find((item) => item.id === id);
    setActionNotice({
      title: action?.label ?? "操作",
      message: `${action?.reason || "该操作会写入赛狐数据。"}\n\n本页是只读复刻，不执行写入。若需真实同步，请到「数据 → 同步中心」使用赛狐同步任务。`,
    });
  }
  function exportCsv() {
    const header = columns.map((column) => column.key === "subtotal" ? metricLabel : column.label);
    const lines = [header, ...rows.map((row) => columns.map((column) => cellText(column, row, applied.metric)))];
    const csv = `\uFEFF${lines.map((line) => line.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n")}`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `sellfox-${page.id}.csv`;
    link.click();
    setNotice("已导出当前页，没有写入数据库。");
  }
  function saveColumns(next: string[]) {
    const keys = page.columns.map((column) => column.key).filter((key) => next.includes(key));
    const chosen = keys.length ? keys : page.columns.map((column) => column.key);
    setVisible(chosen);
    localStorage.setItem(storageKey, JSON.stringify(chosen));
    setColumnsOpen(false);
  }

  /** 汇总行：数量/库存跨币种直接相加；金额按币种分别展示，不混算。 */
  function totalNode(column: ReplicaColumn): ReactNode {
    const currencies = [...new Set(totals.map((item) => String(item.currency ?? "")))].filter(Boolean);
    const singleCurrency = currencies.length === 1 ? currencies[0] : "";
    if (column.key.startsWith("day:")) {
      const day = summary?.daily?.[column.key.slice(4)];
      if (!day || day.value == null) return "-";
      const label = `${day.entities}/${total} 个商品当日有快照`;
      if (applied.metric === "revenue") return singleCurrency ? <span title={label}>{money(day.value, singleCurrency)}</span> : "-";
      return <span title={label}>{qty(day.value)}</span>;
    }
    if (column.key === "quantity") return qty(summary?.quantity);
    if (column.key === "totalInventory") return qty(summary?.totalInventory);
    if (column.key === "fulfillable") return qty(summary?.fulfillable);
    if (column.key === "subtotal") {
      if (applied.metric === "quantity") return qty(summary?.quantity);
      const values = totals.map((item) => numberOf(item.subtotal));
      if (!values.length || values.some((value) => value == null)) return "-";
      if (applied.metric === "orders") return qty(values.reduce<number>((sum, value) => sum + Number(value), 0));
      return totals.map((item, index) => money(values[index], item.currency)).join(" / ");
    }
    return "";
  }

  function sortButton(column: ReplicaColumn) {
    if (!column.sortable) return null;
    const active = applied.sortBy === column.key;
    return (
      <button
        type="button"
        className="sf-sort"
        aria-label={`按${column.label}排序`}
        aria-pressed={active}
        onClick={() => toggleSort(column.key)}
      >
        <span aria-hidden="true">{active ? (applied.sortOrder === "desc" ? "↓" : "↑") : "⇅"}</span>
      </button>
    );
  }

  return (
    <section className="sellfox-ui">
      <SellfoxTabs current={page.href} />
      {page.dimensions.length ? (
        <div className="sf-dims" role="tablist" aria-label="维度">
          {page.dimensions.map((item) => (
            <button key={item.id} type="button" role="tab" aria-current={applied.dimension === item.id ? "page" : undefined} className={item.disabled ? "sf-tab-muted" : undefined} title={item.reason ?? item.label} onClick={() => {
              setDimension(item.id);
              if (item.disabled) setNotice(`${item.label}维度：${MISSING_HINT}`);
            }}>{item.label}</button>
          ))}
        </div>
      ) : null}
      <div className="sf-filter">
        {page.metrics.length ? (
          <div className="sf-metrics" role="group" aria-label="指标">
            {page.metrics.map((item) => <button key={item.id} type="button" aria-pressed={draft.metric === item.id} onClick={() => setMetric(item.id)}>{item.label}</button>)}
          </div>
        ) : null}
        <select aria-label="全部站点" value={draft.site} onChange={(event) => patchDraft({ site: event.target.value })}>
          <option value="">全部站点</option>
          {SITE_REGIONS.map((region) => {
            const inRegion = sites.filter((site) => siteRegionOf(site) === region.label);
            return inRegion.length ? (
              <optgroup key={region.label} label={region.label}>
                {inRegion.map((site) => <option key={site} value={site}>{sellfoxSiteLabel(site)}</option>)}
              </optgroup>
            ) : null;
          })}
          {sites.filter((site) => siteRegionOf(site) === "其他站点").map((site) => <option key={site} value={site}>{sellfoxSiteLabel(site)}</option>)}
        </select>
        <select aria-label="全部店铺" value={draft.shop} onChange={(event) => patchDraft({ shop: event.target.value })}>
          <option value="">全部店铺</option>
          {stores.map((store) => <option key={store.externalId} value={store.externalId}>{store.name}</option>)}
        </select>
        {page.fulfillment ? (
          <select aria-label="发货方式" value={draft.fulfillment} onChange={(event) => patchDraft({ fulfillment: event.target.value })}>
            <option value="">发货方式</option>
            <option value="AFN">FBA</option>
            <option value="MFN">FBM</option>
          </select>
        ) : null}
        {page.status ? (
          <select aria-label={page.id === "listings" ? "在售" : "状态"} value={draft.status} onChange={(event) => patchDraft({ status: event.target.value })}>
            <option value="">{page.id === "shipments" ? "货件状态" : page.id === "restock" ? "补货状态" : "全部状态"}</option>
            {page.id === "listings" ? <>
              <option value="active">在售</option>
              <option value="inActive">停售</option>
              <option value="incomplete">不完整</option>
              <option value="delete">已删除</option>
            </> : page.id === "orders" ? <>
              <option value="Pending">Pending</option>
              <option value="Shipped">Shipped</option>
              <option value="Canceled">Canceled</option>
            </> : page.id === "shipments" ? <>
              <option value="WORKING">待配货</option>
              <option value="READY_TO_SHIP">待发货</option>
              <option value="SHIPPED">已发货</option>
              <option value="IN_TRANSIT">在途</option>
              <option value="DELIVERED">已送达</option>
              <option value="CHECKED_IN">已登记</option>
              <option value="RECEIVING">接收中</option>
              <option value="CLOSED">已关闭</option>
              <option value="CANCELLED">已取消</option>
              <option value="DELETED">已删除</option>
            </> : page.id === "restock" ? <>
              <option value="needs">需要补货</option>
              <option value="covered">无需补货</option>
            </> : <option value="" disabled>待接赛狐</option>}
          </select>
        ) : null}
        {page.tagFilter ? (
          <select aria-label="产品标签" value={draft.productTag} onChange={(event) => patchDraft({ productTag: event.target.value })}>
            <option value="">产品标签</option>
            {tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
          </select>
        ) : page.id === "listings" ? (
          <select aria-label="产品标签" className="sf-select-muted" title="标签筛选会改走另一套汇总 SQL，当前列表不启用。" value={draft.productTag} onChange={(event) => { patchDraft({ productTag: event.target.value }); setNotice(`产品标签：${MISSING_HINT}`); }}>
            <option value="">产品标签</option>
            {tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
          </select>
        ) : null}
        {page.salespersonFilter ? (
          <select aria-label="业务员" value={draft.salesperson} onChange={(event) => patchDraft({ salesperson: event.target.value })}>
            <option value="">业务员</option>
            {people.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        ) : page.id === "sales" || page.id === "listings" ? (
          <select aria-label="业务员" className="sf-select-muted" title="销量日快照没有业务员字段，不从 Listing 伪造。" value={draft.salesperson} onChange={(event) => { patchDraft({ salesperson: event.target.value }); setNotice(`业务员：${MISSING_HINT}`); }}>
            <option value="">业务员</option>
            {people.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        ) : null}
        {page.id === "sales" || page.id === "performance" ? (
          <select aria-label="业绩归属人" className="sf-select-muted" title="本地快照没有业绩归属人。" value={draft.owner} onChange={(event) => { patchDraft({ owner: event.target.value }); setNotice(`业绩归属人：${MISSING_HINT}`); }}>
            <option value="">业绩归属人</option>
            {people.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        ) : null}
        {page.id === "sales" ? <select aria-label="时间粒度" title="日/周/月统计粒度；周按 ISO 周聚合、跨年不串周，缺日不补零" value={draft.grain} onChange={(event) => setGrain(event.target.value as Filters["grain"])}>
          <option value="day">按日</option>
          <option value="week">按周</option>
          <option value="month">按月</option>
        </select> : null}
        {page.showDate ? (
          <>
            <span className="sf-label">{page.dateLabel}</span>
            <select aria-label="日期快捷" value={draft.preset} onChange={(event) => setPreset(event.target.value as DatePreset)}>
              {datePresets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
            <input aria-label="开始日期" type="date" value={draft.from} onChange={(event) => patchDraft({ from: event.target.value, preset: "custom" })} />
            <input aria-label="结束日期" type="date" value={draft.to} onChange={(event) => patchDraft({ to: event.target.value, preset: "custom" })} />
          </>
        ) : null}
        {page.currency ? (
          <select aria-label="原币种" value={draft.currency} onChange={(event) => patchDraft({ currency: event.target.value })}>
            <option value="">原币种</option>
            {CURRENCY_OPTIONS.map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        ) : null}
        {page.id === "sales" ? (
          <select aria-label="按日" className="sf-select-muted" title="快照按日存储，日列即原始粒度；不做周/月重采样。" value={draft.grain} onChange={(event) => { setGrain(event.target.value as Filters["grain"]); setNotice(`统计粒度已切换为「${event.target.value === "day" ? "按日" : event.target.value === "week" ? "按周" : "按月"}」；按周/按月在本地查询层重采样，明细快照仍按日存储。`); }}>
            <option value="day">按日</option>
            <option value="week">按周</option>
            <option value="month">按月</option>
          </select>
        ) : null}
        {page.id === "performance" ? (
          <select aria-label="订购时间" className="sf-select-muted" title="利润日期使用订购时间。" onChange={() => setNotice(`订购时间：${MISSING_HINT}`)}>
            <option>订购时间</option>
          </select>
        ) : null}
        <select aria-label="搜索字段" value={draft.searchType} onChange={(event) => patchDraft({ searchType: event.target.value })}>
          {page.searchTypes.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <input className="sf-search" aria-label="搜索" placeholder="搜索内容" value={draft.search} onChange={(event) => patchDraft({ search: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") applySearch(); }} />
        <label className="sf-check"><input type="checkbox" checked={draft.exact} onChange={(event) => patchDraft({ exact: event.target.checked })} /><span>精确</span></label>
        <button type="button" className="sf-btn sf-btn-primary" onClick={applySearch}>搜索</button>
        <button type="button" className="sf-btn" onClick={reset}>重置</button>
      </div>
      {page.checks.length ? (
        <div className="sf-checks">
          {page.checks.map((item) => {
            const missingToggle = Boolean(item.disabled);
            const checked = item.id === "aggregate"
              ? true
              : item.id === "parentAsin" ? applied.dimension === "parentAsin"
              : item.id === "hideZero" ? draft.hideZero
              : item.id === "onlySettle" ? draft.onlySettle
              : Boolean(localChecks[item.id]);
            return (
              <label key={item.id} className={missingToggle ? "sf-check sf-check-muted" : "sf-check"} title={item.reason ?? item.label}>
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={(event) => {
                    if (item.id === "parentAsin") { setDimension(event.target.checked ? "parentAsin" : "msku"); return; }
                    if (item.id === "hideZero") { patchDraft({ hideZero: event.target.checked }); return; }
                    if (item.id === "onlySettle") { patchDraft({ onlySettle: event.target.checked }); return; }
                    // 数据不足项：接通勾选交互，但结果按缺失占位，不写查询、不补数。
                    setLocalChecks((current) => ({ ...current, [item.id]: event.target.checked }));
                    setNotice(`${item.label}：${MISSING_HINT}`);
                  }}
                />
                <span>{item.id === "aggregate" ? `按${page.dimensions.find((dim) => dim.id === applied.dimension)?.label ?? "维度"}汇总` : item.label}</span>
              </label>
            );
          })}
        </div>
      ) : null}
      <div className="sf-actions">
        <span className="sf-spacer" />
        {page.actions.map((action) => (
          <button key={action.id} type="button" className={action.disabled ? "sf-btn sf-btn-muted" : "sf-btn"} title={action.reason ?? action.label} onClick={() => runAction(action.id)}>{action.label}</button>
        ))}
      </div>
      {cacheInfo?.status === "hit" && cacheInfo.cachedAt ? (
        <p className="sf-notice" role="status">缓存更新于 {cacheTimeLabel(cacheInfo.cachedAt)}；点「刷新」获取实时口径。</p>
      ) : null}
      {notice ? <p className="sf-notice" role="status">{notice}</p> : null}
      {failures.length ? <div className="sf-notice" role="alert">{failures.map((failure) => <p key={`${failure.shopExternalId}-${failure.error}`}>{failure.shopName || failure.shopExternalId || "店铺"}同步失败：{failure.error}</p>)}</div> : null}
      <div className={matrix ? "sf-table-wrap sf-matrix" : "sf-table-wrap"}>
        <table>
          <thead>
            <tr>{columns.map((column) => {
              const width = getWidth(column.key);
              return (
              <th key={column.key} scope="col" style={colWidthStyle(width)} className={column.key.startsWith("day:") ? "sf-day" : column.kind === "qty" || column.kind === "metric" ? "sf-num" : undefined} title={column.hint ?? (column.kind === "missing" ? "赛狐页面有该列，本地快照无对应字段，不造数。" : undefined)}>
                <span className="sf-th-main">{column.label}{sortButton(column)}</span>
                {column.key.startsWith("day:") ? <span className="sf-th-sub">{weekdays[new Date(`${column.key.slice(4)}T00:00:00Z`).getUTCDay()]}</span> : null}
                {width ? <ColumnResizeHandle label={column.label} onPointerDown={(event) => startResize(event, column.key)} onReset={() => resetWidths(column.key)} /> : null}
              </th>
              );
            })}</tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={Math.max(columns.length, 1)}>加载中</td></tr> : null}
            {!loading && error ? <tr><td colSpan={Math.max(columns.length, 1)}>{error}</td></tr> : null}
            {!loading && !error && rows.length === 0 ? (
              <tr><td colSpan={Math.max(columns.length, 1)}>
                <div className="sf-empty" role="status"><strong>{page.emptyTitle}</strong>{page.emptyHint}</div>
              </td></tr>
            ) : null}
            {!loading && !error ? rows.map((row, index) => (
              <tr key={String(row.id ?? index)}>
                {columns.map((column) => (
                  <td key={column.key} style={colWidthStyle(getWidth(column.key))} title={cellText(column, row, applied.metric) || undefined} className={column.key.startsWith("day:") ? "sf-day" : column.kind === "qty" || column.kind === "metric" ? "sf-num" : undefined}>
                    <Cell column={column} row={row} metric={applied.metric} />
                  </td>
                ))}
              </tr>
            )) : null}
          </tbody>
          {matrix && !loading && !error && rows.length ? (
            <tfoot>
              <tr>
                {columns.map((column, index) => (
                  <td key={column.key} style={colWidthStyle(getWidth(column.key))} className={column.key.startsWith("day:") ? "sf-day" : column.kind === "qty" || column.kind === "metric" ? "sf-num" : undefined}>
                    {index === 0 ? <strong>汇总</strong> : totalNode(column)}
                  </td>
                ))}
              </tr>
            </tfoot>
          ) : null}
        </table>
      </div>
      {totals.length && !matrix ? (
        <div className="sf-totals">汇总 {columns.filter((column) => ["qty", "money", "metric"].includes(column.kind ?? "")).map((column) => {
          const value = column.kind === "metric" ? (applied.metric === "revenue" ? money(totals[0].subtotal, totals[0].currency) : qty(totals[0].subtotal)) : column.kind === "money" ? money(totals[0][column.key], totals[0].currency) : qty(totals[0][column.key]);
          return <span key={column.key}>{column.key === "subtotal" ? metricLabel : column.label} {value}</span>;
        })}</div>
      ) : null}
      <div className="sf-pager">
        <span>共 {total} 条</span>
        <button type="button" disabled={applied.page <= 1} onClick={() => setPage(applied.page - 1)}>上一页</button>
        {Array.from({ length: Math.min(pages, 7) }, (_, index) => Math.max(1, Math.min(applied.page - 3, pages - 6)) + index).map((number) => (
          <button key={number} type="button" aria-current={number === applied.page ? "page" : undefined} onClick={() => setPage(number)}>{number}</button>
        ))}
        <button type="button" disabled={applied.page >= pages} onClick={() => setPage(applied.page + 1)}>下一页</button>
        <select aria-label="每页条数" value={applied.pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>
          {[20, 50, 100].map((size) => <option key={size} value={size}>{size}条/页</option>)}
        </select>
        <span>前往</span>
        <input
          className="sf-goto"
          aria-label="前往页码"
          type="number"
          min={1}
          max={pages}
          value={gotoPage}
          onChange={(event) => setGotoPage(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") setPage(Number(gotoPage) || 1); }}
          onBlur={() => setPage(Number(gotoPage) || 1)}
        />
        <span>页</span>
      </div>
      {columnsOpen ? (
        <Dialog open bare zIndex="modal" onClose={() => setColumnsOpen(false)}>
          <div className="sf-modal mx-auto" role="dialog" aria-modal="true" aria-labelledby="sf-columns-title">
            <h2 id="sf-columns-title">自定义列</h2>
            <ColumnPicker columns={page.columns} selected={visible} onCancel={() => setColumnsOpen(false)} onSave={saveColumns} />
          </div>
        </Dialog>
      ) : null}
      {actionNotice ? (
        <Dialog open bare zIndex="modal" onClose={() => setActionNotice(null)}>
          <div className="sf-modal mx-auto" role="dialog" aria-modal="true" aria-labelledby="sf-action-notice-title">
            <h2 id="sf-action-notice-title">{actionNotice.title}</h2>
            <p className="sf-action-notice-body">{actionNotice.message}</p>
            <div className="sf-modal-actions">
              <button type="button" className="sf-btn sf-btn-primary" onClick={() => setActionNotice(null)}>知道了</button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </section>
  );
}

function ColumnPicker({ columns, selected, onCancel, onSave }: { columns: ReplicaColumn[]; selected: string[]; onCancel: () => void; onSave: (keys: string[]) => void }) {
  const [draft, setDraft] = useState(selected);
  return (
    <>
      <div className="sf-modal-grid">
        {columns.map((column) => (
          <label key={column.key} className="sf-check">
            <input type="checkbox" checked={draft.includes(column.key)} onChange={(event) => setDraft((current) => event.target.checked ? [...current, column.key] : current.filter((key) => key !== column.key))} />
            <span>{column.label}</span>
          </label>
        ))}
      </div>
      <div className="sf-modal-actions">
        <button type="button" className="sf-btn" onClick={onCancel}>取消</button>
        <button type="button" className="sf-btn sf-btn-primary" onClick={() => onSave(draft)}>确定</button>
      </div>
    </>
  );
}
