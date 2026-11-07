"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { normalizeWorkspaceScope } from "@/lib/workspace/scope";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import {
  datePresets,
  rangeForPreset,
  replicaPages,
  type DatePreset,
  type ReplicaColumn,
  type ReplicaPage,
} from "@/lib/sellfox/replica-pages";

type Row = Record<string, unknown>;
type Store = { externalId: string; name: string; marketplace: string };
type Filters = {
  dimension: string;
  metric: string;
  preset: DatePreset;
  from: string;
  to: string;
  site: string;
  shop: string;
  fulfillment: string;
  status: string;
  productTag: string;
  salesperson: string;
  currency: string;
  searchType: string;
  search: string;
  exact: boolean;
  hideZero: boolean;
  onlySettle: boolean;
  page: number;
  pageSize: number;
};

const noWrite = "此复刻页只读，不把同步或导入写入数据库。";

function readScope() {
  try { return normalizeWorkspaceScope(JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") ?? "{}")); }
  catch { return normalizeWorkspaceScope(); }
}

function initialFilters(page: ReplicaPage): Filters {
  const ranged = page.showDate && page.query !== "agent";
  const range = ranged ? rangeForPreset("d30") : { from: "", to: "" };
  return {
    dimension: page.dimensions.find((item) => !item.disabled)?.id ?? "",
    metric: page.metrics[0]?.id ?? "quantity",
    preset: ranged ? "d30" : "custom",
    from: range.from,
    to: range.to,
    site: "",
    shop: "",
    fulfillment: "",
    status: "",
    productTag: "",
    salesperson: "",
    currency: "",
    searchType: page.searchTypes[0]?.id ?? "",
    search: "",
    exact: false,
    hideZero: false,
    onlySettle: false,
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

function safeImage(value: unknown) {
  return typeof value === "string" && /^https?:\/\//.test(value) ? value : "";
}

function cellText(column: ReplicaColumn, row: Row, metric: string) {
  if (column.kind === "image" || column.kind === "icon") return "";
  if (column.kind === "missing") return "-";
  if (column.kind === "store") return [row.name, row.marketplace].filter(Boolean).join(" / ") || "-";
  if (column.kind === "mskuPrice") return [text(row.msku), money(row.price, row.currency)].join(" / ");
  if (column.kind === "skuName") return [text(row.title), text(row.sku)].filter((item) => item !== "-").join(" / ") || "-";
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
    return <span className="sf-stack"><span>{text(row.name)}</span><small>{text(row.marketplace)}</small></span>;
  }
  if (column.kind === "mskuPrice") {
    return <span className="sf-stack"><span>{text(row.msku)}</span><small>{money(row.price, row.currency)}</small></span>;
  }
  if (column.kind === "skuName") {
    return <span className="sf-stack"><span>{text(row.sku)}</span><small>{text(row.title)}</small></span>;
  }
  if (column.kind === "titleAsin") {
    return <span className="sf-stack"><span>{text(row.title)}</span><small className="sf-link">{text(row.asin ?? row.identity)}</small></span>;
  }
  if (column.kind === "asinMsku") {
    return <span className="sf-stack"><span className="sf-link">{text(row.asin)}</span><small>{text(row.msku)}</small></span>;
  }
  return <>{cellText(column, row, metric)}</>;
}

export function ReplicaWorkbench({ page }: { page: ReplicaPage }) {
  const [ready, setReady] = useState(false);
  const [scope, setScope] = useState(normalizeWorkspaceScope());
  const [draft, setDraft] = useState(() => initialFilters(page));
  const [applied, setApplied] = useState(() => initialFilters(page));
  const [rows, setRows] = useState<Row[]>([]);
  const [failures, setFailures] = useState<{ shopExternalId: string; shopName: string; error: string }[]>([]);
  const [totals, setTotals] = useState<Row | null>(null);
  const [total, setTotal] = useState(0);
  const [stores, setStores] = useState<Store[]>([]);
  const [tags, setTags] = useState<string[]>([]);
  const [people, setPeople] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [visible, setVisible] = useState<string[]>(() => page.columns.map((column) => column.key));
  const storageKey = `sellfox-replica-columns:${page.id}`;

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
    const changed = () => { setScope(readScope()); setApplied((current) => ({ ...current, page: 1 })); };
    window.addEventListener(workspaceScopeChangedEventName, changed);
    return () => window.removeEventListener(workspaceScopeChangedEventName, changed);
  }, []);

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
    fetch(`/api/sellfox/overview?${params}`, { headers, cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<{ stores?: Store[] }> : { stores: [] })
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
      if (page.id === "sales") params.set("metric", applied.metric);
      if (applied.from) params.set("from", applied.from);
      if (applied.to) params.set("to", applied.to);
      if (applied.site) params.set("site", applied.site);
      if (applied.shop) params.append("shopExternalId", applied.shop);
      if (applied.fulfillment) params.set("fulfillment", applied.fulfillment);
      if (applied.productTag) params.set("productTag", applied.productTag);
      if (page.id === "performance" && applied.salesperson) params.set("salesperson", applied.salesperson);
      if (applied.currency) params.set("currency", applied.currency);
      if (applied.hideZero) params.set("hideZero", "1");
      if (applied.onlySettle) params.set("onlySettle", "1");
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
    setLoading(true);
    setError("");
    fetch(`${page.endpoint}?${params}`, { headers, cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as { rows?: Row[]; totals?: Row[]; pagination?: { total?: number }; facets?: { productTags?: string[]; salespersons?: string[] }; failures?: { shopExternalId: string; shopName: string; error: string }[]; error?: string; message?: string };
        if (!response.ok) throw new Error(body.error || "读取失败");
        return body;
      })
      .then((body) => {
        if (controller.signal.aborted) return;
        setRows(Array.isArray(body.rows) ? body.rows : []);
        setTotals(Array.isArray(body.totals) && body.totals[0] ? body.totals[0] : null);
        setTotal(body.pagination?.total ?? 0);
        setTags(body.facets?.productTags ?? []);
        setPeople(body.facets?.salespersons ?? []);
        setFailures(Array.isArray(body.failures) ? body.failures : []);
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setRows([]);
        setTotals(null);
        setTotal(0);
        setFailures([]);
        setError(reason instanceof Error ? reason.message : "读取失败");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [applied, headers, page.endpoint, page.id, page.query, ready, refreshNonce, scope]);

  const columns = page.columns.filter((column) => visible.includes(column.key));
  const sites = [...new Set(stores.map((store) => store.marketplace).filter(Boolean))];
  const pages = Math.max(1, Math.ceil(total / applied.pageSize));
  const metricLabel = page.metrics.find((item) => item.id === applied.metric)?.label ?? "小计";

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
  function setPreset(preset: DatePreset) {
    const range = preset === "custom" ? { from: draft.from, to: draft.to } : rangeForPreset(preset);
    setDraft((current) => ({ ...current, preset, ...range }));
    setApplied((current) => ({ ...current, preset, ...range, page: 1 }));
  }
  function setPage(pageNumber: number) {
    setDraft((current) => ({ ...current, page: pageNumber }));
    setApplied((current) => ({ ...current, page: pageNumber }));
  }
  function setPageSize(pageSize: number) {
    const next = { ...applied, pageSize, page: 1 };
    setDraft(next);
    setApplied(next);
  }
  function runAction(id: string) {
    if (id === "columns") setColumnsOpen(true);
    else if (id === "refresh") setRefreshNonce((value) => value + 1);
    else if (id === "export") exportCsv();
    else if (id === "help") setNotice("只读复刻：按钮不会创建同步任务，导出只下载当前页已加载的行。");
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

  return (
    <section className="sellfox-ui">
      <nav className="sf-tabs" aria-label="赛狐复刻页面">
        {replicaPages.map((item) => <Link key={item.id} href={item.href} aria-current={item.id === page.id ? "page" : undefined}>{item.title}</Link>)}
      </nav>
      {page.dimensions.length ? (
        <div className="sf-dims" role="tablist" aria-label="维度">
          {page.dimensions.map((item) => (
            <button key={item.id} type="button" role="tab" aria-current={!item.disabled && applied.dimension === item.id ? "page" : undefined} disabled={item.disabled} title={item.reason} onClick={() => setDimension(item.id)}>{item.label}</button>
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
          {sites.map((site) => <option key={site} value={site}>{site}</option>)}
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
        ) : page.id === "listings" ? <select aria-label="产品标签" disabled title="标签筛选会改走另一套汇总 SQL，当前列表不启用。"><option>产品标签</option></select> : null}
        {page.salespersonFilter ? (
          <select aria-label="业务员" value={draft.salesperson} onChange={(event) => patchDraft({ salesperson: event.target.value })}>
            <option value="">业务员</option>
            {people.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        ) : page.id === "sales" || page.id === "listings" ? <select aria-label="业务员" disabled title="销量日快照没有业务员字段，不从 Listing 伪造。"><option>业务员</option></select> : null}
        {page.id === "sales" || page.id === "performance" ? <select aria-label="业绩归属人" disabled title="本地快照没有业绩归属人。"><option>业绩归属人</option></select> : null}
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
            {["USD", "EUR", "GBP", "JPY", "CAD"].map((code) => <option key={code} value={code}>{code}</option>)}
          </select>
        ) : null}
        {page.id === "sales" ? <select aria-label="按日" disabled title="本地快照按日存储，不改周/月汇总。"><option>按日</option></select> : null}
        {page.id === "performance" ? <select aria-label="订购时间" disabled title="利润日期使用订购时间。"><option>订购时间</option></select> : null}
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
          {page.checks.map((item) => (
            <label key={item.id} className="sf-check" title={item.reason}>
              <input
                type="checkbox"
                disabled={item.disabled}
                checked={item.id === "aggregate" ? true : item.id === "hideZero" ? draft.hideZero : item.id === "onlySettle" ? draft.onlySettle : false}
                onChange={(event) => {
                  if (item.id === "hideZero") patchDraft({ hideZero: event.target.checked });
                  if (item.id === "onlySettle") patchDraft({ onlySettle: event.target.checked });
                }}
              />
              <span>{item.id === "aggregate" ? `按${page.dimensions.find((dim) => dim.id === applied.dimension)?.label ?? "维度"}汇总` : item.label}</span>
            </label>
          ))}
        </div>
      ) : null}
      <div className="sf-actions">
        <span className="sf-spacer" />
        {page.actions.map((action) => (
          <button key={action.id} type="button" className="sf-btn" disabled={action.disabled} title={action.reason} onClick={() => runAction(action.id)}>{action.label}</button>
        ))}
      </div>
      {notice ? <p className="sf-notice" role="status">{notice}</p> : null}
      {failures.length ? <div className="sf-notice" role="alert">{failures.map((failure) => <p key={`${failure.shopExternalId}-${failure.error}`}>{failure.shopName || failure.shopExternalId || "店铺"}同步失败：{failure.error}</p>)}</div> : null}
      <div className="sf-table-wrap">
        <table>
          <thead>
            <tr>{columns.map((column) => <th key={column.key} scope="col">{column.key === "subtotal" ? metricLabel : column.label}</th>)}</tr>
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
              <tr key={String(row.id ?? index)}>{columns.map((column) => <td key={column.key}><Cell column={column} row={row} metric={applied.metric} /></td>)}</tr>
            )) : null}
          </tbody>
        </table>
      </div>
      {totals && !page.stub ? (
        <div className="sf-totals">汇总 {columns.filter((column) => ["qty", "money", "metric"].includes(column.kind ?? "")).map((column) => {
          const value = column.kind === "metric" ? (applied.metric === "revenue" ? money(totals.subtotal, totals.currency) : qty(totals.subtotal)) : column.kind === "money" ? money(totals[column.key], totals.currency) : qty(totals[column.key]);
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
      </div>
      {columnsOpen ? (
        <div className="sf-modal-back" role="presentation" onClick={() => setColumnsOpen(false)}>
          <div className="sf-modal" role="dialog" aria-modal="true" aria-labelledby="sf-columns-title" onClick={(event) => event.stopPropagation()}>
            <h2 id="sf-columns-title">自定义列</h2>
            <ColumnPicker columns={page.columns} selected={visible} onCancel={() => setColumnsOpen(false)} onSave={saveColumns} />
          </div>
        </div>
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
