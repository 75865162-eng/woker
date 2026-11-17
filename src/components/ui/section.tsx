"use client";

import React, { type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Surface, SurfaceHeader } from "./surface";

export { SurfaceBody as SectionBody } from "./surface";
export function Section({
  children,
  className,
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "div";
}) {
  return (
    <Surface as={Tag} className={cn("min-w-0 overflow-hidden", className)}>
      {children}
    </Surface>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
  size = "sm",
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  /** sm: 14/600（表格工具条级）；lg: 18/700（analog dashboard「处理记录」） */
  size?: "sm" | "lg";
  className?: string;
}) {
  return (
    <SurfaceHeader
      className={cn("flex flex-wrap items-center justify-between gap-3", className)}
    >
      <div className="min-w-0">
        <p className={size === "lg" ? "text-title text-foreground" : "text-sm font-bold text-foreground"}>
          {title}
        </p>
        {description ? <p className="mt-1 text-xs text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </SurfaceHeader>
  );
}
