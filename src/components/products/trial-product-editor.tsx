"use client";

import { useState } from "react";
import { Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  scalarImprovementFields,
  supplierFields,
  type TrialCompetitorRow,
  type TrialImprovement,
  type TrialKeywordRow,
  type TrialPriceRow,
  type TrialProductDraft,
  type TrialSupplierRow,
} from "./product-workbench-model";
import { ExternalLinkButton, AmazonSearchLinkButton, DecimalInput, LabeledInput, ReadonlyMetric, SmallInput, SmallTextarea } from "./product-workbench-fields";
import { calculateTrialPricing } from "./product-workbench-utils";
import { getSupplierTextareaSize } from "./product-workbook-detail-sections";
import { createTrialProductDraft, trialImprovementLabels } from "./product-workbench-data";

const competitorTableFields: Array<Exclude<keyof TrialCompetitorRow, "hotVariantImageAsset" | "noteImageAsset">> = [
  "type",
  "hotVariantImage",
  "asin",
  "sales30Days",
  "variantCount",
  "variantType",
  "hotVariantSpec",
  "hotVariantPrice",
  "fbaFee",
  "priceChangeNote",
  "reviewCount",
  "rating",
  "negativePoint1",
  "negativePoint2",
  "negativePoint3",
  "negativePoint4",
  "negativePoint5",
  "packageSize",
  "note",
  "noteImage",
];

export function TrialProductEditor({
  onClose,
  onSave,
}: {
  onClose: () => void;
  onSave: (draft: TrialProductDraft) => void;
}) {
  const [draft, setDraft] = useState<TrialProductDraft>(() => createTrialProductDraft());

  function updatePricingRow(index: number, field: keyof TrialPriceRow, value: string | number) {
    setDraft((current) => ({
      ...current,
      pricingRows: current.pricingRows.map((row, rowIndex) =>
        rowIndex === index
          ? { ...row, [field]: field === "name" ? String(value) : typeof value === "number" ? value : Number(value) || 0 }
          : row,
      ),
    }));
  }

  function updateCompetitor(index: number, field: keyof TrialCompetitorRow, value: string) {
    setDraft((current) => ({
      ...current,
      competitors: current.competitors.map((row, rowIndex) => (rowIndex === index ? { ...row, [field]: value } : row)),
    }));
  }

  function updateSupplier(index: number, field: keyof TrialSupplierRow, value: string | number) {
    setDraft((current) => ({
      ...current,
      suppliers: current.suppliers.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              [field]:
                field === "cost100" || field === "cost300"
                  ? typeof value === "number"
                    ? value
                    : Number(value) || 0
                  : value,
            }
          : row,
      ),
    }));
  }

  function updateImprovement(field: Exclude<keyof TrialImprovement, "rows" | "peakSeasonWeights">, value: string) {
    setDraft((current) => ({
      ...current,
      improvement: { ...current.improvement, [field]: value },
    }));
  }

  function updateKeyword(index: number, field: keyof TrialKeywordRow, value: string | number) {
    setDraft((current) => ({
      ...current,
      keywords: current.keywords.map((row, rowIndex) =>
        rowIndex === index
          ? {
              ...row,
              [field]: field === "keyword" ? String(value) : typeof value === "number" ? value : Number(value) || 0,
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
            <CardHeader><CardTitle>区域 1：利润试算</CardTitle></CardHeader>
            <CardContent className="thin-scrollbar overflow-auto">
              <table className="min-w-[1760px] text-left text-xs">
                <thead className="bg-surface-muted text-muted">
                  <tr>
                    {["品名", "长 cm", "宽 cm", "高 cm", "实际重量 g", "材积重量 g", "建议售价(USD)", "采购成本(RMB)", "FBA配送费$", "3.5% 燃油及物流附加费(USD)", "海运单价(RMB)", "海运头程(RMB)", "佣金(USD)", "月仓储费(USD)", "汇率", "保本价(USD)", "海运毛利(USD)", "海运毛利率", "体积重量/", "重量/"].map((label) => (
                      <th key={label} className="px-2 py-2 font-bold">{label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {draft.pricingRows.map((row, index) => {
                    const calc = calculateTrialPricing(row);
                    return (
                      <tr key={index} className="border-t border-border align-top">
                        <td className="px-2 py-2"><SmallInput value={row.name} onChange={(value) => updatePricingRow(index, "name", value)} /></td>
                        <td className="px-2 py-2"><DecimalInput compact value={row.lengthCm} onChange={(value) => updatePricingRow(index, "lengthCm", value)} /></td>
                        <td className="px-2 py-2"><DecimalInput compact value={row.widthCm} onChange={(value) => updatePricingRow(index, "widthCm", value)} /></td>
                        <td className="px-2 py-2"><DecimalInput compact value={row.heightCm} onChange={(value) => updatePricingRow(index, "heightCm", value)} /></td>
                        <td className="px-2 py-2"><DecimalInput compact value={row.actualWeightKg} onChange={(value) => updatePricingRow(index, "actualWeightKg", value)} /></td>
                        <ReadonlyMetric value={calc.volumeWeightKg} />
                        <td className="px-2 py-2"><DecimalInput compact value={row.suggestedPrice} onChange={(value) => updatePricingRow(index, "suggestedPrice", value)} /></td>
                        <td className="px-2 py-2"><DecimalInput compact value={row.purchaseCost} onChange={(value) => updatePricingRow(index, "purchaseCost", value)} /></td>
                        <td className="px-2 py-2"><DecimalInput compact value={row.fbaFee} onChange={(value) => updatePricingRow(index, "fbaFee", value)} /></td>
                        <ReadonlyMetric value={calc.fuelFee} />
                        <td className="px-2 py-2"><DecimalInput compact value={row.oceanFreightUnitPrice} onChange={(value) => updatePricingRow(index, "oceanFreightUnitPrice", value)} /></td>
                        <ReadonlyMetric value={calc.oceanFreight} />
                        <ReadonlyMetric value={calc.commission} />
                        <ReadonlyMetric value={calc.monthlyStorageFee} />
                        <td className="px-2 py-2"><DecimalInput compact value={row.exchangeRate} onChange={(value) => updatePricingRow(index, "exchangeRate", value)} /></td>
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
            <CardHeader><CardTitle>区域 2：竞品分析</CardTitle></CardHeader>
            <CardContent className="thin-scrollbar overflow-auto">
              <table className="min-w-[1560px] text-left text-xs">
                <thead className="bg-surface-muted text-muted">
                  <tr>{["类型", "ASIN", "近30天销量", "变体数量", "变体类型", "热销变体规格", "热销变体价格($)", "FBA费用($)", "近3个月价格变动备注", "评论数", "评分", "差评点1", "差评点2", "差评点3", "差评点4", "差评点5", "竞品包装尺寸", "备注"].map((label) => <th key={label} className="px-2 py-2 font-bold">{label}</th>)}</tr>
                </thead>
                <tbody>
                  {draft.competitors.map((row, index) => (
                    <tr key={index} className="border-t border-border">
                      {competitorTableFields.map((field) => <td key={field} className="px-2 py-2"><SmallInput value={String(row[field] ?? "")} onChange={(value) => updateCompetitor(index, field, value)} /></td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>区域 3：供应商报价</CardTitle></CardHeader>
            <CardContent className="thin-scrollbar overflow-auto">
              <table className="min-w-[1420px] text-left text-xs">
                <thead className="bg-surface-muted text-muted">
                  <tr>{["供应商产品链路", "厂家名称", "配置", "起订量", "交期", "国内物流费", "相关认证", "专利国家", "产品包装方式", "采购成本(100套)", "采购成本(300)", "开票信息", "备注"].map((label) => <th key={label} className="px-2 py-2 font-bold">{label}</th>)}</tr>
                </thead>
                <tbody>
                  {draft.suppliers.map((row, index) => (
                    <tr key={index} className="border-t border-border">
                      {supplierFields.map((field) => <td key={field} className="px-2 py-2">{field === "productUrl" ? <div className="flex gap-2"><SmallTextarea size="supplierWide" value={row[field]} onChange={(value) => updateSupplier(index, field, value)} /><ExternalLinkButton href={row[field]} /></div> : <SmallTextarea size={getSupplierTextareaSize(field)} value={row[field]} onChange={(value) => updateSupplier(index, field, value)} />}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>区域 4：产品改进点</CardTitle></CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {scalarImprovementFields.map((field) => <LabeledInput key={field} label={trialImprovementLabels[field]} value={draft.improvement[field]} onChange={(value) => updateImprovement(field, value)} />)}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>区域 5：关键词</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="thin-scrollbar overflow-auto">
                <table className="min-w-[680px] text-left text-xs">
                  <thead className="bg-surface-muted text-muted"><tr><th className="px-2 py-2">关键词</th><th className="px-2 py-2">CPC</th><th className="px-2 py-2">月搜索量</th><th className="px-2 py-2">ABA周排名</th><th className="w-12 px-2 py-2"><span className="sr-only">Amazon 搜索</span></th></tr></thead>
                  <tbody>
                    {draft.keywords.map((row, index) => <tr key={index} className="border-t border-border"><td className="px-2 py-2"><SmallInput value={row.keyword} onChange={(value) => updateKeyword(index, "keyword", value)} /></td><td className="px-2 py-2"><DecimalInput value={row.cpc} onChange={(value) => updateKeyword(index, "cpc", value)} /></td><td className="px-2 py-2"><SmallInput type="number" value={row.monthlySearches} onChange={(value) => updateKeyword(index, "monthlySearches", value)} /></td><td className="px-2 py-2"><SmallInput type="number" value={row.abaRank} onChange={(value) => updateKeyword(index, "abaRank", value)} /></td><td className="px-2 py-2"><AmazonSearchLinkButton keyword={row.keyword} /></td></tr>)}
                  </tbody>
                </table>
              </div>
              <label className="block text-xs font-semibold text-muted">
                备注
                <textarea className="mt-1 min-h-24 w-full rounded-md border border-border px-3 py-2 text-sm text-foreground outline-none focus:border-brand" value={draft.remark} onChange={(event) => setDraft((current) => ({ ...current, remark: event.target.value }))} />
              </label>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
