"use client";

import type { Dispatch, SetStateAction } from "react";
import { ExternalLink } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import type { ProductDraft, ProductStatus } from "@/lib/products/types";
import { newProductStatusOptions, productStatusOptions } from "@/data/products";
import { getCurrentWorkflowAssignee, formatAssigneePreview } from "@/lib/products/workflow";
import type { ProductEditorDraft } from "./product-workbench-model";
import { ProductEditorImagePanel } from "./product-editor-image-panel";
import { ProductWorkflowPanel } from "./product-workflow-panel";
import { ConclusionExcelField, MultiSelectField, ReadonlyField } from "./product-editor-fields";
import { DecimalInput, LabeledInput } from "./product-workbench-fields";
import { ProductPatentInformationSection } from "./product-patent-information";
import { ProductWorkbookDetailSections } from "./product-workbook-detail-sections";
import { ProductAttachmentActivityContext } from "./product-attachment-activity";
import { buildAmazonLink } from "./product-workbench-utils";
import type { useProductImageUploads } from "./use-product-image-uploads";
import type { useProductAttachmentActions } from "./use-product-attachment-actions";
import type { useProductWorkbookEditing } from "./use-product-workbook-editing";
import type { useProductWorkflowEditing } from "./use-product-workflow-editing";

type Props = {
  draft: ProductEditorDraft; setDraft: Dispatch<SetStateAction<ProductEditorDraft>>;
  disabled: boolean; ready: boolean; isEditing: boolean; workspaceId: string;
  selectionOwner: string; selectedOps: string[]; selectedDesigners: string[];
  opsOptions: string[]; designerOptions: string[];
  patentUploadBusy: boolean; setPatentUploadBusy: (busy: boolean) => void;
  trackWorkbookUpload: (delta: number) => void;
  images: ReturnType<typeof useProductImageUploads>;
  attachments: Pick<ReturnType<typeof useProductAttachmentActions>, "conclusionUploading" | "conclusionInputRef" | "openImagePreview">;
  workbook: ReturnType<typeof useProductWorkbookEditing>;
  workflow: ReturnType<typeof useProductWorkflowEditing>;
};

export function ProductEditorForm(p: Props) {
  const { draft, ready, images, attachments, workbook, workflow } = p;
  const link = buildAmazonLink(draft.asin);
  const assignee = getCurrentWorkflowAssignee(draft);
  function setField<K extends keyof ProductDraft>(field: K, value: ProductDraft[K]) { p.setDraft(current => ({ ...current, [field]: value })); }
  return <fieldset disabled={p.disabled} className="thin-scrollbar min-w-0 flex-1 overflow-auto p-5">
    <section className="space-y-4">
      <Card><CardContent className="grid gap-5 p-5 lg:grid-cols-[280px_minmax(0,1fr)]">
        <fieldset disabled={!ready} className="min-w-0">
          {!ready ? <p className="text-xs text-muted">完整图片附件待详情对齐</p> : null}
          <ProductEditorImagePanel imageAssets={draft.imageAssets} uploadingFiles={images.imageUploads} onPreview={asset => attachments.openImagePreview(asset, asset.thumbUrl)} onUpload={images.handleImageUpload} onCancelUpload={images.cancelImageUpload} onRetryUpload={images.retryImageUpload} onRemove={images.removeImage} />
        </fieldset>
        <div><h3 className="text-lg font-bold text-foreground">基础信息</h3><div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <ReadonlyField label="SKU（系统生成）" value={draft.sku} />
          <LabeledInput label="中文名（必填）" value={draft.chineseName} onChange={value => setField("chineseName", value)} />
          <LabeledInput label="英文名（必填）" value={draft.englishName} onChange={value => setField("englishName", value)} />
          <div className="space-y-1 text-xs font-semibold text-muted">主 ASIN<div className="flex items-end gap-2">
            <input className="h-8 w-full max-w-[220px] rounded-md border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-brand" value={draft.asin} onChange={event => setField("asin", event.target.value)} />
            <a className={`inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-border px-2.5 text-xs font-semibold ${link ? "text-brand hover:border-brand" : "pointer-events-none text-muted opacity-50"}`} href={link || "#"} target="_blank" rel="noreferrer"><ExternalLink className="h-3.5 w-3.5" />打开主 ASIN</a>
          </div></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-muted">采购价格 CNY<div className="mt-1"><DecimalInput value={draft.purchasePrice} onChange={value => setField("purchasePrice", value)} /></div></label>
            <label className="text-xs font-semibold text-muted">状态<select className="mt-1 h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-foreground outline-none focus:border-brand" value={draft.status} onChange={event => workflow.updateStatus(event.target.value as ProductStatus)}>{(p.isEditing ? productStatusOptions : newProductStatusOptions).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
          </div>
          {draft.status === "canceled" ? <fieldset disabled={!ready || attachments.conclusionUploading}><ConclusionExcelField file={draft.conclusionExcelFile} uploading={attachments.conclusionUploading} onUpload={() => attachments.conclusionInputRef.current?.click()} /></fieldset> : null}
          <div className="grid gap-3 sm:grid-cols-2"><ReadonlyField label="选品负责人" value={p.selectionOwner || "--"} /><ReadonlyField label="当前负责人" value={formatAssigneePreview(assignee) || "--"} title={assignee || "--"} /></div>
          <MultiSelectField label="运营负责人" value={p.selectedOps} options={p.opsOptions} onChange={value => workflow.updateAssigneeList("opsAssignees", value)} />
          <MultiSelectField label="美工负责人" value={p.selectedDesigners} options={p.designerOptions} onChange={value => workflow.updateAssigneeList("designerAssignees", value)} />
          <ProductWorkflowPanel draft={draft} ready={ready} hasOperations={p.selectedOps.length > 0} hasDesigners={p.selectedDesigners.length > 0} onMove={workflow.moveWorkflow} />
        </div></div>
      </CardContent></Card>
      {!ready ? <p className="text-xs text-muted">专利资料和 workbook 待详情对齐</p> : null}
      <fieldset disabled={!ready || p.patentUploadBusy} className="min-w-0"><ProductPatentInformationSection value={draft.patentInformation} onChange={patentInformation => setField("patentInformation", patentInformation)} onUploadStateChange={p.setPatentUploadBusy} /></fieldset>
      <ProductAttachmentActivityContext.Provider value={p.trackWorkbookUpload}><fieldset disabled={!ready} className="min-w-0">
        <ProductWorkbookDetailSections detail={draft.workbookDetail} onPricingChange={workbook.updateWorkbookPricingRow} onPricingCopy={workbook.copyWorkbookPricingRow} onPricingAdd={workbook.addWorkbookPricingRow} onPricingRemove={workbook.removeWorkbookPricingRow} onCompetitorChange={workbook.updateWorkbookCompetitor} onCompetitorAdd={workbook.addWorkbookCompetitor} onCompetitorRemove={workbook.removeWorkbookCompetitor} onSupplierChange={workbook.updateWorkbookSupplier} onSupplierAdd={workbook.addWorkbookSupplier} onSupplierRemove={workbook.removeWorkbookSupplier} onImprovementChange={workbook.updateWorkbookImprovement} onPeakSeasonWeightsChange={workbook.updateWorkbookPeakSeasonWeights} onImprovementRowChange={workbook.updateWorkbookImprovementRow} onKeywordChange={workbook.updateWorkbookKeyword} onKeywordsReplace={workbook.replaceWorkbookKeywords} onRemarkChange={value => workbook.setWorkbookDetail(current => ({ ...current, remark: value }))} onRemarkImagesChange={workbook.updateWorkbookRemarkImages} />
      </fieldset></ProductAttachmentActivityContext.Provider>
    </section>
  </fieldset>;
}
