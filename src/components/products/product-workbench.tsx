"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ExternalLink, FileDown, FileUp, History, ImagePlus, PackagePlus, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { initialProducts, productStatusOptions } from "@/data/products";
import type { Product, ProductDraft, ProductStatus } from "@/lib/products/types";

import {
  initialFilters,
  pageSizeOptions,
  scalarImprovementFields,
  storageKey,
  supplierFields,
  trialStorageKey,
  type ProductEditorDraft,
  type ProductFilters,
  type TrialCompetitorRow,
  type TrialImprovement,
  type TrialImprovementCellKey,
  type TrialKeywordRow,
  type TrialPriceRow,
  type TrialProductDraft,
  type TrialSupplierRow,
} from "./product-workbench-model";
import {
  ProductWorkbookDetailSections,
  createEmptyImprovementRow,
  getImprovementRow,
  getSupplierTextareaSize,
} from "./product-workbook-detail-sections";
import { ExternalLinkButton, LabeledInput, ReadonlyMetric, SmallInput, SmallTextarea } from "./product-workbench-fields";
import { ActivityLogModal, ProductFiltersBar, ProductTable } from "./product-workbench-shell";
import {
  buildAmazonLink,
  calculateTrialPricing,
  formatDateTime,
  isOverdueProduct,
} from "./product-workbench-utils";
import {
  createTrialProductDraft,
  hydrateProductFromExcelSeed,
  parseProductWorkbookFile,
  productToDraft,
  trialImprovementLabels,
} from "./product-workbench-data";

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

