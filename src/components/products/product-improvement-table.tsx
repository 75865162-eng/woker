"use client";

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { ImagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useProductAttachmentActivity } from "./product-attachment-activity";
import { uploadProductImageAsset } from "@/lib/products/image-assets";
import type { ProductImageAsset } from "@/lib/products/types";
import { createDefaultPeakSeasonWeights, improvementColumns, peakSeasonMonths, peakSeasonWeightLevels, type TrialImprovement, type TrialImprovementCellKey, type TrialImprovementRow, type TrialProductDraft } from "./product-workbench-model";
import { ProductImageUploadProgressCard, type ProductImageUploadProgress } from "./product-editor-image-panel";
import { parseNegativePointValue } from "./product-negative-point-editor";
import { PeakSeasonInsights } from "./peak-season-insights";
export function createEmptyImprovementRow(): TrialImprovementRow {
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

export function getImprovementRow(improvement: TrialImprovement, index: number): TrialImprovementRow {
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

export function ImprovementTable({
  detail,
  improvement,
  onChange,
  onPeakSeasonWeightsChange,
  onRowChange,
  onRemarkImagesChange,
}: {
  detail: TrialProductDraft;
  improvement: TrialImprovement;
  onChange: (field: Exclude<keyof TrialImprovement, "rows" | "peakSeasonWeights">, value: string) => void;
  onPeakSeasonWeightsChange: (value: number[]) => void;
  onRowChange: (index: number, field: TrialImprovementCellKey, value: string) => void;
  onRemarkImagesChange: (images: string[], imageAssets?: ProductImageAsset[]) => void;
}) {
  const painRows = buildImprovementPainRows(detail);
  const visiblePainRows = painRows.length ? painRows : [{ summary: "", count: "" }];
  const improvementColumnWidths = improvementColumns.map((column) => getImprovementColumnWidth(improvement, visiblePainRows.length, column.field));
  const tableWidth = 412 + improvementColumnWidths.reduce((total, width) => total + width, 0);
  const remarkUploadRef = useRef<HTMLInputElement | null>(null);
  const [remarkUploading, setRemarkUploading] = useState(false);
  useProductAttachmentActivity(remarkUploading);
  const [remarkUploadError, setRemarkUploadError] = useState("");
  const [remarkUploadingFiles, setRemarkUploadingFiles] = useState<ProductImageUploadProgress[]>([]);

  async function handleRemarkUpload(files: FileList | null) {
    const selected = Array.from(files ?? []);
    if (!selected.length) {
      return;
    }

    setRemarkUploading(true);
    const uploads = selected.map((file, index) => ({
      id: `remark-image-upload-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 8)}`,
      file,
    }));
    setRemarkUploadingFiles(uploads.map(({ id, file }) => ({ id, name: file.name, progress: 0 })));
    setRemarkUploadError("");

    try {
      const results = await Promise.allSettled(
        uploads.map(({ id, file }) =>
          uploadProductImageAsset(file, {
            onUploadProgress: (progress) => {
              setRemarkUploadingFiles((current) => current.map((item) => (item.id === id ? { ...item, progress } : item)));
            },
          }),
        ),
      );
      const nextAssets = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
      const firstError = results.find((result) => result.status === "rejected");

      if (nextAssets.length) {
        onRemarkImagesChange(
          [...detail.remarkImages, ...nextAssets.map((asset) => asset.thumbUrl || asset.originalUrl)],
          [...(detail.remarkImageAssets ?? []), ...nextAssets],
        );
      }

      if (firstError && firstError.status === "rejected") {
        setRemarkUploadError(firstError.reason instanceof Error ? firstError.reason.message : "图片上传失败。");
      }
    } finally {
      setRemarkUploading(false);
      setRemarkUploadingFiles([]);
    }
  }

  return (
    <div className="relative">
      <input
        ref={remarkUploadRef}
        className="hidden"
        type="file"
        accept="image/*"
        multiple
        onChange={(event) => {
          void handleRemarkUpload(event.target.files);
          event.currentTarget.value = "";
        }}
      />
      <table className="table-fixed overflow-hidden rounded-md border border-border text-left text-xs" style={{ width: tableWidth }}>
        <colgroup>
          <col style={{ width: 120 }} />
          <col style={{ width: 220 }} />
          <col style={{ width: 72 }} />
          {improvementColumns.map((column, index) => (
            <col key={column.field} style={{ width: improvementColumnWidths[index] }} />
          ))}
        </colgroup>
        <tbody>
          <tr>
            <ImprovementHeader colSpan={3}>使用人群</ImprovementHeader>
            <ImprovementHeader colSpan={3}>主要适用场景</ImprovementHeader>
            <ImprovementHeader colSpan={2}>目标销量</ImprovementHeader>
            <ImprovementHeader colSpan={2}>头部旺季平均销量</ImprovementHeader>
            <ImprovementHeader colSpan={2}>头部淡季平均销量</ImprovementHeader>
          </tr>
          <tr>
            <ImprovementCell colSpan={3}>
              <ImprovementInput value={improvement.audience} placeholder="填空格" onChange={(value) => onChange("audience", value)} />
            </ImprovementCell>
            <ImprovementCell colSpan={3}>
              <ImprovementInput value={improvement.scenario} placeholder="填空格" onChange={(value) => onChange("scenario", value)} />
            </ImprovementCell>
            <ImprovementCell colSpan={2} className="font-bold">
              <ImprovementInput numeric value={improvement.targetSales} onChange={(value) => onChange("targetSales", value)} />
            </ImprovementCell>
            <ImprovementCell colSpan={2}>
              <ImprovementInput value={improvement.peakSales} onChange={(value) => onChange("peakSales", value)} />
            </ImprovementCell>
            <ImprovementCell colSpan={2}>
              <ImprovementInput value={improvement.offSeasonSales} onChange={(value) => onChange("offSeasonSales", value)} />
            </ImprovementCell>
          </tr>
          <tr>
            <td colSpan={12} className="border-b border-r border-border bg-surface px-1 py-1 first:border-l">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-stretch">
                <div className="shrink-0">
                  <PeakSeasonWeightMatrix
                    value={improvement.peakSeasonWeights}
                    onChange={onPeakSeasonWeightsChange}
                    onReset={() => onPeakSeasonWeightsChange(createDefaultPeakSeasonWeights())}
                  />
                </div>
                <PeakSeasonInsights
                  weights={improvement.peakSeasonWeights}
                  monthlyTargetSales={improvement.targetSales}
                />
              </div>
            </td>
          </tr>
          <tr>
            <ImprovementSubHeader>产品改进点</ImprovementSubHeader>
            <ImprovementSubHeader>差评</ImprovementSubHeader>
            <ImprovementSubHeader>数量</ImprovementSubHeader>
            {improvementColumns.map((column, index) => (
              <ImprovementSubHeader key={column.field} style={{ width: improvementColumnWidths[index], maxWidth: 300 }}>
                {column.field === "certification" ? (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span>{column.label}</span>
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-6 shrink-0 px-2 text-label"
                        disabled={remarkUploading}
                        onClick={() => remarkUploadRef.current?.click()}
                      >
                        <ImagePlus className="h-3.5 w-3.5" />
                        {remarkUploading ? "上传中" : "批量上传"}
                      </Button>
                    </div>
                    {remarkUploadError ? <p className="text-label font-semibold text-danger">{remarkUploadError}</p> : null}
                  </div>
                ) : (
                  column.label
                )}
              </ImprovementSubHeader>
            ))}
          </tr>
          {visiblePainRows.map((pain, index) => {
            const improvementRow = getImprovementRow(improvement, index);

            return (
              <tr key={index}>
                <ImprovementCell className="text-center font-bold">差评点{index + 1}</ImprovementCell>
                <ImprovementCell>{pain?.summary ?? ""}</ImprovementCell>
                <ImprovementCell>{pain?.count ?? ""}</ImprovementCell>
                {improvementColumns.map((column, columnIndex) => (
                  <ImprovementCell key={column.field} style={{ width: improvementColumnWidths[columnIndex], maxWidth: 300 }}>
                    <ImprovementInput
                      multiline
                      width={improvementColumnWidths[columnIndex] - 16}
                      value={improvementRow[column.field]}
                      onChange={(value) => onRowChange(index, column.field, value)}
                    />
                  </ImprovementCell>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      {remarkUploadingFiles.length ? (
        <div className="mt-2 grid max-w-[720px] gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {remarkUploadingFiles.map((upload) => (
            <ProductImageUploadProgressCard key={upload.id} upload={upload} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function getImprovementColumnWidth(improvement: TrialImprovement, rowCount: number, field: TrialImprovementCellKey) {
  const values = Array.from({ length: rowCount }, (_, index) => getImprovementRow(improvement, index)[field]);
  const longestLineLength = Math.max(
    0,
    ...values.flatMap((value) => value.split(/\r?\n/).map((line) => Array.from(line.trim()).length)),
  );

  if (longestLineLength === 0) {
    return 100;
  }

  return Math.min(300, Math.max(100, longestLineLength * 12 + 28));
}

export function ImprovementHeader({
  children,
  className = "",
  colSpan,
  style,
}: {
  children: ReactNode;
  className?: string;
  colSpan?: number;
  style?: CSSProperties;
}) {
  return (
    <th
      colSpan={colSpan}
      style={style}
      className={`whitespace-normal break-words border-b border-r border-border bg-surface-muted px-2 py-2 font-bold leading-5 text-muted first:border-l ${className}`}
    >
      {children}
    </th>
  );
}

export function ImprovementSubHeader({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  return (
    <td
      style={style}
      className={`whitespace-normal break-words border-b border-r border-border bg-surface-muted px-2 py-2 font-bold leading-5 text-muted first:border-l ${className}`}
    >
      {children}
    </td>
  );
}

export function ImprovementCell({
  children,
  className = "",
  colSpan,
  style,
}: {
  children?: ReactNode;
  className?: string;
  colSpan?: number;
  style?: CSSProperties;
}) {
  return <td colSpan={colSpan} style={style} className={`h-9 border-b border-r border-border bg-surface px-2 py-1 align-top text-foreground first:border-l ${className}`}>{children}</td>;
}

/** 仅保留数字与单个小数点，用于"目标销量"等纯数值输入。 */
function sanitizeNumericInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, "");
  const dot = cleaned.indexOf(".");
  if (dot < 0) return cleaned;
  return cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, "");
}

export function ImprovementInput({
  value,
  onChange,
  placeholder,
  className = "w-full",
  multiline = false,
  width,
  numeric = false,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  multiline?: boolean;
  width?: number;
  numeric?: boolean;
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!multiline || !textareaRef.current) {
      return;
    }

    textareaRef.current.style.height = "32px";
    textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
  }, [multiline, value]);

  if (multiline) {
    return (
      <textarea
        ref={textareaRef}
        style={width ? { width } : undefined}
        className={`min-h-8 resize-none overflow-hidden whitespace-pre-wrap break-words rounded-md border border-border bg-surface px-2 py-2 text-xs font-semibold leading-5 text-foreground outline-none placeholder:text-muted focus:border-brand ${className}`}
        value={value}
        placeholder={placeholder}
        rows={1}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <input
      inputMode={numeric ? "decimal" : undefined}
      className={`h-8 rounded-md border border-border bg-surface px-2 text-xs font-semibold text-foreground outline-none placeholder:text-muted focus:border-brand ${className}`}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(numeric ? sanitizeNumericInput(event.target.value) : event.target.value)}
    />
  );
}

export function PeakSeasonWeightMatrix({
  value,
  onChange,
  onReset,
}: {
  value: number[];
  onChange: (value: number[]) => void;
  onReset: () => void;
}) {
  const weights = peakSeasonMonths.map((_, index) => normalizePeakSeasonWeight(value[index] ?? 10));

  function updateMonth(index: number, weight: number) {
    const next = [...weights];
    next[index] = weight;
    onChange(next);
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-semibold text-muted">旺季月份</div>
        <button
          type="button"
          className="rounded border border-border bg-surface px-2 py-0.5 text-label font-semibold text-muted hover:border-brand hover:text-brand"
          onClick={onReset}
        >
          清除
        </button>
      </div>
      <div className="overflow-auto rounded-md border border-border">
        <table className="w-max table-fixed border-collapse text-center text-xs">
          <colgroup>
            <col className="w-[50px]" />
            {peakSeasonMonths.map((month) => (
              <col key={month} className="w-[50px]" />
            ))}
          </colgroup>
          <tbody>
            {peakSeasonWeightLevels.map((weight) => (
              <tr key={weight}>
                <td className="h-8 border-r border-b border-border bg-surface-muted px-1 text-label font-semibold text-muted">
                  {weight}
                </td>
                {weights.map((monthWeight, monthIndex) => {
                  const active = monthWeight >= weight;
                  const selected = monthWeight === weight;
                  return (
                    <td key={`${monthIndex}-${weight}`} className="border-r border-b border-border p-0 last:border-r-0">
                      <button
                        type="button"
                        aria-pressed={selected}
                        title={`${monthIndex + 1}月：${weight}`}
                        className={[
                          "flex h-8 w-full items-center justify-center border-0 text-label font-semibold transition-colors",
                          active
                            ? selected
                              ? "bg-accent text-white"
                              : "bg-warning-soft text-warning-ink"
                            : "bg-surface text-transparent hover:bg-surface-muted",
                        ].join(" ")}
                        onClick={() => updateMonth(monthIndex, weight)}
                      >
                        {selected ? weight : ""}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
            <tr>
              <td className="h-8 border-r border-border bg-surface-muted px-1 text-label font-semibold text-muted">权重</td>
              {peakSeasonMonths.map((month) => (
                <td key={`bottom-${month}`} className="h-8 border-r border-border bg-surface-muted px-1 text-label font-semibold text-foreground last:border-r-0">
                  {month}月
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function normalizePeakSeasonWeight(value: number) {
  const rounded = Math.round(Number(value) || 0);
  if (rounded >= 10) {
    return Math.max(10, Math.min(100, rounded - (rounded % 10 || 0)));
  }

  if (rounded <= 5) {
    return Math.max(10, Math.min(100, rounded * 20));
  }

  return 10;
}

export function buildImprovementPainRows(detail: TrialProductDraft) {
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

export function normalizePainSummary(value: string) {
  return value.replace(/\s+/g, "").toLowerCase();
}

export function parseCount(value: string) {
  const count = Number(value);
  return Number.isFinite(count) ? count : 0;
}
