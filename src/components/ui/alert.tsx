"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * 行内提示条。
 *
 * 两种形态：
 * - 只有 children（默认）：单行紧凑提示，与商品详情抽屉里的超时提示一致
 * - 带 title / description：块状提示，用于页面级说明与错误
 *
 * 取色一律走语义令牌，禁止在调用点写 border-danger/30 bg-danger-soft 这类组合。
 */
export type AlertTone = "danger" | "warning" | "success" | "info";

const toneClass: Record<AlertTone, string> = {
  danger: "border-danger/25 bg-danger-soft text-danger-ink",
  warning: "border-accent/30 bg-warning-soft text-warning-ink",
  success: "border-success/25 bg-success-soft text-success-ink",
  info: "border-info/25 bg-info-soft text-info-ink",
};

export function Alert({
  children,
  tone = "info",
  icon,
  action,
  title,
  description,
  className,
}: {
  children?: ReactNode;
  tone?: AlertTone;
  icon?: ReactNode;
  action?: ReactNode;
  /** 块状形态的标题；提供后自动切换为块状 */
  title?: ReactNode;
  /** 块状形态的描述 */
  description?: ReactNode;
  className?: string;
}) {
  const block = Boolean(title || description);

  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn(
        "flex gap-2 rounded-md border px-3 py-2",
        block ? "items-start" : "items-center",
        toneClass[tone],
        className,
      )}
    >
      {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
      {block ? (
        <div className="min-w-0 flex-1">
          {title ? <p className="text-body font-semibold">{title}</p> : null}
          {description ? <p className="mt-0.5 text-meta opacity-90">{description}</p> : null}
          {children ? <div className="mt-1 text-meta opacity-90">{children}</div> : null}
        </div>
      ) : (
        <span className="min-w-0 flex-1 text-meta font-semibold">{children}</span>
      )}
      {action ? <span className="shrink-0">{action}</span> : null}
    </div>
  );
}
