"use client";

import { Inbox, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ErpAction } from "./types";

/** 对应 Wimoor「所有列表页 / 看板」无数据时的空态。 */
export function ErpEmptyState({
  title = "暂无数据",
  description = "当前筛选条件下没有可展示的记录",
  action,
  className,
}: {
  title?: string;
  description?: string;
  action?: ErpAction;
  className?: string;
}) {
  const Icon = action?.icon;
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      <span className="mb-1 flex h-12 w-12 items-center justify-center rounded-full bg-surface-muted text-muted">
        <Inbox className="h-6 w-6" aria-hidden="true" />
      </span>
      <p className="text-sm font-bold text-foreground">{title}</p>
      {description ? <p className="max-w-sm text-xs leading-5 text-muted">{description}</p> : null}
      {action ? (
        <Button
          type="button"
          size="sm"
          variant={action.tone === "danger" ? "danger" : "primary"}
          disabled={action.disabled || action.loading}
          title={action.hint}
          onClick={action.onClick}
          className="mt-2"
        >
          {action.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : Icon ? <Icon className="h-3.5 w-3.5" /> : null}
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
