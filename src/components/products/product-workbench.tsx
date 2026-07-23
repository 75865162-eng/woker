"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ExternalLink,
  FileDown,
  FileUp,
  History,
  ImagePlus,
  Minus,
  PackagePlus,
  Plus,
  RotateCcw,
  Save,
  Search,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { initialProducts, productStatusLabels, productStatusOptions, productStatusTones } from "@/data/products";
import type { Product, ProductDraft, ProductSizeCm, ProductStatus } from "@/lib/products/types";

const storageKey = "amazon-bulk-ad-products-v2";
const trialStorageKey = "amazon-bulk-ad-trial-products-v1";
const pageSizeOptions = [20, 50, 100];
const emptySize: ProductSizeCm = { length: 0, width: 0, height: 0 };
const overdueThresholdDays = 7;

type ProductStatusFilter = "all" | "overdue" | ProductStatus;

type TrialPriceRow = {
  name: string;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  actualWeightKg: number;
  suggestedPrice: number;
  purchaseCost: number;
  oceanFreightUnitPrice: number;
  fbaFee: number;
  exchangeRate: number;
};

type TrialCompetitorRow = {
  type: string;
  hotVariantImage: string;
  asin: string;
  sales30Days: string;
  variantCount: string;
  variantType: string;
  hotVariantSpec: string;
  hotVariantPrice: string;
  fbaFee: string;
  priceChangeNote: string;
  reviewCount: string;
  rating: string;
  negativePoint1: string;
  negativePoint2: string;
  negativePoint3: string;
  negativePoint4: string;
  negativePoint5: string;
  packageSize: string;
  note: string;
  noteImage: string;
};

type TrialSupplierRow = {
  productUrl: string;
  factoryName: string;
  configuration: string;
  moq: string;
  leadTime: string;
  domesticFreightIncluded: string;
  certifications: string;
  patentCountry: string;
  packagingMethod: string;
  cost100: number;
  cost300: number;
  taxPoint: string;
  invoiceName: string;
  invoiceSpecUnit: string;
  invoiceRegion: string;
};

type TrialImprovementCellKey =
  | "material"
  | "size"
  | "functionImprovement"
  | "appearance"
  | "accessories"
  | "packaging"
  | "manual"
  | "imageCopySuggestion"
  | "certification";

type TrialImprovementRow = Record<TrialImprovementCellKey, string>;

type TrialImprovement = {
  audience: string;
  scenario: string;
  painPoint1: string;
  painPoint2: string;
  painPoint3: string;
  material: string;
  size: string;
  functionImprovement: string;
  appearance: string;
  accessories: string;
  packaging: string;
  manual: string;
  imageCopySuggestion: string;
  peakSeason: string;
  peakSales: string;
  offSeasonSales: string;
  targetSales: string;
  infringement: string;
  certification: string;
  rows: TrialImprovementRow[];
};

type TrialKeywordRow = {
  keyword: string;
  cpc: number;
  monthlySearches: number;
  abaRank: number;
};

type TrialProductDraft = {
  id?: string;
  title: string;
  pricingRows: TrialPriceRow[];
  competitors: TrialCompetitorRow[];
  suppliers: TrialSupplierRow[];
  improvement: TrialImprovement;
  remark: string;
  remarkImages: string[];
  keywords: TrialKeywordRow[];
};

type ProductEditorDraft = ProductDraft & {
  workbookDetail: TrialProductDraft;
};

type ProductFilters = {
  keyword: string;
  asin: string;
  developer: string;
  supplierName: string;
  status: ProductStatusFilter;
  minPrice: string;
  maxPrice: string;
};

const initialFilters: ProductFilters = {
  keyword: "",
  asin: "",
  developer: "",
  supplierName: "",
  status: "all",
  minPrice: "",
  maxPrice: "",
};

const competitorTypeOptions = ["头部竞品", "直接竞品", "参考竞品"];
const competitorTextFields: Array<Exclude<keyof TrialCompetitorRow, "type" | "hotVariantImage" | "asin" | "note" | "noteImage">> = [
  "sales30Days",
  "variantCount",
  "variantType",
  "hotVariantSpec",
  "hotVariantPrice",
  "fbaFee",
  "priceChangeNote",
  "reviewCount",
  "rating",
  "negativePoint1",
  "negativePoint2",
  "negativePoint3",
  "negativePoint4",
  "negativePoint5",
  "packageSize",
];
const compactCompetitorFields = new Set<keyof TrialCompetitorRow>([
  "sales30Days",
  "variantCount",
  "variantType",
  "hotVariantSpec",
  "hotVariantPrice",
  "fbaFee",
  "priceChangeNote",
  "reviewCount",
  "rating",
]);
const negativeCompetitorFields = new Set<keyof TrialCompetitorRow>([
  "negativePoint1",
  "negativePoint2",
  "negativePoint3",
  "negativePoint4",
  "negativePoint5",
]);
const supplierFields: Array<keyof TrialSupplierRow> = [
  "productUrl",
  "factoryName",
  "configuration",
  "moq",
  "leadTime",
  "domesticFreightIncluded",
  "certifications",
  "patentCountry",
  "packagingMethod",
  "cost100",
  "cost300",
  "taxPoint",
  "invoiceRegion",
];
const wideSupplierFields = new Set<keyof TrialSupplierRow>(["productUrl", "factoryName", "configuration", "moq"]);
const mediumSupplierFields = new Set<keyof TrialSupplierRow>(["packagingMethod"]);
const extraWideSupplierFields = new Set<keyof TrialSupplierRow>(["taxPoint", "invoiceRegion"]);
const improvementColumns: Array<{ field: TrialImprovementCellKey; label: string }> = [
  { field: "material", label: "材质改进" },
  { field: "size", label: "尺寸改进" },
  { field: "functionImprovement", label: "功能改进" },
  { field: "appearance", label: "外观（款式）" },
  { field: "accessories", label: "配件（搭配）" },
  { field: "packaging", label: "包装改进" },
  { field: "manual", label: "说明书" },
  { field: "imageCopySuggestion", label: "文案/主/附图片建议" },
  { field: "certification", label: "备注" },
];
const scalarImprovementFields: Array<Exclude<keyof TrialImprovement, "rows">> = [
  "audience",
  "scenario",
  "painPoint1",
  "painPoint2",
  "painPoint3",
  "material",
  "size",
  "functionImprovement",
  "appearance",
  "accessories",
  "packaging",
  "manual",
  "imageCopySuggestion",
  "peakSeason",
  "peakSales",
  "offSeasonSales",
  "targetSales",
  "infringement",
  "certification",
];
const peakSeasonLevels = [
  "bg-transparent text-muted hover:bg-surface-muted",
  "bg-yellow-100 text-yellow-900",
  "bg-yellow-300 text-yellow-950",
  "bg-amber-400 text-amber-950",
  "bg-orange-500 text-white",
  "bg-red-600 text-white",
];

export function ProductWorkbench() {
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [trialProducts, setTrialProducts] = useState<TrialProductDraft[]>([]);
  const [filters, setFilters] = useState<ProductFilters>(initialFilters);
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isTrialEditorOpen, setIsTrialEditorOpen] = useState(false);
  const [isActivityLogOpen, setIsActivityLogOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [activityLog, setActivityLog] = useState<string[]>(["产品工作台已就绪"]);
  const importInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (!saved) {
      return;
    }

    try {
      const parsed = JSON.parse(saved) as Product[];
      if (Array.isArray(parsed)) {
        setProducts(parsed.map(hydrateProductFromExcelSeed));
      }
    } catch {
      setActivityLog((current) => ["本地产品数据读取失败，已使用演示数据", ...current]);
    }
  }, []);

  useEffect(() => {
    const saved = window.localStorage.getItem(trialStorageKey);
    if (!saved) {
      return;
    }

    try {
      const parsed = JSON.parse(saved) as TrialProductDraft[];
      if (Array.isArray(parsed)) {
        setTrialProducts(parsed);
      }
    } catch {
      setActivityLog((current) => ["试算商品数据读取失败，已跳过本地缓存", ...current]);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem(storageKey, JSON.stringify(products));
  }, [products]);

  useEffect(() => {
    window.localStorage.setItem(trialStorageKey, JSON.stringify(trialProducts));
  }, [trialProducts]);

  const filteredProducts = useMemo(() => {
    const minPrice = Number(filters.minPrice);
    const maxPrice = Number(filters.maxPrice);
    const hasMinPrice = filters.minPrice.trim() !== "" && Number.isFinite(minPrice);
    const hasMaxPrice = filters.maxPrice.trim() !== "" && Number.isFinite(maxPrice);
    const keyword = filters.keyword.trim().toLowerCase();
    const asin = filters.asin.trim().toLowerCase();
    const developer = filters.developer.trim().toLowerCase();
    const supplierName = filters.supplierName.trim().toLowerCase();

    return products.filter((product) => {
      const searchable = [product.sku, product.chineseName, product.englishName, product.keywords, product.note]
        .join(" ")
        .toLowerCase();

      if (keyword && !searchable.includes(keyword)) return false;
      if (asin && !product.asin.toLowerCase().includes(asin) && !product.competitorAsins.join(" ").toLowerCase().includes(asin)) return false;
      if (developer && !product.developer.toLowerCase().includes(developer)) return false;
      if (supplierName && !product.supplierName.toLowerCase().includes(supplierName)) return false;
      if (filters.status === "overdue" && !isOverdueProduct(product)) return false;
      if (filters.status !== "all" && filters.status !== "overdue" && product.status !== filters.status) return false;
      if (hasMinPrice && product.purchasePrice < minPrice) return false;
      if (hasMaxPrice && product.purchasePrice > maxPrice) return false;

      return true;
    });
  }, [filters, products]);

  const pageCount = Math.max(1, Math.ceil(filteredProducts.length / pageSize));
  const visibleProducts = filteredProducts.slice((page - 1) * pageSize, page * pageSize);
  const activeProduct = products.find((product) => product.id === activeProductId) ?? null;

  useEffect(() => {
    setPage(1);
  }, [filters, pageSize]);

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

  const listedCount = products.filter((product) => product.status === "listed").length;
  const developingCount = products.filter((product) => product.status === "developing").length;
  const opsReviewCount = products.filter((product) => product.status === "ops_review").length;
  const overdueCount = products.filter(isOverdueProduct).length;

  function openNewProduct() {
    setActiveProductId(null);
    setIsEditorOpen(true);
  }

  function openProduct(productId: string) {
    setActiveProductId(productId);
    setIsEditorOpen(true);
  }

  function handleSaveProduct(draft: ProductDraft) {
    const existing = draft.id ? products.find((product) => product.id === draft.id) : null;
    const nextProduct: Product = {
      ...draft,
      id: existing?.id ?? `prod-${draft.sku}`,
      sku: existing?.sku ?? draft.sku,
      createdAt: existing?.createdAt ?? formatDateTime(new Date()),
    };

    setProducts((current) => {
      if (existing) {
        return current.map((product) => (product.id === existing.id ? nextProduct : product));
      }

      return [nextProduct, ...current];
    });
    setActiveProductId(nextProduct.id);
    setIsEditorOpen(false);
    setActivityLog((current) => [`${existing ? "保存" : "新增"}商品 ${nextProduct.sku}`, ...current].slice(0, 8));
  }

  function handleSaveTrialProduct(draft: TrialProductDraft) {
    const nextTrialProduct = {
      ...draft,
      id: draft.id ?? `trial-${Date.now()}`,
    };

    setTrialProducts((current) => [nextTrialProduct, ...current]);
    setIsTrialEditorOpen(false);
    setActivityLog((current) => [`新增试算商品 ${nextTrialProduct.title || nextTrialProduct.pricingRows[0]?.name || "未命名"}`, ...current].slice(0, 8));
  }

  function resetDemoData() {
    setProducts(initialProducts);
    setActivityLog((current) => ["已恢复演示产品数据", ...current].slice(0, 8));
  }

  async function handleImportFile(file: File | undefined) {
    if (!file) {
      return;
    }

    try {
      const imported = await parseProductWorkbookFile(file, products);
      setProducts((current) => [imported, ...current]);
      setActiveProductId(imported.id);
      setIsEditorOpen(true);
      setActivityLog((current) => [`已导入 ${file.name}`, ...current].slice(0, 8));
    } catch (error) {
      const message = error instanceof Error ? error.message : "导入失败";
      window.alert(message);
      setActivityLog((current) => [`导入失败：${message}`, ...current].slice(0, 8));
    }
  }

  return (
    <>
      <div className="space-y-5">
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <SummaryTile
            label="全部商品"
            value={products.length.toLocaleString("zh-CN")}
            active={filters.status === "all"}
            onClick={() => setFilters((current) => ({ ...current, status: "all" }))}
          />
          <SummaryTile
            label="开发中"
            value={developingCount.toLocaleString("zh-CN")}
            tone="blue"
            active={filters.status === "developing"}
            onClick={() => setFilters((current) => ({ ...current, status: "developing" }))}
          />
          <SummaryTile
            label="运营确认中"
            value={opsReviewCount.toLocaleString("zh-CN")}
            tone="amber"
            active={filters.status === "ops_review"}
            onClick={() => setFilters((current) => ({ ...current, status: "ops_review" }))}
          />
          <SummaryTile
            label="已上架"
            value={listedCount.toLocaleString("zh-CN")}
            tone="green"
            active={filters.status === "listed"}
            onClick={() => setFilters((current) => ({ ...current, status: "listed" }))}
          />
          <SummaryTile
            label="超期处理"
            value={overdueCount.toLocaleString("zh-CN")}
            tone="red"
            active={filters.status === "overdue"}
            onClick={() => setFilters((current) => ({ ...current, status: "overdue" }))}
          />
        </section>

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>产品列表</CardTitle>
              <p className="mt-1 text-xs font-medium text-muted">新增 SKU 默认待开发；创建超过 7 天且未上架/未取消的商品会自动进入超期处理。</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <input
                ref={importInputRef}
                className="hidden"
                type="file"
                accept=".xlsx,.xls"
                onChange={(event) => {
                  void handleImportFile(event.target.files?.[0]);
                  event.currentTarget.value = "";
                }}
              />
              <Button variant="secondary" size="sm" onClick={() => importInputRef.current?.click()}>
                <FileUp className="h-4 w-4" />
                导入数据
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setActivityLog((current) => ["导出功能待接入 Excel 模板", ...current].slice(0, 8))}>
                <FileDown className="h-4 w-4" />
                导出数据
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setIsActivityLogOpen(true)}>
                <History className="h-4 w-4" />
                操作日志
              </Button>
              <Button size="sm" onClick={openNewProduct}>
                <PackagePlus className="h-4 w-4" />
                新增商品
              </Button>
              <Button size="sm" onClick={() => setIsTrialEditorOpen(true)}>
                <PackagePlus className="h-4 w-4" />
                新增试算商品
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <ProductFiltersBar filters={filters} onChange={setFilters} onReset={() => setFilters(initialFilters)} />
            <ProductTable products={visibleProducts} totalCount={filteredProducts.length} onOpenProduct={openProduct} />
            <Pagination page={page} pageCount={pageCount} pageSize={pageSize} pageSizeOptions={pageSizeOptions} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </CardContent>
        </Card>

        {isActivityLogOpen ? (
          <ActivityLogModal entries={activityLog} onClose={() => setIsActivityLogOpen(false)} onResetDemoData={resetDemoData} />
        ) : null}

        {isEditorOpen ? (
          <ProductEditor
            product={activeProduct}
            products={products}
            onClose={() => setIsEditorOpen(false)}
            onSave={handleSaveProduct}
          />
        ) : null}

        {isTrialEditorOpen ? (
          <TrialProductEditor
            onClose={() => setIsTrialEditorOpen(false)}
            onSave={handleSaveTrialProduct}
          />
        ) : null}
      </div>
    </>
  );
}

function ProductFiltersBar({
  filters,
  onChange,
  onReset,
}: {
  filters: ProductFilters;
  onChange: (filters: ProductFilters) => void;
  onReset: () => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface-muted p-3">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-[1.2fr_0.8fr_0.8fr_0.9fr_0.8fr_0.9fr_auto]">
        <LabeledInput
          label="品名 / SKU / 关键词"
          value={filters.keyword}
          placeholder="搜索品名、SKU、关键词"
          onChange={(value) => onChange({ ...filters, keyword: value })}
        />
        <LabeledInput label="ASIN" value={filters.asin} placeholder="主 ASIN 或竞品 ASIN" onChange={(value) => onChange({ ...filters, asin: value })} />
        <LabeledInput label="开发员" value={filters.developer} placeholder="姓名" onChange={(value) => onChange({ ...filters, developer: value })} />
        <LabeledInput label="供应商名称" value={filters.supplierName} placeholder="供应商" onChange={(value) => onChange({ ...filters, supplierName: value })} />
        <label className="text-xs font-semibold text-muted">
          状态
          <select
            className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus:border-brand"
            value={filters.status}
            onChange={(event) => onChange({ ...filters, status: event.target.value as ProductFilters["status"] })}
          >
            <option value="all">全部状态</option>
            {productStatusOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <LabeledInput label="采购价从" type="number" value={filters.minPrice} placeholder="5" onChange={(value) => onChange({ ...filters, minPrice: value })} />
          <LabeledInput label="到" type="number" value={filters.maxPrice} placeholder="10" onChange={(value) => onChange({ ...filters, maxPrice: value })} />
        </div>
        <div className="flex items-end gap-2">
          <Button className="h-10" size="icon" title="搜索" onClick={() => onChange({ ...filters })}>
            <Search className="h-4 w-4" />
          </Button>
          <Button className="h-10" size="icon" title="重置" variant="secondary" onClick={onReset}>
            <RotateCcw className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

function ProductTable({
  products,
  totalCount,
  onOpenProduct,
}: {
  products: Product[];
  totalCount: number;
  onOpenProduct: (productId: string) => void;
}) {
  return (
    <div className="min-w-0 overflow-hidden rounded-lg border border-border bg-white">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <p className="text-sm font-bold text-foreground">筛选结果</p>
        <span className="text-xs font-semibold text-muted">共 {totalCount.toLocaleString("zh-CN")} 个商品</span>
      </div>
      <div className="thin-scrollbar overflow-auto">
        <table className="min-w-[1180px] table-fixed text-left text-sm">
          <thead className="bg-surface-muted text-xs text-muted">
            <tr>
              <th className="w-[88px] px-3 py-3">图片</th>
              <th className="w-[96px] px-3 py-3">SKU</th>
              <th className="w-[190px] px-3 py-3">品名</th>
              <th className="w-[124px] px-3 py-3">ASIN</th>
              <th className="w-[92px] px-3 py-3">开发员</th>
              <th className="w-[104px] px-3 py-3">采购价格</th>
              <th className="w-[110px] px-3 py-3">状态</th>
              <th className="w-[170px] px-3 py-3">供应商名称</th>
              <th className="w-[170px] px-3 py-3">规格</th>
              <th className="w-[100px] px-3 py-3">采购交期</th>
              <th className="w-[112px] px-3 py-3">创建日期</th>
              <th className="w-[160px] px-3 py-3">选品关键词</th>
              <th className="w-[160px] px-3 py-3">备注</th>
            </tr>
          </thead>
          <tbody>
            {products.map((product) => (
              <tr key={product.id} className="border-t border-border/70 align-top hover:bg-surface-muted/60">
                <td className="px-3 py-3">
                  <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted">
                    {product.images[0] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={product.images[0]} alt={product.chineseName} className="h-full w-full object-contain p-1" />
                    ) : (
                      <ImagePlus className="h-5 w-5 text-muted" />
                    )}
                  </div>
                </td>
                <td className="px-3 py-3">
                  <button className="font-bold text-brand hover:text-brand-dark" onClick={() => onOpenProduct(product.id)}>
                    {product.sku}
                  </button>
                </td>
                <td className="px-3 py-3">
                  <p className="line-clamp-2 font-semibold text-foreground">{product.chineseName || "--"}</p>
                  <p className="mt-1 line-clamp-1 text-xs text-muted">{product.englishName || "--"}</p>
                </td>
                <td className="px-3 py-3 font-mono text-xs">{product.asin || "--"}</td>
                <td className="px-3 py-3">{product.developer || "--"}</td>
                <td className="px-3 py-3 font-semibold metric-tabular">CNY {product.purchasePrice.toFixed(2)}</td>
                <td className="px-3 py-3">
                  <Badge tone={productStatusTones[product.status]}>{productStatusLabels[product.status]}</Badge>
                </td>
                <td className="px-3 py-3">
                  <p className="line-clamp-2">{product.supplierName || "--"}</p>
                </td>
                <td className="px-3 py-3">
                  <p className="line-clamp-2 text-xs">{product.specs || "--"}</p>
                </td>
                <td className="px-3 py-3">{product.purchaseLeadTime || "--"}</td>
                <td className="px-3 py-3">{product.createdAt}</td>
                <td className="px-3 py-3">
                  <p className="line-clamp-2 text-xs">{product.keywords || "--"}</p>
                </td>
                <td className="px-3 py-3">
                  <p className="line-clamp-2 text-xs">{product.note || "--"}</p>
                </td>
              </tr>
            ))}
            {!products.length ? (
              <tr>
                <td colSpan={13} className="px-3 py-14 text-center text-sm text-muted">
                  没有匹配的商品，调整筛选条件后再试。
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ActivityLogModal({
  entries,
  onClose,
  onResetDemoData,
}: {
  entries: string[];
  onClose: () => void;
  onResetDemoData: () => void;
}) {
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-foreground/40 p-6 backdrop-blur-sm">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-lg font-bold text-foreground">处理记录</h3>
            <p className="mt-1 text-xs font-semibold text-muted">查看最近的商品处理和系统操作。</p>
          </div>
          <Button variant="secondary" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
            关闭
          </Button>
        </div>
        <div className="thin-scrollbar flex-1 space-y-3 overflow-y-auto p-5">
          {entries.map((entry, index) => (
            <div key={`${entry}-${index}`} className="rounded-md border border-border bg-surface-muted px-3 py-2 text-sm font-medium text-foreground">
              {entry}
            </div>
          ))}
          {!entries.length ? <div className="rounded-md border border-border bg-surface-muted px-3 py-8 text-center text-sm text-muted">暂无处理记录</div> : null}
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <Button variant="secondary" size="sm" onClick={onResetDemoData}>
            恢复演示
          </Button>
          <Button size="sm" onClick={onClose}>
            确定
          </Button>
        </div>
      </div>
    </div>
  );
}

function TrialProductEditor({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (draft: TrialProductDraft) => void;
}) {
  const [draft, setDraft] = useState<TrialProductDraft>(() => createTrialProductDraft());

  function updatePricingRow(index: number, field: keyof TrialPriceRow, value: string) {
    setDraft((current) => ({
      ...current,
      pricingRows: current.pricingRows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: field === "name" ? value : Number(value) || 0 } : row,
      ),
    }));
  }

  function updateCompetitor(index: number, field: keyof TrialCompetitorRow, value: string) {
    setDraft((current) => ({
      ...current,
      competitors: current.competitors.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)),
    }));
  }

  function updateSupplier(index: number, field: keyof TrialSupplierRow, value: string) {
    setDraft((current) => ({
      ...current,
      suppliers: current.suppliers.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: field === "cost100" || field === "cost300" ? Number(value) || 0 : value } : row,
      ),
    }));
  }

  function updateImprovement(field: Exclude<keyof TrialImprovement, "rows">, value: string) {
    setDraft((current) => ({
      ...current,
      improvement: { ...current.improvement, [field]: value },
    }));
  }

  function updateKeyword(index: number, field: keyof TrialKeywordRow, value: string) {
    setDraft((current) => ({
      ...current,
      keywords: current.keywords.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              [field]: field === "keyword" ? value : Number(value) || 0,
            }
          : row,
      ),
    }));
  }

  function handleSubmit() {
    const hasName = draft.title.trim() || draft.pricingRows.some((row) => row.name.trim());
    if (!hasName) {
      window.alert("请至少填写试算商品名称。");
      return;
    }

    onSave({
      ...draft,
      title: draft.title.trim() || draft.pricingRows[0]?.name.trim() || "未命名试算商品",
    });
  }

  return (
    <div className="fixed inset-0 z-30 bg-foreground/35 p-4 backdrop-blur-sm">
      <div className="mx-auto flex h-full max-w-7xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">新增试算商品</h2>
            <p className="mt-1 text-xs font-medium text-muted">按 Excel 试算表拆分为利润试算、竞品、供应商、改进点和关键词区域。</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
              取消
            </Button>
            <Button size="sm" onClick={handleSubmit}>
              <Save className="h-4 w-4" />
              保存
            </Button>
          </div>
        </div>

        <div className="thin-scrollbar flex-1 space-y-5 overflow-auto p-5">
          <Card>
            <CardHeader>
              <CardTitle>试算商品标题</CardTitle>
            </CardHeader>
            <CardContent>
              <LabeledInput label="试算商品名称" value={draft.title} placeholder="例如：交易卡展示架" onChange={(value) => setDraft((current) => ({ ...current, title: value }))} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>区域 1：利润试算</CardTitle>
            </CardHeader>
            <CardContent className="thin-scrollbar overflow-auto">
              <table className="min-w-[1760px] text-left text-xs">
                <thead className="bg-surface-muted text-muted">
                  <tr>
                    {["品名", "长cm", "宽cm", "高cm", "实际重Kg", "材积重Kg", "建议售价(USD)", "采购成本（RMB）", "FBA配送费$", "3.5% 的燃油和物流相关附加费（USD)", "海运单价（RMB）", "海运头程（RMB）", "佣金(USD)", "月仓储费(USD)", "汇率", "保本价(USD)", "海运毛利润(USD)", "海运毛利润率", "体积重量/磅", "重量/磅"].map((label) => (
                      <th key={label} className="px-2 py-2 font-bold">
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {draft.pricingRows.map((row, index) => {
                    const calc = calculateTrialPricing(row);
                    return (
                      <tr key={index} className="border-t border-border align-top">
                        <td className="px-2 py-2"><SmallInput value={row.name} onChange={(value) => updatePricingRow(index, "name", value)} /></td>
                        <td className="px-2 py-2"><SmallInput compact type="number" value={row.lengthCm} onChange={(value) => updatePricingRow(index, "lengthCm", value)} /></td>
                        <td className="px-2 py-2"><SmallInput compact type="number" value={row.widthCm} onChange={(value) => updatePricingRow(index, "widthCm", value)} /></td>
                        <td className="px-2 py-2"><SmallInput compact type="number" value={row.heightCm} onChange={(value) => updatePricingRow(index, "heightCm", value)} /></td>
                        <td className="px-2 py-2"><SmallInput compact type="number" value={row.actualWeightKg} onChange={(value) => updatePricingRow(index, "actualWeightKg", value)} /></td>
                        <ReadonlyMetric value={calc.volumeWeightKg} />
                        <td className="px-2 py-2"><SmallInput compact type="number" value={row.suggestedPrice} onChange={(value) => updatePricingRow(index, "suggestedPrice", value)} /></td>
                        <td className="px-2 py-2"><SmallInput compact type="number" value={row.purchaseCost} onChange={(value) => updatePricingRow(index, "purchaseCost", value)} /></td>
                        <td className="px-2 py-2"><SmallInput compact type="number" value={row.fbaFee} onChange={(value) => updatePricingRow(index, "fbaFee", value)} /></td>
                        <ReadonlyMetric value={calc.fuelFee} />
                        <td className="px-2 py-2"><SmallInput compact type="number" value={row.oceanFreightUnitPrice} onChange={(value) => updatePricingRow(index, "oceanFreightUnitPrice", value)} /></td>
                        <ReadonlyMetric value={calc.oceanFreight} />
                        <ReadonlyMetric value={calc.commission} />
                        <ReadonlyMetric value={calc.monthlyStorageFee} />
                        <td className="px-2 py-2"><SmallInput compact type="number" value={row.exchangeRate} onChange={(value) => updatePricingRow(index, "exchangeRate", value)} /></td>
                        <ReadonlyMetric value={calc.breakEvenPrice} />
                        <ReadonlyMetric value={calc.profit} />
                        <ReadonlyMetric value={`${(calc.profitRate * 100).toFixed(1)}%`} />
                        <ReadonlyMetric value={calc.volumeWeightLb} />
                        <ReadonlyMetric value={calc.actualWeightLb} />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>区域 2：竞品分析</CardTitle>
            </CardHeader>
            <CardContent className="thin-scrollbar overflow-auto">
              <table className="min-w-[1560px] text-left text-xs">
                <thead className="bg-surface-muted text-muted">
                  <tr>
                    {["类型", "ASIN", "近30天销量", "变体数量", "变体类型", "热销变体规格", "热销变体价格($)", "FBA费用($)", "近3个月价格变动备注", "评论数", "评分", "差评点1", "差评点2", "差评点3", "差评点4", "差评点5", "竞品包装尺寸", "备注"].map((label) => (
                      <th key={label} className="px-2 py-2 font-bold">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {draft.competitors.map((row, index) => (
                    <tr key={index} className="border-t border-border">
                      {(Object.keys(row) as (keyof TrialCompetitorRow)[]).map((field) => (
                        <td key={field} className="px-2 py-2">
                          <SmallInput value={row[field]} onChange={(value) => updateCompetitor(index, field, value)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>区域 3：供应商报价</CardTitle>
            </CardHeader>
            <CardContent className="thin-scrollbar overflow-auto">
              <table className="min-w-[1420px] text-left text-xs">
                <thead className="bg-surface-muted text-muted">
                  <tr>
                    {["供应商产品链接", "厂家名称", "配置", "起订量", "交期", "国内物流费", "相关认证", "专利国家", "产品包装方式", "采购成本（100套）", "采购成本（300）", "开票信息", "备注"].map((label) => (
                      <th key={label} className="px-2 py-2 font-bold">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {draft.suppliers.map((row, index) => (
                    <tr key={index} className="border-t border-border">
                      {supplierFields.map((field) => (
                        <td key={field} className="px-2 py-2">
                          {field === "productUrl" ? (
                            <div className="flex gap-2">
                              <SmallTextarea size="supplierWide" value={row[field]} onChange={(value) => updateSupplier(index, field, value)} />
                              <ExternalLinkButton href={row[field]} />
                            </div>
                          ) : (
                            <SmallTextarea
                              size={getSupplierTextareaSize(field)}
                              value={row[field]}
                              onChange={(value) => updateSupplier(index, field, value)}
                            />
                          )}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>区域 4：产品改进点</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {scalarImprovementFields.map((field) => (
                <LabeledInput key={field} label={trialImprovementLabels[field]} value={draft.improvement[field]} onChange={(value) => updateImprovement(field, value)} />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>区域 5：关键词</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="thin-scrollbar overflow-auto">
                <table className="min-w-[640px] text-left text-xs">
                  <thead className="bg-surface-muted text-muted">
                    <tr>
                      <th className="px-2 py-2">关键词</th>
                      <th className="px-2 py-2">CPC</th>
                      <th className="px-2 py-2">月搜索量</th>
                      <th className="px-2 py-2">ABA周排名</th>
                    </tr>
                  </thead>
                  <tbody>
                    {draft.keywords.map((row, index) => (
                      <tr key={index} className="border-t border-border">
                        <td className="px-2 py-2"><SmallInput value={row.keyword} onChange={(value) => updateKeyword(index, "keyword", value)} /></td>
                        <td className="px-2 py-2"><SmallInput type="number" value={row.cpc} onChange={(value) => updateKeyword(index, "cpc", value)} /></td>
                        <td className="px-2 py-2"><SmallInput type="number" value={row.monthlySearches} onChange={(value) => updateKeyword(index, "monthlySearches", value)} /></td>
                        <td className="px-2 py-2"><SmallInput type="number" value={row.abaRank} onChange={(value) => updateKeyword(index, "abaRank", value)} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <label className="block text-xs font-semibold text-muted">
                备注
                <textarea
                  className="mt-1 min-h-24 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
                  value={draft.remark}
                  onChange={(event) => setDraft((current) => ({ ...current, remark: event.target.value }))}
                />
              </label>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function ProductEditor({
  product,
  products,
  onClose,
  onSave,
}: {
  product: Product | null;
  products: Product[];
  onClose: () => void;
  onSave: (draft: ProductDraft) => void;
}) {
  const [draft, setDraft] = useState<ProductEditorDraft>(() => productToDraft(product, products));

  const isEditing = Boolean(product);
  const mainAmazonLink = buildAmazonLink(draft.asin);
  const workbookDetail = draft.workbookDetail;

  function setField<K extends keyof ProductDraft>(field: K, value: ProductDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function setWorkbookDetail(updater: (current: TrialProductDraft) => TrialProductDraft) {
    setDraft((current) => ({ ...current, workbookDetail: updater(current.workbookDetail) }));
  }

  function updateWorkbookPricingRow(index: number, field: keyof TrialPriceRow, value: string) {
    setWorkbookDetail((current) => ({
      ...current,
      pricingRows: current.pricingRows.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: field === "name" ? value : Number(value) || 0 } : row,
      ),
    }));
  }

  function addWorkbookPricingRow() {
    setWorkbookDetail((current) => {
      const previous = current.pricingRows[current.pricingRows.length - 1];
      const nextRow: TrialPriceRow = previous
        ? { ...previous, name: "" }
        : { name: "", lengthCm: 0, widthCm: 0, heightCm: 0, actualWeightKg: 0, suggestedPrice: 0, purchaseCost: 0, oceanFreightUnitPrice: 12, fbaFee: 0, exchangeRate: 6.9 };

      return { ...current, pricingRows: [...current.pricingRows, nextRow] };
    });
  }

  function removeWorkbookPricingRow() {
    setWorkbookDetail((current) => ({
      ...current,
      pricingRows: current.pricingRows.length > 1 ? current.pricingRows.slice(0, -1) : current.pricingRows,
    }));
  }

  function updateWorkbookCompetitor(index: number, field: keyof TrialCompetitorRow, value: string) {
    setWorkbookDetail((current) => ({
      ...current,
      competitors: current.competitors.map((row, rowIndex) => {
        if (rowIndex !== index) {
          return row;
        }

        const nextRow = { ...row, [field]: value };
        if (field === "type" && value !== "直接竞品") {
          return {
            ...nextRow,
            negativePoint1: "",
            negativePoint2: "",
            negativePoint3: "",
            negativePoint4: "",
            negativePoint5: "",
          };
        }

        return nextRow;
      }),
    }));
    if (field === "asin") {
      setDraft((current) => {
        const next = [...current.competitorAsins];
        next[index] = value.trim();
        return { ...current, competitorAsins: next };
      });
    }
  }

  function addWorkbookCompetitor() {
    setWorkbookDetail((current) => ({
      ...current,
      competitors: [
        ...current.competitors,
        {
          type: "直接竞品",
          hotVariantImage: "",
          asin: "",
          sales30Days: "",
          variantCount: "",
          variantType: "",
          hotVariantSpec: "",
          hotVariantPrice: "",
          fbaFee: "",
          priceChangeNote: "",
          reviewCount: "",
          rating: "",
          negativePoint1: "",
          negativePoint2: "",
          negativePoint3: "",
          negativePoint4: "",
          negativePoint5: "",
          packageSize: "",
          note: "",
          noteImage: "",
        },
      ],
    }));
  }

  function removeWorkbookCompetitor() {
    setWorkbookDetail((current) => ({
      ...current,
      competitors: current.competitors.length > 1 ? current.competitors.slice(0, -1) : current.competitors,
    }));
  }

  function updateWorkbookSupplier(index: number, field: keyof TrialSupplierRow, value: string) {
    setWorkbookDetail((current) => ({
      ...current,
      suppliers: current.suppliers.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: field === "cost100" || field === "cost300" ? Number(value) || 0 : value } : row,
      ),
    }));
  }

  function addWorkbookSupplier() {
    setWorkbookDetail((current) => ({
      ...current,
      suppliers: [
        ...current.suppliers,
        {
          productUrl: "",
          factoryName: "",
          configuration: "",
          moq: "",
          leadTime: "",
          domesticFreightIncluded: "",
          certifications: "",
          patentCountry: "",
          packagingMethod: "",
          cost100: 0,
          cost300: 0,
          taxPoint: "",
          invoiceName: "",
          invoiceSpecUnit: "",
          invoiceRegion: "",
        },
      ],
    }));
  }

  function removeWorkbookSupplier() {
    setWorkbookDetail((current) => ({
      ...current,
      suppliers: current.suppliers.length > 1 ? current.suppliers.slice(0, -1) : current.suppliers,
    }));
  }

  function updateWorkbookImprovement(field: Exclude<keyof TrialImprovement, "rows">, value: string) {
    setWorkbookDetail((current) => ({ ...current, improvement: { ...current.improvement, [field]: value } }));
  }

  function updateWorkbookImprovementRow(index: number, field: TrialImprovementCellKey, value: string) {
    setWorkbookDetail((current) => {
      const rows = [...(current.improvement.rows ?? [])];
      rows[index] = {
        ...createEmptyImprovementRow(),
        ...getImprovementRow(current.improvement, index),
        [field]: value,
      };

      return {
        ...current,
        improvement: {
          ...current.improvement,
          rows,
        },
      };
    });
  }

  function updateWorkbookKeyword(index: number, field: keyof TrialKeywordRow, value: string) {
    setWorkbookDetail((current) => ({
      ...current,
      keywords: current.keywords.map((row, rowIndex) =>
        rowIndex === index ? { ...row, [field]: field === "keyword" ? value : Number(value) || 0 } : row,
      ),
    }));
  }

  function replaceWorkbookKeywords(keywords: TrialKeywordRow[]) {
    setWorkbookDetail((current) => ({
      ...current,
      keywords: keywords.length ? keywords : current.keywords,
    }));
  }

  function updateWorkbookRemarkImages(images: string[]) {
    setWorkbookDetail((current) => ({
      ...current,
      remarkImages: images,
    }));
  }

  function handleImageUpload(files: FileList | null) {
    const selected = Array.from(files ?? []).slice(0, 10 - draft.images.length);
    if (!selected.length) {
      return;
    }

    const readers = selected.map(
      (file) =>
        new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.readAsDataURL(file);
        }),
    );

    void Promise.all(readers).then((images) => {
      setDraft((current) => ({ ...current, images: [...current.images, ...images].slice(0, 10) }));
    });
  }

  function handleSubmit() {
    if (!draft.chineseName.trim() || !draft.englishName.trim()) {
      window.alert("中文名和英文名为必填项。");
      return;
    }

    if (draft.status === "canceled" && !draft.cancelReason.trim()) {
      window.alert("状态为已取消时，请填写取消原因。");
      return;
    }

    onSave({
      ...draft,
      sku: draft.sku.trim(),
      chineseName: draft.chineseName.trim(),
      englishName: draft.englishName.trim(),
      asin: draft.asin.trim().toUpperCase(),
      cancelReason: draft.cancelReason.trim(),
      competitorAsins: workbookDetail.competitors.map((competitor) => competitor.asin.trim().toUpperCase()).filter(Boolean),
    });
  }

  return (
    <div className="fixed inset-0 z-30 bg-foreground/35 p-4 backdrop-blur-sm">
      <div className="mx-auto flex h-full w-full max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">{isEditing ? `商品详情 ${draft.sku}` : "新增商品"}</h2>
            <p className="mt-1 text-xs font-medium text-muted">保存后会回到产品列表，SKU 页面与新增页面使用同一套字段。</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              <X className="h-4 w-4" />
              取消
            </Button>
            <Button size="sm" onClick={handleSubmit}>
              <Save className="h-4 w-4" />
              保存
            </Button>
          </div>
        </div>

        <div className="thin-scrollbar flex-1 overflow-auto p-5">
          <section className="space-y-4">
            <Card>
              <CardContent className="grid gap-5 p-5 lg:grid-cols-[280px_minmax(0,1fr)]">
                <div>
                  <h3 className="text-lg font-bold text-foreground">图片</h3>
                  <label className="mt-4 flex aspect-square w-full cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface-muted text-center transition-colors hover:border-brand hover:bg-white">
                    <ImagePlus className="h-8 w-8 text-brand" />
                    <span className="mt-2 text-sm font-semibold text-foreground">上传图片</span>
                    <span className="mt-1 text-xs text-muted">可上传 5-10 张，列表显示第一张</span>
                    <input type="file" accept="image/*" multiple className="hidden" onChange={(event) => handleImageUpload(event.target.files)} />
                  </label>
                  <div className="mt-3 grid grid-cols-5 gap-2">
                    {draft.images.map((image, index) => (
                      <button
                        key={`${image.slice(0, 24)}-${index}`}
                        className="relative aspect-square overflow-hidden rounded-md border border-border bg-surface-muted"
                        onClick={() => setDraft((current) => ({ ...current, images: current.images.filter((_, imageIndex) => imageIndex !== index) }))}
                        title="点击移除"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={image} alt={`商品图片 ${index + 1}`} className="h-full w-full object-contain p-1" />
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <h3 className="text-lg font-bold text-foreground">基础信息</h3>
                  <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <ReadonlyField label="SKU（系统生成）" value={draft.sku} />
                  <LabeledInput label="中文名（必填）" value={draft.chineseName} onChange={(value) => setField("chineseName", value)} />
                  <LabeledInput label="英文名（必填）" value={draft.englishName} onChange={(value) => setField("englishName", value)} />
                  <LabeledInput label="主 ASIN" value={draft.asin} onChange={(value) => setField("asin", value)} />
                  <label className="text-xs font-semibold text-muted">
                    状态
                    <select
                      className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus:border-brand"
                      value={draft.status}
                      onChange={(event) => setField("status", event.target.value as ProductStatus)}
                    >
                      {productStatusOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  {draft.status === "canceled" ? (
                    <LabeledInput
                      label="取消原因（必填）"
                      value={draft.cancelReason}
                      placeholder="例如：供应商无法供货、利润不达标、合规风险等"
                      onChange={(value) => setField("cancelReason", value)}
                    />
                  ) : null}
                  <LabeledInput label="开发员" value={draft.developer} onChange={(value) => setField("developer", value)} />
                  <ReadonlyField label="创建日期（保存时生成）" value={draft.createdAt || "保存后自动生成"} />
                  <LabeledInput label="采购价格 CNY" type="number" value={String(draft.purchasePrice)} onChange={(value) => setField("purchasePrice", Number(value) || 0)} />
                  <div className="flex items-end">
                    <a
                      className={`inline-flex h-10 items-center gap-2 rounded-md border border-border px-3 text-sm font-semibold ${mainAmazonLink ? "text-brand hover:border-brand" : "pointer-events-none text-muted opacity-50"}`}
                      href={mainAmazonLink || "#"}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink className="h-4 w-4" />
                      打开主 ASIN
                    </a>
                  </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <ProductWorkbookDetailSections
              detail={workbookDetail}
              onPricingChange={updateWorkbookPricingRow}
              onPricingAdd={addWorkbookPricingRow}
              onPricingRemove={removeWorkbookPricingRow}
              onCompetitorChange={updateWorkbookCompetitor}
              onCompetitorAdd={addWorkbookCompetitor}
              onCompetitorRemove={removeWorkbookCompetitor}
              onSupplierChange={updateWorkbookSupplier}
              onSupplierAdd={addWorkbookSupplier}
              onSupplierRemove={removeWorkbookSupplier}
              onImprovementChange={updateWorkbookImprovement}
              onImprovementRowChange={updateWorkbookImprovementRow}
              onKeywordChange={updateWorkbookKeyword}
              onKeywordsReplace={replaceWorkbookKeywords}
              onRemarkChange={(value) => setWorkbookDetail((current) => ({ ...current, remark: value }))}
              onRemarkImagesChange={updateWorkbookRemarkImages}
            />
          </section>
        </div>
      </div>
    </div>
  );
}

function ProductWorkbookDetailSections({
  detail,
  onPricingChange,
  onPricingAdd,
  onPricingRemove,
  onCompetitorChange,
  onCompetitorAdd,
  onCompetitorRemove,
  onSupplierChange,
  onSupplierAdd,
  onSupplierRemove,
  onImprovementChange,
  onImprovementRowChange,
  onKeywordChange,
  onKeywordsReplace,
  onRemarkChange,
  onRemarkImagesChange,
}: {
  detail: TrialProductDraft;
  onPricingChange: (index: number, field: keyof TrialPriceRow, value: string) => void;
  onPricingAdd: () => void;
  onPricingRemove: () => void;
  onCompetitorChange: (index: number, field: keyof TrialCompetitorRow, value: string) => void;
  onCompetitorAdd: () => void;
  onCompetitorRemove: () => void;
  onSupplierChange: (index: number, field: keyof TrialSupplierRow, value: string) => void;
  onSupplierAdd: () => void;
  onSupplierRemove: () => void;
  onImprovementChange: (field: Exclude<keyof TrialImprovement, "rows">, value: string) => void;
  onImprovementRowChange: (index: number, field: TrialImprovementCellKey, value: string) => void;
  onKeywordChange: (index: number, field: keyof TrialKeywordRow, value: string) => void;
  onKeywordsReplace: (keywords: TrialKeywordRow[]) => void;
  onRemarkChange: (value: string) => void;
  onRemarkImagesChange: (images: string[]) => void;
}) {
  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>区域 1：利润试算</CardTitle>
          <div className="flex gap-2">
            <Button variant="secondary" size="icon" title="增加试算行" onClick={onPricingAdd}>
              <Plus className="h-4 w-4" />
            </Button>
            <Button variant="secondary" size="icon" title="删除最后一行" disabled={detail.pricingRows.length <= 1} onClick={onPricingRemove}>
              <Minus className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="thin-scrollbar overflow-auto">
          <table className="min-w-[1540px] text-left text-xs">
            <thead className="bg-surface-muted text-muted">
              <tr>
                {[
                  "品名",
                  "长cm",
                  "宽cm",
                  "高cm",
                  "实际重Kg",
                  "材积重Kg",
                  "建议售价(USD)",
                  "采购成本（RMB）",
                  "FBA配送费$",
                  "3.5% 的燃油和物流相关附加费（USD)",
                  "海运单价（RMB）",
                  "海运头程（RMB）",
                  "佣金(USD)",
                  "月仓储费(USD)",
                  "汇率",
                  "保本价(USD)",
                  "海运毛利润(USD)",
                  "海运毛利润率",
                  "体积重量/磅",
                  "重量/磅",
                ].map((label) => (
                  <th key={label} className="px-2 py-2 font-bold">
                    {label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.pricingRows.map((row, index) => {
                const calc = calculateExcelPricing(row);

                return (
                  <tr key={index} className="border-t border-border align-top">
                    <td className="px-2 py-2"><SmallInput value={row.name} onChange={(value) => onPricingChange(index, "name", value)} /></td>
                    <td className="px-2 py-2"><SmallInput compact type="number" value={row.lengthCm} onChange={(value) => onPricingChange(index, "lengthCm", value)} /></td>
                    <td className="px-2 py-2"><SmallInput compact type="number" value={row.widthCm} onChange={(value) => onPricingChange(index, "widthCm", value)} /></td>
                    <td className="px-2 py-2"><SmallInput compact type="number" value={row.heightCm} onChange={(value) => onPricingChange(index, "heightCm", value)} /></td>
                    <td className="px-2 py-2"><SmallInput compact type="number" value={row.actualWeightKg} onChange={(value) => onPricingChange(index, "actualWeightKg", value)} /></td>
                    <ReadonlyMetric value={calc.volumeWeightKg} />
                    <td className="px-2 py-2"><SmallInput compact type="number" value={row.suggestedPrice} onChange={(value) => onPricingChange(index, "suggestedPrice", value)} /></td>
                    <td className="px-2 py-2"><SmallInput compact type="number" value={row.purchaseCost} onChange={(value) => onPricingChange(index, "purchaseCost", value)} /></td>
                    <td className="px-2 py-2"><SmallInput compact type="number" value={row.fbaFee} onChange={(value) => onPricingChange(index, "fbaFee", value)} /></td>
                    <ReadonlyMetric value={calc.fuelFee} />
                    <td className="px-2 py-2"><SmallInput compact type="number" value={row.oceanFreightUnitPrice} onChange={(value) => onPricingChange(index, "oceanFreightUnitPrice", value)} /></td>
                    <ReadonlyMetric value={calc.oceanFreight} />
                    <ReadonlyMetric value={calc.commission} />
                    <ReadonlyMetric value={calc.monthlyStorageFee} />
                    <td className="px-2 py-2"><SmallInput compact type="number" value={row.exchangeRate} onChange={(value) => onPricingChange(index, "exchangeRate", value)} /></td>
                    <ReadonlyMetric value={calc.breakEvenPrice} />
                    <ReadonlyMetric value={calc.profit} />
                    <ReadonlyMetric value={`${(calc.profitRate * 100).toFixed(1)}%`} />
                    <ReadonlyMetric value={calc.volumeWeightLb} />
                    <ReadonlyMetric value={calc.actualWeightLb} />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>区域 2：竞品分析</CardTitle>
          <div className="flex gap-2">
            <Button variant="secondary" size="icon" title="增加竞品行" onClick={onCompetitorAdd}>
              <Plus className="h-4 w-4" />
            </Button>
            <Button variant="secondary" size="icon" title="删除最后一个竞品" disabled={detail.competitors.length <= 1} onClick={onCompetitorRemove}>
              <Minus className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="thin-scrollbar overflow-auto">
          <table className="min-w-[2000px] text-left text-xs">
            <thead className="bg-surface-muted text-muted">
              <tr>
                {["热销变体图片", "ASIN", "近30天销量", "变体数量", "变体类型", "热销变体规格", "热销变体价格($)", "FBA费用($)", "近3个月价格变动备注", "评论数", "评分", "差评点1", "差评点2", "差评点3", "差评点4", "差评点5", "竞品包装尺寸", "备注"].map((label) => (
                  <th key={label} className="px-2 py-2 font-bold">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.competitors.map((row, index) => (
                <tr key={index} className="border-t border-border align-top">
                  <td className="px-2 py-2">
                    <div className="w-[130px] space-y-2">
                      <ImageUploadSquare image={row.hotVariantImage} onChange={(value) => onCompetitorChange(index, "hotVariantImage", value)} />
                      <select
                        className="h-8 w-[130px] rounded-md border border-border bg-white px-2 text-xs font-semibold text-foreground outline-none focus:border-brand"
                        value={row.type}
                        onChange={(event) => onCompetitorChange(index, "type", event.target.value)}
                      >
                        {competitorTypeOptions.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td className="px-2 py-2">
                    <div className="w-[110px] space-y-2">
                      <SmallInput value={row.asin} onChange={(value) => onCompetitorChange(index, "asin", value)} />
                      <AmazonLinkButton asin={row.asin} />
                    </div>
                  </td>
                  {competitorTextFields.map((field) => (
                    <td key={field} className="px-2 py-2">
                      {negativeCompetitorFields.has(field) ? (
                        <NegativePointEditor
                          value={row[field]}
                          disabled={row.type !== "直接竞品"}
                          onChange={(value) => onCompetitorChange(index, field, value)}
                        />
                      ) : (
                        <SmallTextarea
                          value={row[field]}
                          size={compactCompetitorFields.has(field) ? "compact" : "default"}
                          onChange={(value) => onCompetitorChange(index, field, value)}
                        />
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-2">
                    <div className="w-[150px] space-y-2">
                      <SmallTextarea value={row.note} onChange={(value) => onCompetitorChange(index, "note", value)} />
                      <ImageUploadSquare image={row.noteImage} onChange={(value) => onCompetitorChange(index, "noteImage", value)} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>区域 3：供应商报价</CardTitle>
          <div className="flex gap-2">
            <Button variant="secondary" size="icon" title="增加供应商" onClick={onSupplierAdd}>
              <Plus className="h-4 w-4" />
            </Button>
            <Button variant="secondary" size="icon" title="删除最后一个供应商" disabled={detail.suppliers.length <= 1} onClick={onSupplierRemove}>
              <Minus className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="thin-scrollbar overflow-auto">
          <table className="min-w-[1540px] text-left text-xs">
            <thead className="bg-surface-muted text-muted">
              <tr>
                {["供应商产品链接", "厂家名称", "配置", "起订量", "交期", "国内物流费", "相关认证", "专利国家", "产品包装方式", "报价（20套）", "报价（100-500套）", "开票信息", "备注"].map((label) => (
                  <th key={label} className="px-2 py-2 font-bold">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.suppliers.map((row, index) => (
                <tr key={index} className="border-t border-border align-top">
                  {supplierFields.map((field) => (
                    <td key={field} className="px-2 py-2">
                      {field === "productUrl" ? (
                        <div className="flex gap-2">
                          <SmallTextarea size="supplierWide" value={row[field]} onChange={(value) => onSupplierChange(index, field, value)} />
                          <ExternalLinkButton href={row[field]} />
                        </div>
                      ) : (
                        <SmallTextarea
                          size={getSupplierTextareaSize(field)}
                          value={row[field]}
                          onChange={(value) => onSupplierChange(index, field, value)}
                        />
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>区域 4：产品改进点</CardTitle>
        </CardHeader>
        <CardContent className="thin-scrollbar overflow-auto">
          <ImprovementTable
            detail={detail}
            improvement={detail.improvement}
            onChange={onImprovementChange}
            onRowChange={onImprovementRowChange}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>区域 5：关键词</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <KeywordBulkInput onApply={onKeywordsReplace} />
          <div className="thin-scrollbar overflow-auto">
            <table className="min-w-[680px] text-left text-xs">
              <thead className="bg-surface-muted text-muted">
                <tr>
                  <th className="px-2 py-2">关键词</th>
                  <th className="px-2 py-2">CPC</th>
                  <th className="px-2 py-2">月搜索量</th>
                  <th className="px-2 py-2">ABA周排名</th>
                </tr>
              </thead>
              <tbody>
                {detail.keywords.map((row, index) => (
                  <tr key={index} className="border-t border-border">
                    <td className="px-2 py-2"><SmallInput value={row.keyword} onChange={(value) => onKeywordChange(index, "keyword", value)} /></td>
                    <td className="px-2 py-2"><SmallInput type="number" value={row.cpc} onChange={(value) => onKeywordChange(index, "cpc", value)} /></td>
                    <td className="px-2 py-2"><SmallInput type="number" value={row.monthlySearches} onChange={(value) => onKeywordChange(index, "monthlySearches", value)} /></td>
                    <td className="px-2 py-2"><SmallInput type="number" value={row.abaRank} onChange={(value) => onKeywordChange(index, "abaRank", value)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <label className="block text-xs font-semibold text-muted">
            备注
            <textarea
              className="mt-1 min-h-24 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
              value={detail.remark}
              onChange={(event) => onRemarkChange(event.target.value)}
            />
          </label>
          <RemarkImagesUploader images={detail.remarkImages ?? []} onChange={onRemarkImagesChange} />
        </CardContent>
      </Card>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone = "gray",
  active,
  onClick,
}: {
  label: string;
  value: string;
  tone?: "gray" | "blue" | "green" | "amber" | "red";
  active?: boolean;
  onClick?: () => void;
}) {
  const toneClass = {
    gray: "text-foreground",
    blue: "text-info",
    green: "text-success",
    amber: "text-accent",
    red: "text-danger",
  }[tone];

  return (
    <button
      className={`rounded-lg border bg-white p-4 text-left shadow-sm transition-colors hover:border-brand hover:bg-surface-muted ${
        active ? "border-brand ring-2 ring-brand/15" : "border-border"
      }`}
      onClick={onClick}
    >
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className={`mt-2 text-2xl font-black metric-tabular ${toneClass}`}>{value}</p>
    </button>
  );
}

function SmallInput({
  value,
  onChange,
  type = "text",
  compact = false,
}: {
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  compact?: boolean;
}) {
  return (
    <input
      className={`h-8 rounded-md border border-border bg-white px-2 text-xs text-foreground outline-none focus:border-brand ${compact ? "w-[60px] min-w-[60px]" : "w-full min-w-[88px]"}`}
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function SmallTextarea({
  value,
  onChange,
  size = "default",
  disabled = false,
}: {
  value: string | number;
  onChange: (value: string) => void;
  size?: "default" | "compact" | "negative" | "supplierCompact" | "supplierMedium" | "supplierWide";
  disabled?: boolean;
}) {
  const sizeClass =
    size === "compact"
      ? "h-[150px] w-[60px] min-w-[60px]"
      : size === "negative"
        ? "h-[180px] w-[150px] min-w-[150px]"
        : size === "supplierCompact"
          ? "h-[50px] w-[50px] min-w-[50px]"
          : size === "supplierMedium"
            ? "h-[50px] w-[150px] min-w-[150px]"
          : size === "supplierWide"
            ? "h-[50px] w-[180px] min-w-[180px]"
            : "min-h-20 w-full min-w-[120px]";

  return (
    <textarea
      className={`${sizeClass} rounded-md border border-border px-2 py-2 text-xs outline-none focus:border-brand ${disabled ? "cursor-not-allowed bg-surface-muted text-muted" : "bg-white text-foreground"}`}
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function getSupplierTextareaSize(field: keyof TrialSupplierRow) {
  if (wideSupplierFields.has(field) || extraWideSupplierFields.has(field)) {
    return "supplierWide";
  }

  if (mediumSupplierFields.has(field)) {
    return "supplierMedium";
  }

  return "supplierCompact";
}

function ImageUploadSquare({
  image,
  onChange,
}: {
  image: string;
  onChange: (value: string) => void;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  function handleFile(file: File | undefined) {
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      onChange(String(reader.result));
      setPreviewOpen(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <>
      {image ? (
        <button
          type="button"
          className="flex h-[130px] w-[130px] items-center justify-center overflow-hidden rounded-md border border-border bg-surface-muted"
          onClick={() => setPreviewOpen(true)}
          title="查看大图"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image} alt="竞品图片" className="h-full w-full object-contain p-1" />
        </button>
      ) : (
        <button
          type="button"
          className="flex h-[130px] w-[130px] items-center justify-center rounded-md border border-dashed border-border bg-surface-muted text-center text-xs font-semibold text-muted transition-colors hover:border-brand hover:bg-white"
          onClick={() => fileInputRef.current?.click()}
        >
          上传图片
        </button>
      )}
      <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={(event) => handleFile(event.target.files?.[0])} />

      {previewOpen && image ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/70 p-6">
          <div className="relative flex max-h-full max-w-5xl items-center justify-center">
            <div className="absolute right-0 top-0 z-10 flex translate-y-[-120%] gap-2">
              <Button variant="secondary" size="sm" onClick={() => fileInputRef.current?.click()}>
                <ImagePlus className="h-4 w-4" />
                替换图片
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setPreviewOpen(false)}>
                <X className="h-4 w-4" />
                关闭
              </Button>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={image} alt="竞品大图" className="max-h-[82vh] max-w-[88vw] rounded-lg bg-white object-contain shadow-2xl" />
          </div>
        </div>
      ) : null}
    </>
  );
}

function RemarkImagesUploader({ images, onChange }: { images: string[]; onChange: (images: string[]) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function handleFiles(files: FileList | null) {
    const selected = Array.from(files ?? []);
    if (!selected.length) {
      return;
    }

    const nextImages = await Promise.all(selected.map(fileToDataUrl));
    onChange([...images, ...nextImages]);
  }

  return (
    <div className="rounded-md border border-border bg-surface-muted p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold text-muted">备注图片</p>
        <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()}>
          <ImagePlus className="h-4 w-4" />
          批量上传图片
        </Button>
      </div>
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        accept="image/*"
        multiple
        onChange={(event) => {
          void handleFiles(event.target.files);
          event.currentTarget.value = "";
        }}
      />
      {images.length ? (
        <div className="mt-3 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          {images.map((image, index) => (
            <div key={`${image.slice(0, 32)}-${index}`} className="space-y-2">
              <ImageUploadSquare image={image} onChange={(value) => onChange(images.map((item, itemIndex) => (itemIndex === index ? value : item)))} />
              <Button variant="secondary" size="sm" className="w-[130px]" onClick={() => onChange(images.filter((_, itemIndex) => itemIndex !== index))}>
                删除
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-md border border-dashed border-border bg-white px-3 py-6 text-center text-xs font-semibold text-muted">
          导入 Excel 中非热销变体图片，或手动批量上传图片后会显示在这里。
        </div>
      )}
    </div>
  );
}

function NegativePointEditor({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const parsed = parseNegativePointValue(value);
  const [draft, setDraft] = useState(parsed);

  useEffect(() => {
    if (!open) {
      setDraft(parseNegativePointValue(value));
    }
  }, [open, value]);

  function updateSummary(summary: string) {
    onChange(buildNegativePointValue({ ...parsed, summary }));
  }

  function updateCount(count: string) {
    onChange(buildNegativePointValue({ ...parsed, count }));
  }

  function updateDraftCount(count: string) {
    setDraft((current) => ({
      ...current,
      count,
      originals: normalizeOriginalsLength(current.originals, parseOriginalCount(count)),
    }));
  }

  function saveOriginals() {
    onChange(buildNegativePointValue(draft));
    setOpen(false);
  }

  const originalCount = parseOriginalCount(parsed.count);
  const draftOriginals = normalizeOriginalsLength(draft.originals, parseOriginalCount(draft.count));

  return (
    <>
      <div className={`h-[180px] w-[150px] rounded-md border border-border p-1 ${disabled ? "bg-surface-muted" : "bg-white"}`}>
        <div className="grid grid-cols-[minmax(0,1fr)_42px] gap-1">
          <input
            className="h-8 min-w-0 rounded border border-border px-1 text-xs outline-none focus:border-brand disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted"
            value={parsed.summary}
            disabled={disabled}
            placeholder="差评总结"
            onChange={(event) => updateSummary(event.target.value)}
          />
          <input
            className="h-8 rounded border border-border px-1 text-xs outline-none focus:border-brand disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted"
            value={parsed.count}
            disabled={disabled}
            placeholder="数"
            onChange={(event) => updateCount(event.target.value)}
          />
        </div>
        <button
          type="button"
          className="mt-1 h-[134px] w-full overflow-hidden rounded border border-border bg-white px-2 py-2 text-left text-xs text-foreground disabled:cursor-not-allowed disabled:bg-surface-muted disabled:text-muted"
          disabled={disabled}
          onClick={() => {
            setDraft(parsed);
            setOpen(true);
          }}
        >
          {parsed.originals.filter(Boolean).length ? (
            <span className="whitespace-pre-line">{parsed.originals.filter(Boolean).join("\n")}</span>
          ) : (
            <span className="text-muted">点击填写{originalCount}条差评原文</span>
          )}
        </button>
      </div>

      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/55 p-6">
          <div className="flex max-h-[88vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="text-lg font-bold text-foreground">差评原文</h3>
                <p className="mt-1 text-xs font-semibold text-muted">填写当前差评点对应的 {draftOriginals.length} 条原文。</p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
                <X className="h-4 w-4" />
                关闭
              </Button>
            </div>
            <div className="thin-scrollbar max-h-[560px] space-y-3 overflow-y-auto p-5">
              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px]">
                <LabeledInput label="差评总结" value={draft.summary} onChange={(summary) => setDraft((current) => ({ ...current, summary }))} />
                <LabeledInput label="数量" value={draft.count} onChange={updateDraftCount} />
              </div>
              {draftOriginals.map((original, index) => (
                <label key={index} className="block text-xs font-semibold text-muted">
                  差评原文 {index + 1}
                  <textarea
                    className="mt-1 min-h-20 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
                    value={original}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        originals: normalizeOriginalsLength(current.originals, parseOriginalCount(current.count)).map((item, itemIndex) => (itemIndex === index ? event.target.value : item)),
                      }))
                    }
                  />
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
              <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
                取消
              </Button>
              <Button size="sm" onClick={saveOriginals}>
                <Save className="h-4 w-4" />
                保存
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

function createEmptyImprovementRow(): TrialImprovementRow {
  return {
    material: "",
    size: "",
    functionImprovement: "",
    appearance: "",
    accessories: "",
    packaging: "",
    manual: "",
    imageCopySuggestion: "",
    certification: "",
  };
}

function getImprovementRow(improvement: TrialImprovement, index: number): TrialImprovementRow {
  if (improvement.rows?.[index]) {
    return { ...createEmptyImprovementRow(), ...improvement.rows[index] };
  }

  if (index === 0) {
    return {
      material: improvement.material,
      size: improvement.size,
      functionImprovement: improvement.functionImprovement,
      appearance: improvement.appearance,
      accessories: improvement.accessories,
      packaging: improvement.packaging,
      manual: improvement.manual,
      imageCopySuggestion: improvement.imageCopySuggestion,
      certification: improvement.certification,
    };
  }

  return createEmptyImprovementRow();
}

function ImprovementTable({
  detail,
  improvement,
  onChange,
  onRowChange,
}: {
  detail: TrialProductDraft;
  improvement: TrialImprovement;
  onChange: (field: Exclude<keyof TrialImprovement, "rows">, value: string) => void;
  onRowChange: (index: number, field: TrialImprovementCellKey, value: string) => void;
}) {
  const painRows = buildImprovementPainRows(detail);
  const visiblePainRows = painRows.length ? painRows : [{ summary: "", count: "" }];

  return (
    <table className="min-w-[1980px] table-fixed overflow-hidden rounded-md border border-border text-left text-xs">
      <tbody>
        <tr>
          <ImprovementHeader colSpan={2}>使用人群</ImprovementHeader>
          <ImprovementHeader colSpan={2} className="w-[350px]">主要适用场景</ImprovementHeader>
          <ImprovementHeader className="w-[120px]">目标销量</ImprovementHeader>
          <ImprovementHeader className="w-[120px]">头部旺季平均销量</ImprovementHeader>
          <ImprovementHeader className="w-[120px]">头部淡季平均销量</ImprovementHeader>
          <ImprovementHeader colSpan={4}>
            <div className="flex items-center gap-2">
              <span>旺季月份</span>
              <button
                type="button"
                className="rounded border border-border bg-white px-2 py-0.5 text-[11px] font-semibold text-muted hover:border-brand hover:text-brand"
                onClick={() => onChange("peakSeason", "")}
              >
                清除
              </button>
            </div>
          </ImprovementHeader>
        </tr>
        <tr>
          <ImprovementCell colSpan={2}>
            <ImprovementInput value={improvement.audience} placeholder="填空格" onChange={(value) => onChange("audience", value)} />
          </ImprovementCell>
          <ImprovementCell colSpan={2} className="w-[350px]">
            <ImprovementInput className="w-[350px]" value={improvement.scenario} placeholder="填空格" onChange={(value) => onChange("scenario", value)} />
          </ImprovementCell>
          <ImprovementCell className="w-[120px] font-bold">
            <ImprovementInput className="w-[120px]" value={improvement.targetSales} onChange={(value) => onChange("targetSales", value)} />
          </ImprovementCell>
          <ImprovementCell className="w-[120px]">
            <ImprovementInput className="w-[120px]" value={improvement.peakSales} onChange={(value) => onChange("peakSales", value)} />
          </ImprovementCell>
          <ImprovementCell className="w-[120px]">
            <ImprovementInput className="w-[120px]" value={improvement.offSeasonSales} onChange={(value) => onChange("offSeasonSales", value)} />
          </ImprovementCell>
          <ImprovementCell colSpan={4}>
            <PeakSeasonSelector value={improvement.peakSeason} onChange={(value) => onChange("peakSeason", value)} />
          </ImprovementCell>
        </tr>
        <tr>
          <ImprovementSubHeader>产品改进点</ImprovementSubHeader>
          <ImprovementSubHeader>差评</ImprovementSubHeader>
          <ImprovementSubHeader>数量</ImprovementSubHeader>
          {improvementColumns.map((column) => (
            <ImprovementSubHeader key={column.field}>{column.label}</ImprovementSubHeader>
          ))}
        </tr>
        {visiblePainRows.map((pain, index) => {
          const improvementRow = getImprovementRow(improvement, index);
          return (
            <tr key={index}>
              <ImprovementCell className="text-center font-bold">差评点{index + 1}</ImprovementCell>
              <ImprovementCell>{pain?.summary ?? ""}</ImprovementCell>
              <ImprovementCell>{pain?.count ?? ""}</ImprovementCell>
              {improvementColumns.map((column) => (
                <ImprovementCell key={column.field}>
                  <ImprovementInput value={improvementRow[column.field]} onChange={(value) => onRowChange(index, column.field, value)} />
                </ImprovementCell>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

function ImprovementHeader({
  children,
  className = "",
  colSpan,
}: {
  children: ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return <th colSpan={colSpan} className={`border-b border-r border-border bg-surface-muted px-2 py-2 font-bold text-muted first:border-l ${className}`}>{children}</th>;
}

function ImprovementSubHeader({ children }: { children: ReactNode }) {
  return <td className="border-b border-r border-border bg-surface-muted px-2 py-2 font-bold text-muted first:border-l">{children}</td>;
}

function ImprovementCell({
  children,
  className = "",
  colSpan,
}: {
  children?: ReactNode;
  className?: string;
  colSpan?: number;
}) {
  return <td colSpan={colSpan} className={`h-9 border-b border-r border-border bg-white px-2 py-1 align-top text-foreground first:border-l ${className}`}>{children}</td>;
}

function ImprovementInput({
  value,
  onChange,
  placeholder,
  className = "w-full",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <input
      className={`h-8 rounded-md border border-border bg-white px-2 text-xs font-semibold text-foreground outline-none placeholder:text-muted focus:border-brand ${className}`}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

function PeakSeasonSelector({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const levels = parsePeakSeasonLevels(value);

  function updateMonth(index: number) {
    const next = [...levels];
    next[index] = (next[index] + 1) % peakSeasonLevels.length;
    onChange(formatPeakSeasonLevels(next));
  }

  return (
    <div className="rounded-md border border-border bg-white p-2">
      <div className="grid grid-cols-12 gap-1">
        {levels.map((level, index) => (
          <button
            key={index}
            type="button"
            className={`h-7 rounded border border-border text-[11px] font-bold transition-colors ${peakSeasonLevels[level]}`}
            onClick={() => updateMonth(index)}
            title={`${index + 1}月`}
          >
            {index + 1}
          </button>
        ))}
      </div>
    </div>
  );
}

function parsePeakSeasonLevels(value: string) {
  const parts = value.split(",").map((part) => Number(part));
  if (parts.length !== 12 || parts.some((part) => !Number.isInteger(part))) {
    return Array.from({ length: 12 }, () => 0);
  }

  return parts.map((part) => Math.max(0, Math.min(part, peakSeasonLevels.length - 1)));
}

function formatPeakSeasonLevels(levels: number[]) {
  return levels.some(Boolean) ? levels.join(",") : "";
}

function KeywordBulkInput({ onApply }: { onApply: (keywords: TrialKeywordRow[]) => void }) {
  const [value, setValue] = useState("");

  function handleChange(nextValue: string) {
    setValue(nextValue);
    const keywords = parseKeywordBulkText(nextValue);
    if (keywords.length) {
      onApply(keywords);
    }
  }

  return (
    <label className="block text-xs font-semibold text-muted">
      批量输入关键词
      <textarea
        className="mt-1 min-h-28 w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
        value={value}
        placeholder={"espresso shot mirror\n0.63\n488\n1756622\nespresso mirror\n0.49\n1539\n1155349"}
        onChange={(event) => handleChange(event.target.value)}
      />
    </label>
  );
}

function parseKeywordBulkText(value: string): TrialKeywordRow[] {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const keywords: TrialKeywordRow[] = [];

  for (let index = 0; index + 3 < lines.length; index += 4) {
    keywords.push({
      keyword: lines[index],
      cpc: Number(lines[index + 1]) || 0,
      monthlySearches: Number(lines[index + 2]) || 0,
      abaRank: Number(lines[index + 3]) || 0,
    });
  }

  return keywords;
}

function buildImprovementPainRows(detail: TrialProductDraft) {
  const grouped = new Map<string, { summary: string; count: number; originalIndex: number }>();

  detail.competitors.forEach((competitor) => {
    (["negativePoint1", "negativePoint2", "negativePoint3", "negativePoint4", "negativePoint5"] as const).forEach((field) => {
      const parsed = parseNegativePointValue(competitor[field]);
      if (parsed.summary || parsed.count) {
        const summary = parsed.summary.trim();
        const key = normalizePainSummary(summary) || `__empty_${grouped.size}`;
        const count = parseCount(parsed.count);
        const existing = grouped.get(key);

        if (existing) {
          existing.count += count;
        } else {
          grouped.set(key, { summary, count, originalIndex: grouped.size });
        }
      }
    });
  });

  return Array.from(grouped.values())
    .sort((left, right) => right.count - left.count || left.originalIndex - right.originalIndex)
    .map((row) => ({ summary: row.summary, count: row.count ? String(row.count) : "" }))
    .slice(0, 5);
}

function normalizePainSummary(value: string) {
  return value.replace(/\s+/g, "").toLowerCase();
}

function parseCount(value: string) {
  const count = Number(value);
  return Number.isFinite(count) ? count : 0;
}

function parseNegativePointValue(value: string) {
  const lines = value.split("\n").map((line) => line.trim()).filter(Boolean);
  const firstLine = lines[0] ?? "";
  const match = firstLine.match(/^(.*?)[（(]([0-9]+)[）)]$/);
  const count = match ? match[2] : "";
  const originals = lines.slice(match || firstLine ? 1 : 0);

  return {
    summary: match ? match[1].trim() : firstLine,
    count,
    originals: normalizeOriginalsLength(originals, parseOriginalCount(count)),
  };
}

function buildNegativePointValue(value: { summary: string; count: string; originals: string[] }) {
  const title = value.count.trim() ? `${value.summary.trim()}（${value.count.trim()}）` : value.summary.trim();
  return [title, ...value.originals.map((item) => item.trim()).filter(Boolean)].filter(Boolean).join("\n");
}

function parseOriginalCount(count: string) {
  const value = Number(count);
  if (!Number.isFinite(value) || value <= 0) {
    return 1;
  }

  return Math.min(Math.floor(value), 100);
}

function normalizeOriginalsLength(originals: string[], count: number) {
  return Array.from({ length: count }, (_, index) => originals[index] ?? "");
}

async function parseProductWorkbookFile(file: File, products: Product[]): Promise<Product> {
  const buffer = await file.arrayBuffer();
  const [XLSXModule, JSZipModule] = await Promise.all([import("xlsx"), import("jszip")]);
  const XLSX = XLSXModule;
  const JSZip = JSZipModule.default;
  const workbook = XLSX.read(buffer, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  if (!sheet) {
    throw new Error("Excel 文件没有可读取的工作表。");
  }

  const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, defval: "", raw: false, blankrows: false });
  const detail = createTrialProductDraft();
  const pricingHeaderIndex = 0;
  const competitorHeaderIndex = findRowIndex(rows, "ASIN");
  const supplierHeaderIndex = findRowIndex(rows, "供应商产品链接");
  const improvementHeaderIndex = findRowIndex(rows, "使用人群");
  const keywordHeaderIndex = findRowIndex(rows, "关键词");

  detail.title = textAt(rows, pricingHeaderIndex + 1, 0) || file.name.replace(/\.(xlsx|xls)$/i, "");
  detail.pricingRows = parsePricingRows(rows, pricingHeaderIndex, competitorHeaderIndex);
  detail.competitors = parseCompetitorRows(rows, competitorHeaderIndex, supplierHeaderIndex);
  detail.suppliers = parseSupplierRows(rows, supplierHeaderIndex, improvementHeaderIndex);
  detail.improvement = parseImprovementRows(rows, improvementHeaderIndex);
  detail.keywords = parseKeywordRows(rows, keywordHeaderIndex);
  detail.remark = textAt(rows, findRowIndex(rows, "备注"), 0) === "备注" ? "" : detail.remark;
  detail.remarkImages = [];

  const images = await extractWorkbookImages(buffer, JSZip);
  const hotVariantCol = findColumnIndex(rows[competitorHeaderIndex] ?? [], "热销变体图片");
  const competitorStartRow = competitorHeaderIndex + 1;
  const competitorEndRow = supplierHeaderIndex > competitorStartRow ? supplierHeaderIndex : competitorStartRow + detail.competitors.length;

  images.forEach((image) => {
    if (image.col === hotVariantCol && image.row >= competitorStartRow && image.row < competitorEndRow) {
      const competitorIndex = Math.min(Math.max(image.row - competitorStartRow, 0), detail.competitors.length - 1);
      if (detail.competitors[competitorIndex]) {
        detail.competitors[competitorIndex].hotVariantImage = image.dataUrl;
        return;
      }
    }

    detail.remarkImages.push(image.dataUrl);
  });

  const sku = nextSku(products);

  return {
    sku,
    id: `prod-${sku}`,
    chineseName: detail.title,
    englishName: "",
    asin: detail.competitors[0]?.asin ?? "",
    developer: extractDeveloperName(file.name),
    purchasePrice: detail.pricingRows[0]?.purchaseCost ?? 0,
    status: "pending",
    supplierName: detail.suppliers[0]?.factoryName ?? "",
    supplierUrl: detail.suppliers[0]?.productUrl ?? "",
    specs: detail.pricingRows.map((row) => row.name).filter(Boolean).join(";"),
    purchaseLeadTime: detail.suppliers[0]?.leadTime ?? "",
    createdAt: formatDateTime(new Date()),
    keywords: detail.keywords.map((row) => row.keyword).filter(Boolean).join(","),
    note: detail.remark,
    cancelReason: "",
    hsCode: "",
    images: detail.remarkImages.slice(0, 1),
    competitorAsins: detail.competitors.map((competitor) => competitor.asin.trim()).filter(Boolean),
    productWeightG: Math.round((detail.pricingRows[0]?.actualWeightKg ?? 0) * 1000),
    packageWeightG: Math.round((detail.pricingRows[0]?.actualWeightKg ?? 0) * 1000),
    productSizeCm: {
      length: detail.pricingRows[0]?.lengthCm ?? 0,
      width: detail.pricingRows[0]?.widthCm ?? 0,
      height: detail.pricingRows[0]?.heightCm ?? 0,
    },
    packageSizeCm: {
      length: detail.pricingRows[0]?.lengthCm ?? 0,
      width: detail.pricingRows[0]?.widthCm ?? 0,
      height: detail.pricingRows[0]?.heightCm ?? 0,
    },
    workbookDetail: detail,
  } as Product;
}

function parsePricingRows(rows: string[][], headerIndex: number, endIndex: number): TrialPriceRow[] {
  return rows.slice(headerIndex + 1, endIndex).filter((row) => row.some(Boolean)).map((row) => ({
    name: cleanText(row[0]),
    lengthCm: parseNumber(row[1]),
    widthCm: parseNumber(row[2]),
    heightCm: parseNumber(row[3]),
    actualWeightKg: parseNumber(row[4]),
    suggestedPrice: parseNumber(row[6]),
    purchaseCost: parseNumber(row[7]),
    oceanFreightUnitPrice: 12,
    fbaFee: parseNumber(row[8]),
    exchangeRate: parseNumber(row[13]) || 6.9,
  })).filter((row) => row.name);
}

function parseCompetitorRows(rows: string[][], headerIndex: number, endIndex: number): TrialCompetitorRow[] {
  return rows.slice(headerIndex + 1, endIndex).filter((row) => row.some(Boolean)).map((row) => {
    const price = cleanText(row[7]);
    return {
      type: cleanText(row[0]) || "参考竞品",
      hotVariantImage: "",
      asin: cleanText(row[1]),
      sales30Days: cleanText(row[2]),
      variantCount: cleanText(row[3]),
      variantType: cleanText(row[4]),
      hotVariantSpec: cleanText(row[6]),
      hotVariantPrice: removeFbaFromPrice(price),
      fbaFee: extractFbaFee(price),
      priceChangeNote: cleanText(row[8]),
      reviewCount: cleanText(row[9]),
      rating: cleanText(row[10]),
      negativePoint1: cleanText(row[11]),
      negativePoint2: cleanText(row[12]),
      negativePoint3: cleanText(row[13]),
      negativePoint4: cleanText(row[14]),
      negativePoint5: cleanText(row[15]),
      packageSize: cleanText(row[16]),
      note: cleanText(row[17]),
      noteImage: "",
    };
  }).filter((row) => row.asin || row.type);
}

function parseSupplierRows(rows: string[][], headerIndex: number, endIndex: number): TrialSupplierRow[] {
  return rows.slice(headerIndex + 1, endIndex).filter((row) => row.some(Boolean)).map((row) => ({
    productUrl: cleanText(row[0]),
    factoryName: cleanText(row[1]),
    configuration: cleanText(row[2]),
    moq: cleanText(row[3]),
    leadTime: cleanText(row[4]),
    domesticFreightIncluded: cleanText(row[5]),
    certifications: cleanText(row[6]),
    patentCountry: cleanText(row[7]),
    packagingMethod: cleanText(row[8]),
    cost100: parseNumber(row[9]),
    cost300: parseNumber(row[10]),
    taxPoint: cleanText(row[11]),
    invoiceName: cleanText(row[12]),
    invoiceSpecUnit: cleanText(row[13]),
    invoiceRegion: cleanText(row[14]),
  }));
}

function parseImprovementRows(rows: string[][], headerIndex: number): TrialImprovement {
  const header = rows[headerIndex] ?? [];
  const value = rows[headerIndex + 1] ?? [];
  const fallback = createTrialProductDraft().improvement;
  const read = (label: string) => cleanText(value[findColumnIndex(header, label)]);

  return {
    ...fallback,
    audience: read("使用人群"),
    scenario: read("主要适用场景"),
    painPoint1: read("产品痛点1"),
    painPoint2: read("产品痛点2"),
    painPoint3: read("产品痛点3"),
    material: read("材质改进"),
    size: read("尺寸改进"),
    functionImprovement: read("功能改进"),
    appearance: read("外观"),
    accessories: read("配件"),
    packaging: read("包装改进"),
    manual: read("说明书"),
    imageCopySuggestion: read("文案"),
    peakSeason: read("旺季月份"),
    peakSales: read("头部旺季平均销量"),
    offSeasonSales: read("头部淡季平均销量"),
    targetSales: read("目标销量"),
    infringement: read("侵权"),
    certification: read("认证"),
    rows: [{
      ...createEmptyImprovementRow(),
      material: read("材质改进"),
      size: read("尺寸改进"),
      functionImprovement: read("功能改进"),
      appearance: read("外观"),
      accessories: read("配件"),
      packaging: read("包装改进"),
      manual: read("说明书"),
      imageCopySuggestion: read("文案"),
      certification: "",
    }],
  };
}

function parseKeywordRows(rows: string[][], headerIndex: number): TrialKeywordRow[] {
  return rows.slice(headerIndex + 1).filter((row) => cleanText(row[0])).map((row) => ({
    keyword: cleanText(row[0]),
    cpc: parseNumber(row[1]),
    monthlySearches: parseNumber(row[2]),
    abaRank: parseNumber(row[3]),
  }));
}

async function extractWorkbookImages(buffer: ArrayBuffer, JSZip: { loadAsync: (data: ArrayBuffer) => Promise<{ files: Record<string, { async: (type: "string" | "base64") => Promise<string> }> }> }) {
  const zip = await JSZip.loadAsync(buffer);
  const drawingPath = Object.keys(zip.files).find((path) => path.startsWith("xl/drawings/") && path.endsWith(".xml"));
  const relPath = drawingPath ? `xl/drawings/_rels/${drawingPath.split("/").pop()}.rels` : "";
  const drawingFile = drawingPath ? zip.files[drawingPath] : null;
  const relFile = relPath ? zip.files[relPath] : null;

  if (!drawingFile || !relFile) {
    return [];
  }

  const [drawingXml, relXml] = await Promise.all([drawingFile.async("string"), relFile.async("string")]);
  const rels = parseDrawingRelationships(relXml);
  const parser = new DOMParser();
  const drawing = parser.parseFromString(drawingXml, "application/xml");
  const anchors = Array.from(drawing.getElementsByTagNameNS("*", "twoCellAnchor"));
  const images: Array<{ row: number; col: number; dataUrl: string }> = [];

  for (const anchor of anchors) {
    const from = anchor.getElementsByTagNameNS("*", "from")[0];
    const blip = anchor.getElementsByTagNameNS("*", "blip")[0];
    const relId = blip?.getAttribute("r:embed") ?? blip?.getAttribute("embed");
    const target = relId ? rels.get(relId) : "";
    if (!from || !target) {
      continue;
    }

    const mediaPath = `xl/${target.startsWith("../") ? target.slice(3) : target}`;
    const media = zip.files[mediaPath];
    if (!media) {
      continue;
    }

    const bytes = await media.async("base64");
    images.push({
      col: Number(from.getElementsByTagNameNS("*", "col")[0]?.textContent ?? 0),
      row: Number(from.getElementsByTagNameNS("*", "row")[0]?.textContent ?? 0),
      dataUrl: `data:${mimeFromPath(mediaPath)};base64,${bytes}`,
    });
  }

  return images;
}

function parseDrawingRelationships(xml: string) {
  const parser = new DOMParser();
  const document = parser.parseFromString(xml, "application/xml");
  const rels = new Map<string, string>();
  Array.from(document.getElementsByTagNameNS("*", "Relationship")).forEach((rel) => {
    const id = rel.getAttribute("Id");
    const target = rel.getAttribute("Target");
    if (id && target && target !== "NULL") {
      rels.set(id, target);
    }
  });
  return rels;
}

function fileToDataUrl(file: File) {
  return new Promise<string>((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.readAsDataURL(file);
  });
}

function textAt(rows: string[][], row: number, col: number) {
  return cleanText(rows[row]?.[col]);
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function parseNumber(value: unknown) {
  const text = cleanText(value).replace(/[$,%]/g, "").replace(/,/g, "");
  const number = Number(text);
  return Number.isFinite(number) ? number : 0;
}

function findRowIndex(rows: string[][], label: string) {
  const index = rows.findIndex((row) => row.some((cell) => cleanText(cell).includes(label)));
  return index >= 0 ? index : 0;
}

function findColumnIndex(row: string[], label: string) {
  const index = row.findIndex((cell) => cleanText(cell).includes(label));
  return index >= 0 ? index : -1;
}

function extractFbaFee(value: string) {
  const fbaLine = value
    .split(/\r?\n/)
    .find((line) => line.toLowerCase().includes("fba"));
  if (!fbaLine) return "";
  const amount = fbaLine
    .replace(/fba/iu, "")
    .replace(/[:：$]/gu, " ")
    .trim()
    .split(/\s+/u)[0];
  return amount && Number.isFinite(Number(amount)) ? amount : "";
}

function removeFbaFromPrice(value: string) {
  return value.split(/\r?\n/).filter((line) => !/FBA/i.test(line)).join("\n").trim();
}

function mimeFromPath(path: string) {
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith(".jpg") || lowerPath.endsWith(".jpeg")) return "image/jpeg";
  if (lowerPath.endsWith(".webp")) return "image/webp";
  if (lowerPath.endsWith(".gif")) return "image/gif";
  return "image/png";
}

function extractDeveloperName(fileName: string) {
  const baseName = fileName.replace(/\.(xlsx|xls)$/i, "");
  const parts = baseName.split("-");
  return parts.length > 1 ? parts.at(-1) ?? "" : "";
}

function ReadonlyMetric({ value }: { value: string | number }) {
  const text = typeof value === "number" ? value.toFixed(2) : value;
  return <td className="px-2 py-2 font-semibold text-muted metric-tabular">{text}</td>;
}

function LabeledInput({
  label,
  value,
  onChange,
  placeholder,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <label className="text-xs font-semibold text-muted">
      {label}
      <input
        className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus:border-brand"
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}

function ReadonlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-xs font-semibold text-muted">
      {label}
      <div className="mt-1 flex h-10 w-full items-center rounded-md border border-border bg-surface-muted px-3 text-sm font-semibold text-foreground">
        {value || "--"}
      </div>
    </div>
  );
}

function Pagination({
  page,
  pageCount,
  pageSize,
  pageSizeOptions,
  onPageChange,
  onPageSizeChange,
}: {
  page: number;
  pageCount: number;
  pageSize: number;
  pageSizeOptions: number[];
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 text-sm">
      <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
        上一页
      </Button>
      <span className="rounded-md bg-surface-muted px-3 py-2 text-xs font-semibold text-muted">
        {page} / {pageCount}
      </span>
      <Button variant="ghost" size="sm" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
        下一页
      </Button>
      <select
        className="h-8 rounded-md border border-border bg-white px-2 text-xs font-semibold text-foreground"
        value={pageSize}
        onChange={(event) => onPageSizeChange(Number(event.target.value))}
      >
        {pageSizeOptions.map((option) => (
          <option key={option} value={option}>
            {option}条/页
          </option>
        ))}
      </select>
    </div>
  );
}

function AmazonLinkButton({ asin }: { asin: string }) {
  const href = buildAmazonLink(asin);
  return (
    <a
      className={`inline-flex h-8 w-full items-center justify-center gap-1 rounded-md border border-border text-xs font-semibold ${href ? "text-brand hover:border-brand" : "pointer-events-none text-muted opacity-50"}`}
      href={href || "#"}
      target="_blank"
      rel="noreferrer"
      title="打开 Amazon 链接"
    >
      <ExternalLink className="h-3.5 w-3.5" />
      打开
    </a>
  );
}

function ExternalLinkButton({ href }: { href: string }) {
  const normalized = href.trim();
  const safeHref = normalized.startsWith("http://") || normalized.startsWith("https://") ? normalized : "";

  return (
    <a
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-border ${safeHref ? "text-brand hover:border-brand" : "pointer-events-none text-muted opacity-50"}`}
      href={safeHref || "#"}
      target="_blank"
      rel="noreferrer"
      title="打开供应商链接"
    >
      <ExternalLink className="h-4 w-4" />
    </a>
  );
}

function productToDraft(product: Product | null, products: Product[]): ProductEditorDraft {
  if (product) {
    const productWithWorkbook = product as Product & { workbookDetail?: TrialProductDraft };
    return {
      ...product,
      cancelReason: product.cancelReason ?? "",
      competitorAsins: product.competitorAsins.length ? product.competitorAsins : [""],
      workbookDetail: normalizeWorkbookDetail(
        productWithWorkbook.workbookDetail,
        product.sku === "00001" ? createEspressoMirrorDetail() : createTrialProductDraft(),
      ),
    };
  }

  return {
    sku: nextSku(products),
    chineseName: "",
    englishName: "",
    asin: "",
    developer: "",
    purchasePrice: 0,
    status: "pending",
    supplierName: "",
    supplierUrl: "",
    specs: "",
    purchaseLeadTime: "",
    createdAt: "",
    keywords: "",
    note: "",
    cancelReason: "",
    hsCode: "",
    images: [],
    competitorAsins: ["", ""],
    productWeightG: 0,
    packageWeightG: 0,
    productSizeCm: emptySize,
    packageSizeCm: emptySize,
    workbookDetail: createEspressoMirrorDetail(),
  };
}

function hydrateProductFromExcelSeed(product: Product): Product {
  const productWithWorkbook = product as Product & { workbookDetail?: TrialProductDraft };
  if (product.sku !== "00001" || productWithWorkbook.workbookDetail) {
    return product;
  }

  return {
    ...product,
    chineseName: "浓缩咖啡机镜子",
    englishName: "Espresso Shot Mirror",
    asin: "",
    developer: "黄斯涵",
    purchasePrice: 6.5405,
    status: "developing",
    supplierName: "深圳泰沃数码科技有限公司",
    supplierUrl: "https://detail.1688.com/offer/927860044677.html?spm=a21i7k.1688_web_im.chatboxOD.0",
    specs: "普通磁铁 / 强磁;底座+引磁片",
    purchaseLeadTime: "",
    createdAt: product.createdAt.includes(":") ? product.createdAt : `${product.createdAt || "2026-07-23"} 20:37:13`,
    keywords: "espresso shot mirror,espresso mirror",
    note: "咖啡爱好者 / 咖啡师用于观察咖啡液流出形态；重点改进强磁底座、3M背胶引磁片、飞机盒和说明书。",
    hsCode: "",
    competitorAsins: ["B0D2WNHF3V", "B0BJP1FM72", "B0DM1TB116", "B0F9Y1C7MZ", "B0GVDVJDVH", "B0BXCLX3HC"],
    productWeightG: 100,
    packageWeightG: 108.86,
    productSizeCm: { length: 10, width: 10, height: 5 },
    packageSizeCm: { length: 9.14, width: 9.14, height: 5.33 },
    workbookDetail: createEspressoMirrorDetail(),
  } as Product;
}

function normalizeWorkbookDetail(detail: TrialProductDraft | undefined, fallback: TrialProductDraft): TrialProductDraft {
  if (!detail) {
    return fallback;
  }

  return {
    ...fallback,
    ...detail,
    pricingRows: detail.pricingRows?.length
      ? detail.pricingRows.map((row) => ({ ...row, oceanFreightUnitPrice: row.oceanFreightUnitPrice ?? 12 }))
      : fallback.pricingRows,
    competitors: detail.competitors?.length
      ? detail.competitors.map((row) => ({
          ...row,
          hotVariantImage: row.hotVariantImage ?? "",
          fbaFee: row.fbaFee ?? "",
          negativePoint5: row.negativePoint5 ?? "",
          noteImage: row.noteImage ?? "",
        }))
      : fallback.competitors,
    suppliers: detail.suppliers?.length ? detail.suppliers : fallback.suppliers,
    improvement: {
      ...fallback.improvement,
      ...detail.improvement,
      rows: detail.improvement?.rows?.length
        ? detail.improvement.rows.map((row) => ({ ...createEmptyImprovementRow(), ...row }))
        : fallback.improvement.rows,
    },
    remarkImages: detail.remarkImages ?? fallback.remarkImages ?? [],
    keywords: detail.keywords?.length ? detail.keywords : fallback.keywords,
  };
}

const trialImprovementLabels: Record<Exclude<keyof TrialImprovement, "rows">, string> = {
  audience: "使用人群",
  scenario: "主要适用场景",
  painPoint1: "产品痛点1",
  painPoint2: "产品痛点2",
  painPoint3: "产品痛点3",
  material: "材质改进",
  size: "尺寸改进",
  functionImprovement: "功能改进",
  appearance: "外观（款式）",
  accessories: "配件（搭配）",
  packaging: "包装改进",
  manual: "说明书",
  imageCopySuggestion: "文案/主/附图片建议",
  peakSeason: "旺季月份",
  peakSales: "头部旺季平均销量",
  offSeasonSales: "头部淡季平均销量",
  targetSales: "目标销量",
  infringement: "侵权（专利/产权）",
  certification: "认证",
};

function createTrialProductDraft(): TrialProductDraft {
  return {
    title: "交易卡展示架",
    pricingRows: [
      { name: "交易卡展示架10pcs", lengthCm: 18.5, widthCm: 15, heightCm: 8, actualWeightKg: 0.6, suggestedPrice: 23.99, purchaseCost: 35, oceanFreightUnitPrice: 12, fbaFee: 5.42, exchangeRate: 6.8 },
      { name: "交易卡展示架24pcs", lengthCm: 25, widthCm: 20, heightCm: 8, actualWeightKg: 1.2, suggestedPrice: 37.99, purchaseCost: 76.8, oceanFreightUnitPrice: 12, fbaFee: 6.67, exchangeRate: 6.8 },
    ],
    competitors: [
      { type: "头部竞品", hotVariantImage: "", asin: "B0GL1XGNQM", sales30Days: "849 / 2026-02-14", variantCount: "5", variantType: "数量", hotVariantSpec: "17.5*8.5*2", hotVariantPrice: "40.88 / 750g", fbaFee: "5.76", priceChangeNote: "42.99-59.99", reviewCount: "13", rating: "4.5", negativePoint1: "希望它们再抬高一点", negativePoint2: "", negativePoint3: "", negativePoint4: "", negativePoint5: "", packageSize: "18.29 x 13.72 x 8.64 cm", note: "杂", noteImage: "" },
      { type: "直接竞品", hotVariantImage: "", asin: "B0GVSNLDYF", sales30Days: "160 / 2026-05-09", variantCount: "", variantType: "", hotVariantSpec: "16.2*8.4*1.3", hotVariantPrice: "25.99 / 680g", fbaFee: "5.61", priceChangeNote: "28.9-31.99", reviewCount: "19", rating: "4.3", negativePoint1: "", negativePoint2: "", negativePoint3: "", negativePoint4: "", negativePoint5: "", packageSize: "42.67 x 17.78 x 9.91 cm", note: "杂", noteImage: "" },
      { type: "参考竞品", hotVariantImage: "", asin: "B0GYF4D1B5", sales30Days: "201 / 2026-05-03", variantCount: "", variantType: "", hotVariantSpec: "16*8.5", hotVariantPrice: "59.97 / 1100g", fbaFee: "6.58", priceChangeNote: "69.97-59.97", reviewCount: "26", rating: "4.8", negativePoint1: "没这么牢固，有锁扣更好", negativePoint2: "黑色丙烯看起来非常干净", negativePoint3: "", negativePoint4: "", negativePoint5: "", packageSize: "18.80 x 15.75 x 9.65 cm", note: "收纳居多", noteImage: "" },
    ],
    suppliers: [
      { productUrl: "", factoryName: "广州飞伦工艺品有限公司", configuration: "", moq: "1000", leadTime: "", domesticFreightIncluded: "否", certifications: "无", patentCountry: "", packagingMethod: "", cost100: 3.5, cost300: 35, taxPoint: "普票2%", invoiceName: "", invoiceSpecUnit: "", invoiceRegion: "" },
    ],
    improvement: {
      audience: "卡片爱好者",
      scenario: "家中",
      painPoint1: "可以考虑怎么加锁扣或者防滑",
      painPoint2: "去掉 logo，做差异化镂空之类的",
      painPoint3: "采样看看品控",
      material: "亚克力",
      size: "17.5*8.5",
      functionImprovement: "收纳整理、展示",
      appearance: "",
      accessories: "可以配一个收纳袋",
      packaging: "前期先牛皮纸盒，后期看有没有必要加彩盒",
      manual: "简单产品介绍显得专业",
      imageCopySuggestion: "",
      peakSeason: "产品较新",
      peakSales: "400-500",
      offSeasonSales: "",
      targetSales: "100",
      infringement: "",
      certification: "",
      rows: [
        {
          material: "亚克力",
          size: "17.5*8.5",
          functionImprovement: "收纳整理、展示",
          appearance: "",
          accessories: "可以配一个收纳袋",
          packaging: "前期先牛皮纸盒，后期看有没有必要加彩盒",
          manual: "简单产品介绍显得专业",
          imageCopySuggestion: "",
          certification: "",
        },
      ],
    },
    remark: "",
    remarkImages: [],
    keywords: [
      { keyword: "card risers for display case", cpc: 0.4, monthlySearches: 4401, abaRank: 317832 },
      { keyword: "graded card display", cpc: 1.53, monthlySearches: 11912, abaRank: 124848 },
      { keyword: "sports card display", cpc: 0.72, monthlySearches: 9331, abaRank: 150351 },
      { keyword: "sports card display case", cpc: 1.54, monthlySearches: 7112, abaRank: 213697 },
      { keyword: "card display case", cpc: 1.84, monthlySearches: 31321, abaRank: 42337 },
      { keyword: "pokemon card display", cpc: 0.86, monthlySearches: 10715, abaRank: 154350 },
    ],
  };
}

function createEspressoMirrorDetail(): TrialProductDraft {
  return {
    title: "浓缩咖啡机镜子",
    pricingRows: [
      { name: "普通磁铁", lengthCm: 10, widthCm: 10, heightCm: 5, actualWeightKg: 0.1, suggestedPrice: 13.99, purchaseCost: 6.5405, oceanFreightUnitPrice: 12, fbaFee: 3.73, exchangeRate: 6.9 },
      { name: "强磁", lengthCm: 6.5, widthCm: 4, heightCm: 7.5, actualWeightKg: 0.11, suggestedPrice: 13.99, purchaseCost: 8.034, oceanFreightUnitPrice: 12, fbaFee: 3.73, exchangeRate: 6.9 },
    ],
    competitors: [
      {
        type: "头部竞品",
        hotVariantImage: "",
        asin: "B0D2WNHF3V",
        sales30Days: "427\n2024-05-07",
        variantCount: "2",
        variantType: "底座颜色（银色、黑色）",
        hotVariantSpec: "银色底座\n不锈钢镜面\n108.86 g",
        hotVariantPrice: "13.80\ncoupon11.73",
        fbaFee: "3.86",
        priceChangeNote: "/",
        reviewCount: "198",
        rating: "4.6",
        negativePoint1: "尺寸偏大，适配性差（13）\n镜子太大\n机身高度不足无法使用",
        negativePoint2: "磁吸 / 粘贴结构不稳（8）\n磁吸力度不足\n配套背胶贴片粘性差\n部分咖啡机机身无磁性用不了",
        negativePoint3: "镜面材质效果不佳（11）\n不锈钢镜子清晰度一般，成像偏暗\n支架 / 调节结构缺陷（7）\n调节关节阻尼偏大\n支架臂长度不足",
        negativePoint4: "配件与附加工具问题（4）\n无说明书",
        negativePoint5: "外观设计短板（2）\n质感一般\n不精致",
        packageSize: "9.14 x 9.14 x 5.33 cm",
        note: "",
        noteImage: "",
      },
      {
        type: "参考竞品",
        hotVariantImage: "",
        asin: "B0BJP1FM72",
        sales30Days: "161\n2022-11-14",
        variantCount: "1",
        variantType: "/",
        hotVariantSpec: "黑色底座\n玻璃镜面\n90.72 g",
        hotVariantPrice: "14.99",
        fbaFee: "3.86",
        priceChangeNote: "/",
        reviewCount: "256",
        rating: "4.5",
        negativePoint1: "配套金属贴片背胶品质差（4）\n引磁片双面胶老化\n粘合力不足",
        negativePoint2: "磁吸性能不稳定（4）\n磁铁吸力不足\n用户不愿意在咖啡机身粘胶",
        negativePoint3: "支架结构缺陷（5）\n支架臂长度偏短\n万向球头最大转角不足90度\n稳定性差",
        negativePoint4: "镜面相关问题（5）\n玻璃边角磕碰缺角\n无放大效果\n咖啡污渍附着后清洁难度偏高",
        negativePoint5: "缺少配套说明书（3）\n无说明书",
        packageSize: "7.87 x 7.62 x 5.08 cm",
        note: "",
        noteImage: "",
      },
      {
        type: "参考竞品",
        hotVariantImage: "",
        asin: "B0DM1TB116",
        sales30Days: "87\n2024-11-20",
        variantCount: "2",
        variantType: "底座颜色（银色、黑色）",
        hotVariantSpec: "银色底座\n不锈钢镜面\n81.65 g",
        hotVariantPrice: "9.99",
        fbaFee: "3.01",
        priceChangeNote: "7.89-9.99",
        reviewCount: "36",
        rating: "4.4",
        negativePoint1: "产品做工粗糙廉价（1）\n整体用料做工差、品质低劣",
        negativePoint2: "镜面尺寸偏大（3）\n镜面规格过大\n部分机型安装后干涉配件摆放",
        negativePoint3: "外观设计简陋（1）\n镜面无包边装饰\n不锈钢镜面材质缺陷（3）\n容易刮花\n粘指纹\n比不上玻璃镜面",
        negativePoint4: "使用环境易起雾（1）\n出厂零配件带油污（1）",
        negativePoint5: "",
        packageSize: "8.89 x 7.87 x 5.08 cm",
        note: "",
        noteImage: "",
      },
      {
        type: "参考竞品",
        hotVariantImage: "",
        asin: "B0F9Y1C7MZ",
        sales30Days: "64\n2025-07-10",
        variantCount: "1",
        variantType: "/",
        hotVariantSpec: "银色底座\n不锈钢镜面\n81.65 g",
        hotVariantPrice: "9.99",
        fbaFee: "3.01",
        priceChangeNote: "/",
        reviewCount: "13",
        rating: "4.3",
        negativePoint1: "磁吸相关问题（3）\n咖啡机不锈钢不带磁\n引磁片背胶粘不住\n磁铁吸力弱",
        negativePoint2: "机型空间适配不足（1）\n适配机型不足",
        negativePoint3: "镜片尺寸偏小（1）",
        negativePoint4: "镜面出场瑕疵（1）",
        negativePoint5: "",
        packageSize: "8.38 x 7.87 x 5.08 cm",
        note: "",
        noteImage: "",
      },
      {
        type: "参考竞品",
        hotVariantImage: "",
        asin: "B0GVDVJDVH",
        sales30Days: "76\n2026-05-21",
        variantCount: "1",
        variantType: "/",
        hotVariantSpec: "银色底座\n不锈钢镜面\n90.72 g",
        hotVariantPrice: "7.99",
        fbaFee: "3.01",
        priceChangeNote: "/",
        reviewCount: "3",
        rating: "3.9",
        negativePoint1: "质量差",
        negativePoint2: "",
        negativePoint3: "",
        negativePoint4: "",
        negativePoint5: "",
        packageSize: "",
        note: "",
        noteImage: "",
      },
      {
        type: "参考竞品",
        hotVariantImage: "",
        asin: "B0BXCLX3HC",
        sales30Days: "42\n2023-03-03",
        variantCount: "4",
        variantType: "",
        hotVariantSpec: "黑色底座\n木头镜子\n81.93 g",
        hotVariantPrice: "9.99",
        fbaFee: "3.73",
        priceChangeNote: "/",
        reviewCount: "203",
        rating: "3.9",
        negativePoint1: "运输破损严重，包装防护不足（12）\n镜子碎，底座破损",
        negativePoint2: "热胀冷缩导致玻璃开裂（9）\n装配公差过紧，玻璃膨胀崩裂",
        negativePoint3: "做工粗糙、用料差（3）\n1.木头表面工艺粗糙\n2.底座装配错位\n3.木框为未处理原木，遇水吸水膨胀\n4.漆面 / 木饰面质感差",
        negativePoint4: "磁吸相关缺陷（5）\n磁铁吸力偏弱\n配套引磁贴片不适合经常擦拭的接水盘",
        negativePoint5: "结构设计缺陷（5）\n仅有单旋转支点，调节角度有限\n支架臂偏短，调节范围不足\n擦拭时玻璃容易脱落\n边框尺寸偏大，挤占接水盘空间",
        packageSize: "",
        note: "",
        noteImage: "",
      },
    ],
    suppliers: [
      {
        productUrl: "https://detail.1688.com/offer/927860044677.html?spm=a21i7k.1688_web_im.chatboxOD.0",
        factoryName: "深圳泰沃数码科技有限公司",
        configuration: "底座+2片引磁片",
        moq: "",
        leadTime: "",
        domesticFreightIncluded: "",
        certifications: "",
        patentCountry: "",
        packagingMethod: "开窗纸盒\n\n换飞机盒",
        cost100: 0,
        cost300: 6.5,
        taxPoint: "普票3个点开票免费",
        invoiceName: "",
        invoiceSpecUnit: "",
        invoiceRegion: "",
      },
      {
        productUrl: "https://detail.1688.com/offer/992102683422.html?spm=a26352.13672862.offerlist.30.4c961e62TBS4cq&cosite=-&tracelog=p4p&_p_isad=1&clickid=12136426181a4fc5ada1168d16a05051&sessionid=bce541a9bb314e8e974468aba916b0d3",
        factoryName: "东莞市科世达包装制品有限公司",
        configuration: "飞机盒",
        moq: "",
        leadTime: "",
        domesticFreightIncluded: "",
        certifications: "",
        patentCountry: "",
        packagingMethod: "",
        cost100: 0,
        cost300: 0.3,
        taxPoint: "",
        invoiceName: "",
        invoiceSpecUnit: "",
        invoiceRegion: "",
      },
      {
        productUrl: "https://detail.1688.com/offer/999202581627.html?spm=a262uh.11734184.footprint-offer-list-offer3.2.35b92ef6DiT714",
        factoryName: "义乌市子漫工艺品有限公司",
        configuration: "镜子7cm",
        moq: "",
        leadTime: "",
        domesticFreightIncluded: "",
        certifications: "",
        patentCountry: "",
        packagingMethod: "",
        cost100: 0,
        cost300: 0.75,
        taxPoint: "",
        invoiceName: "",
        invoiceSpecUnit: "",
        invoiceRegion: "",
      },
      {
        productUrl: "https://detail.1688.com/offer/972335245714.html?spm=a262uh.11734184.footprint-offer-list-offer4.2.35b92ef6DiT714",
        factoryName: "金华荀梦电子商务有限责任公司",
        configuration: "镜子6cm",
        moq: "",
        leadTime: "",
        domesticFreightIncluded: "",
        certifications: "",
        patentCountry: "",
        packagingMethod: "",
        cost100: 0,
        cost300: 0.43,
        taxPoint: "",
        invoiceName: "",
        invoiceSpecUnit: "",
        invoiceRegion: "",
      },
    ],
    improvement: {
      audience: "咖啡爱好者，咖啡师",
      scenario: "观察咖啡液流出的形态",
      painPoint1: "强磁底座",
      painPoint2: "3M背胶引磁片，我们自己测试粘在不锈钢上会不会掉",
      painPoint3: "否",
      material: "否",
      size: "否",
      functionImprovement: "否",
      appearance: "否",
      accessories: "无",
      packaging: "飞机盒",
      manual: "做使用说明书",
      imageCopySuggestion: "",
      peakSeason: "",
      peakSales: "",
      offSeasonSales: "500",
      targetSales: "150",
      infringement: "",
      certification: "",
      rows: [
        {
          material: "否",
          size: "否",
          functionImprovement: "否",
          appearance: "否",
          accessories: "无",
          packaging: "飞机盒",
          manual: "做使用说明书",
          imageCopySuggestion: "",
          certification: "",
        },
      ],
    },
    remark: "成本拆分：普通磁铁=支架5.05+税0.1515+飞机盒0.3+镜子1+税0.039；强磁=支架6.5+税0.195+飞机盒0.3+镜子1+税0.039。",
    remarkImages: [],
    keywords: [
      { keyword: "espresso shot mirror", cpc: 0.63, monthlySearches: 488, abaRank: 1756622 },
      { keyword: "espresso mirror", cpc: 0.49, monthlySearches: 1539, abaRank: 1155349 },
    ],
  };
}

function calculateExcelPricing(row: TrialPriceRow) {
  const volumeWeightKg = (row.lengthCm * row.widthCm * row.heightCm) / 6000;
  const lengthIn = row.lengthCm / 2.54;
  const widthIn = row.widthCm / 2.54;
  const heightIn = row.heightCm / 2.54;
  const actualWeightLb = row.actualWeightKg * 2.2;
  const volumeWeightLbFromCm = volumeWeightKg * 2.2;
  const volumeWeightLb = (lengthIn * widthIn * heightIn) / 139;
  const fbaBillableWeightLb = Math.max(actualWeightLb, volumeWeightLb);
  const oceanFreight = (Math.max(actualWeightLb, volumeWeightLbFromCm) / 2.2) * (row.oceanFreightUnitPrice || 0);
  const commission = row.suggestedPrice * 0.15;
  const fuelFee = row.fbaFee * 0.035;
  const monthlyStorageFee = lengthIn * widthIn * heightIn * 0.000578 * 0.87;
  const breakEvenPrice = row.exchangeRate
    ? (row.purchaseCost + oceanFreight) / row.exchangeRate + commission + row.fbaFee + fuelFee + monthlyStorageFee
    : 0;
  const profit = row.suggestedPrice - breakEvenPrice;
  const profitRate = row.suggestedPrice ? profit / row.suggestedPrice : 0;

  return {
    volumeWeightKg,
    lengthIn,
    widthIn,
    heightIn,
    actualWeightLb,
    volumeWeightLbFromCm,
    volumeWeightLb,
    fbaBillableWeightLb,
    oceanFreight,
    commission,
    fuelFee,
    monthlyStorageFee,
    breakEvenPrice,
    profit,
    profitRate,
  };
}

function calculateTrialPricing(row: TrialPriceRow) {
  const volumeWeightKg = (row.lengthCm * row.widthCm * row.heightCm) / 6000;
  const billableWeight = Math.max(row.actualWeightKg, volumeWeightKg);
  const fuelFee = row.fbaFee * 0.035;
  const oceanFreight = billableWeight * (row.oceanFreightUnitPrice || 0);
  const commission = row.suggestedPrice * 0.15;
  const monthlyStorageFee = (row.lengthCm / 2.54) * (row.widthCm / 2.54) * (row.heightCm / 2.54) * 0.000578 * 0.87;
  const breakEvenPrice = row.exchangeRate ? (row.purchaseCost + oceanFreight) / row.exchangeRate + commission + row.fbaFee + monthlyStorageFee : 0;
  const profit = row.suggestedPrice - breakEvenPrice;
  const profitRate = row.suggestedPrice ? profit / row.suggestedPrice : 0;
  const volumeWeightLb = (row.lengthCm / 2.54) * (row.widthCm / 2.54) * (row.heightCm / 2.54) / 139;
  const actualWeightLb = row.actualWeightKg * 2.205;
  const lightFreight = volumeWeightLb > 3 ? ((volumeWeightLb - 3) * 16) / 4 * 0.08 + 6.92 : 0;
  const heavyFreight = actualWeightLb > 3 ? ((actualWeightLb - 3) * 16) / 4 * 0.08 + 6.92 : 0;
  const oversizeFreight = actualWeightLb - 1 * 0.38 + 9.61;

  return {
    volumeWeightKg,
    fuelFee,
    oceanFreight,
    commission,
    monthlyStorageFee,
    breakEvenPrice,
    profit,
    profitRate,
    volumeWeightLb,
    actualWeightLb,
    lightFreight,
    heavyFreight,
    oversizeFreight,
  };
}

function isOverdueProduct(product: Product) {
  if (["listed", "canceled", "delisted", "patent_risk"].includes(product.status)) {
    return false;
  }

  const createdAt = new Date(product.createdAt.includes(" ") ? product.createdAt.replace(" ", "T") : `${product.createdAt}T00:00:00`);
  if (Number.isNaN(createdAt.getTime())) {
    return false;
  }

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const elapsedDays = Math.floor((todayStart.getTime() - createdAt.getTime()) / 86_400_000);

  return elapsedDays > overdueThresholdDays;
}

function nextSku(products: Product[]) {
  const max = products.reduce((currentMax, product) => {
    const numeric = Number(product.sku);
    return Number.isFinite(numeric) ? Math.max(currentMax, numeric) : currentMax;
  }, 0);

  return String(max + 1).padStart(5, "0");
}

function formatDateTime(date: Date) {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function buildAmazonLink(asin: string) {
  const normalized = asin.trim();
  return normalized ? `https://www.amazon.com/dp/${encodeURIComponent(normalized)}` : "";
}

