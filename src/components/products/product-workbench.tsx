"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ExternalLink,
  FileDown,
  FileUp,
  History,
  ImagePlus,
  PackagePlus,
  Plus,
  RotateCcw,
  Save,
  Search,
  X,
} from "lucide-react";
import { AppShell } from "@/components/app-shell/app-shell";
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
  fbaFee: number;
  exchangeRate: number;
};

type TrialCompetitorRow = {
  type: string;
  asin: string;
  sales30Days: string;
  variantCount: string;
  variantType: string;
  hotVariantSpec: string;
  hotVariantPrice: string;
  priceChangeNote: string;
  reviewCount: string;
  rating: string;
  negativePoint1: string;
  negativePoint2: string;
  negativePoint3: string;
  negativePoint4: string;
  packageSize: string;
  note: string;
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
  keywords: TrialKeywordRow[];
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

export function ProductWorkbench() {
  const [products, setProducts] = useState<Product[]>(initialProducts);
  const [trialProducts, setTrialProducts] = useState<TrialProductDraft[]>([]);
  const [filters, setFilters] = useState<ProductFilters>(initialFilters);
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isTrialEditorOpen, setIsTrialEditorOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [activityLog, setActivityLog] = useState<string[]>(["产品工作台已就绪"]);

  useEffect(() => {
    const saved = window.localStorage.getItem(storageKey);
    if (!saved) {
      return;
    }

    try {
      const parsed = JSON.parse(saved) as Product[];
      if (Array.isArray(parsed)) {
        setProducts(parsed);
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

  return (
    <AppShell title="产品管理" subtitle="商品资料、竞品 ASIN、供应商与尺寸重量的统一工作台">
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
              <Button variant="secondary" size="sm" onClick={() => setActivityLog((current) => ["导入功能待接入 Excel 模板", ...current].slice(0, 8))}>
                <FileUp className="h-4 w-4" />
                导入数据
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setActivityLog((current) => ["导出功能待接入 Excel 模板", ...current].slice(0, 8))}>
                <FileDown className="h-4 w-4" />
                导出数据
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setActivityLog((current) => ["最近操作已展开在右侧记录区", ...current].slice(0, 8))}>
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
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_260px]">
              <ProductTable products={visibleProducts} totalCount={filteredProducts.length} onOpenProduct={openProduct} />
              <ActivityPanel entries={activityLog} onResetDemoData={resetDemoData} />
            </div>
            <Pagination page={page} pageCount={pageCount} pageSize={pageSize} pageSizeOptions={pageSizeOptions} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </CardContent>
        </Card>

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
    </AppShell>
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
                      <img src={product.images[0]} alt={product.chineseName} className="h-full w-full object-cover" />
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

function ActivityPanel({ entries, onResetDemoData }: { entries: string[]; onResetDemoData: () => void }) {
  return (
    <aside className="rounded-lg border border-border bg-white p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-bold text-foreground">操作记录</p>
        <Button variant="secondary" size="sm" onClick={onResetDemoData}>
          恢复演示
        </Button>
      </div>
      <div className="mt-4 space-y-3">
        {entries.map((entry, index) => (
          <div key={`${entry}-${index}`} className="rounded-md border border-border bg-surface-muted px-3 py-2 text-xs font-medium text-muted">
            {entry}
          </div>
        ))}
      </div>
    </aside>
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

  function updateImprovement(field: keyof TrialImprovement, value: string) {
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
              <table className="min-w-[1680px] text-left text-xs">
                <thead className="bg-surface-muted text-muted">
                  <tr>
                    {["品名", "长cm", "宽cm", "高cm", "实际重Kg", "材积重Kg", "建议售价", "采购成本", "FBA配送费", "燃油附加费", "海运头程", "佣金", "月仓储费", "汇率", "保本价", "海运毛利润", "海运毛利润率", "体积重量/磅", "重量/磅", "3磅+抛货运费", "3磅+重货运费", "超标件运费"].map((label) => (
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
                        <td className="px-2 py-2"><SmallInput type="number" value={row.lengthCm} onChange={(value) => updatePricingRow(index, "lengthCm", value)} /></td>
                        <td className="px-2 py-2"><SmallInput type="number" value={row.widthCm} onChange={(value) => updatePricingRow(index, "widthCm", value)} /></td>
                        <td className="px-2 py-2"><SmallInput type="number" value={row.heightCm} onChange={(value) => updatePricingRow(index, "heightCm", value)} /></td>
                        <td className="px-2 py-2"><SmallInput type="number" value={row.actualWeightKg} onChange={(value) => updatePricingRow(index, "actualWeightKg", value)} /></td>
                        <ReadonlyMetric value={calc.volumeWeightKg} />
                        <td className="px-2 py-2"><SmallInput type="number" value={row.suggestedPrice} onChange={(value) => updatePricingRow(index, "suggestedPrice", value)} /></td>
                        <td className="px-2 py-2"><SmallInput type="number" value={row.purchaseCost} onChange={(value) => updatePricingRow(index, "purchaseCost", value)} /></td>
                        <td className="px-2 py-2"><SmallInput type="number" value={row.fbaFee} onChange={(value) => updatePricingRow(index, "fbaFee", value)} /></td>
                        <ReadonlyMetric value={calc.fuelFee} />
                        <ReadonlyMetric value={calc.oceanFreight} />
                        <ReadonlyMetric value={calc.commission} />
                        <ReadonlyMetric value={calc.monthlyStorageFee} />
                        <td className="px-2 py-2"><SmallInput type="number" value={row.exchangeRate} onChange={(value) => updatePricingRow(index, "exchangeRate", value)} /></td>
                        <ReadonlyMetric value={calc.breakEvenPrice} />
                        <ReadonlyMetric value={calc.profit} />
                        <ReadonlyMetric value={`${(calc.profitRate * 100).toFixed(1)}%`} />
                        <ReadonlyMetric value={calc.volumeWeightLb} />
                        <ReadonlyMetric value={calc.actualWeightLb} />
                        <ReadonlyMetric value={calc.lightFreight} />
                        <ReadonlyMetric value={calc.heavyFreight} />
                        <ReadonlyMetric value={calc.oversizeFreight} />
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
              <table className="min-w-[1500px] text-left text-xs">
                <thead className="bg-surface-muted text-muted">
                  <tr>
                    {["类型", "ASIN", "近30天销量", "变体数量", "变体类型", "热销变体规格", "热销变体价格($)", "近3个月价格变动备注", "评论数", "评分", "差评点1", "差评点2", "差评点3", "差评点4", "竞品包装尺寸", "备注"].map((label) => (
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
                    {["供应商产品链接", "厂家名称", "配置", "起订量", "交期", "是否包国内物流费", "相关认证", "专利国家", "产品包装方式", "采购成本（100套）", "采购成本（300）", "税点", "开票命名", "开票规格-单位", "开票地区"].map((label) => (
                      <th key={label} className="px-2 py-2 font-bold">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {draft.suppliers.map((row, index) => (
                    <tr key={index} className="border-t border-border">
                      {(Object.keys(row) as (keyof TrialSupplierRow)[]).map((field) => (
                        <td key={field} className="px-2 py-2">
                          <SmallInput
                            type={field === "cost100" || field === "cost300" ? "number" : "text"}
                            value={row[field]}
                            onChange={(value) => updateSupplier(index, field, value)}
                          />
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
              {(Object.keys(draft.improvement) as (keyof TrialImprovement)[]).map((field) => (
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
  const [draft, setDraft] = useState<ProductDraft>(() => productToDraft(product, products));
  const [unitMode, setUnitMode] = useState<"metric" | "imperial">("metric");

  const isEditing = Boolean(product);
  const mainAmazonLink = buildAmazonLink(draft.asin);

  function setField<K extends keyof ProductDraft>(field: K, value: ProductDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function setSizeField(sizeKey: "productSizeCm" | "packageSizeCm", dimension: keyof ProductSizeCm, value: string) {
    const numeric = Number(value);
    setDraft((current) => ({
      ...current,
      [sizeKey]: {
        ...current[sizeKey],
        [dimension]: Number.isFinite(numeric) ? numeric : 0,
      },
    }));
  }

  function setCompetitorAsin(index: number, value: string) {
    setDraft((current) => {
      const next = [...current.competitorAsins];
      next[index] = value.trim();
      return { ...current, competitorAsins: next };
    });
  }

  function addCompetitorAsin() {
    setDraft((current) => ({ ...current, competitorAsins: [...current.competitorAsins, ""] }));
  }

  function removeCompetitorAsin(index: number) {
    setDraft((current) => ({ ...current, competitorAsins: current.competitorAsins.filter((_, currentIndex) => currentIndex !== index) }));
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
      competitorAsins: draft.competitorAsins.map((asin) => asin.trim().toUpperCase()).filter(Boolean),
    });
  }

  return (
    <div className="fixed inset-0 z-30 bg-foreground/35 p-4 backdrop-blur-sm">
      <div className="mx-auto flex h-full max-w-6xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
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
          <div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]">
            <section className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>图片</CardTitle>
                </CardHeader>
                <CardContent>
                  <label className="flex h-36 cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface-muted text-center transition-colors hover:border-brand hover:bg-white">
                    <ImagePlus className="h-8 w-8 text-brand" />
                    <span className="mt-2 text-sm font-semibold text-foreground">上传图片</span>
                    <span className="mt-1 text-xs text-muted">可上传 5-10 张，列表显示第一张</span>
                    <input type="file" accept="image/*" multiple className="hidden" onChange={(event) => handleImageUpload(event.target.files)} />
                  </label>
                  <div className="mt-3 grid grid-cols-5 gap-2">
                    {draft.images.map((image, index) => (
                      <button
                        key={`${image.slice(0, 24)}-${index}`}
                        className="relative h-14 overflow-hidden rounded-md border border-border bg-surface-muted"
                        onClick={() => setDraft((current) => ({ ...current, images: current.images.filter((_, imageIndex) => imageIndex !== index) }))}
                        title="点击移除"
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={image} alt={`商品图片 ${index + 1}`} className="h-full w-full object-cover" />
                      </button>
                    ))}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>竞品链接</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {draft.competitorAsins.map((asin, index) => (
                    <div key={index} className="flex gap-2">
                      <input
                        className="h-10 min-w-0 flex-1 rounded-md border border-border px-3 text-sm outline-none focus:border-brand"
                        value={asin}
                        placeholder="竞品 ASIN"
                        onChange={(event) => setCompetitorAsin(index, event.target.value)}
                      />
                      <AmazonLinkButton asin={asin} />
                      <Button variant="ghost" size="icon" title="删除" onClick={() => removeCompetitorAsin(index)}>
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button variant="secondary" size="sm" onClick={addCompetitorAsin}>
                    <Plus className="h-4 w-4" />
                    添加竞品 ASIN
                  </Button>
                </CardContent>
              </Card>
            </section>

            <section className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>基础信息</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  <LabeledInput label="SKU" value={draft.sku} onChange={(value) => setField("sku", value)} />
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
                  <LabeledInput label="创建日期" type="date" value={draft.createdAt} onChange={(value) => setField("createdAt", value)} />
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
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between">
                  <CardTitle>尺寸重量</CardTitle>
                  <div className="inline-flex rounded-md border border-border bg-surface-muted p-1">
                    <button
                      className={`rounded px-3 py-1 text-xs font-bold ${unitMode === "metric" ? "bg-white text-foreground shadow-sm" : "text-muted"}`}
                      onClick={() => setUnitMode("metric")}
                    >
                      公制
                    </button>
                    <button
                      className={`rounded px-3 py-1 text-xs font-bold ${unitMode === "imperial" ? "bg-white text-foreground shadow-sm" : "text-muted"}`}
                      onClick={() => setUnitMode("imperial")}
                    >
                      英制
                    </button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <LabeledInput label="产品重量（g）" type="number" value={String(draft.productWeightG)} onChange={(value) => setField("productWeightG", Number(value) || 0)} />
                    <LabeledInput label="包装重量（g）" type="number" value={String(draft.packageWeightG)} onChange={(value) => setField("packageWeightG", Number(value) || 0)} />
                  </div>
                  <SizeInputs title="产品尺寸（cm）" value={draft.productSizeCm} onChange={(dimension, value) => setSizeField("productSizeCm", dimension, value)} />
                  <SizeInputs title="包装尺寸（cm）" value={draft.packageSizeCm} onChange={(dimension, value) => setSizeField("packageSizeCm", dimension, value)} />
                  <div className="rounded-md border border-border bg-surface-muted px-3 py-2 text-xs font-semibold text-muted">
                    {unitMode === "metric"
                      ? `包装重量 ${draft.packageWeightG} g，包装尺寸 ${formatSize(draft.packageSizeCm, "cm")}`
                      : `包装重量 ${gramsToPounds(draft.packageWeightG)} lb，包装尺寸 ${formatSize(cmSizeToInch(draft.packageSizeCm), "in")}`}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>供应采购与合规</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-3 md:grid-cols-2">
                  <LabeledInput label="供应商名称" value={draft.supplierName} onChange={(value) => setField("supplierName", value)} />
                  <LabeledInput label="采购交期" value={draft.purchaseLeadTime} onChange={(value) => setField("purchaseLeadTime", value)} />
                  <LabeledInput label="采购链接" value={draft.supplierUrl} onChange={(value) => setField("supplierUrl", value)} />
                  <LabeledInput label="HSCODE" value={draft.hsCode} onChange={(value) => setField("hsCode", value)} />
                  <LabeledInput label="规格" value={draft.specs} onChange={(value) => setField("specs", value)} />
                  <LabeledInput label="选品关键词" value={draft.keywords} onChange={(value) => setField("keywords", value)} />
                  <label className="md:col-span-2 text-xs font-semibold text-muted">
                    备注
                    <textarea
                      className="mt-1 min-h-24 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
                      value={draft.note}
                      onChange={(event) => setField("note", event.target.value)}
                    />
                  </label>
                </CardContent>
              </Card>
            </section>
          </div>
        </div>
      </div>
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
}: {
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <input
      className="h-8 w-full min-w-[88px] rounded-md border border-border bg-white px-2 text-xs text-foreground outline-none focus:border-brand"
      type={type}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  );
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

function SizeInputs({
  title,
  value,
  onChange,
}: {
  title: string;
  value: ProductSizeCm;
  onChange: (dimension: keyof ProductSizeCm, value: string) => void;
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted">{title}</p>
      <div className="mt-1 grid grid-cols-3 gap-2">
        <input className="h-10 rounded-md border border-border px-3 text-sm outline-none focus:border-brand" type="number" value={value.length} placeholder="长" onChange={(event) => onChange("length", event.target.value)} />
        <input className="h-10 rounded-md border border-border px-3 text-sm outline-none focus:border-brand" type="number" value={value.width} placeholder="宽" onChange={(event) => onChange("width", event.target.value)} />
        <input className="h-10 rounded-md border border-border px-3 text-sm outline-none focus:border-brand" type="number" value={value.height} placeholder="高" onChange={(event) => onChange("height", event.target.value)} />
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
      className={`inline-flex h-10 w-10 items-center justify-center rounded-md border border-border ${href ? "text-brand hover:border-brand" : "pointer-events-none text-muted opacity-50"}`}
      href={href || "#"}
      target="_blank"
      rel="noreferrer"
      title="打开 Amazon 链接"
    >
      <ExternalLink className="h-4 w-4" />
    </a>
  );
}

function productToDraft(product: Product | null, products: Product[]): ProductDraft {
  if (product) {
    return { ...product, cancelReason: product.cancelReason ?? "", competitorAsins: product.competitorAsins.length ? product.competitorAsins : [""] };
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
    createdAt: new Date().toISOString().slice(0, 10),
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
  };
}

const trialImprovementLabels: Record<keyof TrialImprovement, string> = {
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
      { name: "交易卡展示架10pcs", lengthCm: 18.5, widthCm: 15, heightCm: 8, actualWeightKg: 0.6, suggestedPrice: 23.99, purchaseCost: 35, fbaFee: 5.42, exchangeRate: 6.8 },
      { name: "交易卡展示架24pcs", lengthCm: 25, widthCm: 20, heightCm: 8, actualWeightKg: 1.2, suggestedPrice: 37.99, purchaseCost: 76.8, fbaFee: 6.67, exchangeRate: 6.8 },
    ],
    competitors: [
      { type: "头部竞品", asin: "B0GL1XGNQM", sales30Days: "849 / 2026-02-14", variantCount: "5", variantType: "数量", hotVariantSpec: "17.5*8.5*2", hotVariantPrice: "40.88 / FBA:5.76 / 750g", priceChangeNote: "42.99-59.99", reviewCount: "13", rating: "4.5", negativePoint1: "希望它们再抬高一点", negativePoint2: "", negativePoint3: "", negativePoint4: "", packageSize: "18.29 x 13.72 x 8.64 cm", note: "杂" },
      { type: "低价竞品", asin: "B0GVSNLDYF", sales30Days: "160 / 2026-05-09", variantCount: "", variantType: "", hotVariantSpec: "16.2*8.4*1.3", hotVariantPrice: "25.99 / FBA:5.61 / 680g", priceChangeNote: "28.9-31.99", reviewCount: "19", rating: "4.3", negativePoint1: "", negativePoint2: "", negativePoint3: "", negativePoint4: "", packageSize: "42.67 x 17.78 x 9.91 cm", note: "杂" },
      { type: "对标竞品", asin: "B0GYF4D1B5", sales30Days: "201 / 2026-05-03", variantCount: "", variantType: "", hotVariantSpec: "16*8.5", hotVariantPrice: "59.97 / FBA:6.58 / 1100g", priceChangeNote: "69.97-59.97", reviewCount: "26", rating: "4.8", negativePoint1: "没这么牢固，有锁扣更好", negativePoint2: "黑色丙烯看起来非常干净", negativePoint3: "", negativePoint4: "", packageSize: "18.80 x 15.75 x 9.65 cm", note: "收纳居多" },
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
    },
    remark: "",
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

function calculateTrialPricing(row: TrialPriceRow) {
  const volumeWeightKg = (row.lengthCm * row.widthCm * row.heightCm) / 6000;
  const billableWeight = Math.max(row.actualWeightKg, volumeWeightKg);
  const fuelFee = row.fbaFee * 0.035;
  const oceanFreight = billableWeight * 12;
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

  const createdAt = new Date(`${product.createdAt}T00:00:00`);
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

function buildAmazonLink(asin: string) {
  const normalized = asin.trim();
  return normalized ? `https://www.amazon.com/dp/${encodeURIComponent(normalized)}` : "";
}

function gramsToPounds(value: number) {
  return (value / 453.59237).toFixed(2);
}

function cmSizeToInch(size: ProductSizeCm): ProductSizeCm {
  return {
    length: Number((size.length / 2.54).toFixed(2)),
    width: Number((size.width / 2.54).toFixed(2)),
    height: Number((size.height / 2.54).toFixed(2)),
  };
}

function formatSize(size: ProductSizeCm, unit: "cm" | "in") {
  return `${size.length} x ${size.width} x ${size.height} ${unit}`;
}
