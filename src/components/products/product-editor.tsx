"use client";

import { ProductEditorForm } from "./product-editor-form";
import { useCallback, useEffect, useRef, useState } from "react";
import { FileUp, LoaderCircle, Save, Video, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppShellUser } from "@/components/app-shell/app-shell-context";
import type { Product, ProductDraft } from "@/lib/products/types";
import { buildWorkflowEvent, createWorkflowDueAt, getProductWorkflowStage, formatAssigneeList, normalizeAssigneeList } from "@/lib/products/workflow";
import { useProductAttachmentActions } from "./use-product-attachment-actions";
import { restoreProductEdits } from "@/lib/products/product-edit-draft-repository";
import { useProductRevisionConflict } from "./use-product-revision-conflict";
import { normalizeProductVideoPlan } from "@/lib/products/video-plan";
import { normalizeOperationsProgress } from "@/lib/products/operations-progress";
import { useProductEditDraft } from "./use-product-edit-draft";
import { ProductEditDialog } from "./product-edit-dialog";
import { type ProductEditorDraft } from "./product-workbench-model";
import { ProductVideoPlanModal } from "./product-video-plan-modal";
import { ProductImagePreviewModal } from "./product-editor-image-panel";
import { ProductOperationsProgress } from "./product-operations-progress";
import { productToDraft } from "./product-workbench-data";
import { useProductImageUploads } from "./use-product-image-uploads";
import { ProductMeetingNotes } from "./product-meeting-notes";
import { compactToolbarButtonClass, readCurrentWorkspaceId } from "./product-workbench-cache";
import { useProductWorkbookEditing } from "./use-product-workbook-editing";
import { useProductWorkflowEditing } from "./use-product-workflow-editing";
export function ProductEditor({
  product,
  initialDraft,
  products,
  nextSku,
  creatorName,
  creatorUserId,
  detailReady,
  canEdit,
  detailError = "",
  onRetryDetail,
  opsOptions,
  designerOptions,
  onClose,
  onSave,
}: {
  product: Product | null;
  initialDraft?: Product | null;
  products: Product[];
  nextSku: string;
  creatorName: string;
  creatorUserId: string;
  detailReady: boolean;
  canEdit: boolean;
  detailError?: string;
  onRetryDetail?: () => void;
  opsOptions: string[];
  designerOptions: string[];
  onClose: () => void;
  onSave: (draft: ProductDraft, workspaceId: string) => void | Promise<void>;
}) {
  const [draft, setDraft] = useState<ProductEditorDraft>(() => ({ ...productToDraft(initialDraft ?? product, products, nextSku), ...(!detailReady ? { revision: undefined } : {}) }));
  const initialDraftRef = useRef(initialDraft);
  const [editorWorkspaceId] = useState(readCurrentWorkspaceId);
  const [saving, setSaving] = useState(false);
  const [committed, setCommitted] = useState(false);
  const saveInFlight = useRef(false);
  const [baseSnapshot, setBaseSnapshot] = useState<ProductEditorDraft>(() => ({ ...productToDraft(product, products, nextSku), ...(!detailReady ? { revision: undefined } : {}) }));
  const [editorError, setEditorError] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const shellUser = useAppShellUser();
  const localDraft = useProductEditDraft({
    organizationId: shellUser?.organizationId ?? "",
    workspaceId: editorWorkspaceId, userId: creatorUserId,
    entityId: product?.sku || "new", editorType: "product",
  }, baseSnapshot, draft, true);
  const conflict = useProductRevisionConflict({ sku: draft.sku, workspaceId: editorWorkspaceId, products, nextSku, flushDraft: localDraft.flush, setDraft, setBaseSnapshot, setEditorError });
  const [operationsProgressOpen, setOperationsProgressOpen] = useState(false);
  const [videoPlanOpen, setVideoPlanOpen] = useState(false);
  const attachments = useProductAttachmentActions(setDraft, setEditorError);
  const { conclusionUploading, conclusionInputRef, handleConclusionUpload, previewImage, setPreviewImage, previewLoading, setPreviewLoading } = attachments;
  const images = useProductImageUploads(draft, setDraft);
  const { imageUploads } = images;
  const [workbookUploads, setWorkbookUploads] = useState(0);
  const [patentUploadBusy, setPatentUploadBusy] = useState(false);
  const trackWorkbookUpload = useCallback((delta: number) => setWorkbookUploads((current) => Math.max(0, current + delta)), []);
  const attachmentsBusy = conclusionUploading || imageUploads.length > 0 || workbookUploads > 0 || patentUploadBusy;
  const childEditorOpen = operationsProgressOpen || videoPlanOpen;
  const productRef = useRef(product);
  const productsRef = useRef(products);
  const nextSkuRef = useRef(nextSku);
  const draftSourceKeyRef = useRef("");

  const isEditing = Boolean(product);
  const showHeavyDetail = !isEditing || detailReady;
  const workbookDetail = draft.workbookDetail;
  const selectionOwner = draft.selectionOwner || (isEditing ? product?.selectionOwner : creatorName) || creatorName;
  const selectedOps = normalizeAssigneeList(draft.opsAssignee, draft.opsAssignees);
  const selectedDesigners = normalizeAssigneeList(draft.designerAssignee, draft.designerAssignees);
  const showListingActions = ["listing_confirming", "design_in_progress", "listed", "delisted"].includes(draft.status);
  const requiresConclusionExcel = draft.status === "canceled" || draft.status === "listed";

  useEffect(() => {
    productRef.current = product;
  }, [product]);

  useEffect(() => {
    productsRef.current = products;
  }, [products]);

  useEffect(() => {
    nextSkuRef.current = nextSku;
  }, [nextSku]);

  useEffect(() => {
    const productKey = product?.id || product?.sku || "";
    const sourceKey = !isEditing
      ? "new"
      : `${productKey}:detail`;

    if (detailReady && draftSourceKeyRef.current !== sourceKey) {
      draftSourceKeyRef.current = sourceKey;
      const initial = productToDraft(productRef.current, productsRef.current, nextSkuRef.current);
      // Align authority without replacing edits made while the list shell was open.
      setDraft((current) => !isEditing && initialDraftRef.current
        ? productToDraft(initialDraftRef.current, productsRef.current, nextSkuRef.current)
        : restoreProductEdits(baseSnapshot, current, initial));
      setBaseSnapshot(initial);
    }
  }, [detailReady, isEditing, product, baseSnapshot]);

  async function requestClose() {
    if (saving || attachmentsBusy || childEditorOpen) return;
    if (localDraft.dirty || localDraft.candidates.length || conflict.active) setConfirmClose(true);
    else onClose();
  }

  async function discardAndClose() {
    if (await localDraft.clear()) onClose();
  }

  function restoreAfterConflict() {
    conflict.restoreMine();
  }

  const workflow = useProductWorkflowEditing(draft, setDraft, selectedOps, selectedDesigners, creatorUserId, creatorName);

  async function saveDraft(nextDraft: ProductEditorDraft) {
    const normalizedStage = getProductWorkflowStage(nextDraft);
    const now = new Date();
    const workflowHistory = nextDraft.workflowHistory?.length
      ? nextDraft.workflowHistory
      : [
          buildWorkflowEvent({
            stage: normalizedStage,
            actorUserId: creatorUserId || undefined,
            actorName: creatorName,
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

    await Promise.resolve(
      onSave({
        ...nextDraft,
        sku: nextDraft.sku.trim(),
        chineseName: nextDraft.chineseName.trim(),
        englishName: nextDraft.englishName.trim(),
        asin: nextDraft.asin.trim().toUpperCase(),
        cancelReason: nextDraft.cancelReason.trim(),
        competitorAsins: (Array.isArray(workbookDetail.competitors) ? workbookDetail.competitors : [])
          .map((competitor) => competitor.asin.trim().toUpperCase())
          .filter(Boolean),
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
        workflowStartedAt: nextDraft.workflowStartedAt || now.toISOString(),
        workflowUpdatedAt: now.toISOString(),
        workflowDueAt:
          normalizedStage === "done" || normalizedStage === "blocked"
            ? ""
            : nextDraft.workflowDueAt || createWorkflowDueAt(now),
        workflowHistory,
      }, editorWorkspaceId),
    );
  }

  async function handleSubmit(override?: Partial<ProductEditorDraft>) {
    if (committed || saveInFlight.current || attachmentsBusy || childEditorOpen || !detailReady || !localDraft.checked || localDraft.candidates.length || conflict.active) {
      return;
    }

    const nextDraft = { ...draft, ...override };

    if (!nextDraft.chineseName.trim() || !nextDraft.englishName.trim()) {
      setEditorError("中文名和英文名为必填项。");
      return;
    }

    if ((nextDraft.status === "canceled" || nextDraft.status === "listed") && !nextDraft.conclusionExcelFile?.id) {
      setEditorError("状态为已取消或已上架时，请先上传结论 Excel 表。");
      return;
    }

    if (nextDraft.status === "ops_review" && selectedOps.length === 0) {
      setEditorError("状态为运营确认时，请至少选择一位运营负责人。");
      return;
    }

    if (nextDraft.status === "design_in_progress" && selectedDesigners.length === 0) {
      setEditorError("状态为美工处理中时，请至少选择一位美工负责人。");
      return;
    }

    saveInFlight.current = true;
    setSaving(true);
    setEditorError("");
    try {
      await localDraft.flush();
      await saveDraft({ ...nextDraft, revision: baseSnapshot.revision });
      setCommitted(true);
      // Cleanup failure must not turn a committed transaction into a failed save.
      if (await localDraft.clear()) onClose();
      else setEditorError("商品已正式保存，但本地草稿清理失败。请点击取消重试清理，不要重复保存。");
    } catch (error) {
      await localDraft.flush();
      if (error instanceof Error && error.name === "ProductRevisionConflictError") {
        conflict.begin(baseSnapshot, nextDraft);
      } else setEditorError(error instanceof Error ? error.message : "商品保存失败，你的修改仍保留在表单中。");
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  const workbook = useProductWorkbookEditing(setDraft);


  return (
    <div className="fixed inset-0 z-30 bg-foreground/35 p-4 backdrop-blur-sm">
      <div className="mx-auto flex h-full w-full max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-lg bg-surface shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">{isEditing ? `商品详情 ${draft.sku}` : "新增商品"}</h2>
            <p className="mt-1 text-xs font-medium text-muted" role="status">{localDraft.status}</p>
            {editorError ? <p role="alert" className="mt-1 text-xs text-danger">{editorError}</p> : null}
            {committed ? <Button size="sm" variant="secondary" onClick={onClose}>关闭（商品已保存）</Button> : null}
            {!detailReady ? <div className="mt-1 text-xs text-muted">
              {detailError ? <><p role="alert">详情加载失败：{detailError}。可继续编辑基础信息，保存需等待详情对齐。</p><Button size="sm" variant="secondary" onClick={onRetryDetail}>重试加载</Button></>
                : <p>正在读取权威详情，可先编辑基础信息；附件和保存待详情对齐后开放。</p>}
            </div> : null}
            {conflict.active ? <Button size="sm" variant="secondary" onClick={() => conflict.setOpen(true)}>处理并发冲突</Button> : null}
            {process.env.NODE_ENV === "development" && conflict.latest ? <details className="text-xs"><summary>查看最新服务器数据（版本 {conflict.latest.revision}）</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify(conflict.latest, null, 2)}</pre></details> : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <input
              ref={conclusionInputRef}
              className="hidden"
              type="file"
              accept=".xlsx,.xls,.xlsm"
              onChange={(event) => {
                void handleConclusionUpload(event.target.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            {showListingActions ? (
              <>
                <Button
                  variant={requiresConclusionExcel && !draft.conclusionExcelFile ? "secondary" : "ghost"}
                  size="sm"
                  className={compactToolbarButtonClass}
                  onClick={() => conclusionInputRef.current?.click()}
                  disabled={committed || saving || !detailReady || !localDraft.checked || localDraft.candidates.length > 0 || conflict.active || conclusionUploading}
                >
                  <FileUp className="h-4 w-4" />
                  {conclusionUploading ? "上传中" : "结论 Excel（必传）"}
                </Button>
                <Button variant="secondary" size="sm" className={compactToolbarButtonClass} disabled={committed || saving || !detailReady || !localDraft.checked || localDraft.candidates.length > 0 || conflict.active} onClick={() => setOperationsProgressOpen(true)}>
                  运营进度
                </Button>
                {showHeavyDetail ? (
                  <>
                    <Button variant="secondary" size="sm" className={compactToolbarButtonClass} disabled={committed || saving || !localDraft.checked || localDraft.candidates.length > 0 || conflict.active} onClick={() => setVideoPlanOpen(true)}>
                      <Video className="h-4 w-4" />
                      视频
                    </Button>
                  </>
                ) : null}
              </>
            ) : null}
            {isEditing ? <ProductMeetingNotes sku={draft.sku} workspaceId={editorWorkspaceId} disabled={!detailReady || committed} /> : null}
            <Button variant="secondary" size="sm" className={compactToolbarButtonClass} onClick={() => void requestClose()} disabled={saving || attachmentsBusy || childEditorOpen}>
              <X className="h-4 w-4" />
              取消
            </Button>
            <Button variant="ghost" size="sm" className={compactToolbarButtonClass} disabled={saving || attachmentsBusy || childEditorOpen} onClick={onClose}>暂时离开（保留草稿）</Button>
            <Button size="sm" className={compactToolbarButtonClass} onClick={() => void handleSubmit()} disabled={!canEdit || committed || saving || !detailReady || !localDraft.checked || localDraft.candidates.length > 0 || conflict.active || attachmentsBusy || childEditorOpen} title={!canEdit ? "没有商品编辑权限" : undefined}>
              {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {saving ? "保存中" : attachmentsBusy ? "附件上传中" : "保存"}
            </Button>
          </div>
        </div>

        <ProductEditorForm draft={draft} setDraft={setDraft} disabled={committed || saving || childEditorOpen || !localDraft.checked || localDraft.candidates.length > 0 || conflict.active} ready={showHeavyDetail} isEditing={isEditing} workspaceId={editorWorkspaceId} selectionOwner={selectionOwner} selectedOps={selectedOps} selectedDesigners={selectedDesigners} opsOptions={opsOptions} designerOptions={designerOptions} patentUploadBusy={patentUploadBusy} setPatentUploadBusy={setPatentUploadBusy} trackWorkbookUpload={trackWorkbookUpload} images={images} attachments={attachments} workbook={workbook} workflow={workflow} />
      </div>
      {localDraft.checked && detailReady && localDraft.candidates.length > 0 ? (
        <ProductEditDialog title="发现未提交的编辑内容" onDismiss={() => { /* Explicit restore/discard is required before editing. */ }}>
          <p className="text-sm">发现 {localDraft.candidates.length} 份草稿，最近修改于 {new Date(localDraft.candidates[0].updatedAt).toLocaleString("zh-CN")}。</p>
          {localDraft.candidates[0].baseRevision !== undefined && localDraft.candidates[0].baseRevision !== baseSnapshot.revision ? <p className="my-3 text-sm text-danger">商品数据已经更新。恢复将保留原始版本号，保存前必须处理版本冲突；不会静默覆盖最新商品。</p> : null}
          {process.env.NODE_ENV === "development" ? <details className="mt-3 text-xs"><summary>查看最新商品数据 · 版本 {baseSnapshot.revision ?? "新商品"}</summary><pre className="max-h-64 overflow-auto whitespace-pre-wrap">{JSON.stringify(baseSnapshot, null, 2)}</pre></details> : null}
          <div className="mt-4 flex gap-2">
            <Button onClick={() => {
              const record = localDraft.acceptCandidate();
              if (record) {
                // Shell drafts have no authoritative revision; reapply only their edits.
                conflict.acceptCandidate(record, baseSnapshot, isEditing);
              }
            }}>恢复草稿</Button>
            <Button variant="secondary" onClick={() => void localDraft.clear().then((ok) => { if (ok) localDraft.resume(); })}>放弃草稿</Button>
            <Button variant="ghost" onClick={onClose}>暂时离开（保留草稿）</Button>
          </div>
        </ProductEditDialog>
      ) : null}
      {confirmClose ? (
        <ProductEditDialog title="放弃修改并关闭？" onDismiss={() => setConfirmClose(false)}>
          <p className="text-sm">只放弃本次未提交修改，不影响已正式保存的商品数据。暂时离开或刷新会保留草稿。</p>
          <p className="mt-2 text-xs text-muted" role="status">{localDraft.status}</p>
          <div className="mt-4 flex gap-2">
            <Button onClick={() => void discardAndClose()}>放弃修改并关闭</Button>
            <Button variant="secondary" onClick={() => setConfirmClose(false)}>继续编辑</Button>
          </div>
        </ProductEditDialog>
      ) : null}
      {conflict.open ? (
        <ProductEditDialog title="商品版本冲突" onDismiss={() => conflict.setOpen(false)}>
          <p className="text-sm">该商品已被其他用户修改。你的编辑内容已保留，请加载最新数据后继续。</p>
          {process.env.NODE_ENV === "development" && conflict.latest ? <details open className="mt-3 text-xs"><summary>最新数据 · 版本 {conflict.latest.revision}（供核对）</summary><pre className="max-h-72 overflow-auto whitespace-pre-wrap">{JSON.stringify(conflict.latest, null, 2)}</pre></details> : null}
          {editorError ? <p role="alert" className="mt-2 text-sm text-danger">{editorError}</p> : null}
          <p className="mt-3 text-xs text-muted">恢复仅重新应用你修改过的字段，数组和复合字段整体恢复。不会自动保存，请人工检查。附件引用会保留，不会重复上传。</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button onClick={() => void conflict.loadLatest()} disabled={conflict.loading}>{conflict.loading ? "正在读取" : "加载最新数据"}</Button>
            <Button variant="secondary" disabled={!conflict.latest || conflict.loading} onClick={conflict.useServerVersion}>使用服务器版本</Button>
            <Button onClick={restoreAfterConflict} disabled={!conflict.latest || conflict.loading}>恢复我的修改</Button>
            <Button variant="secondary" onClick={() => conflict.setOpen(false)}>暂不处理</Button>
            <Button variant="ghost" onClick={() => { conflict.setOpen(false); setConfirmClose(true); }}>放弃草稿</Button>
          </div>
        </ProductEditDialog>
      ) : null}
      {operationsProgressOpen ? (
        <ProductOperationsProgress
          productName={draft.chineseName}
          value={draft.operationsProgress}
          currentUser={creatorName}
          currentUserId={creatorUserId}
          defaultOwner={formatAssigneeList(selectedOps) || selectionOwner}
          onChange={(update) => setDraft((current) => ({ ...current, operationsProgress: typeof update === "function" ? update(normalizeOperationsProgress(current.operationsProgress, formatAssigneeList(selectedOps) || selectionOwner)) : update }))}
          onClose={() => setOperationsProgressOpen(false)}
          onApply={(operationsProgress) => {
            setDraft((current) => ({ ...current, operationsProgress }));
            setOperationsProgressOpen(false);
          }}
        />
      ) : null}
      {videoPlanOpen ? (
        <ProductVideoPlanModal
          sku={draft.sku}
          productName={draft.chineseName}
          value={draft.videoPlan}
          onChange={(update) => setDraft((current) => ({ ...current, videoPlan: typeof update === "function" ? update(normalizeProductVideoPlan(current.videoPlan)) : update }))}
          onClose={() => setVideoPlanOpen(false)}
        />
      ) : null}
      {previewImage ? (
        <ProductImagePreviewModal
          image={previewImage}
          loading={previewLoading}
          onClose={() => setPreviewImage(null)}
          onLoad={() => setPreviewLoading(false)}
        />
      ) : null}
    </div>
  );
}
