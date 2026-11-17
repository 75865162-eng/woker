"use client";

import { ArrowRight, Bell, Save } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ProductEditorDraft } from "./product-workbench-model";
import type { ProductWorkflowStage } from "@/lib/products/types";
import { formatWorkflowActor, formatWorkflowDate, getCurrentWorkflowAssignee, getProductWorkflowStage, isProductWorkflowOverdue, productWorkflowStageLabels, productWorkflowStageTones } from "@/lib/products/workflow";
import { isOperationsProgressComplete } from "@/lib/products/operations-progress";

export function ProductWorkflowPanel({ draft, ready, hasOperations, hasDesigners, onMove }: { draft: ProductEditorDraft; ready: boolean; hasOperations: boolean; hasDesigners: boolean; onMove: (stage: ProductWorkflowStage, note: string) => void }) {
  const stage = getProductWorkflowStage(draft);
  const assignee = getCurrentWorkflowAssignee(draft);
  const overdue = isProductWorkflowOverdue(draft);
  const complete = isOperationsProgressComplete(draft.operationsProgress);
  return <fieldset disabled={!ready} className="rounded-md border border-border bg-surface-muted px-3 py-3 md:col-span-2 xl:col-span-4">
    {!ready ? <p className="text-xs text-muted">业务流转记录待详情对齐</p> : null}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><div className="flex flex-wrap items-center gap-2"><p className="text-sm font-bold text-foreground">业务流转</p><Badge tone={productWorkflowStageTones[stage]}>{productWorkflowStageLabels[stage]}</Badge></div><p className="mt-1 text-xs text-muted">{overdue ? "已超 3 天未处理，需要提醒当前负责人。" : "每次流转会自动生成 3 天处理期限。"}</p></div>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" disabled={!hasOperations} onClick={() => onMove("ops_confirming", "选品提交给运营确认。")}><ArrowRight className="h-4 w-4" />交给运营</Button>
        <Button size="sm" variant="secondary" disabled={!hasDesigners} onClick={() => onMove("design_in_progress", "运营转交给美工处理。")}><ArrowRight className="h-4 w-4" />交给美工</Button>
        {stage === "design_in_progress" || stage === "design_review" ? <Button size="sm" variant="secondary" disabled={!hasOperations} onClick={() => onMove("ops_confirming", "美工完成后转回运营。")}><ArrowRight className="h-4 w-4" />转回运营</Button> : null}
        <Button size="sm" variant="secondary" disabled={!complete} onClick={() => onMove("done", "当前流程已完成。")}><Save className="h-4 w-4" />标记完成</Button>
      </div>
    </div>
    {!complete ? <p className="mt-2 text-xs text-muted">请先在“运营进度”里完成必填项，再标记业务流转完成。</p> : null}
    {overdue ? <div className="mt-3 flex items-center gap-2 rounded-md border border-danger/30 bg-danger-soft px-3 py-2 text-xs font-semibold text-danger-ink"><Bell className="h-4 w-4" />当前阶段已超时，负责人：{assignee || "未分配"}</div> : null}
    <div className="mt-3 space-y-2">{(draft.workflowHistory ?? []).slice(0, 5).map(event => <div key={event.id} className="rounded-md border border-border bg-surface px-3 py-2 text-xs"><div className="flex flex-wrap items-center justify-between gap-2"><p className="font-bold text-foreground">{event.stageLabel}</p><span className="text-muted">{formatWorkflowDate(event.createdAt)}</span></div><p className="mt-1 text-muted">操作人：{formatWorkflowActor(event)}{event.assigneeName ? `；负责人：${event.assigneeName}` : ""}{event.note ? `；${event.note}` : ""}</p></div>)}
      {(draft.workflowHistory ?? []).length === 0 ? <div className="rounded-md border border-border bg-surface px-3 py-2 text-xs text-muted">暂无流程记录，保存或点击流转按钮后会生成操作时间和人物。</div> : null}
    </div>
  </fieldset>;
}
