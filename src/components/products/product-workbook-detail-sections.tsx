"use client";

import { useEffect, useRef, useState } from "react";
import { Copy, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ProductImageAsset } from "@/lib/products/types";
import { competitorTextFields, competitorTypeOptions, extraWideSupplierFields, mediumSupplierFields, negativeCompetitorFields, supplierFields, wideSupplierFields, type TrialCompetitorRow, type TrialImprovement, type TrialImprovementCellKey, type TrialKeywordRow, type TrialPriceRow, type TrialProductDraft, type TrialSupplierRow } from "./product-workbench-model";
import { AmazonLinkButton, AmazonSearchLinkButton, DecimalInput, ExternalLinkButton, ReadonlyMetric, SmallInput, SmallTextarea } from "./product-workbench-fields";
import { calculateExcelPricing } from "./product-workbench-utils";
import { ImageUploadSquare, RemarkImagesUploader } from "./product-workbook-image-fields";
import { NegativePointEditor } from "./product-negative-point-editor";
import { ImprovementTable } from "./product-improvement-table";
import { KeywordBulkInput } from "./product-keyword-bulk-input";
export { createEmptyImprovementRow, getImprovementRow, PeakSeasonWeightMatrix } from "./product-improvement-table";
function PricingNameInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const resize = (element: HTMLTextAreaElement) => {
    element.style.height = "32px";
    element.style.height = `${Math.max(32, Math.min(element.scrollHeight, 60))}px`;
  };

  useEffect(() => {
    if (inputRef.current) {
      resize(inputRef.current);
    }
  }, [value]);

  return (
    <textarea
      ref={inputRef}
      rows={1}
      style={{ height: 32 }}
      className="max-h-[60px] w-full resize-none overflow-y-auto rounded-md border border-border bg-surface px-2 py-1 text-xs leading-5 text-foreground outline-none focus:border-brand"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      onInput={(event) => resize(event.currentTarget)}
    />
  );
}

export function ProductWorkbookDetailSections({
  detail,
  onPricingChange,
  onPricingCopy,
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
  onPricingChange: (index: number, field: keyof TrialPriceRow, value: string | number | null) => void;
  onPricingCopy: (index: number) => void;
  onPricingAdd: () => void;
  onPricingRemove: () => void;
  onCompetitorChange: (index: number, field: keyof TrialCompetitorRow, value: string, asset?: ProductImageAsset) => void;
  onCompetitorAdd: () => void;
  onCompetitorRemove: () => void;
  onSupplierChange: (index: number, field: keyof TrialSupplierRow, value: string | number | null) => void;
  onSupplierAdd: () => void;
  onSupplierRemove: () => void;
  onImprovementChange: (field: Exclude<keyof TrialImprovement, "rows" | "peakSeasonWeights">, value: string) => void;
  onPeakSeasonWeightsChange: (value: number[]) => void;
  onImprovementRowChange: (index: number, field: TrialImprovementCellKey, value: string) => void;
  onKeywordChange: (index: number, field: keyof TrialKeywordRow, value: string | number | null) => void;
  onKeywordsReplace: (keywords: TrialKeywordRow[]) => void;
  onRemarkChange: (value: string) => void;
  onRemarkImagesChange: (images: string[], imageAssets?: ProductImageAsset[]) => void;
}) {
  const [showOptionalPricingMetrics, setShowOptionalPricingMetrics] = useState(false);
  const optionalPricingMetricLabels = new Set([
    "3.5%燃油$",
    "佣金(USD)",
    "月仓储费(USD)",
    "保本价(USD)",
    "体积重量/磅",
    "重量/磅",
  ]);
  const pricingHeaders = [
    "品名",
    "长cm",
    "宽cm",
    "高cm",
    "实际重Kg",
    "材积重Kg",
    "建议售价(USD)",
    "采购成本（RMB）",
    "FBA配送费$",
    "3.5%燃油$",
    "海运单价（RMB）",
    "海运头程（RMB）",
    "佣金(USD)",
    "月仓储费(USD)",
    "汇率",
    "保本价(USD)",
    "海运毛利润(USD)",
    "海运毛利润率",
    "体积重量/磅",
    "重量/磅",
  ];

  return (
    <div className="space-y-4 [&_textarea]:resize-none">
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
          <table className={`${showOptionalPricingMetrics ? "min-w-[1540px]" : "min-w-[1160px]"} text-left text-xs`}>
            <thead className="bg-surface-muted text-muted">
              <tr>
                {pricingHeaders
                  .filter((label) => showOptionalPricingMetrics || !optionalPricingMetricLabels.has(label))
                  .map((label) => (
                  <th
                    key={label}
                    className={`px-2 py-2 font-bold ${label === "品名" ? "w-[140px] min-w-[140px]" : ""} ${label === "3.5%燃油$" ? "w-[60px] min-w-[60px]" : ""} ${["建议售价(USD)", "采购成本（RMB）", "海运毛利润率"].includes(label) ? "text-danger" : ""}`}
                  >
                    {label}
                  </th>
                ))}
                <th className="w-10 min-w-10 px-1 py-2 text-center">
                  <button
                    type="button"
                    className="rounded p-1 text-foreground hover:bg-surface"
                    title={showOptionalPricingMetrics ? "隐藏计算列" : "显示隐藏的计算列"}
                    aria-label={showOptionalPricingMetrics ? "隐藏计算列" : "显示隐藏的计算列"}
                    onClick={() => setShowOptionalPricingMetrics((current) => !current)}
                  >
                    {showOptionalPricingMetrics ? <Minus className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody>
              {detail.pricingRows.map((row, index) => {
                const calc = calculateExcelPricing(row);

                return (
                  <tr key={index} className="border-t border-border align-top">
                    <td className="w-[140px] min-w-[140px] px-2 py-2">
                      <PricingNameInput
                        value={row.name}
                        onChange={(value) => onPricingChange(index, "name", value)}
                      />
                    </td>
                    <td className="px-2 py-2"><DecimalInput compact value={row.lengthCm} onChange={(value) => onPricingChange(index, "lengthCm", value)} /></td>
                    <td className="px-2 py-2"><DecimalInput compact value={row.widthCm} onChange={(value) => onPricingChange(index, "widthCm", value)} /></td>
                    <td className="px-2 py-2"><DecimalInput compact value={row.heightCm} onChange={(value) => onPricingChange(index, "heightCm", value)} /></td>
                    <td className="px-2 py-2"><DecimalInput compact value={row.actualWeightKg} onChange={(value) => onPricingChange(index, "actualWeightKg", value)} /></td>
                    <ReadonlyMetric value={calc.volumeWeightKg} />
                    <td className="px-2 py-2"><DecimalInput compact value={row.suggestedPrice} onChange={(value) => onPricingChange(index, "suggestedPrice", value)} /></td>
                    <td className="px-2 py-2"><DecimalInput compact value={row.purchaseCost} onChange={(value) => onPricingChange(index, "purchaseCost", value)} /></td>
                    <td className="px-2 py-2"><DecimalInput compact value={row.fbaFee} onChange={(value) => onPricingChange(index, "fbaFee", value)} /></td>
                    {showOptionalPricingMetrics && <td className="w-[60px] min-w-[60px] px-2 py-2 font-semibold text-muted metric-tabular">{calc.fuelFee?.toFixed(2) ?? "—"}</td>}
                    <td className="px-2 py-2"><DecimalInput compact value={row.oceanFreightUnitPrice} onChange={(value) => onPricingChange(index, "oceanFreightUnitPrice", value)} /></td>
                    <ReadonlyMetric value={calc.oceanFreight} />
                    {showOptionalPricingMetrics && <ReadonlyMetric value={calc.commission} />}
                    {showOptionalPricingMetrics && <ReadonlyMetric value={calc.monthlyStorageFee} />}
                    <td className="px-2 py-2"><DecimalInput compact value={row.exchangeRate} onChange={(value) => onPricingChange(index, "exchangeRate", value)} /></td>
                    {showOptionalPricingMetrics && <ReadonlyMetric value={calc.breakEvenPrice} />}
                    <ReadonlyMetric value={calc.profit} />
                    <ReadonlyMetric value={calc.profitRate === null ? "—" : `${(calc.profitRate * 100).toFixed(1)}%`} />
                    {showOptionalPricingMetrics && <ReadonlyMetric value={calc.volumeWeightLb} />}
                    {showOptionalPricingMetrics && <ReadonlyMetric value={calc.actualWeightLb} />}
                    <td className="w-10 min-w-10 px-1 py-2 text-center">
                      <button
                        type="button"
                        className="rounded p-1 text-muted hover:bg-surface hover:text-foreground"
                        title="复制当前行并新增"
                        aria-label={`复制第 ${index + 1} 行并新增`}
                        onClick={() => onPricingCopy(index)}
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card className="h-fit self-start">
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
        <CardContent className="erp-table-reset thin-scrollbar h-fit overflow-x-auto overflow-y-hidden">
          <table className="w-[1960px] table-fixed text-left text-xs">
            <colgroup>
              {[146, 60, 76, 110, 110, 110, 110, 110, 110, 76, 40, 120, 120, 120, 120, 120, 136, 166].map((width, index) => (
                <col key={index} style={{ width }} />
              ))}
            </colgroup>
            <thead className="bg-surface-muted text-muted">
              <tr>
                {["热销变体图片", "ASIN", "近30天销量", "变体数量", "变体类型", "热销变体规格", "热销变体价格($)", "FBA费用($)", "近3个月价格变动备注", "评论数", "评分", "差评点1", "差评点2", "差评点3", "差评点4", "差评点5", "竞品包装尺寸", "备注"].map((label) => (
                  <th key={label} className="break-words px-1 py-2 font-bold">{label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.competitors.map((row, index) => (
                <tr key={index} className="border-t border-border align-top">
                  <td className="px-2 py-2">
                    <div className="w-[130px] space-y-2">
                      <ImageUploadSquare
                        image={row.hotVariantImage}
                        asset={row.hotVariantImageAsset}
                        previewImage={row.hotVariantImageAsset?.previewUrl || row.hotVariantImageAsset?.originalUrl || row.hotVariantImage}
                        onChange={(value) => onCompetitorChange(index, "hotVariantImage", value)}
                        onAssetChange={(asset) => onCompetitorChange(index, "hotVariantImage", asset.thumbUrl || asset.originalUrl, asset)}
                      />
                      <select
                        className="h-8 w-[130px] rounded-md border border-border bg-surface px-2 text-xs font-semibold text-foreground outline-none focus:border-brand"
                        value={row.type}
                        onChange={(event) => onCompetitorChange(index, "type", event.target.value)}
                      >
                        {competitorTypeOptions.map((option) => (
                          <option key={option} value={option}>{option}</option>
                        ))}
                      </select>
                    </div>
                  </td>
                  <td className="px-1 py-2">
                    <div className="space-y-2">
                      <textarea
                        rows={2}
                        className="block h-[105px] w-full min-w-0 resize-none rounded-md border border-border bg-surface px-1 py-2 text-xs leading-4 text-foreground outline-none focus:border-brand"
                        value={row.asin}
                        onChange={(event) => onCompetitorChange(index, "asin", event.target.value)}
                      />
                      <AmazonLinkButton asin={row.asin} />
                    </div>
                  </td>
                  {competitorTextFields.map((field) => (
                    <td key={field} className="px-1 py-2">
                      {negativeCompetitorFields.has(field) ? (
                        <NegativePointEditor
                          value={String(row[field] ?? "")}
                          disabled={row.type !== "直接竞品"}
                          onChange={(value) => onCompetitorChange(index, field, value)}
                        />
                      ) : (
                        <textarea
                          rows={2}
                          className="block h-[180px] w-full min-w-0 resize-none rounded-md border border-border bg-surface px-1 py-2 text-xs leading-4 text-foreground outline-none focus:border-brand"
                          value={String(row[field] ?? "")}
                          onChange={(event) => onCompetitorChange(index, field, event.target.value)}
                        />
                      )}
                    </td>
                  ))}
                  <td className="px-2 py-2">
                    <div className="w-[150px] space-y-2">
                      <textarea
                        rows={2}
                        className="block h-[50px] w-full min-w-0 resize-none rounded-md border border-border bg-surface px-1 py-2 text-xs leading-4 text-foreground outline-none focus:border-brand"
                        value={row.note}
                        onChange={(event) => onCompetitorChange(index, "note", event.target.value)}
                      />
                      <ImageUploadSquare
                        image={row.noteImage}
                        asset={row.noteImageAsset}
                        previewImage={row.noteImageAsset?.previewUrl || row.noteImageAsset?.originalUrl || row.noteImage}
                        onChange={(value) => onCompetitorChange(index, "noteImage", value)}
                        onAssetChange={(asset) => onCompetitorChange(index, "noteImage", asset.thumbUrl || asset.originalUrl, asset)}
                      />
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
                {["供应商产品链接", "厂家名称", "配置", "起订量", "交期", "国内物流费", "相关认证", "专利国家", "产品包装方式", "报价（20套）", "报价（100-500套）", "开票信息", "备注"].map((label) => (
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
                      ) : field === "cost100" || field === "cost300" ? (
                        <DecimalInput compact value={Number(row[field]) || 0} onChange={(value) => onSupplierChange(index, field, value)} />
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
        <CardContent className="erp-table-reset thin-scrollbar overflow-auto">
          <ImprovementTable
            detail={detail}
            improvement={detail.improvement}
            onChange={onImprovementChange}
            onPeakSeasonWeightsChange={onPeakSeasonWeightsChange}
            onRowChange={onImprovementRowChange}
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
              <table className="min-w-[720px] text-left text-xs">
              <thead className="bg-surface-muted text-muted">
                <tr>
                  <th className="px-2 py-2">关键词</th>
                  <th className="px-2 py-2">CPC</th>
                  <th className="px-2 py-2">月搜索量</th>
                  <th className="px-2 py-2">ABA周排名</th>
                  <th className="w-12 px-2 py-2"><span className="sr-only">Amazon 搜索</span></th>
                </tr>
              </thead>
              <tbody>
                {detail.keywords.map((row, index) => (
                  <tr key={index} className="border-t border-border">
                    <td className="px-2 py-2"><SmallInput value={row.keyword} onChange={(value) => onKeywordChange(index, "keyword", value)} /></td>
                    <td className="px-2 py-2"><DecimalInput value={row.cpc} onChange={(value) => onKeywordChange(index, "cpc", value)} /></td>
                    <td className="px-2 py-2"><SmallInput type="number" value={row.monthlySearches} onChange={(value) => onKeywordChange(index, "monthlySearches", value)} /></td>
                    <td className="px-2 py-2"><SmallInput type="number" value={row.abaRank} onChange={(value) => onKeywordChange(index, "abaRank", value)} /></td>
                    <td className="px-2 py-2"><AmazonSearchLinkButton keyword={row.keyword} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
            <KeywordBulkInput onApply={onKeywordsReplace} />
          </div>
          <label className="block text-xs font-semibold text-muted">
            备注
            <textarea
              className="mt-1 min-h-24 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground outline-none focus:border-brand"
              value={detail.remark}
              onChange={(event) => onRemarkChange(event.target.value)}
            />
          </label>
          <RemarkImagesUploader images={detail.remarkImages ?? []} imageAssets={detail.remarkImageAssets} onChange={onRemarkImagesChange} />
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
