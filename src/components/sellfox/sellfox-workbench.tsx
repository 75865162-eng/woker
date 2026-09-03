"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Building2, ChevronLeft, ChevronRight, Database, Download, RefreshCw, Search, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Product, ProductStatus } from "@/lib/products/types";

type Overview = {
  configured: boolean;
  stores: Array<{ id: string; externalId: string; name: string; marketplace: string; country: string; status: string; lastSyncedAt: string }>;
  productCount: number;
  hourlyCount: number;
  latestMetricAt: string | null;
  nextHourlyStoreOffset: number;
  latestRun: { resource: string; status: string; startedAt: string; summary?: { count?: number } | null; error?: string | null } | null;
  latestPerformanceRun?: { resource: string; status: string; startedAt: string; summary?: { count?: number; reportDate?: string; storeCount?: number } | null; error?: string | null } | null;
};

type ProductPageData = {
  products: Product[];
  pagination: { page: number; pageSize: number; total: number; pageCount: number };
};

type PerformanceRow = {
  id: string;
  reportDate: string;
  sku: string;
  msku: string;
  asin: string;
  title: string;
  currency: string;
  saleQuantity: number;
  saleRevenue: number;
  grossProfit: number;
  adCost: number;
  store: { name: string; externalId: string };
};

type PerformancePageData = {
  rows: PerformanceRow[];
  pagination: { page: number; pageSize: number; total: number; pageCount: number };
  summary: { saleQuantity?: number; saleRevenue?: number; grossProfit?: number; adCost?: number };
};

type SelectedScope = {
  workspaceId: string;
  accountId: string;
  marketplace: string;
};

type BadgeTone = "blue" | "green" | "amber" | "red" | "gray";

const statusTone: Record<string, "gray" | "blue" | "green" | "amber" | "red"> = {
  pending: "gray",
  developing: "blue",
  ops_review: "amber",
  design_in_progress: "blue",
  listing_confirming: "amber",
  listed: "green",
  canceled: "red",
  delisted: "red",
  patent_risk: "red",
};

const emptyProductPagination = { page: 1, pageSize: 20, total: 0, pageCount: 1 };
const workspaceScopeStorageKey = "amazon_bulk_ad_workspace_scope";

function dateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "尚未同步";
}

function reportDateDefault() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

function money(value: number, currency = "USD") {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency, maximumFractionDigits: 2 }).format(value || 0);
}

function productStatusBadge(product: Product) {
  return { label: product.status || "未设置", tone: statusTone[product.status] ?? "gray" };
}

function readSelectedScope(): SelectedScope {
  if (typeof window === "undefined") {
    return { workspaceId: "default", accountId: "", marketplace: "" };
  }

  try {
    const parsed = JSON.parse(window.localStorage.getItem(workspaceScopeStorageKey) ?? "{}") as Partial<SelectedScope>;

    return {
      workspaceId: parsed.workspaceId || "default",
      accountId: parsed.accountId || "",
      marketplace: parsed.marketplace || "",
    };
  } catch {
    return { workspaceId: "default", accountId: "", marketplace: "" };
  }
}

function withWorkspaceScope(init?: RequestInit): RequestInit {
  const scope = readSelectedScope();
  const headers = new Headers(init?.headers);

  headers.set("x-workspace-id", scope.workspaceId);
  if (scope.accountId) headers.set("x-account-id", scope.accountId);
  if (scope.marketplace) headers.set("x-marketplace", scope.marketplace);

  return { ...init, headers };
}

function appendWorkspaceScope(params: URLSearchParams) {
  const scope = readSelectedScope();

  params.set("workspaceId", scope.workspaceId);
  if (scope.accountId) params.set("accountId", scope.accountId);
  if (scope.marketplace) params.set("marketplace", scope.marketplace);

  return params;
}

export function SellfoxWorkbench() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [working, setWorking] = useState<"stores" | "products" | "hourly" | "performance" | null>(null);
  const [productSearch, setProductSearch] = useState("");
  const [productStatus, setProductStatus] = useState<"all" | ProductStatus>("all");
  const [productPage, setProductPage] = useState(1);
  const [products, setProducts] = useState<ProductPageData>({ products: [], pagination: emptyProductPagination });
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState("");
  const [reportDate, setReportDate] = useState(reportDateDefault);
  const [storeId, setStoreId] = useState("");
  const [performanceSearch, setPerformanceSearch] = useState("");
  const [performance, setPerformance] = useState<PerformancePageData>({ rows: [], pagination: { page: 1, pageSize: 50, total: 0, pageCount: 1 }, summary: {} });
  const [performanceLoading, setPerformanceLoading] = useState(true);
  const [performanceError, setPerformanceError] = useState("");

  const selectedStore = useMemo(() => overview?.stores.find((store) => store.id === storeId), [overview?.stores, storeId]);
  const configurationBadge: { tone: BadgeTone; label: string } = overview
    ? { tone: overview.configured ? "green" : "amber", label: overview.configured ? "服务端凭据已配置" : "等待配置凭据" }
    : { tone: "gray" as const, label: "读取配置中" };

  const loadOverview = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/sellfox/overview", withWorkspaceScope({ cache: "no-store" }));
      const payload = (await response.json()) as Overview & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Sellfox 数据读取失败。");
      setOverview(payload);
      setStoreId((current) => current || payload.stores[0]?.id || "");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Sellfox 数据读取失败。");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  useEffect(() => {
    let canceled = false;
    const timer = window.setTimeout(async () => {
      setProductsLoading(true);
      setProductsError("");
      try {
        const params = new URLSearchParams({
          page: String(productPage),
          pageSize: "20",
          search: productSearch.trim(),
          source: "sellfox",
        });
        if (productStatus !== "all") params.set("status", productStatus);
        const response = await fetch(`/api/sellfox/products?${params}`, withWorkspaceScope({ cache: "no-store" }));
        const payload = (await response.json()) as ProductPageData & { error?: string };
        if (!response.ok) throw new Error(payload.error || "读取 Sellfox 商品失败。");
        if (!canceled) setProducts({ products: payload.products ?? [], pagination: payload.pagination ?? emptyProductPagination });
      } catch (error) {
        if (!canceled) setProductsError(error instanceof Error ? error.message : "读取 Sellfox 商品失败。");
      } finally {
        if (!canceled) setProductsLoading(false);
      }
    }, 250);

    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [productPage, productSearch, productStatus]);

  useEffect(() => {
    setProductPage(1);
  }, [productSearch, productStatus]);

  useEffect(() => {
    let canceled = false;
    const timer = window.setTimeout(async () => {
      setPerformanceLoading(true);
      setPerformanceError("");
      try {
        const params = new URLSearchParams({ reportDate, pageSize: "50" });
        if (storeId) params.set("storeId", storeId);
        if (performanceSearch.trim()) params.set("search", performanceSearch.trim());
        const response = await fetch(`/api/sellfox/performance?${params}`, withWorkspaceScope({ cache: "no-store" }));
        const payload = (await response.json()) as PerformancePageData & { error?: string };
        if (!response.ok) throw new Error(payload.error || "读取产品表现失败。");
        if (!canceled) setPerformance(payload);
      } catch (error) {
        if (!canceled) setPerformanceError(error instanceof Error ? error.message : "读取产品表现失败。");
      } finally {
        if (!canceled) setPerformanceLoading(false);
      }
    }, 250);

    return () => {
      canceled = true;
      window.clearTimeout(timer);
    };
  }, [performanceSearch, reportDate, storeId]);

  async function sync(resource: "stores" | "products" | "hourly" | "performance") {
    setWorking(resource);
    setNotice("");
    try {
      const response = await fetch("/api/sellfox/sync", {
        method: "POST",
        ...withWorkspaceScope({ headers: { "Content-Type": "application/json" } }),
        body: JSON.stringify({ resource, ...(resource === "hourly" ? { storeOffset: overview?.nextHourlyStoreOffset ?? 0, storeLimit: 1 } : {}), ...(resource === "performance" ? { storeExternalId: selectedStore?.externalId, reportDate } : {}) }),
      });
      const payload = (await response.json()) as { count?: number; error?: string };
      if (!response.ok) throw new Error(payload.error || "同步失败。");
      setNotice(`${resource === "stores" ? "店铺" : resource === "products" ? "商品" : resource === "performance" ? "产品表现" : "小时报告"}同步完成：${payload.count ?? 0} 条记录。`);
      await loadOverview();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "同步失败。");
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="space-y-5">
      <section className="flex flex-col gap-4 border-b border-border pb-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-brand text-white">
            <Store className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold">Sellfox 独立同步台</h2>
              <Badge tone={configurationBadge.tone}>{configurationBadge.label}</Badge>
            </div>
            <p className="mt-1 text-sm text-muted">Sellfox 店铺、在线商品与产品表现使用独立表，和 dashboard 产品主数据分开存放。</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => void loadOverview()} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
            刷新
          </Button>
          <Button size="sm" onClick={() => void sync("stores")} disabled={!overview?.configured || Boolean(working)}>
            <Building2 className="h-4 w-4" />
            同步店铺
          </Button>
          <Button size="sm" onClick={() => void sync("products")} disabled={!overview?.configured || Boolean(working)}>
            <Database className="h-4 w-4" />
            同步在线商品
          </Button>
          <Button size="sm" onClick={() => void sync("performance")} disabled={!overview?.configured || Boolean(working)}>
            <Database className="h-4 w-4" />
            同步产品表现
          </Button>
          <Button size="sm" onClick={() => void sync("hourly")} disabled={!overview?.configured || Boolean(working)}>
            <Database className="h-4 w-4" />
            拉取小时报告
          </Button>
        </div>
      </section>

      {overview && !overview.configured ? (
        <div className="flex items-start gap-3 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <p>在服务端环境变量中配置 `SELLFOX_CLIENT_ID` 与 `SELLFOX_CLIENT_SECRET` 后，才能调用同步按钮。</p>
        </div>
      ) : null}
      {notice ? <div className="border border-border bg-white px-4 py-3 text-sm text-foreground">{notice}</div> : null}

      <section className="grid gap-3 md:grid-cols-3">
        <div className="border border-border bg-white p-4">
          <p className="text-xs font-semibold text-muted">店铺</p>
          <p className="mt-2 text-2xl font-bold metric-tabular">{overview?.stores.length ?? 0}</p>
          <p className="mt-1 text-xs text-muted">按工作区隔离</p>
        </div>
        <div className="border border-border bg-white p-4">
          <p className="text-xs font-semibold text-muted">在线商品</p>
          <p className="mt-2 text-2xl font-bold metric-tabular">{overview?.productCount ?? 0}</p>
          <p className="mt-1 text-xs text-muted">仅统计 Sellfox 独立表</p>
        </div>
        <div className="border border-border bg-white p-4">
          <p className="text-xs font-semibold text-muted">小时指标</p>
          <p className="mt-2 text-2xl font-bold metric-tabular">{overview?.hourlyCount ?? 0}</p>
          <p className="mt-1 text-xs text-muted">最近写入：{dateTime(overview?.latestMetricAt)}</p>
        </div>
      </section>

      <section className="border border-border bg-white">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-sm font-bold">在线商品</h3>
            <p className="mt-1 text-xs text-muted">Sellfox 只读同步的商品资料。</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_160px]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                value={productSearch}
                onChange={(event) => setProductSearch(event.target.value)}
                placeholder="搜索 SKU、品名或 ASIN"
                className="h-9 w-full min-w-0 border border-border bg-white pl-9 pr-3 text-sm outline-none focus:border-brand"
              />
            </label>
            <select
              value={productStatus}
              onChange={(event) => setProductStatus(event.target.value as "all" | ProductStatus)}
              className="h-9 border border-border bg-white px-3 text-sm outline-none focus:border-brand"
            >
              <option value="all">全部状态</option>
              <option value="pending">pending</option>
              <option value="developing">developing</option>
              <option value="ops_review">ops_review</option>
              <option value="design_in_progress">design_in_progress</option>
              <option value="listing_confirming">listing_confirming</option>
              <option value="listed">listed</option>
              <option value="canceled">canceled</option>
            </select>
          </div>
        </div>
        {productsError ? <div className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700">{productsError}</div> : null}
        <div className="overflow-x-auto thin-scrollbar">
          <table className="min-w-[960px] w-full text-left text-sm">
            <thead className="bg-surface-muted text-xs text-muted">
              <tr>
                {["SKU", "品名 / ASIN", "状态", "采购价", "供应商", "负责人", "创建日期"].map((header) => (
                  <th key={header} className="px-4 py-3 font-semibold">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {products.products.length ? (
                products.products.map((product) => {
                  const badge = productStatusBadge(product);
                  return (
                    <tr key={product.id} className="border-t border-border align-top">
                      <td className="px-4 py-3 font-mono text-xs font-semibold">{product.sku}</td>
                      <td className="px-4 py-3">
                        <p className="max-w-[280px] truncate font-semibold">{product.chineseName || product.englishName || "-"}</p>
                        <p className="mt-1 font-mono text-xs text-info">{product.asin || "-"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge tone={badge.tone}>{badge.label}</Badge>
                      </td>
                      <td className="px-4 py-3 metric-tabular">CNY {(product.purchasePrice || 0).toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <p className="max-w-[180px] truncate" title={product.supplierName || "-"}>
                          {product.supplierName || "-"}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="max-w-[160px] truncate" title={product.selectionOwner || product.developer || "-"}>
                          {product.selectionOwner || product.developer || "-"}
                        </p>
                      </td>
                      <td className="px-4 py-3 text-xs text-muted">{product.createdAt || "-"}</td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={7} className="px-5 py-10 text-center text-muted">
                    {productsLoading ? "正在读取商品..." : "当前筛选没有商品。"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-3 border-t border-border px-5 py-3 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>
            共 {products.pagination.total.toLocaleString("zh-CN")} 条，当前第 {products.pagination.page} / {products.pagination.pageCount} 页
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setProductPage((value) => Math.max(1, value - 1))} disabled={productPage <= 1 || productsLoading}>
              <ChevronLeft className="h-4 w-4" />
              上一页
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setProductPage((value) => Math.min(products.pagination.pageCount, value + 1))} disabled={productPage >= products.pagination.pageCount || productsLoading}>
              下一页
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </section>

      <section className="border border-border bg-white">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h3 className="text-sm font-bold">产品表现</h3>
            <p className="mt-1 text-xs text-muted">按店铺和日期查看 Sellfox 日快照。</p>
          </div>
          <a className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-border px-3 text-xs font-semibold text-foreground hover:bg-surface-muted" href={`/api/sellfox/performance/export?${appendWorkspaceScope(new URLSearchParams({ reportDate, ...(storeId ? { storeId } : {}), ...(performanceSearch.trim() ? { search: performanceSearch.trim() } : {}) }))}`}>
            <Download className="h-4 w-4" />
            导出当前筛选
          </a>
        </div>
        <div className="grid gap-3 border-b border-border px-5 py-3 md:grid-cols-[minmax(180px,1fr)_150px_minmax(220px,1fr)]">
          <select value={storeId} onChange={(event) => setStoreId(event.target.value)} className="h-9 min-w-0 border border-border bg-white px-3 text-sm outline-none focus:border-brand">
            <option value="">全部店铺</option>
            {overview?.stores.map((store) => (
              <option key={store.id} value={store.id}>
                {store.name || store.externalId}
              </option>
            ))}
          </select>
          <input type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} className="h-9 border border-border bg-white px-3 text-sm outline-none focus:border-brand" />
          <input value={performanceSearch} onChange={(event) => setPerformanceSearch(event.target.value)} placeholder="搜索 ASIN、MSKU、SKU 或标题" className="h-9 border border-border px-3 text-sm outline-none focus:border-brand" />
        </div>
        <div className="grid gap-px border-b border-border bg-border md:grid-cols-4">
          <div className="bg-white px-5 py-3 text-sm">
            <p className="text-xs text-muted">商品行</p>
            <p className="mt-1 font-bold metric-tabular">{performance.pagination.total}</p>
          </div>
          <div className="bg-white px-5 py-3 text-sm">
            <p className="text-xs text-muted">销量</p>
            <p className="mt-1 font-bold metric-tabular">{performance.summary.saleQuantity ?? 0}</p>
          </div>
          <div className="bg-white px-5 py-3 text-sm">
            <p className="text-xs text-muted">销售额</p>
            <p className="mt-1 font-bold metric-tabular">{money(performance.summary.saleRevenue ?? 0)}</p>
          </div>
          <div className="bg-white px-5 py-3 text-sm">
            <p className="text-xs text-muted">毛利润</p>
            <p className="mt-1 font-bold metric-tabular">{money(performance.summary.grossProfit ?? 0)}</p>
          </div>
        </div>
        {performanceError ? <div className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700">{performanceError}</div> : null}
        <div className="overflow-x-auto thin-scrollbar">
          <table className="min-w-[1200px] w-full text-left text-xs">
            <thead className="bg-surface-muted text-muted">
              <tr>
                {["日期", "店铺", "ASIN", "MSKU", "SKU", "标题", "销量", "销售额", "毛利润", "广告花费"].map((header) => (
                  <th key={header} className="whitespace-nowrap px-3 py-3 font-semibold">
                    {header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {performance.rows.length ? (
                performance.rows.map((row) => (
                  <tr key={row.id} className="border-t border-border align-top hover:bg-surface-muted/40">
                    <td className="whitespace-nowrap px-3 py-2">{row.reportDate}</td>
                    <td className="whitespace-nowrap px-3 py-2">{row.store.name || row.store.externalId}</td>
                    <td className="whitespace-nowrap px-3 py-2">{row.asin || "-"}</td>
                    <td className="whitespace-nowrap px-3 py-2">{row.msku || "-"}</td>
                    <td className="whitespace-nowrap px-3 py-2">{row.sku || "-"}</td>
                    <td className="max-w-[340px] truncate whitespace-nowrap px-3 py-2">{row.title || "-"}</td>
                    <td className="whitespace-nowrap px-3 py-2 metric-tabular">{row.saleQuantity}</td>
                    <td className="whitespace-nowrap px-3 py-2 metric-tabular">{money(row.saleRevenue, row.currency || "USD")}</td>
                    <td className="whitespace-nowrap px-3 py-2 metric-tabular">{money(row.grossProfit, row.currency || "USD")}</td>
                    <td className="whitespace-nowrap px-3 py-2 metric-tabular">{money(row.adCost, row.currency || "USD")}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={10} className="px-5 py-10 text-center text-muted">
                    {performanceLoading ? "正在读取产品表现..." : "当前筛选没有产品表现。"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <p className="text-xs text-muted">
        最近同步：{overview?.latestRun ? `${overview.latestRun.resource} / ${overview.latestRun.status} / ${dateTime(overview.latestRun.startedAt)}${overview.latestRun.error ? ` / ${overview.latestRun.error}` : ""}` : "暂无"}
      </p>
    </div>
  );
}
