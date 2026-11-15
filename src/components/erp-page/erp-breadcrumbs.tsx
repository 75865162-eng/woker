"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ErpBreadcrumb } from "./types";

/** 对应 Wimoor「全局外壳 / 所有列表页」的面包屑导航，最后一项为当前页且不可点。 */
export function ErpBreadcrumbs({ items, className }: { items: ErpBreadcrumb[]; className?: string }) {
  if (items.length === 0) return null;
  return (
    <nav aria-label="面包屑" className={cn("flex flex-wrap items-center gap-1 text-xs text-muted", className)}>
      {items.map((item, index) => {
        const isLast = index === items.length - 1;
        return (
          <span key={`${item.label}-${index}`} className="inline-flex items-center gap-1">
            {index > 0 ? <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden="true" /> : null}
            {isLast ? (
              <span aria-current="page" className="font-semibold text-foreground">{item.label}</span>
            ) : item.href ? (
              <Link href={item.href} className="rounded px-1 py-0.5 font-medium hover:bg-surface-muted hover:text-brand">
                {item.label}
              </Link>
            ) : (
              <span className="font-medium">{item.label}</span>
            )}
          </span>
        );
      })}
    </nav>
  );
}
