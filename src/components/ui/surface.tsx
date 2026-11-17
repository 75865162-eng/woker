import React, { type ReactNode } from "react";
import { cn } from "@/lib/utils";

type SurfaceProps = { children: ReactNode; className?: string };

export function Surface({ children, className, as: Tag = "div" }: SurfaceProps & { as?: "section" | "div" }) {
  return <Tag className={cn("rounded-lg border border-border bg-surface", className)}>{children}</Tag>;
}

export function SurfaceHeader({ children, className }: SurfaceProps) {
  return <div className={cn("border-b border-border px-4 py-3", className)}>{children}</div>;
}

export function SurfaceBody({ children, className }: SurfaceProps) {
  return <div className={cn("px-4 py-3", className)}>{children}</div>;
}
