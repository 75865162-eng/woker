"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Bell, ChevronDown, FileDown, FileUp, History, ImagePlus, LoaderCircle, PackagePlus, RotateCcw, Save, Search, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { newProductStatusOptions, productStatusLabels, productStatusOptions } from "@/data/products";
import {
  accountsToTeamMembers,
  type AccountRoleId,
  filterTeamMembersByRoles,
  normalizeTeamAccounts,
  type TeamAccountRecord,
  type TeamMember,
} from "@/lib/accounts/team-roster";
import type { Product, ProductDraft, ProductStatus, ProductWorkflowEvent, ProductWorkflowRole, ProductWorkflowStage } from "@/lib/products/types";
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
  canChangeDelistedProductStatus,
  canEditOperationsConfirmingProduct,
  getOperationsConfirmingEditors,
  getProductEditRestriction,
  type ProductEditUser,
} from "@/lib/products/product-edit-access";
import { addWorkspaceScopeToFormData, scopedFetch } from "@/lib/workspace/scoped-fetch";

import {
  initialFilters,
  pageSizeOptions,
  scalarImprovementFields,
  supplierFields,
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
  calculateTrialPricing,
  formatDateTime,
  isOverdueProduct,
} from "./product-workbench-utils";
import {
  createTrialProductDraft,
  exportProductsToCommodityCreateWorkbook,
  productToDraft,
  trialImprovementLabels,
} from "./product-workbench-data";

function isProductOverdueForHandling(product: Product) {
  return isOverdueProduct(product) || isProductWorkflowOverdue(product);
}

type ProductImportJob = {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  progress: number;
  error?: string | null;
};

export function ProductWorkbench() {
  const [products, setProducts] = useState<Product[]>([]);
  const [, setTrialProducts] = useState<TrialProductDraft[]>([]);
  const [filters, setFilters] = useState<ProductFilters>(initialFilters);
  const [activeProductId, setActiveProductId] = useState<string | null>(null);
  const [isEditorOpen, setIsEditorOpen] = useState(false);
  const [isTrialEditorOpen, setIsTrialEditorOpen] = useState(false);
  const [isActivityLogOpen, setIsActivityLogOpen] = useState(false);
  const [versionProduct, setVersionProduct] = useState<Product | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [productsTotalCount, setProductsTotalCount] = useState(0);
  const [activityLog, setActivityLog] = useState<string[]>(["产品工作台已连接数据库"]);
  const [productsLoading, setProductsLoading] = useState(true);
  const [productsError, setProductsError] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importStatus, setImportStatus] = useState("");
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const [teamAccounts, setTeamAccounts] = useState<TeamAccountRecord[]>([]);
  const [currentUser, setCurrentUser] = useState<ProductEditUser | null>(null);
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
      .then((data: { user?: ProductEditUser } | null) => {
        setCurrentUser(data?.user ?? null);
        if (data?.user?.name) {
          setCreatorName(data.user.name);
        }
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    let canceled = false;

    async function loadTeamAccounts() {
      const apiAccounts = await loadTeamAccountsFromApi();
      if (canceled) return;

      setTeamAccounts(apiAccounts);
    }

    void loadTeamAccounts();

    return () => {
      canceled = true;
    };
  }, []);

  useEffect(() => {
    let canceled = false;

    async function loadProducts() {
      setProductsLoading(true);
      setProductsError("");

      try {
        const response = await scopedFetch(buildProductsApiPath(page, pageSize, filters), { cache: "no-store" });
        const data = (await response.json()) as { products?: Product[]; pagination?: { total?: number; pageCount?: number }; error?: string };

        if (!response.ok) {
          throw new Error(data.error || "商品数据读取失败");
        }

        if (!canceled) {
          setProducts(Array.isArray(data.products) ? data.products : []);
          setProductsTotalCount(data.pagination?.total ?? 0);
          setActivityLog((current) => ["已从数据库读取商品数据", ...current].slice(0, 8));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "商品数据读取失败";
        if (!canceled) {
          setProductsError(message);
          setActivityLog((current) => [`商品数据读取失败：${message}`, ...current].slice(0, 8));
        }
      } finally {
        if (!canceled) {
          setProductsLoading(false);
        }
      }
    }

    void loadProducts();

    return () => {
      canceled = true;
    };
  }, [filters, page, pageSize]);

  async function reloadProducts() {
    setProductsLoading(true);
    setProductsError("");

    try {
      const response = await scopedFetch(buildProductsApiPath(page, pageSize, filters), { cache: "no-store" });
      const data = (await response.json()) as { products?: Product[]; pagination?: { total?: number; pageCount?: number }; error?: string };

      if (!response.ok) {
        throw new Error(data.error || "商品数据读取失败");
      }

      setProducts(Array.isArray(data.products) ? data.products : []);
      setProductsTotalCount(data.pagination?.total ?? 0);
    } catch (error) {
      setProductsError(error instanceof Error ? error.message : "商品数据读取失败");
    } finally {
      setProductsLoading(false);
    }
  }

  const visibleProducts = products;
  const pageCount = Math.max(1, Math.ceil(productsTotalCount / pageSize));
  const activeProduct = products.find((product) => product.id === activeProductId) ?? null;

  useEffect(() => {
    setPage(1);
  }, [filters, pageSize]);

  useEffect(() => {
    if (page > pageCount) {
      setPage(pageCount);
    }
  }, [page, pageCount]);

  const developingCount = filters.status === "developing" ? productsTotalCount : products.filter((product) => product.status === "developing").length;
  const opsReviewCount = filters.status === "ops_review" ? productsTotalCount : products.filter((product) => product.status === "ops_review").length;
  const designInProgressProducts = products.filter((product) => product.status === "design_in_progress");
  const operationsProgressProducts = products.filter((product) => hasIncompleteOperationsProgress(product.operationsProgress));
  const overdueCount = filters.status === "overdue" ? productsTotalCount : products.filter(isProductOverdueForHandling).length;

  function openNewProduct() {
    setActiveProductId(null);
    setIsEditorOpen(true);
  }

  function openProduct(productId: string) {
    setActiveProductId(productId);
    setIsEditorOpen(true);
  }

  async function persistProduct(product: Product) {
    const response = await scopedFetch("/api/products", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ product }),
    });
    const data = (await response.json()) as { product?: Product; error?: string };

    if (!response.ok || !data.product) {
      throw new Error(data.error || "商品保存失败");
    }

    return data.product;
  }

  async function handleSaveProduct(draft: ProductDraft) {
    const existing = draft.id ? products.find((product) => product.id === draft.id) : null;
    const normalizedStatus = existing || newProductStatusValues.has(draft.status) ? draft.status : "pending";
    const nextProduct: Product = {
      ...draft,
      status: normalizedStatus,
      id: existing?.id ?? `prod-${draft.sku}`,
      sku: existing?.sku ?? draft.sku,
      createdAt: existing?.createdAt ?? formatDateTime(new Date()),
    };

    try {
      const savedProduct = await persistProduct(nextProduct);
      setProducts((current) => {
        if (existing) {
          return current.map((product) => (product.id === existing.id ? savedProduct : product));
        }

        return [savedProduct, ...current];
      });
      setActiveProductId(savedProduct.id);
      setIsEditorOpen(false);
      setActivityLog((current) => [`${existing ? "保存" : "新增"}商品 ${savedProduct.sku} 到数据库`, ...current].slice(0, 8));
    } catch (error) {
      const message = error instanceof Error ? error.message : "商品保存失败";
      window.alert(message);
      setActivityLog((current) => [`商品保存失败：${message}`, ...current].slice(0, 8));
    }
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

  async function waitForProductImportJob(jobId: string) {
    const startedAt = Date.now();

    while (Date.now() - startedAt < 10 * 60_000) {
      const response = await scopedFetch(`/api/jobs/${jobId}`, { cache: "no-store" });
      const data = (await response.json().catch(() => ({}))) as { job?: ProductImportJob; error?: string };

      if (!response.ok || !data.job) {
        throw new Error(data.error || "商品导入任务状态读取失败");
      }

      if (data.job.status === "done") {
        return data.job;
      }

      if (data.job.status === "failed") {
        throw new Error(data.job.error || "商品导入任务失败");
      }

      const statusLabel = data.job.status === "queued" ? "已排队，等待后台处理" : "正在导入商品数据";
      const status = `${statusLabel}（${data.job.progress}%）`;
      setImportStatus(status);
      setActivityLog((current) => [`商品导入${status}`, ...current].slice(0, 8));
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
    }

    throw new Error("商品导入任务仍在处理中，请到任务中心查看进度，或稍后刷新商品列表。");
  }

  async function handleImportFile(file: File | undefined) {
    if (!file) {
      return;
    }

    setIsImporting(true);
    setImportStatus(`正在上传 ${file.name}`);

    try {
      const formData = new FormData();
      formData.set("file", file);
      formData.set("type", "product_commodity_import");
      addWorkspaceScopeToFormData(formData);

      const response = await scopedFetch("/api/files/upload", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as { job?: ProductImportJob; error?: string };

      const job = data.job;

      if (!response.ok || !job) {
        throw new Error(data.error || "导入任务创建失败");
      }

      setActivityLog((current) => [`已创建商品导入任务 ${job.id}：${file.name}`, ...current].slice(0, 8));
      const completedJob = job.status === "done" ? job : await waitForProductImportJob(job.id);
      await reloadProducts();
      setImportStatus(completedJob.error || `${file.name} 导入完成`);
      setActivityLog((current) => [`商品导入完成：${completedJob.error || file.name}`, ...current].slice(0, 8));
    } catch (error) {
      const message = error instanceof Error ? error.message : "导入失败";
      setImportStatus(`导入失败：${message}`);
      window.alert(message);
      setActivityLog((current) => [`导入失败：${message}`, ...current].slice(0, 8));
    } finally {
      setIsImporting(false);
    }
  }

  async function handleExportProducts() {
    if (!visibleProducts.length) {
      window.alert("当前没有可导出的商品。");
      return;
    }

    try {
      await exportProductsToCommodityCreateWorkbook(visibleProducts);
      setActivityLog((current) => [`已按商品创建模板导出当前页 ${visibleProducts.length} 个商品`, ...current].slice(0, 8));
    } catch (error) {
      const message = error instanceof Error ? error.message : "导出失败";
      window.alert(message);
      setActivityLog((current) => [`导出失败：${message}`, ...current].slice(0, 8));
    }
  }

  return (
    <>
      <div className="space-y-5">
        {productsError ? (
          <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{productsError}</div>
        ) : null}
        {importStatus ? (
          <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700" role="status">
            {importStatus}
          </div>
        ) : null}
        {productsLoading ? (
          <div className="rounded-md border border-border bg-white px-4 py-3 text-sm font-semibold text-muted">正在从数据库读取商品数据...</div>
        ) : null}
        <section className="grid grid-cols-[repeat(auto-fit,128px)] justify-start gap-2">
          <SummaryTile
            label="全部商品"
            value={productsTotalCount.toLocaleString("zh-CN")}
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
            onClick={() => setFilters((current) => ({ ...current, status: "design_in_progress" }))}
          />
          <SummaryTile
            label="运营进程"
            value={operationsProgressProducts.length.toLocaleString("zh-CN")}
            tone="amber"
            active={filters.status === "operations_progress"}
            onClick={() => setFilters((current) => ({ ...current, status: "operations_progress" }))}
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
              <Button variant="secondary" size="sm" disabled={isImporting} onClick={() => importInputRef.current?.click()}>
                {isImporting ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                {isImporting ? "导入中" : "导入数据"}
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void handleExportProducts()}>
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
            <ProductTable products={visibleProducts} totalCount={productsTotalCount} onOpenProduct={openProduct} onOpenHistory={setVersionProduct} />
            <Pagination page={page} pageCount={pageCount} pageSize={pageSize} pageSizeOptions={pageSizeOptions} onPageChange={setPage} onPageSizeChange={setPageSize} />
          </CardContent>
        </Card>

        {isActivityLogOpen ? (
          <ActivityLogModal entries={activityLog} onClose={() => setIsActivityLogOpen(false)} />
        ) : null}

        {versionProduct ? (
          <ProductVersionModal
            product={versionProduct}
            onClose={() => setVersionProduct(null)}
            onRestored={() => {
              void reloadProducts();
              setActivityLog((current) => [`已恢复商品 ${versionProduct.sku} 的历史版本`, ...current].slice(0, 8));
            }}
          />
        ) : null}

        {isEditorOpen ? (
          <ProductEditor
            product={activeProduct}
            products={products}
            creatorName={creatorName}
            currentUser={currentUser}
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

type ProductVersionRecord = {
  id: string;
  version: number;
  action: string;
  summary?: string | null;
  createdAt: string;
  userId?: string | null;
  payload?: Product;
};

const trialPricingHeaders = [
  { label: "品名", widthClass: "w-[140px] min-w-[140px] max-w-[140px]" },
  { label: <>长<br />（cm）</>, widthClass: "w-[45px] min-w-[45px] max-w-[45px]" },
  { label: <>宽<br />（cm）</>, widthClass: "w-[45px] min-w-[45px] max-w-[45px]" },
  { label: <>高<br />（cm）</>, widthClass: "w-[45px] min-w-[45px] max-w-[45px]" },
  { label: <>实际重<br />（Kg）</>, widthClass: "w-[70px] min-w-[70px] max-w-[70px]" },
  { label: <>材积重<br />（Kg）</>, widthClass: "w-[68px] min-w-[68px] max-w-[68px]" },
  { label: "建议售价(USD)", widthClass: "w-[78px] min-w-[78px] max-w-[78px]" },
  { label: "采购成本(RMB)", widthClass: "w-[82px] min-w-[82px] max-w-[82px]" },
  { label: <>FBA配送费<br />(USD)</>, widthClass: "w-[68px] min-w-[68px] max-w-[68px]" },
  { label: <>3.5%燃油<br />附加费（USD)</>, widthClass: "w-[35px] min-w-[35px] max-w-[35px]" },
  { label: <>海运价<br />（RMB）</>, widthClass: "w-[45px] min-w-[45px] max-w-[45px]" },
  { label: "海运头程(RMB)", widthClass: "w-[86px] min-w-[86px] max-w-[86px]" },
  { label: <>佣金<br />(USD)</>, widthClass: "w-[68px] min-w-[68px] max-w-[68px]" },
  { label: "月仓储费(USD)", widthClass: "w-[82px] min-w-[82px] max-w-[82px]" },
  { label: "汇率", widthClass: "w-[62px] min-w-[62px] max-w-[62px]" },
  { label: <>保本价<br />(USD)</>, widthClass: "w-[80px] min-w-[80px] max-w-[80px]" },
  { label: "海运毛利(USD)", widthClass: "w-[92px] min-w-[92px] max-w-[92px]" },
  { label: "海运毛利率", widthClass: "w-[82px] min-w-[82px] max-w-[82px]" },
  { label: "体积重量/", widthClass: "w-[78px] min-w-[78px] max-w-[78px]" },
  { label: "重量/", widthClass: "w-[70px] min-w-[70px] max-w-[70px]" },
];

const trialPricingDimensionCellClass = "w-[45px] min-w-[45px] max-w-[45px] px-1 py-2 [&_input]:w-[45px] [&_input]:min-w-[45px] [&_input]:px-1";
const trialPricingOceanPriceCellClass = "w-[45px] min-w-[45px] max-w-[45px] px-1 py-2 [&_input]:w-[45px] [&_input]:min-w-[45px] [&_input]:px-1";

type ProductVersionDiffRow = {
  key: string;
  label: string;
  currentValue: string;
  versionValue: string;
  changed: boolean;
};

const productVersionFieldLabels: Record<string, string> = {
  sku: "SKU",
  chineseName: "中文名",
  englishName: "英文名",
  asin: "ASIN",
  developer: "开发",
  purchasePrice: "采购价格",
  status: "状态",
  supplierName: "供应商名称",
  supplierUrl: "供应商链接",
  specs: "规格",
  purchaseLeadTime: "采购周期",
  createdAt: "创建日期",
  keywords: "选品关键词",
  note: "备注",
  cancelReason: "取消原因",
  hsCode: "HSCODE",
  images: "图片",
  competitorAsins: "竞品 ASIN",
  productWeightG: "产品重量(g)",
  packageWeightG: "包装重量(g)",
  productSizeCm: "产品尺寸(cm)",
  packageSizeCm: "包装尺寸(cm)",
  selectionOwner: "选品负责人",
  opsAssignee: "运营",
  opsAssignees: "运营",
  designerAssignee: "美工",
  designerAssignees: "美工",
  editableBy: "可编辑人",
  viewableBy: "可查看人",
  workflowStage: "流程阶段",
  workflowStartedAt: "流程开始",
  workflowDueAt: "流程截止",
  workflowUpdatedAt: "流程更新",
  workflowReminderAt: "流程提醒",
  workflowHistory: "流程记录",
  operationsProgress: "运营进程",
  sourceWorkbook: "导入源文件",
};

const productVersionFieldOrder = Object.keys(productVersionFieldLabels);

function ProductVersionModal({
  product,
  onClose,
  onRestored,
}: {
  product: Product;
  onClose: () => void;
  onRestored: () => void;
}) {
  const [versions, setVersions] = useState<ProductVersionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [selectedVersion, setSelectedVersion] = useState<ProductVersionRecord | null>(null);

  const loadVersions = useCallback(async () => {
    setLoading(true);
    setError("");

    try {
      const params = new URLSearchParams({
        entityType: "product",
        entityId: product.sku,
        pageSize: "50",
      });
      const response = await scopedFetch(`/api/audit/versions?${params.toString()}`, { cache: "no-store" });
      const data = (await response.json()) as { versions?: ProductVersionRecord[]; error?: string };

      if (!response.ok) {
        throw new Error(data.error || "版本历史读取失败。");
      }

      setVersions(Array.isArray(data.versions) ? data.versions : []);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "版本历史读取失败。");
    } finally {
      setLoading(false);
    }
  }, [product.sku]);

  async function restoreVersion(version: ProductVersionRecord) {
    setBusyId(version.id);
    setError("");

    try {
      const response = await scopedFetch("/api/audit/versions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ versionId: version.id }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: string };

      if (!response.ok) {
        throw new Error(data.error || "版本恢复失败。");
      }

      onRestored();
      setSelectedVersion(null);
      await loadVersions();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "版本恢复失败。");
    } finally {
      setBusyId("");
    }
  }

  useEffect(() => {
    void loadVersions();
  }, [loadVersions]);

  const selectedDiffRows = useMemo(
    () => (selectedVersion?.payload ? buildProductVersionDiffRows(product, selectedVersion.payload) : []),
    [product, selectedVersion],
  );
  const changedDiffRows = selectedDiffRows.filter((row) => row.changed);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/40 p-6 backdrop-blur-sm">
      <div className="flex max-h-[82vh] w-full max-w-3xl flex-col rounded-lg bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h3 className="text-lg font-bold text-foreground">版本历史：{product.sku}</h3>
            <p className="mt-1 text-xs font-semibold text-muted">{product.chineseName || product.englishName || "未命名商品"}</p>
          </div>
          <Button variant="secondary" size="sm" onClick={onClose}>
            <X className="h-4 w-4" />
            关闭
          </Button>
        </div>
        <div className="thin-scrollbar flex-1 space-y-3 overflow-y-auto p-5">
          {error ? <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</div> : null}
          {loading ? <div className="rounded-md border border-border bg-surface-muted px-3 py-2 text-sm font-semibold text-muted">正在读取版本历史...</div> : null}
          {versions.map((version) => (
            <div key={version.id} className="flex items-center justify-between gap-3 rounded-md border border-border bg-surface-muted px-3 py-3">
              <div className="min-w-0">
                <button type="button" className="block max-w-full text-left text-sm font-bold text-brand hover:text-brand-dark" onClick={() => setSelectedVersion(version)}>
                  版本 {version.version} · {version.action}
                </button>
                <p className="mt-1 truncate text-xs font-medium text-muted">{version.summary || "无摘要"} · {new Date(version.createdAt).toLocaleString("zh-CN", { hour12: false })}</p>
              </div>
              <Button size="sm" variant="secondary" onClick={() => setSelectedVersion(version)} disabled={Boolean(busyId)}>
                查看详情
              </Button>
            </div>
          ))}
          {!loading && versions.length === 0 ? (
            <p className="rounded-md border border-border bg-surface-muted px-3 py-8 text-center text-sm font-medium text-muted">这个商品还没有版本记录。</p>
          ) : null}
        </div>
      </div>
      {selectedVersion ? (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-foreground/45 p-6 backdrop-blur-sm">
          <div className="flex max-h-[86vh] w-full max-w-5xl flex-col rounded-lg bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <div>
                <h3 className="text-lg font-bold text-foreground">版本 {selectedVersion.version} · {selectedVersion.action}</h3>
                <p className="mt-1 text-xs font-semibold text-muted">
                  {selectedVersion.summary || "无摘要"} · {new Date(selectedVersion.createdAt).toLocaleString("zh-CN", { hour12: false })}
                </p>
              </div>
              <Button variant="secondary" size="sm" onClick={() => setSelectedVersion(null)}>
                <X className="h-4 w-4" />
                关闭
              </Button>
            </div>
            <div className="thin-scrollbar flex-1 overflow-auto p-5">
              {selectedVersion.payload ? (
                <div className="space-y-4">
                  <div className="rounded-md border border-border bg-surface-muted px-3 py-2 text-sm font-semibold text-muted">
                    当前商品与该版本快照共有 {changedDiffRows.length} 个字段不同。恢复后会用该版本快照覆盖当前商品资料。
                  </div>
                  <table className="w-full table-fixed text-left text-sm">
                    <thead className="bg-surface-muted text-xs text-muted">
                      <tr>
                        <th className="w-[160px] px-3 py-2">字段</th>
                        <th className="px-3 py-2">当前值</th>
                        <th className="px-3 py-2">版本值</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(changedDiffRows.length ? changedDiffRows : selectedDiffRows).map((row) => (
                        <tr key={row.key} className="border-t border-border align-top">
                          <td className="px-3 py-3 font-bold text-foreground">{row.label}</td>
                          <td className="px-3 py-3 text-muted">
                            <pre className="whitespace-pre-wrap break-words font-sans">{row.currentValue}</pre>
                          </td>
                          <td className="px-3 py-3 text-foreground">
                            <pre className="whitespace-pre-wrap break-words font-sans">{row.versionValue}</pre>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {changedDiffRows.length === 0 ? (
                    <p className="rounded-md border border-border bg-surface-muted px-3 py-8 text-center text-sm font-medium text-muted">这个版本和当前商品没有可展示差异。</p>
                  ) : null}
                </div>
              ) : (
                <p className="rounded-md border border-border bg-surface-muted px-3 py-8 text-center text-sm font-medium text-muted">这个版本没有可读取的快照内容。</p>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
              <Button variant="secondary" size="sm" onClick={() => setSelectedVersion(null)}>
                取消
              </Button>
              <Button size="sm" onClick={() => void restoreVersion(selectedVersion)} disabled={Boolean(busyId) || !selectedVersion.payload}>
                <RotateCcw className="h-4 w-4" />
                {busyId === selectedVersion.id ? "恢复中" : "恢复到此版本"}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function buildProductVersionDiffRows(currentProduct: Product, versionProduct: Product): ProductVersionDiffRow[] {
  const extraKeys = Object.keys(versionProduct).filter((key) => !productVersionFieldLabels[key]);
  const keys = [...productVersionFieldOrder, ...extraKeys].filter((key) => key in currentProduct || key in versionProduct);

  return keys.map((key) => {
    const currentValue = (currentProduct as unknown as Record<string, unknown>)[key];
    const versionValue = (versionProduct as unknown as Record<string, unknown>)[key];

    return {
      key,
      label: productVersionFieldLabels[key] ?? key,
      currentValue: formatProductVersionValue(key, currentValue),
      versionValue: formatProductVersionValue(key, versionValue),
      changed: stableProductVersionValue(currentValue) !== stableProductVersionValue(versionValue),
    };
  });
}

function formatProductVersionValue(key: string, value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "--";
  }

  if (key === "status" && typeof value === "string" && value in productStatusLabels) {
    return productStatusLabels[value as ProductStatus];
  }

  if (key === "workflowStage" && typeof value === "string" && value in productWorkflowStageLabels) {
    return productWorkflowStageLabels[value as ProductWorkflowStage];
  }

  if (Array.isArray(value)) {
    return value.length ? value.map((item) => formatProductVersionNestedValue(item)).join("\n") : "--";
  }

  if (typeof value === "object") {
    if (key === "sourceWorkbook" && "importedFileName" in value && typeof value.importedFileName === "string") {
      return value.importedFileName;
    }

    return JSON.stringify(value, null, 2);
  }

  return String(value);
}

function formatProductVersionNestedValue(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "--";
  }

  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function stableProductVersionValue(value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "";
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => stableProductVersionValue(item)).join(",")}]`;
  }

  if (typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey))
      .map(([key, nestedValue]) => `${JSON.stringify(key)}:${stableProductVersionValue(nestedValue)}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
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

  function updateImprovement(field: Exclude<keyof TrialImprovement, "rows" | "peakSeasonWeights">, value: string) {
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
              <table className="w-max table-fixed text-left text-xs">
                <colgroup>
                  {trialPricingHeaders.map((header, index) => (
                    <col key={index} className={header.widthClass} />
                  ))}
                </colgroup>
                <thead className="bg-surface-muted text-muted">
                  <tr>
                    {trialPricingHeaders.map((header, index) => (
                      <th key={index} className="px-1 py-2 text-center font-bold leading-tight">
                        {header.label}
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
                        <td className={trialPricingDimensionCellClass}><SmallInput compact type="number" value={row.lengthCm} onChange={(value) => updatePricingRow(index, "lengthCm", value)} /></td>
                        <td className={trialPricingDimensionCellClass}><SmallInput compact type="number" value={row.widthCm} onChange={(value) => updatePricingRow(index, "widthCm", value)} /></td>
                        <td className={trialPricingDimensionCellClass}><SmallInput compact type="number" value={row.heightCm} onChange={(value) => updatePricingRow(index, "heightCm", value)} /></td>
                        <td className="px-2 py-2"><SmallInput compact type="number" value={row.actualWeightKg} onChange={(value) => updatePricingRow(index, "actualWeightKg", value)} /></td>
                        <ReadonlyMetric value={calc.volumeWeightKg} />
                        <td className="px-2 py-2"><SmallInput compact type="number" value={row.suggestedPrice} onChange={(value) => updatePricingRow(index, "suggestedPrice", value)} /></td>
                        <td className="px-2 py-2"><SmallInput compact type="number" value={row.purchaseCost} onChange={(value) => updatePricingRow(index, "purchaseCost", value)} /></td>
                        <td className="px-2 py-2"><SmallInput compact type="number" value={row.fbaFee} onChange={(value) => updatePricingRow(index, "fbaFee", value)} /></td>
                        <ReadonlyMetric value={calc.fuelFee} className="w-[35px] min-w-[35px] max-w-[35px] px-1 text-center" />
                        <td className={trialPricingOceanPriceCellClass}><SmallInput compact type="number" value={row.oceanFreightUnitPrice} onChange={(value) => updatePricingRow(index, "oceanFreightUnitPrice", value)} /></td>
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
                    {["供应商产品链接", "厂家名称", "配置", "起订量", "交期", "国内物流费", "相关认证", "专利国家", "产品包装方式", "采购单价", "报价（100-500套）", "开票信息", "备注"].map((label) => (
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
            <CardContent className="space-y-4">
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {scalarImprovementFields.map((field) => (
                  <LabeledInput key={field} label={trialImprovementLabels[field]} value={draft.improvement[field]} onChange={(value) => updateImprovement(field, value)} />
                ))}
              </div>
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
  currentUser,
  opsOptions,
  designerOptions,
  onClose,
  onSave,
}: {
  product: Product | null;
  products: Product[];
  creatorName: string;
  currentUser: ProductEditUser | null;
  opsOptions: string[];
  designerOptions: string[];
  onClose: () => void;
  onSave: (draft: ProductDraft) => void;
}) {
  const [draft, setDraft] = useState<ProductEditorDraft>(() => productToDraft(product, products));
  const [operationsProgressOpen, setOperationsProgressOpen] = useState(false);
  const [imageCopyGalleryOpen, setImageCopyGalleryOpen] = useState(false);

  const isEditing = Boolean(product);
  const workbookDetail = draft.workbookDetail;
  const workflowStage = getProductWorkflowStage(draft);
  const workflowAssignee = getCurrentWorkflowAssignee(draft);
  const workflowOverdue = isProductWorkflowOverdue(draft);
  const selectionOwner = draft.selectionOwner || (isEditing ? product?.selectionOwner : creatorName) || creatorName;
  const selectedOps = normalizeAssigneeList(draft.opsAssignee, draft.opsAssignees);
  const selectedDesigners = normalizeAssigneeList(draft.designerAssignee, draft.designerAssignees);
  const canEditOpsConfirming = !product || product.status !== "ops_review" || canEditOperationsConfirmingProduct(product, currentUser);
  const statusChangeLocked = Boolean(product?.status === "delisted" && !canChangeDelistedProductStatus(currentUser));
  const opsConfirmingEditors = product?.status === "ops_review" ? getOperationsConfirmingEditors(product) : [];
  const editorRestrictionMessage = !canEditOpsConfirming
    ? `运营确认中的商品只能由 ${opsConfirmingEditors.join("、") || "当前转交运营"}、主管或管理员编辑。`
    : "";
  const showListingActions =
    draft.status === "listing_confirming" ||
    draft.status === "listed" ||
    draft.status === "design_in_progress" ||
    draft.status === "delisted" ||
    draft.status === "patent_risk";
  const statusOptions = isEditing ? productStatusOptions : newProductStatusOptions;

  function setField<K extends keyof ProductDraft>(field: K, value: ProductDraft[K]) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function updateStatus(status: ProductStatus) {
    if (statusChangeLocked) {
      window.alert("已下架 SKU 的状态只能由主管或管理员更改。");
      return;
    }

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
    const normalized = normalizeAssigneeList(undefined, values);

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
        actorName: getCurrentWorkflowAssignee(current) || current.selectionOwner || creatorName,
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

  function updateWorkbookImprovement(field: Exclude<keyof TrialImprovement, "rows" | "peakSeasonWeights">, value: string) {
    setWorkbookDetail((current) => ({ ...current, improvement: { ...current.improvement, [field]: value } }));
  }

  function updateWorkbookPeakSeasonWeights(value: number[]) {
    setWorkbookDetail((current) => ({
      ...current,
      improvement: { ...current.improvement, peakSeasonWeights: value },
    }));
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
    const editRestriction = product ? getProductEditRestriction(product, draft as Product, currentUser) : "";

    if (editRestriction) {
      window.alert(editRestriction);
      return;
    }

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
            {editorRestrictionMessage ? <p className="mt-1 text-xs font-semibold text-danger">{editorRestrictionMessage}</p> : null}
            {statusChangeLocked ? <p className="mt-1 text-xs font-semibold text-amber-700">已下架 SKU 的状态只能由主管或管理员更改。</p> : null}
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
            <Button size="sm" disabled={!canEditOpsConfirming} onClick={handleSubmit}>
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
                  <label className="text-xs font-semibold text-muted">
                    状态
                    <select
                      className="mt-1 h-10 w-full rounded-md border border-border bg-white px-3 text-sm text-foreground outline-none focus:border-brand"
                      value={draft.status}
                      disabled={statusChangeLocked}
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
                  <ReadonlyField label="选品" value={selectionOwner || "--"} />
                  <MultiSelectField label="运营" value={selectedOps} options={opsOptions} onChange={(value) => updateAssigneeList("opsAssignees", value)} />
                  <MultiSelectField label="美工" value={selectedDesigners} options={designerOptions} onChange={(value) => updateAssigneeList("designerAssignees", value)} />
                  <ReadonlyField label="当前负责人" value={workflowAssignee || "--"} />
                  <LabeledInput label="采购价格 CNY" type="number" value={String(draft.purchasePrice)} onChange={(value) => setField("purchasePrice", Number(value) || 0)} />
                  <div className="rounded-md border border-border bg-surface-muted px-3 py-3 md:col-span-2 xl:col-span-3">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-sm font-bold text-foreground">业务流转</p>
                          <Badge tone={productWorkflowStageTones[workflowStage]}>{productWorkflowStageLabels[workflowStage]}</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted">
                          当前负责人：{workflowAssignee || "未分配"}；流程截止：{formatWorkflowDate(draft.workflowDueAt)}
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
                        {workflowStage === "design_in_progress" || workflowStage === "design_review" ? (
                          <Button size="sm" variant="secondary" disabled={selectedOps.length === 0} onClick={() => moveWorkflow("ops_confirming", formatAssigneeList(selectedOps), "美工完成后转回运营。")}>
                            <ArrowRight className="h-4 w-4" />
                            转回运营
                          </Button>
                        ) : null}
                        <Button size="sm" variant="secondary" onClick={() => moveWorkflow("done", workflowAssignee, "当前流程已完成。")}>
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
                    <div className="mt-2 space-y-1.5">
                      {(draft.workflowHistory ?? []).slice(0, 5).map((event) => (
                        <WorkflowHistoryItem key={event.id} event={event} />
                      ))}
                      {(draft.workflowHistory ?? []).length === 0 ? (
                        <div className="rounded-md border border-border bg-white px-3 py-3 text-center text-sm text-muted">
                          暂无流程记录，保存或点击流转按钮后会生成记录。
                        </div>
                      ) : null}
                    </div>
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
              onPeakSeasonWeightsChange={updateWorkbookPeakSeasonWeights}
              onImprovementRowChange={updateWorkbookImprovementRow}
              onKeywordChange={updateWorkbookKeyword}
              onKeywordsReplace={replaceWorkbookKeywords}
              onRemarkChange={(value) => setWorkbookDetail((current) => ({ ...current, remark: value }))}
              onRemarkImagesChange={updateWorkbookRemarkImages}
            />

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
          initialMineInfo={{ asin: draft.asin }}
          onClose={() => setImageCopyGalleryOpen(false)}
        />
      ) : null}
    </div>
  );
}

function WorkflowHistoryItem({ event }: { event: ProductWorkflowEvent }) {
  const noteText = event.note ? `；${event.note}` : "";

  return (
    <div className="flex min-h-9 items-center justify-between gap-3 rounded-md border border-border bg-white px-3 py-1.5 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 font-bold text-foreground">{event.stageLabel}</span>
        <span className="truncate text-muted">
          {formatWorkflowTransferText(event)}
          {noteText}
        </span>
      </div>
      <span className="shrink-0 text-muted">{formatWorkflowDate(event.createdAt)}</span>
    </div>
  );
}

function formatWorkflowTransferText(event: ProductWorkflowEvent) {
  const actor = event.actorName || "系统";

  if (event.assigneeName) {
    return `${actor} 交给 ${event.assigneeName}`;
  }

  return `${actor} 记录流程变更`;
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
      className={`flex min-h-[82px] w-32 flex-col rounded-md border bg-white px-3 py-2.5 text-left shadow-sm transition-colors hover:border-brand hover:bg-surface-muted ${
        active ? "border-brand ring-2 ring-brand/15" : "border-border"
      }`}
      onClick={onClick}
      type="button"
    >
      <p className="text-xs font-semibold text-muted">{label}</p>
      <p className={`mt-1 text-xl font-black metric-tabular ${toneClass}`}>{value}</p>
      {detail ? <p className="mt-1 line-clamp-1 text-xs leading-5 text-muted">{detail}</p> : null}
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pendingValue, setPendingValue] = useState<string[]>(value);
  const availableOptions = useMemo(() => Array.from(new Set([...value, ...options].filter(Boolean))), [options, value]);
  const filteredOptions = useMemo(() => {
    const keyword = search.trim().toLowerCase();

    if (!keyword) return availableOptions;

    return availableOptions.filter((option) => option.toLowerCase().includes(keyword));
  }, [availableOptions, search]);
  const selectedVisibleCount = filteredOptions.filter((option) => pendingValue.includes(option)).length;
  const allVisibleSelected = filteredOptions.length > 0 && selectedVisibleCount === filteredOptions.length;
  const summary = value.length ? `${value.slice(0, 2).join("、")}${value.length > 2 ? ` +${value.length - 2}` : ""}` : `请选择${label}`;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setPendingValue(value);
        setSearch("");
      }
    }

    document.addEventListener("pointerdown", handlePointerDown);

    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [open, value]);

  function toggle(option: string) {
    setPendingValue((current) => (current.includes(option) ? current.filter((item) => item !== option) : [...current, option]));
  }

  function toggleAllVisible() {
    if (allVisibleSelected) {
      setPendingValue((current) => current.filter((item) => !filteredOptions.includes(item)));
      return;
    }

    setPendingValue((current) => Array.from(new Set([...current, ...filteredOptions])));
  }

  function cancel() {
    setPendingValue(value);
    setSearch("");
    setOpen(false);
  }

  function confirm() {
    onChange(pendingValue);
    setSearch("");
    setOpen(false);
  }

  return (
    <div ref={containerRef} className="relative text-xs font-semibold text-muted">
      <p>{label}</p>
      <button
        type="button"
        className={`mt-1 flex h-10 w-full items-center justify-between gap-2 rounded-md border bg-white px-3 text-left text-sm font-semibold outline-none transition-colors ${
          open ? "border-brand ring-2 ring-brand/15" : "border-border hover:border-brand"
        }`}
        onClick={() => {
          setPendingValue(value);
          setOpen((current) => !current);
        }}
      >
        <span className={value.length ? "truncate text-foreground" : "truncate text-muted"}>{summary}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div className="absolute left-0 top-full z-40 mt-1 flex w-full min-w-[320px] flex-col overflow-hidden rounded-md border border-border bg-white shadow-xl">
          <div className="flex h-11 items-center gap-2 border-b border-border px-3">
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索"
              className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-foreground outline-none placeholder:text-muted"
            />
            <Search className="h-4 w-4 text-muted" />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {availableOptions.length ? (
              <>
                <button
                  type="button"
                  className="flex h-11 w-full items-center gap-3 px-3 text-left text-sm font-semibold text-foreground hover:bg-surface-muted"
                  onClick={toggleAllVisible}
                >
                  <CheckboxIndicator checked={allVisibleSelected} />
                  <span>全选</span>
                </button>
                {filteredOptions.map((option) => {
                  const checked = pendingValue.includes(option);

                  return (
                    <button
                      key={option}
                      type="button"
                      className={`flex h-11 w-full items-center gap-3 px-3 text-left text-sm font-semibold ${
                        checked ? "bg-brand/10 text-brand" : "text-foreground hover:bg-surface-muted"
                      }`}
                      onClick={() => toggle(option)}
                    >
                      <CheckboxIndicator checked={checked} />
                      <span className="truncate">{option}</span>
                    </button>
                  );
                })}
                {!filteredOptions.length ? <p className="px-3 py-6 text-center text-sm text-muted">没有匹配的账号</p> : null}
              </>
            ) : (
              <p className="px-3 py-6 text-center text-sm text-muted">暂无可选账号，请先到账号管理创建对应角色。</p>
            )}
          </div>
          <div className="flex items-center justify-between border-t border-border bg-surface-muted px-3 py-3">
            <span className="text-xs font-semibold text-muted">已选 {pendingValue.length} 项</span>
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={cancel}>
                取消
              </Button>
              <Button size="sm" onClick={confirm}>
                确定
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function CheckboxIndicator({ checked }: { checked: boolean }) {
  return (
    <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? "border-brand bg-brand text-white" : "border-border bg-white"}`}>
      {checked ? <span className="text-xs leading-none">✓</span> : null}
    </span>
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

function getTeamMemberOptions(members: TeamMember[], roles: ProductWorkflowRole[]) {
  return filterTeamMembersByRoles(members, roles).map((member) => member.name);
}

function getAccountNameOptionsByRoleIds(accounts: TeamAccountRecord[], roleIds: AccountRoleId[]) {
  const roleSet = new Set<AccountRoleId>(roleIds);
  const names = accounts.filter((account) => account.status !== "disabled" && roleSet.has(account.roleId)).map((account) => account.name.trim()).filter(Boolean);

  return Array.from(new Set(names));
}

function buildProductsApiPath(page: number, pageSize: number, filters: ProductFilters) {
  const params = new URLSearchParams({
    page: String(page),
    pageSize: String(pageSize),
  });

  if (filters.keyword.trim()) params.set("keyword", filters.keyword.trim());
  if (filters.asin.trim()) params.set("asin", filters.asin.trim());
  if (filters.supplierName.trim()) params.set("supplierName", filters.supplierName.trim());
  if (filters.minPrice.trim()) params.set("minPrice", filters.minPrice.trim());
  if (filters.maxPrice.trim()) params.set("maxPrice", filters.maxPrice.trim());
  filters.opsAssignees.forEach((name) => params.append("opsAssignee", name));
  filters.selectionOwners.forEach((name) => params.append("selectionOwner", name));
  filters.designerAssignees.forEach((name) => params.append("designerAssignee", name));
  if (filters.status !== "all" && filters.status !== "overdue" && filters.status !== "operations_progress") {
    params.set("status", filters.status);
  }
  if (filters.status === "overdue" || filters.status === "operations_progress") {
    params.set("status", filters.status);
  }

  return `/api/products?${params.toString()}`;
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
