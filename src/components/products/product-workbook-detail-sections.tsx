import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { FileText, ImagePlus, Loader2, Minus, Plus, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { uploadProductImageAsset } from "@/lib/products/image-assets";
import {
  compactCompetitorFields,
  competitorTextFields,
  competitorTypeOptions,
  createDefaultPeakSeasonWeights,
  extraWideSupplierFields,
  improvementColumns,
  mediumSupplierFields,
  negativeCompetitorFields,
  peakSeasonMonths,
  peakSeasonWeightLevels,
  supplierFields,
  wideSupplierFields,
  type TrialCompetitorRow,
  type TrialImprovement,
  type TrialImprovementCellKey,
  type TrialImprovementRow,
  type TrialKeywordRow,
  type TrialPriceRow,
  type TrialProductDraft,
  type TrialSupplierRow,
} from "./product-workbench-model";
import {
  AmazonLinkButton,
  ExternalLinkButton,
  LabeledInput,
  ReadonlyMetric,
  SmallInput,
  SmallTextarea,
} from "./product-workbench-fields";
import { calculateExcelPricing } from "./product-workbench-utils";

function isPdfDataUrl(value: string) {
  return value.startsWith("data:application/pdf");
}

function isPdfImageSource(value: string) {
  if (isPdfDataUrl(value)) {
    return true;
  }

  const path = value.split("#")[0].split("?")[0].toLowerCase();
  return path.endsWith(".pdf");
}

const pricingHeaders: Array<{ label: ReactNode; widthClass?: string }> = [
  { label: "品名", widthClass: "w-[140px] min-w-[140px] max-w-[140px]" },
  { label: <>长<br />（cm）</>, widthClass: "w-[45px] min-w-[45px] max-w-[45px]" },
  { label: <>宽<br />（cm）</>, widthClass: "w-[45px] min-w-[45px] max-w-[45px]" },
  { label: <>高<br />（cm）</>, widthClass: "w-[45px] min-w-[45px] max-w-[45px]" },
  { label: <>实际重<br />（Kg）</>, widthClass: "w-[70px] min-w-[70px] max-w-[70px]" },
  { label: <>材积重<br />（Kg）</>, widthClass: "w-[68px] min-w-[68px] max-w-[68px]" },
  { label: "建议售价(USD)", widthClass: "w-[78px] min-w-[78px] max-w-[78px]" },
  { label: "采购成本（RMB）", widthClass: "w-[82px] min-w-[82px] max-w-[82px]" },
  { label: <>FBA配送费<br />(USD)</>, widthClass: "w-[68px] min-w-[68px] max-w-[68px]" },
  { label: <>3.5%燃油<br />附加费（USD)</>, widthClass: "w-[35px] min-w-[35px] max-w-[35px]" },
  { label: <>海运价<br />（RMB）</>, widthClass: "w-[45px] min-w-[45px] max-w-[45px]" },
  { label: "海运头程（RMB）", widthClass: "w-[86px] min-w-[86px] max-w-[86px]" },
  { label: <>佣金<br />(USD)</>, widthClass: "w-[68px] min-w-[68px] max-w-[68px]" },
  { label: "月仓储费(USD)", widthClass: "w-[82px] min-w-[82px] max-w-[82px]" },
  { label: "汇率", widthClass: "w-[62px] min-w-[62px] max-w-[62px]" },
  { label: <>保本价<br />(USD)</>, widthClass: "w-[80px] min-w-[80px] max-w-[80px]" },
  { label: "海运毛利润(USD)", widthClass: "w-[92px] min-w-[92px] max-w-[92px]" },
  { label: "海运毛利润率", widthClass: "w-[82px] min-w-[82px] max-w-[82px]" },
  { label: "体积重量/磅", widthClass: "w-[78px] min-w-[78px] max-w-[78px]" },
  { label: "重量/磅", widthClass: "w-[70px] min-w-[70px] max-w-[70px]" },
];

const pricingDimensionCellClass = "w-[45px] min-w-[45px] max-w-[45px] px-1 py-2 [&_input]:w-[45px] [&_input]:min-w-[45px] [&_input]:px-1";
const pricingOceanPriceCellClass = "w-[45px] min-w-[45px] max-w-[45px] px-1 py-2 [&_input]:w-[45px] [&_input]:min-w-[45px] [&_input]:px-1";

export function ProductWorkbookDetailSections({
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
  onPeakSeasonWeightsChange,
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
  onImprovementChange: (field: Exclude<keyof TrialImprovement, "rows" | "peakSeasonWeights">, value: string) => void;
  onPeakSeasonWeightsChange: (value: number[]) => void;
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
          <table className="w-max table-fixed text-left text-xs">
            <colgroup>
              {pricingHeaders.map((header, index) => (
                <col key={index} className={header.widthClass} />
              ))}
            </colgroup>
            <thead className="bg-surface-muted text-muted">
              <tr>
                {pricingHeaders.map((header, index) => (
                  <th key={index} className="px-1 py-2 text-center font-bold leading-tight">
                    {header.label}
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
                    <td className={pricingDimensionCellClass}><SmallInput compact type="number" value={row.lengthCm} onChange={(value) => onPricingChange(index, "lengthCm", value)} /></td>
                    <td className={pricingDimensionCellClass}><SmallInput compact type="number" value={row.widthCm} onChange={(value) => onPricingChange(index, "widthCm", value)} /></td>
                    <td className={pricingDimensionCellClass}><SmallInput compact type="number" value={row.heightCm} onChange={(value) => onPricingChange(index, "heightCm", value)} /></td>
                    <td className="px-2 py-2"><SmallInput compact type="number" value={row.actualWeightKg} onChange={(value) => onPricingChange(index, "actualWeightKg", value)} /></td>
                    <ReadonlyMetric value={calc.volumeWeightKg} />
                    <td className="px-2 py-2"><SmallInput compact type="number" value={row.suggestedPrice} onChange={(value) => onPricingChange(index, "suggestedPrice", value)} /></td>
                    <td className="px-2 py-2"><SmallInput compact type="number" value={row.purchaseCost} onChange={(value) => onPricingChange(index, "purchaseCost", value)} /></td>
                    <td className="px-2 py-2"><SmallInput compact type="number" value={row.fbaFee} onChange={(value) => onPricingChange(index, "fbaFee", value)} /></td>
                    <ReadonlyMetric value={calc.fuelFee} className="w-[35px] min-w-[35px] max-w-[35px] px-1 text-center" />
                    <td className={pricingOceanPriceCellClass}><SmallInput compact type="number" value={row.oceanFreightUnitPrice} onChange={(value) => onPricingChange(index, "oceanFreightUnitPrice", value)} /></td>
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
                        <option value=""></option>
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
                {["供应商产品链接", "厂家名称", "配置", "起订量", "交期", "国内物流费", "相关认证", "专利国家", "产品包装方式", "采购单价", "报价（100-500套）", "开票信息", "备注"].map((label) => (
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
            onPeakSeasonWeightsChange={onPeakSeasonWeightsChange}
            onRowChange={onImprovementRowChange}
            onRemarkChange={onRemarkChange}
            onRemarkImagesChange={onRemarkImagesChange}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>区域 5：关键词</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,1fr)]">
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
            <KeywordBulkInput onApply={onKeywordsReplace} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export function getSupplierTextareaSize(field: keyof TrialSupplierRow) {
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
  allowPdf = false,
}: {
  image: string;
  onChange: (value: string) => void;
  allowPdf?: boolean;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function handleFile(file: File | undefined) {
    if (!file) {
      return;
    }

    setIsUploading(true);
    setUploadError("");

    try {
      const nextImage = await uploadProductImageAsset(file);
      onChange(nextImage);
      setPreviewOpen(false);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "图片上传失败。");
    } finally {
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
      setIsUploading(false);
    }
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
          {allowPdf && isPdfImageSource(image) ? (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 rounded-md bg-white text-center">
              <FileText className="h-10 w-10 text-brand" />
              <span className="text-xs font-semibold text-foreground">PDF</span>
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={image} alt="竞品图片" className="h-full w-full object-contain p-1" />
          )}
        </button>
      ) : (
        <button
          type="button"
          className="flex h-[130px] w-[130px] items-center justify-center rounded-md border border-dashed border-border bg-surface-muted text-center text-xs font-semibold text-muted transition-colors hover:border-brand hover:bg-white"
          disabled={isUploading}
          onClick={() => fileInputRef.current?.click()}
        >
          {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : "上传图片"}
        </button>
      )}
      {uploadError ? <p className="text-[11px] font-semibold text-danger">{uploadError}</p> : null}
      <input ref={fileInputRef} type="file" accept={allowPdf ? "image/*,.pdf" : "image/*"} className="hidden" onChange={(event) => handleFile(event.target.files?.[0])} />

      {previewOpen && image ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/70 p-6">
          <div className="relative flex max-h-full max-w-5xl items-center justify-center">
            <div className="absolute right-0 top-0 z-10 flex translate-y-[-120%] flex-nowrap gap-2">
              <Button className="min-w-[96px] whitespace-nowrap" variant="secondary" size="sm" disabled={isUploading} onClick={() => fileInputRef.current?.click()}>
                <ImagePlus className="h-4 w-4" />
                {isUploading ? "上传中" : allowPdf ? "替换文件" : "替换图片"}
              </Button>
              <Button className="min-w-[78px] whitespace-nowrap" variant="secondary" size="sm" onClick={() => setPreviewOpen(false)}>
                <X className="h-4 w-4" />
                关闭
              </Button>
            </div>
            {allowPdf && isPdfImageSource(image) ? (
              <object data={image} type="application/pdf" className="h-[82vh] w-[88vw] rounded-lg bg-white shadow-2xl">
                <p className="rounded-lg bg-white px-4 py-3 text-sm text-muted">PDF 预览不可用。</p>
              </object>
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={image} alt="竞品大图" className="max-h-[82vh] max-w-[88vw] rounded-lg bg-white object-contain shadow-2xl" />
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}

function RemarkImagesUploader({ images, onChange }: { images: string[]; onChange: (images: string[]) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState("");

  async function handleFiles(files: FileList | null) {
    const selected = Array.from(files ?? []);
    if (!selected.length) {
      return;
    }

    setIsUploading(true);
    setUploadError("");

    try {
      const results = await Promise.allSettled(selected.map((file) => uploadProductImageAsset(file)));
      const nextImages = results.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []));
      const firstError = results.find((result) => result.status === "rejected");

      if (nextImages.length) {
        onChange([...images, ...nextImages]);
      }

      if (firstError && firstError.status === "rejected") {
        setUploadError(firstError.reason instanceof Error ? firstError.reason.message : "图片上传失败。");
      }
    } finally {
      setIsUploading(false);
    }
  }

  return (
    <div className="rounded-md border border-border bg-surface-muted p-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs font-bold text-muted">备注图片</p>
        <Button variant="secondary" size="sm" onClick={() => inputRef.current?.click()} disabled={isUploading}>
          {isUploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
          {isUploading ? "上传中" : "批量上传图片 / PDF"}
        </Button>
      </div>
      {uploadError ? <p className="mt-2 text-xs font-semibold text-danger">{uploadError}</p> : null}
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        accept="image/*,.pdf"
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
              <ImageUploadSquare image={image} allowPdf onChange={(value) => onChange(images.map((item, itemIndex) => (itemIndex === index ? value : item)))} />
              <Button variant="secondary" size="sm" className="w-[130px]" onClick={() => onChange(images.filter((_, itemIndex) => itemIndex !== index))}>
                删除
              </Button>
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-3 rounded-md border border-dashed border-border bg-white px-3 py-6 text-center text-xs font-semibold text-muted">
          导入 Excel 中非热销变体图片，或手动批量上传图片 / PDF 后会显示在这里。
        </div>
      )}
    </div>
  );
}

function ProductRemarkPanel({
  remark,
  remarkImages,
  onRemarkChange,
  onRemarkImagesChange,
}: {
  remark: string;
  remarkImages: string[];
  onRemarkChange: (value: string) => void;
  onRemarkImagesChange: (images: string[]) => void;
}) {
  return (
    <div className="w-[380px] flex-none space-y-3">
      <label className="block text-xs font-semibold text-muted">
        备注
        <textarea
          className="mt-1 min-h-[150px] w-full rounded-md border border-border px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
          value={remark}
          onChange={(event) => onRemarkChange(event.target.value)}
        />
      </label>
      <RemarkImagesUploader images={remarkImages} onChange={onRemarkImagesChange} />
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

function ImprovementTable({
  detail,
  improvement,
  onChange,
  onPeakSeasonWeightsChange,
  onRowChange,
  onRemarkChange,
  onRemarkImagesChange,
}: {
  detail: TrialProductDraft;
  improvement: TrialImprovement;
  onChange: (field: Exclude<keyof TrialImprovement, "rows" | "peakSeasonWeights">, value: string) => void;
  onPeakSeasonWeightsChange: (value: number[]) => void;
  onRowChange: (index: number, field: TrialImprovementCellKey, value: string) => void;
  onRemarkChange: (value: string) => void;
  onRemarkImagesChange: (images: string[]) => void;
}) {
  const painRows = buildImprovementPainRows(detail);
  const visiblePainRows = painRows.length ? painRows : [{ summary: "", count: "" }];
  const improvementColumnWidths = improvementColumns.map((column) => getImprovementColumnWidth(improvement, visiblePainRows.length, column.field));
  const tableWidth = 412 + improvementColumnWidths.reduce((total, width) => total + width, 0);

  return (
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
            <ImprovementInput value={improvement.targetSales} onChange={(value) => onChange("targetSales", value)} />
          </ImprovementCell>
          <ImprovementCell colSpan={2}>
            <ImprovementInput value={improvement.peakSales} onChange={(value) => onChange("peakSales", value)} />
          </ImprovementCell>
          <ImprovementCell colSpan={2}>
            <ImprovementInput value={improvement.offSeasonSales} onChange={(value) => onChange("offSeasonSales", value)} />
          </ImprovementCell>
        </tr>
        <tr>
          <td colSpan={12} className="border-b border-r border-border bg-white px-1 py-1 first:border-l">
            <div className="flex min-w-[1030px] items-start gap-4">
              <PeakSeasonWeightMatrix
                value={improvement.peakSeasonWeights}
                onChange={onPeakSeasonWeightsChange}
                onReset={() => onPeakSeasonWeightsChange(createDefaultPeakSeasonWeights())}
              />
              <ProductRemarkPanel
                remark={detail.remark}
                remarkImages={detail.remarkImages ?? []}
                onRemarkChange={onRemarkChange}
                onRemarkImagesChange={onRemarkImagesChange}
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
              {column.label}
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
  );
}

function getImprovementColumnWidth(improvement: TrialImprovement, rowCount: number, field: TrialImprovementCellKey) {
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

function ImprovementSubHeader({
  children,
  className = "",
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <td style={style} className={`whitespace-normal break-words border-b border-r border-border bg-surface-muted px-2 py-2 font-bold leading-5 text-muted first:border-l ${className}`}>
      {children}
    </td>
  );
}

function ImprovementCell({
  children,
  className = "",
  colSpan,
  style,
}: {
  children?: ReactNode;
  className?: string;
  colSpan?: number;
  style?: React.CSSProperties;
}) {
  return <td colSpan={colSpan} style={style} className={`h-9 border-b border-r border-border bg-white px-2 py-1 align-top text-foreground first:border-l ${className}`}>{children}</td>;
}

function ImprovementInput({
  value,
  onChange,
  placeholder,
  className = "w-full",
  multiline = false,
  width,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  multiline?: boolean;
  width?: number;
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
        className={`min-h-8 resize-none overflow-hidden whitespace-pre-wrap break-words rounded-md border border-border bg-white px-2 py-2 text-xs font-semibold leading-5 text-foreground outline-none placeholder:text-muted focus:border-brand ${className}`}
        value={value}
        placeholder={placeholder}
        rows={1}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <input
      className={`h-8 rounded-md border border-border bg-white px-2 text-xs font-semibold text-foreground outline-none placeholder:text-muted focus:border-brand ${className}`}
      value={value}
      placeholder={placeholder}
      onChange={(event) => onChange(event.target.value)}
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
          className="rounded border border-border bg-white px-2 py-0.5 text-[11px] font-semibold text-muted hover:border-brand hover:text-brand"
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
                <td className="h-8 border-r border-b border-border bg-surface-muted px-1 text-[11px] font-semibold text-muted">
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
                          "flex h-8 w-full items-center justify-center border-0 text-[11px] font-semibold transition-colors",
                          active
                            ? selected
                              ? "bg-orange-500 text-white"
                              : "bg-orange-100 text-orange-900"
                            : "bg-white text-transparent hover:bg-surface-muted",
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
              <td className="h-8 border-r border-border bg-surface-muted px-1 text-[11px] font-semibold text-muted">权重</td>
              {peakSeasonMonths.map((month) => (
                <td key={`bottom-${month}`} className="h-8 border-r border-border bg-surface-muted px-1 text-[11px] font-semibold text-foreground last:border-r-0">
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

function normalizePeakSeasonWeight(value: number) {
  const rounded = Math.round(Number(value) || 0);
  if (rounded >= 10) {
    return Math.max(10, Math.min(100, rounded - (rounded % 10 || 0)));
  }

  if (rounded <= 5) {
    return Math.max(10, Math.min(100, rounded * 20));
  }

  return 10;
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
    <label className="flex h-full flex-col text-xs font-semibold text-muted">
      批量输入关键词
      <textarea
        className="mt-1 min-h-[240px] flex-1 w-full rounded-md border border-border bg-white px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
        value={value}
        placeholder={"关键词 CPC 月搜索量 ABA排名\n关键词 CPC 月搜索量 ABA排名\n\n或旧格式：\n关键词\nCPC\n月搜索量\nABA排名"}
        onChange={(event) => handleChange(event.target.value)}
      />
    </label>
  );
}

function parseKeywordBulkText(value: string): TrialKeywordRow[] {
  const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const keywords: TrialKeywordRow[] = [];
  const rows = lines.map(parseKeywordSingleLine).filter((row): row is TrialKeywordRow => Boolean(row));

  if (rows.length === lines.length) {
    return rows;
  }

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

function parseKeywordSingleLine(line: string): TrialKeywordRow | null {
  const parts = line.split(/\s+/);
  if (parts.length < 4) {
    return null;
  }

  const cpc = Number(parts.at(-3));
  const monthlySearches = Number(parts.at(-2));
  const abaRank = Number(parts.at(-1));
  if (![cpc, monthlySearches, abaRank].every(Number.isFinite)) {
    return null;
  }

  return {
    keyword: parts.slice(0, -3).join(" "),
    cpc,
    monthlySearches,
    abaRank,
  };
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
