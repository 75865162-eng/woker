"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bell, ExternalLink, FileDown, FileUp, History, ImagePlus, PackagePlus, Save, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { initialProducts, newProductStatusOptions, productStatusOptions } from "@/data/products";
import {
  accountRosterStorageKey,
  accountsToTeamMembers,
  type AccountRoleId,
  defaultTeamAccounts,
  filterTeamMembersByRoles,
  normalizeTeamAccounts,
  type TeamAccountRecord,
  type TeamMember,
} from "@/lib/accounts/team-roster";
import type { Product, ProductDraft, ProductStatus, ProductWorkflowRole, ProductWorkflowStage } from "@/lib/products/types";
import {
  buildWorkflowEvent,
  createWorkflowDueAt,
  formatWorkflowDate,
  getCurrentWorkflowAssignee,
  getProductWorkflowStage,
  isProductWorkflowOverdue,
  formatAssigneeList,
  normalizeAssigneeList,
  productWorkflowStageLabels,
  productWorkflowStageTones,
} from "@/lib/products/workflow";
import { hasIncompleteOperationsProgress } from "@/lib/products/operations-progress";

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
import { ProductImageCopyGalleryModal } from "./product-image-copy-gallery-modal";
import { ExternalLinkButton, LabeledInput, ReadonlyMetric, SmallInput, SmallTextarea } from "./product-workbench-fields";
import { ActivityLogModal, ProductFiltersBar, ProductTable } from "./product-workbench-shell";
import { ProductOperationsProgress } from "./product-operations-progress";
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
  const [teamAccounts, setTeamAccounts] = useState<TeamAccountRecord[]>([]);
  const [creatorName, setCreatorName] = useState("当前创建人");
  const teamMembers = useMemo(() => accountsToTeamMembers(teamAccounts), [teamAccounts]);
  const opsOptions = useMemo(() => getTeamMemberOptions(teamMembers, ["operations_supervisor", "operations"]), [teamMembers]);
  const designerOptions = useMemo(() => getTeamMemberOptions(teamMembers, ["designer"]), [teamMembers]);
  const opsFilterOptions = useMemo(() => getAccountNameOptionsByRoleIds(teamAccounts, ["operations"]), [teamAccounts]);
  const selectionOwnerFilterOptions = useMemo(() => getAccountNameOptionsByRoleIds(teamAccounts, ["developer", "procurement"]), [teamAccounts]);
  const designerFilterOptions = useMemo(() => getAccountNameOptionsByRoleIds(teamAccounts, ["designer"]), [teamAccounts]);
  const newProductStatusValues = useMemo(() => new Set(newProductStatusOptions.map((option) => option.value)), []);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { user?: { name?: string } } | null) => {
        if (data?.user?.name) {
          setCreatorName(data.user.name);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let canceled = false;

    async function loadTeamAccounts() {
      const [apiAccounts, localAccounts] = await Promise.all([loadTeamAccountsFromApi(), Promise.resolve(loadTeamAccountsFromLocalStorage())]);
      if (canceled) return;

      setTeamAccounts(mergeTeamAccounts(apiAccounts, localAccounts));
    }

    void loadTeamAccounts();

    function handleStorage(event: StorageEvent) {
      if (event.key === accountRosterStorageKey) {
        void loadTeamAccounts();
      }
    }

    window.addEventListener("storage", handleStorage);

    return () => {
      canceled = true;
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

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
    const opsAssignees = normalizeFilterNames(filters.opsAssignees);
    const selectionOwners = normalizeFilterNames(filters.selectionOwners);
    const designerAssignees = normalizeFilterNames(filters.designerAssignees);
    const supplierName = filters.supplierName.trim().toLowerCase();

    return products.filter((product) => {
      const searchable = [product.sku, product.chineseName, product.englishName, product.keywords, product.note]
        .join(" ")
        .toLowerCase();
      const productOpsAssignees = normalizeAssigneeList(product.opsAssignee, product.opsAssignees).map((item) => item.toLowerCase());
      const productSelectionOwner = (product.selectionOwner || product.developer).toLowerCase();
      const productDesignerAssignees = normalizeAssigneeList(product.designerAssignee, product.designerAssignees).map((item) => item.toLowerCase());

      if (keyword && !searchable.includes(keyword)) return false;
      if (asin && !product.asin.toLowerCase().includes(asin) && !product.competitorAsins.join(" ").toLowerCase().includes(asin)) return false;
      if (opsAssignees.length && !matchesAnyName(productOpsAssignees, opsAssignees)) return false;
      if (selectionOwners.length && !matchesAnyName([productSelectionOwner], selectionOwners)) return false;
      if (designerAssignees.length && !matchesAnyName(productDesignerAssignees, designerAssignees)) return false;
      if (supplierName && !product.supplierName.toLowerCase().includes(supplierName)) return false;
      if (filters.status === "overdue" && !isOverdueProduct(product)) return false;
      if (filters.status === "design_in_progress" && product.status !== "design_in_progress") return false;
      if (filters.status === "operations_progress" && !hasIncompleteOperationsProgress(product.operationsProgress)) return false;
      if (
        filters.status !== "all" &&
        filters.status !== "overdue" &&
        filters.status !== "design_in_progress" &&
        filters.status !== "operations_progress" &&
        product.status !== filters.status
      ) {
        return false;
      }
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

  const developingCount = products.filter((product) => product.status === "developing").length;
  const opsReviewCount = products.filter((product) => product.status === "ops_review").length;
  const designInProgressProducts = products.filter((product) => product.status === "design_in_progress");
  const operationsProgressProducts = products.filter((product) => hasIncompleteOperationsProgress(product.operationsProgress));
  const overdueCount = products.filter(isOverdueProduct).length;
  const workflowOverdueCount = products.filter((product) => isProductWorkflowOverdue(product)).length;

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
    const normalizedStatus = existing || newProductStatusValues.has(draft.status) ? draft.status : "pending";
    const nextProduct: Product = {
      ...draft,
      status: normalizedStatus,
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
    setActivityLog((current) => ["已恢复演示商品数据", ...current].slice(0, 8));
  }

  async function handleImportFile(file: File | undefined) {
    if (!file) {
      return;
    }

    try {
      const imported = await parseProductWorkbookFile(file, products);
      const importedWithOwner = {
        ...imported,
        selectionOwner: creatorName,
        developer: "",
      };
      setProducts((current) => [importedWithOwner, ...current]);
      setActiveProductId(importedWithOwner.id);
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
        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
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
            label="美工处理中"
            value={designInProgressProducts.length.toLocaleString("zh-CN")}
            tone="blue"
            active={filters.status === "design_in_progress"}
            detail={formatSkuPreview(designInProgressProducts)}
            onClick={() => setFilters((current) => ({ ...current, status: "design_in_progress" }))}
          />
          <SummaryTile
            label="运营进程"
            value={operationsProgressProducts.length.toLocaleString("zh-CN")}
            tone="amber"
            active={filters.status === "operations_progress"}
            detail={formatSkuPreview(operationsProgressProducts)}
            onClick={() => setFilters((current) => ({ ...current, status: "operations_progress" }))}
          />
          <SummaryTile
            label="超期处理"
            value={overdueCount.toLocaleString("zh-CN")}
            tone="red"
            active={filters.status === "overdue"}
            onClick={() => setFilters((current) => ({ ...current, status: "overdue" }))}
          />
          <SummaryTile
            label="流程超时提醒"
            value={workflowOverdueCount.toLocaleString("zh-CN")}
            tone="red"
          />
        </section>

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle>产品列表</CardTitle>
              <p className="mt-1 text-xs font-medium text-muted">新增 SKU 默认待开发；创建超过 7 天且未上架、未取消的商品会自动进入超期处理。</p>
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
            <ProductFiltersBar
              filters={filters}
              opsAssigneeOptions={opsFilterOptions}
              selectionOwnerOptions={selectionOwnerFilterOptions}
              designerAssigneeOptions={designerFilterOptions}
              onChange={setFilters}
              onReset={() => setFilters(initialFilters)}
            />
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
            creatorName={creatorName}
            opsOptions={opsOptions}
            designerOptions={designerOptions}
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
              <LabeledInput label="试算商品名称" value={draft.title} placeholder="例如：交易卡展示" onChange={(value) => setDraft((current) => ({ ...current, title: value }))} />
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
                    {["品名", "长 cm", "宽 cm", "高 cm", "实际重量 g", "材积重量 g", "建议售价(USD)", "采购成本(RMB)", "FBA配送费$", "3.5% 燃油及物流附加费(USD)", "海运单价(RMB)", "海运头程(RMB)", "佣金(USD)", "月仓储费(USD)", "汇率", "保本价(USD)", "海运毛利(USD)", "海运毛利率", "体积重量/", "重量/"].map((label) => (
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
                    {["供应商产品链路", "厂家名称", "配置", "起订量", "交期", "国内物流费", "相关认证", "专利国家", "产品包装方式", "采购成本(100套)", "采购成本(300)", "开票信息", "备注"].map((label) => (
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
  creatorName,
  opsOptions,
  designerOptions,
  onClose,
  onSave,
}: {
  product: Product | null;
  products: Product[];
  creatorName: string;
  opsOptions: string[];
  designerOptions: string[];
  onClose: () => void;
  onSave: (draft: ProductDraft) => void;
}) {
  const [draft, setDraft] = useState<ProductEditorDraft>(() => productToDraft(product, products));
  const [operationsProgressOpen, setOperationsProgressOpen] = useState(false);
  const [imageCopyGalleryOpen, setImageCopyGalleryOpen] = useState(false);

  const isEditing = Boolean(product);
  const mainAmazonLink = buildAmazonLink(draft.asin);
  const workbookDetail = draft.workbookDetail;
  const workflowStage = getProductWorkflowStage(draft);
  const workflowAssignee = getCurrentWorkflowAssignee(draft);
  const workflowOverdue = isProductWorkflowOverdue(draft);
  const selectionOwner = draft.selectionOwner || (isEditing ? product?.selectionOwner : creatorName) || creatorName;
  const selectedOps = normalizeAssigneeList(draft.opsAssignee, draft.opsAssignees);
  const selectedDesigners = normalizeAssigneeList(draft.designerAssignee, draft.designerAssignees);
  const showListingActions = draft.status === "listing_confirming" || draft.status === "listed";
  const statusOptions = isEditing ? productStatusOptions : newProductStatusOptions;

  function setField<K extends keyof ProductDraft>(field: K, value: ProductDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updateStatus(status: ProductStatus) {
    const nextStage =
      status === "ops_review"
        ? "ops_confirming"
        : status === "design_in_progress"
          ? "design_in_progress"
          : status === "listing_confirming"
            ? "design_review"
          : status === "listed"
            ? "done"
            : status === "canceled" || status === "delisted" || status === "patent_risk"
              ? "blocked"
              : "selection_pending";
    const now = new Date();

    setDraft((current) => ({
      ...current,
      status,
      workflowStage: nextStage,
      workflowUpdatedAt: now.toISOString(),
      workflowDueAt: nextStage === "done" || nextStage === "blocked" ? "" : current.workflowDueAt || createWorkflowDueAt(now),
    }));
  }

  function updateAssigneeList(field: "opsAssignees" | "designerAssignees", values: string[]) {
    const normalized = Array.from(new Set(values.filter(Boolean)));

    setDraft((current) => ({
      ...current,
      [field]: normalized,
      ...(field === "opsAssignees" ? { opsAssignee: formatAssigneeList(normalized) } : { designerAssignee: formatAssigneeList(normalized) }),
    }));
  }

  function moveWorkflow(stage: ProductWorkflowStage, assigneeName: string, note: string) {
    const now = new Date();

    setDraft((current) => {
      const event = buildWorkflowEvent({
        stage,
        actorName: current.selectionOwner || creatorName,
        assigneeName,
        note,
        createdAt: now,
      });

      return {
        ...current,
        status:
          stage === "ops_confirming"
            ? "ops_review"
            : stage === "design_in_progress" || stage === "design_review"
              ? "design_in_progress"
              : stage === "done"
                ? "listed"
                : current.status,
        workflowStage: stage,
        workflowStartedAt: now.toISOString(),
        workflowUpdatedAt: now.toISOString(),
        workflowDueAt: stage === "done" || stage === "blocked" ? "" : createWorkflowDueAt(now),
        opsAssignees: selectedOps,
        opsAssignee: formatAssigneeList(selectedOps),
        designerAssignees: selectedDesigners,
        designerAssignee: formatAssigneeList(selectedDesigners),
        editableBy: stage === "ops_confirming" || stage === "design_in_progress" || stage === "design_review" ? selectedOps : [],
        viewableBy: [...selectedOps, ...selectedDesigners],
        workflowHistory: [event, ...(current.workflowHistory ?? [])].slice(0, 20),
      };
    });
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

    if (draft.status === "ops_review" && selectedOps.length === 0) {
      window.alert("状态为运营确认时，请至少选择一位运营负责人。");
      return;
    }

    if (draft.status === "design_in_progress" && selectedDesigners.length === 0) {
      window.alert("状态为美工处理中时，请至少选择一位美工负责人。");
      return;
    }

    const now = new Date();
    const normalizedStage = getProductWorkflowStage(draft);
    const workflowHistory = draft.workflowHistory?.length
      ? draft.workflowHistory
      : [
          buildWorkflowEvent({
            stage: normalizedStage,
            actorName: selectionOwner,
            assigneeName:
              normalizedStage === "ops_confirming"
                ? formatAssigneeList(selectedOps)
                : normalizedStage === "design_in_progress" || normalizedStage === "design_review"
                  ? formatAssigneeList(selectedDesigners)
                  : selectionOwner,
      note: "创建商品并进入业务流程。",
            createdAt: now,
          }),
        ];

    onSave({
      ...draft,
      sku: draft.sku.trim(),
      chineseName: draft.chineseName.trim(),
      englishName: draft.englishName.trim(),
      asin: draft.asin.trim().toUpperCase(),
      cancelReason: draft.cancelReason.trim(),
      competitorAsins: workbookDetail.competitors.map((competitor) => competitor.asin.trim().toUpperCase()).filter(Boolean),
      developer: "",
      selectionOwner,
      opsAssignees: selectedOps,
      opsAssignee: formatAssigneeList(selectedOps),
      designerAssignees: selectedDesigners,
      designerAssignee: formatAssigneeList(selectedDesigners),
      editableBy:
        normalizedStage === "ops_confirming" || normalizedStage === "design_in_progress" || normalizedStage === "design_review"
          ? selectedOps
          : [],
      viewableBy: [...selectedOps, ...selectedDesigners],
      workflowStage: normalizedStage,
      workflowStartedAt: draft.workflowStartedAt || now.toISOString(),
      workflowUpdatedAt: now.toISOString(),
      workflowDueAt:
        normalizedStage === "done" || normalizedStage === "blocked"
          ? ""
          : draft.workflowDueAt || createWorkflowDueAt(now),
      workflowHistory,
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
            {showListingActions ? (
              <>
                <Button variant="secondary" size="sm" onClick={() => setOperationsProgressOpen(true)}>
                  运营进度
                </Button>
                <Button variant="secondary" size="sm" onClick={() => setImageCopyGalleryOpen(true)}>
                  图片文案
                </Button>
              </>
            ) : null}
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
                    <span className="mt-1 text-xs text-muted">可上传 5-10 张，列表默认显示第一张。</span>
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
                      onChange={(event) => updateStatus(event.target.value as ProductStatus)}
                    >
                      {statusOptions.map((option) => (
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
                  <ReadonlyField label="选品负责人" value={selectionOwner || "--"} />
                  <MultiSelectField label="运营负责人" value={selectedOps} options={opsOptions} onChange={(value) => updateAssigneeList("opsAssignees", value)} />
                  <MultiSelectField label="美工负责人" value={selectedDesigners} options={designerOptions} onChange={(value) => updateAssigneeList("designerAssignees", value)} />
                  <ReadonlyField label="当前负责人" value={workflowAssignee || "--"} />
                  <ReadonlyField label="流程截止" value={formatWorkflowDate(draft.workflowDueAt)} />
                  <ReadonlyField label="创建日期（保存时生成）" value={draft.createdAt || "保存后自动生成"} />
                  <LabeledInput label="采购价格 CNY" type="number" value={String(draft.purchasePrice)} onChange={(value) => setField("purchasePrice", Number(value) || 0)} />
                  <div className="rounded-md border border-border bg-surface-muted px-3 py-3 md:col-span-2 xl:col-span-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-bold text-foreground">业务流转</p>
                        <p className="mt-1 text-xs text-muted">
                          {workflowOverdue ? "已超 3 天未处理，需要提醒当前负责人。" : "每次流转会自动生成 3 天处理期限。"}
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={selectedOps.length === 0}
                          onClick={() => moveWorkflow("ops_confirming", formatAssigneeList(selectedOps), "选品提交给运营确认。")} 
                        >
                          <ArrowRight className="h-4 w-4" />
                          交给运营
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={selectedDesigners.length === 0}
                          onClick={() => moveWorkflow("design_in_progress", formatAssigneeList(selectedDesigners), "运营转交给美工处理。")} 
                        >
                          <ArrowRight className="h-4 w-4" />
                          交给美工
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => moveWorkflow("done", workflowAssignee, "当前流程已完成。")}>
                        {workflowStage === "design_in_progress" || workflowStage === "design_review" ? (
                          <Button size="sm" variant="secondary" disabled={selectedOps.length === 0} onClick={() => moveWorkflow("ops_confirming", formatAssigneeList(selectedOps), "美工完成后转回运营。")}>
                            <ArrowRight className="h-4 w-4" />
                            转回运营
                          </Button>
                        ) : null}
                          <Save className="h-4 w-4" />
                          标记完成
                        </Button>
                      </div>
                    </div>
                    {workflowOverdue ? (
                      <div className="mt-3 flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">
                        <Bell className="h-4 w-4" />
                        当前阶段已超时，负责人：{workflowAssignee || "未分配"}
                      </div>
                    ) : null}
                  </div>
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

            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle>流程记录</CardTitle>
                <Badge tone={productWorkflowStageTones[workflowStage]}>{productWorkflowStageLabels[workflowStage]}</Badge>
              </CardHeader>
              <CardContent className="space-y-3">
                {(draft.workflowHistory ?? []).slice(0, 5).map((event) => (
                  <div key={event.id} className="rounded-md border border-border bg-white px-3 py-2 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-bold text-foreground">{event.stageLabel}</p>
                      <span className="text-xs text-muted">{formatWorkflowDate(event.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-xs text-muted">
                      {event.actorName ? `${event.actorName} 操作` : "系统记录"}
                      {event.assigneeName ? `，负责人 ${event.assigneeName}` : ""}
                      {event.note ? `。${event.note}` : ""}
                    </p>
                  </div>
                ))}
                {(draft.workflowHistory ?? []).length === 0 ? (
                  <div className="rounded-md border border-border bg-surface-muted px-3 py-4 text-center text-sm text-muted">
                    暂无流程记录，保存或点击流转按钮后会生成记录。
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </section>
        </div>
      </div>
      {operationsProgressOpen ? (
        <ProductOperationsProgress
          productName={draft.chineseName}
          value={draft.operationsProgress}
          currentUser={creatorName}
          defaultOwner={formatAssigneeList(selectedOps) || selectionOwner}
          onClose={() => setOperationsProgressOpen(false)}
          onApply={(operationsProgress) => {
            setDraft((current) => ({ ...current, operationsProgress }));
            setOperationsProgressOpen(false);
          }}
        />
      ) : null}
      {imageCopyGalleryOpen ? (
        <ProductImageCopyGalleryModal
          sku={draft.sku}
          productName={draft.chineseName}
          onClose={() => setImageCopyGalleryOpen(false)}
        />
      ) : null}
    </div>
  );
}

function SummaryTile({
  label,
  value,
  tone = "gray",
  active,
  detail,
  onClick,
}: {
  label: string;
  value: string;
  tone?: "gray" | "blue" | "green" | "amber" | "red";
  active?: boolean;
  detail?: string;
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
      className={`flex min-h-[116px] flex-col rounded-lg border bg-white p-4 text-left shadow-sm transition-colors hover:border-brand hover:bg-surface-muted ${
        active ? "border-brand ring-2 ring-brand/15" : "border-border"
      }`}
      onClick={onClick}
    >
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className={`mt-2 text-2xl font-black metric-tabular ${toneClass}`}>{value}</p>
      {detail ? <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted">{detail}</p> : null}
    </button>
  );
}

function formatSkuPreview(products: Product[], limit = 4) {
  const skus = products.map((product) => product.sku).filter(Boolean);
  if (!skus.length) return "暂无对应 SKU";

  const visible = skus.slice(0, limit).join("、");
  return skus.length > limit ? `SKU ${visible} 等 ${skus.length} 个` : `SKU ${visible}`;
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

function MultiSelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string[];
  options: string[];
  onChange: (value: string[]) => void;
}) {
  function toggle(option: string) {
    onChange(value.includes(option) ? value.filter((item) => item !== option) : [...value, option]);
  }

  return (
    <div className="text-xs font-semibold text-muted">
      <p>{label}</p>
      <div className="mt-1 min-h-10 rounded-md border border-border bg-white px-2 py-2">
        {options.length ? (
          <div className="flex flex-wrap gap-2">
            {options.map((option) => {
              const checked = value.includes(option);

              return (
                <label key={option} className={`flex h-7 items-center gap-1 rounded-md border px-2 text-xs ${checked ? "border-brand bg-brand/10 text-brand" : "border-border text-muted"}`}>
                  <input checked={checked} className="h-3.5 w-3.5 accent-brand" type="checkbox" onChange={() => toggle(option)} />
                  {option}
                </label>
              );
            })}
          </div>
        ) : (
          <p className="py-1 text-xs text-muted">暂无可选账号，请先到账号管理创建对应角色。</p>
        )}
      </div>
    </div>
  );
}

async function loadTeamAccountsFromApi() {
  try {
    const response = await fetch("/api/accounts/team-members");
    if (!response.ok) return [];

    const data = (await response.json()) as { accounts?: unknown };
    return normalizeTeamAccounts(data.accounts);
  } catch {
    return [];
  }
}

function loadTeamAccountsFromLocalStorage() {
  try {
    const saved = window.localStorage.getItem(accountRosterStorageKey);
    if (!saved) return defaultTeamAccounts;

    const accounts = normalizeTeamAccounts(JSON.parse(saved));
    return accounts.length ? accounts : defaultTeamAccounts;
  } catch {
    return defaultTeamAccounts;
  }
}

function mergeTeamAccounts(...groups: TeamAccountRecord[][]) {
  const merged = new Map<string, TeamAccountRecord>();

  groups.flat().forEach((account) => {
    merged.set(account.id, account);
  });

  return Array.from(merged.values());
}

function getTeamMemberOptions(members: TeamMember[], roles: ProductWorkflowRole[]) {
  return filterTeamMembersByRoles(members, roles).map((member) => member.name);
}

function getAccountNameOptionsByRoleIds(accounts: TeamAccountRecord[], roleIds: AccountRoleId[]) {
  const roleSet = new Set<AccountRoleId>(roleIds);
  const names = accounts.filter((account) => account.status !== "disabled" && roleSet.has(account.roleId)).map((account) => account.name.trim()).filter(Boolean);

  return Array.from(new Set(names));
}

function normalizeFilterNames(values: string[]) {
  return values.map((value) => value.trim().toLowerCase()).filter(Boolean);
}

function matchesAnyName(productNames: string[], selectedNames: string[]) {
  return selectedNames.some((selectedName) => productNames.some((productName) => productName.includes(selectedName)));
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
            {option} 条 / 页
          </option>
        ))}
      </select>
    </div>
  );
}

