"use client";

import { CheckCircle2, Plus, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import type { RuleAction } from "@/lib/types";

type DisplayAction = {
  id: string;
  type: RuleAction["type"];
  label: string;
  value: string;
  icon: typeof TrendingUp;
};

const actionTemplates: RuleAction[] = [
  { id: "template-increase", type: "increase_bid_percent", value: 10 },
  { id: "template-decrease", type: "decrease_bid_percent", value: 10 },
  { id: "template-label", type: "add_label", label: "高优先级" },
];

function createActionId() {
  return `action-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function getActionPresentation(action: RuleAction): DisplayAction {
  switch (action.type) {
    case "increase_bid_percent":
      return { id: action.id, type: action.type, label: "竞价提高", value: `${action.value ?? 0}%`, icon: TrendingUp };
    case "decrease_bid_percent":
      return { id: action.id, type: action.type, label: "竞价降低", value: `${action.value ?? 0}%`, icon: TrendingDown };
    case "increase_bid_fixed":
      return { id: action.id, type: action.type, label: "竞价提高", value: `$${action.value ?? 0}`, icon: TrendingUp };
    case "decrease_bid_fixed":
      return { id: action.id, type: action.type, label: "竞价降低", value: `$${action.value ?? 0}`, icon: TrendingDown };
    case "set_bid":
      return { id: action.id, type: action.type, label: "设置竞价", value: `$${action.value ?? 0}`, icon: TrendingUp };
    case "set_bid_to_overall_cpc_ratio":
      return { id: action.id, type: action.type, label: "设置竞价", value: `Overall CPC × ${action.value ?? 0}%`, icon: TrendingUp };
    case "increase_bid_percent_capped_at_overall_cpc":
      return { id: action.id, type: action.type, label: "竞价提高", value: `${action.value ?? 0}% ≤ Overall CPC`, icon: TrendingUp };
    case "increase_bid_percent_with_overall_cpc_bounds":
      return {
        id: action.id,
        type: action.type,
        label: "竞价提高",
        value: `${action.value ?? 0}% · Overall CPC ${action.min ?? 0}%~${action.max ?? 100}%`,
        icon: TrendingUp,
      };
    case "add_label":
      return { id: action.id, type: action.type, label: "添加标签", value: action.label ?? "-", icon: CheckCircle2 };
    case "no_change":
      return { id: action.id, type: action.type, label: "不调整", value: "No Change", icon: CheckCircle2 };
    default:
      return {
        id: action.id,
        type: action.type,
        label: action.type,
        value: action.label ?? String(action.value ?? "-"),
        icon: CheckCircle2,
      };
  }
}

function cloneTemplateAction(action: RuleAction): RuleAction {
  return {
    ...action,
    id: createActionId(),
  };
}

export function ActionBuilder({
  actions: initialActions,
  onChange,
}: {
  actions?: RuleAction[];
  onChange?: (actions: RuleAction[]) => void;
}) {
  const [actions, setActions] = useState<RuleAction[]>(() => initialActions?.length ? initialActions : [cloneTemplateAction(actionTemplates[0])]);

  useEffect(() => {
    setActions(initialActions?.length ? initialActions : [cloneTemplateAction(actionTemplates[0])]);
  }, [initialActions]);

  const applyActionsUpdate = (updater: (current: RuleAction[]) => RuleAction[]) => {
    setActions((current) => {
      const next = updater(current);
      onChange?.(next);
      return next;
    });
  };

  const displayActions = useMemo(() => actions.map(getActionPresentation), [actions]);
  const templateActions = useMemo(
    () =>
      actionTemplates.filter((template) => !actions.some((action) => action.type === template.type)).map((action) => getActionPresentation(action)),
    [actions],
  );

  const addNextAction = () => {
    const nextTemplate = actionTemplates.find((template) => !actions.some((action) => action.type === template.type));
    if (!nextTemplate) {
      return;
    }
    applyActionsUpdate((current) => [...current, cloneTemplateAction(nextTemplate)]);
  };

  const removeAction = (actionId: string) => {
    applyActionsUpdate((current) => current.filter((action) => action.id !== actionId));
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="w-fit rounded-md bg-accent px-2 py-1 text-xs font-bold text-white">THEN</span>
        <Button variant="secondary" size="sm" onClick={addNextAction} disabled={templateActions.length === 0}>
          <Plus className="h-4 w-4" />
          添加动作
        </Button>
      </div>
      <div className="space-y-2">
        {displayActions.map((action) => {
          const Icon = action.icon;

          return (
            <div
              key={action.id}
              className="flex flex-col gap-3 rounded-md border border-border bg-white p-3 lg:flex-row lg:items-center lg:justify-between"
            >
              <div className="flex min-w-0 items-start gap-3">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-muted text-brand">
                  <Icon className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-foreground">{action.label}</p>
                  <p className="text-xs font-medium text-muted">动作系统支持竞价、状态、否定关键词、标签与待处理标记</p>
                </div>
              </div>
              <div className="flex items-center gap-2 self-end lg:self-auto">
                <input className="h-9 w-28 rounded-md border border-border px-3 text-right text-sm font-bold" value={action.value} readOnly />
                <Button variant="ghost" size="icon" title="删除动作" onClick={() => removeAction(action.id)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      {templateActions.length > 0 && (
        <div className="space-y-2 border-t border-border pt-3">
          <p className="text-xs font-bold text-muted">可添加动作模板</p>
          {templateActions.map((action) => {
            const Icon = action.icon;

            return (
              <button
                key={action.type}
                type="button"
                onClick={() =>
                  applyActionsUpdate((current) => [
                    ...current,
                    cloneTemplateAction(actionTemplates.find((template) => template.type === action.type)!),
                  ])
                }
                className="flex w-full flex-col gap-3 rounded-md border border-dashed border-border bg-white p-3 text-left opacity-80 transition hover:opacity-100 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-surface-muted text-brand">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-foreground">{action.label}</p>
                    <p className="text-xs font-medium text-muted">点击即可加入当前规则动作。</p>
                  </div>
                </div>
                <input className="h-9 w-28 rounded-md border border-border px-3 text-right text-sm font-bold" value={action.value} readOnly />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { actionTemplates, cloneTemplateAction, createActionId, getActionPresentation };
