"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { ChevronDown, ExternalLink, Info } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type ErpInfoLink = { label: string; href: string };

/** 对应 Wimoor「全局外壳 / 页面模式」说明条：页面用途、数据口径与参考来源。 */
export function ErpInfoPanel({
  title = "页面说明与数据口径",
  description,
  bullets,
  source,
  pattern,
  links,
  defaultOpen = false,
  className,
  children,
}: {
  title?: string;
  description?: string;
  bullets?: string[];
  source?: string;
  pattern?: string;
  links?: ErpInfoLink[];
  defaultOpen?: boolean;
  className?: string;
  /** 展开后的附加内容（如板块字段与来源说明），随 details 折叠，不占首屏。 */
  children?: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  // 用 DOM 属性设置初始展开态，避免受控 open 属性在重渲染时覆盖用户手动展开。
  useEffect(() => {
    if (defaultOpen && ref.current) ref.current.open = true;
  }, [defaultOpen]);

  const hasBody = Boolean(description || bullets?.length || source || pattern || links?.length || children);

  return (
    <details ref={ref} className={cn("group rounded-lg border border-border bg-white text-sm shadow-sm", className)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 [&::-webkit-details-marker]:hidden">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-surface-muted text-brand">
          <Info className="h-3.5 w-3.5" aria-hidden="true" />
        </span>
        <span className="font-semibold text-foreground">{title}</span>
        {pattern ? <Badge tone="blue">{pattern}</Badge> : null}
        <ChevronDown className="ml-auto h-4 w-4 text-muted transition-transform group-open:rotate-180" aria-hidden="true" />
      </summary>
      {hasBody ? (
        <div className="space-y-2 border-t border-border px-4 py-3 text-xs leading-5 text-muted">
          {description ? <p>{description}</p> : null}
          {bullets?.length ? (
            <ul className="list-disc space-y-1 pl-5">
              {bullets.map((bullet, index) => <li key={index}>{bullet}</li>)}
            </ul>
          ) : null}
          {source ? <p>参考来源：Wimoor 原系统 · {source}</p> : null}
          {children}
          {links?.length ? (
            <div className="flex flex-wrap gap-3 pt-1">
              {links.map((link) => (
                <a key={link.href} href={link.href} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-brand hover:underline">
                  {link.label}
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : children ? (
        <div className="space-y-2 border-t border-border px-4 py-3 text-xs leading-5 text-muted">{children}</div>
      ) : null}
    </details>
  );
}
