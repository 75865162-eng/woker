"use client";

import { useEffect, useMemo, useState } from "react";
import { cachedApiGet } from "@/lib/workspace/workspace-api-cache";
import { useStores, useSellfoxReferenceStore } from "@/lib/stores/sellfox-reference-store";
import Link from "next/link";
import { SellfoxTabs } from "../sellfox-nav";
import { SellfoxAdsProposals } from "@/components/sellfox/sellfox-ads-proposals";
import { ColumnResizeHandle } from "@/components/ui/column-resize-handle";
import { Dialog } from "@/components/ui/overlays";
import { CopyableValue } from "@/components/sellfox/copyable-value";
import { useColumnPreferences } from "@/lib/hooks/use-column-preferences";
import { useSessionColumnWidths } from "@/lib/hooks/use-session-column-widths";
import { sellfoxSiteLabel } from "@/lib/sellfox/marketplace-site";
import { normalizeWorkspaceScope } from "@/lib/workspace/scope";
import { rangeForPreset, shanghaiToday, type DatePreset } from "@/lib/sellfox/replica-pages";
import { hostStatusLabel, type HostColumn, type HostDataset, type HostPage, type HostTabGroup } from "@/lib/sellfox/host-pages";

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
  /** 汇总视图：先汇总分子分母再计算的比率合计（按币种），与行内同一口径。 */
  derivedByCurrency?: { currency: string; values: Record<string, number | null> }[];
};
type Facets = { states?: { value: string; count: number }[]; buckets?: { value: string; count: number }[] };
type Payload = { rows?: Row[]; total?: number; totals?: Totals; coverage?: { stores: number; rows: number }; error?: string; columns?: HostColumn[] | null; facets?: Facets };

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

/** window.open 无法设置自定义 header，导出 URL 必须显式带 workspaceId（与 replica 导出一致）。 */
function readWorkspaceId() {
  try {
    return normalizeWorkspaceScope(JSON.parse(localStorage.getItem("amazon_bulk_ad_workspace_scope") ?? "{}")).workspaceId;
  } catch {
    return normalizeWorkspaceScope().workspaceId;
  }
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
    const storeName = row.storeName ?? row.name;
    return (
      <span className="sf-stack">
        <CopyableValue value={storeName}>{text(storeName)}</CopyableValue>
        <small>{sellfoxSiteLabel(row.storeMarketplace ?? row.marketplace) || "-"}</small>
      </span>
    );
  }
  if (column.kind === "stack") {
    return (
      <span className="sf-stack">
        <CopyableValue value={row[column.key]}>{text(row[column.key])}</CopyableValue>
        {column.sub ? <small><CopyableValue value={row[column.sub]}>{text(row[column.sub])}</CopyableValue></small> : null}
      </span>
    );
  }
  // ASIN / MSKU / SKU / 活动ID 等标识列：hover 一键复制，对齐复刻台交互。
  if (/asin|msku|sku|campaign|adgroup|targeting|searchterm/i.test(column.key)) {
    return <CopyableValue value={row[column.key]}>{cellText(column, row)}</CopyableValue>;
  }
  return <>{cellText(column, row)}</>;
}

const SUMMARY_SORTABLE = new Set(["impressions", "clicks", "cost", "adOrders", "adSales", "ctr", "cpc", "acos", "roas", "reportDates", "state", "name"]);

const STATE_LABELS: Record<string, string> = { enabled: "启用", paused: "暂停", archived: "归档" };
const BUCKET_LABELS: Record<string, string> = {
  orders: "有订单",
  clicksNoOrders: "有点击无订单",
  impressionsNoClicks: "有曝光无点击",
  noPerformance: "无表现",
  insufficient: "数据不足",
};

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

/** 承接页自定义列：字段搜索 + 勾选 + 拖拽排序，与复刻台 ColumnPicker 交互一致。 */
function HostColumnPicker({ columns, selected, onCancel, onSave }: { columns: HostColumn[]; selected: string[]; onCancel: () => void; onSave: (keys: string[]) => void }) {
  const [draft, setDraft] = useState(selected);
  const [query, setQuery] = useState("");
  const [dragKey, setDragKey] = useState<string | null>(null);
  const defaults = columns.map((column) => column.key);
  const labelOf = (key: string) => columns.find((column) => column.key === key)?.label ?? key;
  const filtered = columns.filter((column) => !query || column.label.includes(query) || column.key.toLowerCase().includes(query.toLowerCase()));
  function toggle(key: string) { setDraft((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]); }
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
        <button type="button" className="sf-btn" onClick={() => setDraft(defaults)}>恢复默认</button>
      </div>
      <p className="sf-notice">已选 {draft.length} / {columns.length} 列。拖拽「已选顺序」可调整列位置。</p>
      <div className="sf-column-selected" aria-label="已选列顺序">
        {draft.map((key) => (
          <span key={key} className="sf-column-chip" draggable onDragStart={() => setDragKey(key)} onDragOver={(event) => event.preventDefault()} onDrop={() => dropOn(key)} title="拖拽调整顺序">{labelOf(key)}</span>
        ))}
      </div>
      <div className="sf-modal-grid">
        {filtered.map((column) => (
          <label key={column.key} className="sf-check" title={column.hint}>
            <input type="checkbox" checked={draft.includes(column.key)} onChange={() => toggle(column.key)} />
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

export function HostWorkbench({ page }: { page: HostPage }) {
  const today = shanghaiToday();
  const groups = page.groups ?? [];
  // 一级分组：默认选中第一个有数据集的分组；外链/阻断分组（datasetIds 为空）不作为默认。
  const [groupId, setGroupId] = useState(() => groups.find((group) => group.datasetIds.length > 0)?.id ?? "");
  const group = groups.find((item) => item.id === groupId);
  // 有分组时二级 tab 只在当前分组的数据集内切换；无分组时沿用旧的扁平列表。
  const visibleDatasets = group && group.datasetIds.length
    ? page.datasets.filter((item) => group.datasetIds.includes(item.id))
    : page.datasets;
  const [datasetId, setDatasetId] = useState(() => {
    const first = groups.find((item) => item.datasetIds.length > 0)?.datasetIds[0];
    return first ?? page.datasets[0]?.id ?? "";
  });
  const dataset = page.datasets.find((item) => item.id === datasetId) ?? visibleDatasets[0] ?? page.datasets[0];
  const [preset, setPreset] = useState<"d7" | "d14" | "d30" | "d90" | "custom">("d30");
  const [from, setFrom] = useState(() => rangeForPreset("d30", today).from);
  const [to, setTo] = useState(() => rangeForPreset("d30", today).to);
  const [applied, setApplied] = useState({ from: rangeForPreset("d30", today).from, to: rangeForPreset("d30", today).to, site: "", shop: "", adType: "", search: "", state: "", bucket: "" });
  const [draft, setDraft] = useState({ site: "", shop: "", adType: "", search: "", state: "", bucket: "" });
  // 汇总视图服务端排序：点击表头切换；非汇总数据集忽略（后端会回退默认列）。
  const [sort, setSort] = useState<{ by: string; order: "asc" | "desc" }>({ by: "", order: "desc" });
  const [rows, setRows] = useState<Row[]>([]);
  const [dynamicColumns, setDynamicColumns] = useState<HostColumn[] | null>(null);
  const [total, setTotal] = useState(0);
  const [totals, setTotals] = useState<Totals>(emptyTotals);
  const [facets, setFacets] = useState<Facets>({});
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
    if (applied.state) params.set("state", applied.state);
    if (applied.bucket) params.set("bucket", applied.bucket);
    if (applied.search) params.set("search", applied.search);
    if (sort.by) { params.set("sortBy", sort.by); params.set("sortOrder", sort.order); }
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
        setFacets(body.facets ?? {});
        setCoverage(body.coverage ?? { stores: 0, rows: 0 });
      })
      .catch((reason: unknown) => {
        if (controller.signal.aborted) return;
        setRows([]);
        setDynamicColumns(null);
        setTotal(0);
        setTotals(emptyTotals);
        setFacets({});
        setError(reason instanceof Error ? reason.message : "读取失败");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [applied, dataset, live, pageNo, pageSize, refreshNonce, sort]);

  const sites = useMemo(() => [...new Set(stores.map((store) => store.marketplace).filter(Boolean))], [stores]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  // 没有可加总的列时不渲染汇总行，避免只显示一个「汇总」空行。
  const hasTotals = totals.byCurrency.length > 0 || totals.quantity != null || totals.totalInventory != null
    || totals.impressions != null || totals.clicks != null || totals.adOrders != null;
  const allColumns = useMemo(() => dynamicColumns ?? dataset?.columns ?? [], [dynamicColumns, dataset?.columns]);
  const allColumnKeys = useMemo(() => allColumns.map((column) => column.key), [allColumns]);
  // 自定义列：服务端持久化（账号级、跨设备），会话级列宽仍走 session hook。
  // tableId 不能含冒号：user-preferences 的 key 为 <namespace>:<id>，仅允许一个冒号。
  const { visible: visibleColumnKeys, saveVisible: saveVisibleColumns } = useColumnPreferences(`host_${dataset?.id ?? "none"}`, allColumnKeys);
  const columns = useMemo(() => {
    const set = new Set(visibleColumnKeys);
    const ordered = visibleColumnKeys.map((key) => allColumns.find((column) => column.key === key)).filter((column): column is HostColumn => Boolean(column));
    // 新出现的服务端列（payload 动态派生）默认追加，避免隐藏未知列导致数据不可见。
    const extra = allColumns.filter((column) => !set.has(column.key));
    return [...ordered, ...extra];
  }, [allColumns, visibleColumnKeys]);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [exportFormat, setExportFormat] = useState<"csv" | "xlsx">("csv");
  // 会话级列宽：拖拽仅当前标签页生效，不写库、不持久化。默认固定宽度按列类型推导。
  const hostDefaults = useMemo(() => Object.fromEntries(allColumns.map((column) => [column.key, hostColumnWidth(column)])), [allColumns]);
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
    setDraft({ site: "", shop: "", adType: "", search: "", state: "", bucket: "" });
    setApplied({ from: range.from, to: range.to, site: "", shop: "", adType: "", search: "", state: "", bucket: "" });
    setPageNo(1);
  }

  function selectGroup(next: HostTabGroup) {
    setGroupId(next.id);
    setPageNo(1);
    // 外链分组与阻断分组没有数据集，只切换说明面板，不改变当前 dataset。
    if (next.href || !next.datasetIds.length) return;
    if (!next.datasetIds.includes(datasetId)) setDatasetId(next.datasetIds[0]);
    // state 筛选只适用于实体当前态数据集，切到日报或别的实体时清空，避免残留筛选。
    const first = page.datasets.find((item) => item.id === next.datasetIds[0]);
    if (!first?.stateFilter) {
      setDraft((current) => ({ ...current, state: "", bucket: "" }));
      setApplied((current) => ({ ...current, state: "", bucket: "" }));
    }
  }

  /** 汇总视图：服务端按同一筛选与聚合口径导出全量；超过上限显式报错，不静默截断。 */
  async function exportSummary() {
    const params = new URLSearchParams({ dataset: dataset!.id, export: "1", format: "csv", page: "1", pageSize: String(pageSize) });
    if (dataset!.dateRange) { params.set("from", applied.from); params.set("to", applied.to); }
    if (applied.site) params.set("site", applied.site);
    if (applied.shop) params.set("shop", applied.shop);
    if (applied.adType) params.set("adType", applied.adType);
    if (applied.state) params.set("state", applied.state);
    if (applied.bucket) params.set("bucket", applied.bucket);
    if (applied.search) params.set("search", applied.search);
    if (sort.by) { params.set("sortBy", sort.by); params.set("sortOrder", sort.order); }
    setNotice("正在导出全部筛选结果…");
    const response = await fetch(`/api/sellfox/dataset?${params}`, { cache: "no-store" });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      setNotice(body.error ?? "导出失败，请缩小筛选范围后重试。");
      return;
    }
    const blob = await response.blob();
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${dataset!.id}-${applied.from}-${applied.to}.csv`;
    link.click();
    setNotice(`已导出当前筛选的全部 ${total} 行（服务端同口径，未写入数据库）。`);
  }

  function toggleSort(key: string) {
    if (!SUMMARY_SORTABLE.has(key)) return;
    setSort((current) => current.by === key ? { by: key, order: current.order === "asc" ? "desc" : "asc" } : { by: key, order: "desc" });
    setPageNo(1);
  }

  /** 服务端全量导出：与当前筛选/可见列一致，最多 10,000 行，缺失保持空白不补 0。 */
  function serverExportUrl(format: "csv" | "xlsx"): string {
    const params = new URLSearchParams();
    params.set("dataset", dataset?.id ?? "");
    params.set("workspaceId", readWorkspaceId());
    if (dataset?.dateRange) { params.set("from", applied.from); params.set("to", applied.to); }
    if (applied.site) params.set("site", applied.site);
    if (applied.shop) params.set("shop", applied.shop);
    if (applied.adType) params.set("adType", applied.adType);
    if (applied.search) params.set("search", applied.search);
    for (const column of columns) params.append("column", column.key);
    params.set("format", format);
    return `/api/sellfox/dataset/export?${params}`;
  }
  function runServerExport(format: "csv" | "xlsx") {
    window.open(serverExportUrl(format), "_blank", "noopener,noreferrer");
    setNotice(`已在后台生成${format === "xlsx" ? " Excel" : " CSV"}：按当前筛选导出全部结果（最多 10,000 行），不是仅当前页，未写入数据库。`);
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
    if (column.key === "ctr" || column.key === "cpc" || column.key === "acos" || column.key === "roas") {
      const list = (totals.derivedByCurrency ?? [])
        .map((item) => ({ currency: item.currency, value: item.values[column.key] ?? null }))
        .filter((item) => item.value != null);
      if (!list.length) return "";
      return list.map((item) => column.key === "cpc" ? money(item.value, item.currency) : column.key === "roas" ? Number(item.value).toFixed(2) : rate(item.value)).join(" / ");
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

        {groups.length ? (
          <div className="sf-group" role="tablist" aria-label="广告管理标签">
            {groups.map((item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                aria-current={item.id === groupId ? "page" : undefined}
                title={`${item.status === "live" ? "已接入" : item.status === "blocked" ? "无来源" : "待接入"} · ${item.evidence ?? "设计"}${item.note ? ` · ${item.note}` : ""}`}
                onClick={() => selectGroup(item)}
              >
                <span className={item.status === "live" ? "sf-dot sf-dot-live" : "sf-dot"} aria-hidden="true" />
                {item.label}
              </button>
            ))}
          </div>
        ) : null}

        {group?.proposals ? (
          <div className="sf-proposals-panel">
            <SellfoxAdsProposals />
          </div>
        ) : group?.href ? (
          <div className="sf-pending">
            <div className="sf-pending-body">
              <h2>{group.label}</h2>
              <p>{group.note ?? "该入口复用现有数据。"}</p>
              <p className="sf-note">证据等级：{group.evidence ?? "设计"}。该入口为复用/外链，不在本页写入或下载任何数据。</p>
              <div className="sf-pending-actions">
                <Link className="sf-btn sf-btn-primary" href={group.href}>打开同步日志</Link>
              </div>
            </div>
          </div>
        ) : group && !group.datasetIds.length ? (
          <div className="sf-pending">
            <div className="sf-pending-body">
              <h2>{group.label} 未开通</h2>
              <p>{group.note ?? "该能力没有可核实的来源。"}</p>
              <p className="sf-note">证据等级：{group.evidence ?? "待验证"}。本页不展示任何数据行，也不填 0、不用其它数据集代替。</p>
            </div>
          </div>
        ) : (
          <>
        <div className="sf-ds" role="tablist" aria-label="数据集">
          {visibleDatasets.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-current={item.id === dataset?.id ? "page" : undefined}
              title={`${hostStatusLabel(item.status)} · ${item.table}`}
              onClick={() => {
                setDatasetId(item.id);
                setPageNo(1);
                // state 筛选只在实体当前态有意义。
                if (!item.stateFilter) {
                  setDraft((current) => ({ ...current, state: "", bucket: "" }));
                  setApplied((current) => ({ ...current, state: "", bucket: "" }));
                }
                setSort({ by: "", order: "desc" });
              }}
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
              {dataset.stateFilter ? (
                <select aria-label="状态" value={draft.state} onChange={(event) => setDraft({ ...draft, state: event.target.value })}>
                  <option value="">全部状态</option>
                  <option value="enabled">启用</option>
                  <option value="paused">暂停</option>
                  <option value="archived">归档</option>
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
              <button type="button" className="sf-btn" onClick={() => setColumnsOpen(true)}>自定义列</button>
              <button type="button" className="sf-btn" onClick={dataset.summaryKind ? exportSummary : () => setExportOpen(true)}>{dataset.summaryKind ? "导出全部" : "导出"}</button>
              <button type="button" className="sf-btn" onClick={() => setRefreshNonce((value) => value + 1)}>刷新</button>
              <button type="button" className="sf-btn" onClick={() => setNotice(`口径：${dataset.grain}。${dataset.note ?? ""}`)}>帮助</button>
            </div>
            {dataset.summaryKind && ((facets.states?.length ?? 0) || (facets.buckets?.length ?? 0)) ? (
              <div className="sf-facets" aria-label="候选值筛选">
                {facets.states?.length ? <span className="sf-facet-label">状态</span> : null}
                {facets.states?.map((item) => (
                  <button
                    key={`state-${item.value}`}
                    type="button"
                    className={applied.state === item.value ? "sf-chip sf-chip-on" : "sf-chip"}
                    onClick={() => {
                      const next = applied.state === item.value ? "" : item.value;
                      setDraft((current) => ({ ...current, state: next }));
                      setApplied((current) => ({ ...current, state: next }));
                      setPageNo(1);
                    }}
                  >
                    {STATE_LABELS[item.value] ?? (item.value || "未知")} {item.count}
                  </button>
                ))}
                {facets.buckets?.length ? <span className="sf-facet-label">表现</span> : null}
                {facets.buckets?.map((item) => (
                  <button
                    key={`bucket-${item.value}`}
                    type="button"
                    className={applied.bucket === item.value ? "sf-chip sf-chip-on" : "sf-chip"}
                    onClick={() => {
                      const next = applied.bucket === item.value ? "" : item.value;
                      setDraft((current) => ({ ...current, bucket: next }));
                      setApplied((current) => ({ ...current, bucket: next }));
                      setPageNo(1);
                    }}
                  >
                    {BUCKET_LABELS[item.value] ?? item.value} {item.count}
                  </button>
                ))}
              </div>
            ) : null}
            {dataset.note ? <p className="sf-note">{dataset.note}</p> : null}
            {notice ? <p className="sf-notice" role="status">{notice}</p> : null}
            <div className="sf-table-wrap">
              <table>
                <thead>
                  <tr>{columns.map((column) => (
                    <th key={column.key} scope="col" className={isNumeric(column) ? "sf-num" : undefined} title={column.hint} aria-sort={sort.by === column.key ? (sort.order === "asc" ? "ascending" : "descending") : undefined} style={hostWidthStyle(getWidth(column.key))}>
                      <span className={dataset.summaryKind && SUMMARY_SORTABLE.has(column.key) ? "sf-sortable" : undefined} onClick={dataset.summaryKind ? () => toggleSort(column.key) : undefined}>
                        {column.label}{sort.by === column.key ? (sort.order === "asc" ? " ▲" : " ▼") : ""}
                      </span>
                      <ColumnResizeHandle label={column.label} onPointerDown={(event) => startResize(event, column.key)} onReset={() => resetWidths(column.key)} />
                    </th>
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
          </>
        )}
      </div>
      {columnsOpen ? (
        <Dialog open bare zIndex="modal" onClose={() => setColumnsOpen(false)}>
          <div className="sf-modal mx-auto" role="dialog" aria-modal="true" aria-label="自定义列">
            <h2>自定义列 · {dataset?.label ?? ""}</h2>
            <HostColumnPicker columns={allColumns} selected={columns.map((column) => column.key)} onCancel={() => setColumnsOpen(false)} onSave={(keys) => { saveVisibleColumns(keys); setColumnsOpen(false); }} />
          </div>
        </Dialog>
      ) : null}
      {exportOpen ? (
        <Dialog open bare zIndex="modal" onClose={() => setExportOpen(false)}>
          <div className="sf-modal mx-auto" role="dialog" aria-modal="true" aria-label="导出">
            <h2>导出 · {dataset?.label ?? ""}</h2>
            <p className="sf-notice">按当前筛选导出服务端全部结果（最多 10,000 行），不是仅当前页。金额按币种分列，缺失保持空白不补 0。</p>
            <div className="sf-modal-grid">
              <label className="sf-check"><input type="radio" name="host-export-format" checked={exportFormat === "csv"} onChange={() => setExportFormat("csv")} /><span>CSV</span></label>
              <label className="sf-check"><input type="radio" name="host-export-format" checked={exportFormat === "xlsx"} onChange={() => setExportFormat("xlsx")} /><span>Excel（xlsx）</span></label>
            </div>
            <div className="sf-modal-actions">
              <button type="button" className="sf-btn" onClick={() => setExportOpen(false)}>取消</button>
              <button type="button" className="sf-btn sf-btn-primary" onClick={() => { runServerExport(exportFormat); setExportOpen(false); }}>导出</button>
            </div>
          </div>
        </Dialog>
      ) : null}
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
