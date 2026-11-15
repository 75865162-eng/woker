"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 空状态原语。替代全站 10 余种不一致的「暂无…」写法。
 * 表格内默认走 compact（对齐 dashboard 的 px-3 py-14 居中行），
 * 独立区块用 default。
 */
export function EmptyState({
  title = "暂无数据",
  description,
  icon,
  action,
  variant = "default",
  className,
}: {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  variant?: "default" | "compact";
  className?: string;
}) {
  if (variant === "compact") {
    return (
      <div className={cn("px-3 py-14 text-center text-sm text-muted", className)}>
        {icon ? <div className="mb-2 flex justify-center text-muted">{icon}</div> : null}
        <p>{title}</p>
        {description ? <p className="mt-1 text-xs text-muted">{description}</p> : null}
        {action ? <div className="mt-3 flex justify-center">{action}</div> : null}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-surface px-6 py-12 text-center",
        className,
      )}
    >
      {icon ? (
        <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-surface-muted text-muted">
          {icon}
        </div>
      ) : null}
      <p className="text-section text-foreground">{title}</p>
      {description ? <p className="mt-1 max-w-md text-xs text-muted">{description}</p> : null}
      {action ? <div className="mt-4 flex items-center gap-2">{action}</div> : null}
    </div>
  );
}
