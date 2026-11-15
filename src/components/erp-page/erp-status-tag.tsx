"use client";

import type { ReactNode } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { ErpTone } from "./types";

const badgeTone: Record<ErpTone, "blue" | "green" | "amber" | "red" | "gray"> = {
  default: "gray",
  brand: "blue",
  success: "green",
  warning: "amber",
  danger: "red",
  info: "blue",
};

/** 对应 Wimoor「单据列表页 / 审核工作台」的单据状态标签。 */
export function ErpStatusTag({ label, tone = "default", className }: { label: ReactNode; tone?: ErpTone; className?: string }) {
  return <Badge tone={badgeTone[tone]} className={cn("font-semibold", className)}>{label}</Badge>;
}
