"use client";

import { SlidersHorizontal, X } from "lucide-react";
import { useState } from "react";
import { ConditionBuilder } from "@/components/rule-builder/condition-builder";
import { Button } from "@/components/ui/button";

export function AdvancedFilterPanel() {
  const [open, setOpen] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-white">
      <div className="flex items-center justify-between px-5 py-4">
        <div>
          <h2 className="text-base font-bold text-foreground">高级筛选</h2>
          <p className="text-xs font-medium text-muted">与规则编辑器共用同一套筛选组件，仅用于查看数据，不执行修改</p>
        </div>
        <Button variant={open ? "secondary" : "primary"} onClick={() => setOpen((value) => !value)}>
          {open ? <X className="h-4 w-4" /> : <SlidersHorizontal className="h-4 w-4" />}
          {open ? "收起筛选" : "展开筛选"}
        </Button>
      </div>
      {open && (
        <div className="border-t border-border bg-surface-muted p-5">
          <ConditionBuilder compact />
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary">重置</Button>
            <Button>应用筛选</Button>
          </div>
        </div>
      )}
    </div>
  );
}
