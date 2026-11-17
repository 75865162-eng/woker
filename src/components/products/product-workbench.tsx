"use client";

import { stripAmazonProductObservations } from "@/lib/products/amazon-field-policy";
import { useEffect, useMemo, useRef, useState } from "react";
import { FileDown, FileUp, History, PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppShellUser } from "@/components/app-shell/app-shell-context";
import { useSearchParams } from "next/navigation";
import { workspaceScopeChangedEventName } from "@/lib/workspace/workspace-scope-events";
import { roleCanPerformAction } from "@/lib/accounts/permissions";
import { accountsToTeamMembers, type TeamAccountRecord } from "@/lib/accounts/team-roster";
import type { Product } from "@/lib/products/types";
import { initialFilters, pageSizeOptions, type TrialProductDraft } from "./product-workbench-model";
import { ActivityLogModal, ProductFiltersBar, ProductTable } from "./product-workbench-shell";
import { nextSku as getNextSku } from "./product-workbench-utils";
import { ProductVersionModal } from "./product-version-modal";
import { TrialProductEditor } from "./trial-product-editor";
import { productDetailCache, type ProductWorkbenchInitialData, getProductExportNoticeClass, readCurrentWorkspaceId, invalidateProductRequestCaches, scheduleNonCriticalTask } from "./product-workbench-cache";
import { SummaryTile, Pagination, loadTeamAccountsFromApi, getTeamMemberOptions, getAccountNameOptionsByRoleIds } from "./product-workbench-controls";
import { ProductEditor } from "./product-editor";
import { useProductEditor } from "./use-product-editor";
import { useProductExport } from "./use-product-export";
import { useProductList } from "./use-product-list";
export { ProductEditor } from "./product-editor";

export function ProductWorkbench({ initialData }: { initialData?: ProductWorkbenchInitialData }) {
  const searchParams = useSearchParams();
  const shellUser = useAppShellUser();
  const canEditProducts = roleCanPerformAction(shellUser?.userRole, "products", "edit", shellUser?.rolePermissions);
  const canExportProducts = roleCanPerformAction(shellUser?.userRole, "products", "export", shellUser?.rolePermissions);
  const currentUserId = shellUser?.userId || "";
  const creatorName = shellUser?.userName?.trim() || "当前创建人";
  const currentUserName = creatorName === "当前创建人" ? "" : creatorName.trim();
  const [activityLog, setActivityLog] = useState<string[]>(["产品工作台已连接数据库"]);
  const {
    products, setProducts, filters, page, setPage, pageSize, setPageSize, sort, setSort,
    productsTotalCount, listSummary, summaryReady, mySkuCount, mySkuReady,
    productsLoading, productsError, setProductsError, amazonAccounts, amazonAccountId,
    setAmazonAccountId, pageCount, applyFilters, patchFilters, reloadProducts, handleProductSaved,
  } = useProductList(initialData, currentUserName, setActivityLog);
  const { exportingProducts, exportNotice, handleExportProducts } = useProductExport(filters, setActivityLog);
  const [isTrialEditorOpen, setIsTrialEditorOpen] = useState(false);
  const [, setTrialProducts] = useState<TrialProductDraft[]>([]);
  const [isActivityLogOpen, setIsActivityLogOpen] = useState(false);
  const [versionProduct, setVersionProduct] = useState<Product | null>(null);
  const [teamAccounts, setTeamAccounts] = useState<TeamAccountRecord[]>([]);
  const [deepLinkMessage, setDeepLinkMessage] = useState("");
  const handledDeepLinkRef = useRef("");
  const importInputRef = useRef<HTMLInputElement | null>(null);
  const teamMembers = useMemo(() => accountsToTeamMembers(teamAccounts), [teamAccounts]);
  const opsOptions = useMemo(() => getTeamMemberOptions(teamMembers, ["operations_supervisor", "operations"]), [teamMembers]);
  const designerOptions = useMemo(() => getTeamMemberOptions(teamMembers, ["designer"]), [teamMembers]);
  const opsFilterOptions = useMemo(() => getAccountNameOptionsByRoleIds(teamAccounts, ["operations"]), [teamAccounts]);
  const selectionOwnerFilterOptions = useMemo(() => getAccountNameOptionsByRoleIds(teamAccounts, ["developer", "procurement"]), [teamAccounts]);
  const designerFilterOptions = useMemo(() => getAccountNameOptionsByRoleIds(teamAccounts, ["designer"]), [teamAccounts]);

  useEffect(() => {
    let canceled = false;
    const cancel = scheduleNonCriticalTask(() => {
      void loadTeamAccountsFromApi().then(accounts => { if (!canceled) setTeamAccounts(accounts); });
    });
    return () => { canceled = true; cancel(); };
  }, []);

  const {
    activeProduct, importedEditorDraft, detailReady, detailError, isEditorOpen,
    openNewProduct, closeProductEditor, openProduct, prefetchProduct, alignProductDetail,
    handleSaveProduct, handleImportFile, clearAmazonObservations,
  } = useProductEditor({
    products, creatorName, identityKey: `${shellUser?.organizationId ?? ""}:${currentUserId}`,
    setActivityLog, setProductsError, onSaved: handleProductSaved,
  });

  useEffect(() => {
    const sku = searchParams.get("sku")?.trim() ?? "";
    const workspaceId = searchParams.get("workspaceId")?.trim() ?? "";
    if (!sku || !workspaceId) return;
    const requestKey = `${workspaceId}:${sku}`;
    if (handledDeepLinkRef.current === requestKey) return;
    const openWhenScopeReady = () => {
      if (readCurrentWorkspaceId() !== workspaceId || productsLoading) return;
      handledDeepLinkRef.current = requestKey;
      setDeepLinkMessage("");
      void openProduct(sku);
    };
    openWhenScopeReady();
    window.addEventListener(workspaceScopeChangedEventName, openWhenScopeReady);
    const timeout = window.setTimeout(() => {
      if (handledDeepLinkRef.current !== requestKey) {
        handledDeepLinkRef.current = requestKey;
        setDeepLinkMessage(`无法切换到目标工作区或未找到 SKU「${sku}」，请检查工作区权限。`);
      }
    }, 10000);
    return () => { window.removeEventListener(workspaceScopeChangedEventName, openWhenScopeReady); window.clearTimeout(timeout); };
  }, [openProduct, productsLoading, searchParams]);

  function handleSaveTrialProduct(draft: TrialProductDraft) {
    const next = { ...draft, id: draft.id ?? `trial-${Date.now()}` };
    setTrialProducts(current => [next, ...current]);
    setIsTrialEditorOpen(false);
    setActivityLog(current => [`新增试算商品 ${next.title || next.pricingRows[0]?.name || "未命名"}`, ...current].slice(0, 8));
  }
  const summaryValue = (value: number) => summaryReady ? value.toLocaleString("zh-CN") : "…";
  return <div className="space-y-5">
    {deepLinkMessage ? <div role="status" className="rounded-md border border-warning-ink/30 bg-warning-soft px-3 py-2 text-sm font-medium text-warning-ink">{deepLinkMessage}</div> : null}
    {productsError ? <div className="rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-sm font-semibold text-danger-ink">{productsError}</div> : null}
    {productsLoading && !products.length ? <div className="rounded-md border border-border bg-surface px-4 py-3 text-sm font-semibold text-muted">正在从数据库读取商品数据...</div> : null}
    {exportNotice ? <div className={`flex flex-col gap-2 rounded-md border px-3 py-2 text-sm font-semibold sm:flex-row sm:items-center sm:justify-between ${getProductExportNoticeClass(exportNotice.tone)}`}>
      <span>{exportNotice.message}{exportNotice.jobId ? <span className="ml-2 text-xs opacity-80">任务 {exportNotice.jobId}</span> : null}</span><a href="/tasks" className="text-xs font-bold underline underline-offset-2">查看任务中心</a>
    </div> : null}
    <section className="grid grid-cols-[repeat(auto-fit,128px)] justify-start gap-2">
      <SummaryTile label="全部商品" value={summaryValue(listSummary.total)} active={filters.status === "all" && !filters.mySkuOwner.trim()} onClick={() => patchFilters(current => ({ ...current, status: "all", mySkuOwner: "" }))} />
      <SummaryTile label="开发中" value={summaryValue(listSummary.developing)} tone="blue" active={filters.status === "development_phase"} onClick={() => patchFilters(current => ({ ...current, status: "development_phase" }))} />
      <SummaryTile label="运营确认中" value={summaryValue(listSummary.opsReview)} tone="amber" active={filters.status === "ops_review"} onClick={() => patchFilters(current => ({ ...current, status: "ops_review" }))} />
      <SummaryTile label="美工处理中" value={summaryValue(listSummary.designInProgress)} tone="blue" active={filters.status === "design_in_progress"} onClick={() => patchFilters(current => ({ ...current, status: "design_in_progress" }))} />
      <SummaryTile label="运营进度" value={summaryValue(listSummary.operationsProgress)} tone="amber" active={filters.status === "operations_progress"} onClick={() => patchFilters(current => ({ ...current, status: "operations_progress" }))} />
      <SummaryTile label="超期预警" value={summaryValue(listSummary.overdue)} tone="red" active={filters.status === "overdue"} onClick={() => patchFilters(current => ({ ...current, status: "overdue" }))} />
      <SummaryTile label="我的SKU" value={mySkuReady ? mySkuCount.toLocaleString("zh-CN") : "…"} tone="green" active={filters.mySkuOwner.trim() === currentUserName && Boolean(currentUserName)} onClick={() => patchFilters(current => ({ ...current, mySkuOwner: current.mySkuOwner.trim() ? "" : currentUserName }))} />
    </section>
    <p className="px-1 text-xs font-medium text-muted">顶部卡片按业务阶段聚合统计，开发中会合并待开发与开发中；运营进度、超期和我的 SKU 可以与其它卡片重叠。</p>
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
        <div><CardTitle>产品列表</CardTitle>
          {amazonAccounts.length > 0 ? <label className="mt-2 flex items-center gap-2 text-xs">Amazon 快照账号
            <select aria-label="Amazon 快照账号" value={amazonAccountId} onChange={event => { setProducts(rows => rows.map(stripAmazonProductObservations)); clearAmazonObservations(); setAmazonAccountId(event.target.value); }} className="h-8 border border-border bg-surface px-2">
              <option value="">{amazonAccounts.length === 1 ? "自动选择已分配账号" : "请选择账号"}</option>{amazonAccounts.map(account => <option key={account.id} value={account.id}>{account.displayName || account.id}</option>)}
            </select>
          </label> : null}
          <p className="mt-1 text-xs font-medium text-muted">新增 SKU 默认待开发；流转后超过 3 天且未上架、未取消的商品会自动进入超期预警。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <input ref={importInputRef} className="hidden" type="file" accept=".xlsx,.xls" onChange={event => { void handleImportFile(event.target.files?.[0]); event.currentTarget.value = ""; }} />
          <Button variant="secondary" size="sm" onClick={() => importInputRef.current?.click()} disabled={!canEditProducts} title={!canEditProducts ? "没有商品编辑权限" : undefined}><FileUp className="h-4 w-4" />导入数据</Button>
          <Button variant="secondary" size="sm" disabled={!canExportProducts || exportingProducts} title={!canExportProducts ? "没有商品导出权限" : undefined} onClick={() => void handleExportProducts()}><FileDown className="h-4 w-4" />{exportingProducts ? "提交中..." : "导出数据"}</Button>
          <Button variant="secondary" size="sm" onClick={() => setIsActivityLogOpen(true)}><History className="h-4 w-4" />操作日志</Button>
          <Button size="sm" onClick={openNewProduct} disabled={!canEditProducts} title={!canEditProducts ? "没有商品编辑权限" : undefined}><PackagePlus className="h-4 w-4" />新增商品</Button>
          <Button size="sm" onClick={() => setIsTrialEditorOpen(true)} disabled={!canEditProducts} title={!canEditProducts ? "没有商品编辑权限" : undefined}><PackagePlus className="h-4 w-4" />新增试算商品</Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <ProductFiltersBar filters={filters} opsAssigneeOptions={opsFilterOptions} selectionOwnerOptions={selectionOwnerFilterOptions} designerAssigneeOptions={designerFilterOptions} onChange={applyFilters} onReset={() => applyFilters(initialFilters)} onSearch={() => void reloadProducts()} />
        <ProductTable products={products} totalCount={productsTotalCount} loading={productsLoading} sort={sort} onSortChange={field => { setSort(current => ({ field, direction: current.field === field && current.direction === "asc" ? "desc" : "asc" })); setPage(1); }} onOpenProduct={sku => void openProduct(sku)} onOpenHistory={setVersionProduct} onPrefetchProduct={prefetchProduct} />
        <Pagination page={page} pageCount={pageCount} pageSize={pageSize} pageSizeOptions={pageSizeOptions} onPageChange={setPage} onPageSizeChange={size => { setPage(1); setPageSize(size); }} />
      </CardContent>
    </Card>
    {isActivityLogOpen ? <ActivityLogModal entries={activityLog} onClose={() => setIsActivityLogOpen(false)} /> : null}
    {versionProduct ? <ProductVersionModal product={versionProduct} onClose={() => setVersionProduct(null)} onRestored={() => { invalidateProductRequestCaches(); productDetailCache.clear(); void reloadProducts(); setActivityLog(current => [`已恢复商品 ${versionProduct.sku} 的历史版本`, ...current].slice(0, 8)); }} /> : null}
    {isEditorOpen ? <ProductEditor key={`${readCurrentWorkspaceId()}:${activeProduct?.sku ?? "new"}:${currentUserId}`} product={activeProduct} initialDraft={importedEditorDraft} products={products} nextSku={getNextSku(products)} creatorName={creatorName} creatorUserId={currentUserId} detailReady={detailReady} canEdit={canEditProducts} detailError={detailError} onRetryDetail={() => { if (activeProduct) void alignProductDetail(readCurrentWorkspaceId(), activeProduct.sku); }} opsOptions={opsOptions} designerOptions={designerOptions} onClose={closeProductEditor} onSave={handleSaveProduct} /> : null}
    {isTrialEditorOpen ? <TrialProductEditor onClose={() => setIsTrialEditorOpen(false)} onSave={handleSaveTrialProduct} /> : null}
  </div>;
}
