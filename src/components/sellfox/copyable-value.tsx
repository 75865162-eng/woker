"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Copy, Check } from "lucide-react";

/**
 * 只读单元格里的「一键复制」文本：默认展示原文，hover/聚焦时出现复制按钮，
 * 点击后复制真实值（而非展示文案）并短暂显示 ✓ 反馈。
 * 对齐 wimoor listProductAds 等报表的 ASIN/活动名复制交互。
 */
export function CopyableValue({
  value,
  children,
  title,
  className,
}: {
  /** 实际写入剪贴板的值；空值时按钮禁用。 */
  value: unknown;
  /** 单元格展示内容（可为链接、堆叠文本等）。 */
  children: ReactNode;
  title?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const raw = value == null ? "" : String(value);
  const disabled = !raw || raw === "-";

  const copy = async () => {
    if (disabled) return;
    try {
      await navigator.clipboard.writeText(raw);
      setState("copied");
    } catch {
      setState("error");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 1600);
  };

  // 成功时 ✓ 图标即反馈；失败时 title + aria-live 给出可见提示。
  return (
    <span className={`sf-copyable group/copy inline-flex min-w-0 items-center gap-0.5 ${className ?? ""}`} title={title ?? (disabled ? undefined : `复制 ${raw}`)}>
      <span className="min-w-0 truncate">{children}</span>
      {!disabled ? (
        <button
          type="button"
          aria-label={`复制 ${raw}`}
          title={state === "copied" ? "已复制" : state === "error" ? "复制失败，请检查剪贴板权限" : `复制 ${raw}`}
          onClick={(event) => { event.preventDefault(); event.stopPropagation(); void copy(); }}
          className="sf-copy-btn inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center opacity-0 transition-opacity group-hover/copy:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand"
        >
          {state === "copied" ? <Check className="h-3 w-3 text-success" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
        </button>
      ) : null}
      <span aria-live="polite" className="sr-only">{state === "copied" ? `已复制 ${raw}` : state === "error" ? "复制失败" : ""}</span>
    </span>
  );
}
