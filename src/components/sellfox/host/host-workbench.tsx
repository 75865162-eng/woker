"use client";

import { useEffect, useMemo, useState } from "react";
import { cachedApiGet } from "@/lib/workspace/workspace-api-cache";
import { useStores, useSellfoxReferenceStore } from "@/lib/stores/sellfox-reference-store";
import Link from "next/link";
import { SellfoxTabs } from "../sellfox-nav";
import { ColumnResizeHandle } from "@/components/ui/column-resize-handle";
import { useSessionColumnWidths } from "@/lib/hooks/use-session-column-widths";
import { sellfoxSiteLabel } from "@/lib/sellfox/marketplace-site";
import { rangeForPreset, shanghaiToday, type DatePreset } from "@/lib/sellfox/replica-pages";
import { hostStatusLabel, type HostColumn, type HostDataset, type HostPage } from "@/lib/sellfox/host-pages";

type Row = Record<string, unknown>;
type Store = { externalId: string; name: string; marketplace: string };
type Totals = {
  impressions: number | null;
  clicks: number | null;
  adOrders: number | null;
  byCurrency: { currency: string; values: Record<string, number | null> }[];
  quantity?: number | null;
  totalInventory?: number | null;
  unfulfillable?: number | null;
};
type Payload = { rows?: Row[]; total?: number; totals?: Totals; coverage?: { stores: number; rows: number }; error?: string; columns?: HostColumn[] | null };

const emptyTotals: Totals = { impressions: null, clicks: null, adOrders: null, byCurrency: [] };
const presets: { id: Exclude<DatePreset, "today" | "yesterday" | "thisMonth" | "lastMonth">; label: string }[] = [
  { id: "d7", label: "近7天" },
  { id: "d14", label: "近14天" },
  { id: "d30", label: "近30天" },
  { id: "d90", label: "近90天" },
];

function numberOf(value: unknown) {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function qty(value: unknown, digits = 0) {
  const parsed = numberOf(value);
  return parsed == null ? "-" : new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(parsed);
}

function money(value: unknown, currency: unknown) {
  const parsed = numberOf(value);
  if (parsed == null) return "-";
  const code = typeof currency === "string" && currency ? currency : "";
  const body = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(parsed);
  return code === "USD" ? `US$${body}` : code ? `${code} ${body}` : body;
}

function rate(value: unknown) {
  const parsed = numberOf(value);
  return parsed == null ? "-" : `${(parsed * 100).toFixed(2)}%`;
}

function text(value: unknown) {
  if (value == null || value === "") return "-";
  return String(value);
}

function safeImage(value: unknown) {
  return typeof value === "string" && /^https?:\/\//.test(value) ? value : "";
}

function cellText(column: HostColumn, row: Row) {
  if (column.kind === "image") return "";
  if (column.kind === "qty") return qty(row[column.key]);
  if (column.kind === "decimal") return qty(row[column.key], 2);
  if (column.kind === "money") return money(row[column.key], row.currency);
  if (column.kind === "rate") return rate(row[column.key]);
  if (column.kind === "store") return [text(row.storeName ?? row.name), sellfoxSiteLabel(row.storeMarketplace ?? row.marketplace)].filter((item) => item !== "-").join(" / ") || "-";
  if (column.kind === "stack") return [text(row[column.key]), text(row[column.sub ?? ""])].filter((item) => item !== "-").join(" / ") || "-";
  return text(row[column.key]);
}

function Cell({ column, row }: { column: HostColumn; row: Row }) {
  if (column.kind === "image") {
    const src = safeImage(row[column.key]);
    return src ? <img className="sf-thumb" src={src} alt="商品主图" width={36} height={36} loading="lazy" decoding="async" referrerPolicy="no-referrer" /> : <span className="sf-thumb" />;
  }
  if (column.kind === "store") {
    return (
      <span className="sf-stack">
        <span>{text(row.storeName ?? row.name)}</span>
        <small>{sellfoxSiteLabel(row.storeMarketplace ?? row.marketplace) || "-"}</small>
      </span>
    );
  }
  if (column.kind === "stack") {
    return (
      <span className="sf-stack">
        <span>{text(row[column.key])}</span>
        {column.sub ? <small>{text(row[column.sub])}</small> : null}
      </span>
    );
  }
  return <>{cellText(column, row)}</>;
}

function isNumeric(column: HostColumn) {
  return column.kind === "qty" || column.kind === "decimal" || column.kind === "money" || column.kind === "rate";
}

/** 展示层默认列宽：优先列定义里的 width，否则按类型给稳定宽度，使每列都可拖拽。仅展示，不参与数据。 */
function hostColumnWidth(column: HostColumn) {
  if (column.width) return column.width;
  if (column.kind === "image") return 80;
  if (column.kind === "store" || column.kind === "stack") return 160;
  if (column.kind === "tags") return 180;
  if (isNumeric(column)) return 100;
  return 140;
}
function hostWidthStyle(width: number | undefined): { width: number; minWidth: number; maxWidth: number } | undefined {
  return width ? { width, minWidth: width, maxWidth: width } : undefined;
}

export function HostWorkbench({ page }: { page: HostPage }) {
  const today = shanghaiToday();
  const [datasetId, setDatasetId] = useState(page.datasets[0]?.id ?? "");
  const dataset = page.datasets.find((item) => item.id === datasetId) ?? page.datasets[0];
  const [preset, setPreset] = useState<"d7" | "d14" | "d30" | "d90" | "custom">("d30");
  const [from, setFrom] = useState(() => rangeForPreset("d30", today).from);
  const [to, setTo] = useState(() => rangeForPreset("d30", today).to);
  const [applied, setApplied] = useState({ from: rangeForPreset("d30", today).from, to: rangeForPreset("d30", today).to, site: "", shop: "", adType: "", search: "" });
  const [draft, setDraft] = useState({ site: "", shop: "", adType: "", search: "" });
  const [rows, setRows] = useState<Row[]>([]);
  const [dynamicColumns, setDynamicColumns] = useState<HostColumn[] | null>(null);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState<Totals>(emptyTotals);
  const [, setCoverage] = useState({ stores: 0, rows: 0 });
  const [legacyStores, setLegacyStores] = useState<Store[]>([]);
  const referenceStores = useStores();
  const referenceStatus = useSellfoxReferenceStore((s) => s.status);
  // 引用数据优先：provider 已加载时直接用会话级 store，不再请求 overview；未就绪时回退旧路径。
  const stores: Store[] = referenceStatus === "ready" && referenceStores.length
    ? referenceStores.map((s) => ({ externalId: s.externalId, name: s.name, marketplace: s.marketplace }))
    : legacyStores;
  const [pageNo, setPageNo] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [refreshNonce, setRefreshNonce] = useState(0);
  const live = dataset?.status === "live";

  useEffect(() => {
    // 店铺下拉优先来自会话级 reference store；仅当引用数据加载失败时才回退旧的 overview 路径，
    // 正常情况下不再为拿店铺清单等待 17 查询的 overview。
    if (referenceStatus !== "error") return;
    let active = true;
    void cachedApiGet({
      queryKey: "sellfox:overview:stores",
      fetcher: async () => {
        const response = await fetch("/api/sellfox/overview", { cache: "no-store" });
        return response.ok ? (await response.json() as { stores?: Store[] }) : { stores: [] as Store[] };
      },
    }).then((body) => { if (active) setLegacyStores(body.stores ?? []); }).catch(() => { if (active) setLegacyStores([]); });
    return () => { active = false; };
  }, [referenceStatus]);

  useEffect(() => {
    if (!live || !dataset) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ dataset: dataset.id, page: String(pageNo), pageSize: String(pageSize) });
    if (dataset.dateRange) { params.set("from", applied.from); params.set("to", applied.to); }
    if (applied.site) params.set("site", applied.site);
    if (applied.shop) params.set("shop", applied.shop);
    if (applied.adType) params.set("adType", applied.adType);
    if (applied.search) params.set("search", applied.search);
    setLoading(true);
    setError("");
    fetch(`/api/sellfox/dataset?${params}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = await response.json() as Payload;
        if (!response.ok) throw new Error(body.error || "读取失败");
        return body;
      })
      .then((body) => {
        if (controller.signal.aborted) return;
        setRows(Array.isArray(body.rows) ? body.rows : []);
        setDynamicColumns(Array.isArray(body.columns) && body.columns.length ? body.columns : null);
        setTotal(body.total ?? 0);
        setTotals(body.totals ?? emptyTotals);
        setCoverage(body.coverage ?? { stores: 0, rows: 0 });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setRows([]);
        setDynamicColumns(null);
        setTotal(0);
        setTotals(emptyTotals);
        setError(reason instanceof Error ? reason.message : "读取失败");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [applied, dataset, live, pageNo, pageSize, refreshNonce]);

  const sites = useMemo(() => [...new Set(stores.map((store) => store.marketplace).filter(Boolean))], [stores]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  // 没有可加总的列时不渲染汇总行，避免只显示一个「汇总」空行。
  const hasTotals = totals.byCurrency.length > 0 || totals.quantity != null || totals.totalInventory != null
    || totals.impressions != null || totals.clicks != null || totals.adOrders != null;
  const columns = dynamicColumns ?? dataset?.columns ?? [];
  // 会话级列宽：拖拽仅当前标签页生效，不写库、不持久化。默认固定宽度按列类型推导。
  const hostDefaults = useMemo(() => Object.fromEntries(columns.map((column) => [column.key, hostColumnWidth(column)])), [columns]);
  const { getWidth, startResize, resetWidths } = useSessionColumnWidths(`sellfox-host:${dataset?.id ?? "none"}`, hostDefaults);

  function applyPreset(next: "d7" | "d14" | "d30" | "d90" | "custom") {
    setPreset(next);
    if (next === "custom") return;
    const range = rangeForPreset(next, today);
    setFrom(range.from);
    setTo(range.to);
    setApplied((current) => ({ ...current, from: range.from, to: range.to }));
    setPageNo(1);
  }

  function search() {
    setApplied({ ...draft, from, to });
    setPageNo(1);
  }

  function reset() {
    const range = rangeForPreset("d30", today);
    setPreset("d30");
    setFrom(range.from);
    setTo(range.to);
    setDraft({ site: "", shop: "", adType: "", search: "" });
    setApplied({ from: range.from, to: range.to, site: "", shop: "", adType: "", search: "" });
    setPageNo(1);
  }

  function exportCsv() {
    const header = columns.map((column) => column.label);
    const lines = [header, ...rows.map((row) => columns.map((column) => cellText(column, row)))];
    const csv = `\uFEFF${lines.map((line) => line.map((value) => `"${value.replaceAll('"', '""')}"`).join(",")).join("\r\n")}`;
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    link.download = `sellfox-${page.id}-${dataset?.id ?? "data"}.csv`;
    link.click();
    setNotice("已导出当前页，没有写入数据库。");
  }

  function totalNode(column: HostColumn) {
    if (!live) return "";
    if (column.key === "impressions") return qty(totals.impressions);
    if (column.key === "clicks") return qty(totals.clicks);
    if (column.key === "adOrders") return qty(totals.adOrders);
    if (column.kind === "money") {
      const list = totals.byCurrency
        .map((item) => ({ currency: item.currency, value: item.values[column.key] ?? null }))
        .filter((item) => item.value != null);
      return list.length ? list.map((item) => money(item.value, item.currency)).join(" / ") : "";
    }
    if (column.key === "quantity") return qty(totals.quantity);
    if (column.key === "totalInventory") return qty(totals.totalInventory);
    if (column.key === "unfulfillable") return qty(totals.unfulfillable);
    return "";
  }

  return (
    <section className="sellfox-ui">
      <SellfoxTabs current={page.href} />
      <div className="sf-page">
        <div className="sf-page-head">
          <p className="sf-page-sub">{page.subtitle}</p>
        </div>

        <div className="sf-ds" role="tablist" aria-label="数据集">
          {page.datasets.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-current={item.id === dataset?.id ? "page" : undefined}
              title={`${hostStatusLabel(item.status)} · ${item.table}`}
              onClick={() => { setDatasetId(item.id); setPageNo(1); }}
            >
              <span className={item.status === "live" ? "sf-dot sf-dot-live" : "sf-dot"} aria-hidden="true" />
              {item.label}
            </button>
          ))}
        </div>

        {dataset && !live ? (
          <PendingDataset dataset={dataset} />
        ) : dataset ? (
          <>
            <div className="sf-filter">
              <select aria-label="全部站点" value={draft.site} onChange={(event) => setDraft({ ...draft, site: event.target.value })}>
                <option value="">全部站点</option>
                {sites.map((site) => <option key={site} value={site}>{sellfoxSiteLabel(site)}</option>)}
              </select>
              <select aria-label="全部店铺" value={draft.shop} onChange={(event) => setDraft({ ...draft, shop: event.target.value })}>
                <option value="">全部店铺</option>
                {stores.map((store) => <option key={store.externalId} value={store.externalId}>{store.name}</option>)}
              </select>
              {dataset.adType ? (
                <select aria-label="广告类型" value={draft.adType} onChange={(event) => setDraft({ ...draft, adType: event.target.value })}>
                  <option value="">全部类型</option>
                  <option value="sp">SP</option>
                  <option value="sb">SB</option>
                  <option value="sd">SD</option>
                </select>
              ) : null}
              {dataset.dateRange ? (
                <>
                  <span className="sf-label">日期</span>
                  <select aria-label="日期快捷" value={preset} onChange={(event) => applyPreset(event.target.value as "d7" | "d14" | "d30" | "d90" | "custom")}>
                    {presets.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
                    <option value="custom">自定义</option>
                  </select>
                  <input aria-label="开始日期" type="date" value={from} max={to} onChange={(event) => { setFrom(event.target.value); setPreset("custom"); }} />
                  <input aria-label="结束日期" type="date" value={to} min={from} onChange={(event) => { setTo(event.target.value); setPreset("custom"); }} />
                </>
              ) : null}
              {dataset.searchable ? (
                <input
                  className="sf-search"
                  aria-label="搜索"
                  placeholder={dataset.id.startsWith("ads") ? "搜索 ASIN / MSKU / 活动 / 投放词" : "搜索 ASIN / MSKU / SKU"}
                  value={draft.search}
                  onChange={(event) => setDraft({ ...draft, search: event.target.value })}
                  onKeyDown={(event) => { if (event.key === "Enter") search(); }}
                />
              ) : null}
              <button type="button" className="sf-btn sf-btn-primary" onClick={search}>搜索</button>
              <button type="button" className="sf-btn" onClick={reset}>重置</button>
            </div>
            <div className="sf-actions">
              <span className="sf-spacer" />
              <Link className="sf-btn" href="/sellfox/sync">同步</Link>
              <button type="button" className="sf-btn" onClick={exportCsv}>导出</button>
              <button type="button" className="sf-btn" onClick={() => setRefreshNonce((value) => value + 1)}>刷新</button>
              <button type="button" className="sf-btn" onClick={() => setNotice(`口径：${dataset.grain}。${dataset.note ?? ""}`)}>帮助</button>
            </div>
            {dataset.note ? <p className="sf-note">{dataset.note}</p> : null}
            {notice ? <p className="sf-notice" role="status">{notice}</p> : null}
            <div className="sf-table-wrap">
              <table>
                <thead>
                  <tr>{columns.map((column) => (
                    <th key={column.key} scope="col" className={isNumeric(column) ? "sf-num" : undefined} title={column.hint} style={hostWidthStyle(getWidth(column.key))}>{column.label}<ColumnResizeHandle label={column.label} onPointerDown={(event) => startResize(event, column.key)} onReset={() => resetWidths(column.key)} /></th>
                  ))}</tr>
                </thead>
                <tbody>
                  {loading ? <tr><td colSpan={Math.max(columns.length, 1)}>加载中</td></tr> : null}
                  {!loading && error ? <tr><td colSpan={Math.max(columns.length, 1)}>{error}</td></tr> : null}
                  {!loading && !error && rows.length === 0 ? (
                    <tr><td colSpan={Math.max(columns.length, 1)}>
                      <div className="sf-empty" role="status"><strong>暂无数据</strong>该数据集已接入，但所选店铺与时间范围内没有快照。缺失不补 0。</div>
                    </td></tr>
                  ) : null}
                  {!loading && !error ? rows.map((row, index) => (
                    <tr key={String(row.id ?? index)}>
                      {columns.map((column) => (
                        <td key={column.key} className={isNumeric(column) ? "sf-num" : undefined} style={hostWidthStyle(getWidth(column.key))} title={cellText(column, row) || undefined}><Cell column={column} row={row} /></td>
                      ))}
                    </tr>
                  )) : null}
                </tbody>
                {!loading && !error && rows.length && hasTotals ? (
                  <tfoot>
                    <tr>
                      {columns.map((column, index) => (
                        <td key={column.key} className={isNumeric(column) ? "sf-num" : undefined} style={hostWidthStyle(getWidth(column.key))}>
                          {index === 0 ? <strong>汇总</strong> : totalNode(column)}
                        </td>
                      ))}
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
            <div className="sf-pager">
              <span>共 {total} 条</span>
              <button type="button" disabled={pageNo <= 1} onClick={() => setPageNo((value) => Math.max(1, value - 1))}>上一页</button>
              <button type="button" aria-current="page">{pageNo}</button>
              <button type="button" disabled={pageNo >= pages} onClick={() => setPageNo((value) => Math.min(pages, value + 1))}>下一页</button>
              <select aria-label="每页条数" value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPageNo(1); }}>
                {[20, 50, 100].map((size) => <option key={size} value={size}>{size}条/页</option>)}
              </select>
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

/** 未接入数据集：把目标表、接口、口径和优先级摊开，明确「没有数据」而不是「数据为 0」。 */
function PendingDataset({ dataset }: { dataset: HostDataset }) {
  return (
    <div className="sf-pending">
      <div className="sf-pending-body">
        <h2>{dataset.label} 尚未开通</h2>
        <p>该数据的采集能力尚未接入，当前状态为{hostStatusLabel(dataset.status)}。为避免误读，本页不展示任何数据行，也不填 0、不用历史值代替。下方为开通后可用的字段样式预览。</p>
        {dataset.note ? <p className="sf-note">{dataset.note}</p> : null}
        <div className="sf-pending-actions">
          <Link className="sf-btn sf-btn-primary" href="/sellfox/sync">去同步控制台</Link>
          <Link className="sf-btn" href="/sellfox">查看全量规划表</Link>
        </div>
      </div>
      <div className="sf-table-wrap">
        <table>
          <thead>
            <tr>{dataset.columns.map((column) => (
              <th key={column.key} scope="col" className={isNumeric(column) ? "sf-num" : undefined}>{column.label}</th>
            ))}</tr>
          </thead>
          <tbody>
            <tr><td colSpan={Math.max(dataset.columns.length, 1)} className="sf-pending-cell">尚未开通：此处仅为字段样式预览，不代表查询成功，也不代表数据为空。</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
