"use client";

import { useMemo, useState } from "react";
import { Check, History, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  calculateForecastMonthlyRevenue,
  normalizeOperationsProgress,
  operationStageDefinitions,
  operationStageStatusOptions,
  summarizeOperationsProgressChanges,
} from "@/lib/products/operations-progress";
import type { ProductOperationProgress, ProductOperationStage, ProductOperationStageStatus } from "@/lib/products/types";

const inputClass = "h-9 w-full rounded-md border border-border bg-white px-2 text-sm text-foreground outline-none focus:border-brand";

export function ProductOperationsProgress({
  productName,
  value,
  currentUser,
  defaultOwner,
  onClose,
  onApply,
}: {
  productName: string;
  value?: ProductOperationProgress;
  currentUser: string;
  defaultOwner: string;
  onClose: () => void;
  onApply: (value: ProductOperationProgress) => void;
}) {
  const initialValue = useMemo(() => normalizeOperationsProgress(value, defaultOwner), [defaultOwner, value]);
  const [draft, setDraft] = useState(initialValue);
  const revenue = calculateForecastMonthlyRevenue(draft);
  const completedCount = draft.stages.filter((stage) => stage.status === "completed").length;

  function setNumber(field: "orderQuantity" | "dailyAdBudget" | "forecastMonthlySales" | "forecastPrice", value: string) {
    setDraft((current) => ({ ...current, [field]: Number(value) || 0 }));
  }

  function updateStage(index: number, patch: Partial<ProductOperationStage>) {
    const now = new Date().toISOString();
    setDraft((current) => ({
      ...current,
      stages: current.stages.map((stage, stageIndex) => (stageIndex === index ? { ...stage, ...patch, updatedAt: now } : stage)),
    }));
  }

  function updateStageStatus(index: number, status: ProductOperationStageStatus) {
    const stage = draft.stages[index];
    updateStage(index, {
      status,
      completedAt: status === "completed" ? stage.completedAt || toDateInput(new Date()) : "",
    });
  }

  function applyChanges() {
    const now = new Date().toISOString();
    const summary = summarizeOperationsProgressChanges(initialValue, draft);
    onApply({
      ...draft,
      updatedAt: now,
      updatedBy: currentUser,
      history: [
        { id: `ops-${Date.now()}`, changedAt: now, changedBy: currentUser, summary },
        ...(draft.history ?? []),
      ].slice(0, 50),
    });
  }

  return (
    <div className="fixed inset-0 z-40 bg-foreground/40 p-3 backdrop-blur-sm">
      <div className="mx-auto flex h-full w-full max-w-[1500px] flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-bold text-foreground">运营进度</h2>
              <Badge tone={completedCount === draft.stages.length ? "green" : "amber"}>{completedCount}/{draft.stages.length} 阶段完成</Badge>
            </div>
            <p className="mt-1 text-sm text-muted">{productName || "未命名商品"}</p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={onClose}><X className="h-4 w-4" />取消</Button>
            <Button size="sm" onClick={applyChanges}><Check className="h-4 w-4" />应用到商品</Button>
          </div>
        </div>

        <div className="thin-scrollbar flex-1 overflow-auto">
          <section className="border-b border-border bg-surface-muted px-5 py-4">
            <h3 className="text-sm font-bold text-foreground">关键经营数据</h3>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
              <ProgressField label="产品名称"><input className={inputClass} value={productName} readOnly /></ProgressField>
              <ProgressField label="入选日期"><input className={inputClass} type="date" value={draft.selectionDate} onChange={(event) => setDraft({ ...draft, selectionDate: event.target.value })} /></ProgressField>
              <ProgressField label="下单数量"><input className={inputClass} type="number" min="0" value={draft.orderQuantity || ""} onChange={(event) => setNumber("orderQuantity", event.target.value)} /></ProgressField>
              <ProgressField label="下单日期"><input className={inputClass} type="date" value={draft.orderDate} onChange={(event) => setDraft({ ...draft, orderDate: event.target.value })} /></ProgressField>
              <ProgressField label="出货日期"><input className={inputClass} type="date" value={draft.shipDate} onChange={(event) => setDraft({ ...draft, shipDate: event.target.value })} /></ProgressField>
              <ProgressField label="广告日预算 USD"><input className={inputClass} type="number" min="0" step="0.01" value={draft.dailyAdBudget || ""} onChange={(event) => setNumber("dailyAdBudget", event.target.value)} /></ProgressField>
              <ProgressField label="预估月销"><input className={inputClass} type="number" min="0" value={draft.forecastMonthlySales || ""} onChange={(event) => setNumber("forecastMonthlySales", event.target.value)} /></ProgressField>
              <ProgressField label="预估售价 USD"><input className={inputClass} type="number" min="0" step="0.01" value={draft.forecastPrice || ""} onChange={(event) => setNumber("forecastPrice", event.target.value)} /></ProgressField>
            </div>
            <div className="mt-3 flex items-center justify-end gap-2 text-sm">
              <span className="text-muted">预估月销售额</span>
              <strong className="metric-tabular text-lg text-foreground">${revenue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
              <span className="text-xs text-muted">月销 × 售价，自动计算</span>
            </div>
          </section>

          <section className="px-5 py-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-foreground">阶段追踪</h3>
                <p className="mt-1 text-xs text-muted">计划日期用于排期，实际完成日期用于复盘；受阻时请在备注写明原因。</p>
              </div>
              {draft.updatedAt ? <p className="text-xs text-muted">最近更新：{formatDateTime(draft.updatedAt)} · {draft.updatedBy || "未知"}</p> : null}
            </div>
            <div className="mt-3 overflow-x-auto rounded-md border border-border">
              <table className="min-w-[1180px] w-full text-left text-xs">
                <thead className="bg-surface-muted text-muted">
                  <tr><th className="px-3 py-2">阶段</th><th className="px-3 py-2">状态</th><th className="px-3 py-2">负责人</th><th className="px-3 py-2">计划日期</th><th className="px-3 py-2">实际完成</th><th className="px-3 py-2">备注 / 阻塞原因</th><th className="px-3 py-2">最后更新</th></tr>
                </thead>
                <tbody>
                  {operationStageDefinitions.map((definition, index) => {
                    const stage = draft.stages[index];
                    return (
                      <tr key={definition.id} className="border-t border-border align-top">
                        <td className="whitespace-nowrap px-3 py-2 font-bold text-foreground">{definition.label}</td>
                        <td className="w-32 px-2 py-2"><select className={inputClass} value={stage.status} onChange={(event) => updateStageStatus(index, event.target.value as ProductOperationStageStatus)}>{operationStageStatusOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></td>
                        <td className="w-36 px-2 py-2"><input className={inputClass} value={stage.owner} onChange={(event) => updateStage(index, { owner: event.target.value })} /></td>
                        <td className="w-40 px-2 py-2"><input className={inputClass} type="date" value={stage.plannedAt} onChange={(event) => updateStage(index, { plannedAt: event.target.value })} /></td>
                        <td className="w-40 px-2 py-2"><input className={inputClass} type="date" value={stage.completedAt} onChange={(event) => updateStage(index, { completedAt: event.target.value })} /></td>
                        <td className="min-w-64 px-2 py-2"><input className={inputClass} value={stage.note} placeholder={stage.status === "blocked" ? "必填：阻塞原因和下一步" : "补充交付物或说明"} onChange={(event) => updateStage(index, { note: event.target.value })} /></td>
                        <td className="w-40 px-3 py-2 text-muted">{stage.updatedAt ? formatDateTime(stage.updatedAt) : "--"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <section className="border-t border-border px-5 py-4">
            <div className="flex items-center gap-2"><History className="h-4 w-4 text-muted" /><h3 className="text-sm font-bold text-foreground">变更记录</h3></div>
            <div className="mt-3 space-y-2">
              {draft.history.slice(0, 8).map((event) => <div key={event.id} className="flex flex-wrap justify-between gap-2 border-b border-border pb-2 text-xs"><span className="font-semibold text-foreground">{event.summary}</span><span className="text-muted">{event.changedBy} · {formatDateTime(event.changedAt)}</span></div>)}
              {!draft.history.length ? <p className="text-sm text-muted">首次应用后开始记录修改人、时间和变更摘要。</p> : null}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function ProgressField({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="text-xs font-semibold text-muted">{label}<div className="mt-1">{children}</div></label>;
}

function toDateInput(date: Date) {
  return date.toISOString().slice(0, 10);
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN", { hour12: false });
}
