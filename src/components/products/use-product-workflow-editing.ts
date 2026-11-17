"use client";

import type { Dispatch, SetStateAction } from "react";
import type { ProductStatus, ProductWorkflowStage } from "@/lib/products/types";
import { buildWorkflowEvent, createWorkflowDueAt, formatAssigneeList, getCurrentWorkflowAssignee } from "@/lib/products/workflow";
import type { ProductEditorDraft } from "./product-workbench-model";

export function useProductWorkflowEditing(draft: ProductEditorDraft, setDraft: Dispatch<SetStateAction<ProductEditorDraft>>, selectedOps: string[], selectedDesigners: string[], creatorUserId: string, creatorName: string) {
  function updateStatus(status: ProductStatus) {
    const stage = status === "ops_review" ? "ops_confirming" : status === "design_in_progress" ? "design_in_progress" : status === "listing_confirming" ? "design_review" : status === "listed" ? "done" : ["canceled", "delisted", "patent_risk"].includes(status) ? "blocked" : "selection_pending";
    const now = new Date();
    setDraft(current => ({ ...current, status, workflowStage: stage, workflowUpdatedAt: now.toISOString(), workflowDueAt: stage === "done" || stage === "blocked" ? "" : current.workflowDueAt || createWorkflowDueAt(now) }));
  }
  function updateAssigneeList(field: "opsAssignees" | "designerAssignees", values: string[]) {
    const normalized = Array.from(new Set(values.filter(Boolean)));
    setDraft(current => ({ ...current, [field]: normalized, ...(field === "opsAssignees" ? { opsAssignee: formatAssigneeList(normalized) } : { designerAssignee: formatAssigneeList(normalized) }) }));
  }
  function moveWorkflow(stage: ProductWorkflowStage, note: string) {
    const now = new Date();
    const assigneeName = stage === "ops_confirming" ? formatAssigneeList(selectedOps) : stage === "design_in_progress" || stage === "design_review" ? formatAssigneeList(selectedDesigners) : getCurrentWorkflowAssignee(draft);
    const event = buildWorkflowEvent({ stage, actorUserId: creatorUserId || undefined, actorName: creatorName, assigneeName, note, createdAt: now });
    setDraft({
      ...draft,
      status: stage === "ops_confirming" ? "ops_review" : stage === "design_in_progress" || stage === "design_review" ? "design_in_progress" : stage === "done" ? "listed" : draft.status,
      workflowStage: stage, workflowStartedAt: now.toISOString(), workflowUpdatedAt: now.toISOString(),
      workflowDueAt: stage === "done" || stage === "blocked" ? "" : createWorkflowDueAt(now),
      opsAssignees: selectedOps, opsAssignee: formatAssigneeList(selectedOps),
      designerAssignees: selectedDesigners, designerAssignee: formatAssigneeList(selectedDesigners),
      editableBy: ["ops_confirming", "design_in_progress", "design_review"].includes(stage) ? selectedOps : [],
      viewableBy: [...selectedOps, ...selectedDesigners], workflowHistory: [event, ...(draft.workflowHistory ?? [])].slice(0, 20),
    });
  }
  return { updateStatus, updateAssigneeList, moveWorkflow };
}
