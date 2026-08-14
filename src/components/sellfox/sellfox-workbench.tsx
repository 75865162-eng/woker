"use client";

import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { AlertCircle, Building2, ChevronLeft, ChevronRight, Database, Download, RefreshCw, Search, Store } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { productStatusLabels, productStatusOptions, productStatusTones } from "@/data/products";
import type { Product, ProductStatus } from "@/lib/products/types";
import { scopedFetch } from "@/lib/workspace/scoped-fetch";

type StoreRecord = { id: string; externalId: string; name: string; marketplace: string; country: string; status: string; lastSyncedAt: string };
type SellfoxPayload = Record<string, unknown>;
type Overview = {
  configured: boolean;
  stores: StoreRecord[];
  productCount: number;
  hourlyCount: number;
  latestMetricAt: string | null;
  nextHourlyStoreOffset: number;
  latestRun: { resource: string; status: string; startedAt: string; summary?: { count?: number } | null; error?: string | null } | null;
  latestPerformanceRun?: { resource: string; status: string; startedAt: string; summary?: { count?: number; reportDate?: string; storeCount?: number } | null; error?: string | null } | null;
};
type PerformanceRow = { id: string; reportDate: string; sku: string; msku: string; asin: string; title: string; currency: string; saleQuantity: number; fbaQuantity: number; fbmQuantity: number; saleRevenue: number; grossProfit: number; grossProfitRate: number; adCost: number; refundRate: number; payload?: unknown; store: { name: string; externalId: string } };
type PerformanceData = { rows: PerformanceRow[]; pagination: { total: number }; summary: { saleQuantity?: number; saleRevenue?: number; grossProfit?: number; adCost?: number } };
type ProductMasterData = { products: Product[]; pagination: { page: number; pageSize: number; total: number; pageCount: number } };
type ProductWithSource = Product & { sellfoxPayload?: unknown };

const initialOverview: Overview = { configured: false, stores: [], productCount: 0, hourlyCount: 0, latestMetricAt: null, latestRun: null, nextHourlyStoreOffset: 0 };
const initialProductMasterData: ProductMasterData = { products: [], pagination: { page: 1, pageSize: 50, total: 0, pageCount: 1 } };
const marketplaceLabels: Record<string, string> = {
  ATVPDKIKX0DER: "美国",
  A2EUQ1WTGCTBG2: "加拿大",
  A1AM78C64UM0Y8: "墨西哥",
  A1VC38T7YXB528: "日本",
  A1PA6795UKMFR9: "德国",
  A1F83G8C2ARO7P: "英国",
  A13V1IB3VIYZZH: "法国",
  APJ6JRA9NG5V4: "意大利",
  A1RKKUPIHCS9HS: "西班牙",
  A1805IZSGTT6HS: "荷兰",
  A2NODRKZP88ZB9: "瑞典",
  A1C3SOZRARQ6R3: "波兰",
  AMEN7PMS3EDWL: "比利时",
  A2Q3Y263D00KWC: "巴西",
};

type PerformanceColumn = {
  header: string;
  className?: string;
  cell: (row: PerformanceRow) => ReactNode;
};

function payloadOf(row: PerformanceRow): SellfoxPayload {
  return row.payload && typeof row.payload === "object" && !Array.isArray(row.payload) ? row.payload as SellfoxPayload : {};
}

function recordOf(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function payloadValue(row: PerformanceRow, key: string) {
  const payload = payloadOf(row);
  return key.split(".").reduce<unknown>((value, part) => recordOf(value)?.[part], payload);
}

function textValue(value: unknown, preferredKey?: string): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map((item) => textValue(item, preferredKey)).filter(Boolean).join(",");
  const record = recordOf(value);
  if (record) {
    if (preferredKey && record[preferredKey] !== undefined) return textValue(record[preferredKey]);
    for (const key of ["labelName", "asin", "sku", "name", "url"]) {
      if (record[key] !== undefined) return textValue(record[key]);
    }
    return "";
  }
  return String(value).trim();
}

function fieldText(row: PerformanceRow, key: string, preferredKey?: string) {
  return textValue(payloadValue(row, key), preferredKey) || "-";
}

function numberValue(row: PerformanceRow, key: string) {
  const value = Number(textValue(payloadValue(row, key)));
  return Number.isFinite(value) ? value : 0;
}

function numericField(row: PerformanceRow, key: string) {
  const value = payloadValue(row, key);
  if (value === undefined || value === null || textValue(value) === "") return "-";
  const number = Number(textValue(value));
  return Number.isFinite(number) ? number.toLocaleString("zh-CN", { maximumFractionDigits: 2 }) : textValue(value);
}

function percentField(row: PerformanceRow, key: string) {
  const value = payloadValue(row, key);
  if (value === undefined || value === null || textValue(value) === "") return "-";
  const number = Number(textValue(value));
  return Number.isFinite(number) ? `${number.toLocaleString("zh-CN", { maximumFractionDigits: 2 })}%` : textValue(value);
}

function labelsText(row: PerformanceRow) {
  const payload = payloadOf(row);
  const productLabels = Array.isArray(payload.productLabelList) ? payload.productLabelList : [];
  const labels = productLabels.flatMap((item) => {
    const detailList = recordOf(item)?.labelDetailList;
    return Array.isArray(detailList) ? detailList.map((detail) => textValue(recordOf(detail)?.labelName)).filter(Boolean) : [];
  });
  return labels.length ? Array.from(new Set(labels)).join(",") : fieldText(row, "labels", "labelName");
}

function marketplaceText(row: PerformanceRow) {
  const marketplaceId = textValue(payloadValue(row, "marketplaceIdList"));
  return marketplaceLabels[marketplaceId] || marketplaceId || "-";
}

function imageCell(row: PerformanceRow) {
  const imageUrl = fieldText(row, "imageUrl");
  if (imageUrl === "-") return "-";
  return (
    <a href={imageUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-info hover:underline">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={imageUrl} alt="" className="h-10 w-10 shrink-0 rounded border border-border object-cover" />
      <span className="max-w-[120px] truncate">图片</span>
    </a>
  );
}

const performanceColumns: PerformanceColumn[] = [
  { header: "币种", cell: (row) => row.currency || fieldText(row, "currency") },
  { header: "图片链接", className: "min-w-[120px]", cell: imageCell },
  { header: "MSKU", className: "min-w-[180px]", cell: (row) => fieldText(row, "mskuList") || row.msku || "-" },
  { header: "ASIN", className: "min-w-[160px]", cell: (row) => fieldText(row, "asinList", "asin") || row.asin || "-" },
  { header: "标题", className: "min-w-[300px]", cell: (row) => row.title || fieldText(row, "title") },
  { header: "父ASIN", className: "min-w-[150px]", cell: (row) => fieldText(row, "parentAsinList") },
  { header: "品名", className: "min-w-[220px]", cell: (row) => fieldText(row, "skuList", "name") },
  { header: "SKU", className: "min-w-[180px]", cell: (row) => fieldText(row, "skuList", "sku") || row.sku || "-" },
  { header: "店铺", className: "min-w-[150px]", cell: (row) => row.store.name || row.store.externalId },
  { header: "站点", cell: marketplaceText },
  { header: "业务员", className: "min-w-[140px]", cell: (row) => fieldText(row, "userNameList") },
  { header: "业绩归属人", className: "min-w-[120px]", cell: (row) => fieldText(row, "userNameList") },
  { header: "分类", className: "min-w-[160px]", cell: (row) => fieldText(row, "categoryName") },
  { header: "商品品牌", cell: (row) => fieldText(row, "brands") },
  { header: "产品标签", className: "min-w-[180px]", cell: labelsText },
  { header: "FBA可售", cell: (row) => numericField(row, "inventoryManage.available") },
  { header: "预留转运", cell: (row) => numericField(row, "inventoryManage.reservedTransfer") },
  { header: "预留处理中", cell: (row) => numericField(row, "inventoryManage.reservedProcessing") },
  { header: "入库正在接收", cell: (row) => numericField(row, "inventoryManage.inboundReceiving") },
  { header: "预留订单", cell: (row) => numericField(row, "inventoryManage.reservedCustomerorders") },
  { header: "入库处理中", cell: (row) => numericField(row, "inventoryManage.inboundWorking") },
  { header: "入库已发货", cell: (row) => numericField(row, "inventoryManage.inboundShipped") },
  { header: "FBA不可售", cell: (row) => numericField(row, "inventoryManage.unfulfillable") },
  { header: "调查中", cell: (row) => numericField(row, "inventoryManage.research") },
  { header: "毛利润", cell: (row) => numericField(row, "profit") },
  { header: "平均毛利润", cell: (row) => numericField(row, "avgProfit") },
  { header: "毛利率", cell: (row) => percentField(row, "profitRate") },
  { header: "净销售额毛利率", cell: (row) => percentField(row, "profitRateNet") },
  { header: "销售额", cell: (row) => numericField(row, "salePrice") },
  { header: "净销售额", cell: (row) => numericField(row, "salesPriceNet") },
  { header: "不含税销售额", cell: (row) => numericField(row, "salePriceNoTax") },
  { header: "延迟中金额", cell: (row) => numericField(row, "revenueCostAmount") },
  { header: "平均售价", cell: (row) => numericField(row, "salePriceAvg") },
  { header: "订单量", cell: (row) => numericField(row, "orderNum") },
  { header: "销量", cell: (row) => numericField(row, "saleNum") },
  { header: "测评销量", cell: (row) => numericField(row, "evaluationSaleNum") },
  { header: "多渠道销量", cell: (row) => numericField(row, "channelSaleNum") },
  { header: "促销折扣", cell: (row) => numericField(row, "promotionPrice") },
  { header: "礼品包装费", cell: (row) => numericField(row, "giftWrapAmount") },
  { header: "买家运费", cell: (row) => numericField(row, "shippingChargeAmount") },
  { header: "税费", cell: (row) => numericField(row, "taxPrice") },
  { header: "COD", cell: (row) => numericField(row, "codItemChargeAmount") },
  { header: "监管费", cell: (row) => numericField(row, "regulatoryFeeAmount") },
  { header: "其他收入", cell: (row) => numericField(row, "otherPriceAmount") },
  { header: "商城征税", cell: (row) => numericField(row, "withheldTaxAmount") },
  { header: "物流配送费", cell: (row) => numericField(row, "shippingPrice") },
  { header: "物流配送费占比", cell: (row) => percentField(row, "shippingPercent") },
  { header: "销售佣金", cell: (row) => numericField(row, "amazonCommissionPrice") },
  { header: "销售佣金占比", cell: (row) => percentField(row, "amazonCommissionPercent") },
  { header: "数字服务费", cell: (row) => numericField(row, "technologyFeeAmount") },
  { header: "买家运费扣除", cell: (row) => numericField(row, "shippingChargebackAmount") },
  { header: "礼品包装费扣除", cell: (row) => numericField(row, "giftwrapChargebackAmount") },
  { header: "积分", cell: (row) => numericField(row, "costOfPointsGrantedAmount") },
  { header: "订单其他费", cell: (row) => numericField(row, "orderOtherPriceAmount") },
  { header: "退款量", cell: (row) => numericField(row, "refundNum") },
  { header: "订购时间内的退款量", cell: (row) => numericField(row, "purchaseRefundNum") },
  { header: "退款率", cell: (row) => percentField(row, "refundPercent") },
  { header: "退款", cell: (row) => numericField(row, "refundPrice") },
  { header: "订购时间内的退款金额", cell: (row) => numericField(row, "purchaseCostChannel") },
  { header: "退款占比", cell: (row) => percentField(row, "refundPricePercent") },
  { header: "赔偿", cell: (row) => numericField(row, "compensationAmount") },
  { header: "广告订单量", cell: (row) => numericField(row, "adTotalOrderNum") },
  { header: "广告订单量占比", cell: (row) => numberValue(row, "orderNum") ? `${((numberValue(row, "adTotalOrderNum") / numberValue(row, "orderNum")) * 100).toLocaleString("zh-CN", { maximumFractionDigits: 2 })}%` : "-" },
  { header: "广告销售额", cell: (row) => numericField(row, "adTotalSale") },
  { header: "广告花费", cell: (row) => numericField(row, "adTotalCost") },
  { header: "广告花费占比", cell: (row) => percentField(row, "adTotalCostPercent") },
  { header: "推广费", cell: (row) => numericField(row, "promotionTotalAmount") },
  { header: "推广费占比", cell: (row) => percentField(row, "promotionAmountPercent") },
  { header: "仓储费", cell: (row) => numericField(row, "storageFeeAmount") },
  { header: "仓储费占比", cell: (row) => percentField(row, "storageFeeAmountPercent") },
  { header: "服务费", cell: (row) => numericField(row, "serviceFeeAmount") },
  { header: "清算", cell: (row) => numericField(row, "clawbackAmount") },
  { header: "其他支出", cell: (row) => numericField(row, "otherServiceFeeAmount") },
  { header: "采购成本", cell: (row) => numericField(row, "purchaseCost") },
  { header: "平均采购成本", cell: (row) => numericField(row, "avgPurchaseCost") },
  { header: "采购成本占比", cell: (row) => percentField(row, "purchaseCostPercent") },
  { header: "头程费用", cell: (row) => numericField(row, "headTripPrice") },
  { header: "平均头程费用", cell: (row) => numericField(row, "avgHeadTripPrice") },
  { header: "头程费用占比", cell: (row) => percentField(row, "headTripPricePercent") },
  { header: "商品成本", cell: (row) => numericField(row, "commodityCost") },
  { header: "商品成本占比", cell: (row) => percentField(row, "commodityCostPercent") },
  { header: "测评费用", cell: (row) => numericField(row, "evaluationFee") },
  { header: "产品自定义费", cell: (row) => numericField(row, "customAsinFee") },
];

function dateTime(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString("zh-CN", { hour12: false }) : "尚未同步";
}

function reportDateDefault() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
}

function money(value: number, currency = "USD") { return new Intl.NumberFormat("zh-CN", { style: "currency", currency, maximumFractionDigits: 2 }).format(value || 0); }

function productSourceLabel(product: ProductWithSource) {
  if (product.sellfoxPayload) return "在线商品";
  return "赛狐同步";
}

function productStatusBadge(product: Product) {
  return {
    label: productStatusLabels[product.status] ?? product.status ?? "未设置",
    tone: productStatusTones[product.status] ?? "gray",
  };
}

function performanceEmptyMessage(overview: Overview, reportDate: string) {
  const latestRun = overview.latestPerformanceRun;

  if (!overview.stores.length) {
    return "还没有赛狐店铺数据。先点击“同步店铺”，再同步产品表现。";
  }

  if (!latestRun) {
    return "还没有同步过产品表现。点击“同步产品表现”后，这里会展示赛狐利润报表日快照。";
  }

  if (latestRun.status === "failed") {
    return `最近一次产品表现同步失败：${latestRun.error || "未知错误"}`;
  }

  const syncedCount = latestRun.summary?.count ?? 0;
  const syncedDate = latestRun.summary?.reportDate;
  if (latestRun.status === "done" && syncedCount === 0) {
    return syncedDate === reportDate
      ? `已同步 ${reportDate}，但赛狐返回 0 条产品表现。可换日期或店铺后再试。`
      : `最近同步日期是 ${syncedDate || "未知日期"}，当前筛选日期 ${reportDate} 没有日快照。`;
  }

  return "当前筛选没有日快照。可切换日期、店铺或点击“同步产品表现”。";
}

function performanceRunSummary(overview: Overview) {
  const latestRun = overview.latestPerformanceRun;
  if (!latestRun) return "尚未同步产品表现";

  const summary = latestRun.summary;
  const dateText = summary?.reportDate ? ` / 日期 ${summary.reportDate}` : "";
  const countText = summary?.count !== undefined ? ` / 写入 ${summary.count} 条` : "";
  const errorText = latestRun.error ? ` / ${latestRun.error}` : "";

  return `${latestRun.status}${dateText}${countText} / ${dateTime(latestRun.startedAt)}${errorText}`;
}

export function SellfoxWorkbench() {
  const [overview, setOverview] = useState<Overview>(initialOverview);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState<"stores" | "products" | "hourly" | "performance" | null>(null);
  const [notice, setNotice] = useState("");
  const [storeId, setStoreId] = useState("");
  const [reportDate, setReportDate] = useState(reportDateDefault);
  const [search, setSearch] = useState("");
  const [performance, setPerformance] = useState<PerformanceData>({ rows: [], pagination: { total: 0 }, summary: {} });
  const [productSearch, setProductSearch] = useState("");
  const [productStatus, setProductStatus] = useState<"all" | ProductStatus>("all");
  const [productPage, setProductPage] = useState(1);
  const [productMaster, setProductMaster] = useState<ProductMasterData>(initialProductMasterData);
  const [productMasterLoading, setProductMasterLoading] = useState(false);
  const [productMasterError, setProductMasterError] = useState("");
  const [performanceRefreshKey, setPerformanceRefreshKey] = useState(0);

  async function loadOverview() {
    setLoading(true);
    try {
      const response = await scopedFetch("/api/sellfox/overview", { cache: "no-store" });
      const payload = (await response.json()) as Overview & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Sellfox 数据读取失败。");
      setOverview(payload);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Sellfox 数据读取失败。");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void loadOverview(); }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({ source: "sellfox", page: String(productPage), pageSize: "50" });
      if (productSearch.trim()) params.set("keyword", productSearch.trim());
      if (productStatus !== "all") params.set("status", productStatus);
      setProductMasterLoading(true);
      setProductMasterError("");
      scopedFetch(`/api/products?${params}`, { cache: "no-store" })
        .then(async (response) => {
          const payload = await response.json() as ProductMasterData & { error?: string };
          if (!response.ok) throw new Error(payload.error || "读取商品主数据失败。");
          return payload;
        })
        .then((payload) => setProductMaster({
          products: Array.isArray(payload.products) ? payload.products : [],
          pagination: payload.pagination ?? initialProductMasterData.pagination,
        }))
        .catch((error) => setProductMasterError(error instanceof Error ? error.message : "读取商品主数据失败。"))
        .finally(() => setProductMasterLoading(false));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [productPage, productSearch, productStatus]);

  useEffect(() => {
    setProductPage(1);
  }, [productSearch, productStatus]);

  useEffect(() => {
    async function loadPerformance() {
      const params = new URLSearchParams({ reportDate, pageSize: "100" });
      if (storeId) params.set("storeId", storeId);
      if (search.trim()) params.set("search", search.trim());

      try {
        const response = await scopedFetch(`/api/sellfox/performance?${params}`, { cache: "no-store" });
        const payload = await response.json() as PerformanceData & { error?: string };
        if (!response.ok) throw new Error(payload.error || "读取产品表现失败。");
        setPerformance(payload);
      } catch (error) {
        setNotice(error instanceof Error ? error.message : "读取产品表现失败。");
      }
    }

    const timer = window.setTimeout(() => {
      void loadPerformance();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [storeId, reportDate, search, performanceRefreshKey]);

  async function sync(resource: "stores" | "products" | "hourly" | "performance") {
    setWorking(resource);
    setNotice("");
    try {
      const selectedStore = overview.stores.find((store) => store.id === storeId);
      const response = await scopedFetch("/api/sellfox/sync", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resource, ...(resource === "hourly" ? { storeOffset: overview.nextHourlyStoreOffset, storeLimit: 1 } : {}), ...(resource === "performance" ? { storeExternalId: selectedStore?.externalId, reportDate } : {}) }) });
      const payload = (await response.json()) as { count?: number; error?: string };
      if (!response.ok) throw new Error(payload.error || "同步失败。");
      setNotice(`${resource === "stores" ? "店铺" : resource === "products" ? "商品" : resource === "performance" ? "产品表现" : "小时报告"}同步完成：${payload.count ?? 0} 条记录。`);
      await loadOverview();
      if (resource === "performance") setPerformanceRefreshKey((value) => value + 1);
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
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-brand text-white"><Store className="h-5 w-5" /></div>
          <div>
            <div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-bold">只读同步控制台</h2><Badge tone={overview.configured ? "green" : "amber"}>{overview.configured ? "服务端凭据已配置" : "等待配置凭据"}</Badge></div>
            <p className="mt-1 text-sm text-muted">店铺、商品与 SP 广告活动小时报告保留赛狐源数据，不向赛狐写回任何内容。</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={() => void loadOverview()} disabled={loading}><RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />刷新</Button>
          <Button size="sm" onClick={() => void sync("stores")} disabled={!overview.configured || Boolean(working)}><Building2 className="h-4 w-4" />同步店铺</Button>
          <Button size="sm" onClick={() => void sync("products")} disabled={!overview.configured || Boolean(working)}><Download className="h-4 w-4" />同步在线商品</Button>
          <Button size="sm" onClick={() => void sync("performance")} disabled={!overview.configured || Boolean(working)}><Database className="h-4 w-4" />同步产品表现</Button>
          <Button size="sm" onClick={() => void sync("hourly")} disabled={!overview.configured || Boolean(working)}><Database className="h-4 w-4" />拉取下一店铺小时报告</Button>
        </div>
      </section>

      {!overview.configured ? <div className="flex items-start gap-3 border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /><p>在服务端环境变量中配置 `SELLFOX_CLIENT_ID` 与 `SELLFOX_CLIENT_SECRET`，并将部署服务器 IP 加入赛狐白名单后，才可调用同步按钮。</p></div> : null}
      {notice ? <div className="border border-border bg-white px-4 py-3 text-sm text-foreground">{notice}</div> : null}

      <section className="grid gap-3 md:grid-cols-3">
        <div className="border border-border bg-white p-4"><p className="text-xs font-semibold text-muted">已同步店铺</p><p className="mt-2 text-2xl font-bold metric-tabular">{overview.stores.length}</p><p className="mt-1 text-xs text-muted">按当前工作区隔离</p></div>
        <div className="border border-border bg-white p-4"><p className="text-xs font-semibold text-muted">商品主数据</p><p className="mt-2 text-2xl font-bold metric-tabular">{overview.productCount}</p><p className="mt-1 text-xs text-muted">赛狐同步在线商品</p></div>
        <div className="border border-border bg-white p-4"><p className="text-xs font-semibold text-muted">小时指标</p><p className="mt-2 text-2xl font-bold metric-tabular">{overview.hourlyCount}</p><p className="mt-1 text-xs text-muted">最近写入：{dateTime(overview.latestMetricAt)}</p></div>
      </section>

      <section className="border border-border bg-white">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
          <div><h3 className="text-sm font-bold">商品主数据</h3><p className="mt-1 text-xs text-muted">展示赛狐同步过来的在线商品，可按 SKU、品名、关键词、ASIN 和状态筛选。</p></div>
          <div className="grid gap-2 sm:grid-cols-[minmax(220px,1fr)_160px]">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <input
                value={productSearch}
                onChange={(event) => setProductSearch(event.target.value)}
                placeholder="搜索 SKU、品名、关键词或 ASIN"
                className="h-9 w-full min-w-0 border border-border bg-white pl-9 pr-3 text-sm outline-none focus:border-brand"
              />
            </label>
            <select
              value={productStatus}
              onChange={(event) => setProductStatus(event.target.value as "all" | ProductStatus)}
              className="h-9 border border-border bg-white px-3 text-sm outline-none focus:border-brand"
            >
              <option value="all">全部状态</option>
              {productStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
            </select>
          </div>
        </div>
        {productMasterError ? <div className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm font-semibold text-red-700">{productMasterError}</div> : null}
        <div className="overflow-x-auto thin-scrollbar">
          <table className="min-w-[960px] w-full text-left text-sm">
            <thead className="bg-surface-muted text-xs text-muted">
              <tr>
                {["SKU", "品名 / ASIN", "来源", "状态", "采购价", "供应商", "开发 / 负责人", "创建日期"].map((header) => <th key={header} className="px-4 py-3 font-semibold">{header}</th>)}
              </tr>
            </thead>
            <tbody>
              {productMaster.products.length ? productMaster.products.map((product) => {
                const statusBadge = productStatusBadge(product);

                return (
                  <tr key={product.id} className="border-t border-border align-top">
                    <td className="px-4 py-3 font-mono text-xs font-semibold">{product.sku}</td>
                    <td className="px-4 py-3">
                      <p className="max-w-[280px] truncate font-semibold">{product.chineseName || product.englishName || "-"}</p>
                      <p className="mt-1 font-mono text-xs text-info">{product.asin || "-"}</p>
                    </td>
                    <td className="px-4 py-3"><Badge tone="gray">{productSourceLabel(product as ProductWithSource)}</Badge></td>
                    <td className="px-4 py-3"><Badge tone={statusBadge.tone}>{statusBadge.label}</Badge></td>
                    <td className="px-4 py-3 metric-tabular">CNY {(product.purchasePrice || 0).toFixed(2)}</td>
                    <td className="px-4 py-3"><p className="max-w-[180px] truncate" title={product.supplierName || "-"}>{product.supplierName || "-"}</p></td>
                    <td className="px-4 py-3"><p className="max-w-[160px] truncate" title={product.selectionOwner || product.developer || "-"}>{product.selectionOwner || product.developer || "-"}</p></td>
                    <td className="px-4 py-3 text-xs text-muted">{product.createdAt || "-"}</td>
                  </tr>
                );
              }) : (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-muted">{productMasterLoading ? "正在读取商品主数据..." : "当前筛选没有商品主数据。"}</td></tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="flex flex-col gap-3 border-t border-border px-5 py-3 text-xs text-muted sm:flex-row sm:items-center sm:justify-between">
          <span>共 {productMaster.pagination.total.toLocaleString("zh-CN")} 条，当前第 {productMaster.pagination.page} / {productMaster.pagination.pageCount} 页</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setProductPage((value) => Math.max(1, value - 1))} disabled={productPage <= 1 || productMasterLoading}><ChevronLeft className="h-4 w-4" />上一页</Button>
            <Button size="sm" variant="secondary" onClick={() => setProductPage((value) => Math.min(productMaster.pagination.pageCount, value + 1))} disabled={productPage >= productMaster.pagination.pageCount || productMasterLoading}>下一页<ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      </section>

      <section className="border border-border bg-white">
        <div className="flex items-center justify-between border-b border-border px-5 py-4"><div><h3 className="text-sm font-bold">赛狐店铺</h3><p className="mt-1 text-xs text-muted">首次同步店铺后，在这里确认店铺与站点映射。</p></div><Badge tone="blue">只读</Badge></div>
        <div className="overflow-x-auto thin-scrollbar">
          <table className="min-w-full text-left text-sm"><thead className="bg-surface-muted text-xs text-muted"><tr><th className="px-5 py-3 font-semibold">店铺</th><th className="px-4 py-3 font-semibold">站点</th><th className="px-4 py-3 font-semibold">状态</th><th className="px-5 py-3 font-semibold">最近同步</th></tr></thead>
            <tbody>{overview.stores.length ? overview.stores.map((store) => <tr key={store.id} className="border-t border-border"><td className="px-5 py-3"><p className="font-semibold">{store.name || store.externalId}</p><p className="mt-0.5 font-mono text-xs text-muted">{store.externalId}</p></td><td className="px-4 py-3">{[store.marketplace, store.country].filter(Boolean).join(" / ") || "-"}</td><td className="px-4 py-3"><Badge tone="gray">{store.status || "已授权"}</Badge></td><td className="px-5 py-3 text-xs text-muted">{dateTime(store.lastSyncedAt)}</td></tr>) : <tr><td colSpan={4} className="px-5 py-10 text-center text-sm text-muted">尚无店铺数据。配置凭据后执行“同步店铺”。</td></tr>}</tbody>
          </table>
        </div>
      </section>

      <section className="border border-border bg-white">
        <div className="flex flex-col gap-3 border-b border-border px-5 py-4 lg:flex-row lg:items-end lg:justify-between">
          <div><h3 className="text-sm font-bold">产品经营表现</h3><p className="mt-1 text-xs text-muted">按店铺与赛狐利润报表筛选；默认显示昨日已结算数据。</p><p className="mt-1 text-xs text-muted">最近同步：{performanceRunSummary(overview)}</p></div>
          <a className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-border px-3 text-xs font-semibold text-foreground hover:bg-surface-muted" href={`/api/sellfox/performance/export?${new URLSearchParams({ reportDate, ...(storeId ? { storeId } : {}), ...(search.trim() ? { search: search.trim() } : {}) })}`}><Download className="h-4 w-4" />导出当前筛选</a>
        </div>
        <div className="grid gap-3 border-b border-border px-5 py-3 md:grid-cols-[minmax(180px,1fr)_150px_minmax(220px,1fr)]">
          <select value={storeId} onChange={(event) => setStoreId(event.target.value)} className="h-9 min-w-0 border border-border bg-white px-3 text-sm outline-none focus:border-brand"><option value="">全部店铺</option>{overview.stores.map((store) => <option key={store.id} value={store.id}>{store.name || store.externalId}</option>)}</select>
          <input type="date" value={reportDate} onChange={(event) => setReportDate(event.target.value)} className="h-9 border border-border bg-white px-3 text-sm outline-none focus:border-brand" />
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="搜索 ASIN、MSKU、SKU 或标题" className="h-9 border border-border px-3 text-sm outline-none focus:border-brand" />
        </div>
        <div className="grid gap-px border-b border-border bg-border md:grid-cols-4"><div className="bg-white px-5 py-3 text-sm"><p className="text-xs text-muted">商品行</p><p className="mt-1 font-bold metric-tabular">{performance.pagination.total}</p></div><div className="bg-white px-5 py-3 text-sm"><p className="text-xs text-muted">销量</p><p className="mt-1 font-bold metric-tabular">{performance.summary.saleQuantity ?? 0}</p></div><div className="bg-white px-5 py-3 text-sm"><p className="text-xs text-muted">销售额</p><p className="mt-1 font-bold metric-tabular">{money(performance.summary.saleRevenue ?? 0)}</p></div><div className="bg-white px-5 py-3 text-sm"><p className="text-xs text-muted">毛利润</p><p className="mt-1 font-bold metric-tabular">{money(performance.summary.grossProfit ?? 0)}</p></div></div>
        <div className="overflow-x-auto thin-scrollbar">
          <table className="min-w-[7600px] w-full text-left text-xs">
            <thead className="bg-surface-muted text-muted">
              <tr>
                {performanceColumns.map((column) => (
                  <th key={column.header} className={`whitespace-nowrap px-3 py-3 font-semibold ${column.className ?? ""}`}>{column.header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {performance.rows.length ? performance.rows.map((row) => (
                <tr key={row.id} className="border-t border-border align-top hover:bg-surface-muted/40">
                  {performanceColumns.map((column) => {
                    const value = column.cell(row);

                    return (
                      <td key={column.header} className={`max-w-[320px] whitespace-nowrap px-3 py-2 text-foreground ${column.className ?? ""}`}>
                        <div className="truncate" title={typeof value === "string" ? value : undefined}>{value}</div>
                      </td>
                    );
                  })}
                </tr>
              )) : (
                <tr><td colSpan={performanceColumns.length} className="px-5 py-10 text-center text-muted">{performanceEmptyMessage(overview, reportDate)}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {overview.latestRun ? <p className="text-xs text-muted">最近同步：{overview.latestRun.resource} / {overview.latestRun.status} / {dateTime(overview.latestRun.startedAt)}{overview.latestRun.error ? ` / ${overview.latestRun.error}` : ""}</p> : null}
    </div>
  );
}
