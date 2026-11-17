"use client";

import { useRef, useState } from "react";
import { Download, Highlighter, Loader2, Minus, Plus, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog } from "@/components/ui/overlays";
import { AmazonLinkButton, GalleryCell, ImagePreviewModal } from "@/components/listing-ai/gallery-primitives";
import { MiniUploader } from "@/components/listing-ai/image-upload-primitives";
import { ListingAiAplusPanel } from "@/components/listing-ai/listing-ai-aplus-panel";
import { GallerySaveControls } from "@/components/listing-ai/gallery-save-controls";
import { clearGalleryImageAt, galleryImageRowCount, reserveGalleryUploadRows } from "@/lib/listing-ai/gallery-upload-slots";
import { galleryInputKeys } from "@/lib/listing-ai/gallery-snapshot";
import { blobToDataUrl, saveListingAiImageAsset } from "@/lib/listing-ai/image-assets";
import { galleryCellKey, normalizeGalleryRedRanges } from "@/lib/listing-ai/gallery-excel";
import type { ListingOptimizationRequest, ListingOptimizationResult } from "@/lib/listing-ai/types";
import { createEmptyCompetitor, fieldClass, type CompetitorDraft, type GalleryCellStyle, type GalleryInfoRow, type ImagePreview, type OwnImageDraft } from "@/lib/listing-ai/workspace-draft";
import { useGalleryExcelTransfer } from "./use-gallery-excel-transfer";
export function ImagesSection({
  competitors,
  ownImages,
  setCompetitors,
  setOwnImages,
  cellStyles,
  setCellStyles,
  input,
  update,
}: {
  competitors: CompetitorDraft[];
  ownImages: OwnImageDraft;
  setCompetitors: React.Dispatch<React.SetStateAction<CompetitorDraft[]>>;
  setOwnImages: React.Dispatch<React.SetStateAction<OwnImageDraft>>;
  cellStyles: Record<string, GalleryCellStyle>;
  setCellStyles: React.Dispatch<React.SetStateAction<Record<string, GalleryCellStyle>>>;
  input: ListingOptimizationRequest;
  update: <K extends keyof ListingOptimizationRequest>(
    key: K,
    value: ListingOptimizationRequest[K],
  ) => void;
  handleImageUpload: (
    files: FileList | null,
    callback: (images: ImagePreview[]) => void,
  ) => void;
}) {
  const [uploads, setUploads] = useState<Record<string, number>>({});
  const uploadSlots = useRef(new Map<string, { column: string; row: number }>());
  const uploading = Object.keys(uploads).length > 0;
  async function uploadGalleryImages(files: FileList | null, type: "mine" | "competitor", columnIndex: number, rowIndex?: number) {
    const selected = Array.from(files ?? []).slice(0, rowIndex === undefined ? 12 : 1);
    if (!selected.length || excelBusy) return;
    const columnKey = `${type}-${columnIndex}`;
    const currentImages = type === "mine" ? ownImages.images : competitors[columnIndex]?.images ?? [];
    const pendingRows = [...uploadSlots.current.values()].filter(slot => slot.column === columnKey).map(slot => slot.row);
    const rows = reserveGalleryUploadRows(currentImages, pendingRows, selected.length, rowIndex);
    if (rows.length !== selected.length) {
      setExcelError("没有足够的空图片位置，或该位置正在上传。");
      return;
    }
    const keys = rows.map(row => `${columnKey}-${row}`);
    keys.forEach((key, index) => uploadSlots.current.set(key, { column: columnKey, row: rows[index] }));
    setUploads(current => ({ ...current, ...Object.fromEntries(keys.map(key => [key, 0])) }));
    setExcelError(""); setExcelNotice("");
    for (const [index, file] of selected.entries()) {
      const key = keys[index];
      const row = rows[index];
      try {
        const asset = await saveListingAiImageAsset(file, { onUploadProgress: progress => {
          setUploads(current => ({ ...current, [key]: Math.round(progress * 100) }));
        } });
        const image = { name: asset.name, url: asset.url || await blobToDataUrl(asset.blob), assetId: asset.id };
        const applyImage = (current: ImagePreview[]) => {
          const next = Array.from({ length: Math.max(current.length, row + 1) }, (_, i) => current[i] ?? { name: "", url: "" });
          next[row] = image;
          return next;
        };
        if (type === "mine") setOwnImages(current => ({ ...current, images: applyImage(current.images) }));
        else setCompetitors(current => current.map((competitor, i) => i === columnIndex ? { ...competitor, images: applyImage(competitor.images) } : competitor));
      } catch (error) {
        setExcelError(error instanceof Error ? error.message : "图片上传失败，请在对应位置重试。");
      } finally {
        uploadSlots.current.delete(key);
        setUploads(current => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
    }
  }
  function removeGalleryImage(type: "mine" | "competitor", columnIndex: number, row: number) {
    if (type === "mine") setOwnImages(current => ({ ...current, images: clearGalleryImageAt(current.images, row) }));
    else setCompetitors(current => current.map((competitor, index) => index === columnIndex ? { ...competitor, images: clearGalleryImageAt(competitor.images, row) } : competitor));
  }
  const [draggedImage, setDraggedImage] = useState<{
    column: "mine" | "competitor";
    columnIndex: number;
    imageIndex: number;
  } | null>(null);
  const [previewImage, setPreviewImage] = useState<ImagePreview | null>(null);
  const [focusedCellKey, setFocusedCellKey] = useState("");
  const [clearGalleryConfirmOpen, setClearGalleryConfirmOpen] = useState(false);
  const selectedTextRangeRef = useRef<{
    styleKey: string;
    range: { start: number; end: number };
  } | null>(null);
  const maxRows = galleryImageRowCount(
    [...competitors.map(item => item.images), ownImages.images],
    [...uploadSlots.current.values()].map(slot => slot.row),
  );
  const competitorColumns = competitors.map((competitor, index) => ({
    key: `competitor-${index}`,
    type: "competitor" as const,
    label: `Competitor ${index + 1}`,
    images: competitor.images,
    index,
  }));
  const mineColumn = {
    key: "mine",
    type: "mine" as const,
    label: "Mine",
    images: ownImages.images,
    index: -1,
  };
  const imageColumns = [...competitorColumns, mineColumn];
  const tableWidth = 144 + competitorColumns.length * 260 + 260;

  function toggleFocusedCellStyle(styleKey: keyof GalleryCellStyle) {
    if (!focusedCellKey) return;
    setCellStyles((current) => {
      const currentStyle = current[focusedCellKey] ?? {};
      const nextStyle = { ...currentStyle, [styleKey]: !currentStyle[styleKey] };
      const next = { ...current };
      if (!nextStyle.redText && !nextStyle.yellowBg && !nextStyle.redRanges?.length) {
        delete next[focusedCellKey];
      } else {
        next[focusedCellKey] = nextStyle;
      }
      return next;
    });
  }

  function escapeHtml(value: string) {
    return value
      .replace(/&/gu, "&amp;")
      .replace(/</gu, "&lt;")
      .replace(/>/gu, "&gt;")
      .replace(/"/gu, "&quot;")
      .replace(/'/gu, "&#39;");
  }

  function normalizedRedRanges(value: string, styleKey?: string) {
    return normalizeGalleryRedRanges(
      value,
      styleKey ? cellStyles[styleKey] : undefined,
    );
  }

  function richCellHtml(value: string, styleKey?: string) {
    const ranges = normalizedRedRanges(value, styleKey);
    if (!ranges.length) return escapeHtml(value);

    const parts: string[] = [];
    let cursor = 0;
    ranges.forEach((range) => {
      const start = Math.max(cursor, range.start);
      const end = Math.max(start, range.end);
      if (start > cursor) parts.push(escapeHtml(value.slice(cursor, start)));
      parts.push(
        `<span class="font-bold text-danger-ink">${escapeHtml(value.slice(start, end))}</span>`,
      );
      cursor = end;
    });
    if (cursor < value.length) parts.push(escapeHtml(value.slice(cursor)));
    return parts.join("");
  }

  function selectedRangeInFocusedCell() {
    if (!focusedCellKey) return null;
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
    const editor = document.querySelector(
      `[data-gallery-cell-key="${CSS.escape(focusedCellKey)}"]`,
    );
    if (!editor) return null;
    const range = selection.getRangeAt(0);
    if (
      !editor.contains(range.startContainer) ||
      !editor.contains(range.endContainer)
    ) {
      return null;
    }

    const beforeStart = range.cloneRange();
    beforeStart.selectNodeContents(editor);
    beforeStart.setEnd(range.startContainer, range.startOffset);
    const beforeEnd = range.cloneRange();
    beforeEnd.selectNodeContents(editor);
    beforeEnd.setEnd(range.endContainer, range.endOffset);
    const start = beforeStart.toString().length;
    const end = beforeEnd.toString().length;
    return end > start ? { start, end } : null;
  }

  function markSelectedTextRed() {
    const selectedRange =
      selectedRangeInFocusedCell() ??
      (selectedTextRangeRef.current?.styleKey === focusedCellKey
        ? selectedTextRangeRef.current.range
        : null);
    if (!selectedRange) {
      toggleFocusedCellStyle("redText");
      return;
    }
    setCellStyles((current) => {
      const currentStyle = current[focusedCellKey] ?? {};
      return {
        ...current,
        [focusedCellKey]: {
          ...currentStyle,
          redRanges: [...(currentStyle.redRanges ?? []), selectedRange],
        },
      };
    });
    selectedTextRangeRef.current = null;
    window.getSelection()?.removeAllRanges();
  }

  function styleClasses(styleKey?: string) {
    const style = styleKey ? cellStyles[styleKey] : undefined;
    return [
      style?.redText ? "text-danger-ink font-bold" : "text-foreground",
      style?.yellowBg ? "bg-warning-soft" : "bg-surface",
    ].join(" ");
  }

  function setColumnImages(
    type: "mine" | "competitor",
    columnIndex: number,
    images: ImagePreview[],
  ) {
    if (type === "mine") {
      setOwnImages((current) => ({ ...current, images }));
      return;
    }

    setCompetitors((current) =>
      current.map((competitor, index) =>
        index === columnIndex ? { ...competitor, images } : competitor,
      ),
    );
  }

  function moveImage(
    type: "mine" | "competitor",
    columnIndex: number,
    fromIndex: number,
    toIndex: number,
  ) {
    const column = imageColumns.find(
      (item) => item.type === type && item.index === columnIndex,
    );
    if (!column || toIndex < 0 || toIndex >= column.images.length) {
      return;
    }

    const nextImages = [...column.images];
    const [movedImage] = nextImages.splice(fromIndex, 1);
    if (!movedImage) {
      return;
    }
    nextImages.splice(toIndex, 0, movedImage);
    setColumnImages(type, columnIndex, nextImages);
  }

  function handleDrop(
    type: "mine" | "competitor",
    columnIndex: number,
    targetIndex: number,
  ) {
    if (
      !draggedImage ||
      draggedImage.column !== type ||
      draggedImage.columnIndex !== columnIndex
    ) {
      setDraggedImage(null);
      return;
    }

    moveImage(type, columnIndex, draggedImage.imageIndex, targetIndex);
    setDraggedImage(null);
  }

  function addCompetitorColumn() {
    setCompetitors((current) => [...current, createEmptyCompetitor()]);
  }

  function removeCompetitorColumn() {
    setCompetitors((current) =>
      current.length > 1 ? current.slice(0, current.length - 1) : current,
    );
  }

  function clearGallery() {
    setCompetitors((current) => current.map(() => createEmptyCompetitor()));
    setOwnImages((current) => ({
      ...current,
      structureNotes: "",
      mainImage: [],
      images: [],
      imageNotes: [],
      sales: "",
      price: "",
      rating: "",
      reviewCount: "",
    }));
    setCellStyles({});
    const clearInputKeys: Array<keyof ListingOptimizationRequest> = [
      "asin",
      "mainSellingPoint1",
      "variationInfo",
      "currentTitle",
      "currentBullets",
      "aplusRequirements",
    ];
    clearInputKeys.forEach((key) => update(key, ""));
    setFocusedCellKey("");
    selectedTextRangeRef.current = null;
    setClearGalleryConfirmOpen(false);
  }

  function updateImageNote(index: number, value: string) {
    setOwnImages((current) => {
      const imageNotes = [...(current.imageNotes ?? [])];
      imageNotes[index] = value;
      return { ...current, imageNotes };
    });
  }

  function updateOwnImagesField(
    key: keyof Pick<OwnImageDraft, "sales" | "price" | "rating" | "reviewCount">,
    value: string,
  ) {
    setOwnImages((current) => ({ ...current, [key]: value }));
  }

  function updateCompetitorField(
    columnIndex: number,
    key: keyof Pick<
      CompetitorDraft,
      | "asin"
      | "sales"
      | "price"
      | "variation"
      | "rating"
      | "reviewCount"
      | "title"
      | "productFeatures"
      | "aplus"
    >,
    value: string,
  ) {
    setCompetitors((current) =>
      current.map((competitor, index) =>
        index === columnIndex ? { ...competitor, [key]: value } : competitor,
      ),
    );
  }

  function getBulletLine(text: string, index: number) {
    return text.split(/\n/)[index] ?? "";
  }

  function updateBulletLine(text: string, index: number, value: string) {
    const lines = text.split(/\n/);
    while (lines.length <= index) {
      lines.push("");
    }
    lines[index] = value;
    return lines.join("\n").replace(/\n+$/u, "");
  }

  function updateCompetitorBullet(columnIndex: number, bulletIndex: number, value: string) {
    setCompetitors((current) =>
      current.map((competitor, index) =>
        index === columnIndex
          ? {
              ...competitor,
              bullets: updateBulletLine(competitor.bullets, bulletIndex, value),
            }
          : competitor,
      ),
    );
  }

  function renderAsinCell(
    value: string,
    onChange: (value: string) => void,
    styleKey: string,
  ) {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)_36px] gap-2">
        {renderTextCell(value, onChange, false, false, styleKey)}
        <AmazonLinkButton asin={value} />
      </div>
    );
  }

  function renderTextCell(
    value: string,
    onChange: (value: string) => void,
    multiline = false,
    tall = false,
    styleKey?: string,
  ) {
    const selectCell = () => {
      if (styleKey) setFocusedCellKey(styleKey);
    };
    const rememberSelection = () => {
      if (!styleKey) return;
      const range = selectedRangeInFocusedCell();
      if (range) selectedTextRangeRef.current = { styleKey, range };
    };

    return (
      <div
        role="textbox"
        aria-multiline={multiline}
        contentEditable
        suppressContentEditableWarning
        data-gallery-cell-key={styleKey}
        className={`${multiline ? (tall ? "h-[150px]" : "h-24") : "h-9"} w-full overflow-auto rounded-md border border-border px-2 py-1.5 text-xs leading-5 outline-none transition focus:border-brand focus:ring-2 focus:ring-brand/10 ${multiline ? "whitespace-pre-wrap" : "whitespace-nowrap"} ${styleClasses(styleKey)}`}
        dangerouslySetInnerHTML={{ __html: richCellHtml(value, styleKey) }}
        onFocus={selectCell}
        onClick={selectCell}
        onMouseUp={rememberSelection}
        onKeyUp={rememberSelection}
        onInput={(event) => onChange(event.currentTarget.innerText.replace(/\n$/u, ""))}
        onKeyDown={(event) => {
          if (!multiline && event.key === "Enter") event.preventDefault();
        }}
      />
    );
  }

  const infoRows: GalleryInfoRow[] = [
    {
      label: "ASIN",
      mineValue: input.asin,
      updateMine: (value: string) => update("asin", value.trim()),
      competitorValue: (competitor: CompetitorDraft) => competitor.asin,
      updateCompetitor: (columnIndex: number, value: string) =>
        updateCompetitorField(columnIndex, "asin", value.trim()),
      asin: true,
    },
    {
      label: "产品卖点",
      mineValue: input.mainSellingPoint1,
      updateMine: (value: string) => update("mainSellingPoint1", value),
      competitorValue: (competitor: CompetitorDraft) => competitor.productFeatures,
      updateCompetitor: (columnIndex: number, value: string) =>
        updateCompetitorField(columnIndex, "productFeatures", value),
      multiline: true,
    },
    {
      label: "销量",
      mineValue: ownImages.sales,
      updateMine: (value: string) => updateOwnImagesField("sales", value),
      competitorValue: (competitor: CompetitorDraft) => competitor.sales,
      updateCompetitor: (columnIndex: number, value: string) =>
        updateCompetitorField(columnIndex, "sales", value),
    },
    {
      label: "价格",
      mineValue: ownImages.price,
      updateMine: (value: string) => updateOwnImagesField("price", value),
      competitorValue: (competitor: CompetitorDraft) => competitor.price,
      updateCompetitor: (columnIndex: number, value: string) =>
        updateCompetitorField(columnIndex, "price", value),
    },
    {
      label: "变体",
      mineValue: input.variationInfo,
      updateMine: (value: string) => update("variationInfo", value),
      competitorValue: (competitor: CompetitorDraft) => competitor.variation,
      updateCompetitor: (columnIndex: number, value: string) =>
        updateCompetitorField(columnIndex, "variation", value),
    },
    {
      label: "星级",
      mineValue: ownImages.rating,
      updateMine: (value: string) => updateOwnImagesField("rating", value),
      competitorValue: (competitor: CompetitorDraft) => competitor.rating,
      updateCompetitor: (columnIndex: number, value: string) =>
        updateCompetitorField(columnIndex, "rating", value),
    },
    {
      label: "评论数",
      mineValue: ownImages.reviewCount,
      updateMine: (value: string) => updateOwnImagesField("reviewCount", value),
      competitorValue: (competitor: CompetitorDraft) => competitor.reviewCount,
      updateCompetitor: (columnIndex: number, value: string) =>
        updateCompetitorField(columnIndex, "reviewCount", value),
    },
    {
      label: "标题",
      mineValue: input.currentTitle,
      updateMine: (value: string) => update("currentTitle", value),
      competitorValue: (competitor: CompetitorDraft) => competitor.title,
      updateCompetitor: (columnIndex: number, value: string) =>
        updateCompetitorField(columnIndex, "title", value),
      multiline: true,
    },
    ...Array.from({ length: 6 }).map((_, index) => ({
      label: `5点${index + 1}`,
      mineValue: getBulletLine(input.currentBullets, index),
      updateMine: (value: string) =>
        update("currentBullets", updateBulletLine(input.currentBullets, index, value)),
      competitorValue: (competitor: CompetitorDraft) =>
        getBulletLine(competitor.bullets, index),
      updateCompetitor: (columnIndex: number, value: string) =>
        updateCompetitorBullet(columnIndex, index, value),
      multiline: true,
      tall: true,
    })),
  ];

  const aplusRow = {
    label: "A+",
    mineValue: input.aplusRequirements,
    updateMine: (value: string) => update("aplusRequirements", value),
    competitorValue: (competitor: CompetitorDraft) => competitor.aplus,
    updateCompetitor: (columnIndex: number, value: string) =>
      updateCompetitorField(columnIndex, "aplus", value),
    multiline: true,
  };
  const imageRowLabels = Array.from({ length: maxRows }).map(
    (_, index) => `Image ${index + 1}`,
  );
  const excelRows = [...imageRowLabels, ...infoRows.map((row) => row.label), aplusRow.label];
  const { importInputRef, excelBusy, excelError, excelNotice, setExcelError, setExcelNotice, handleExportGalleryExcel, handleImportGalleryExcel } = useGalleryExcelTransfer({ competitors, ownImages, input, cellStyles, competitorColumns, mineColumn, excelRows, infoRows, imageRowLabels, aplusRow, maxRows, updateBulletLine, setCompetitors, setOwnImages, setCellStyles, update });


  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3">
          <GallerySaveControls
            snapshot={{ competitors, ownImages, input, cellStyles }}
            disabled={excelBusy || uploading}
            onRestore={(snapshot) => {
              setCompetitors(snapshot.competitors);
              setOwnImages(snapshot.ownImages);
              setCellStyles(snapshot.cellStyles);
              galleryInputKeys.forEach(key => update(key, snapshot.input[key]));
              setFocusedCellKey("");
              selectedTextRangeRef.current = null;
              setPreviewImage(null);
              setExcelError("");
              setExcelNotice("");
            }}
          />
          <div className="flex flex-wrap items-center justify-end gap-2">
            <input
              ref={importInputRef}
              type="file"
              accept=".xlsx"
              className="hidden"
              onChange={(event) =>
                void handleImportGalleryExcel(event.target.files?.[0] ?? null)
              }
            />
            {excelError ? (
              <span className="max-w-md truncate text-xs font-semibold text-danger-ink">
                {excelError}
              </span>
            ) : null}
            {excelNotice ? (
              <span className="max-w-md truncate text-xs font-semibold text-muted">
                {excelNotice}
              </span>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              disabled={!focusedCellKey}
              onClick={markSelectedTextRed}
              title="当前单元格文字标红"
            >
              <span className="text-base font-black leading-none text-danger-ink">A</span>
              红字
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={!focusedCellKey}
              onClick={() => toggleFocusedCellStyle("yellowBg")}
              title="当前单元格背景标黄"
            >
              <Highlighter className="h-4 w-4 text-warning-ink" />
              黄底
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={excelBusy || uploading}
              onClick={() => importInputRef.current?.click()}
            >
              <Upload className="h-4 w-4" />
              导入
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={excelBusy}
              onClick={() => void handleExportGalleryExcel()}
            >
              {excelBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              导出
            </Button>
            <Button
              variant="danger"
              size="sm"
              disabled={excelBusy || uploading}
              onClick={() => setClearGalleryConfirmOpen(true)}
              title="清空当前图片表格中的图片和文字"
            >
              <Trash2 className="h-4 w-4" />
              清空
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[1030px] overflow-auto thin-scrollbar">
          <table
            className="min-w-full table-fixed text-left text-sm"
            style={{ width: tableWidth }}
          >
            <thead className="sticky top-0 z-10 bg-surface-muted text-xs font-bold text-muted">
              <tr>
                <th className="sticky left-0 z-20 w-36 bg-surface-muted px-4 py-3">
                  <div className="flex items-center gap-1">
            <Button
              variant="secondary"
              size="icon"
              className="h-7 w-7"
              disabled={excelBusy}
              onClick={addCompetitorColumn}
              title="增加竞品列"
              aria-label="增加竞品列"
            >
              <Plus className="h-4 w-4" />
            </Button>
            <Button
              variant="secondary"
              size="icon"
              className="h-7 w-7"
              disabled={excelBusy || uploading || competitors.length <= 1}
              onClick={removeCompetitorColumn}
              title="减少竞品列"
              aria-label="减少竞品列"
            >
              <Minus className="h-4 w-4" />
            </Button>
                  </div>
                </th>
                {competitorColumns.map((column) => (
                  <th key={column.key} className="w-[260px] px-4 py-3">
                    <div className="flex items-center justify-between gap-2">
                      <span>{column.label}</span>
                      <MiniUploader
                        images={column.images}
                        disabled={excelBusy}
                        label="Upload"
                        onUpload={(files) =>
                          void uploadGalleryImages(files, column.type, column.index)
                        }
                      />
                    </div>
                  </th>
                ))}
                <th className="w-[260px] px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span>{mineColumn.label}</span>
                    <MiniUploader
                      images={mineColumn.images}
                      disabled={excelBusy}
                      label="Upload"
                      onUpload={(files) =>
                        void uploadGalleryImages(files, mineColumn.type, mineColumn.index)
                      }
                    />
                  </div>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {Array.from({ length: maxRows }).map((_, index) => (
                <tr key={index}>
                  <td className="sticky left-0 z-[1] bg-surface px-3 py-3 align-middle">
                    <label className="block text-sm font-black text-foreground">
                      Image {index + 1}
                    </label>
                    <textarea
                      className="mt-2 h-[200px] w-full resize-none rounded-md border border-border bg-surface px-2 py-1.5 text-xs font-medium leading-5 text-foreground outline-none transition placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/10"
                      value={ownImages.imageNotes?.[index] ?? ""}
                      onChange={(event) =>
                        updateImageNote(index, event.target.value)
                      }
                      placeholder="备注"
                    />
                  </td>
                  {competitorColumns.map((column) => (
                    <td key={column.key} className="px-4 py-3 align-top">
                      <GalleryCell
                        image={column.images[index]?.url ? column.images[index] : undefined}
                        disabled={excelBusy || uploads[`${column.type}-${column.index}-${index}`] !== undefined}
                        uploadProgress={uploads[`${column.type}-${column.index}-${index}`]}
                        onUpload={files => void uploadGalleryImages(files, column.type, column.index, index)}
                        onRemove={() => removeGalleryImage(column.type, column.index, index)}
                        draggable={!uploading && Boolean(column.images[index]?.url)}
                        onDragStart={() =>
                          setDraggedImage({
                            column: column.type,
                            columnIndex: column.index,
                            imageIndex: index,
                          })
                        }
                        onDragOver={(event) => event.preventDefault()}
                        onDrop={() =>
                          !excelBusy && !uploading && handleDrop(column.type, column.index, index)
                        }
                        onMoveUp={() =>
                          moveImage(column.type, column.index, index, index - 1)
                        }
                        onMoveDown={() =>
                          moveImage(column.type, column.index, index, index + 1)
                        }
                        canMoveUp={index > 0}
                        canMoveDown={index < column.images.length - 1}
                        onPreview={() => setPreviewImage(column.images[index])}
                      />
                    </td>
                  ))}
                  <td className="px-4 py-3 align-top">
                    <GalleryCell
                      image={mineColumn.images[index]?.url ? mineColumn.images[index] : undefined}
                        disabled={excelBusy || uploads[`${mineColumn.type}-${mineColumn.index}-${index}`] !== undefined}
                        uploadProgress={uploads[`${mineColumn.type}-${mineColumn.index}-${index}`]}
                        onUpload={files => void uploadGalleryImages(files, mineColumn.type, mineColumn.index, index)}
                        onRemove={() => removeGalleryImage(mineColumn.type, mineColumn.index, index)}
                      mine
                      draggable={!uploading && Boolean(mineColumn.images[index]?.url)}
                      onDragStart={() =>
                        setDraggedImage({
                          column: mineColumn.type,
                          columnIndex: mineColumn.index,
                          imageIndex: index,
                        })
                      }
                      onDragOver={(event) => event.preventDefault()}
                      onDrop={() =>
                        !excelBusy && !uploading && handleDrop(mineColumn.type, mineColumn.index, index)
                      }
                      onMoveUp={() =>
                        moveImage(mineColumn.type, mineColumn.index, index, index - 1)
                      }
                      onMoveDown={() =>
                        moveImage(mineColumn.type, mineColumn.index, index, index + 1)
                      }
                      canMoveUp={index > 0}
                      canMoveDown={index < mineColumn.images.length - 1}
                      onPreview={() => setPreviewImage(mineColumn.images[index])}
                    />
                  </td>
                </tr>
              ))}
              {infoRows.map((row) => (
                <tr key={row.label}>
                  <td className="sticky left-0 z-[1] bg-surface px-3 py-3 align-middle text-sm font-black text-foreground">
                    {row.label}
                  </td>
                  {competitorColumns.map((column) => {
                    const competitor = competitors[column.index];
                    const value = competitor ? row.competitorValue(competitor) : "";
                    const styleKey = galleryCellKey(row.label, column.key);
                    return (
                      <td key={column.key} className="px-4 py-3 align-top">
                        {row.asin
                          ? renderAsinCell(value, (nextValue) =>
                              row.updateCompetitor(column.index, nextValue),
                              styleKey,
                            )
                          : renderTextCell(
                              value,
                              (nextValue) =>
                                row.updateCompetitor(column.index, nextValue),
                              row.multiline,
                              row.tall,
                              styleKey,
                            )}
                      </td>
                    );
                  })}
                  <td className="px-4 py-3 align-top">
                    {row.asin
                      ? renderAsinCell(
                          row.mineValue,
                          row.updateMine,
                          galleryCellKey(row.label, mineColumn.key),
                        )
                      : renderTextCell(
                          row.mineValue,
                          row.updateMine,
                          row.multiline,
                          row.tall,
                          galleryCellKey(row.label, mineColumn.key),
                        )}
                  </td>
                </tr>
              ))}
              <tr>
                <td className="sticky left-0 z-[1] bg-surface px-3 py-3 align-middle text-sm font-black text-foreground">
                  {aplusRow.label}
                </td>
                {competitorColumns.map((column) => {
                  const competitor = competitors[column.index];
                  const styleKey = galleryCellKey(aplusRow.label, column.key);
                  return (
                    <td key={column.key} className="px-4 py-3 align-top">
                      {renderTextCell(
                        competitor ? aplusRow.competitorValue(competitor) : "",
                        (value) => aplusRow.updateCompetitor(column.index, value),
                        aplusRow.multiline,
                        false,
                        styleKey,
                      )}
                    </td>
                  );
                })}
                <td className="px-4 py-3 align-top">
                  {renderTextCell(
                    aplusRow.mineValue,
                    aplusRow.updateMine,
                    aplusRow.multiline,
                    false,
                    galleryCellKey(aplusRow.label, mineColumn.key),
                  )}
                </td>
              </tr>
            </tbody>
          </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Image Assets Notes</CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            className={`${fieldClass} min-h-32 resize-y`}
            value={ownImages.structureNotes}
            onChange={(event) =>
              setOwnImages((current) => ({
                ...current,
                structureNotes: event.target.value,
              }))
            }
            placeholder="记录自身图片结构、差距、希望 AI 策划强化的方向"
          />
        </CardContent>
      </Card>
      {previewImage ? (
        <ImagePreviewModal
          image={previewImage}
          onClose={() => setPreviewImage(null)}
        />
      ) : null}
      {clearGalleryConfirmOpen ? (
        <Dialog open bare zIndex="modal" onClose={() => setClearGalleryConfirmOpen(false)}>
          <div
            className="mx-auto w-full max-w-md rounded-lg bg-surface p-6 shadow-2xl"
            role="dialog"
            aria-modal="true"
            aria-labelledby="clear-gallery-title"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="clear-gallery-title" className="text-lg font-bold text-foreground">
              确认清空图片和文字？
            </h3>
            <p className="mt-2 text-sm leading-6 text-muted">
              将清空当前 Images &amp; A+ 页中的所有图片、备注、竞品资料、标题、五点和 A+ 内容。此操作只影响当前草稿，不能自动恢复。
            </p>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setClearGalleryConfirmOpen(false)}
              >
                取消
              </Button>
              <Button variant="danger" size="sm" onClick={clearGallery}>
                <Trash2 className="h-4 w-4" />
                确认清空
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </div>
  );
}

export function VisualAplusSection({
  competitors,
  ownImages,
  setCompetitors,
  setOwnImages,
  cellStyles,
  setCellStyles,
  input,
  update,
  error,
  canSubmit,
  loading,
  onGenerate,
  result,
  handleImageUpload,
}: {
  competitors: CompetitorDraft[];
  ownImages: OwnImageDraft;
  setCompetitors: React.Dispatch<React.SetStateAction<CompetitorDraft[]>>;
  setOwnImages: React.Dispatch<React.SetStateAction<OwnImageDraft>>;
  cellStyles: Record<string, GalleryCellStyle>;
  setCellStyles: React.Dispatch<React.SetStateAction<Record<string, GalleryCellStyle>>>;
  input: ListingOptimizationRequest;
  update: <K extends keyof ListingOptimizationRequest>(
    key: K,
    value: ListingOptimizationRequest[K],
  ) => void;
  error: string;
  canSubmit: boolean;
  loading: boolean;
  onGenerate: () => void;
  result: ListingOptimizationResult | null;
  handleImageUpload: (
    files: FileList | null,
    callback: (images: ImagePreview[]) => void,
  ) => void;
}) {
  return (
    <div className="space-y-4">
      <ImagesSection
        competitors={competitors}
        ownImages={ownImages}
        setCompetitors={setCompetitors}
        setOwnImages={setOwnImages}
        cellStyles={cellStyles}
        setCellStyles={setCellStyles}
        input={input}
        update={update}
        handleImageUpload={handleImageUpload}
      />
      <ListingAiAplusPanel
        result={result}
        input={input}
        update={update}
        error={error}
        canSubmit={canSubmit}
        loading={loading}
        onGenerate={onGenerate}
      />
    </div>
  );
}
