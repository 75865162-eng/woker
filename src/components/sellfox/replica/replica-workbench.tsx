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
  sellfoxAsinHref, sellfoxRowTrend, sellfoxTrendAverage, sellfoxTrendChange, sellfoxDrillHref,
} from "@/lib/sellfox/row-actions";
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
  sites: string[];
  shop: string;
  shops: string[];
  fulfillment: string;
  status: string;
  productTag: string;
  salesperson: string;
  salespersons: string[];
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
    sites: [],
    shop: "",
    shops: [],
    fulfillment: "",
    status: "",
    productTag: "",
    salesperson: "",
    salespersons: [],
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

function AsinLink({ asin, fallback }: { asin: unknown; fallback: string }) {
  const href = sellfoxAsinHref(asin);
  if (!href) return <>{fallback}</>;
  return <a className="sf-link" href={href} target="_blank" rel="noopener noreferrer" title={`在亚马逊打开 ${fallback}`}>{fallback}</a>;
}

type CellProps = {
  column: ReplicaColumn;
  row: Row;
  metric: string;
  drillParams: URLSearchParams;
  onTrend: (row: Row) => void;
};
function Cell({ column, row, metric, drillParams, onTrend }: CellProps) {
  if (column.kind === "image") {
    const src = safeImage(row.mainImage);
    return src ? <img className="sf-thumb" src={src} alt="商品主图" width={36} height={36} loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <span className="sf-thumb" />;
  }
  if (column.kind === "icon") {
    const asin = row.asin ?? row.identity;
    const asinOk = Boolean(sellfoxAsinHref(asin));
    if (column.key === "analysis") {
      return <button type="button" className="sf-btn" disabled={!asinOk} title={asinOk ? "查看该 ASIN 的趋势与对比" : "无有效 ASIN，无法查看趋势"} onClick={() => onTrend(row)}>📈</button>;
    }
    if (column.key === "operations" || column.key === "insight") {
      const href = sellfoxDrillHref(column.key === "operations" ? "listings" : "insight", drillParams, { asin, msku: row.msku });
      if (!asinOk && !mskuOk(row.msku)) return <button type="button" className="sf-btn" disabled title="无 ASIN/MSKU，无法下钻">↗</button>;
      return <a className="sf-btn" href={href} target="_blank" rel="noopener noreferrer" title="在新标签打开并携带当前筛选">↗</a>;
    }
    return <button type="button" className="sf-btn" disabled title={noWrite}>—</button>;
  }
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
    return <span className="sf-stack"><span>{text(row.title)}</span><small><AsinLink asin={row.asin ?? row.identity} fallback={text(row.asin ?? row.identity)} /></small></span>;
  }
  if (column.kind === "asinMsku") {
    return <span className="sf-stack"><span><AsinLink asin={row.asin} fallback={text(row.asin)} /></span><small>{text(row.msku)}</small></span>;
  }
  if (column.key === "asin") return <AsinLink asin={row.asin} fallback={text(row.asin)} />;
  return <>{cellText(column, row, metric)}</>;
}
function mskuOk(value: unknown) { return typeof value === "string" && Boolean(value.trim()); }

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
  const [trendRow, setTrendRow] = useState<Row | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"csv" | "xlsx">("csv");
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
      if (applied.sites.length) params.set("sites", applied.sites.join(","));
      else if (applied.site) params.set("site", applied.site);
      if (applied.shops.length) params.set("shopExternalIds", applied.shops.join(","));
      else if (applied.shop) params.append("shopExternalId", applied.shop);
      if (applied.fulfillment) params.set("fulfillment", applied.fulfillment);
      if (applied.productTag) params.set("productTag", applied.productTag);
      if ((page.id === "performance" || page.id === "sales") && applied.salespersons.length) params.set("salespersons", applied.salespersons.join(","));
      else if ((page.id === "performance" || page.id === "sales") && applied.salesperson) params.set("salesperson", applied.salesperson);
      if (applied.currency) params.set("currency", applied.currency);
      if (applied.hideZero) params.set("hideZero", "1");
      if (applied.onlySettle) params.set("onlySettle", "1");
      if (applied.sortBy) {
        params.set("sortBy", applied.sortBy);
        params.set("sortOrder", applied.sortOrder);
      }
      if (applied.search) {
        // 批量搜索：含换行/逗号切分 → searchTerms；单值仍走 search，兼容旧行为。
        const batch = applied.search.split(/[\r\n,，]/).map((term) => term.trim()).filter(Boolean);
        if (batch.length > 1) params.set("searchTerms", batch.join(","));
        else params.set("search", applied.search);
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
  // 当前筛选上下文（白名单键），用于行内跳转原样还原，不拼用户可控任意键。
  const drillParams = useMemo(() => {
    const p = new URLSearchParams();
    if (applied.from) p.set("from", applied.from);
    if (applied.to) p.set("to", applied.to);
    if (applied.sites.length) p.set("sites", applied.sites.join(","));
    else if (applied.site) p.set("site", applied.site);
    if (applied.shops.length) p.set("shopExternalIds", applied.shops.join(","));
    else if (applied.shop) p.set("shopExternalId", applied.shop);
    if (applied.salespersons.length) p.set("salespersons", applied.salespersons.join(","));
    else if (applied.salesperson) p.set("salesperson", applied.salesperson);
    if (applied.fulfillment) p.set("fulfillment", applied.fulfillment);
    if (applied.productTag) p.set("productTag", applied.productTag);
    if (applied.currency) p.set("currency", applied.currency);
    if (applied.grain !== "day") p.set("grain", applied.grain);
    if (applied.metric) p.set("metric", applied.metric);
    if (applied.dimension) p.set("dimension", applied.dimension);
    if (applied.searchType) p.set("searchType", applied.searchType);
    if (applied.exact) p.set("exactMatch", "1");
    return p;
  }, [applied]);
  const columnByKey = new Map(page.columns.map((column) => [column.key, column]));
  // 按用户保存的顺序排列可见列（支持列拖拽排序），再追加日矩阵列。
  const columns: ReplicaColumn[] = [
    ...visible.map((key) => columnByKey.get(key)).filter((column): column is ReplicaColumn => Boolean(column)),
    ...days,
  ];
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
    if (Number.isFinite(pageNumber) && pageNumber !== safe) {
      setNotice(`页码 ${pageNumber} 超出范围，已跳转到第 ${safe} 页（共 ${pages} 页）。`);
    }
    setDraft((current) => ({ ...current, page: safe }));
    setApplied((current) => ({ ...current, page: safe }));
    setGotoPage(String(safe));
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
    if (id === "export") { setExportOpen(true); return; }
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
  /** 服务端全量导出 URL：带当前筛选 + 可见列 + 工作区；格式 CSV/xlsx 由服务端生成，缺失值保持空不补 0。 */
  function serverExportUrl(format: "csv" | "xlsx"): string {
    const params = new URLSearchParams(drillParams);
    params.set("workspaceId", scope.workspaceId);
    if (scope.accountId) params.set("accountId", scope.accountId);
    if (scope.marketplace) params.set("marketplace", scope.marketplace);
    params.set("columns", "custom");
    for (const key of visible) params.append("column", key);
    params.set("format", format);
    const domain = page.id === "sales" || page.id === "performance" ? page.id : "sales";
    return `/api/sellfox/${domain}/export?${params}`;
  }
  function runServerExport() {
    const url = serverExportUrl(exportFormat);
    window.open(url, "_blank", "noopener,noreferrer");
    setExportOpen(false);
    setNotice(`已在后台生成${exportFormat === "xlsx" ? " Excel" : " CSV"} 文件：按当前筛选导出全部结果（不是仅当前页），未写入数据库。`);
  }
  function exportCurrentPageCsv() {
    const header = columns.map((column) => column.key === "subtotal" ? metricLabel : column.label);
    const lines = [header, ...rows.map((row) => columns.map((column) => cellText(column, row, applied.metric)))];
    const csv = `\uFEFF${lines.map((line) => line.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n")}`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `sellfox-${page.id}-current-page.csv`;
    link.click();
    setExportOpen(false);
    setNotice("已导出当前页，没有写入数据库。");
  }
  function saveColumns(next: string[]) {
    // 保留用户拖拽顺序，仅过滤掉未知列；空选择回退到默认全部列，不放行空表头。
    const known = new Set(page.columns.map((column) => column.key));
    const chosen = next.filter((key, index) => known.has(key) && next.indexOf(key) === index);
    const finalKeys = chosen.length ? chosen : page.columns.map((column) => column.key);
    setVisible(finalKeys);
    localStorage.setItem(storageKey, JSON.stringify(finalKeys));
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
        <select
          aria-label="站点多选"
          multiple
          size={3}
          title="按住 Ctrl/Cmd 可多选站点；不选即全部站点"
          value={draft.sites}
          onChange={(event) => patchDraft({ sites: Array.from(event.target.selectedOptions).map((option) => option.value) })}
        >
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
        <select
          aria-label="店铺多选"
          multiple
          size={3}
          title="按住 Ctrl/Cmd 可多选店铺；不选即全部店铺"
          value={draft.shops}
          onChange={(event) => patchDraft({ shops: Array.from(event.target.selectedOptions).map((option) => option.value) })}
        >
          {stores
            .filter((store) => !draft.sites.length || draft.sites.includes(store.marketplace))
            .map((store) => <option key={store.externalId} value={store.externalId}>{store.name}</option>)}
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
          <select
            aria-label="业务员多选"
            multiple
            size={3}
            title="按住 Ctrl/Cmd 可多选业务员；不选即全部"
            value={draft.salespersons}
            onChange={(event) => patchDraft({ salespersons: Array.from(event.target.selectedOptions).map((option) => option.value) })}
          >
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
                <div className="sf-empty" role="status">
                  <span className="sf-empty-mark" aria-hidden="true">◱</span>
                  <strong>{page.emptyTitle}</strong>
                  <span>{page.emptyHint}</span>
                  {(page.id === "sales" || page.id === "performance") ? <small>若尚未同步，请到「数据 → 同步中心」拉取快照后刷新本页。</small> : null}
                </div>
              </td></tr>
            ) : null}
            {!loading && !error ? rows.map((row, index) => (
              <tr key={String(row.id ?? index)}>
                {columns.map((column) => (
                  <td key={column.key} style={colWidthStyle(getWidth(column.key))} title={cellText(column, row, applied.metric) || undefined} className={column.key.startsWith("day:") ? "sf-day" : column.kind === "qty" || column.kind === "metric" ? "sf-num" : undefined}>
                    <Cell column={column} row={row} metric={applied.metric} drillParams={drillParams} onTrend={setTrendRow} />
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
          {[20, 50, 100, 200].map((size) => <option key={size} value={size}>{size}条/页</option>)}
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
      {trendRow ? (
        <Dialog open bare zIndex="modal" onClose={() => setTrendRow(null)}>
          <TrendDialog
            row={trendRow}
            dates={dates}
            metricLabel={metricLabel}
            onClose={() => setTrendRow(null)}
          />
        </Dialog>
      ) : null}
      {exportOpen ? (
        <Dialog open bare zIndex="modal" onClose={() => setExportOpen(false)}>
          <div className="sf-modal mx-auto" role="dialog" aria-modal="true" aria-labelledby="sf-export-title">
            <h2 id="sf-export-title">导出数据</h2>
            <p className="sf-notice">按当前筛选导出服务端全部结果（最多 10,000 行），不是仅当前页。金额按币种分列，缺失保持空白不补 0。</p>
            <div className="sf-export-options" role="radiogroup" aria-label="导出格式">
              <label><input type="radio" name="sf-export-format" checked={exportFormat === "csv"} onChange={() => setExportFormat("csv")} /> CSV</label>
              <label><input type="radio" name="sf-export-format" checked={exportFormat === "xlsx"} onChange={() => setExportFormat("xlsx")} /> Excel (.xlsx)</label>
            </div>
            <div className="sf-modal-actions">
              <button type="button" className="sf-btn" onClick={() => setExportOpen(false)}>取消</button>
              <button type="button" className="sf-btn" onClick={exportCurrentPageCsv}>仅导出当前页 CSV</button>
              <button type="button" className="sf-btn sf-btn-primary" onClick={runServerExport}>导出全部</button>
            </div>
          </div>
        </Dialog>
      ) : null}
      {columnsOpen ? (
        <Dialog open bare zIndex="modal" onClose={() => setColumnsOpen(false)}>
          <div className="sf-modal mx-auto" role="dialog" aria-modal="true" aria-labelledby="sf-columns-title">
            <h2 id="sf-columns-title">自定义列</h2>
            <ColumnPicker
              columns={page.columns}
              selected={visible}
              defaultKeys={page.columns.filter((column) => column.defaultVisible !== false).map((column) => column.key)}
              onCancel={() => setColumnsOpen(false)}
              onSave={saveColumns}
            />
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

function TrendDialog({ row, dates, metricLabel, onClose }: { row: Row; dates: string[]; metricLabel: string; onClose: () => void }) {
  const points = useMemo(() => sellfoxRowTrend(row, dates), [row, dates]);
  const change = sellfoxTrendChange(points);
  const avg7 = sellfoxTrendAverage(points, 7);
  const avg30 = sellfoxTrendAverage(points, 30);
  const asin = typeof row.asin === "string" ? row.asin : typeof row.identity === "string" ? row.identity : "";
  const pct = change.ratio == null ? "-" : `${change.ratio >= 0 ? "+" : ""}${(change.ratio * 100).toFixed(2)}%`;
  const max = Math.max(1, ...points.map((p) => p.value ?? 0));
  return (
    <div className="sf-modal mx-auto" role="dialog" aria-modal="true" aria-labelledby="sf-trend-title">
      <h2 id="sf-trend-title">趋势与对比 · {text(asin || row.msku || row.sku)}</h2>
      <p className="sf-notice">{metricLabel} · 数据来自当前筛选下的已同步快照；缺日显示「-」，不补零。</p>
      <div className="sf-trend-stats">
        <span>最新 <strong>{change.latest == null ? "-" : qty(change.latest)}</strong></span>
        <span>上一 <strong>{change.previous == null ? "-" : qty(change.previous)}</strong></span>
        <span>环比 <strong>{pct}</strong></span>
        <span>近7天均值 <strong>{avg7 == null ? "-" : qty(avg7, 2)}</strong></span>
        <span>近30天均值 <strong>{avg30 == null ? "-" : qty(avg30, 2)}</strong></span>
      </div>
      {points.length ? (
        <svg className="sf-trend-chart" viewBox="0 0 320 80" role="img" aria-label={`${metricLabel}趋势`} preserveAspectRatio="none">
          <polyline
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            points={points.map((p, i) => {
              const x = points.length === 1 ? 0 : (i / (points.length - 1)) * 320;
              const y = p.value == null ? 80 : 80 - (p.value / max) * 72;
              return `${x},${y}`;
            }).join(" ")}
          />
        </svg>
      ) : null}
      <div className="sf-trend-table">
        {[...points].reverse().map((p) => (
          <div key={p.date}><span>{p.date}</span><strong>{p.value == null ? "-" : qty(p.value)}</strong></div>
        ))}
      </div>
      <div className="sf-modal-actions">
        <button type="button" className="sf-btn sf-btn-primary" onClick={onClose}>关闭</button>
      </div>
    </div>
  );
}

function columnGroup(key: string, kind?: string): string {
  if (["image", "asin", "parentAsin", "msku", "mskuPrice", "sku", "skuName", "title", "titleAsin", "asinMsku", "store", "spu", "productTags", "brand", "model", "salesperson", "owner", "category", "analysis", "operations", "insight", "identity", "opLabel"].includes(key)) return "基本信息";
  if (["fulfillable", "totalInventory", "unfulfillable", "reserved", "reservedQty", "inTransit", "inboundWorking", "inboundShipped", "inboundReceiving", "fbmAvailable", "awdInventory", "awdInTransit", "awdAvailable", "awdReserved", "awdToFba", "availableDays", "cover", "warehousing", "unsellable", "daily", "suggest", "suggestDate", "local", "avg7", "avg14", "avg30"].includes(key)) return "库存与补货";
  if (["quantity", "revenue", "orders", "subtotal", "grossProfit", "grossProfitRate", "netProfitRate", "saleRevenue", "netRevenue", "orderNum", "saleQuantity", "evaluationSaleNum", "channelSaleNum", "promotionDiscount", "giftWrapFee"].includes(key) || kind === "money" || kind === "rate" || kind === "metric") return "销售与利润";
  return "其他";
}
const COLUMN_GROUPS = ["基本信息", "库存与补货", "销售与利润", "其他"];

function ColumnPicker({ columns, selected, defaultKeys, onCancel, onSave }: { columns: ReplicaColumn[]; selected: string[]; defaultKeys: string[]; onCancel: () => void; onSave: (keys: string[]) => void }) {
  const [draft, setDraft] = useState(selected);
  const [query, setQuery] = useState("");
  const [dragKey, setDragKey] = useState<string | null>(null);
  const labelOf = (key: string) => columns.find((column) => column.key === key)?.label ?? key;
  const filtered = columns.filter((column) => !query || column.label.includes(query) || column.key.toLowerCase().includes(query.toLowerCase()));
  function toggle(key: string) {
    setDraft((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  }
  function dropOn(targetKey: string) {
    setDraft((current) => {
      if (!dragKey || dragKey === targetKey || !current.includes(dragKey) || !current.includes(targetKey)) return current;
      const next = current.filter((key) => key !== dragKey);
      next.splice(next.indexOf(targetKey), 0, dragKey);
      return next;
    });
    setDragKey(null);
  }
  return (
    <>
      <div className="sf-column-toolbar">
        <input className="sf-search" aria-label="搜索字段" placeholder="搜索列名或字段" value={query} onChange={(event) => setQuery(event.target.value)} />
        <button type="button" className="sf-btn" onClick={() => setDraft(defaultKeys)}>恢复默认</button>
      </div>
      <p className="sf-notice">已选 {draft.length} / {columns.length} 列。拖拽「已选顺序」可调整列位置。</p>
      <div className="sf-column-selected" aria-label="已选列顺序">
        {draft.map((key) => (
          <span
            key={key}
            className="sf-column-chip"
            draggable
            onDragStart={() => setDragKey(key)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={() => dropOn(key)}
            title="拖拽调整顺序"
          >{labelOf(key)}</span>
        ))}
      </div>
      <div className="sf-column-groups">
        {COLUMN_GROUPS.map((group) => {
          const items = filtered.filter((column) => columnGroup(column.key, column.kind) === group);
          if (!items.length) return null;
          return (
            <fieldset key={group} className="sf-column-group">
              <legend>{group}</legend>
              <div className="sf-modal-grid">
                {items.map((column) => (
                  <label key={column.key} className="sf-check" title={column.hint ?? (column.kind === "missing" ? "本地无此字段，导出保持空白。" : undefined)}>
                    <input type="checkbox" checked={draft.includes(column.key)} onChange={() => toggle(column.key)} />
                    <span>{column.label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          );
        })}
      </div>
      <div className="sf-modal-actions">
        <button type="button" className="sf-btn" onClick={onCancel}>取消</button>
        <button type="button" className="sf-btn sf-btn-primary" onClick={() => onSave(draft)}>确定</button>
      </div>
    </>
  );
}
