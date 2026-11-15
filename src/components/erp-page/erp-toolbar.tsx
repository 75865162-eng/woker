"use client";

import { useRef } from "react";
import { ChevronDown, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ErpAction, ErpTone } from "./types";

type ButtonVariant = "primary" | "secondary" | "danger" | "ghost";

const variantByTone: Partial<Record<ErpTone, ButtonVariant>> = {
  brand: "primary",
  info: "primary",
  danger: "danger",
  default: "secondary",
  success: "secondary",
  warning: "secondary",
};

function variantOf(action: ErpAction, index: number): ButtonVariant {
  const fromTone = action.tone ? variantByTone[action.tone] : undefined;
  // 未指定 tone 时，首个主操作用 primary，其余用 secondary。
  return fromTone ?? (index === 0 ? "primary" : "secondary");
}

/** 对应 Wimoor「列表页 / 审核工作台」顶部工具按钮区，含次级操作收纳与密度切换。 */
export function ErpToolbar({
  actions,
  secondaryActions = [],
  dense,
  onDenseChange,
  className,
}: {
  actions: ErpAction[];
  secondaryActions?: ErpAction[];
  dense?: boolean;
  onDenseChange?: (value: boolean) => void;
  className?: string;
}) {
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const mainActions = actions.filter((action) => !action.hidden);
  const moreActions = secondaryActions.filter((action) => !action.hidden);

  const renderMain = (action: ErpAction, index: number) => {
    const Icon = action.icon;
    return (
      <Button
        key={action.id}
        type="button"
        variant={variantOf(action, index)}
        size="sm"
        disabled={action.disabled || action.loading}
        title={action.hint}
        onClick={action.onClick}
      >
        {action.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : Icon ? <Icon className="h-3.5 w-3.5" /> : null}
        {action.label}
      </Button>
    );
  };

  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-2", className)}>
      <div className="flex flex-wrap items-center gap-2">
        {mainActions.map((action, index) => renderMain(action, index))}
        {moreActions.length > 0 ? (
          <details ref={detailsRef} className="relative">
            <summary className="inline-flex h-8 cursor-pointer list-none items-center gap-1 rounded-md border border-border bg-white px-3 text-xs font-semibold text-foreground hover:bg-surface-muted [&::-webkit-details-marker]:hidden">
              更多
              <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
            </summary>
            <div className="absolute right-0 z-20 mt-1 min-w-[10rem] rounded-md border border-border bg-white p-1 shadow-lg">
              {moreActions.map((action) => {
                const Icon = action.icon;
                return (
                  <button
                    key={action.id}
                    type="button"
                    disabled={action.disabled || action.loading}
                    title={action.hint}
                    onClick={() => {
                      action.onClick();
                      if (detailsRef.current) detailsRef.current.open = false;
                    }}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-2.5 py-2 text-left text-xs font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50",
                      action.tone === "danger" && "text-danger hover:bg-red-50",
                    )}
                  >
                    {action.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : Icon ? <Icon className="h-3.5 w-3.5" /> : null}
                    {action.label}
                  </button>
                );
              })}
            </div>
          </details>
        ) : null}
      </div>

      {onDenseChange ? (
        <div role="group" aria-label="表格密度" className="inline-flex items-center rounded-md border border-border bg-white p-0.5">
          {([{ label: "紧凑", value: true }, { label: "标准", value: false }] as const).map((option) => (
            <button
              key={option.label}
              type="button"
              aria-pressed={(dense ?? false) === option.value}
              onClick={() => onDenseChange(option.value)}
              className={cn(
                "rounded px-2.5 py-1 text-xs font-medium transition-colors",
                (dense ?? false) === option.value ? "bg-brand text-white" : "text-muted hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
